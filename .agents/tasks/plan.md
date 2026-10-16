# Implementation Plan — Access Provenance ("How they got this")

Derived from the APPROVED design at `.agents/tasks/provenance-design.md` and the
ground-truth API investigation at `.agents/tasks/access-context-investigation.md`.
Scope is locked to Q4 (grant mechanism headline: `role` when the item is a role,
else `request` vs `direct` from the request/history signal, never fabricated —
honest `unknown`/`direct`) + Q5 (access-request justification + approval chain:
requester → approver(s) with status/date/comment), Option A. Do NOT widen to
Q1/Q2-standalone/Q3. Keep keep/remove/reassign unchanged. Do NOT touch
`sp-ui-plugin.json`, `vite.config.ts`, or the SDK handshake beyond constructing
and threading the two new clients.

Project commands (verified against `package.json` and a baseline run):
`npm run build` = `tsc -b && vite build`; `npm test` = `vitest run`
(scope a module with `npx vitest run <path>`); `npm run lint` = `eslint .`.
Baseline is **100 tests passing / 19 files** — keep green and add the tests the
design calls for.

Each task leaves the codebase buildable. Order is by dependency: types first,
then the pure data module, then the hook, then UI, then wiring, then full
verification. Tasks group same-pattern edits (e.g. the props chain) into one item.

- [ ] 1. Add the provenance view-model types to `src/sailpoint/types.ts`.
      Add `GrantMechanism = 'role' | 'request' | 'direct' | 'unknown'`,
      `ApprovalStepVM` (`approver: string|null`, `decision: 'approved'|'rejected'|'pending'|'unknown'`,
      `decidedOn: string|null`, `comment: string|null`), `AccessRequestSummaryVM`
      (`requestedBy`, `requestedOn`, `justification` — all `string|null`),
      `AccessProvenanceVM` (`itemId`, `grantMechanism`, `mechanismLabel`,
      `request: AccessRequestSummaryVM|null`, `approvals: ApprovalStepVM[]`,
      `grantedOn: string|null`, `historyUnavailable: boolean`), plus the UI-facing
      `ProvenanceStatus = 'idle'|'loading'|'ready'|'unavailable'` and
      `ProvenanceEntry = { status: ProvenanceStatus; data: AccessProvenanceVM|null }`.
      Also add a read-only `identityId: string` field to `ReviewItemVM` (join key
      the UI/hook needs). Declaring the status/entry types here (not in the hook)
      preserves the repo's component→`sailpoint/types` import direction.
      Files: `src/sailpoint/types.ts`
      Verify: `npm run build` compiles clean (type-only change; `tsc -b` is the check).

- [ ] 2. Populate `identityId` in the item mapper in `src/sailpoint/certifications.ts`.
      In `toReviewItemVM`, set `identityId: item.identitySummary?.identityId ?? ''`
      (a pure, side-effect-free addition; `describeAccess`/`toFriendlyError` are
      unchanged). This is the only touch to the existing mapper.
      Files: `src/sailpoint/certifications.ts`
      Verify: `npx vitest run src/sailpoint/certifications.test.ts` passes; extend
      that suite (or add a case) asserting a mapped item carries `identityId` from
      `identitySummary.identityId` and `''` when absent.

- [ ] 3. Construct and thread the two new API clients in `src/sailpoint/sdkClient.ts`.
      Add `AccessRequestsApi` and `IdentityHistoryApi` to the package-root import
      (NOT `IdentitiesApi` — that feeds Q3, out of scope). Add
      `accessRequestsApi: AccessRequestsApi` and `identityHistoryApi: IdentityHistoryApi`
      to `PluginRuntime`; in `initPlugin`, after `new SearchApi(configuration)`,
      construct both from the same `Configuration` and include them in the returned
      object. Add a short comment near the `identityHistoryApi` construction noting
      its events endpoint maps to the `idn:identity-history:read` scope for tenants
      that later tighten away from `sp:scopes:all`. No handshake/autoconfigure change.
      Files: `src/sailpoint/sdkClient.ts`
      Verify: `npx vitest run src/sailpoint/sdkClient.test.ts` passes; extend the
      first test to assert `runtime.accessRequestsApi` and `runtime.identityHistoryApi`
      are defined (mirrors the existing `searchApi` assertion).

