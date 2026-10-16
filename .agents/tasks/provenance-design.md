# Technical Design — Access Provenance ("How they got this") Decision Support

**Feature:** Give a certification reviewer, at a glance and on demand, the
provenance of each access they are deciding keep/remove: whether it was granted
**via an access request** (and **who approved it**), **part of a role**, or
**assigned directly** — and, when available, when it was granted and the request
justification.

**Scope (locked):** Implements ONLY the two provenance-focused reviewer
questions the user chose (Option A):
- **Q4 — grant mechanism** (role vs request vs direct). The user's stated
  priority, so it is the **headline** on each card.
- **Q5 — requested + who approved** (the approval chain).

Q1 (business reason), Q2 (a standalone when-granted feature), and Q3 (peer
coverage) are explicitly OUT of scope for this build and are later work. Q2's
grant *date* is surfaced only as a secondary detail where Q4's history
inference already supplies it; no separate feature is built for it.

This design follows the authoritative investigation at
`.agents/tasks/access-context-investigation.md` and fits the existing data/UI
layers. Every DTO/method claim below was re-verified against
`sailpoint-api-client@2.1.28` in `node_modules` and against the actual source
files in this repo (paths, hook wiring, props threading, CSS tokens) during the
design-tightening pass; the exact `file:line` anchors are listed in the
**Evidence** section.

---

## Overview

Provenance data lives behind **extra, identity-keyed async calls** that must not
block or slow the existing review-item list. The design adds a thin data module
(`src/sailpoint/provenance.ts`) with a **per-identity resolver/cache** that
fetches each reviewed identity's access-requests and (experimental) history
events **once** and reuses them across every item for that identity. A matcher
pairs each review item's access (by **name + type**) to a request row and/or a
history event; a mapper turns the matched raw DTOs into a clean, DTO-free view
model (`AccessProvenanceVM`). A new hook (`useProvenance`) resolves provenance
**lazily, after** `useReviewItems` has loaded the list, exposing a per-item
status (`idle | loading | ready | unavailable`) so the UI can show a headline
badge on each `ReviewItemCard` and an accessible, collapsed-by-default
"How they got this" disclosure (same `aria-expanded`/`aria-controls` pattern as
`WhyThisOrder`). Keep/remove/reassign behavior is untouched throughout.

Because Q4's answer leans heavily on Q5's data, the two are treated as **one
provenance story**: the request record is the strongest signal for mechanism,
and history (when the experimental endpoint is reachable) sharpens the
**request-vs-direct** distinction and supplies the grant date. History cannot
distinguish "via a role" — the `2.1.28` client has no field encoding that (see
the §2 known limitation) — so `role` is emitted only when the reviewed item is
itself a role. When nothing is conclusive, the UI degrades to an honest
plain-language label rather than guessing.

---

## Technology stack (locked)

No new runtime dependencies. React 18 + TypeScript + Vite, the existing
`@sailpoint/ui-plugin-sdk` handshake, and the already-installed
`sailpoint-api-client@2.1.28`. Styling stays with **global per-component
stylesheets with globally shared class names** — each component does a plain
`import './X.css'` (there are no `*.module.css` CSS Modules in `src/`), and class
names such as `.vc-chip` are globally scoped. Styling uses the `--vc-` design
tokens from `src/index.css`. No change to `vite.config.ts`, the
SDK handshake in `sdkClient.ts` (beyond constructing two new API clients), or
`sp-ui-plugin.json` scopes (`sp:scopes:all` already covers both endpoints).

---

## 1. API client wiring (`src/sailpoint/sdkClient.ts`)

Construct `AccessRequestsApi` and `IdentityHistoryApi` alongside the existing
clients and thread them onto `PluginRuntime` identically. Both are exported from
the package root — **re-verified this pass**:
`119:export { _AccessRequestsApi as AccessRequestsApi };` and
`162:export { _IdentityHistoryApi as IdentityHistoryApi };` in
`dist/index.d.ts` (the review's "line 160" for `IdentityHistoryApi` was off by
two; the actual export is line **162**, which this design already cited). They
join the existing root import. **`IdentitiesApi` is NOT added** — the peer axis
it would feed is Q3, which is out of scope.

```ts
import {
  AccessRequestsApi,
  CertificationsApi,
  CertificationSummariesApi,
  Configuration,
  IdentityHistoryApi,
  SearchApi,
} from 'sailpoint-api-client'
```

Add to `PluginRuntime`:

```ts
  /** Access-request status + approval chain (Q5, and the primary Q4 signal). */
  accessRequestsApi: AccessRequestsApi
  /** Experimental identity-history events, to sharpen grant mechanism (Q4). */
  identityHistoryApi: IdentityHistoryApi
```

In `initPlugin`, after the existing `new SearchApi(configuration)`:

```ts
  const accessRequestsApi = new AccessRequestsApi(configuration)
  const identityHistoryApi = new IdentityHistoryApi(configuration)
```

…and include both in the returned object. The `Configuration` is reused exactly
as the existing clients use it — no handshake or autoconfigure change.

**Scope comment (required, no manifest change):** add a short comment near the
`identityHistoryApi` construction noting that its events endpoint maps to
`idn:identity-history:read` for tenants that later tighten scopes away from
`sp:scopes:all`.

---

## 2. View-model shape (`src/sailpoint/types.ts`)

Add a **companion type** rather than widening `ReviewItemVM`, keeping provenance
(which loads asynchronously and may be unavailable) decoupled from the
synchronously-mapped item. View models stay fully decoupled from DTOs. Import
the per-domain DTO types from the **subpath** when needed in the data layer
(e.g. `sailpoint-api-client/access_requests/api`,
`sailpoint-api-client/identity_history/api`) — never from the package root, per
the existing `types.ts` convention.

```ts
/** How a reviewer-facing access was most likely granted. */
export type GrantMechanism = 'role' | 'request' | 'direct' | 'unknown'

/** A single approval step in the request's approval chain. */
export interface ApprovalStepVM {
  /** Who reviewed this step (display name), or null if unknown. */
  approver: string | null
  /** Plain-language outcome of this step. */
  decision: 'approved' | 'rejected' | 'pending' | 'unknown'
  /** When the decision was made (ISO string), or null. */
  decidedOn: string | null
  /** Approver's comment, if any. */
  comment: string | null
}

/** The original access request that produced this access, if one exists. */
export interface AccessRequestSummaryVM {
  /** Who requested it (display name), or null. */
  requestedBy: string | null
  /** When it was requested (ISO string), or null. */
  requestedOn: string | null
  /** The requester's stated justification, if any. */
  justification: string | null
}

/** Provenance for one review item. Always present once resolved; fields degrade. */
export interface AccessProvenanceVM {
  /** The review item id this provenance belongs to (join key for the UI). */
  itemId: string
  /** Headline mechanism (the user's priority). */
  grantMechanism: GrantMechanism
  /** Plain-language headline label, e.g. "Via access request". */
  mechanismLabel: string
  /** The source request, or null when no request is on record. */
  request: AccessRequestSummaryVM | null
  /** The approval chain, oldest step first; empty when none on record. */
  approvals: ApprovalStepVM[]
  /** When the access was granted (ISO), from history when available, else null. */
  grantedOn: string | null
  /**
   * True when the experimental history endpoint could not be reached (400/403)
   * or returned nothing — used to word the degraded state honestly.
   */
  historyUnavailable: boolean
}
```

**Per-item provenance status + entry (declared here, NOT in the hook).** The
hook (`useProvenance`, §4) and all three presentational components (§5.0)
consume these types; per the repo convention that components import shared
view-model types from `src/sailpoint/types.ts` (every component already does
`import type … from '../sailpoint/types'`, and no component imports from a
`state/` hook), **`ProvenanceStatus` and `ProvenanceEntry` are declared here**,
alongside `AccessProvenanceVM`. `useProvenance.ts` imports them from
`../sailpoint/types` and re-exports nothing new; the components import them from
`../sailpoint/types` as well. This preserves the
one-directional component→`sailpoint/types` import flow and avoids a
component→`state/` dependency.

