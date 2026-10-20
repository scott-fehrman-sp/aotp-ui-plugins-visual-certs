# Review-status marking on the per-user drill-down access graph

The drill-down access graph now tells an approver, at a glance, which of a user's directly-held access items still need review versus which are resolved, while preserving the full explanatory path (user → role? → access profile? → entitlement → source) that shows how an item grants access down to a source. The confusing per-edge "access paths through this link" count badge is removed from this view. Status is computed from a single shared `isItemReviewed` predicate so the graph and the dashboard metrics can never disagree, threaded through the matrix/graph/scene pipeline as additive-optional fields that never enter the dedup key, and marked on exactly one node and one edge per path (the user's first hop) with a legend and text chips so it does not rely on color alone. The all-users grid overview is untouched.

Watch for: nothing blocking. The implementation matches the plan and every acceptance criterion is covered by a test the coder ran green. (confirmed)

**Verdict**: APPROVED

## High-level view

The "complete vs needs review" rule was previously inlined in `computeMetrics`. It is now extracted into `isItemReviewed(item)` in `domain/metrics.ts` and called from both `computeMetrics` and the matrix mapper, so the dashboard count and the graph marking share one definition of "reviewed" (decision recorded, completed, or reassigned).

Status and access-item identity ride through the pipeline as optional fields (`reviewStatus`, `accessItemKind`, `accessItemId`) stamped on every row an item produces, modeled exactly on the existing department/location enrichment. They are explicitly excluded from `rowKey`, so row and node counts stay invariant; the one place status participates in dedup is a needsReview-wins merge so outstanding work is never hidden behind a "complete" mark.

The graph derivation marks status on precisely one place per path: the user's first hop (`levels[1]`), guarded by a kind match against the review item's own access-item kind so a degenerate `access`-only row never bleeds a mark onto a downstream node. Needs-review wins on collision. Deeper hops stay neutral.

Rendering carries two signals per state so it is not color-only: the user→item edge gets a dashed amber (needs review) or solid green (complete) stroke, and the access-item node card gets a colored ring plus a text chip ("Needs review" / "Reviewed") with an `aria-label` and a `data-review-status` hook. A drill-down-only legend panel names both states.

The count badge is fully removed: `AccessCountEdge.tsx` is deleted, the `edgeTypes` registry and `edgeTypes` prop are gone, and the scene builder emits plain edges with no `type: 'accessCount'`, no `pathCount` payload, and no label. `pathCount` remains in the data model (`accessGraph.ts` still accumulates it) but drives no rendering, matching the requirement.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking issues identified. All acceptance criteria are met and covered by tests.

</details>

<details>
<summary>Details</summary>

### Edge count badge removed from the drill-down

The removal is complete and clean. `src/graph/AccessCountEdge.tsx` is deleted. `AccessGraphCanvas.tsx` drops both the `import { AccessCountEdge }` and the `const edgeTypes = { accessCount: AccessCountEdge }` registry, and removes the `edgeTypes={edgeTypes}` prop from `<ReactFlow>`. `buildAccessScene.ts` no longer sets `type: 'accessCount'`, no longer attaches `data.pathCount`, and emits no count label; the old `pathCount > 1 ? 2.5 : 1.5` stroke-weight branch is gone, replaced by a flat neutral `strokeWidth: 1.5`. The `.vc-graph-edge-badge` CSS block is deleted.

`AccessGraphEdge.pathCount` is retained in the data model and `deriveAccessGraph` still accumulates it (the existing edge-dedup `existing.pathCount += 1` is untouched), which the requirement explicitly permits since other code may read it. The `buildAccessScene.test.ts` assertion was updated rather than deleted: it now asserts no edge has `type === 'accessCount'`, no edge carries `data.pathCount`, and no edge has a label. The `AccessGraphCanvas` test asserts `.vc-graph-edge-badge` is absent after drilling in. (confirmed)

### Full layered path preserved

No layer collapsing was introduced. The `Level` construction in `deriveAccessGraph` is unchanged — role and access profile levels are still pushed when present, entitlement and source on every real leaf row — and edges are still emitted for every consecutive present pair. The `accessGraph.test.ts` cases walk the full user → role → accessProfile → entitlement → source chain and assert each downstream node and edge exists with `reviewStatus === undefined`, which simultaneously confirms the path is intact and that only the first hop is marked. (confirmed)

### Review status on the first hop, shared predicate

