# Item selection highlights downstream edges in the access graph

Selecting a first-level access item (role, access profile, directly-held entitlement) now highlights its user->item edge plus every visible downstream lineage edge in the item's status color, and dims the rest. The work is a pure `highlightEdges` restyle composed with `emphasizeEdges`, a `SelectionContext` for the cards, and a `selectedItemId` state in `CanvasSurface`. It matches the request ("highlight all the associated edges include related edge with reference nodes when they are shown") and the plan's guardrails. The coder's gate and real-browser evidence is present and consistent with the diff.

Watch for: (possible, non-blocking) the Tab-traversal assertion was re-run for only one of the four dense combos after the driver cap was raised; the cause was a driver limit, not product code.

**Verdict**: APPROVED

## High-level view

Selection is a cheap edge restyle, like hover. Scene, node objects, `fitKey` and the fit effect never see selection. The lineage is derived from the edges that are actually in the scene, so hiding reference content leaves only the user->item edge and showing it restores the full path without extra logic.

Cards become toggle buttons through a context rather than new node data. Only first-level cards get `role="button"`, `aria-pressed` and Enter/Space handling. Mouse selection goes through React Flow's node click, and React Flow's own selection is turned off so there is no competing `.selected` visual.

Clearing follows the spec: same card, empty pane, Escape (selection first, grid second), user switch, Back, and a new node set. Layout, reference and minimap toggles and status-only refreshes keep the selection because the resets key only on node-array identity and the selected user.

<details>
<summary>Issues (2)</summary>

1. **Tab-traversal re-run coverage (possible)**: only dense 1000x700 LR was re-run after the Tab cap was raised, and the other three dense combos were not. Optional follow-up, not blocking.
2. **Provider indentation (confirmed, cosmetic)**: the `SelectionContext.Provider` wrapper in `AccessGraphCanvas.tsx` is not re-indented. Lint is clean, so this is optional.

</details>

<details>
<summary>Details</summary>

### Lineage walk and upstream exclusion

`walkLineage` builds a source->edges map and does a BFS with a visited-node set. It collects every edge leaving a visited node, so shared downstream edges appear once, cycles terminate, and the incoming edge and upstream parent->item reference edges are never included. `highlightEdges` also deletes the selected edge id from the lineage set. Seeds are limited to the item's outgoing edges, which matches "incoming user->item edge + all visible downstream lineage edges". An entitlement that is also nested under a held role keeps its own card as first-level. Selecting the role lights the nested path through it (confirmed by the "bothlevels" screenshots), and selecting the entitlement does not light the role edges above it. The one-line upstream change is documented in the module header.

### Composition with hover

With nothing selected, or when the selected node has no incoming status edge, `highlightEdges` returns exactly `emphasizeEdges(...)`. That keeps the same-array identity for null. `emphasizeEdges` was refactored onto the exported `incomingStatusEdge`, `raiseEdge` and `dimEdge`, and the output is equivalent, so the existing emphasis tests are the regression guard (the coder reports them passing unchanged). With a selection, hovering a different first-level item raises its edge as a preview, and hovering the selected item adds nothing. Each edge is classified once in a single `map`, with the order selected, then lineage, then preview, then dim, so no edge carries two treatments.

### Visuals and pointer behavior

The selected user->item edge keeps its own stroke and dash and goes to 3.5 and z-index 10. Lineage edges are solid, 2.5, opacity 1, and use `STATUS_STROKE[aggregated status]` (same four `--vc-*` tokens as the scene). Selected and lineage edges are added to the `pointer-events: none !important` rule, so raised edges cannot steal the pointer from the cards beneath them. The selected-card ring is a neutral `--ink` outer ring with a `--canvas` gap, placed after and specific enough to beat the status `:hover` rules. The status ring, stripe, icon and `:focus-visible` rules are untouched. Reference cards in lineage are at opacity 1 and the others at 0.45. Reference cards still do not get a status icon, because the icon is rendered only when `data.reviewStatus` exists.

### Accessibility

First-level cards get `role="button"`, `aria-pressed`, the unchanged `Kind: label` name, and `aria-describedby` pointing at the status icon so the status is still announced. Space calls `preventDefault`. A second sr-only live region message announces "Highlighting the links for X. Press Escape to clear." and "Selection cleared.". User and reference cards in drill-down stay non-interactive, and grid cards use the untouched grid branch.

### React Flow selection

`elementsSelectable={false}` removes `.selected`/`.selectable` and makes edges inert. `onNodeClick` still fires, so grid drill-in and drill-down toggling work. `onPaneClick` clears the selection. The browser evidence shows no card keeps focus after a pane click, so the focus-emphasis caveat from the plan did not materialize and no blur code was added.

### Invariants and scope

The diff touches only the 8 planned `src/graph` files. `package.json` and `package-lock.json` are not in the diff. The worktree root contains no harness, driver or puppeteer artifacts, and git status is clean aside from ignored `dist` and `node_modules`. None of the DO-NOT-CHANGE modules appear in the diff. `activeItemId` is memoized on `scene.nodes`, and `displayEdges` depends on `scene.edges`, `activeItemId`, `emphasisId` and `inDrilldown`. Selection does not enter `scene`, `fitKey` or the fit effect. The browser evidence shows node and viewport transforms byte-identical across select, deselect and preview (124/124 and 124/124).

### Test and verification evidence

The new unit tests are `selectEdges.test.ts` (25) and `AccessGraphCanvas.selection.test.tsx` (23). `verification.md` records `npm run build` clean, `npm run lint` clean, and `npm test` at 43 files / 444 tests green, all run after teardown. It also records the S1-S10 real-Chrome runs (3717 pass / 6 fail of 43 assertion kinds). The 6 failures were explained and resolved: the Tab cap was a driver limit, and the sub-pixel 2.5px strokes at ~0.4 zoom were re-run at deviceScaleFactor 2 and passed. A set of screenshots covering baseline, role/entitlement selection, TB, hidden reference, both-levels, hover preview, keyboard focus, dark and dense is present in the task directory. I did not re-run any suite, per instructions.

</details>

<details>
<summary>File map</summary>

- `src/graph/selectEdges.ts` (new): pure lineage walk and `highlightEdges`
- `src/graph/selectEdges.test.ts` (new): helper unit tests
- `src/graph/SelectionContext.ts` (new): selection channel to the cards
- `src/graph/AccessNode.tsx`: toggle-button semantics, selection classes, icon id
- `src/graph/AccessGraphCanvas.tsx`: selection state, resets, Escape ordering, pane click, `elementsSelectable={false}`
- `src/graph/AccessGraph.css`: selected ring, reference dim/lineage opacity, pointer rule
- `src/graph/emphasizeEdges.ts`: building blocks exported, behavior unchanged
- `src/graph/AccessGraphCanvas.selection.test.tsx` (new): component tests

</details>