```ts
/** Resolution status of one item's provenance (async, non-blocking). */
export type ProvenanceStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

/** Per-item provenance entry the UI consumes, keyed by review item id. */
export interface ProvenanceEntry {
  status: ProvenanceStatus
  data: AccessProvenanceVM | null
}
```

Rationale for the enum: `role` (the item under review **is itself a role** —
`accessKind === 'role'`), `request` (a matching request row exists), `direct`
(no request matched and no history/governance request signal — assigned
directly), `unknown` (no request matched and the signal is inconclusive).
We never fabricate a mechanism — `unknown` and `direct` are honest, distinct
outcomes.

**Known limitation (locked):** `grantMechanism = 'role'` is emitted **only**
when the reviewed item is itself a role. An **entitlement that was granted to
the identity by virtue of a role** is NOT upgraded to `'role'`: the installed
`2.1.28` client carries no field that encodes "this entitlement arrived via a
role." The history DTO's only mechanism-bearing fields are
`CorrelatedGovernanceEvent.type` (enum values exactly `certification` |
`accessRequest`) and `AccessRequestResponse2` (only `requesterId` /
`requesterName` / `items`); `accessItemType` is the item's *own* type, not the
granting mechanism. Entitlement-via-role therefore surfaces as `request` (if a
request row matched) or honestly as `direct`/`unknown`, by design. This is an
accepted scope boundary for this build, not a bug.

---

## 3. Provenance data module (`src/sailpoint/provenance.ts`)

A new module owning the resolver (fetch-once-per-identity + cache), the matcher,
and the mapper. **Every call is wrapped so a failure never surfaces a raw DTO**,
reusing the existing `FriendlyError`/`toFriendlyError` from `certifications.ts`.

### 3a. Resolver + per-identity cache (performance guard)

A campaign can have many items for the **same** identity. The resolver fetches
that identity's data **once** and reuses it. Design a cache keyed by
`identityId`, holding a **promise** of the raw bundle (so concurrent requests
for the same identity dedupe to one network round-trip):

```ts
interface RawIdentityProvenance {
  requests: RequestedItemStatus[]        // from AccessRequestsApi ([] on any failure)
  events: HistoricalEvent[] | null       // null when history was unavailable
  requestsFailedHard: boolean            // true only on 429/5xx/network — drives `unavailable`
}

export interface ProvenanceResolver {
  /** Resolve (and cache) the raw bundle for one identity. */
  forIdentity(identityId: string): Promise<RawIdentityProvenance>
}

export function createProvenanceResolver(
  accessRequestsApi: AccessRequestsApi,
  identityHistoryApi: IdentityHistoryApi,
): ProvenanceResolver
```

Internals: a `Map<string, Promise<RawIdentityProvenance>>`. `forIdentity`
returns the cached promise if present, otherwise starts one and stores it.

- **Access requests (Q5, required):**
  `accessRequestsApi.listAccessRequestStatusV1({ requestedFor: identityId, limit: 250 })`.
  Verified: the **class** method takes a request-parameters object and resolves
  to `AxiosResponse<Array<RequestedItemStatus>>` — `await` it and read rows off
  `res.data`, matching the existing `certifications.ts` pattern
  (`res.data.map(...)`). The request object's `requestedFor` is a **single
  `string`** (line ~3250) — set it to the `identityId` argument passed to
  `forIdentity` (a plain string, sourced by the hook from
  `ReviewItemVM.identityId`; the resolver never sees `identitySummary`).
  The only `filters` fields are `accessRequestId` / `accountActivityItemId` /
  `created` (verified at line ~3296) — there is **no** server-side filter by
  access id, confirming client-side matching. No `requestState` filter is sent
  (its only valid value is `EXECUTING`; we need completed/historical requests).
  Wrap in `try/catch` and classify the failure via `toFriendlyError` so the
  hook can apply the single `unavailable` rule (§4): a **401/403** (reviewer not
  authorized) is a soft degrade → `requests: []`, item still `ready` as
  `direct`/`unknown`; a **hard** failure (429 / 5xx / network) is the one path
  that makes the item `unavailable`. To carry this distinction without throwing
  raw errors upward, `RawIdentityProvenance` includes a
  `requestsFailedHard: boolean` flag (set `true` only on 429/5xx/network); the
  resolver still **does not throw** — it returns the bundle with that flag so
  the hook decides `ready` vs `unavailable`.

- **History events (Q4 sharpening, optional/experimental):**
  `identityHistoryApi.getHistoricalIdentityEventsV1({ id: identityId, eventTypes: ['AccessAddedEvent'], accessItemTypes: ['entitlement', 'role', 'accessProfile'], limit: 250, xSailPointExperimental: 'true' })`.
  **Verified against the installed client:** the *class* method
  `IdentityHistoryApi.getHistoricalIdentityEventsV1(requestParameters, axiosOptions?)`
  takes a request-parameters **object** (`identity_history/api.d.ts` line 2375 —
  distinct from the lower-level positional/functional forms at lines 1551/1697,
  which this design does NOT use). That request object
  (`IdentityHistoryApiGetHistoricalIdentityEventsV1Request`, line ~2007) exposes
  `id: string` (required), `from?`, `eventTypes?: Array<string>`,
  `accessItemTypes?: Array<string>`, `limit?`, `offset?`, `count?`, and
  **`xSailPointExperimental?: string`** (confirmed on the interface). This class
  method resolves to `AxiosResponse<Array<...>>` — `await` and read rows off
  `res.data`, same as the request client and the existing `certifications.ts`
  pattern. Pass the experimental flag via the `xSailPointExperimental: 'true'`
  request param; the client impl (`dist/identity_history/api.js`) defaults it to
  `'true'` and **always** writes the `X-SailPoint-Experimental` header, so
  passing the param alone guarantees the header — no separate `axiosOptions`
  header is required. The `accessItemTypes` tokens
  `['entitlement','role','accessProfile']` are valid enum members
  (`GetHistoricalIdentityEventsV1200ResponseInnerAccessItemTypeEnum`, values
  `account|app|entitlement|role|accessProfile`, line ~1139). **Treat a 400 or
  403 as "history unavailable"**: catch, set `events: null`, and let the mapper
  fall back to the request-only inference. Any other error also degrades to
  `events: null` — history is strictly an enhancement.

Both fetches run **in parallel** (`Promise.all`) inside `forIdentity`, each with
its own catch so one failing does not sink the other.

### 3b. Matcher (name + type)

No API filters by a specific access id, so match client-side. The review item
gives `accessName` and `accessKind`; map `accessKind` to the DTO type literal
and compare case-insensitively on **name AND type**:

```ts
// accessKind -> request/history type token
// 'entitlement' -> 'ENTITLEMENT', 'role' -> 'ROLE',
// 'accessProfile' -> 'ACCESS_PROFILE', 'access' -> (match on name only)
```

- **Request match:** find the `RequestedItemStatus` whose `name` (string|null,
  line ~2152) equals the item's `accessName` (case-insensitive, trimmed) and
  whose `type` (`RequestedItemStatusTypeEnum`, values `ACCESS_PROFILE` / `ROLE` /
  `ENTITLEMENT`, verified at `access_requests/api.d.ts` line 2329) equals the
  mapped token. If several match, prefer the most recently `created` (string ISO,
  line ~2190). `RequestedItemStatus.type` is nullable; a row with a null `type`
  can only satisfy name+type matching for items reviewed as kind `access`
  (name-only comparison). For typed items (entitlement / role / accessProfile)
  a null-type row is treated as **non-matching** — it never routes into the
  `access` fallback.
