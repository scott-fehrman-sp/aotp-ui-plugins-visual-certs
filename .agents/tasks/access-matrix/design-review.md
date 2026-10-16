# Design Review — Access Expansion Matrix

**Document reviewed:** `access-matrix-design.md` (revision responding to the prior
`design-review.md`, which was `CHANGES_REQUESTED` with findings 1/HIGH, 2/MEDIUM,
3/NIT).

**Review method:** read the design cold, then verified every load-bearing API
and codebase claim against the actual source in the worktree and the installed
`sailpoint-api-client@2.1.28` generated `.d.ts` in the repo's `node_modules`. I
did not run builds or tests (out of scope for a design review).

**Verdict:** APPROVED — no HIGH or MEDIUM findings. Four NITs are recorded below;
none block implementation.

---

## Summary judgment against the four required focus areas

**(a) Expansion semantics → exactly the 6 rows, and an unambiguous role AP/direct
split.** Satisfied. The restated rules are precise, and the arithmetic is
explicit: role rows = (Σ AP entitlement counts) + (count of role-direct
entitlements) = (2 for `foo`) + (1 for `delete`) = 3; plus standalone AP `bar` =
2; plus direct `read@phone` = 1; total 6. The golden table now shows BOTH `foo`
rows (`read`, `write`) carrying `accessProfile='foo'` and the `delete` row blank,
which is the only reading consistent with the design's own role-expansion rule.
The prior HIGH self-contradiction (blank `read` cell) is fixed, and the Fixture
note now explains the design is *correcting* the spec's inconsistency rather than
reproducing it. The role AP-vs-direct split maps cleanly onto two distinct SDK
fields (`Role.accessProfiles` vs `Role.entitlements`); see NIT-2 for the one
caveat on the field's documented semantics.

**(b) All five open questions resolved concretely, not deferred.** Satisfied.
- Q1 dedup: one row per distinct five-**id** tuple; different path prefixes = different
  rows; identical tuples collapse via a `Map`; id-keyed with a name fallback for
  unresolved slots. Decided.
- Q2 blank-cell sort: blanks sort as empty string (first ascending / last
  descending), `localeCompare` with `{ sensitivity: 'base' }`, uniform across all
  five columns, with a fixed tiebreak chain ending in row `id` for total order.
  Decided and pinned to a pure `compareRows`/`sortRows` in `accessMatrixSort.ts`.
- Q3 scope split: ships (a) the matrix view and (b) the pure `deriveAccessGraph`
  data-model function only; explicitly excludes a visual renderer. Decided.
- Q4 caching/concurrent dedupe mirroring provenance: three per-id-space
  `Map<string, Promise<…>>` caches, fetch-at-most-once-per-id, concurrent
  lookups dedupe to one round-trip, resolver recreated on campaign change via a
  `resolverCampaignRef` keyed on an id signature. This mirrors
  `createProvenanceResolver` / `useProvenance` exactly (verified against both
  source files). Decided.
- Q5 CertApp routing: add `'matrix'` to the `CampaignStep` union inside
  `CampaignRoute`, reached by an additive optional `onViewMatrix` button on
  `CampaignDashboard`; no top-level `Route` or `subPath` change. Decided and
  consistent with how `review`/`signoff` steps work today.

**(c) Layering honored.** Satisfied. View-model types go in `types.ts` (matches
the existing decoupled-DTO convention); the data layer `accessMatrix.ts` reuses
`toFriendlyError`/`FriendlyError` from `certifications.ts` and invents no new
error handling; the resolver mirrors `provenance.ts` (per-id promise cache +
soft-degrade); the hook `useAccessMatrix` mirrors `useProvenance` (`useRef`
resolver, `idSig` keying, `cancelled` guard); the three new API clients are added
to `sdkClient.ts` following the exact `accessRequestsApi`/`identityHistoryApi`
pattern (same autoconfigured `Configuration`, package-root class imports); and the
decision to build a dedicated `AccessMatrixView` rather than extend
`DrillDownTable` is well justified — I confirmed `DrillDownTable` is static,
non-sortable, hardwired to `PrioritizedItem[]` with no `aria-sort`/`scope="row"`,
so adapting it would risk regressing its `ReviewView`/dashboard consumer.

