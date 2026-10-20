# Verification note (iteration 1, cross-FEAT integration)

Worktree: `.worktrees/review-status-fix`, branch `feature/graph-review-status-fix`, HEAD `bdb9c9a` (base `6ff25ba`). No source changes were needed in this iteration, so no new commit.

## Gates run (cwd = worktree, single-run)
- `npm run build` (tsc -b && vite build): exit 0, zero type errors. Only the existing >500 kB chunk warning.
- `npm run lint` (eslint .): exit 0, clean.
- `npm test` (vitest run): exit 0, 34 files / 261 tests passed. `useProvenance.test.ts` did not flake, so no re-run. Existing recharts "width(0)" stderr noise is pre-existing.

## Hygiene / constraints
- `git status --short`: empty. `git diff 6ff25ba HEAD` for package.json, package-lock.json, `src/domain/accessCounts.ts`, `src/views/CampaignDashboard*`, `src/graph/buildUserGridScene.ts`: empty (untouched).
- `computeMetrics`: only a doc-comment mention changed in `metrics.ts`; no logic change.
- No puppeteer in `node_modules`, no harness html/tsx, no `.tmp-verify.mjs`. `dist` is gitignored.
- `rowKey` (accessMatrix.ts) uses only ids/names of the five-tuple; enrichment is commented as never part of it.
- No `pathCount` badge: `buildAccessScene.test.ts` asserts no custom edge type, no pathCount data, no count label. `pathCount` survives only as a data-layer field on `AccessGraphEdge`.
- No text status chip; no global `getBoundingClientRect` stub (only the scoped `stubRect` on a card element in `AccessGraphCanvas.test.tsx`).
- Status maps exhaustive: `AccessNode.tsx` `STATUS_ICON_LABEL`/`STATUS_ICON_SHAPE` and `metrics.ts` `REVIEW_STATUS_RANK` are `Record<AccessReviewStatus, ...>`; the `edgeStyle` switch in `buildAccessScene.ts` has no default (type-checked exhaustive). `REVIEW_STATUS_RANK` is defined once.
- Screenshots present under `.agents/tasks/review-status-graph/`: `review-status-after.png`, `-after-user2.png`, `-legend.png`, `-first-level-node.png`, `-nested-node.png`, `-long-label-node.png`.

## Root cause -> passing regression test
- Cross-user leak: `userSubgraph.test.ts` "stamps node status only from this user's first-level edge (no cross-user leak)", "a nested-only node carries no status in another user's drill-down", "node status always equals its incoming user edge status across a mixed fixture".
- Stale status without re-resolution: `useAccessMatrix.test.ts` "reflects a decision made after resolution in graph edge status without re-resolving".
- Aggregation / id matching: `reviewOverlay.test.ts` "aggregates several review items ... independent of order", "flags mixed statuses", "matches by the review item's own accessId ...", "falls back to the access name when accessId is null"; `metrics.test.ts` mixed/rank cases.
- First-level edge set == review items: `accessGraph.test.ts` "user->X edges equal exactly the user's review items", "deeper edges never carry a review status or first-level marker"; `accessMatrix.test.ts` zero-entitlement AP and empty role first-level rows.
- Reference styling / z-order: `buildAccessScene.test.ts` "renders status edges above reference edges (zIndex)", "renders deeper edges as muted neutral reference hairlines", "stacks every node above the status edge layer"; `AccessGraphCanvas.test.tsx` nested-only cards carry the reference class and no icon.
- Legend: `AccessGraphCanvas.test.tsx` "legend lists a Reference only entry distinct from the four statuses" and "places the legend in a panel that clears the zoom controls".

## Not re-run
Real-browser harness was not repeated (no rendering change this iteration); FEAT-003's captured screenshots and DOM assertion table stand.

## Open item for the finalizer (report only)
The dashboard "Access items" card counts distinct expanded leaf entitlements, which no longer equals "first-level reviewable items" in the graph.
