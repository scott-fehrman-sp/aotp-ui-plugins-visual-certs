# Hide / show completed access items in the access graph control panel

The change adds a fourth control-panel button (Layout, Reference, Completed, Minimap) that hides first-level access items whose aggregated status is approved, revoked or reassigned. It uses a new pure helper, `withoutCompleted`, that drops the completed user-to-item edges and keeps only what is still reachable from the user node. The canvas applies it before `withoutReference`, re-lays out the filtered graph and refits once through `fitKey`. Completed items are shown by default and the preference lives in memory.

Watch for: nothing blocking. Two nits (see Issues), both non-blocking.

**Verdict**: APPROVED

## High-level view

Hiding is reachability pruning rather than descendant deletion. Lineage shared with a visible needs-review item stays, and lineage or sources reached only through hidden items disappear. An entitlement that is both completed first-level and nested under a visible item stays as a muted reference-only card with its status removed. It still counts as hidden.

The canvas computes the filter result whether or not completed items are shown, so the hidden count is always available for the label and announcement. Completed is applied first, then reference. The flag is part of `sceneKey` (clears stale hover) and `fitKey` (exactly one refit per toggle). The scene builder, `fitPadding` and `userSubgraph` are untouched, so lane order and gap-free packing come from the existing code.

The button is disabled in the grid with the explanatory label, `aria-pressed` means shown, the icon swaps to a dimmed, struck variant, and toggles announce through the existing live region. If every item is complete, a separate top-center note appears. It is computed from the unfiltered subgraph, so it never collides with the genuine-empty note.

<details>
<summary>Issues (2)</summary>

1. **Hidden-state icon legibility (possible, nit)** — in `15-toolbar-hidden.png` the dimmed circle and check are close to invisible, so the struck icon reads as a plain "no" glyph. Optional: raise the dim opacity from .4 to about .55. Not blocking.
2. **JSDoc line wrap (confirmed, nit)** — in the `AccessGraphCanvas.tsx` header comment, the new sentence leaves "Selecting" alone on a short line. Reflow it.

</details>

<details>
<summary>Details</summary>

## What was checked, against the eight points

I read the whole diff of `completedFilter.ts`, `AccessGraphCanvas.tsx`, `GraphControls.tsx` and `ControlIcons.tsx`, and checked the test file list. I did not re-run any suite. The evidence is `verification.md` (build, lint and `npm test` twice, 44 files / 490 tests, plus the browser run with 3165 checks and 0 failures) and the committed screenshots. I viewed `02-mixed-hidden-1700.png` and `15-toolbar-hidden.png`.

**Completed definition (1).** `isCompletedEdge` requires `firstLevel` and a status of approved, revoked or reassigned. needsReview, a missing status and a mixed item (which aggregates to needsReview) never match. Confirmed in `completedFilter.ts`.

**Reachability pruning (2).** The helper drops the completed edges and runs a BFS from the user nodes over the remaining edges. Visited nodes and edges whose source was visited are kept, in input order. Shared lineage therefore stays, and orphaned lineage and sources go. A kept node that no longer has a kept first-level status edge loses `reviewStatus` and `reviewMixed`, so `isReferenceNode` is true and it renders as a muted, non-selectable nested card. In the screenshot, "Shared" is exactly that: a muted card with a single incoming edge from Role B and no status ring. `hiddenCount` is the number of distinct targets of completed edges, so the demoted item counts. When nothing is completed the same graph object is returned, which keeps the memo stable.

**Apply order (3).** In `visibleGraph`, `base = showCompleted ? subgraph : completedResult.graph`, then `withoutReference(base)`. Confirmed.

**Default and persistence (4).** `useState(true)` is held in `CanvasSurface` and is not reset on user change or on grid and drill-down switches.

**Grid disabled (5).** `disabled={!inDrilldown}` and the label `Completed items (open a user to filter)`. In the grid `aria-pressed` still reflects the stored preference, the same as the sibling buttons.

**Button, labels, announcements (6).** The button sits between Reference and Minimap. The label is "Hide completed items" when shown and "Show completed items (N hidden)" when hidden, with no suffix when the count is null. Announcements are `Completed items hidden (N).` and `Completed items shown.`. The icon swaps between `completed` and `completedHidden`, with `data-icon` added for tests. Keyboard and focus were covered in the browser run (C11).

**Edge cases (7).**
- `isDegenerate` is still judged on the unfiltered subgraph.
- `allCompletedHidden` is judged from the completed result before the reference filter, so toggling reference cannot swap the notes. The two notes are mutually exclusive.
- `activeItemId` is derived from `scene.nodes`, and the render-phase `setSelectedItemId(null)` is guarded by `!showCompleted`. A hidden or demoted selection is dropped and does not return on show, while a visible selection is untouched.
- `itemCount` and the readable-zoom decision read the filtered `scene`. The flag is in `fitKey`, so there is one refit per toggle.
- The legend is unchanged. The screenshot shows four statuses plus Reference Only.

**DO NOT CHANGE (8).** `git diff main --name-only` lists only `src/graph` files: the new helper and its test, the icon, controls and canvas, and the five canvas and controls test files. `package.json` and `package-lock.json` are untouched. `git status` is clean, and there are no harness files or puppeteer dependency in the worktree; `dist/` is ignored. The single commit is local.

## Residual risks, not blocking

A status-only refresh that makes more items complete while they are hidden updates the scene without a refit. The plan documents this as deliberate. A hovered card that vanishes that way is not specially handled, but `emphasizeEdges` is a no-op for an unknown id.

</details>

<details>
<summary>File map</summary>

- `src/graph/completedFilter.ts`: new pure filter, with predicates, reachability pruning, demotion and the hidden count
- `src/graph/completedFilter.test.ts`: 17 unit tests
- `src/graph/AccessGraphCanvas.tsx`: state, memo chain, keys, selection clear, note, announcements, button props
- `src/graph/GraphControls.tsx`: fourth button and labels
- `src/graph/ControlIcons.tsx`: `completed` and `completedHidden` icons, `data-icon`
- `src/graph/*.test.tsx`: order updates and new tests for controls, canvas, selection, fit, zoom and emphasis

</details>
