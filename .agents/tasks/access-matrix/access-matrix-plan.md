# Implementation Plan — Access Expansion Matrix

Derived from the APPROVED design at `.agents/tasks/access-matrix/access-matrix-design.md`
(narrative review context: `.agents/tasks/access-matrix/design-review.md`). This
plan sequences the design faithfully — it does not re-decide the architecture. Where
the design settled a decision (dedup by five-id tuple, blank-sorts-as-empty-string,
soft-degrade to `null`, `getRoleV1` over `getRoleEntitlementsV1`, dedicated
`AccessMatrixView` instead of extending `DrillDownTable`, `'matrix'` CampaignStep), the
plan follows it.

## Worktree, environment, and ground rules (read first)

- **All code lives in the WORKTREE:** `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/access-matrix`.
  Use absolute paths under that worktree, and `git -C /Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/access-matrix`
  for every git operation. Relative paths risk landing in the parent workspace — do not use them for file writes outside your tools.
- **The worktree has NO `node_modules`.** The `sailpoint-api-client` SDK and all dev
  dependencies are only installed in the parent repo. Item 0 installs them in the
  worktree; nothing else (tsc, vite, vitest, eslint) will run until it is done.
- **Stack is locked:** TypeScript, React 19 function components + hooks, Vite, Vitest +
  React Testing Library, Node 22+. No new runtime dependencies. No manifest/scope change
  (`sp:scopes:all` already covers roles/access-profiles/entitlements read).
- **Import convention (matches `sdkClient.ts` / `certifications.ts`):** import **API
  classes** (`RolesApi`, `AccessProfilesApi`, `EntitlementsApi`) from the package root
  `'sailpoint-api-client'`; import **model/DTO types** from the module subpaths
  (`'sailpoint-api-client/roles/api'` for `Role`, `AccessProfileRef`, `EntitlementRef`;
  `'sailpoint-api-client/entitlements/api'` for `EntitlementV2`). Verified: these
  interfaces are declared in those `api.d.ts` files; `RolesApi`/`AccessProfilesApi`/
  `EntitlementsApi` are exported from `dist/index.d.ts`.
- **Verified SDK facts (do NOT re-investigate):** `getRoleV1({ id })` → `AxiosPromise<Role>`;
  `getAccessProfileV1({ id })` → `AxiosPromise<AccessProfile>`; `getEntitlementV1({ id })`
  → `AxiosPromise<EntitlementV2>` (all take a request-parameter object and are read via
  `res.data`, exactly like `certificationsApi` calls). `Role.accessProfiles?: Array<AccessProfileRef> | null`,
  `Role.entitlements?: Array<EntitlementRef>`; `AccessProfile.entitlements?: Array<EntitlementRef> | null`,
  `AccessProfile.source: AccessProfileSourceRef`; `EntitlementV2.source?: EntitlementV2Source`
  (`{ id?, type?, name? }`). `AccessProfileRef`/`EntitlementRef` are shallow (no source) —
  hence the per-leaf `getEntitlementV1` re-fetch for the source column.
- **Do NOT weaken or delete existing tests.** New suites only; keep every existing
  assertion intact. Existing consumers of `ReviewItemVM`, `sdkClient.ts`, and
  `CampaignDashboard` must keep compiling — all additions are backward-compatible
  (new optional props / fields).
- **Each item must leave the worktree buildable.** Items are ordered by dependency.
- **Blank-cell convention (design, pinned):** a blank role/accessProfile cell is the
  empty string `''` and means "that level is not on this path." Sort treats `''` as an
  empty string → blanks sort FIRST ascending, LAST descending; comparison is
  case-insensitive, locale-aware (`localeCompare` with `{ sensitivity: 'base' }`), uniform
  across all five columns, with a fixed tiebreak chain `user → role → accessProfile →
  entitlement → source → row id` for a total order.

## Final verification + evidence recording (MANDATORY, applies to the whole task)

After the last code item, run ALL THREE of these **in the worktree** and confirm each
passes:

- `npm run build` (runs `tsc -b && vite build`)
- `npm run lint` (runs `eslint .`)
- `npm test` (runs `vitest run`)