`isItemReviewed(item)` returns `item.completed || item.decision != null || item.reassigned === true`. `computeMetrics` now calls it in place of the former inlined `item.completed || item.decision || item.reassigned`. The inlined form used truthiness on `item.decision`; the extracted form uses `!= null`. These agree for the decision domain in play (a decision is a non-empty string or absent), so the dashboard counts are preserved — the coder's full `npm test` run, which includes `metrics.test.ts`, is green, confirming no behavioral drift. Graph status derives from the same predicate via the matrix mapper (`isItemReviewed(item) ? 'complete' : 'needsReview'`), satisfying the requirement that graph and dashboard reuse the same reviewed predicate. (confirmed)

The mark lands on exactly one node and one edge per path. `deriveAccessGraph` takes `levels[1]` (the first hop off the user) and marks it only when `row.accessItemKind !== undefined && accessItemLevel.kind === row.accessItemKind`. The kind guard is the right safety: a role review item whose role cell is blank on some expanded path would have a non-role `levels[1]`, and the guard correctly declines to mark it. The degenerate `access`-kind row carries `accessItemKind === undefined`, so it never marks anything — covered by the "leaves status undefined everywhere for a degenerate access row" test. (confirmed)

needsReview-wins is implemented in two places and tested in both. In the graph, `markStatus` refuses to downgrade a node/edge already set to `needsReview`, so a shared access-item node reached from a complete and an incomplete row ends up `needsReview` (tested). In the matrix dedup merge, when an incoming tuple is `needsReview` and the existing row is `complete`, the existing row flips to `needsReview`; the reverse case leaves the existing `needsReview` untouched. Both orderings are covered by dedicated tests and both assert the surviving row reports `needsReview`. (confirmed)

### Additive-optional threading, dedup invariant

`reviewStatus`, `accessItemKind`, and `accessItemId` are optional on `AccessMatrixRowVM` (and `reviewStatus` optional on `AccessGraphNode`, `AccessGraphEdge`, `AccessSceneNodeData`), documented as enrichment-only and never part of `rowKey`. They are folded into `base` in `expandItem` so they land on every row the item produces, mirroring the `userDepartment`/`userLocation` pattern. The "keeps row count and ids invariant" test resolves the worked example with and without decisions and asserts the same 6 rows and the same sorted ids, confirming the new fields do not perturb dedup identity. (confirmed)

### Accessibility — not color alone

Two independent signals per state. The edge uses stroke color plus line pattern (dashed for needs review, solid for complete). The node card uses a colored ring/left-border plus a text chip ("Needs review" / "Reviewed") rendered with an `aria-label` ("Review status: …") and a `data-review-status` attribute. The legend repeats both states as swatch + text. The Canvas test queries the chips by their accessible label and the legend by its `role="group"` name, so the non-color signals are exercised, not just the styling. (confirmed)

### Grid overview unchanged

`buildUserGridScene.ts` is not in the commit. Grid user cards never receive a `reviewStatus`, the legend panel is gated behind `inDrilldown`, and the Canvas test asserts the legend is absent in grid mode and present only after drilling in. The grid-mode tests are unchanged and pass in the full run. (confirmed)

### Verification evidence

The commit message records `npm run build` (tsc -b && vite build) clean with zero type errors, `npm run lint` (eslint .) clean, and `npm test` green (31 files, 216 tests), with a note that the known `useProvenance.test.ts` flake did not recur. Per the review instructions this evidence is accepted as recorded; no narrow spot-check was warranted because nothing in the diff left a specific articulable doubt — the `isItemReviewed` truthiness-vs-`!= null` change is the only behavioral subtlety and it is covered by the green metrics suite. (confirmed)

</details>

<details>
<summary>File map</summary>

- `src/domain/metrics.ts` — extract shared `isItemReviewed` predicate; `computeMetrics` calls it.
- `src/sailpoint/types.ts` — add `AccessReviewStatus`; optional status/identity fields on row, node, edge, scene-node.
- `src/sailpoint/accessMatrix.ts` — stamp status + access-item identity on every row; needsReview-wins dedup merge.
- `src/domain/accessGraph.ts` — mark status on the user's first-hop node + edge only, kind-guarded, needsReview-wins.
- `src/graph/buildAccessScene.ts` — thread status into scene node data + user→item edge; remove all count-badge wiring.
- `src/graph/AccessNode.tsx` — status chip + card accent class on both node branches.
- `src/graph/AccessGraphCanvas.tsx` — drop `edgeTypes` registry/prop; add drill-down legend panel.
- `src/graph/AccessGraph.css` — chip/ring/edge-stroke/legend styles; remove old edge-badge CSS.
- `src/graph/AccessCountEdge.tsx` — deleted.
- `src/domain/accessGraph.test.ts`, `src/graph/buildAccessScene.test.ts`, `src/sailpoint/accessMatrix.test.ts`, `src/graph/AccessGraphCanvas.test.tsx` — new/updated coverage.

Full diff: `git show 73a854d3` in the `review-status-graph` worktree.

</details>