- **History match:** find the event (`GetHistoricalIdentityEventsV1200ResponseInner`,
  line ~1041) whose `accessItem.displayName`
  (`AccessItemAssociatedAccessItem.displayName`, line ~274) equals the item's
  `accessName` and whose `accessItemType`
  (`GetHistoricalIdentityEventsV1200ResponseInnerAccessItemTypeEnum`, line ~1139)
  matches the mapped kind, filtered to add events via `eventType` (a plain
  `string`, line ~1079 — the exact literal is NOT enum-pinned; see assumption 1).
  **Nullability:** `accessItem` itself is a **required, non-optional** field on
  the event DTO (`'accessItem': AccessItemAssociatedAccessItem`, verified line
  1101 — no `?`); only its `displayName?` sub-field is optional. Guard
  **`displayName`** (treat missing as non-matching); do **not** guard
  `accessItem` as if the parent could be absent — it is present by contract.
  **Accepted degrade (name vs displayName):** the item's `accessName` comes from
  `entitlement.name` / `role.name` / `accessProfile.name` (via `describeAccess`),
  while the event exposes `accessItem.displayName`; `name` and `displayName` can
  legitimately differ for the same access, so a history **no-match here is an
  accepted degrade, not a bug** — the mapper falls back to request-only
  inference or an honest `unknown`, mirroring the `eventType`-literal framing in
  the Open-assumptions section. History is a non-load-bearing enhancement.
  The event's `governanceEvent` is **`CorrelatedGovernanceEvent | null`**
  (line ~235) with `type?: 'certification' | 'accessRequest'`
  (`CorrelatedGovernanceEventTypeEnum`, verified at line ~977); its presence/type
  plus the `accessRequest` field distinguish request vs role vs assigned. Guard
  for `governanceEvent === null` before reading `type`.
- **No match** on either source → the mapper yields `direct` or `unknown`
  (see 3c).

**Sentinel/empty name guard for the `access` fallback (locked).** For the
`access` fallback kind, `accessName` comes from `describeAccess`
(`certifications.ts`), which sets it to `summary?.access?.name ?? 'this access'`
(verified line 195) — so an absent name surfaces as the literal placeholder
`"this access"`, not an empty string. Because the `access` fallback matches on
**name only**, a request row literally named `"this access"` could otherwise
produce a false match. The matcher therefore treats the sentinel `'this access'`
and any empty/whitespace-only `accessName` as **non-matching** for the `access`
fallback (skip matching when `accessName.trim().toLowerCase() === 'this access'`
or `accessName.trim() === ''`) → the item resolves via history or honestly to
`unknown`. Typed items (entitlement / role / accessProfile) are unaffected since
they match on name + type.

Matching rule summary: **name + type, case-insensitive** (trimmed); the
`access` fallback kind (no typed sub-object) matches on **name only**, and the
sentinel placeholder `"this access"` (and empty/whitespace names) is treated as
**non-matching** for that fallback; a null-type request row matches only the
`access` fallback and is non-matching for typed items; **no request match → `direct` when a history access-added
event exists with no governance request signal, otherwise `unknown`**. History
is never used to emit `role` (see §2 known limitation).

### 3c. Mapper (raw → `AccessProvenanceVM`)

`toProvenanceVM(item: ReviewItemVM, raw: RawIdentityProvenance): AccessProvenanceVM`

Decision order (the single provenance story):

1. **Item is itself a role** (`item.accessKind === 'role'`): `grantMechanism =
   'role'`, label **"Part of a role"**. A role under review plainly *is* role
   access; say so without needing history.
2. **A matching request row exists** (strongest signal for an entitlement /
   access profile): `grantMechanism = 'request'`, label **"Via access request"**.
   Populate `request` from `requester.name` → `requestedBy`, `created` →
   `requestedOn`, `requesterComment.comment` → `justification`. Populate
   `approvals` from `approvalDetails[]` (`Array<ApprovalStatusDto>`, line ~2160):
   each `currentOwner.name` → `approver` (`ApprovalStatusDtoCurrentOwner`,
   line ~894/906), `status` (`ManualWorkItemState`) → mapped decision, `modified`
   (string|null, line ~851) → `decidedOn`, `comment` (string|null, line ~875) →
   `comment`. The **full** `ManualWorkItemState` enum (verified at line ~1763)
   has six values; map them explicitly: `APPROVED`→`approved`, `REJECTED`→
   `rejected`, `PENDING`→`pending`, and `EXPIRED`/`CANCELLED`/`ARCHIVED`→
   `unknown` (plus the `undefined`/unrecognized case → `unknown`). Order oldest
   first (the array order; the UI renders it top-to-bottom as the chain).
3. **No request matched, but history has a matching access-added event:** this
   branch is **request-vs-direct only** — history in `2.1.28` cannot say an
   entitlement came via a role (see the §2 known limitation). Read the matched
   event's `governanceEvent` (guard for `null` first).

   **Request-signal predicate (locked — do NOT test object presence).**
   `accessRequest` is a **required, non-optional** field on the event DTO
   (`GetHistoricalIdentityEventsV1200ResponseInner`, verified at
   `identity_history/api.d.ts` line 1127 — `'accessRequest': AccessRequestResponse2`,
   no `?`), so it is **always** present as an object; only its sub-fields
   (`requesterId?` / `requesterName?` / `items?`, lines ~656–676) are optional.
   A naive `if (event.accessRequest)` is therefore **always true** and would
   route every history-matched item to `request`, defeating the
   request-vs-direct split. Define the predicate on a **populated sub-field**:

   ```ts
   const hasRequestSignal =
     governanceEvent?.type === 'accessRequest' ||
     Boolean(event.accessRequest?.requesterId ?? event.accessRequest?.requesterName)
   ```

   - If `hasRequestSignal === true` but no request row matched client-side,
     treat it as a request we could not pair: `grantMechanism = 'request'`,
     label **"Via access request"**, with an empty `approvals[]` and a `request`
     populated only from `accessRequest.requesterName` → `requestedBy` when
     present (history carries no approval chain). This keeps the headline honest
     when a request clearly existed but the request-status list did not surface
     a matching row.
   - Otherwise (`hasRequestSignal === false` — i.e. `governanceEvent` is null or
     `type === 'certification'`, and the `accessRequest` object carries no
     `requesterId`/`requesterName`) → `grantMechanism = 'direct'`, label
     **"Assigned directly"**. Set `grantedOn` from the event `dateTime` when
     present. (An event whose `accessRequest` object exists but is **empty**
     resolves to `direct`, not `request` — this is the mapper unit-test case in
     §9.)
4. **No request matched and history unavailable or inconclusive:**
   `grantMechanism = 'unknown'`, label **"Granted outside an access request"**
   (honest, not a guess). This is still a `ready` entry; `historyUnavailable`
   is set `true` only to let the disclosure panel word the degraded line, and
   does NOT by itself make the item `unavailable` (see §4 for the single
   `unavailable` rule).

The mapper is **pure** (no I/O) → trivially unit-testable with crafted DTO
fixtures. It never returns or logs raw DTOs; only the clean VM leaves the module.

---

## 4. Lazy-load state model (`src/state/useProvenance.ts`)

Provenance must **not** block the item list. `useReviewItems` is left exactly as
is (its optimistic `applyDecision`/`applyReassign`/`revertDecision` flows are
untouched). A **new** hook resolves provenance after the list is in hand:

`ProvenanceStatus` and `ProvenanceEntry` are **not** declared in this hook —
they live in `src/sailpoint/types.ts` (see §2) and are imported here (and by the
three components in §5.0) via `import type { ProvenanceStatus, ProvenanceEntry }
from '../sailpoint/types'`. This keeps the repo's component→`sailpoint/types`
import direction intact (no component ever imports a type from a `state/` hook).

```ts
import type {
  AccessProvenanceVM,
  ProvenanceEntry,
  ProvenanceStatus,
} from '../sailpoint/types'

export function useProvenance(
  accessRequestsApi: AccessRequestsApi,
  identityHistoryApi: IdentityHistoryApi,
  campaignId: string,
  items: ReviewItemVM[] | null,
): {
  /** Per-item provenance keyed by review item id. */
  byItemId: Record<string, ProvenanceEntry>
}
```