Then **record what was run and the results** so the reviewer can read the evidence
without re-running the suites:

- Append a "Verification evidence" section to the bottom of THIS plan file
  (`.agents/tasks/access-matrix/access-matrix-plan.md`) listing each of the three
  commands, pass/fail, the vitest summary line (test-file and test counts), and any
  warnings.
- Put the same summary in the commit message body.

Do NOT mark the task complete unless all three are green. If a command fails, fix the
cause and re-run all three before recording.

---

# Implementation Plan

- [ ] 0. Install dependencies in the worktree so the toolchain runs.
      The worktree has no `node_modules`; `npm ci` (or `npm install` if no lockfile is
      honored) installs `sailpoint-api-client` and the dev toolchain locally.
      Files: none (installs into `.worktrees/access-matrix/node_modules`).
      Verify: `npm run build` in the worktree completes with no "Cannot find module"
      errors — i.e. tsc/vite can resolve `sailpoint-api-client` and React. (This is the
      green baseline; existing `npm test` and `npm run lint` should also pass unchanged
      before any edit.)

- [ ] 1. Add the view-model types to `src/sailpoint/types.ts` and extend `ReviewItemVM`.
      Add `AccessGraphNodeKind` (`'user'|'role'|'accessProfile'|'entitlement'|'source'`),
      `AccessMatrixRowVM`, `AccessGraphNode`, `AccessGraphEdge`, and `AccessGraphData`
      exactly as specified in the design's "Data model" section (heavy JSDoc style already
      in the file; fields `id,userId,user,role,roleId,accessProfile,accessProfileId,
      entitlement,entitlementId,source,sourceId,unresolved` on the row; `pathCount` on the
      edge; namespaced node ids). Also add an optional `accessId: string | null` field to
      `ReviewItemVM` with JSDoc ("id of the role/AP/entitlement under review, from
      `item.accessSummary.{role|accessProfile|entitlement}.id`; null when not applicable").
      Files: `src/sailpoint/types.ts`
      Verify: `npm run build` — `tsc -b` compiles with the new types and the new optional
      field (existing consumers still compile because `accessId` is optional).

- [ ] 2. Populate `accessId` in `describeAccess` / `toReviewItemVM` in `src/sailpoint/certifications.ts`.
      Extend `describeAccess`'s return shape with `accessId: string | null` and set it from
      the matching summary ref: `entitlement.id` / `accessProfile.id` / `role.id` in the
      three typed branches, and `null` in the generic `access` fallback branch (the design
      is explicit: do NOT read `summary.access.id` into `accessId`). `toReviewItemVM`
      already spreads `...access`, so no further change is needed there once the field is
      in the returned object. Do not alter any other field.
      Files: `src/sailpoint/certifications.ts`
      Verify: `npm test` — the existing `src/sailpoint/certifications.test.ts` still passes
      (no assertion weakened); `npm run build` compiles.

- [ ] 3. Add `RolesApi`, `AccessProfilesApi`, `EntitlementsApi` to the runtime in `src/sailpoint/sdkClient.ts`.
      Add the three classes to the package-root import; add `rolesApi`, `accessProfilesApi`,
      `entitlementsApi` fields to `PluginRuntime` (with JSDoc matching the design); in
      `initPlugin`, construct each from the same autoconfigured `configuration` after the
      existing clients and include them in the returned object — mirroring the exact
      `accessRequestsApi` / `identityHistoryApi` pattern already in the file.
      Files: `src/sailpoint/sdkClient.ts`
      Verify: `npm test` — the existing `src/sailpoint/sdkClient.test.ts` still passes;
      `npm run build` compiles. (If that test asserts the exact set of runtime fields,
      extend it additively to include the three new clients — do not remove assertions.)

- [ ] 4. Create the pure sort module `src/domain/accessMatrixSort.ts`.
      Export `compareRows(column, direction)` returning a comparator over `AccessMatrixRowVM`,
      and `sortRows(rows, column, direction)` returning a NEW sorted array (never mutates
      input). Implement blank-as-empty-string, case-insensitive, locale-aware ordering
      (`localeCompare`, `{ sensitivity: 'base' }`) with the fixed tiebreak chain
      `user → role → accessProfile → entitlement → source → id`. `column` is one of the five
      sortable columns; `direction` is `'ascending' | 'descending'`.
      Files: `src/domain/accessMatrixSort.ts`
      Verify: `npm test` after item 5 adds its tests. On its own: `npm run build` compiles.

- [ ] 5. Add unit tests for the sort module: `src/domain/accessMatrixSort.test.ts`.
      Following the `src/domain/*.test.ts` convention (Vitest, no mocks). Cover, per the
      design's required test (b): sort each of the five columns ascending AND descending;
      assert the documented blank-cell rule — blank role/accessProfile rows sort FIRST
      ascending and LAST descending; case-insensitivity (e.g. `foo` vs `Foo` compare equal
      under base sensitivity); and total determinism on equal keys (identical sort keys fall
      through the tiebreak chain to a stable, reproducible order regardless of input order).
      Use a small fixture of `AccessMatrixRowVM` objects (can reuse the 6-row worked example
      shape).
      Files: `src/domain/accessMatrixSort.test.ts`
      Verify: `npx vitest run src/domain/accessMatrixSort.test.ts` — all new tests pass.

- [ ] 6. Create the pure graph derivation `src/domain/accessGraph.ts`.
      Export and fully document `deriveAccessGraph(rows: AccessMatrixRowVM[]): AccessGraphData`
      exactly as the design's §3 specifies: pure (no I/O, no input mutation, deterministic
      insertion-order output); direction `user → (role?) → (accessProfile?) → entitlement →
      source` with blank levels SKIPPED so the chain connects consecutive present levels;
      nodes deduped by namespaced id (`user:<userId>`, `role:<roleId>` with
      `role:name:<name>` fallback, `accessProfile:<id>` with name fallback,
      `entitlement:<id>` with `entitlement:name:<sourceId|sourceName>:<entName>` fallback,
      `source:<id>` with name fallback); edges deduped by `from|to` accumulating `pathCount`;
      a single-level list contributes no edge. The JSDoc must state it is bidirectional-ready
      (reverse traversal sources→users by walking edges on `to`; no reverse edges stored).
      Handle the degenerate all-blank-leaf (`access`-kind) row: contributes ONLY the `user`
      node and ZERO edges (no entitlement/source node synthesized when both are blank).
      Files: `src/domain/accessGraph.ts`
      Verify: `npm run build` compiles; full test in item 7.

