# Access Expansion Matrix + graph derivation

The change adds a normalized, sortable Access Expansion Matrix to the Visual Certifications plugin plus a pure `matrix → graph` derivation for a future bidirectional renderer. It expands each reviewed access (entitlement / access profile / role) into one leaf row per `(user, role, accessProfile, entitlement, source)` path, dedupes identical paths by a five-id tuple, sorts client-side with a documented blank-cell rule, and exposes `deriveAccessGraph` producing a `{ nodes, edges }` model with blank levels skipped. The feature slots into the existing four-layer shape (types → data layer → domain → hook → view → CertApp) and mirrors the provenance resolver/hook conventions. No visual graph renderer was built, which is correct — that is explicitly out of scope. The commit records `npm run build`, `npm run lint`, and `npm test` all PASS (27 files / 166 tests; +5 files / +31 tests over baseline), matching the plan's evidence section.

Watch for: nothing blocking. One cosmetic note on the unresolved-cell marker (below) and one inherited-inference note on role-direct-entitlement semantics, both already acknowledged in the design.

**Verdict**: APPROVED

## High-level view

The expansion lives in `resolveMatrix` (`src/sailpoint/accessMatrix.ts`): an async orchestrator over a cached composition resolver, with a per-item `expandItem` that applies the design's four per-kind rules and a final five-id-tuple dedup `Map`. The pure half is directly testable with a stub resolver, and the test asserts the user's exact 6-row worked example (both `foo` rows filled, `delete` row blank) — faithful to the design's corrected fixture.

The graph derivation (`src/domain/accessGraph.ts`) is a pure, exported, heavily-documented, bidirectional-ready function. It walks each row's present levels, skips blank role/AP levels, dedupes nodes by namespaced id (with name fallbacks that fold source into the entitlement key so same-named entitlements stay distinct), and accumulates `pathCount` per edge. The degenerate all-blank `access` row contributes only a user node and no edges, exactly as specified.

Sorting (`src/domain/accessMatrixSort.ts`) treats blank as empty-string (blanks first ascending, last descending), compares case-insensitively and locale-aware, and applies a fixed tiebreak chain plus row id for a total order — matching the design's pinned rule across all five columns.

Layering is honored: new view-model types in `types.ts`, the data layer reuses `toFriendlyError` and mirrors `provenance.ts` (three per-id promise caches, concurrent dedupe, honest soft-degrade to `null`), the hook mirrors `useProvenance` (resolver recreated on campaign change, effect keyed on a stable id signature), the three API clients were added to `sdkClient.ts` following the existing pattern, and a dedicated `AccessMatrixView` was built with a written justification for not extending `DrillDownTable`.

Accessibility is in place: sortable headers are real `<button>`s inside `<th scope="col">` carrying `aria-sort`, the user cell is `<th scope="row">`, and a visually-hidden caption states the blank-sorts-first convention. CertApp wiring adds a `'matrix'` step reached from an always-present dashboard button without disturbing the existing flow. The required new tests exist and are meaningful; no existing test was weakened or deleted (certifications.test.ts is untouched; sdkClient.test.ts was extended additively).

<details>
<summary>Issues (2)</summary>

1. **Unresolved-cell marker breadth (cosmetic, non-blocking)** — on a fetch-failure `unresolved` row with a known role, the blank AP/entitlement/source cells each render "Unresolved" rather than one marker. This is within the design's "visible Unresolved marker in the affected cells" wording; no action required unless a single-marker presentation is preferred later.
2. **Role-direct-entitlement semantics is an inference (informational, non-blocking)** — treating `Role.entitlements` as role-direct and disjoint from AP-reachable leaves is a design-acknowledged ISC inference, not an SDK-documented fact. Tests run against stubbed composition so correctness is not affected; flagged only for awareness.

</details>

<details>
<summary>Details</summary>

### Expansion reproduces the exact 6-row worked example

