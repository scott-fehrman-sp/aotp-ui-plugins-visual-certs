# Access-Review Decision-Support Context — API Availability Investigation

**Scope:** Read-only investigation. No plugin code changed. Goal: determine
concretely which SailPoint APIs (via the installed `sailpoint-api-client@2.1.28`
in `node_modules`, plus the ISC public API docs) can supply the decision-support
context a certification reviewer needs for each access-review item.

**Evidence base:**
- Installed client: `node_modules/sailpoint-api-client` version `2.1.28`
  (`node_modules/sailpoint-api-client/package.json`).
- All `file:line` citations below are from `.d.ts` files under
  `node_modules/sailpoint-api-client/dist/`.
- Doc URLs are from `developer.sailpoint.com`. Content from search results was
  rephrased for compliance with licensing restrictions.

---

## Summary answer (TL;DR)

| # | Reviewer question | Best data source (installed client) | Confidence |
|---|---|---|---|
| 1 | WHY do they have it? (business reason / description) | What's already on the item (`description`, `owner`) + `IdentityHistoryApi.getHistoricalIdentityEventsV1` (`governanceEvent`, `accessRequest`) + access-request `requesterComment` | **PARTIAL** — no single "business reason" field; assembled from justification/approval context |
| 2 | WHEN did they get it? | `IdentityHistoryApi.getHistoricalIdentityEventsV1` (AccessAdded event `dateTime`) and `AccessRequestsApi.listAccessRequestStatusV1` (`created`) | **CONFIRMED** (events API is experimental) |
| 3 | Do their PEERS have it? | `SearchApi.searchPostV1` on the `identities` index, nested access query + peer filter (manager/department) + `count:true` → `X-Total-Count` header | **CONFIRMED** (pattern proven in sibling org-graph plugin) |
| 4 | Did they get it via a ROLE? (how granted) | `IdentityHistoryApi.getHistoricalIdentityEventsV1` + `SearchApi` identities index nested `access` entries (`type: ROLE` vs `ENTITLEMENT`, standalone vs via-role) | **PARTIAL** — assignment mechanism is inferable, not a single clean flag |
| 5 | Via ACCESS REQUEST, and WHO APPROVED it? | `AccessRequestsApi.listAccessRequestStatusV1` → `RequestedItemStatus.requester` + `approvalDetails[].currentOwner`/`comment`/`status` | **CONFIRMED** |

**Join keys available off a certification item** (confirmed below): the identity
id (`identitySummary.identityId`), the access id (`accessSummary.access.id` and
the typed `entitlement.id` / `role.id` / `accessProfile.id`), the access name and
type, and the source id/name for entitlements. These are sufficient to key every
API above **except** that none of the access-request / history / peer APIs accept
a server-side filter on a *specific* entitlement/role id — so in several cases
the plugin must fetch per-identity and match client-side by access name+type.

**Scope note:** The manifest declares `apiScopes: ["sp:scopes:all"]`
(`sp-ui-plugin.json`), which is broad and almost certainly sufficient. The one
call-out is the identity-history endpoint, which the docs tie to the
`idn:identity-history:read` scope and require an experimental header — see Q2.

---

## Join keys a certification review item gives us

Read from `node_modules/sailpoint-api-client/dist/certifications/api.d.ts`.

**`AccessReviewItem`** (line 21) is thin, exactly as noted in the brief: it has
`accessSummary`, `identitySummary`, `id`, `completed`, `newAccess`, `decision`,
`comments` (lines 21–63). The usable ids live in its two sub-objects.

**`CertificationIdentitySummary`** (line 238):
- `id` (summary id) — line ~243
- `name` (identity display name) — line ~249
- **`identityId`** — "The ID of the identity being certified" (line ~257). **This
  is the join key to every identity-scoped API** (`requestedFor`, history `id`,
  peer search, `getIdentityV1`).
- `completed` — line ~263

**`AccessSummaryAccess`** (line 101) — the generic access reference present on
every item:
- `type` (`DtoType`) — line ~106
- **`id`** — "The ID of the item being certified" (line ~112)
- **`name`** — line ~118