- [ ] 7. Add unit tests for the graph derivation: `src/domain/accessGraph.test.ts`.
      Per required test (c), using a fixture of the exact 6-row worked example (define the
      rows inline). Assert the correct node set: 1 `user` (User One), 1 `role` (Role A),
      2 `accessProfile` (`foo`, `bar`), the leaf entitlements kept distinct by source
      (`read@engr db`, `write@engr db`, `delete@engr db`, `read@accounting db`,
      `search@accounting db`, `read@phone app`), and 3 `source` nodes (engr db, accounting
      db, phone app). Assert edges including the correct SKIPS: the `delete` role-direct row
      → `user→role→entitlement→source` (no AP hop); the `read@phone` direct row →
      `user→entitlement→source` (no role/AP); `pathCount` accumulation where a shared edge
      is traversed by multiple rows (e.g. `source:engr db` fed by three entitlements, the
      single `User One` node); same-name-different-source entitlements staying distinct
      (two `read` leaves do not collapse); an unresolved-row partial contribution; the
      all-blank-leaf `access`-kind row → exactly one `user` node and zero edges; and empty
      input → empty graph. This fixture reproduces the user's worked example and is a core
      bidirectional-ready assertion.
      Files: `src/domain/accessGraph.test.ts`
      Verify: `npx vitest run src/domain/accessGraph.test.ts` — all new tests pass.

