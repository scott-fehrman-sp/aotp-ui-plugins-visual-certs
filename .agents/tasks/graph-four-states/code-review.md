# Four-state review model for the per-user drill-down access graph

Widens the drill-down access graph's review-status model from three states (`needsReview | complete | delegated`) to four (`needsReview | approved | revoked | reassigned`), splitting the old `complete` into `approved` (kept) and `revoked` (removed) and renaming `delegated` to `reassigned`. The change is threaded end to end through a single source of truth (`reviewStatusOf`) into the matrix dedup, graph derivation, scene edge styling, node corner icon, and drill-down legend, so the dashboard metrics and the graph can never disagree on whether an item is reviewed. The edge switch and the node's icon maps are made exhaustive `Record`s over the widened union, turning any missed state into a compile error. Tests were updated across all six touched layers plus the canvas RTL drill-down.

Watch for: the bare-`completed`-without-`decision` fallback in `reviewStatusOf` maps to `'approved'` (confirmed; documented as unreachable). The plan flagged this as an item for the orchestrator to confirm with the user — `approved` vs `revoked` is cosmetic since the corner can't occur with current data, but it is a user-facing status word (possible). Everything else lands exactly on the plan.

**Verdict**: APPROVED

## High-level view

The model widening is anchored in `reviewStatusOf` (metrics.ts), which keeps its four-way precedence (reassigned terminal > REVOKE > APPROVE > defensive-completed > needsReview) using the same string-literal decision comparison the rest of the file already uses, and `isItemReviewed` stays derived from it so `computeMetrics` is untouched and the reviewed/remaining counts are unchanged.

Status stays out of the dedup/row identity in both the matrix (`accessMatrix.ts`) and the graph (`accessGraph.ts`). A shared `REVIEW_STATUS_RANK` lookup (`needsReview > reassigned > revoked > approved`) resolves collisions identically in both places, so a row, its node, and its user→item edge always agree on which status survives, independent of row order. Counts and ids are invariant.

The scene builder's `edgeStyle` switch is exhaustive over the four states with the specified tokens (needsReview amber-dashed, approved green-solid, revoked red-solid, reassigned blue-dotted) and draws no count badge. Approved vs revoked differ by color only on the thin edge; the node carries the shape distinction.

The node (`AccessNode.tsx`) renders four distinct non-color-only SVG shapes, each with `role='img'` + `aria-label` + `<title>` + `data-review-status`, via complete `Record<AccessReviewStatus,...>` maps. The name and kind caption still render in both the interactive (grid) and read-only (drill-down) branches. The drill-down legend has four entries; the grid overview is untouched.

<details>
<summary>Issues (1)</summary>

1. **Defensive-completed fallback word** — `reviewStatusOf` maps the unreachable bare-`completed`-without-`decision` corner to `'approved'`. The plan asked the orchestrator to confirm `approved` (vs `revoked`) with the user. Non-blocking: the corner cannot occur with current data and is documented as such; confirm the word if desired.

</details>

<details>
<summary>Details</summary>

## reviewStatusOf as the single source of truth

`reviewStatusOf` (metrics.ts) reads `reassigned === true` first and returns `'reassigned'` even when a decision was also recorded, which keeps reassignment terminal for this reviewer. It then maps `decision === 'REVOKE'` → `'revoked'` and `decision === 'APPROVE'` → `'approved'` using the same string-literal comparison `computeMetrics` already uses, so no enum import was introduced. `isItemReviewed` stays `reviewStatusOf(item) !== 'needsReview'`, so approved, revoked, and reassigned all count as reviewed. `computeMetrics` is unchanged and its approved/revoked/reassigned split still reads off the raw item, which the updated `computeMetrics` tests confirm.

The defensive `if (item.completed) return 'approved'` branch carries a comment marking it unreachable with current data (the data layer sets `decision` whenever `completed` is true) and explaining the `approved` choice as the non-destructive reading that mirrors the old `complete` mapping. This is the one item the plan explicitly flagged for user confirmation. It is non-blocking — the branch can't execute against real data — but the word is user-facing, so it is worth a confirmation if the orchestrator hasn't already settled it.

## Status kept out of identity, with a shared collision rank

Both `accessMatrix.ts` and `accessGraph.ts` define an identical `REVIEW_STATUS_RANK` (`needsReview: 3, reassigned: 2, revoked: 1, approved: 0`) and overwrite an existing status only when the incoming one strictly outranks it. `rowKey` is unchanged and contains none of the enrichment fields, so the row count and ids stay invariant — the `keeps row count and ids invariant` test and the two collision tests (approved-vs-reassigned both orders → reassigned, revoked-vs-approved → revoked, needsReview-wins) verify this. Because the rank is strict-greater and total, the merge is order-independent, which is what makes the matrix row and the graph node/edge agree.

```
REVIEW_STATUS_RANK  needsReview(3) > reassigned(2) > revoked(1) > approved(0)
   matrix merge  ─┐
   node markStatus ├─ same lookup, strict-greater overwrite ⇒ order-independent agreement
   edge markStatus ─┘
```