- [ ] 4. Create the provenance data module `src/sailpoint/provenance.ts` (resolver +
      matcher + mapper). This is one module with three coherent parts; implement all
      three plus their exported types in one task because the hook (task 5) depends
      on the whole surface.
      (a) **Resolver** `createProvenanceResolver(accessRequestsApi, identityHistoryApi): ProvenanceResolver`
      with `forIdentity(identityId): Promise<RawIdentityProvenance>` backed by a
      `Map<string, Promise<RawIdentityProvenance>>` so concurrent calls for one
      identity dedupe to a single round-trip. `RawIdentityProvenance` =
      `{ requests: RequestedItemStatus[]; events: HistoricalEvent[]|null; requestsFailedHard: boolean }`.
      Inside `forIdentity`, run both fetches in parallel (`Promise.all`), each with
      its own catch: `accessRequestsApi.listAccessRequestStatusV1({ requestedFor: identityId, limit: 250 })`
      (read rows off `res.data`); classify failures via `toFriendlyError` — 401/403 →
      `requests: []`, `requestsFailedHard: false`; 429/5xx/network → `requests: []`,
      `requestsFailedHard: true`; the resolver never throws. History:
      `identityHistoryApi.getHistoricalIdentityEventsV1({ id: identityId, eventTypes: ['AccessAddedEvent'], accessItemTypes: ['entitlement','role','accessProfile'], limit: 250, xSailPointExperimental: 'true' })`
      (the request param alone guarantees the `X-SailPoint-Experimental` header);
      any failure (400/403/5xx/network) → `events: null` (history is a non-load-bearing
      enhancement). Import DTO types from the subpaths
      (`sailpoint-api-client/access_requests/api`, `sailpoint-api-client/identity_history/api`),
      never the package root.
      (b) **Matcher** (name + type, case-insensitive, trimmed). Map `accessKind` →
      token: `entitlement→ENTITLEMENT`, `role→ROLE`, `accessProfile→ACCESS_PROFILE`,
      `access→` name-only. Request match: `RequestedItemStatus.name` == item name AND
      `type` == mapped token; prefer most recent `created` on multi-match; a null-`type`
      row matches ONLY the `access` fallback (non-matching for typed items). History
      match: event `accessItem.displayName` == item name (guard `displayName` only;
      `accessItem` is required by contract) AND `accessItemType` == mapped kind.
      **Sentinel guard:** for the `access` fallback, skip matching when
      `accessName.trim().toLowerCase() === 'this access'` or `accessName.trim() === ''`
      → resolve via history or `unknown`.
      (c) **Mapper** `toProvenanceVM(item: ReviewItemVM, raw: RawIdentityProvenance): AccessProvenanceVM`
      — pure, no I/O, never returns/logs raw DTOs. Decision order: (1)
      `item.accessKind === 'role'` → `role`, label "Part of a role"; (2) matching
      request row → `request`, label "Via access request", populate `request` from
      `requester.name`/`created`/`requesterComment.comment` and `approvals` from
      `approvalDetails[]` (`currentOwner.name`→approver, `ManualWorkItemState`→decision
      with `APPROVED→approved`, `REJECTED→rejected`, `PENDING→pending`,
      `EXPIRED`/`CANCELLED`/`ARCHIVED`/unknown→`unknown`; `modified`→`decidedOn`,
      `comment`→`comment`; oldest first); (3) no request but matching history
      access-added event — compute
      `hasRequestSignal = governanceEvent?.type === 'accessRequest' || Boolean(event.accessRequest?.requesterId ?? event.accessRequest?.requesterName)`
      (do NOT test `if (event.accessRequest)` — the object is always present): `true`
      → `request` (empty `approvals`, `requestedBy` from `accessRequest.requesterName`
      when present), else → `direct`, label "Assigned directly", set `grantedOn` from
      event `dateTime`; (4) nothing conclusive → `unknown`, label
      "Granted outside an access request", set `historyUnavailable` true when
      `raw.events === null`. History is NEVER used to emit `role`.
      Files: `src/sailpoint/provenance.ts`
      Verify: `npx vitest run src/sailpoint/provenance.test.ts` passes — see task 6.