Behavior:
- Holds the `ProvenanceResolver` in a `useRef` so the per-identity promise cache
  survives re-renders. **It is NOT reset on unmount** — `CampaignRoute`
  (`src/CertApp.tsx`) is rendered **without a `key` prop** (verified: the
  `<CampaignRoute … campaignId={route.campaignId} … />` element carries no
  `key`), so a campaign switch changes the `campaignId` *prop* and re-renders the
  *same* instance rather than remounting it — exactly how `useReviewItems`
  already copes (a `campaignId` effect dependency, not a remount). Relying on
  unmount would therefore leave the resolver's `Map<string, Promise<…>>` alive
  across campaigns and return a stale cached promise for any `identityId` shared
  between two campaigns.
- **Reset the resolver explicitly on campaign change.** Because the cache cannot
  rely on unmount, `campaignId` is a hook parameter (hence the signature
  `useProvenance(accessRequestsApi, identityHistoryApi, campaignId, items)`), and
  a dedicated effect recreates the resolver and drops stale per-item state
  whenever it changes:
  ```ts
  // keyed on [campaignId, accessRequestsApi, identityHistoryApi]
  useEffect(() => {
    resolverRef.current = createProvenanceResolver(accessRequestsApi, identityHistoryApi)
    setByItemId({}) // drop entries from the previous campaign
  }, [campaignId, accessRequestsApi, identityHistoryApi])
  ```
  This makes the per-campaign cache boundary real: switching campaigns yields a
  fresh resolver and an empty `byItemId`, so no identity shared between campaigns
  can return a stale promise.
- **Effect dependency (do NOT key on the `items` array reference).**
  `useReviewItems`'s `applyDecision` / `applyReassign` / `revertDecision` each
  build a **new** `items` array via `.map()` on every keep/remove/reassign
  (verified in `src/state/useReviewItems.ts`). An effect keyed on the array
  reference would therefore re-run on every decision and — per the sequencing
  below — flip every entry back to `loading`, flashing the "Checking how they
  got this…" placeholder across the whole queue after each click. **Chosen
  rule:** key the effect on a **stable identity-set signature** derived from the
  list, computed with `useMemo`:
  `const idSig = useMemo(() => (items ?? []).map(i => i.id).join('|'), [items])`,
  and depend the effect on `[idSig]` (plus the resolver ref, which is stable).
  Because `applyDecision` et al. preserve item `id`s and only flip
  `completed`/`decision`/`reassigned`/`comments`, `idSig` is unchanged by a
  decision, so the effect does **not** re-run on keep/remove/reassign. It
  re-runs only when the set of item ids changes — i.e. on campaign change or
  `reload`. As a defensive second guard, the per-item update step **must not
  downgrade** an entry already `ready` or `loading` back to `loading`.
- For each item it needs the identity id. **Note:** `ReviewItemVM` currently
  does not carry `identityId`; add a read-only `identityId: string` to
  `ReviewItemVM` and populate it in `toReviewItemVM` from
  `item.identitySummary?.identityId ?? ''` (a pure, side-effect-free addition to
  the existing mapper). This is the one touch to `ReviewItemVM`, and it is a
  join key the UI already needs.
- Group items by `identityId`; for each identity call `resolver.forIdentity`
  **once**, then map each of that identity's items with `toProvenanceVM`. This
  guarantees **no N-calls-per-item** fan-out.
- Set each item's entry to `loading` before its identity resolves, then `ready`
  with data. The mapper **always** produces a VM (including the honest `unknown`
  / `direct` cases), so `ready` is the normal terminal state for every item.
  The **only** paths to `unavailable` are the two listed in the next bullet.
- **Single `unavailable` rule (locked):** an item resolves to `unavailable`
  **only** when (i) its `identityId` is missing/empty — in which case no API
  call is made at all — or (ii) the resolved bundle has
  `requestsFailedHard === true` (the access-request fetch failed hard:
  429 / 5xx / network, non-degradable). **Every other** degraded path —
  history unavailable (400/403), 401/403 on the request fetch yielding
  `requests: []`, no match, or a partial DTO — resolves to `ready` with an
  honest `unknown`/`direct` VM. `historyUnavailable` only reshapes the
  disclosure copy; it never produces `unavailable`.
- The effect must be cancellable (a `cancelled` flag like `useReviewItems`) so a
  campaign switch mid-flight does not write stale state. Provenance loading is
  fire-and-forget relative to the list; the queue is fully interactive before
  any provenance resolves.

`useProvenance` is wired inside the **`CampaignRoute`** component in
`src/CertApp.tsx`, right after the existing
`const review = useReviewItems(certificationsApi, campaignId)` call. That
component already destructures `const { certificationsApi, searchApi } = runtime`;
extend it to `const { certificationsApi, searchApi, accessRequestsApi,
identityHistoryApi } = runtime` and call
`const provenance = useProvenance(accessRequestsApi, identityHistoryApi, campaignId, review.items)`
(the `campaignId` prop `CampaignRoute` already receives is passed straight
through so the hook can reset its resolver on campaign change — see the
reset-on-campaign-change effect above).
Pass `review.items` (the raw, unordered list) so provenance keys off every item
regardless of ordering. The hook returns `{ byItemId }`; thread `provenance.byItemId`
down through the already-rendered `<ReviewView review={review} … />` as a **new,
separate prop** named `provenanceByItemId` — see §5 for the exact props chain. (Do not try to fold it into the
`review` object; `ReviewItemsState` comes straight from `useReviewItems`, which
this design leaves untouched.)

### Interaction with the "stale cards" refresh and optimistic decisions
Decisions/reassignments mutate items in place via `useReviewItems`'s `.map()`,
producing a new `items` array but preserving every item `id`. Because the effect
is keyed on `idSig` (the joined id set) — not the array reference — a decision
does **not** re-run the effect, does **not** re-fetch, and does **not** flip any
entry back to `loading`. Resolved provenance stays put through a keep/remove/
reassign. The hook re-resolves **only** when `idSig` changes, which happens on
`reload`/campaign re-entry (new item id set) — consistent with the existing
list-refresh behavior. This is what makes "deciding never re-fetches" true in
both the network and the UI sense.

---

## 5. UI composition

### 5.0 Props threading (exact chain, verified against the current source)

The provenance map flows from `CampaignRoute` to the card alongside the existing
`onDecide` path. **All three components import `ProvenanceEntry` from
`../sailpoint/types`** (the type home per §2), matching their existing
`import type … from '../sailpoint/types'` lines — no component imports from
`src/state/useProvenance.ts`. Verified component locations and current
signatures:

- **`src/views/ReviewView.tsx`** (NOTE: `views/`, not `components/`) —
  `ReviewViewProps` currently is `{ campaignName, review, onBack, onDecide,
  onSignOff? }`. Add `provenanceByItemId: Record<string, ProvenanceEntry>`.
  Thread it only into the card branch: `<ReviewQueue ordered={ordered}
  onDecide={onDecide} provenanceByItemId={provenanceByItemId} />`. The table
  branch (`DrillDownTable`) is left unchanged — provenance is a card-view
  enhancement for now.
- **`src/components/ReviewQueue.tsx`** — `ReviewQueueProps` currently is
  `{ ordered, onDecide }`. Add `provenanceByItemId`. In the `ordered.map`, pass
  `provenance={provenanceByItemId[item.id]}` to each `<ReviewItemCard>`. A
  missing entry (map has no key yet) is treated as `idle`.
- **`src/components/ReviewItemCard.tsx`** — `ReviewItemCardProps` currently is
  `{ item, priority, isFirst, onDecide }`. Add
  `provenance?: ProvenanceEntry`. Render `<AccessProvenance entry={provenance ??
  { status: 'idle', data: null }} />` inside the existing `.vc-item-text` block,
  **after** the priority-chips `<ul className="vc-chips">` (so provenance reads
  as "what/who/why" context below the risk chips). The keep/remove/reassign
  action column (`.vc-item-actions`) is untouched.

### 5a. Headline badge on `ReviewItemCard` (the user's priority)
Add a single, plain-language provenance line/badge rendered by
`<AccessProvenance>` at the bottom of the card's `.vc-item-text` block (after the
priority chips). It reads from the item's `ProvenanceEntry`:

