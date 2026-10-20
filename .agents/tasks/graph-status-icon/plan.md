# Implementation Plan — Three-state access-item status icon (drill-down graph)

All paths are absolute under the worktree
`/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/status-icon`.
Build/test commands (from `package.json`): `npm run build` (= `tsc -b && vite build`),
`npm run lint` (= `eslint .`), `npm test` (= `vitest run`). To run a single test file:
`npx vitest run <path>`.

## Verification of the brief's diagnosis (confirmed against code)

- `AccessReviewStatus = 'needsReview' | 'complete'` — `src/sailpoint/types.ts:209`. The same union is
  re-documented on `AccessMatrixRowVM.reviewStatus`, `AccessGraphNode.reviewStatus`,
  `AccessGraphEdge.reviewStatus`, `AccessSceneNodeData.reviewStatus`. CONFIRMED.
- `isItemReviewed(item)` in `src/domain/metrics.ts` is the single source of truth
  (`completed || decision != null || reassigned === true`), used by `computeMetrics` AND by
  `expandItem` in `src/sailpoint/accessMatrix.ts` (`isItemReviewed(item) ? 'complete' : 'needsReview'`).
  CONFIRMED.
- `.vc-graph-card` is a fixed 64px box (`NODE_HEIGHT = 64` in `src/graph/buildAccessScene.ts`),
  `display:flex; flex-direction:column; justify-content:center` in `src/graph/AccessGraph.css`, and
  `AccessNode.tsx` stacks label + kind caption + `StatusChip` — three rows crowd the name. CONFIRMED.
- The `StatusChip` + `.vc-graph-card-status-*` accent + `.vc-graph-status-chip*` CSS all exist as
  described; the legend in `src/graph/AccessGraphCanvas.tsx` has exactly two entries. CONFIRMED.
- Blue reassign precedent: `--vc-accent` (`src/index.css`) is used by `MetricCard` `data-tone='reassign'`
  (`src/components/MetricCard.css`) and `DecisionBar` reassign bar (`src/components/charts/DecisionBar.tsx`).
  CONFIRMED — `delegated` edge/icon will reuse `--vc-accent`.
- `card` is `position: relative` already (`.vc-graph-card` in `AccessGraph.css`), so an absolutely
  positioned corner icon needs no new positioning context. CONFIRMED.

Discrepancy / note: the brief says `isItemReviewed` is `completed || decision != null || reassigned`.
That matches the code. No discrepancies found; the file list in the brief is accurate and complete.

## Design decisions (made here, grounded in code)

1. **Three-way mapping precedence** (`reviewStatusOf`): `reassigned === true` → `'delegated'`
   FIRST (terminal for this reviewer), else `completed === true || decision != null` → `'complete'`,
   else `'needsReview'`. An item both reassigned and decided → `'delegated'`.
2. **`isItemReviewed` stays boolean and unchanged in behavior**; dashboard counts are invariant
   (`complete` and `delegated` both count as reviewed). Implement it as
   `reviewStatusOf(item) !== 'needsReview'` so the two helpers can never diverge.
3. **Dedup precedence stays `needsReview`-wins**; `reviewStatus` is never in `rowKey`. For a
   `complete`-vs-`delegated` collision on one access item (not expected), pick `'delegated'` as the
   deterministic winner (reassignment is terminal) — documented in the merge comment.
4. **Icons** (shape differs, not color-only; each gets an accessible name via `aria-label` + `<title>`):
   - `needsReview` → hollow circle with an exclamation (warning), label "Needs review", color `--vc-warn`.
   - `complete` → check mark, label "Completed", color `--vc-allow`.
   - `delegated` → forward/hand-off arrow, label "Delegated", color `--vc-accent`.
   Local inline-SVG set in the graph folder (no icon module exists under `src/components`).
5. **Card accent**: keep the subtle left-border/ring accent (`.vc-graph-card-status-*`) as a secondary
   signal, add the `delegated` variant in `--vc-accent`; the corner icon is the PRIMARY signal.
6. **Edge styling for `delegated`**: solid stroke in `--vc-accent`, distinct dash `2 3` (dotted) to
   differ from needsReview's `6 4` dash and complete's solid; no count badge (stays removed).

## Ordered items

- [ ] 1. Widen the status model + add the three-way helper.
      In `src/sailpoint/types.ts` widen `AccessReviewStatus` to
      `'needsReview' | 'complete' | 'delegated'` and update its JSDoc plus the `reviewStatus` docs on
      `AccessMatrixRowVM`, `AccessGraphNode`, `AccessGraphEdge`, `AccessSceneNodeData` to mention the
      third state and the precedence. In `src/domain/metrics.ts` add a pure
      `reviewStatusOf(item: ReviewItemVM): AccessReviewStatus` (import the type from `../sailpoint/types`)
      implementing the precedence from decision #1, and re-express `isItemReviewed` as
      `reviewStatusOf(item) !== 'needsReview'` (behavior unchanged).
      Files: `src/sailpoint/types.ts`, `src/domain/metrics.ts`
      Verify: `npx vitest run src/domain/metrics.test.ts` passes; `npm run build` has zero type errors.

- [ ] 2. Stamp the three-way status in the matrix pipeline.
      In `src/sailpoint/accessMatrix.ts` replace the inline `isItemReviewed(item) ? 'complete' : 'needsReview'`
      in `expandItem` with `reviewStatusOf(item)` (update the import from `../domain/metrics`). Keep
      `reviewStatus` out of `rowKey`/dedup. In `resolveMatrix`'s merge, keep `needsReview`-wins and add the
      `complete`-vs-`delegated` tie rule (delegated wins) per decision #3; update the merge comment.
      Files: `src/sailpoint/accessMatrix.ts`
      Verify: `npx vitest run src/sailpoint/accessMatrix.test.ts` — adjust the existing
      "stamps reviewStatus…" test so the reassigned entitlement item expects `'delegated'` (was `'complete'`);
      add cases: decided→`complete`, undecided→`needsReview`, reassigned→`delegated`,
      reassigned+decided→`delegated`; row count/id invariance and needsReview-wins unchanged.