**(d) Shallow-vs-deep ref settled against the generated `.d.ts`; honest-degrade
shape specified.** Satisfied. I verified against the actual generated typings:
`Role.accessProfiles?: Array<AccessProfileRef> | null`,
`Role.entitlements?: Array<EntitlementRef>`; `AccessProfileRef = {id?,type?,name?}`
and `EntitlementRef = {type?,id?,name?|null}` are both shallow with no source;
`AccessProfile.entitlements?: Array<EntitlementRef> | null` and
`AccessProfile.source: AccessProfileSourceRef`; `getEntitlementV1` returns
`EntitlementV2` whose `source?: EntitlementV2Source = {id?,type?,name?}`. The
design's conclusion — use `getRoleV1` (preserves AP-vs-direct structure), reject
`getRoleEntitlementsV1` (returns flattened `Entitlement[]`), re-fetch each AP via
`getAccessProfileV1`, and resolve every leaf's source via `getEntitlementV1` — is
correct and matches the SDK. The honest-degrade shape is fully specified: any
per-id failure returns `null`, the row is marked `unresolved:true` with known
names kept and unknown slots blank, a non-fatal `unresolvedCount` banner surfaces,
and the matrix never fails wholesale. The degenerate `access`-kind row is now
fully specified (all slots blank/null except user, contributes only a `user`
graph node, zero edges), closing the prior MEDIUM.

All three prior-review findings (HIGH fixture contradiction, MEDIUM `access`-kind
underspecification, NIT CSS attribution) are genuinely addressed in this revision,
not deferred.

---

## Findings

### NIT-1 — Resolver's model-type import paths are not stated
**Where:** §Technology stack (import convention) and §2 `accessMatrix.ts` resolver.
**Problem:** The design states the convention (API classes from the package root,
model/DTO types from module subpaths) and names the DTOs it uses (`Role`,
`AccessProfileRef`, `EntitlementRef`, `EntitlementV2`, `EntitlementV2Source`,
`AccessSummaryAccess`) but never writes the concrete subpath imports for the
resolver's internal typing. A coder must rediscover that `Role`/`AccessProfileRef`/
`EntitlementRef` live in `sailpoint-api-client/roles/api` and `EntitlementV2`/
`EntitlementV2Source` in `sailpoint-api-client/entitlements/api`. Low risk because
the convention and the existing `provenance.ts`/`certifications.ts` imports make
the pattern obvious.
**Fix:** Add one line to §2a/§2b, e.g.: "Type-only imports:
`import type { Role, AccessProfileRef, EntitlementRef } from 'sailpoint-api-client/roles/api'`
and `import type { EntitlementV2 } from 'sailpoint-api-client/entitlements/api'`;
API classes (`RolesApi`, `AccessProfilesApi`, `EntitlementsApi`) from the package
root."

### NIT-2 — `Role.entitlements` = "directly attached" is an inference, not a documented SDK fact
**Where:** §2a "Which role API to use", claim that `getRoleV1` "preserves the path
structure... we can tell which entitlements come through an AP vs. are attached
directly to the role."
**Problem:** The entire role AP-vs-direct split (and thus the `delete` blank-AP
row in the golden fixture) rests on `Role.entitlements` meaning *role-direct*
entitlements, disjoint from those reachable through `Role.accessProfiles`. The
generated `.d.ts` carries **no doc comment** on `Role.entitlements` to confirm
this. It is the conventional ISC role model and nothing contradicts it, and the
acceptance tests run against stubbed resolver output so test correctness does not
depend on the live semantics — but the design presents the interpretation as a
"Confirmed" fact when it is an (reasonable) inference.
**Fix:** Downgrade the wording from "Confirmed by reading the generated `.d.ts`"
to "The `.d.ts` confirms the two fields exist and are shallow refs; we interpret
`Role.entitlements` as the role's directly-attached entitlements (disjoint from
those reachable via `accessProfiles`), per the ISC role model." Optionally note
that if a leaf ever appears in both the role-direct list and an AP, the five-id
dedup keeps them as separate rows (different `accessProfileId`), which is the
intended "all paths" behavior.

### NIT-3 — "View access map" button placement unspecified when the campaign is complete
**Where:** §7 CertApp integration — "renders a secondary button ... beside the
primary CTA."
**Problem:** `CampaignDashboard` hides its primary CTA entirely when
`allDone` (`{!allDone && <button …>}`, verified in source). "Beside the primary
CTA" is therefore undefined for a completed campaign — the matrix is arguably
*most* useful post-review, so silently dropping the button when the CTA is gone
would be a gap.
**Fix:** State explicitly that `onViewMatrix` renders its own button
unconditionally (independent of the `allDone` CTA guard), e.g. in a dashboard
actions row that is always present, so the matrix stays reachable on a completed
campaign.

### NIT-4 — Dedup prose for "entitlement in a role both directly and via an AP" is loosely worded
**Where:** §Dedup/normalization, second bullet ("...an entitlement that appears in
a role both directly and would otherwise duplicate — collapses to one row").
**Problem:** Under the stated five-**id** key, the same leaf reached role-direct
(`accessProfileId=null`) versus through an AP (`accessProfileId=<id>`) has
different keys and yields **two** rows, not one — which is the correct "all paths"
behavior and matches the first bullet. The parenthetical reads as if such a case
collapses, which contradicts the key definition. Only an *identical* five-id tuple
(same path reached twice) collapses.
**Fix:** Reword to: "collapses only when the full five-id tuple is identical (the
exact same path produced twice); a leaf reached both role-direct and via an AP has
different `accessProfileId` values and correctly stays two rows."