- `loading` → a muted "Checking how they got this…" placeholder that reserves
  the same height as the resolved badge (no layout jump).
- `ready` → a chip showing `mechanismLabel`:
  - **"Via access request"** — tone accent (`--vc-accent` / `--vc-accent-bg`).
  - **"Part of a role"** — tone accent as well (role and request are both
    "governed" positives); differentiate by label text + an icon/prefix, not
    color alone (accessibility).
  - **"Assigned directly"** — neutral tone (`--vc-text-muted` on
    `--vc-surface-alt`).
  - **"Granted outside an access request"** (unknown) — neutral tone.
- `unavailable` → neutral chip "How they got this isn't available".

Reuse the existing `.vc-chip` / badge styling and `--vc-` tokens. Note `.vc-chip`
is a **global class defined in `ReviewItemCard.css`** (not a CSS Module), so it is
available to `AccessProvenance` only because `ReviewItemCard.css` is imported in
the same render tree — a cross-file coupling. To avoid depending on that
coupling, **redeclare the `.vc-chip` rule in the new `AccessProvenance.css`** so
the badge styling is self-contained (the global class names are identical; this
is a deliberate, low-risk duplication of a few lines, not a new mechanism).
**Add a token only if truly needed** — the four states map onto existing
accent/neutral tokens, so no new token is expected. Never rely on color alone to convey mechanism;
each state has distinct text. The badge container carries
**`aria-live="polite"`** (required, not optional): the mechanism resolves
asynchronously after the card first renders, so the resolved label (or "isn't
available") is announced to assistive technology on arrival. Because the loading
placeholder already reserves equal height, the live-region swap causes no layout
or focus shift.

### 5b. Expandable "How they got this" disclosure (per card)
Below the headline, a collapsed-by-default disclosure mirroring `WhyThisOrder`'s
accessible pattern: a `<button>` with `aria-expanded={open}` and
`aria-controls={panelId}` (`panelId` from `useId()`), toggling a panel region.
Label: **"How they got this"** (▸ collapsed / ▾ expanded).

Panel content, in plain language, driven by `AccessProvenanceVM`:
- **When a request exists:** a scannable **requester → approver(s)** sequence.
  Render the chain as an ordered visual flow: "Requested by **{requestedBy}**
  on {requestedOn}" → for each `approvals[]` step, "{approver} — {decision} on
  {decidedOn}" with the `comment` beneath when present. Show the request
  `justification` as a quoted block when present.
- **When granted (if known):** "Granted {grantedOn}" from history, shown as a
  secondary line when available; omitted silently when null (Q2 is not a feature
  here, just a bonus detail).
- **Honest empty / degraded states:**
  - `direct` / `unknown` with no request: **"No access request on record for
    this item."**
  - history fetch failed (`historyUnavailable`) and we could not determine
    mechanism: **"We couldn't load how this was granted."**
  - Never show raw ids, DTO field names, or SailPoint jargon.

New component `src/components/AccessProvenance.tsx` + `AccessProvenance.css`
owns both the badge and the disclosure, taking a single `entry: ProvenanceEntry`
prop, so `ReviewItemCard` stays lean (it just renders `<AccessProvenance
entry={provenance} />`). This also isolates the new accessible disclosure for
focused testing.

### Accessibility invariants (preserved)
- Disclosure uses `aria-expanded` + `aria-controls`, keyboard-operable as a
  native `<button>` (same as `WhyThisOrder`).
- Mechanism is conveyed by text, not color alone.
- The badge container is **`aria-live="polite"`** (required) so the resolved
  mechanism — or "isn't available" — is announced when it arrives after the
  async load. The loading placeholder reserves equivalent height so the
  resolution causes no focus/layout shift.

---

## 6. Error handling (concrete, per operation)

| Operation | Failure condition | Recoverable? | Caller receives | Logged? |
|---|---|---|---|---|
| missing/empty `identityId` | join key absent on the item | n/a (no call made) | item entry `unavailable`; badge "How they got this isn't available" | No |
| `listAccessRequestStatusV1` | 401/403 (reviewer not authorized to see requests) | Yes (degrade) | resolver returns `requests: []`; item entry `ready`; mapper yields `direct`/`unknown`; panel shows "No access request on record" | No raw body; status only via `toFriendlyError` if ever surfaced |
| `listAccessRequestStatusV1` | 429 / 5xx / network (hard, non-degradable) | No (hard-fail) | item entry **`unavailable`** (the single hard-failure path); badge "How they got this isn't available" | No |
| `getHistoricalIdentityEventsV1` | 400 (experimental header rejected) | Yes (degrade) | `events: null`, `historyUnavailable: true`; item still `ready`; mechanism inferred from request alone | No |
| `getHistoricalIdentityEventsV1` | 403 (scope missing) / 5xx / network | Yes (degrade) | `events: null`, `historyUnavailable: true`; item still `ready` | No |
| mapper | malformed/partial DTO (missing optional fields) | Yes | fields default to `null`/`unknown`; item `ready`; never throws | n/a (pure) |

The **only** two rows that produce `unavailable` are a missing `identityId` and
a hard (429/5xx/network) failure of the request fetch. Every other row stays
`ready` with an honest VM — matching the single rule stated in §4.

Principles: provenance is **always non-fatal**. No provenance failure ever
blocks the review queue, changes a decision flow, or surfaces a raw DTO/HTTP
body. All raw errors pass through the existing `toFriendlyError` humanizer if
they ever reach the UI, but the normal path for provenance is to **degrade
silently to an honest label**, not to show an error banner. The resolver
swallows per-identity failures so one bad identity does not blank provenance for
the rest of the campaign.

---

## 7. Input validation (external inputs)

External inputs here are the DTO responses (untrusted/partial) and the join
keys read off the review item.

- `identityId` (from `item.identitySummary?.identityId`): **required** for a
  provenance call. Type `string`. If empty/missing, skip the fetch and set the
  item's entry to `unavailable` (do not call the API with an empty id).
- `accessName` / `accessKind` (matcher inputs): **required**, `string` /
  `AccessKind`. Trim and lower-case before comparison. An empty/whitespace
  `accessName` → no match → `unknown`. **For the `access` fallback kind only,**
  the literal placeholder `"this access"` (the `describeAccess` sentinel used
  when `summary?.access?.name` is absent, `certifications.ts` line 195) is also
  treated as a non-matching name → no match → resolves via history or `unknown`.
  This guard applies only to the name-only `access` fallback; typed items are
  matched on name + type and are unaffected.
- Request `name`/`type`, event `accessItem.displayName`/`accessItemType`:
  **optional** sub-fields (each is `?`), so treat missing as non-matching; never
  assume presence. Note the event's **`accessItem` parent is required** (present
  by contract); only its `displayName?` needs guarding — do not guard
  `accessItem` itself.
- Approval `status`, `modified`, `comment`, `requester.name`,
  `requesterComment.comment`: **optional** → default to `null`/`unknown` in the
  VM. No limits enforced (display-only); long comments are the UI's layout
  concern (CSS clamp), not a validation failure.
- `xSailPointExperimental`: literal `'true'` string, always sent for the history
  call.

On any validation miss the behavior is **degrade**, never throw.

---

## 8. Invariants and ownership

- **"UI never sees raw DTOs"** — owned by the data layer
  (`provenance.ts`), same contract as `certifications.ts`. The mapper is the only
  place DTOs are read; everything downstream consumes `AccessProvenanceVM`.
  Enforced here because it is the single choke point and keeps components
  jargon-free.
- **"One fetch per identity (per campaign)"** — owned by the resolver's promise
  cache. Enforced at the resolver (not the hook) so any future caller gets the
  same dedupe. The cache boundary is **one resolver instance per campaign**:
  since `CampaignRoute` has no `key` and does not remount on a campaign switch,
  the hook does **not** rely on unmount to clear the cache. Instead `useProvenance`
  recreates the resolver in an effect keyed on
  `[campaignId, accessRequestsApi, identityHistoryApi]` (§4), so switching
  campaigns starts a fresh promise cache and no identity shared between campaigns
  returns a stale promise.
