# Replace access matrix table with a React Flow graph

The sortable access-expansion `<table>` in `AccessMatrixView` is removed and replaced with an interactive node/edge graph rendering `matrix.graph` across the five layers user → role → access profile → entitlement → source. The graph is built with the same stack and styling as the sibling `org-graph` plugin (`@xyflow/react` v12 + `@dagrejs/dagre` v3): a pure `buildAccessScene` dagre+mapping module feeds a thin `AccessGraphCanvas` React Flow surface. The data layer (`accessGraph.ts`, `useAccessMatrix.ts`, existing graph types) is consumed unchanged; `types.ts` gains only additive scene types. The view keeps its `{ campaignName, matrix, onBack }` props, the Back button, title, loading/error/empty states, and the non-fatal unresolved banner.

Watch for: nothing blocking. One cosmetic note (confirmed) — the section `aria-label` copy shifted from "matrix" to "map" ("Access map for …"), consistent with the new title and intentional.

**Verdict**: APPROVED

## High-level view

The table swap in `AccessMatrixView` is surgical: every piece of chrome the brief calls out is preserved verbatim, the `{ campaignName, matrix, onBack }` signature is unchanged, and the ready-with-rows branch now renders `<AccessGraphCanvas graph={matrix.graph} />` where the `<table>` block was. The dead table-only CSS and the now-unused `sortRows` imports are cleanly removed; `accessMatrixSort.ts` is left in place per the documented decision.

The data layer is genuinely untouched. The diff changes no bytes in `accessGraph.ts` or `useAccessMatrix.ts`, and `types.ts` contains only appended exports (`RankDir`, `AccessSceneNodeData`) with no removed lines — confirmed by diffing.

The org-graph mirroring is faithful rather than cosmetic. Token names and values in `tokens.css` match org-graph's `theme/tokens.css` one-for-one (light + `:root[data-theme='dark']` + reduced-motion), `main.tsx` imports React Flow's stylesheet then tokens then app styles in the same order as org-graph, the dagre pass in `buildAccessScene` reproduces org-graph's `layout.ts` (same `setGraph`/`setNode`/`setEdge`/`layout`, `marginx/y: 24`, half-box top-left offset, `ranker: 'network-simplex'`), and the ReactFlow props (`colorMode`, `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable`, `deleteKeyCode={null}`, `panOnScroll`, `minZoom`/`maxZoom`) mirror `OrgCanvas`. The node card is an 8-handle keyboard-accessible article with per-kind left-border accents.

The graph logic lives in a framework-pure `buildAccessScene` module split from the React component, and its unit test covers the required paths. The view test is rewritten to the graph path while keeping the state-handling and chrome assertions. Verification evidence (build, lint, 171 tests) is recorded in the commit message.

<details>
<summary>Issues (0)</summary>

No blocking or actionable findings.

</details>

<details>
<summary>Details</summary>

### Table removal and chrome preservation in AccessMatrixView

The `<table>`, its `COLUMNS`/`ariaSortFor`/`handleSort` machinery, the `column`/`direction` state, the `sorted` memo, and the `MatrixCell` helper are gone, along with the `sortRows`/`SortColumn`/`SortDirection` imports and the `useMemo`/`useState` imports that only served them. In their place the `status === 'ready' && rows.length > 0` branch renders `<AccessGraphCanvas graph={matrix.graph} />`. The four state branches (loading via `LoadingState`, error via `ErrorState` with `onRetry={matrix.reload}`, empty via `EmptyState`, ready) are untouched in structure, the `← Back to overview` button and `All access paths` title remain, and the unresolved banner (`role="status"`, singular/plural copy, `matrix.unresolvedCount`) is preserved verbatim. The props signature is exactly `{ campaignName, matrix, onBack }`.

The dead CSS in `AccessMatrixView.css` (`.vc-matrix-table`, `.vc-matrix-sort*`, `.vc-matrix-unresolved`, the `tr[data-unresolved]` rule) is removed; `.vc-matrix-head`/`.vc-matrix-title` are kept. `accessMatrixSort.ts` and its test are left in place as the plan documents — harmless, pure, and still green.

### Pure scene module and dagre layout

`buildAccessScene(graph, rankdir)` is framework-pure: it imports only dagre and React Flow types, performs no I/O, does not mutate its input, and returns deterministic positioned `Node[]`/`Edge[]`. The dagre pass reproduces org-graph's `layout.ts` — `new Graph()`, `setDefaultEdgeLabel`, `setGraph({ rankdir, nodesep, ranksep, ranker: 'network-simplex', marginx: 24, marginy: 24 })`, `setNode` with a fixed 200×64 box, `setEdge`, `layout()`, then reading `node(id).{x,y}` offset by half the box to top-left. The empty graph short-circuits to `{ nodes: [], edges: [] }`. Edges get `strokeWidth` and a count label from `pathCount` when a path is shared by more than one row, and the handle ids / source-target positions switch with `rankdir` so an edge always attaches at the rank-facing edge of each card.