**`AccessSummary`** (line 70) carries exactly one of:
- `entitlement?: ReviewableEntitlement | null` (line ~82)
- `accessProfile?: ReviewableAccessProfile` (line ~88)
- `role?: ReviewableRole | null` (line ~94)

**`ReviewableEntitlement`** (line 980) exposes the richest join keys:
- `id` (entitlement id, line ~985), `name`, `description` (nullable),
- `sourceId` (line ~1057), `sourceName`, `sourceType`,
- `attributeName` / `attributeValue` (the raw entitlement value),
- `owner` (`IdentityReferenceWithNameAndEmail`),
- `account` (`ReviewableEntitlementAccount`) with `nativeIdentity`,
  `created`/`modified` of the **account** (not the grant), and
  `activityInsights.usageDays`.

**`ReviewableRole`** (line 1203): `id`, `name`, `description`, `owner`,
`endDate`, and nested `accessProfiles[]` / `entitlements[]`.

**`ReviewableAccessProfile`** (line 913): `id`, `name`, `description`, `owner`,
`created`, `modified`, `endDate`, nested `entitlements[]`.

**Conclusion on join keys:** We reliably have `identityId` + an access `id` +
access `name` + `type` (and `sourceId`/`sourceName` for entitlements). That is
enough to call every API in this report. The limitation is on the *query* side,
not the *key* side: the access-request and history APIs filter by **identity**,
not by a specific access id, so the plugin fetches the identity's requests/events
and matches the row whose name/type equals the item's access.

---

## Q1 — WHY does this person have the access?

**Finding: PARTIAL.** There is no single "business justification" field for a
*currently-held* access. The reviewer-facing "why" has to be assembled from three
sources, in order of usefulness:

1. **Already on the item (no extra call):** `ReviewableEntitlement.description` /
   `ReviewableRole.description` / `ReviewableAccessProfile.description`
   (`certifications/api.d.ts` lines ~1004, ~1227, ~930) and the access `owner`
   (`IdentityReferenceWithNameAndEmail`). The plugin already surfaces
   `accessDescription` (`src/sailpoint/certifications.ts`, `describeAccess`). The
   *owner* is new context worth showing ("who owns/approves this access").

2. **Original request justification (when it was requested):**
   `AccessRequestsApi.listAccessRequestStatusV1` → `RequestedItemStatus`
   - `requesterComment` (`RequestedItemStatusRequesterComment`): `comment`,
     `created`, `author` (`access_requests/api.d.ts` lines 2511–2529) — this is
     the closest thing to a stated business reason.
   - `requestType` (`AccessRequestType`), `description` (line ~2271).

3. **Governance narrative:** `IdentityHistoryApi.getHistoricalIdentityEventsV1`
   → `governanceEvent` (`CorrelatedGovernanceEvent`, `identity_history/api.d.ts`
   lines 931–974): `name`, `type`, `dateTime`, `reviewers`/`decisionMaker` —
   i.e. "granted via certification X, decided by Y" or "via access request Z".

- **(a) Class + method:** `AccessRequestsApi.listAccessRequestStatusV1`;
  `IdentityHistoryApi.getHistoricalIdentityEventsV1`.
- **(b) Params / derivable:** both keyed by `identityId`
  (`identitySummary.identityId`). No access-id filter → match by access
  name/type client-side.
- **(c) Response fields:** `requesterComment.comment`, access `owner`,
  `description`, `governanceEvent`.
- **(d) Confidence:** PARTIAL — assembled, not a single field. Description/owner
  are CONFIRMED on the item; request justification exists only if the access was
  *requested* (birthright/role-criteria grants have no requester comment).
- **(e) Scopes:** covered by `sp:scopes:all`; history endpoint caveat (Q2).

---

## Q2 — WHEN did they get the access?

**Finding: CONFIRMED (via an experimental endpoint).**

