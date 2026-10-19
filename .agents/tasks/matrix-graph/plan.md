# Implementation Plan — Replace the access matrix table with a React Flow graph

Replace the sortable HTML table in `AccessMatrixView` with a visual node/edge
graph of `matrix.graph`, built with the SAME graph stack as the sibling
`org-graph` plugin (`@xyflow/react` v12 + `@dagrejs/dagre` v3) and matching its
styling. UI-layer only: the data layer (`deriveAccessGraph`, `useAccessMatrix`,
the graph types in `types.ts`) is DONE and consumed as-is.

All paths are absolute under the worktree
`/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph`
(branch `feature/access-matrix-graph`). Never write to the parent repo.

## Design decisions (made during exploration, grounded in the code)

- **Stack & versions.** `@xyflow/react@^12.12.0` + `@dagrejs/dagre@^3.1.1`,
  identical ranges to `org-graph/package.json`. Neither is in
  `visual-certs/package.json` today (confirmed: no `node_modules/@xyflow` or
  `node_modules/@dagrejs`). React 19.2.8 / Vite 8 / vitest 3 / TS ~6.0.2 are
  already shared, so the two deps drop in cleanly. Recharts stays for the
  dashboard charts; it is NOT used for this graph.
- **Table removal.** The user said "replace the table with a graph," so the
  `<table>` and its sort-header machinery are REMOVED from `AccessMatrixView`
  and the graph renders in their place. `src/domain/accessMatrixSort.ts` and
  its test become unused but are pure/harmless and are LEFT IN PLACE — eslint
  (`typescript-eslint` recommended) and `tsc` (`noUnusedLocals` is file-local,
  not cross-module) do not flag an unused exported module, and the baseline
  build stays green. `deriveAccessGraph` and its test are NOT touched.