### org-graph framework and styling parity

`@xyflow/react@^12.12.0` and `@dagrejs/dagre@^3.1.1` are added to `dependencies` with the same ranges as org-graph, present in the lockfile and resolvable in `node_modules`. `main.tsx` adds `import '@xyflow/react/dist/style.css'` then `import './graph/tokens.css'` before `./index.css`, matching org-graph's entry order. `tokens.css` copies org-graph's token vocabulary and values with light defaults and a `:root[data-theme='dark']` override plus the reduced-motion block, and adds a separate `--vc-graph-*` namespace for the five per-kind accents so the app's `--vc-*` tokens are untouched. `AccessNode` is an `<article>` card with `tabIndex`/`aria-label`, eight non-interactive handles (top/bottom/left/right × in/out), and a `kind-<kind>` class driving the left-border accent — the trimmed analogue of `PersonNode`. `AccessGraphCanvas` wraps a `ReactFlowProvider` around a surface holding `rankdir` state (default `'LR'`), a `useColorMode` hook deriving `colorMode` from `prefers-color-scheme` (defaulting to `'light'` when `matchMedia` is absent), a memoized `buildAccessScene`, and a `ReactFlow` whose props mirror `OrgCanvas`, plus `MiniMap`/`Controls`/`Panel` with an LR/TB toggle whose label matches org-graph's wording.

### Test coverage

`buildAccessScene.test.ts` covers the required cases: a full five-layer path yielding five nodes with the correct kinds and four edges; a direct-entitlement row yielding the three-node user→entitlement→source path with two edges and no role/AP nodes; total edge count matching `graph.edges.length` with endpoints lining up against the derived graph; finite numeric positions for every node under both `'LR'` and `'TB'`; and the empty-graph case. The datasets are built through the real `deriveAccessGraph` from the worked example, so the pure module is exercised against genuine data-layer output.

`AccessMatrixView.test.tsx` is rewritten to the graph path: it asserts the `.react-flow` surface mounts, that node labels (`User One`, `Role A`, `engr db`, `read`) appear via `buildAccessScene` and via the rendered `aria-label`s, and keeps the preserved-chrome and state tests (Back calls `onBack`, title present, loading/empty/error-with-retry, unresolved banner). `setup.ts` gains a `window.matchMedia` stub so the colorMode default is deterministic under jsdom; the existing `ResizeObserver` stub is unchanged. No previously passing test was weakened or deleted.

Not tested: real viewport measurement (fitView framing, minimap panning) cannot run under jsdom — acknowledged in the commit message and covered indirectly by the pure module's finite-position assertions.

### Verification evidence

The commit message records `npm run build` (tsc -b && vite build) passing with zero type errors and the React Flow stylesheet in the built CSS bundle, `npm run lint` clean, and `npm test` at 28 files / 171 tests passing including the known-flaky `useProvenance.test.ts` green on that run. The brief instructs not to re-run these suites; the evidence is present and specific, so no spot-check was warranted.

</details>

<details>
<summary>File map</summary>

- `package.json` / `package-lock.json` — add `@xyflow/react` ^12.12.0 and `@dagrejs/dagre` ^3.1.1
- `src/main.tsx` — import React Flow stylesheet then graph tokens before app styles
- `src/sailpoint/types.ts` — add `RankDir` and `AccessSceneNodeData` scene types (additive)
- `src/graph/tokens.css` — graph design tokens mirroring org-graph + per-kind accents
- `src/graph/buildAccessScene.ts` — pure dagre layout + graph→scene mapping
- `src/graph/buildAccessScene.test.ts` — focused unit test for the pure module
- `src/graph/AccessNode.tsx` — 8-handle accessible custom node with per-kind accent
- `src/graph/AccessGraphCanvas.tsx` — React Flow surface, colorMode, LR/TB toggle
- `src/graph/useColorMode.ts` — prefers-color-scheme hook (light default)
- `src/graph/AccessGraph.css` — canvas/card/handle/edge/controls/minimap styling
- `src/views/AccessMatrixView.tsx` — table removed, `AccessGraphCanvas` rendered, chrome kept
- `src/views/AccessMatrixView.css` — dead table/sort CSS removed, head/title kept
- `src/views/AccessMatrixView.test.tsx` — rewritten to the graph path
- `src/test/setup.ts` — add `window.matchMedia` stub

Full diff: `git -C <worktree> diff main`

</details>