In `accessGraph.ts`, status is stamped only on `levels[1]` (the first hop off the user) and the `levels[0]|levels[1]` edge, guarded by `row.accessItemKind !== undefined && accessItemLevel.kind === row.accessItemKind`, so a degenerate `access` row never marks a downstream node and deeper hops stay neutral. The accessGraph tests cover approved, revoked, and reassigned on the direct item plus needsReview-wins over both reassigned and approved.

## Exhaustive edge styling, no count badge

`buildAccessScene.ts`'s `edgeStyle` is a `switch` over `NonNullable<...reviewStatus>` with one case per state and no `default`, so dropping a state would be a compile error. The tokens match the plan: `needsReview` amber `6 4` dashed, `approved` solid `--vc-allow`, `revoked` solid `--vc-deny`, `reassigned` `--vc-accent` `2 3` dotted. `pathCount` is read nowhere in the render path and the `renders no count badge` test asserts no count edge type, no `pathCount` data, and no count label. The block comment documents that approved vs revoked differ by color only on the edge, with the node icon carrying the shape.

## Four non-color-only node icons with accessible names

`STATUS_ICON_LABEL` and `STATUS_ICON_SHAPE` in `AccessNode.tsx` are complete `Record<AccessReviewStatus, ...>` maps, so a missing state is a type error. The four shapes are genuinely distinct: hollow exclamation circle (needsReview), check (approved), crossed strokes / X (revoked), hand-off arrow (reassigned) — the revoked X is visually distinct from the approved check, not a recolor. Each `StatusIcon` sets `role='img'` + `aria-label` + `<title>` + `data-review-status` in the non-decorative branch and switches to `aria-hidden` in the decorative (legend) branch. Both the interactive and read-only card branches still render `vc-graph-card-label` and `vc-graph-card-kind`, so the name + kind caption did not regress. The canvas RTL test fetches all four icons by accessible name and asserts their `data-review-status`.

The `AccessGraph.css` card-accent, icon-color, and edge rules were renamed/extended to the four states with the matching tokens, and the legend swatch helpers carry all four for parity. The drill-down legend in `AccessGraphCanvas.tsx` lists the four states in order inside the `inDrilldown` panel; the grid overview path renders no legend, which the test confirms (`queryByRole('group', { name: /review status legend/i })` is null in grid mode).

## Test coverage

Covered: `reviewStatusOf` for all four states plus the defensive fallback and `isItemReviewed`; `computeMetrics` approved/revoked/reassigned split and the campaign-count fallback; matrix stamping for approved/revoked/needsReview/reassigned, the two collision orders, the defensive revoked-vs-approved collision, needsReview-wins, and the row-count/ids invariant; graph marking for all four states on the direct item plus needsReview-wins and the degenerate no-mark row; scene edge styling for all four states plus the no-badge assertion and deeper-edges-neutral; and the canvas drill-down (four icons by accessible name, four-entry legend, no chip, no count badge, grid shows none).

Not tested (acceptable): the unreachable defensive-completed fallback has no dedicated graph/scene test, which is fine since it can't occur with real data and is asserted at the `reviewStatusOf` unit level.

## Verification evidence

The commit records `npm run build` (tsc -b && vite build) PASS with zero type errors, `npm run lint` (eslint .) clean, and `npm test` (vitest run) 237 tests across 32 files with 0 failures, with the known `useProvenance.test.ts` flake noted as not failing. The exhaustive `Record` maps and the no-`default` edge switch mean a type-level regression would have surfaced in that build, so the evidence is consistent with the diff reviewed here. Evidence accepted; suites not re-run per the review contract.

<details>
<summary>Files changed</summary>

- `src/sailpoint/types.ts` — `AccessReviewStatus` union widened to four states; JSDoc updated on the type and the four carrying fields.
- `src/domain/metrics.ts` — `reviewStatusOf` four-state precedence + documented defensive fallback; `isItemReviewed` unchanged; `computeMetrics` untouched.
- `src/sailpoint/accessMatrix.ts` — status kept out of `rowKey`; `REVIEW_STATUS_RANK` collision merge.
- `src/domain/accessGraph.ts` — `markStatus` rank-based precedence; stamps direct access-item node/edge only.
- `src/graph/buildAccessScene.ts` — exhaustive four-state `edgeStyle`; no count badge.
- `src/graph/AccessNode.tsx` — four distinct icon shapes with a11y wiring; complete `Record` maps; name/kind caption preserved.
- `src/graph/AccessGraph.css` — four-state card/icon/edge/legend classes with reused tokens.
- `src/graph/AccessGraphCanvas.tsx` — four-entry drill-down legend; grid overview unchanged.
- `*.test.ts(x)` — metrics, accessMatrix, accessGraph, buildAccessScene, and AccessGraphCanvas tests updated to the four states.

Full diff: `git -C .worktrees/four-states diff main...feature/graph-four-states`

</details>

</details>