- [ ] 5. Create the lazy, non-blocking hook `src/state/useProvenance.ts`.
      Signature: `useProvenance(accessRequestsApi, identityHistoryApi, campaignId, items: ReviewItemVM[]|null): { byItemId: Record<string, ProvenanceEntry> }`.
      Import `ProvenanceStatus`/`ProvenanceEntry`/`AccessProvenanceVM` from
      `../sailpoint/types`. Hold the resolver in a `useRef`; recreate it and clear
      `byItemId` in an effect keyed on `[campaignId, accessRequestsApi, identityHistoryApi]`
      (NOT on unmount — `CampaignRoute` has no `key` and does not remount on campaign
      switch). Compute a stable signature `const idSig = useMemo(() => (items ?? []).map(i => i.id).join('|'), [items])`
      and key the resolve effect on `[idSig]` (plus the stable resolver ref) so
      keep/remove/reassign — which `.map()` a new array but preserve ids — do NOT
      re-run it or flash `loading`. Group items by `identityId`, call
      `resolver.forIdentity` once per identity, then map each item with
      `toProvenanceVM`; set entries `loading`→`ready`. As a defensive guard, never
      downgrade a `ready`/`loading` entry back to `loading`. The mapper always
      yields a VM, so `ready` is the terminal state for every item. **Single
      `unavailable` rule:** only when (i) `identityId` is missing/empty (no API call
      made) or (ii) `raw.requestsFailedHard === true`. Use a `cancelled` flag (like
      `useReviewItems`) so a mid-flight campaign switch does not write stale state.
      Files: `src/state/useProvenance.ts`
      Verify: `npx vitest run src/state/useProvenance.test.ts` passes — see task 6.

- [ ] 6. Write the data-layer + hook tests (design §9) alongside tasks 4–5.
      `src/sailpoint/provenance.test.ts` — matcher: name/type case-insensitive match,
      multi-match "most recent `created`" tie-break, `access` name-only fallback,
      no-match, and the **sentinel guard** (an `access`-fallback item named
      `"this access"` / empty / whitespace must NOT match even a request row literally
      named `"this access"`); mapper DTO→VM for every branch: role item,
      request-match with multi-step approval chain, history-only `request`
      (governance `type==='accessRequest'` or populated `accessRequest.requesterName`,
      no request row), history-only `direct`, and the **empty-`accessRequest`-object
      → `direct` not `request`** case (pins `hasRequestSignal`), no-data `unknown`,
      `historyUnavailable` wording, and that history never emits `role`; the
      `ManualWorkItemState`→decision mapping. Resolver (with fake api objects
      exposing the two methods): one call per identity across repeated `forIdentity`,
      parallel request+history, history 400/403 → `events: null` without sinking the
      request path, request 401/403 → `requests: []` with `requestsFailedHard === false`,
      request 429/5xx/network → `requestsFailedHard === true`, and that the
      experimental param is passed on the history call.
      `src/state/useProvenance.test.ts` (React Testing Library) — grouping by identity
      with no per-item fan-out, `loading`→`ready` transitions, `unavailable` only for
      missing `identityId` or `requestsFailedHard`, **no re-run / no `loading` flash
      when a decision mutates `items` but preserves ids** (the `idSig` guard),
      re-resolution when the id set changes, cancellation on `items` change, and the
      **campaign-change reset**: rerender with a new `campaignId` on the same instance
      (no remount) and assert the resolver is recreated and `byItemId` cleared so a
      shared identity gets a fresh fetch, not a stale promise.
      Files: `src/sailpoint/provenance.test.ts`, `src/state/useProvenance.test.ts`
      Verify: `npx vitest run src/sailpoint/provenance.test.ts src/state/useProvenance.test.ts`
      — all new tests pass.

