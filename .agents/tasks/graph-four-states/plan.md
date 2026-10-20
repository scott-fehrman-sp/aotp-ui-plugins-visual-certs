# Implementation Plan — Four-state review model for the per-user drill-down access graph

Widen the drill-down access graph's review-status model from THREE states
(`needsReview | complete | delegated`) to FOUR
(`needsReview | approved | revoked | reassigned`) and thread the change end to
end: types → single source of truth (`reviewStatusOf`) → matrix expansion →
graph derivation → scene edge styling → node corner icon → drill-down legend.
`complete` SPLITS into `approved` + `revoked`; `delegated` is RENAMED to
`reassigned`. This is a direct extension of the existing 3-state threading
(authored by the `graph-status-icon` task) — extend it exactly; NEVER put
status in the dedup key.

All paths below are relative to the worktree root
`/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/four-states`.
Step agents run with the parent workspace as cwd, so use that absolute prefix
for every file and command.

## Decisions pinned down during exploration (grounded in the code)

- **CertificationDecision values.** `CertificationDecision` is a const object in
  `node_modules/sailpoint-api-client/dist/certifications/api.d.ts`:
  `Approve: "APPROVE"`, `Revoke: "REVOKE"`. `ReviewItemVM.decision` is typed
  `CertificationDecision | null`. The codebase compares it against the STRING
  LITERALS `'APPROVE'` / `'REVOKE'` (see `computeMetrics` in
  `src/domain/metrics.ts`, which already does `item.decision === 'APPROVE'` /
  `=== 'REVOKE'`). `reviewStatusOf` must use the same string-literal comparison,
  not import the enum object.

- **Tokens already exist** in `src/index.css` with light + dark variants — REUSE,
  do not add: `--vc-warn` (amber), `--vc-allow` (green, "approve / keep"),
  `--vc-deny` (red, "revoke / remove"), `--vc-accent` (blue, reassign precedent
  set by MetricCard `data-tone='reassign'` + the DecisionBar reassign bar).

- **Four icon shapes + accessible labels** (non-color-only; each keeps
  `role='img'` + `aria-label` + `<title>` + `data-review-status`):
  - `needsReview` → hollow circle + exclamation (KEEP existing shape) — label
    `"Needs review"`.
  - `approved` → check mark (reuse the old `complete` check path) — label
    `"Approved"`.
  - `revoked` → X / prohibited mark (NEW shape, clearly "removed", visually
    distinct from the check) — label `"Revoked"`.
  - `reassigned` → forward / hand-off arrow (reuse the old `delegated` arrow
    path) — label `"Reassigned"`.

- **Four edge styles** (user→access-item edge only; thin, so approved vs revoked
  differ by COLOR only on the edge — the NODE icon carries the shape
  distinction; this is acceptable and must be documented in the edge-styling
  comment):
  - `needsReview` → `--vc-warn`, `strokeWidth: 2`, `strokeDasharray: '6 4'`
    (unchanged).
  - `approved` → `--vc-allow`, `strokeWidth: 2`, solid.
  - `revoked` → `--vc-deny`, `strokeWidth: 2`, solid.
  - `reassigned` → `--vc-accent`, `strokeWidth: 2`, `strokeDasharray: '2 3'`
    (old `delegated` style, renamed).

- **Bare-completed-without-decision fallback — FLAGGED FOR THE ORCHESTRATOR TO
  CONFIRM WITH THE USER.** The corner `item.completed === true && item.decision
  == null && item.reassigned !== true` cannot occur in practice (the data layer
  populates `decision` whenever `completed` is true), but `reviewStatusOf` must
  stay total. The current 3-state code maps this corner to `'complete'`. Since
  `'complete'` is being removed, a deterministic replacement is required.
  **Chosen default (deterministic, documented): map this corner to `'approved'`**
  — it preserves today's behavior most closely (a bare `completed` was a
  non-reassigned decided state, and "kept" is the non-destructive reading) and
  keeps `isItemReviewed` true for it. The implementer MUST add a code comment
  marking it an unreachable defensive fallback. **Orchestrator: confirm with the
  user that `approved` (vs `revoked`) is the desired fallback before sign-off.**
  Do NOT silently guess beyond this documented default.