---

## Verified Assumptions (checked against source / generated `.d.ts`)

1. `RolesApi.getRoleV1`, `getRoleEntitlementsV1`, `AccessProfilesApi.getAccessProfileV1`,
   `EntitlementsApi.getEntitlementV1` all exist. ✔ (`dist/{roles,access_profiles,entitlements}/api.d.ts`)
2. `getRoleV1(requestParameters)` returns `AxiosPromise<Role>` (so `getRoleV1({ id })` + `res.data` is correct, matching `certifications.ts` call style). ✔
3. `Role.accessProfiles?: Array<AccessProfileRef> | null` and `Role.entitlements?: Array<EntitlementRef>`. ✔
4. `AccessProfileRef = { id?, type?, name? }` — shallow, no source, no entitlements. ✔
5. `EntitlementRef = { type?, id?, name?|null }` — shallow, no source. ✔
6. `getAccessProfileV1` returns `AxiosPromise<AccessProfile>`; `AccessProfile.entitlements?: Array<EntitlementRef> | null` (shallow) and `AccessProfile.source: AccessProfileSourceRef`. ✔
7. `getEntitlementV1` returns `AxiosPromise<EntitlementV2>`; `EntitlementV2.source?: EntitlementV2Source = { id?, type?, name? }`. ✔ — the per-leaf source re-fetch is genuinely required.
8. `getRoleEntitlementsV1` returns `AxiosPromise<Array<Entitlement>>` (flattened), confirming it loses the AP-vs-direct distinction. ✔ Rejecting it is justified.
9. `RolesApi`, `AccessProfilesApi`, `EntitlementsApi` are exported from the package root (matches `sdkClient.ts` import style). ✔ (`dist/index.d.ts`)
10. `AccessSummary` carries `role?/accessProfile?/entitlement?/access?`, and `ReviewableRole`/`ReviewableAccessProfile`/`ReviewableEntitlement` each expose `id?: string` — so the new `accessId` extraction from `item.accessSummary.{role|accessProfile|entitlement}.id` is feasible. ✔
11. `AccessSummaryAccess = { type?, id?, name? }` — the design's choice NOT to read `access.id` into `accessId` is deliberate and self-consistent. ✔
12. `describeAccess` in `certifications.ts` sets `accessKind` and reads name but not the composition id; extending `ReviewItemVM` with `accessId` and populating it in `toReviewItemVM`/`describeAccess` is a backward-compatible addition. ✔
13. `toFriendlyError`/`FriendlyError` exist in `certifications.ts` with `.status`, reusable exactly as the design states. ✔
14. `provenance.ts` resolver = per-id `Map<string, Promise<…>>` + soft-degrade; `useProvenance` recreates the resolver on `campaignId` change via `resolverCampaignRef` and keys the effect on a stable `idSig` (not the array reference). The design's resolver/hook mirror is accurate. ✔
15. `CampaignStep = 'dashboard' | 'review' | 'signoff'`; `CampaignRoute` calls `useProvenance(... review.items)` and branches on `step`; `subPath` only encodes `campaign/<id>`. The design's integration plan fits. ✔
16. `DrillDownTable` is static/non-sortable, hardwired to `PrioritizedItem[]`, no `aria-sort`/`scope="row"` — the "build a new table" justification holds. ✔
17. `vc-visually-hidden` is defined in `src/components/charts/charts.css`; `vc-table-wrap`/`vc-table` in `DrillDownTable.css`. The prior NIT-3 re-attribution is correct. ✔ (It is globally available because plain CSS imported by always-bundled chart components is not scoped; see note under NIT-2 context — acceptable, non-blocking.)
18. New files (`accessGraph.ts`, `accessMatrix.ts`, `useAccessMatrix.ts`) do not yet exist; co-located `*.test.ts(x)` matches the repo's domain/view test convention. ✔

## Unverified / Wrong Assumptions

- **`Role.entitlements` semantics (role-direct, disjoint from AP-reachable):**
  *Unverified by documentation.* The field exists and is shallow (verified), but
  the generated `.d.ts` carries no doc comment stating it is the role's *directly
  attached* entitlements. The design labels this "Confirmed," which overstates it.
  See NIT-2. Low practical risk (conventional ISC semantics; tests use stubs).
- **"History/runtime" behavior of the APIs (pagination, whether an AP's
  entitlement list or a role's AP list can be large):** not investigated — the
  design uses single-object `getXV1({ id })` calls with no paging, which is
  correct for these endpoints' shapes, but I did not verify there is no capped
  sub-list that would require paging. Not a blocker; flagged only for honesty.
- No wrong assumptions were found. Every concrete API claim the design marked
  "decided/confirmed" that I could check against the `.d.ts` or source held up.