- [ ] 8. Create the data layer `src/sailpoint/accessMatrix.ts` (resolver + pure mapper).
      Mirror `provenance.ts`. Export an `AccessCompositionResolver` interface with
      `role(id)`, `accessProfile(id)`, `entitlement(id)` each returning a Promise of an
      internal DTO-free `ResolvedRole`/`ResolvedAccessProfile`/`ResolvedEntitlement` or
      `null`. Export `createAccessCompositionResolver(rolesApi, accessProfilesApi,
      entitlementsApi)` backed by THREE independent `Map<string, Promise<…>>` caches (one
      per id space): fetch-at-most-once-per-id, concurrent lookups dedupe to one round-trip
      (identical to `createProvenanceResolver`). Each fetch is `try/catch`; ANY failure
      (401/403/404/429/5xx/network) soft-degrades to `null` (classify via
      `toFriendlyError(error).status` only if useful, but every failure → `null` for the
      matrix — never throw). Reuse `toFriendlyError`/`FriendlyError` from `certifications.ts`;
      invent no new error handling. Then export the async orchestrator
      `resolveMatrix(items: ReviewItemVM[], resolver): Promise<AccessMatrixRowVM[]>` and a
      PURE row-assembly helper (callable directly by tests with stubbed composition — no
      network) that implements the per-kind expansion from the design's §2d: `entitlement` →
      1 leaf row (`role=''`,`AP=''`); `accessProfile` → one row per entitlement
      (`role=''`,`AP=ap.name`); `role` → one row per AP-entitlement (`role=role.name`,
      `AP=ap.name`) PLUS one row per role-direct entitlement (`role=role.name`,`AP=''`);
      `access` → exactly one degenerate all-blank-leaf row (`unresolved:true`,
      user/userId populated, every other slot `''`/`null`). Each leaf's `source`/`sourceId`
      comes from `getEntitlementV1` → `EntitlementV2.source` (NOT the AP's source). A `null`
      resolver result emits an `unresolved:true` row carrying known names, blank unknown
      slots. Finally dedup all rows through a `Map` keyed on the five-id tuple
      `(userId, roleId, accessProfileId, entitlementId, sourceId)` with a name fallback for
      null id slots, so identical paths collapse but distinct paths stay separate. Build a
      stable deterministic `id` for each row (hash/join of the five tuple fields + ids).
      Files: `src/sailpoint/accessMatrix.ts`
      Verify: `npm run build` compiles; full test in item 9.

- [ ] 9. Add data-layer tests: `src/sailpoint/accessMatrix.test.ts`.
      Per required test (a). Drive the PURE row-assembly half (or `resolveMatrix` with a
      STUB resolver returning canned role/AP/entitlement composition — no live API) with the
      worked-example input and assert EXACTLY the 6 rows in the documented golden shape:
      `foo/read`, `foo/write` (both carry `accessProfile='foo'`), `/delete` (blank AP, role
      set), `bar/read`, `bar/search`, and the direct `read@phone app`. Also assert: an
      identical path produced twice collapses to one row (five-id dedup); a `null` resolver
      result produces an `unresolved:true` row and never throws; an `access`-kind item
      produces exactly one all-blank-leaf row (`unresolved:true`, user populated, role/AP/
      entitlement/source all `''` with ids null); and two such `access` rows for the same
      user collapse to one. The fixture must document the composition explicitly (plain
      stub objects), reproducing the user's exact 6-row example.
      Files: `src/sailpoint/accessMatrix.test.ts`
      Verify: `npx vitest run src/sailpoint/accessMatrix.test.ts` — all new tests pass,
      including the 6-row golden assertion.

- [ ] 10. Create the hook `src/state/useAccessMatrix.ts` (mirrors `useProvenance`).
      Export `AccessMatrixState { status: 'idle'|'loading'|'ready'|'error'; rows; graph;
      unresolvedCount; error; reload }` and
      `useAccessMatrix(rolesApi, accessProfilesApi, entitlementsApi, campaignId, items)`.
      Mirror `useProvenance` conventions exactly: a `useRef` resolver recreated only when
      `campaignId` changes (tracked by a `resolverCampaignRef`); key the resolve effect on a
      stable `idSig = items.map(i => i.id).join('|')` (NOT the array reference), so a
      decision-driven `items` rebuild with the same ids does not re-run resolution; a
      `cancelled` guard drops a stale resolution. On run: set `status:'loading'`, await
      `resolveMatrix(items, resolver)`, then set `status:'ready'` with `rows`,
      `graph = deriveAccessGraph(rows)`, and `unresolvedCount` (count of `unresolved` rows).
      `status:'error'` is reserved for a truly fatal thrown error (surface a friendly message
      via `toFriendlyError`); soft-degraded leaves surface via `unresolvedCount`, not `error`.
      `reload()` forces a re-resolve. The matrix GATES its render on `status:'ready'` (unlike
      provenance) — a single-shot loading state, per design open-question-4.
      Files: `src/state/useAccessMatrix.ts`
      Verify: `npm run build` compiles. Optional light test (item 11).

- [ ] 11. (Optional, recommended) Add a light hook test: `src/state/useAccessMatrix.test.ts`.
      Following `src/state/useProvenance.test.ts` conventions, with mock API clients returning
      the worked-example composition: assert it resolves to `status:'ready'` with 6 rows and a
      graph of the expected node count, and that a decision-driven `items` rebuild (same ids)
      does not re-run resolution (the id-signature assertion mirrored from
      `useProvenance.test.ts`). If time-boxed, this item may be skipped WITHOUT weakening the
      required coverage, which lives in items 5/7/9/13; note the skip in the evidence section.
      Files: `src/state/useAccessMatrix.test.ts`
      Verify: `npx vitest run src/state/useAccessMatrix.test.ts` — passes (if written).

- [ ] 12. Create the view `src/views/AccessMatrixView.tsx` + `src/views/AccessMatrixView.css`.
      A dedicated SORTABLE table screen (design §6; do NOT extend `DrillDownTable`). Props:
      `{ campaignName: string; matrix: AccessMatrixState; onBack: () => void }`. Structure
      mirrors `ReviewView`: a `← Back` link (calls `onBack`), an `aria-label`led `<section>`,
      and self-managed states using the shared `LoadingState` / `EmptyState` / `ErrorState`
      components:
        - `status==='loading'` → `<LoadingState message="Building the access map…" />`.
        - ready with zero rows → `<EmptyState>`.
        - `status==='error'` → `<ErrorState onRetry={matrix.reload}>`.
        - `unresolvedCount > 0` → a non-fatal `vc-banner` with `role="status"` summarizing
          the unresolved count.
      The table (`<table class="vc-matrix-table">`) has five columns (User, Role, Access
      profile, Entitlement, Source) and a visually-hidden `<caption class="vc-visually-hidden">`
      summarizing contents AND stating the blank-sorts-first convention.
      Accessibility (REQUIRED):
        - Each header is `<th scope="col">` containing a real `<button type="button">` that
          toggles sort for that column.
        - The active column's `<th>` carries `aria-sort="ascending"|"descending"`; inactive
          columns carry `aria-sort="none"`. Clicking the active column flips direction;
          clicking a new column sorts it ascending.
        - The User cell of each row is `<th scope="row">`.
        - Blank role/AP cells render visually empty but include visually-hidden "(not
          applicable)" text; `unresolved` cells render a visible "Unresolved" marker.
      Sort interaction: local state `{ column, direction }` (default `user`/`ascending`);
      rendered rows via `useMemo(() => sortRows(matrix.rows, column, direction), [...])` —
      pure, client-side, no re-fetch. Reuse the shared `vc-table-wrap` / `vc-visually-hidden`
      CSS conventions; add matrix-specific classes in `AccessMatrixView.css` (do not couple
      to `DrillDownTable`).
      Files: `src/views/AccessMatrixView.tsx`, `src/views/AccessMatrixView.css`
      Verify: `npm run build` compiles; full test in item 13.