- **Defensive dedup / markStatus tiebreak order.** A given access item comes from
  ONE review item, so a decided-vs-decided collision on one access-item node is
  purely defensive. Documented deterministic precedence (highest wins):
  **`needsReview` > `reassigned` > `revoked` > `approved`**. `needsReview` still
  always wins (never hide outstanding work); `reassigned` stays terminal over
  any plain decision (mirrors the old `delegated`-wins tiebreak); `revoked` over
  `approved` is an arbitrary-but-fixed order for the should-not-happen case.

## Plan items

- [ ] 1. Widen the `AccessReviewStatus` union and update all JSDoc that names the
      states. In `src/sailpoint/types.ts` change
      `export type AccessReviewStatus = 'needsReview' | 'complete' | 'delegated'`
      to `'needsReview' | 'approved' | 'revoked' | 'reassigned'`. Update the
      JSDoc on `AccessReviewStatus` itself and on every field that carries it:
      `AccessMatrixRowVM.reviewStatus`, `AccessGraphNode.reviewStatus`,
      `AccessGraphEdge.reviewStatus`, `AccessSceneNodeData.reviewStatus` — replace
      every "`'complete'`"/"`'delegated'`" mention with the four-state wording
      (reassigned→`'reassigned'` terminal; keep/remove→`'approved'`/`'revoked'`;
      needsReview-wins on collision; defensive tiebreak order from the decisions
      section).
      Files: src/sailpoint/types.ts
      Verify: `npm run build` — expected to now FAIL with non-exhaustive
      switch / incomplete-`Record` type errors in metrics.ts, buildAccessScene.ts,
      and AccessNode.tsx. Those errors are the checklist for items 2, 5, 6.
      (The union change alone leaves the repo un-buildable; items 2–7 restore it.
      Treat items 1–7 as one atomic change — the buildable checkpoint is after
      item 7.)

- [ ] 2. Rewrite `reviewStatusOf` in `src/domain/metrics.ts` to the four-state
      precedence and update its JSDoc: `item.reassigned === true` → `'reassigned'`
      (TERMINAL, even if a decision was also recorded); else
      `item.decision === 'REVOKE'` → `'revoked'`; else
      `item.decision === 'APPROVE'` → `'approved'`; else the defensive
      `completed && decision == null && !reassigned` corner → `'approved'` (the
      FLAGGED fallback — add the unreachable-defensive comment); else
      `'needsReview'`. Keep `isItemReviewed` as
      `reviewStatusOf(item) !== 'needsReview'` (so approved, revoked, AND
      reassigned all count as reviewed) and update its JSDoc. Do NOT touch
      `computeMetrics` — it already counts APPROVE/REVOKE/reassigned off the raw
      item; just confirm `isItemReviewed` still derives correctly.
      Files: src/domain/metrics.ts
      Verify: `npx vitest run src/domain/metrics.test.ts` after item 2's test
      update below — the file compiles and the new assertions pass.

- [ ] 3. Update `src/domain/metrics.test.ts` for the four states. In the
      `reviewStatusOf` describe block: the reassigned cases now expect
      `'reassigned'` (not `'delegated'`), including the reassigned+decided case;
      add a case asserting `decision: 'APPROVE'` → `'approved'` and
      `decision: 'REVOKE'` → `'revoked'` (replacing the single `'complete'`
      assertion); `needsReview` case unchanged; update the `isItemReviewed`
      assertion comment/wording to the four states (behavior unchanged — still
      true for a decided item and a reassigned item, false for undecided). Leave
      the `computeMetrics` describe block AS-IS (those assertions already cover
      the four-way approved/revoked/reassigned/remaining split and must keep
      passing).
      Files: src/domain/metrics.test.ts
      Verify: `npx vitest run src/domain/metrics.test.ts` — all green.