- [ ] 3. Carry the third state through the graph derivation.
      In `src/domain/accessGraph.ts` the `markStatus` helper already uses `needsReview`-wins; widen its
      handling so `delegated`/`complete` both apply when nothing set `needsReview`, preserving
      `needsReview`-wins. No signature change needed (it already takes `AccessReviewStatus | undefined`).
      Files: `src/domain/accessGraph.ts`
      Verify: `npx vitest run src/domain/accessGraph.test.ts` — add a case stamping `'delegated'` onto the
      user's direct node + user→item edge only (deeper nodes/edges undefined); existing needsReview-wins and
      complete cases still pass.

- [ ] 4. Thread the third state into the scene + edge styling; keep count badge removed.
      In `src/graph/buildAccessScene.ts` the node `data.reviewStatus` already passes through; extend the edge
      styling switch so three statuses map to three strokes: needsReview = `--vc-warn` dashed `6 4`,
      complete = `--vc-allow` solid, delegated = `--vc-accent` dotted `2 3` (per decision #6). Keep the
      `vc-graph-edge-${status}` className scheme. No `pathCount` badge.
      Files: `src/graph/buildAccessScene.ts`
      Verify: `npx vitest run src/graph/buildAccessScene.test.ts` — add an assertion that a `delegated`
      user→item edge carries `className` `vc-graph-edge-delegated`, `data.reviewStatus === 'delegated'`,
      `style.stroke === 'var(--vc-accent)'`, and a dotted dash; existing needsReview/complete edge + node
      tests unchanged; still no `.vc-graph-edge-badge`.

- [ ] 5. Replace the chip with a three-state corner icon in the node.
      In `src/graph/AccessNode.tsx` delete `StatusChip` + `STATUS_CHIP_LABEL` and their usages in both the
      interactive and read-only card branches. Add a local inline-SVG `StatusIcon` component mapping the three
      statuses to the three shapes from decision #4, each with `aria-label` + `<title>` ("Needs review" /
      "Completed" / "Delegated") and a stable `data-review-status` hook; render it as the last child of the
      card (absolutely positioned bottom-right). Ensure label + kind caption both render (the name must show on
      every access-item node). Keep the `statusClass` accent (now including `delegated`).
      Files: `src/graph/AccessNode.tsx`
      Verify: part of item 7's RTL run; `npm run build` zero type errors (watch the status→icon map is
      exhaustive over the three-member union).

- [ ] 6. Update the CSS: remove chip rules, add corner-icon + delegated accent/edge/legend styles.
      In `src/graph/AccessGraph.css` delete `.vc-graph-status-chip*`. Add `.vc-graph-status-icon` (absolute,
      `bottom`/`right` offsets, small box, pointer-events none) and per-status color rules. Add
      `.vc-graph-card-status-delegated` (left-border + ring in `--vc-accent`). Add
      `.vc-graph-wrap .react-flow__edge.vc-graph-edge-delegated .react-flow__edge-path` (stroke `--vc-accent`,
      dotted). Add legend swatch `.vc-graph-legend-swatch-delegated`. Confirm `.vc-graph-card` stays
      `position: relative` and the label row is no longer crowded (two rows now).
      Files: `src/graph/AccessGraph.css`
      Verify: `npm run build`; visual rules exercised indirectly by item 7's RTL tests (icon present, classes).

- [ ] 7. Update the drill-down legend to three entries and adjust component tests.
      In `src/graph/AccessGraphCanvas.tsx` change the legend from two rows to three (Needs review / Completed /
      Delegated), each rendering its status icon + label; keep it drill-down-only. In
      `src/graph/AccessGraphCanvas.test.tsx` update the "marks review status…" test: assert the NAME renders on
      each access-item node, the chip is GONE (`queryByLabelText('Review status: Needs review')` null / no
      `.vc-graph-status-chip`), the status ICON is present with the right accessible name
      (`getByLabelText('Needs review')`, `'Completed'`, `'Delegated'`), and the legend lists all three. Reuse
      the scoped `stubRect` pattern; do NOT add a global `getBoundingClientRect` stub. Grid-mode tests must pass
      unchanged.
      Files: `src/graph/AccessGraphCanvas.tsx`, `src/graph/AccessGraphCanvas.test.tsx`
      Verify: `npx vitest run src/graph/AccessGraphCanvas.test.tsx` all green.

- [ ] 8. Full integration pass.
      Run the whole suite + build + lint. Fix any non-exhaustive switch/map the compiler flags from the widened
      union. Do not weaken tests except those asserting the removed chip text or the 2-state assumption.
      Files: (whatever the above require)
      Verify: `npm run build` zero type errors, `npm run lint` clean, `npm test` all green (known flake:
      `src/state/useProvenance.test.ts` can fail only under full-suite load — re-run it in isolation to confirm:
      `npx vitest run src/state/useProvenance.test.ts`).

## Known constraints

- Do NOT add a global `getBoundingClientRect` stub (broke the Recharts dashboard test); use the scoped
  `stubRect` helper already in `AccessGraphCanvas.test.tsx`.
- Grid-mode (all-users overview) behavior and tests stay unchanged — status icons/legend are drill-down-only.
- Dashboard metric counts must stay invariant (`complete` + `delegated` both count as reviewed).