- [ ] 13. Add the RTL component test: `src/views/AccessMatrixView.test.tsx`.
      Per required test (d), following `src/views/*.test.tsx` conventions (Vitest + RTL +
      `@testing-library/user-event`). Render the view with a STUBBED `matrix` prop
      (`status:'ready'`, the 6 worked-example rows, a derived graph, `unresolvedCount:0`).
      Assert the 6 rows render. Click a column header's sort button and assert BOTH: the row
      order changes (e.g. query the rendered row cells in DOM order and confirm the new
      ordering, including blanks-first for ascending) AND the clicked `<th>`'s `aria-sort`
      updates (`none` → `ascending`, and clicking again → `descending`), while other columns
      stay `aria-sort="none"`. Also assert the loading, empty, error, and
      unresolved-banner (`unresolvedCount>0`) states render; `<th scope="col">`/`<th
      scope="row">` presence; and the visually-hidden caption text (including the blank
      convention).
      Files: `src/views/AccessMatrixView.test.tsx`
      Verify: `npx vitest run src/views/AccessMatrixView.test.tsx` — all new tests pass,
      including the header-click row-reorder + `aria-sort` assertion.

- [ ] 14. Wire the matrix into `src/CertApp.tsx` and `src/views/CampaignDashboard.tsx` (+ `.css`).
      In `CampaignDashboard.tsx`: add an optional prop `onViewMatrix?: () => void` and render
      a secondary button ("View access map") that is rendered UNCONDITIONALLY — independent of
      the `allDone` CTA guard — in an always-present dashboard actions row, so the matrix stays
      reachable on a completed campaign (design NIT-3). When `onViewMatrix` is undefined the
      button is not rendered (keeps existing tests/layout intact). Add any needed button style
      to `CampaignDashboard.css`.
      In `CertApp.tsx` `CampaignRoute`: destructure `rolesApi, accessProfilesApi,
      entitlementsApi` from `runtime`; add `'matrix'` to the `CampaignStep` union; call
      `const matrix = useAccessMatrix(rolesApi, accessProfilesApi, entitlementsApi,
      campaignId, review.items)` next to the existing `useProvenance` call (piggybacks on the
      already-loaded `review.items`); pass `onViewMatrix={() => setStep('matrix')}` to
      `CampaignDashboard`; and add a `step === 'matrix'` branch rendering
      `<AccessMatrixView campaignName={campaign.name} matrix={matrix} onBack={() =>
      setStep('dashboard')} />`. No change to the top-level `Route` type or the App Shell
      `subPath` reporting (the matrix is a transient drill-down, like `review`/`signoff`).
      Files: `src/CertApp.tsx`, `src/views/CampaignDashboard.tsx`, `src/views/CampaignDashboard.css`
      Verify: `npm test` — the existing `src/CertApp.test.tsx` and
      `src/views/CampaignDashboard.test.tsx` still pass (the new optional prop defaults to
      undefined, so no existing assertion breaks); `npm run build` compiles.