- [ ] 4. Update the dedup merge in `src/sailpoint/accessMatrix.ts`. The
      `reviewStatus` return values from `reviewStatusOf` now flow through
      `expandItem` unchanged (no logic change there beyond the widened union).
      In `resolveMatrix`'s collision branch, replace the
      `complete`-vs-`delegated` tiebreak with the four-state precedence
      `needsReview > reassigned > revoked > approved`: `needsReview` still
      overwrites anything; else if the incoming `tuple.reviewStatus` outranks the
      `existing.reviewStatus` per that order (and existing isn't already
      `needsReview`), take the incoming one. Implement via a small
      rank lookup (e.g. `const RANK = { needsReview: 3, reassigned: 2, revoked: 1,
      approved: 0 }`) so the comparison is total and deterministic. Update the
      `RowTuple.reviewStatus` JSDoc and the merge comment to the four states.
      Keep `reviewStatus` OUT of `rowKey` (counts/ids invariant).
      Files: src/sailpoint/accessMatrix.ts
      Verify: `npx vitest run src/sailpoint/accessMatrix.test.ts` after item 5's
      test update.

- [ ] 5. Update `src/sailpoint/accessMatrix.test.ts`. The stamping test
      (`stamps reviewStatus + access-item identity ...`): the decided-role item
      (`decision: 'APPROVE'`) now expects `reviewStatus === 'approved'` (was
      `'complete'`); the reassigned entitlement expects `'reassigned'` (was
      `'delegated'`); the undecided AP stays `'needsReview'`. Add a role/AP case
      with `decision: 'REVOKE'` asserting `'revoked'`. The two collision tests
      (`resolves a complete-vs-delegated five-id collision ...` and
      `... regardless of order`): rename/retarget to an approved-vs-reassigned
      collision expecting `'reassigned'` (reassignment terminal); add a
      revoked-vs-approved collision expecting `'revoked'` (defensive order). The
      two needsReview-wins tests keep expecting `'needsReview'` (update the
      decided fixture label from complete to approved). The
      row-count/ids-invariant test is behavior-unchanged — keep it.
      Files: src/sailpoint/accessMatrix.test.ts
      Verify: `npx vitest run src/sailpoint/accessMatrix.test.ts` — all green.

- [ ] 6. Update `markStatus` in `src/domain/accessGraph.ts` and its JSDoc for four
      states. Today it does needsReview-wins then last-write-wins between the two
      decided states. Replace the "last-write-wins" tail with the rank-based
      precedence `needsReview > reassigned > revoked > approved` (reuse the same
      RANK idea as item 4 so node and matrix agree): once `needsReview` is set it
      stays; otherwise only overwrite when the incoming status outranks the
      current. Everything else (stamping only `levels[1]` + the user→item edge,
      guarding on `row.accessItemKind`) is unchanged. Update the JSDoc on
      `markStatus` to name the four states and the precedence.
      Files: src/domain/accessGraph.ts
      Verify: `npx vitest run src/domain/accessGraph.test.ts` after item 7's test
      update.

- [ ] 7. Extend `src/domain/accessGraph.test.ts` for all four states on the direct
      access item. Rename the `'complete'` entitlement test to `'approved'` and
      add a sibling `'revoked'` test (same shape: status stamped on the
      entitlement node + user→entitlement edge only; source + deeper edges
      undefined). Rename the `'delegated'` test and its assertions to
      `'reassigned'`. Keep the `needsReview`-wins tests, updating the losing
      fixture's status to `reassigned` (and add/keep a needsReview-over-approved
      case). Keep the degenerate-access-row test (status undefined everywhere).
      All statuses applied only to the first hop off the user — none on deeper
      hops / user / source.
      Files: src/domain/accessGraph.test.ts
      Verify: `npx vitest run src/domain/accessGraph.test.ts` — all green.