`resolveMatrix` expands per `item.accessKind`: `entitlement` → one leaf row (`role=''`, `AP=''`); `accessProfile` → one row per entitlement (`role=''`, `AP=ap.name`); `role` → one row per AP-entitlement (`role`+`AP` set) plus one row per role-direct entitlement (`role` set, `AP=''`); `access` → exactly one degenerate all-blank-leaf row. The source per leaf comes from the entitlement's own resolved `source`, not the AP's — matching the design's "source the entitlement lives on" rule. `accessMatrix.test.ts` drives the stub-resolver worked example and asserts the exact golden shape (confirmed): both `foo` rows carry `accessProfile='foo'`, the `delete` row has a blank AP, `bar` yields two rows, and the direct `read@phone app` is a single blank-role/blank-AP row. The test also pins that the fully-resolvable example has zero unresolved rows.

### Five-id dedup keeps distinct paths distinct

Rows collapse through a `Map` keyed on `(userId, roleId, accessProfileId, entitlementId, sourceId)` with a display-name fallback for null id slots (`rowKey`). The tests confirm an identical path produced twice collapses to one row, two `access`-kind rows for the same user collapse to one, and the same leaf reached once direct and once via a different AP stays two rows because the `(roleId, accessProfileId)` prefix differs. This is the "show all the paths" behavior the user asked for.

### Blank-cell sort order is uniform and total

`compareValues` uses `localeCompare(..., { sensitivity: 'base' })`, so `''` sorts before any populated value ascending (blanks first) and last descending, case-insensitively, uniformly across all five columns. The tiebreak chain iterates `user → role → accessProfile → entitlement → source` always ascending (so the secondary ordering does not flip with the primary direction), then falls through to the unique row `id`, giving a total, reproducible order. `sortRows` returns a new array and never mutates the input. The RTL test independently confirms blanks-first ascending / blanks-last descending on the Role column.

### Graph derivation is pure, documented, and bidirectional-ready

`deriveAccessGraph` is a named export with JSDoc covering direction, the four skip patterns, the node-id scheme, dedup, `pathCount`, the all-blank-leaf case, and the explicit bidirectional-traversal note (reverse by walking edges on `to`, no reverse edges stored). It builds each row's ordered list of present levels, drops blank role/AP levels, and emits an edge per consecutive pair. The entitlement fallback id folds in `sourceId ?? source` so two same-named entitlements on different sources never collapse. `accessGraph.test.ts` asserts the exact node set for the worked example (1 user, 1 role, 2 APs, 6 distinct entitlements, 3 sources), the correct skips (`delete` → `user→role→entitlement→source`, `read@phone` → `user→entitlement→source`), `pathCount` accumulation (engr db fed by three, role→foo traversed twice), same-name-different-source distinctness, the unresolved partial contribution, the all-blank-leaf → one user node + zero edges, and empty input → empty graph. Input is verified unmutated. No renderer was built.

### Resolver mirrors provenance with honest soft-degrade

`createAccessCompositionResolver` holds three independent `Map<string, Promise<…>>` caches (role / AP / entitlement id spaces). The `cached` helper fetches each id at most once and dedupes concurrent lookups to a single round-trip; an empty id resolves to `null` without a network call. Every fetch is wrapped so any failure (401/403/404/429/5xx/network) soft-degrades to `null`, and the mapper then emits an `unresolved` row carrying whatever names/ids were known rather than throwing or blanking the whole table. This is the provenance philosophy applied uniformly, as the design specifies, and it reuses `toFriendlyError`/`FriendlyError` without inventing new error handling. The fetch-once behavior is pinned by a test asserting `role` is called once for two items referencing the same role.

### Hook mirrors useProvenance lifecycle