- **"Provenance never blocks or alters decisions"** — owned by `useProvenance`
  being a separate hook from `useReviewItems`; the queue renders and is
  interactive from the list load alone.
- **"No fabricated mechanism"** — owned by the mapper's decision order, which
  only emits `role`/`request` on positive evidence and otherwise emits honest
  `direct`/`unknown`.

---

## 9. Testability

- **Unit (pure, no I/O):**
  - `toProvenanceVM` — every decision branch: role item (`accessKind==='role'`);
    request match with a multi-step approval chain; history-only `request`
    (governance `type==='accessRequest'`, or `accessRequest.requesterName`
    populated, but no request row paired); history-only `direct` (access-added
    event, no request signal); no-data `unknown`; and `historyUnavailable`
    wording. **Request-signal predicate test (required):** an event whose
    `accessRequest` **object exists but is empty** (no `requesterId`/
    `requesterName`) and whose `governanceEvent` is null or
    `type==='certification'` must resolve to **`direct`, not `request`** — this
    pins the §3c `hasRequestSignal` rule and guards against the
    always-true-`if (event.accessRequest)` regression. Assert history **never**
    emits `role`. Crafted DTO fixtures.
  - The matcher — name/type case-insensitive match, multi-match "most recent
    `created`" tie-break, `access` fallback name-only match, no-match, and the
    **sentinel guard**: an `access`-fallback item whose `accessName` is the
    placeholder `"this access"` (or empty/whitespace) must **not** match a request
    row — even one literally named `"this access"` — and must resolve to history
    or `unknown`.
  - The `ManualWorkItemState` → decision mapping.
- **Unit (with fakes):**
  - `createProvenanceResolver` — asserts **one** call per identity across
    repeated `forIdentity`, parallel request+history, that a history 400/403
    yields `events: null` without failing the request path, that a 401/403 on
    the request fetch yields `requests: []` with `requestsFailedHard === false`,
    and that a 429/5xx/network request failure sets `requestsFailedHard ===
    true`. Use fake API objects exposing the two methods.
  - `useProvenance` — with a fake resolver, assert grouping by identity, no
    per-item fan-out, `loading`→`ready` transitions, `unavailable` only for
    missing `identityId` or `requestsFailedHard`, **no re-run / no `loading`
    flash when a decision mutates `items` but preserves ids** (the `idSig`
    guard), re-resolution when the id set changes, and cancellation on `items`
    change. **Campaign-change reset (required):** rerender the hook with a new
    `campaignId` on the **same** instance (no remount — mirroring
    `CampaignRoute`'s keyless re-render) and assert the resolver is recreated and
    `byItemId` is cleared, so an identity shared across campaigns gets a **fresh**
    fetch rather than a stale cached promise (React Testing Library / existing
    test runner).
- **Component:** `AccessProvenance` — badge text per status, disclosure
  `aria-expanded`/`aria-controls` toggling, and the honest empty/degraded copy.
- **Integration:** `ReviewView` renders the queue immediately while provenance
  entries are `loading`, then resolves — proving provenance does not gate the
  list. The existing keep/remove/reassign tests must remain green unchanged.

A design note for the implementer: the resolver's promise-cache dedupe and the
mapper's purity are what make this testable; if either is bypassed (e.g.
fetching inside the component), the design should be revisited.

---

## 10. Files touched

**New**
- `src/sailpoint/provenance.ts` — resolver + matcher + mapper.
- `src/state/useProvenance.ts` — lazy per-identity provenance hook.
- `src/components/AccessProvenance.tsx` + `AccessProvenance.css` — badge +
  disclosure.

**Modified**
- `src/sailpoint/sdkClient.ts` — construct + thread `AccessRequestsApi` and
  `IdentityHistoryApi` (and the `idn:identity-history:read` scope comment).
- `src/sailpoint/types.ts` — add `GrantMechanism`, `ApprovalStepVM`,
  `AccessRequestSummaryVM`, `AccessProvenanceVM`, **`ProvenanceStatus`,
  `ProvenanceEntry`** (the UI-facing status/entry types, declared here so
  components import them from `../sailpoint/types` rather than from a `state/`
  hook); add `identityId` to `ReviewItemVM`.