- [ ] 8. Make the edge-styling switch in `src/graph/buildAccessScene.ts` exhaustive
      over four states. In `edgeStyle(status)` replace the three cases with four:
      `needsReview` → `{ stroke: 'var(--vc-warn)', strokeWidth: 2,
      strokeDasharray: '6 4' }`; `approved` → `{ stroke: 'var(--vc-allow)',
      strokeWidth: 2 }`; `revoked` → `{ stroke: 'var(--vc-deny)', strokeWidth: 2 }`;
      `reassigned` → `{ stroke: 'var(--vc-accent)', strokeWidth: 2,
      strokeDasharray: '2 3' }`. The `className` stays
      `vc-graph-edge-${edge.reviewStatus}` (now yields
      `vc-graph-edge-approved` / `-revoked` / `-reassigned`). Keep the NO
      count-badge behavior (`pathCount` still unused for rendering). Update the
      block comment to list the four states and note that approved vs revoked
      differ by COLOR only on the thin edge, with the node icon carrying the
      shape distinction.
      Files: src/graph/buildAccessScene.ts
      Verify: `npx vitest run src/graph/buildAccessScene.test.ts` after item 9.

- [ ] 9. Update `src/graph/buildAccessScene.test.ts`. Rename the `complete` edge
      test to `approved` (expect `data.reviewStatus === 'approved'`, className
      contains `vc-graph-edge-approved`, and the `--vc-allow` stroke) and add a
      sibling `revoked` test (className `vc-graph-edge-revoked`, `--vc-deny`
      stroke, solid). Rename the `delegated` edge test to `reassigned`
      (`vc-graph-edge-reassigned`, `--vc-accent`, dotted). The needsReview edge
      test and the deeper-hops-neutral assertions are unchanged. Update the
      "threads review status onto the scene node" test's status value if it used
      `complete`/`delegated` (use `needsReview` or one of the new values);
      user/entitlement/source still carry no status.
      Files: src/graph/buildAccessScene.test.ts
      Verify: `npx vitest run src/graph/buildAccessScene.test.ts` — all green.

- [ ] 10. Rework the corner `StatusIcon` for four shapes in
      `src/graph/AccessNode.tsx`. Make `STATUS_ICON_LABEL` and
      `STATUS_ICON_SHAPE` complete `Record<AccessReviewStatus, …>` over the four
      states (a missing key is now a type error — that is the exhaustiveness
      guard): `needsReview` → `'Needs review'` + hollow-exclamation (keep);
      `approved` → `'Approved'` + the check path (reuse old `complete`);
      `revoked` → `'Revoked'` + a NEW X/prohibited shape distinct from the check
      (e.g. two crossed strokes inside the 18×18 viewBox, matching stroke width
      ~1.8, `strokeLinecap='round'`); `reassigned` → `'Reassigned'` + the
      hand-off arrow (reuse old `delegated`). Keep each icon's `role='img'` +
      `aria-label` + `<title>` + `data-review-status` wiring and the `decorative`
      branch. The `statusClass` on the card stays
      `vc-graph-card-status-${status}` (now four variants). Do NOT regress the
      name + kind caption rendering (`vc-graph-card-label` / `vc-graph-card-kind`
      must still render in both the interactive and read-only branches). Update
      the `StatusIcon` JSDoc to list the four shapes.
      Files: src/graph/AccessNode.tsx
      Verify: `npm run build` — zero type errors (the four-state `Record`s and the
      exhaustive edge switch now satisfy the widened union).