- [ ] 15. Final full verification and evidence recording (MANDATORY).
      Run `npm run build`, `npm run lint`, and `npm test` IN THE WORKTREE; confirm all three
      pass. If anything fails, fix the root cause and re-run all three. Then append a
      "Verification evidence" section to this plan file AND include the same summary in the
      commit message body: the three commands, pass/fail for each, the vitest summary line
      (test files + test counts), and any lint/build warnings. Confirm no existing test was
      weakened or deleted. Do NOT commit any files under `.agents/` into the worktree beyond
      what already exists; stage only the source/test files this plan created or modified.
      Files: `.agents/tasks/access-matrix/access-matrix-plan.md` (append evidence); commit on
      the worktree branch (never push).
      Verify: all three commands green; evidence section present in this file and in the
      commit message.

---

## Notes, assumptions, and gaps

- **`Role.entitlements` semantics (role-direct, disjoint from AP-reachable)** is an
  inference per the ISC role model, not a documented SDK fact (design NIT-2). It does not
  affect test correctness because the acceptance tests run against STUBBED resolver output.
  If a leaf ever appears both role-direct and via an AP, the five-id dedup keeps them as two
  rows (different `accessProfileId`) — the intended "all paths" behavior. No action needed
  beyond following the design.
- **Pagination of a role's AP list / an AP's entitlement list** was not investigated (design
  open assumption). The design uses single-object `getXV1({ id })` calls with no paging,
  which matches these endpoints' shapes. If a coder discovers a capped sub-list in practice,
  note it in the evidence section and flag it — do not silently add paging that the design
  did not specify.