- `src/sailpoint/certifications.ts` — populate `identityId` in `toReviewItemVM`.
- `src/CertApp.tsx` — in `CampaignRoute`, destructure the two new clients off
  `runtime`, call `useProvenance(accessRequestsApi, identityHistoryApi,
  campaignId, review.items)` (passing the existing `campaignId` prop so the hook
  can reset its resolver on campaign change), and thread `provenanceByItemId`
  into `<ReviewView>`. No `key` is added to `<CampaignRoute>` (the resolver reset
  is handled inside the hook, keeping the route's mount behavior unchanged).
- `src/views/ReviewView.tsx` — add `provenanceByItemId` prop; pass to
  `<ReviewQueue>` (card branch only).
- `src/components/ReviewQueue.tsx` — add `provenanceByItemId` prop; pass each
  item's entry to its `<ReviewItemCard>`.
- `src/components/ReviewItemCard.tsx` — add `provenance?` prop; render
  `<AccessProvenance>` after the priority chips in `.vc-item-text`; keep
  keep/remove/reassign actions unchanged.

**Not touched:** `vite.config.ts`, `sp-ui-plugin.json`, the SDK handshake,
`useReviewItems`'s decision/reassign logic.

---

## Evidence (re-verified against `node_modules/sailpoint-api-client@2.1.28` + repo source)

Client version re-confirmed: `node_modules/sailpoint-api-client/package.json`
→ `"version": "2.1.28"`.

**Access requests** (`dist/access_requests/api.d.ts`):
- Class method `AccessRequestsApi.listAccessRequestStatusV1(requestParameters?, axiosOptions?)`
  (`AccessRequestsApi` class declaration line 3432; the object-param class
  method, line 3512; interface mirror line 3122) resolves
  to `AxiosResponse<Array<RequestedItemStatus>>` — `await` and read rows off
  `res.data`.
- Request params `AccessRequestsApiListAccessRequestStatusV1Request`:
  `requestedFor?: string` (single string), `limit?`, `offset?`, `filters?`
  (only `accessRequestId`/`accountActivityItemId`/`created`), `requestState?`
  (only `EXECUTING`) — lines ~3246–3306.
- `RequestedItemStatus`: `name` (~2152), `type` `RequestedItemStatusTypeEnum`
  (line 2157; enum values `ACCESS_PROFILE`/`ROLE`/`ENTITLEMENT` at line 2329),
  `created` (~2190), `requester` (~2196), `requesterComment` (~2214),
  `approvalDetails: Array<ApprovalStatusDto>` (~2160).
- `ApprovalStatusDto` (line 827): `currentOwner` (~888), `modified: string|null`
  (~851), `status: ManualWorkItemState` (~857), `comment: string|null` (~875).
- `ManualWorkItemState` (line ~1763): `PENDING`/`APPROVED`/`REJECTED`/`EXPIRED`/
  `CANCELLED`/`ARCHIVED` (all six confirmed — mapper maps the last three to
  `unknown`).

**Identity history** (`dist/identity_history/api.d.ts`):
- Class method `IdentityHistoryApi.getHistoricalIdentityEventsV1(requestParameters, axiosOptions?)`
  (`IdentityHistoryApi` class declaration line 2348; the object-param class
  method, line 2375 — not a `.js` body line) resolves to
  `AxiosResponse<Array<GetHistoricalIdentityEventsV1200ResponseInner>>` —
  `await` and read rows off `res.data`, matching the request client. (Lower-level
  positional/functional forms at 1551/1697 are NOT used.) The experimental
  header is auto-applied: the client impl (`dist/identity_history/api.js`)
  defaults `xSailPointExperimental` to `'true'` and always sets the
  `X-SailPoint-Experimental` header, so the request param alone is sufficient.
- Request params `IdentityHistoryApiGetHistoricalIdentityEventsV1Request` (line
  ~2007): `id: string` (required), `from?`, `eventTypes?: Array<string>`,
  `accessItemTypes?: Array<string>`, `limit?`, `offset?`, `count?`,
  `xSailPointExperimental?: string` — all confirmed on the interface.
- Event DTO `GetHistoricalIdentityEventsV1200ResponseInner` (line 1041):
  `eventType?: string` (~1079), `dateTime?: string` (~1085),
  `accessItem: AccessItemAssociatedAccessItem` (~229) with `displayName?`
  (~274), `governanceEvent: CorrelatedGovernanceEvent | null` (~235),
  `accessItemType?` (enum `GetHistoricalIdentityEventsV1200ResponseInnerAccessItemTypeEnum`,
  values `account|app|entitlement|role|accessProfile`, line ~1139),
  `accessRequest: AccessRequestResponse2` (~1127).
- `CorrelatedGovernanceEvent` (line 931): `type?: CorrelatedGovernanceEventTypeEnum`
  (values `certification`/`accessRequest`, line ~977), `name?`, `dateTime?`,
  `governanceId?`, `reviewers?`, `decisionMaker?`.
- Root exports of both APIs — `dist/index.d.ts` lines 119, 162 (re-exported as
  `AccessRequestsApi` / `IdentityHistoryApi` from the package root).

**Certification join key** (`dist/certifications/api.d.ts`):
- `CertificationIdentitySummary.identityId?: string` (line 256) — the join key
  read in `toReviewItemVM`.

**Repo source (paths/wiring/tokens re-verified this pass):**
- `src/sailpoint/sdkClient.ts` — `PluginRuntime` + `initPlugin` construct
  `certificationsApi`/`summariesApi`/`searchApi` from one `Configuration`; the
  two new clients slot in identically.
- `src/sailpoint/certifications.ts` — `FriendlyError`/`toFriendlyError`,
  `describeAccess`/`toReviewItemVM` (the mapper to extend with `identityId`).
- `src/state/useReviewItems.ts` — the `cancelled`-flag effect pattern reused by
  `useProvenance`; left otherwise untouched.
- `src/CertApp.tsx` — `CampaignRoute` destructures `runtime` and calls
  `useReviewItems`; the wire point for `useProvenance`.
- `src/views/ReviewView.tsx` (⚠ `views/`, not `components/`),
  `src/components/ReviewQueue.tsx`, `src/components/ReviewItemCard.tsx` — the
  props chain in §5.0; the card body `.vc-item-text` / `.vc-chips` insertion
  point.
- `src/components/WhyThisOrder.tsx` — the `useId()` + `aria-expanded`/
  `aria-controls` disclosure pattern mirrored by `AccessProvenance`.
- `src/index.css` — confirmed tokens: `--vc-accent`, `--vc-accent-bg`,
  `--vc-surface-alt`, `--vc-text-muted`, `--vc-warn`, `--vc-warn-bg`; the
  `.vc-chip` class is defined in `ReviewItemCard.css`.

---

## Open assumptions (remaining after the tightening pass)

The tightening pass **resolved** the earlier doubts about client surface area:
the class method shapes, the `xSailPointExperimental` request param, the
`requestedFor: string` param, the DTO field names
(`accessItem.displayName`, `governanceEvent | null`, the enum values for
`type`/`accessItemType`/`ManualWorkItemState`), the `identityId` join key, and
every repo path/prop/token in §5.0 are now verified against the installed
`2.1.28` client and the current source — not assumed. What remains genuinely
uncertain:

1. **History event-type literal (unchanged — still open).** `eventType` is a
   plain `string` on `GetHistoricalIdentityEventsV1200ResponseInner`, so the
   exact value for an "access added" event is **not enum-pinned** and cannot be
   confirmed from the type definitions alone. **Design decision:** the resolver
   does NOT hard-filter on a guessed `eventTypes` literal that could silently
   exclude everything. It passes `eventTypes: ['AccessAddedEvent']` as a *hint*
   but the matcher does not depend on the literal — it matches on
   `accessItem.displayName` + `accessItemType` and reads `governanceEvent`,
   which works regardless of the exact `eventType` string. If an empty result
   is observed in testing, the implementer should drop the `eventTypes` filter
   entirely and filter client-side. Behavior degrades safely either way (history
   is an enhancement).
2. **Request-vs-direct from history (tenant-data dependent, acceptable).**
   History is used only to distinguish "a request existed" from "assigned
   directly" by reading `governanceEvent.type` (`certification` | `accessRequest`
   — the only two values) and the `accessRequest` payload. The fields are
   verified to exist and are typed; what is not guaranteed is that every tenant's
   data populates them unambiguously for every grant. When ambiguous the mapper
   emits `direct`/`unknown` rather than guessing. **History is never used to
   emit `role`** — the `2.1.28` DTOs carry no field encoding "entitlement
   granted via a role" (Finding 1); that is a locked limitation, not an open
   assumption. This is consistent with scope and the "no fabricated mechanism"
   invariant.
3. **`unavailable` vs honest `unknown` — RESOLVED (no longer open).** The rule
   is now locked in §4 and §6: the mapper **always** produces a `ready` VM
   (honest `unknown`/`direct`) for every degraded path, and `unavailable` is
   reserved for exactly two cases — a missing/empty `identityId` (no call made)
   and a hard request-fetch failure (`requestsFailedHard`, i.e. 429/5xx/network).
   History unavailability and 401/403 on the request fetch both stay `ready`.
   There is no remaining product choice here.

---

## Responses to design review — pass 1 (`design-review.json` / `design-review.md`, 3 MEDIUM / 4 NIT)

Verdict was CHANGES_REQUESTED (0 HIGH, 3 MEDIUM, 4 NIT). All seven findings are
addressed below. The two DTO claims the MEDIUMs hinge on were independently
re-verified against the installed `2.1.28` client and against
`src/state/useReviewItems.ts` before editing.

- **Finding 1 (MEDIUM — history "via role" has no trigger) — ADDRESSED.**
  Confirmed in `node_modules`: `CorrelatedGovernanceEventTypeEnum` is exactly
  `certification | accessRequest`, and `AccessRequestResponse2` carries only
  `requesterId`/`requesterName`/`items` — nothing encodes "entitlement via a
  role." §3c step 3 is rewritten as **request-vs-direct only**: `governanceEvent`
  null or `type==='certification'` with no `accessRequest` → `direct`; a
  governance `accessRequest` signal with no paired request row → `request` (empty
  approvals); otherwise `unknown`. §2 adds a locked "known limitation" stating
  `role` is emitted only when the reviewed item is itself a role; the Overview
  and open-assumption #2 are reworded to match.

- **Finding 2 (MEDIUM — effect re-runs on every decision) — ADDRESSED.**
  Confirmed `applyDecision`/`applyReassign`/`revertDecision` each `.map()` a new
  `items` array while preserving ids. §4 now keys the effect on a memoized
  **`idSig`** (joined item-id set), not the array reference, so decisions do not
  re-run the effect or flash `loading`; a defensive guard also forbids
  downgrading a `ready`/`loading` entry back to `loading`. Re-resolution happens
  only when the id set changes (campaign change / `reload`). The stale-cards
  interaction note is rewritten accordingly, and a hook unit test is added.

- **Finding 3 (MEDIUM — `unavailable` vs `unknown` ambiguous) — ADDRESSED.**
  One rule now stated in §4, §6, and open-assumption #3 (now marked RESOLVED):
  `unavailable` **only** for missing/empty `identityId` or a hard request-fetch
  failure; everything else is `ready` with an honest `unknown`/`direct`. The
  resolver carries a `requestsFailedHard` flag (set only on 429/5xx/network) to
  drive this; the §6 table rows were rewritten and the "or if we choose to flag
  it" wording removed.

- **Finding 4 (NIT — null-type request-row wording) — ADDRESSED.** §3b reworded:
  a null-`type` request row satisfies matching only for items reviewed as kind
  `access` (name-only); for typed items it is non-matching and never routes into
  the `access` fallback.