- [ ] 11. Update the four-state CSS in `src/graph/AccessGraph.css`. Rename/extend
      the card accent rules: `.vc-graph-card-status-complete` →
      `.vc-graph-card-status-approved` (`--vc-allow`); ADD
      `.vc-graph-card-status-revoked` (`--vc-deny`); rename
      `.vc-graph-card-status-delegated` → `.vc-graph-card-status-reassigned`
      (`--vc-accent`); `needsReview` (`--vc-warn`) unchanged — each keeps the
      left-border + `box-shadow: 0 0 0 2px <token>, var(--shadow)` ring. Rename
      the icon-color rules: `.vc-graph-status-icon-complete` →
      `-approved` (`--vc-allow`); ADD `.vc-graph-status-icon-revoked`
      (`--vc-deny`); rename `-delegated` → `-reassigned` (`--vc-accent`). Rename
      the edge rules: `.vc-graph-edge-complete` → `.vc-graph-edge-approved`
      (`--vc-allow`, solid); ADD `.vc-graph-edge-revoked` (`--vc-deny`, solid);
      rename `.vc-graph-edge-delegated` → `.vc-graph-edge-reassigned`
      (`--vc-accent`, dotted). Rename the legend swatch helper classes
      `-complete`→`-approved`, add `-revoked`, `-delegated`→`-reassigned` (keep
      them even if the legend uses icons, for parity). Update the block comments
      to four states.
      Files: src/graph/AccessGraph.css
      Verify: `npm run build` (CSS is bundled, not type-checked, so also rely on
      item 13's canvas test for the rendered classes).

- [ ] 12. Make the drill-down legend four entries in
      `src/graph/AccessGraphCanvas.tsx`. In the `bottom-left` Panel's
      `vc-graph-legend` group add a fourth `vc-graph-legend-row` so the order is:
      `needsReview` "Needs review", `approved` "Approved", `revoked` "Revoked",
      `reassigned` "Reassigned", each `<StatusIcon status={…} decorative />` +
      text. Legend stays drill-down-only (inside `inDrilldown && …`); the grid
      overview is untouched. `role="group"` / `aria-label="Review status legend"`
      unchanged.
      Files: src/graph/AccessGraphCanvas.tsx
      Verify: `npm run build` + item 13's canvas test.

- [ ] 13. Update `src/graph/AccessGraphCanvas.test.tsx` drill-down test for four
      states. In the `marks review status in drill-down …` test: expand the
      fixture rows so the drilled user holds one item per state — an undecided
      role (`needsReview`), an approved entitlement (`approved`), a revoked item
      (`revoked`, e.g. a second entitlement or role), and a reassigned access
      profile (`reassigned`). Replace the three icon assertions with four:
      `getByLabelText('Needs review')` → `data-review-status="needsReview"`;
      `'Approved'` → `"approved"`; `'Revoked'` → `"revoked"`; `'Reassigned'` →
      `"reassigned"`. Replace the three legend `toHaveTextContent` lines with the
      four labels. Keep: grid shows no legend/icons; the old status-chip
      assertions (`.vc-graph-status-chip` is null, `Review status: Needs review`
      label is null); every node renders its name; no count badge. Reuse the
      file's existing `stubRect` pattern; do NOT add a global
      `getBoundingClientRect` stub (per the known-constraint note). Leave the
      tooltip test and other tests as-is.
      Files: src/graph/AccessGraphCanvas.test.tsx
      Verify: `npx vitest run src/graph/AccessGraphCanvas.test.tsx` — all green.

- [ ] 14. Full verification. Run the whole gate and confirm the four-state model
      is consistent end to end.
      Files: (none — verification only)
      Verify: `npm run build` (zero type errors), then `npm run lint` (clean),
      then `npm test` (all green). KNOWN FLAKE: `src/state/useProvenance.test.ts`
      can fail only under full-suite load; re-run it isolated with
      `npx vitest run src/state/useProvenance.test.ts` to confirm it passes. No
      remaining references to `'complete'` or `'delegated'` as
      `AccessReviewStatus` values (grep is a sanity check, NOT the verification):
      `rg "'complete'|'delegated'" src/sailpoint src/domain src/graph` should
      return only unrelated matches (e.g. `isComplete`, `CampaignPhase 'done'`),
      none typed as `AccessReviewStatus`.

## Open flag for the orchestrator

The bare-`completed`-without-`decision` fallback in `reviewStatusOf` (item 2) is
mapped to `'approved'` by default. This corner is unreachable with current data
(the data layer sets `decision` whenever `completed` is true), so the choice is
cosmetic, but it is a user-facing status word. **Confirm with the user that
`approved` (rather than `revoked`) is the intended fallback.** If they prefer
`revoked`, only the one branch in `reviewStatusOf` and its test assertion change.