`useAccessMatrix` recreates the resolver only when `campaignId` changes (tracked by `resolverCampaignRef`), keys the resolve effect on a stable `idSig = items.map(i => i.id).join('|')` rather than the array reference (so a decision-driven `items` rebuild with the same ids does not re-run resolution), and uses a `cancelled` guard to drop stale resolutions. `status:'ready'` carries `rows`, `graph = deriveAccessGraph(rows)`, and `unresolvedCount`; `status:'error'` is reserved for a truly fatal thrown error, with soft-degraded leaves surfacing via `unresolvedCount`. The one `eslint-disable` is scoped to the intentional synchronous idle reset on the no-items branch and is documented. The hook test (written, not skipped) confirms resolution to `ready` with 6 rows and the stable-id-signature behavior.

### View accessibility and state handling

`AccessMatrixView` is a dedicated sortable table. Each header is `<th scope="col">` with `aria-sort` (active column ascending/descending, others `none`) wrapping a real `<button type="button">`; clicking the active column flips direction and clicking a new column sorts ascending. The user cell per row is `<th scope="row">`. A visually-hidden `<caption>` summarizes the table and states the blanks-sort-first convention. Blank cells on a resolved row render a visually-hidden "(not applicable)"; blank cells on an unresolved row render a visible "Unresolved" marker; the `unresolvedCount` banner uses `role="status"`. Loading / empty / error (with retry) states reuse the shared `LoadingState`/`EmptyState`/`ErrorState` components. The decision not to extend `DrillDownTable` is justified in the design (static, non-sortable, hard-wired to a different data shape and consumer). The RTL test exercises the header-click reorder + `aria-sort` toggle, the th scopes, the caption text, and all four states plus the banner.

### CertApp wiring preserves the existing flow

`CampaignStep` gains `'matrix'`; `CampaignRoute` destructures the three new runtime clients and calls `useAccessMatrix` alongside `useProvenance`, piggybacking on the already-loaded `review.items` (no second item fetch). The dashboard gains an optional `onViewMatrix` prop rendering a "View access map" secondary button inside an always-present actions row, so the matrix stays reachable on a completed campaign; when the prop is absent the button is not rendered, keeping existing layout and tests intact. No change to the top-level route type or App Shell subPath reporting.

### Test integrity

The commit's diff shows `certifications.test.ts` is not modified, so its assertions are intact despite the `describeAccess` change adding `accessId`. `sdkClient.test.ts` gained three additive `toBeDefined` assertions for the new clients, removing none. The five new test files (sort, graph, data layer, hook, view) carry the required coverage a–d. Recorded evidence (build/lint/test all green, 166 tests) is present in both the plan and the commit body, so the suites were not re-run.

</details>

<details>
<summary>File map</summary>

- `src/sailpoint/types.ts` — add `AccessMatrixRowVM`, `AccessGraphNode/Edge/Data`, `AccessGraphNodeKind`; optional `ReviewItemVM.accessId`.
- `src/sailpoint/certifications.ts` — populate `accessId` in `describeAccess` (null for the generic `access` kind).
- `src/sailpoint/sdkClient.ts` — add `RolesApi`/`AccessProfilesApi`/`EntitlementsApi` to the runtime.
- `src/sailpoint/accessMatrix.ts` — composition resolver + pure `resolveMatrix` expansion with five-id dedup.
- `src/domain/accessGraph.ts` — pure `deriveAccessGraph(rows) → { nodes, edges }`.
- `src/domain/accessMatrixSort.ts` — pure `compareRows`/`sortRows`.
- `src/state/useAccessMatrix.ts` — hook mirroring `useProvenance`.
- `src/views/AccessMatrixView.tsx` + `.css` — dedicated sortable table.
- `src/CertApp.tsx`, `src/views/CampaignDashboard.tsx` + `.css` — `'matrix'` step + dashboard button.
- Tests: `accessMatrixSort.test.ts`, `accessGraph.test.ts`, `accessMatrix.test.ts`, `AccessMatrixView.test.tsx`, `useAccessMatrix.test.ts`; `sdkClient.test.ts` extended additively.

Full diff: `git -C /Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/access-matrix show HEAD`

</details>