The item itself does **not** carry a grant date. `ReviewableEntitlementAccount`
has `created`/`modified` (`certifications/api.d.ts` lines ~1140–1155) but those
describe the *account*, not the entitlement grant, and `startDate`/`removeDate`
on history/request DTOs only populate for *future-dated* requests — so they are
not a reliable "granted on" date.

**Primary source — `IdentityHistoryApi.getHistoricalIdentityEventsV1`:**
- Returns `GetHistoricalIdentityEventsV1200ResponseInner[]`
  (`identity_history/api.d.ts` line 1041) with `eventType` (line ~1083),
  **`dateTime` — "the date of event"** (line ~1089), `accessItem`
  (`AccessItemAssociatedAccessItem`), `accessItemType`, and `accessRequest`.
- **Params** (`IdentityHistoryApiGetHistoricalIdentityEventsV1Request`, line
  2008): `id` (identity id, line ~2014), `eventTypes?` (line ~2026 — e.g.
  `AccessAddedEvent`), `accessItemTypes?` (line ~2032 — e.g. `entitlement`,
  `role`), paging, and **`xSailPointExperimental`** (line ~2056).
- **Evidence it answers "when granted":** filter `accessItemTypes=entitlement`
  with `AccessAddedEvent`/`AccessRemovedEvent`; the `dateTime` of the add event
  is the grant date. Confirmed by ISC docs — the identity-history events endpoint
  is the recommended way to retrieve per-identity access add/remove history
  ([get-historical-identity-events](https://developer.sailpoint.com/docs/api/get-historical-identity-events-v-1),
  [community guidance](https://developer.sailpoint.com/discuss/t/how-can-we-retrieve-historical-identity-entitlement-additions-and-removals-through-data-share-or-api/219526)).
  Content rephrased for compliance.

**Secondary source — `AccessRequestsApi.listAccessRequestStatusV1`:**
`RequestedItemStatus.created` (`access_requests/api.d.ts` line ~2217) is "when the
request was created" — a reliable grant date **for access that was requested**.

- **(a) Class + method:** `IdentityHistoryApi.getHistoricalIdentityEventsV1`
  (primary); `AccessRequestsApi.listAccessRequestStatusV1` (secondary).
- **(b) Params / derivable:** `id` = `identitySummary.identityId`; match the
  returned event/row to the item by access name+type (no per-access filter).
- **(c) Response fields:** `dateTime` + `eventType`; `created`.
- **(d) Confidence:** CONFIRMED for the data; the events endpoint is **beta /
  experimental** and requires `X-SailPoint-Experimental: true`.
- **(e) Scopes:** docs associate the events endpoint with
  `idn:identity-history:read`. `sp:scopes:all` should cover it, but if a tenant
  enforces granular scopes this is the one most likely to need an explicit grant.
  Also, the experimental header must be sent via `axiosOptions.headers` (or the
  `xSailPointExperimental` request param) — a 400 is the symptom if omitted.

---

## Q3 — Do their PEERS have this access?

**Finding: CONFIRMED.** The ISC Search API on the `identities` index answers
"how many / what fraction of this person's peers hold this access", and the
exact pattern is already proven in the sibling **org-graph** plugin.

**Reference pattern (org-graph):**
`/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/org-graph/src/data/sailpoint-directory.ts`:
- Queries `Index.Identities` via `searchApi.searchPostV1({ search: { indices:
  [Index.Identities], query: { query }, sort: [...] }, limit, count: true })`
  (the `search()` and `getReports()` methods).
- **Reads the total off the response header**: `readTotalCount(response.headers)`
  pulls `x-total-count` (works whether headers expose `.get(...)` or a plain
  object). This is the mechanism for a peer *count* without downloading rows.
- Peer grouping is done with identity-attribute queries such as
  `manager.id:"<id>"`, `attributes.department:"<dept>"`,
  `attributes.location:"<loc>"` (`getReports`, `searchDepartment`,
  `searchLocation`). Note org-graph documents that `manager.id` is **not** a
  valid `listIdentitiesV1` filter and only works via Search — so Search is the
  right tool here.

**How to compute the peer fraction for an access item:**
1. Resolve the certified identity's peer axis. Either read `managerRef`
   (`identities/api.d.ts` line 360) / `attributes.department`
   (`attributes` line 378) from the item's identity via
   `IdentitiesApi.getIdentityV1({ id: identityId })` (returns `Identity`,
   `identities/api.d.ts` line 1924), or reuse org-graph's manager/department
   queries.
2. The `identities` index supports **SailPoint-extended nested access queries**:
   `Query.query` is "Elasticsearch Query String … extended by SailPoint to
   support Nested queries" and `Query.innerHit` exists (`search/api.d.ts` lines
   378–402); `Search.includeNested` (line ~507) returns nested access objects.
   Per ISC docs the identities index exposes nested `access` entries filterable
   by `type` (`ROLE`/`ENTITLEMENT`/`ACCESS_PROFILE`), `access.name`, and
   `source.name`, and supports the `@access(...)` nested-query form
   ([nested access/role query](https://developer.sailpoint.com/discuss/t/using-v3-roles-endpoint-to-query-criteria-covered-identity-assignments/186022),
   [entitlement membership search](https://developer.sailpoint.com/discuss/t/is-it-possible-to-search-duplicate-source-entitlements-in-identities/222400)).
   Content rephrased for compliance.
3. Two `searchPostV1` calls with `count: true, limit: 0`:
   - **Denominator:** peers only — e.g. `manager.id:"<managerId>"` (or
     `attributes.department:"<dept>"`).
   - **Numerator:** peers **who also hold the access** — AND the same peer filter
     with the nested access clause, e.g.
     `@access(name.exact:"<accessName>" AND type:"ENTITLEMENT")`.
   - Read `x-total-count` from each response's headers (org-graph's
     `readTotalCount`). The fraction = numerator/denominator → "N of M people
     reporting to the same manager also have this access".

- **(a) Class + method:** `SearchApi.searchPostV1` (and optionally
  `IdentitiesApi.getIdentityV1` to read the peer axis). `SearchApi` is already
  imported and constructed in this plugin (`src/sailpoint/sdkClient.ts`).
- **(b) Params / derivable:** peer axis from the identity (`managerRef` /
  `attributes.department`), access clause from `accessSummary.access.name` +
  `type`. All derivable from the item + one identity read.
- **(c) Response fields:** `X-Total-Count` header (count) and/or `response.data`
  rows for a sample list of peers who share the access.
- **(d) Confidence:** CONFIRMED — the Search index, nested access query, and
  header-count mechanism are all exercised today by org-graph; nested access
  querying on the identities index is documented.
- **(e) Scopes:** `sp:scopes:all` covers Search. **Visibility caveat:** results
  are scoped to what the signed-in reviewer is authorized to see; a manager may
  not be able to enumerate identities outside their span, which can *reduce* the
  peer denominator. Treat the fraction as "among peers the reviewer can see".
  `iai_peer_group_strategies` exists but only offers
  `getPeerGroupOutliersV1` → `PeerGroupMember[]`, which is an outlier/anomaly
  strategy, not a simple "do peers hold X" count — Search is the better fit.

---

## Q4 — Did they get it via a ROLE? (assignment mechanism / how granted)

**Finding: PARTIAL.** The mechanism is **inferable** from two sources, but there
is no single clean "grantedVia = ROLE | DIRECT | BIRTHRIGHT" flag on the
certification item.

What the item gives us for free: the access *type* itself. If
`accessSummary.role` is populated, the item under review **is** a role; a
`ReviewableRole` carries nested `accessProfiles[]` and `entitlements[]`
(`certifications/api.d.ts` lines ~1247–1262) — i.e. what the role bundles. That
tells you the role→entitlement structure but not whether a *given entitlement*
item was received through a role.

To determine how an **entitlement** item was granted:
1. **`SearchApi.searchPostV1` on `identities` index with `includeNested:true`:**
   the identity's nested `access` entries distinguish standalone vs role-derived
   access. ISC docs describe querying the identities index for nested access
   entries by `type` (ROLE vs ENTITLEMENT), including criteria/role-based grants
   ([nested role-assignment query](https://developer.sailpoint.com/discuss/t/using-v3-roles-endpoint-to-query-criteria-covered-identity-assignments/186022)).
   `ListIdentityAccessItemsV1200ResponseInner` (the history list shape,
   `identity_history/api.d.ts` line 1351) exposes `standalone` (line ~1411) which
   indicates whether an access profile stands alone vs is bundled.
2. **`IdentityHistoryApi.getHistoricalIdentityEventsV1`:** the `AccessAddedEvent`
   for the entitlement, plus its `governanceEvent`/`accessRequest`, shows whether
   the add came from a role assignment, a request, or an aggregation/birthright
   source.

- **(a) Class + method:** `SearchApi.searchPostV1` (identities, nested access);
  `IdentityHistoryApi.getHistoricalIdentityEventsV1`.
- **(b) Params / derivable:** identity id + access name/type from the item.
- **(c) Response fields:** nested access `type`/`standalone`; event
  `eventType`/`governanceEvent`.
- **(d) Confidence:** PARTIAL — "is this item itself a role?" is CONFIRMED
  (read `accessSummary.role`); "was this *entitlement* received via a role vs
  directly" is inferable from nested access + history, not a single flag, and
  role-criteria/birthright grants are the fuzziest case.
- **(e) Scopes:** `sp:scopes:all` covers Search; history endpoint caveat (Q2).

---

## Q5 — Via ACCESS REQUEST, and WHO APPROVED it?

**Finding: CONFIRMED.** This is the best-supported of the five.

**`AccessRequestsApi.listAccessRequestStatusV1`** → `RequestedItemStatus[]`
(`access_requests/api.d.ts`, method at line 3122; DTO at line 2139):
- `requester` (`AccessItemRequester`: `id`, `name`, `type` — lines 21–40) → **who
  requested it**.
- `requestedFor` (`RequestedItemStatusRequestedFor`: `id`, `name`, `type` — lines
  2481–2500) → the target identity.
- `approvalDetails` (`Array<ApprovalStatusDto>`, line ~2181) → **approval chain**.
  Each `ApprovalStatusDto` (line 827) has `currentOwner`
  (`ApprovalStatusDtoCurrentOwner`: id/name/type of **who reviewed the request**,
  lines 888–906), `originalOwner`, `forwarded`, `status` (`ManualWorkItemState`,
  i.e. approved/rejected/pending), `comment` (approver's comment, line ~875),
  `modified` (decision time, line ~851), and `scheme` (`ApprovalScheme`).
- `created` (when requested, line ~2217), `requesterComment` (lines 2511–2529),
  `name` + `type` (the requested item, for matching), `state`
  (`RequestedItemStatusRequestState`), `accessRequestPhases` (line ~2265).

**Params** (`AccessRequestsApiListAccessRequestStatusV1Request`, line 3246):
- `requestedFor` — "Filter … by the identity the requests were made for" (line
  ~3252). Set to the item's `identitySummary.identityId` (or `"me"`).
- `regardingIdentity`, `requestedBy`, `assignedTo`, `limit`, `offset`,
  `count`, `filters`, `sorters`, `requestState`.
- **Critical limitation:** the only `filters` fields are `accessRequestId`,
  `accountActivityItemId`, and `created` (line ~3290) — **there is no filter by
  entitlement/role/access id**. So the plugin fetches the identity's requests and
  **matches the row whose `name`+`type` equals the item's access**, then reads its
  requester and `approvalDetails`.

- **(a) Class + method:** `AccessRequestsApi.listAccessRequestStatusV1`. (The
  `listAdministratorsAccessRequestStatusV1` variant, line 3130, returns richer
  admin data but requires `X-SailPoint-Experimental` and admin rights — avoid for
  a manager-reviewer; the non-admin call already returns requester + approvals.)
- **(b) Params / derivable:** `requestedFor = identitySummary.identityId`; match
  by access `name`/`type`. Fully derivable from the item.
- **(c) Response fields:** `requester`, `requesterComment`, `created`,
  `approvalDetails[].currentOwner` / `comment` / `status` / `modified`.
- **(d) Confidence:** CONFIRMED available in this client version (DTO + method
  present at the cited lines). **Data gap:** access that was never *requested*
  (birthright, role-criteria, aggregated, manually added) will have **no**
  `RequestedItemStatus` row — a true "no request on record" finding, not a bug.
- **(e) Scopes:** `sp:scopes:all` covers it. The non-admin endpoint only returns
  requests the signed-in user is authorized to see; a reviewer should be able to
  see requests `requestedFor` an identity they're certifying, but if a tenant
  restricts this, the panel should degrade to "request history not available".

---

## Conclusions and recommendations

1. **The certification item alone is insufficient** for 4 of the 5 questions, but
   every question is answerable (fully or partially) with **additional,
   identity-keyed calls** using ids already on the item
   (`identitySummary.identityId`, `accessSummary.access.id`/`name`/`type`).

2. **No API filters by a specific access id for history/requests.** For Q1, Q2,
   Q4, Q5 the plugin must fetch per-identity and **match client-side by access
   name + type**. Build a small resolver keyed by `(identityId)` that fetches
   requests + events once per reviewed identity and caches them, then matches
   each item — avoids N calls per item for identities with many items.

3. **Strongest wins to build first:**
   - **Q5 (who requested/approved)** — CONFIRMED, single call, high reviewer value.
   - **Q2 (when granted)** — CONFIRMED data; wire the experimental header.
   - **Q3 (peer coverage)** — CONFIRMED; reuse org-graph's `searchPostV1` +
     `x-total-count` pattern almost verbatim.

4. **Set expectations in the UI for the PARTIAL cases (Q1, Q4):** show "Requested
   by / justification" when a request exists, and fall back to the access
   description + owner otherwise. For "how granted", label role-membership items
   plainly and mark entitlement grant mechanism as "via role / direct / assigned"
   only when history or nested-access data makes it unambiguous; otherwise omit
   rather than guess.

5. **Experimental-header plumbing:** `getHistoricalIdentityEventsV1` (Q2/Q4) and
   `listAdministratorsAccessRequestStatusV1` need `X-SailPoint-Experimental: true`.
   Pass it via the method's `axiosOptions` (`{ headers: { 'X-SailPoint-Experimental':
   'true' } }`) or the `xSailPointExperimental` request param. Treat a 400/403
   from these as "context unavailable" and degrade gracefully, consistent with
   the existing `toFriendlyError` approach in `src/sailpoint/certifications.ts`.

6. **New API clients to construct** (alongside the existing `CertificationsApi`,
   `CertificationSummariesApi`, `SearchApi` in `src/sailpoint/sdkClient.ts`):
   `AccessRequestsApi`, `IdentityHistoryApi`, and `IdentitiesApi` — all exported
   from the package root (`dist/index.d.ts` lines 119, 160, 162) and from their
   module subpaths. No new manifest scope is strictly required beyond
   `sp:scopes:all`, but document that Q2's events endpoint maps to
   `idn:identity-history:read` for tenants that later tighten scopes.

7. **Visibility, not just availability:** Q3's peer fraction and Q5's request
   history are both bounded by the signed-in reviewer's authorization. The data
   *exists*; what a given manager can *see* may be narrower. Frame counts as
   "among people you can see" and degrade request/approval panels to a neutral
   "not available" rather than erroring.

### What is NOT available (plainly stated)
- No single **"business reason"** field for currently-held access (Q1) — it must
  be assembled, and is empty for non-requested access.
- No single **"granted via role/direct/birthright"** flag on the item (Q4) — it is
  inferred from nested-access + history.
- No **grant date on the item itself** (Q2) — the account `created`/`modified` are
  not the grant date; use the history events API.
- No **server-side filter by entitlement/role id** on the requests or events APIs
  — matching is client-side by name+type.