- **Theme / colorMode.** visual-certs has NO theme system (no `data-theme`, no
  `ThemeProvider`, no `useTheme`; confirmed by search). It themes purely via
  `@media (prefers-color-scheme: dark)` in `src/index.css`. org-graph passes
  `colorMode={theme}` ('light'|'dark'). Decision: derive colorMode from a tiny
  `prefers-color-scheme` hook (default `'light'` when `matchMedia` is absent,
  e.g. jsdom) and pass it to `<ReactFlow colorMode>`. Ship BOTH light and dark
  token values (mirroring org-graph's `tokens.css`) so the dark look matches,
  but DO NOT build a theme-switch UI — none exists to hook into.
- **Tokens.** Add `src/graph/tokens.css` mirroring org-graph's token vocabulary
  and values (`--canvas/--ink/--card/--line/--accent/--edge/--shadow/
  --minimap-*/--sans`, light + `:root[data-theme='dark']`, plus the reduced-
  motion block). Keep the existing `--vc-*` tokens untouched. Import the React
  Flow stylesheet then tokens in `main.tsx`, exactly once, mirroring
  org-graph's entry order.
- **rankdir.** Default `'LR'` for the user→source pipeline (5 ranks read left to
  right). Add a cheap in-view TB/LR toggle button (local `useState`, re-runs the
  pure layout) since it is a one-line state flip over an already-pure module;
  this also satisfies the "view from users or from sources" intent (LR shows
  users on the left, sources on the right; the graph edges already encode
  direction and dagre lays both ends out).
- **Pure scene module.** A pure, separately-unit-testable
  `src/graph/buildAccessScene.ts` converts `AccessGraphData` + rankdir into
  positioned React Flow `Node[]`/`Edge[]` (dagre layout, handles, per-rank
  spacing), split from the React Flow component exactly as org-graph splits
  `build-scene.ts`/`layout.ts` from `OrgCanvas.tsx`. This is what the new unit
  test targets, so graph logic is verified without React Flow mounting in
  jsdom (vitest config has `test.css: false`, so React Flow's CSS import is a
  no-op in tests and the component test can still render).
- **Per-kind accent.** Each of the five node kinds gets a left-border accent
  color via a `kind-<kind>` CSS class on the node card (mirroring org-graph's
  `type-<kind>` border-left pattern): user / role / accessProfile / entitlement
  / source. Colors come from new `--vc-graph-*` tokens in `tokens.css`.
- **Known pre-existing failure (do NOT chase).** `src/state/useProvenance.test.ts`
  has one order-dependent test that fails in the full `npm test` run but PASSES
  when run in isolation (`npx vitest run src/state/useProvenance.test.ts`). It
  is unrelated to this task and touches none of the files here. Treat the
  provenance test as green via its isolated run; do not try to "fix" it.

## Build / test commands (from package.json + README)

- Build + typecheck: `npm run build` (runs `tsc -b && vite build`).
- Lint: `npm run lint`.
- Full test: `npm test` (`vitest run`). Scoped: `npx vitest run <path>`.
- Node 22+. Tests run in jsdom with `test.css: false`.

---

- [ ] 1. Add the graph dependencies.
      Add `"@xyflow/react": "^12.12.0"` and `"@dagrejs/dagre": "^3.1.1"` to
      `dependencies` in package.json (same ranges as org-graph), then install.
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/package.json`,
      `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/package-lock.json`
      Verify: `cd /Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph && npm install` succeeds and
      `ls node_modules/@xyflow/react node_modules/@dagrejs/dagre` both resolve;
      then `npm run build` still passes (baseline unchanged by the deps alone).

- [ ] 2. Add the graph design tokens, mirroring org-graph.
      Create `src/graph/tokens.css` copying org-graph's token vocabulary and
      values (`--canvas/--ink/--muted/--meta/--card/--card-focus/--line/
      --accent/--accent-ink/--accent-soft/--shadow/--shadow-focus/--edge/
      --minimap-mask/--minimap-node/--minimap-focus/--control/--sans`, plus the
      `@media (prefers-reduced-motion)` `--motion-ms` block), with light defaults
      under `:root` and dark overrides under `:root[data-theme='dark']`. ALSO add
      five per-kind accent tokens `--vc-graph-user/-role/-accessProfile/
      -entitlement/-source` (light + dark). Do not alter the existing `--vc-*`
      tokens in index.css.
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/graph/tokens.css`
      Verify: `npm run build` passes (CSS compiles; file is imported in step 8).

- [ ] 3. Add the scene/view-model types to `sailpoint/types.ts`.
      Append heavy-JSDoc house-style types for the scene layer (do NOT import
      from state/ hooks; components import these from here): `AccessSceneNodeData`
      (`{ kind: AccessGraphNodeKind; label: string }` — carried as React Flow
      node `data`), a `RankDir = 'LR' | 'TB'` union, and if helpful an
      `AccessSceneNode`/`AccessScene { nodes, edges }` describing the pure
      module's output shape in domain terms. Reuse the existing
      `AccessGraphNodeKind` / `AccessGraphData` already defined there.
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/sailpoint/types.ts`
      Verify: `npx vitest run src/domain` (unchanged domain tests still pass) and
      `npm run build` typechecks the new exports.

- [ ] 4. Create the pure scene/layout module `buildAccessScene`.
      Create `src/graph/buildAccessScene.ts` exporting a pure
      `buildAccessScene(graph: AccessGraphData, rankdir: RankDir): { nodes:
      Node<AccessSceneNodeData>[]; edges: Edge[] }`. It must: map each
      `AccessGraphNode` to a React Flow node (`id`, fixed `width`/`height` per
      card, `type: 'access'`, `data: { kind, label }`, `sourcePosition`/
      `targetPosition` from rankdir); map each `AccessGraphEdge` to an edge
      (`id` = `` `e:${from}:${to}` ``, `source`/`target`, `sourceHandle`/
      `targetHandle` from rankdir, and use `pathCount` to set edge
      thickness/label e.g. `style.strokeWidth` and a `label` when `>1`); run a
      dagre pass (`new Graph(); setGraph({ rankdir, nodesep, ranksep, ranker:
      'network-simplex', marginx, marginy }); setNode; setEdge; layout`) and read
      back `node(id).{x,y}` offset by half width/height to top-left — mirroring
      `org-graph/src/graph/layout.ts`. No I/O, no mutation of inputs,
      deterministic. Handle the empty-graph case (return `{ nodes: [], edges: []
      }`).
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/graph/buildAccessScene.ts`
      Verify: `npm run build` typechecks; exercised by the unit test in step 5.

- [ ] 5. Add the focused `buildAccessScene` unit test.
      Create `src/graph/buildAccessScene.test.ts` building rows via
      `deriveAccessGraph` (reuse the worked example from
      AccessMatrixView.test.tsx). Cover: (a) a full 5-layer path
      (user→role→accessProfile→entitlement→source) yields 5 nodes on that chain
      with the correct kinds; (b) a direct-entitlement row yields the 3-node
      user→entitlement→source path (no role/AP nodes, 2 edges); (c) total edge
      count matches `graph.edges.length` and edge source/target ids line up with
      the graph; (d) every node has FINITE numeric `position.x`/`position.y`
      (dagre produced real coordinates) for BOTH `'LR'` and `'TB'` rankdir.
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/graph/buildAccessScene.test.ts`
      Verify: `npx vitest run src/graph/buildAccessScene.test.ts` — all new tests
      pass.

- [ ] 6. Create the custom node component and its CSS.
      Create `src/graph/AccessNode.tsx`: a React Flow custom node rendering an
      `<article className={`vc-graph-card kind-${data.kind}`}>` card with a
      `Handles` sub-component placing 8 `<Handle>`s (top/bottom/left/right ×
      in/out, `isConnectable={false}`), `tabIndex`/`aria-label` for keyboard a11y,
      showing the label and a small kind caption — mirroring org-graph's
      `PersonNode` structure but trimmed to label + kind (no person actions).
      Create `src/graph/AccessGraph.css` with the card, handle, per-kind
      `border-left-color` (from `--vc-graph-*`), `.react-flow`/canvas sizing,
      edge, controls, and minimap styling adapted from org-graph's App.css
      graph block. Register `const nodeTypes = { access: AccessNode }`.
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/graph/AccessNode.tsx`,
      `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/graph/AccessGraph.css`
      Verify: `npm run build` typechecks (component consumed in step 7).

- [ ] 7. Create the React Flow canvas surface `AccessGraphCanvas`.
      Create `src/graph/AccessGraphCanvas.tsx` exporting `AccessGraphCanvas({
      graph }: { graph: AccessGraphData })`. Structure mirrors org-graph's
      `OrgCanvas`: a `<ReactFlowProvider>` wrapping an inner surface that holds
      `rankdir` state (default `'LR'`), derives colorMode from a small
      `usePrefersColorScheme` hook (add it here or in `src/graph/useColorMode.ts`,
      defaulting to `'light'` when `window.matchMedia` is undefined), memoizes
      `buildAccessScene(graph, rankdir)`, and renders
      `<ReactFlow nodes edges nodeTypes colorMode={colorMode} nodesDraggable=
      {false} nodesConnectable={false} elementsSelectable deleteKeyCode={null}
      panOnScroll fitView minZoom={0.15} maxZoom={1.8}>` with `<MiniMap pannable
      zoomable maskColor nodeColor={byKind}>`, `<Controls showInteractive=
      {false}>`, and a `<Panel position="top-left">` holding the LR/TB toggle
      button. Give the wrapping element a definite height (e.g. a `.vc-graph-
      wrap` class with `height: min(70vh, 640px)`) so React Flow has a sized
      container.
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/graph/AccessGraphCanvas.tsx`,
      `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/graph/useColorMode.ts` (optional)
      Verify: `npm run build` typechecks; wired into the view in step 9.

- [ ] 8. Wire the React Flow stylesheet and tokens at the entry point.
      In `src/main.tsx` add `import '@xyflow/react/dist/style.css'` then
      `import './graph/tokens.css'` BEFORE the existing `import './index.css'`
      (React Flow base styles first, then tokens, then app tokens — mirroring
      org-graph's `main.tsx` order), so the stylesheet is imported exactly once
      at entry.
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/main.tsx`
      Verify: `npm run build` passes and the built CSS bundle includes the React
      Flow styles (build output lists a CSS asset without error).

- [ ] 9. Replace the table in `AccessMatrixView` with the graph.
      In `src/views/AccessMatrixView.tsx`: remove the `sortRows`/`SortColumn`/
      `SortDirection` imports, the `COLUMNS`/`ariaSortFor`/`handleSort` machinery,
      the `column`/`direction` state, the `sorted` memo, the `<table>` block, and
      the `MatrixCell` helper. KEEP the `{ campaignName, matrix, onBack }` props
      signature exactly, the `← Back to overview` button, the title, the
      loading/error/empty states (via `LoadingState`/`ErrorState`/`EmptyState`
      exactly as now), and the non-fatal unresolved banner. In the
      `status === 'ready' && rows.length > 0` branch render
      `<AccessGraphCanvas graph={matrix.graph} />` as the primary content.
      Update the section `aria-label` only if needed; keep copy consistent
      ("All access paths" title is fine).
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/views/AccessMatrixView.tsx`
      Verify: `npm run build` typechecks (no dangling table-only imports).

- [ ] 10. Trim `AccessMatrixView.css` to the kept chrome.
      Remove the now-dead `.vc-matrix-table` / `.vc-matrix-sort` /
      `.vc-matrix-sort-ind` / `.vc-matrix-unresolved` rules; keep `.vc-matrix-head`
      and `.vc-matrix-title`. Leave the graph-specific styling in
      `AccessGraph.css` (step 6). Do NOT delete `src/domain/accessMatrixSort.ts`
      or its test (decision above).
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/views/AccessMatrixView.css`
      Verify: `npm run build` passes; `npm run lint` passes.

- [ ] 11. Rewrite `AccessMatrixView.test.tsx` for the graph path.
      Replace the table-specific assertions (sortable headers, `aria-sort`
      toggling, row/column-header scopes, `(not applicable)` markers, the 7-row
      count) with graph-path assertions, keeping the state-handling tests
      (loading, empty, error+retry, unresolved banner) and the preserved-chrome
      tests (Back button calls `onBack`, title present). For the ready-with-rows
      case: render with the worked-example `readyState`, assert the graph
      surface mounts (e.g. a `.react-flow` container is present — note
      `test.css: false` so no layout, DOM only) and that node labels from the
      graph (e.g. `Role A`, `engr db`, `read`) render. Because React Flow needs
      `ResizeObserver` and may need `matchMedia` under jsdom, add any missing
      stubs to `src/test/setup.ts` (`ResizeObserver` already stubbed; add a
      `window.matchMedia` stub returning `{ matches: false, addEventListener,
      removeEventListener, ... }` if the colorMode hook calls it — this also
      makes the default `'light'` path deterministic).
      Files: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/views/AccessMatrixView.test.tsx`,
      `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/matrix-graph/src/test/setup.ts` (only if a matchMedia stub is needed)
      Verify: `npx vitest run src/views/AccessMatrixView.test.tsx` — all tests
      pass.

- [ ] 12. Full verification pass.
      Run the whole gate and confirm the graph swap is clean end to end.
      Files: (none — verification only)
      Verify: `npm run build` passes; `npm run lint` passes;
      `npx vitest run src/graph src/views/AccessMatrixView.test.tsx src/domain`
      passes; and `npm test` passes EXCEPT the known pre-existing
      `useProvenance.test.ts` order-dependent failure, which must still pass in
      isolation via `npx vitest run src/state/useProvenance.test.ts`. If any
      NEW failure appears, fix it before marking done.