- **Finding 5 (NIT — AxiosPromise vs AxiosResponse phrasing) — ADDRESSED.** Both
  clients are now described uniformly as "class method resolves to
  `AxiosResponse<Array<...>>`; `await` and read rows off `res.data`" in §3a and
  the Evidence section, matching the `certifications.ts` pattern.

- **Finding 6 (NIT — belt-and-braces header) — ADDRESSED.** The redundant
  `axiosOptions` header clause is removed from §3a; the design now states the
  `xSailPointExperimental: 'true'` request param alone guarantees the
  `X-SailPoint-Experimental` header (client defaults + always sets it).

- **Finding 7 (NIT — aria-live optional) — ADDRESSED.** `aria-live="polite"` on
  the badge container is now a requirement in §5a and the Accessibility
  invariants; the loading placeholder reserves equal height to avoid shift.

---

## Responses to design review — pass 2 (`design-review.json` / `design-review.md`, 0 HIGH / 2 MEDIUM / 5 NIT)

Second review verdict was CHANGES_REQUESTED (0 HIGH, 2 MEDIUM, 5 NIT). Every
HIGH/MEDIUM finding is resolved; the NITs are addressed or, in one case, shown
to be based on an incorrect line reading. Each DTO/line claim below was
re-verified against the installed `2.1.28` client this pass (not taken on the
review's word).

- **Finding 1 (MEDIUM — "`accessRequest` payload" is an undefined predicate,
  §3c step 3) — ADDRESSED.** Re-verified: `accessRequest: AccessRequestResponse2`
  is **required/non-optional** on the event DTO (`identity_history/api.d.ts`
  line 1127), with only `requesterId?`/`requesterName?`/`items?` optional
  (~656–676). §3c step 3 now defines an explicit, truth-testable
  **`hasRequestSignal`** predicate —
  `governanceEvent?.type === 'accessRequest' || Boolean(event.accessRequest?.requesterId ?? event.accessRequest?.requesterName)`
  — and routes `true → request` (empty approvals, `requestedBy =
  accessRequest.requesterName ?? null`), everything else → `direct`. The vague
  "or the event carries an `accessRequest` payload" clause is gone. §9 adds the
  required mapper unit test: an event with an **empty** `accessRequest` object
  must resolve to `direct`, not `request`.

- **Finding 2 (MEDIUM — `ProvenanceStatus`/`ProvenanceEntry` type home + import
  direction unspecified, §4/§5.0) — ADDRESSED.** Both types are now **declared
  in `src/sailpoint/types.ts`** alongside `AccessProvenanceVM` (new block in
  §2). §4 shows `useProvenance.ts` importing them from `../sailpoint/types`
  (no longer declaring them). §5.0 states all three components
  (`ReviewView`, `ReviewQueue`, `ReviewItemCard`) import `ProvenanceEntry` from
  `../sailpoint/types`, preserving the repo's one-directional
  component→`sailpoint/types` import flow (no component→`state/` dependency).
  §10's `types.ts` "Files touched" entry now lists `ProvenanceStatus` and
  `ProvenanceEntry` as added there.

- **Finding 3 (NIT — resolver input wording, §3a) — ADDRESSED.** §3a now says
  `requestedFor` is set to the **`identityId` argument passed to `forIdentity`**
  (a plain string, sourced by the hook from `ReviewItemVM.identityId`); the
  resolver never sees `identitySummary`.

- **Finding 4 (NIT — name vs displayName matching, §3b) — ADDRESSED.** §3b adds
  an explicit "accepted degrade" callout: `accessName` (from
  `entitlement/role/accessProfile.name`) vs event `accessItem.displayName` may
  legitimately differ, so a history no-match is **expected, not a bug**,
  mirroring the Open-assumptions framing for the `eventType` literal.

- **Finding 5 (NIT — `index.d.ts` line citation) — CORRECTED, review was
  mistaken.** Re-verified against `dist/index.d.ts`:
  `119:export { _AccessRequestsApi as AccessRequestsApi };` and
  `162:export { _IdentityHistoryApi as IdentityHistoryApi };`. The
  `IdentityHistoryApi` export is at line **162** — exactly what the design
  already cited; the review's suggested "line 160" is off by two. The design
  retains 162 and §1 now quotes both export lines verbatim so the citation is
  self-evidently correct.

- **Finding 6 (NIT — `getHistoricalIdentityEventsV1` method-line wording,
  Evidence) — ADDRESSED.** The imprecise "method body line 2375" phrasing is
  replaced with "the object-param **class method**, line 2375 — not a `.js` body
  line" (and the same precision applied to the `listAccessRequestStatusV1`
  citation). Line 2375 is confirmed to be the class method resolving to
  `AxiosResponse<GetHistoricalIdentityEventsV1200ResponseInner[]>`.

- **Finding 7 (NIT — `accessItem` nullability, §3b/§7) — ADDRESSED.** Re-verified
  `'accessItem': AccessItemAssociatedAccessItem` is **required** (line 1101, no
  `?`); only `displayName?` is optional. §3b now says to guard **`displayName`**
  and **not** `accessItem` (present by contract); §7's event-input bullet is
  reworded to `accessItem.displayName`/`accessItemType` optional sub-fields with
  the parent `accessItem` noted as required.

---

## Responses to design review — pass 3 (`design-review.json` / `design-review.md`, 0 HIGH / 1 MEDIUM / 2 NIT)

Third review verdict was CHANGES_REQUESTED (0 HIGH, 1 MEDIUM, 2 NIT). All three
findings are resolved below; the two repo-source claims the fixes hinge on were
re-verified against the live source this pass.

- **Finding 1 (MEDIUM — resolver cache "resets on new campaign" is false;
  `CampaignRoute` never unmounts on a campaign switch) — ADDRESSED.** Verified in
  `src/CertApp.tsx` that `<CampaignRoute … campaignId={route.campaignId} … />`
  carries **no `key` prop**, so a campaign switch changes the `campaignId` prop
  and re-renders the same instance (as `useReviewItems` already assumes) rather
  than remounting — the `useRef` resolver and its `Map` would persist and return
  stale promises for identities shared between campaigns. Applied the preferred
  fix (not the wider-blast-radius `key` option): §4 changes the hook signature to
  `useProvenance(accessRequestsApi, identityHistoryApi, campaignId, items)` and
  recreates the resolver (and clears `byItemId`) in an effect keyed on
  `[campaignId, accessRequestsApi, identityHistoryApi]`, explicitly stating the
  reset does **not** rely on unmount. §8's "one fetch per identity" invariant is
  reworded to "one fetch per identity (per campaign)" with the same mechanism;
  the §4 wire-point and §10 Files-touched entry now pass `campaignId` through from
  `CampaignRoute`, and §9 adds a required campaign-change reset test.

- **Finding 2 (NIT — "CSS-module-per-component" phrasing is inaccurate) —
  ADDRESSED.** Verified there are no `*.module.css` files and `.vc-chip` is a
  global class in `ReviewItemCard.css`. The Technology-stack section is reworded
  to "global per-component stylesheets with globally shared class names"
  (`import './X.css'`, no CSS Modules). §5a now notes the `.vc-chip` cross-file
  coupling and takes the optional fix — redeclaring the `.vc-chip` rule in the new
  `AccessProvenance.css` so the badge styling is self-contained.

- **Finding 3 (NIT — access-kind fallback can match the literal placeholder
  `"this access"`) — ADDRESSED.** Verified `describeAccess` in
  `certifications.ts` (line 195) sets the `access`-fallback name to
  `summary?.access?.name ?? 'this access'`. §3b now adds a locked sentinel/empty
  guard: for the name-only `access` fallback, `accessName.trim().toLowerCase() ===
  'this access'` (and empty/whitespace) is treated as **non-matching**, so a
  request row literally named `"this access"` cannot produce a false match; the
  item resolves via history or honestly to `unknown`. §7's `accessName` bullet and
  the §9 matcher tests document and pin this guard.