- **Item 0 (npm install) is a prerequisite, not optional.** If `npm ci` fails for lockfile
  reasons, fall back to `npm install`; record which was used.
- **Item 11 (hook test) is optional** and may be skipped under time pressure without
  weakening required coverage (items 5/7/9/13 carry the mandated tests a–d). If skipped,
  say so in the evidence section.
- No new npm packages, no manifest change, stack unchanged — if any of these appears
  necessary during implementation, STOP and flag it rather than deviating from the design.

---

## Verification evidence

All commands were run **in the worktree**
(`.worktrees/access-matrix`) after the final code change. All three gates are
green.

| Command | Result | Notes |
|---|---|---|
| `npm run build` (`tsc -b && vite build`) | **PASS** | No type errors. 1074 modules transformed; built in ~0.3s. CSS bundle 17.50 kB. |
| `npm run lint` (`eslint .`) | **PASS** | 0 problems (0 errors, 0 warnings). |
| `npm test` (`vitest run`) | **PASS** | **Test Files 27 passed (27); Tests 166 passed (166).** |

Baseline before any edit was 22 test files / 135 tests. This change adds **5
new test files / 31 new tests** and weakens or deletes **no** existing test:

- `src/domain/accessMatrixSort.test.ts` — 7 tests (required test **b**:
  per-column asc/desc, blank-cell rule blanks-first-ascending/last-descending,
  case-insensitive base compare, total deterministic order on ties).
- `src/domain/accessGraph.test.ts` — 8 tests (required test **c**: the 6-row
  worked example → exact node set + edges incl. level-skips, `pathCount`
  accumulation, same-name-different-source distinctness, unresolved partial row,
  all-blank-leaf `access` row → one `user` node + zero edges, empty input).
- `src/sailpoint/accessMatrix.test.ts` — 7 tests (required test **a**: pure
  `resolveMatrix` with a stub resolver → exactly the 6 golden rows [both `foo`
  rows filled, `delete` row blank]; identical-path dedup; distinct-path
  separation; `null` resolver → `unresolved` row, no throw; fetch-at-most-once;
  `access`-kind → one all-blank-leaf row; two such rows collapse to one).
- `src/views/AccessMatrixView.test.tsx` — RTL (required test **d**: renders the
  6 rows; clicking the Role header updates `aria-sort` none→ascending→descending
  while other columns stay `none` AND reorders rows blanks-first/last;
  `<th scope="col">`/`<th scope="row">` presence; visually-hidden caption with
  the blank convention; loading/empty/error/unresolved-banner states).
- `src/state/useAccessMatrix.test.ts` — 2 tests (item 11, the optional hook
  test, was **written** not skipped): resolves to `status:'ready'` with 6 rows
  and 13 graph nodes; a decision-driven `items` rebuild with the same ids does
  not re-run resolution (id-signature assertion mirrored from
  `useProvenance.test.ts`).

Existing suites extended **additively** (no assertion removed): `sdkClient.test.ts`
now also asserts `rolesApi`/`accessProfilesApi`/`entitlementsApi` are defined.

**Dependency install (item 0):** `npm ci` was used in the worktree (lockfile
honored); it completed successfully and the baseline build/lint/test were all
green before any edit.

**Notes / gaps:**
- No pagination was added for a role's AP list or an AP's entitlement list; the
  design specifies single-object `getXV1({ id })` calls and the acceptance tests
  run against stubbed composition. Not investigated further — flagged per the
  plan's open assumption. No silent paging was added.
- `ReviewItemVM.accessId` was added as **optional** (`accessId?: string | null`)
  exactly as item 1 specifies, so every existing `ReviewItemVM` fixture compiles
  unchanged; `toReviewItemVM` always populates it.
- One scoped `eslint-disable-next-line react-hooks/set-state-in-effect` was added
  to the no-items reset branch of `useAccessMatrix` (an intentional synchronous
  idle reset on campaign change, analogous to how `useProvenance` seeds its state
  synchronously before the async resolve). All other setState calls sit on the
  async resolve path and lint clean.
- No new npm packages, no manifest/scope change, stack unchanged.