- [ ] 7. Create the presentational component `src/components/AccessProvenance.tsx` +
      `AccessProvenance.css` (badge + disclosure), taking a single
      `entry: ProvenanceEntry` prop (imported from `../sailpoint/types`).
      **Headline badge (§5a):** `loading` → muted "Checking how they got this…"
      placeholder that reserves the resolved badge's height (no layout jump); `ready`
      → a `.vc-chip` showing `mechanismLabel` ("Via access request" and "Part of a
      role" = accent tone via `--vc-accent`/`--vc-accent-bg`, differentiated by text +
      icon/prefix not color alone; "Assigned directly" and "Granted outside an access
      request" = neutral `--vc-text-muted` on `--vc-surface-alt`); `unavailable` →
      neutral chip "How they got this isn't available". The badge container carries
      `aria-live="polite"` (required). Redeclare the `.vc-chip` rule in
      `AccessProvenance.css` so the badge is self-contained (do not depend on
      `ReviewItemCard.css`'s global class). **Disclosure (§5b):** mirror
      `WhyThisOrder` — a `<button>` with `aria-expanded={open}` /
      `aria-controls={panelId}` (`panelId` from `useId()`), label "How they got this"
      (▸/▾), collapsed by default. Panel content in plain language: when a request
      exists, "Requested by {requestedBy} on {requestedOn}" then each approval step
      "{approver} — {decision} on {decidedOn}" with `comment` beneath and the
      `justification` as a quoted block when present; "Granted {grantedOn}" as a
      secondary line only when non-null; honest empty/degraded copy ("No access
      request on record for this item." for direct/unknown; "We couldn't load how this
      was granted." when `historyUnavailable` and mechanism undetermined). Never show
      raw ids/DTO field names/jargon. Use only existing `--vc-` tokens (no new token
      expected).
      Files: `src/components/AccessProvenance.tsx`, `src/components/AccessProvenance.css`
      Verify: `npx vitest run src/components/AccessProvenance.test.tsx` passes — see task 8.

- [ ] 8. Write the `AccessProvenance` component tests (design §9 "Component").
      `src/components/AccessProvenance.test.tsx` — badge text per status
      (`idle`/`loading`/`ready` for each mechanism label/`unavailable`), disclosure
      `aria-expanded`/`aria-controls` toggling on click, the expanded panel showing the
      requester→approver chain for a request entry, and the honest empty/degraded copy
      for `direct`/`unknown` and `historyUnavailable`.
      Files: `src/components/AccessProvenance.test.tsx`
      Verify: `npx vitest run src/components/AccessProvenance.test.tsx` — all pass.

- [ ] 9. Thread the `provenanceByItemId` prop down the card-view chain (one task —
      same prop added across three files). In `src/views/ReviewView.tsx` add
      `provenanceByItemId: Record<string, ProvenanceEntry>` to `ReviewViewProps`
      (import the type from `../sailpoint/types`) and pass it only into the card
      branch: `<ReviewQueue ordered={ordered} onDecide={onDecide} provenanceByItemId={provenanceByItemId} />`
      (leave the `DrillDownTable` branch unchanged). In `src/components/ReviewQueue.tsx`
      add `provenanceByItemId` to `ReviewQueueProps` and pass
      `provenance={provenanceByItemId[item.id]}` to each `<ReviewItemCard>`. In
      `src/components/ReviewItemCard.tsx` add `provenance?: ProvenanceEntry` to
      `ReviewItemCardProps` and render
      `<AccessProvenance entry={provenance ?? { status: 'idle', data: null }} />`
      inside the `.vc-item-text` block **after** the priority chips `<ul className="vc-chips">`;
      keep the `.vc-item-actions` keep/remove/reassign column untouched.
      Files: `src/views/ReviewView.tsx`, `src/components/ReviewQueue.tsx`, `src/components/ReviewItemCard.tsx`
      Verify: `npx vitest run src/components/ReviewQueue.test.tsx` passes (existing
      queue tests still green with the optional new prop defaulting to `idle`).

- [ ] 10. Wire `useProvenance` into `CampaignRoute` in `src/CertApp.tsx`.
      Extend the destructure to
      `const { certificationsApi, searchApi, accessRequestsApi, identityHistoryApi } = runtime`;
      right after `const review = useReviewItems(certificationsApi, campaignId)` add
      `const provenance = useProvenance(accessRequestsApi, identityHistoryApi, campaignId, review.items)`
      (passing the existing `campaignId` prop so the hook resets its resolver on
      campaign change); pass `provenanceByItemId={provenance.byItemId}` into the
      `<ReviewView … />` element. Do NOT add a `key` to `<CampaignRoute>`; the resolver
      reset is handled inside the hook. Keep/remove/reassign flow unchanged.
      Files: `src/CertApp.tsx`
      Verify: `npm run build` compiles clean; `npx vitest run src/CertApp.test.tsx`
      passes (and add/extend an integration assertion per task 11).

- [ ] 11. Add the integration assertion (design §9 "Integration").
      In `src/CertApp.test.tsx` (or a focused `ReviewView` test), assert the queue
      renders immediately while provenance entries are `loading` and then resolves —
      proving provenance does not gate the list — and confirm the existing
      keep/remove/reassign tests remain green unchanged. Use fake
      `accessRequestsApi`/`identityHistoryApi` objects exposing the two methods.
      Files: `src/CertApp.test.tsx` (and `src/views/ReviewView.tsx` test if added)
      Verify: `npx vitest run src/CertApp.test.tsx` passes; existing decision tests
      unchanged and green.

- [ ] 12. Final full verification and cleanup.
      Run the whole pipeline and confirm nothing regressed: `npm run build` completes
      clean (`tsc -b && vite build`, no type errors); `npm test` (`vitest run`) is
      green with the 100 baseline tests PLUS all new tests from tasks 2, 3, 6, 8, 11
      (file count and test count both up from 19/100); `npm run lint` (`eslint .`) is
      clean. Remove any temp/scratch files created during development. Confirm
      `sp-ui-plugin.json`, `vite.config.ts`, and the SDK handshake were not modified,
      and keep/remove/reassign behavior is unchanged.
      Files: none (verification only)
      Verify: `npm run build` clean, `npm test` all green (100 + new), `npm run lint`
      clean, working tree free of temp files.
