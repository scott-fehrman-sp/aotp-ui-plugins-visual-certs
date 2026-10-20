# Implementation Plan — Review-status drill-down access graph

Rework the per-user DRILL-DOWN access graph so the user's DIRECT access-item
links are marked by REVIEW STATUS, while the full layered path (user → role? →
access profile? → entitlement → source) stays intact, and the confusing edge
`pathCount` badge is removed from this view. The all-users GRID overview is
unchanged.

All paths are under the worktree:
`/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/review-status-graph`.
Commands below run from that worktree root.

---

## Design decisions (made during exploration, grounded in the code)

These are decisions, not a design document — rationale is one or two sentences each.

1. **"Reviewed" predicate — extract a shared helper.** `computeMetrics`
   (`src/domain/metrics.ts`) already uses the rule
   `item.completed || item.decision || item.reassigned`. There is NO shared
   helper today. Extract `export function isItemReviewed(item): boolean` into
   `src/domain/metrics.ts` and have BOTH `computeMetrics` and the matrix mapper
   call it, so the "complete vs needs review" rule lives in exactly one place.
   `AccessReviewStatus = 'needsReview' | 'complete'`; `complete` ⇔
   `isItemReviewed(item) === true`.

2. **The "access item" = the FIRST hop off the user node.** It is the role, the
   access profile, or the directly-held entitlement the review item is about —
   exactly what `ReviewItemVM.accessKind` ('role' | 'accessProfile' |
   'entitlement') + `accessId` identify. The generic `access` fallback kind has
   no composition id; its degenerate user-only row carries status too (on the
   user node — there is no access-item node), but with no access-item edge it
   simply has no status-marked edge. Downstream hops (item → … → source) are
   explanation and stay visually neutral.

3. **Status lives on exactly ONE node + ONE edge per path.** The access-item
   NODE (user's direct child) and the user→access-item EDGE. Deeper nodes/edges
   get no status. This mirrors how `detail` is stamped per node in
   `deriveAccessGraph`.

4. **needsReview-wins precedence.** If the same access-item node/edge is reached
   from multiple rows with differing status (not expected, but possible),
   `needsReview` wins. Rationale: never hide outstanding work behind a
   "complete" marker. Implemented in both the matrix dedup merge and the graph
   node/edge dedup.

5. **Additive-optional fields, never part of dedup identity.** New fields
   (`reviewStatus`, `accessItemKind`, `accessItemId`) are optional on
   `AccessMatrixRowVM` and are NOT part of `rowKey` — identical to how
   `userDepartment` / `roleDescription` etc. were threaded. This keeps row/node
   counts invariant.

6. **Token / shape mapping (NOT color-only; accessibility).**
   - **Needs review:** amber. Edge: stroke `var(--vc-warn)` (#c77700) **+ dashed**
     stroke (`strokeDasharray`). Node: a pill chip reading **"Needs review"**
     using the existing `.vc-chip` look (`--vc-warn` on `--vc-warn-bg`), plus a
     left-border/ring accent in `--vc-warn`.
   - **Complete:** green. Edge: stroke `var(--vc-allow)` (#1f8a4c, the "keep
     access" token) **+ solid** stroke. Node: a pill chip reading **"Reviewed"**
     using `--vc-allow` on `--vc-allow-bg`, plus a left-border/ring accent in
     `--vc-allow`.
   - These are existing `--vc-*` tokens from `src/index.css` (both light + dark
     variants already defined), NOT the graph `--vc-graph-*` tokens. Chosen
     because `--vc-warn` is the task-specified amber and `--vc-allow` is the
     established "resolved/kept" green that reviewers already see on decided
     cards (`.vc-decided-allow`).
   - **Two signals per state** (color + dash/solid on the edge; color + text
     chip on the node) satisfy "do not rely on color alone." The legend repeats
     the text + swatch.

7. **The marker is BOTH edge and node** (per the task recommendation): the edge
   so the path reads at normal zoom, the node chip so it reads when zoomed out
   and to carry the non-color text signal.

8. **`AccessCountEdge.tsx` is DELETED.** Grep confirms it is referenced ONLY by
   `AccessGraphCanvas.tsx` (the `edgeTypes` registry) and `buildAccessScene.ts`
   (edge `type: 'accessCount'`). The grid overview has no edges
   (`buildUserGridScene` returns `edges: []`), and no test imports it directly.
   So nothing else reads it after this change → delete the component, its CSS
   block, and the `edgeTypes` registration. `AccessGraphEdge.pathCount` and
   `deriveAccessGraph`'s accumulation STAY in the data layer (still asserted by
   `accessGraph.test.ts`); only the badge/custom-edge render goes.

9. **Status edge rendering — use a tiny custom status edge OR plain styled
   edges.** Decision: use **plain built-in React Flow edges with a `style` +
   `className` + `data.reviewStatus`** for ALL drill-down edges (no custom edge
   type at all). The needs-review/complete edges get stroke color + dash via
   `style`; neutral edges get the default stroke. Rationale: the only reason a
   custom edge existed was the count badge (which needs `EdgeLabelRenderer`);
   status needs only stroke styling, which plain edges do via `style`, so
   dropping the custom edge type entirely is simplest and removes the
   `edgeTypes` registry. The node chip carries the text/a11y signal, so the edge
   needs no label renderer.

10. **Grid overview unchanged.** `buildUserGridScene` keeps producing only
    `user` cards with no edges and no status; status is a drill-down-only
    concept. Confirmed: grid user nodes never get `reviewStatus`.

---

## Ordered implementation steps

- [x] 1. Add the status types and the shared `isItemReviewed` predicate.
      In `src/domain/metrics.ts` extract
      `export function isItemReviewed(item: ReviewItemVM): boolean` returning
      `item.completed || item.decision != null || item.reassigned === true`, and
      refactor `computeMetrics` to call it (keeping the approved/revoked/reassigned
      sub-counts exactly as-is — they still inspect `item.decision`/`item.reassigned`
      inside the `isItemReviewed` branch). In `src/sailpoint/types.ts` add
      `export type AccessReviewStatus = 'needsReview' | 'complete'`; add optional
      `reviewStatus?: AccessReviewStatus`, `accessItemKind?: AccessGraphNodeKind`,
      `accessItemId?: string | null` to `AccessMatrixRowVM` (documented as
      enrichment-only, NEVER part of the dedup key); add optional
      `reviewStatus?: AccessReviewStatus` to `AccessGraphNode` and
      `AccessGraphEdge`; add optional `reviewStatus?: AccessReviewStatus` to
      `AccessSceneNodeData`.
      Files: src/domain/metrics.ts, src/sailpoint/types.ts
      Verify: `npx vitest run src/domain/metrics.test.ts` passes (behavior
      unchanged); `npm run build` type-checks clean.

- [x] 2. Stamp status + access-item identity onto every row in `expandItem`.
      In `src/sailpoint/accessMatrix.ts`: add `reviewStatus`, `accessItemKind`,
      `accessItemId` to the internal `RowTuple` (optional, with doc comments
      mirroring the `userDepartment` block that they are NEVER part of `rowKey`).
      In `expandItem`, compute `reviewStatus = isItemReviewed(item) ? 'complete'
      : 'needsReview'` (import `isItemReviewed` from `../domain/metrics`) and the
      access-item identity from the review item:
      `accessItemKind = item.accessKind` when it is 'role' | 'accessProfile' |
      'entitlement', else `undefined`; `accessItemId = item.accessId ?? null`.
      Fold all three into `base` so EVERY row the item produces (including the
      degenerate `access` row and unresolved rows) carries them — same pattern as
      `userDepartment`/`userLocation`. Do NOT touch `rowKey`. In `resolveMatrix`'s
      dedup merge, when a later tuple collides with an existing row id and the two
      disagree on `reviewStatus`, set the merged row's `reviewStatus` to
      `'needsReview'` (needsReview-wins); leave all other fields first-wins.
      Files: src/sailpoint/accessMatrix.ts
      Verify: `npx vitest run src/sailpoint/accessMatrix.test.ts` passes after
      step 7 adds the new cases; interim `npm run build` type-checks clean.

- [x] 3. Stamp status onto the access-item node + user→access-item edge in
      `deriveAccessGraph`.
      In `src/domain/accessGraph.ts`: identify the user's DIRECT child level for
      each row using `row.accessItemKind` + `row.accessItemId` (match the level
      whose `kind === accessItemKind` and whose namespaced id corresponds to
      `accessItemId`, using the SAME id-construction the level already uses, with
      the name fallback when `accessItemId` is null). Stamp `row.reviewStatus`
      onto (a) that access-item NODE and (b) the edge `user:<id> → <accessItem>`.
      Deeper nodes/edges get no `reviewStatus`. Apply needsReview-wins when the
      same access-item node/edge is seen again with a different status (if either
      contributing row says `needsReview`, the node/edge is `needsReview`).
      Preserve all existing id/direction/skip/degenerate behavior and the
      first-wins rule for label/detail. The degenerate `access`-kind user-only
      row has no access-item node/edge, so it contributes no status mark.
      Files: src/domain/accessGraph.ts
      Verify: `npx vitest run src/domain/accessGraph.test.ts` passes after step 7
      adds the new cases; interim `npm run build` type-checks clean.

- [x] 4. Thread status into the scene and REMOVE the count-badge wiring.
      In `src/graph/buildAccessScene.ts`: put `reviewStatus: node.reviewStatus`
      into each scene node's `data`. Replace the edge mapping so edges no longer
      use `type: 'accessCount'`, no `data.pathCount`, and no count-driven label:
      emit plain edges `{ id, source, target, sourceHandle, targetHandle }` plus,
      for an edge carrying `reviewStatus`, a `className`
      (`vc-graph-edge-status vc-graph-edge-<status>`), a `data: { reviewStatus }`,
      and a `style` setting `stroke` to the status color and `strokeDasharray`
      for `needsReview` (dashed) / none for `complete`; neutral edges keep the
      default style (a modest `strokeWidth`). Remove the `pathCount`-based
      `strokeWidth` branch.
      Files: src/graph/buildAccessScene.ts
      Verify: `npx vitest run src/graph/buildAccessScene.test.ts` passes after
      step 7 updates the count-badge assertion; interim `npm run build` clean.

- [x] 5. Render the status chip + accent on the access-item node.
      In `src/graph/AccessNode.tsx`: when `data.reviewStatus` is set, render a
      small pill chip ("Needs review" / "Reviewed") inside the card and add a
      status class (`vc-graph-card-status-needsReview` /
      `-complete`) to the `.vc-graph-card` element, on BOTH the interactive and
      read-only branches (status only ever appears in drill-down, i.e. the
      read-only branch, but handle both for safety). Give the chip an
      `aria-label` so it reads as text, and expose a stable query hook
      (chip text is enough; optionally `data-review-status`). In
      `src/graph/AccessGraph.css`: add `.vc-graph-card-status-needsReview` /
      `-complete` accent rules (ring/left-border using `--vc-warn` / `--vc-allow`)
      and a `.vc-graph-status-chip` pill styled like `.vc-chip`/`.vc-decided-badge`
      (needsReview → `--vc-warn`/`--vc-warn-bg`; complete → `--vc-allow`/
      `--vc-allow-bg`), and add the `.vc-graph-edge-status` / `-needsReview` /
      `-complete` edge-stroke rules. REMOVE the `.vc-graph-edge-badge` CSS block
      (its edge is being deleted). Optionally add a status line to `NodeTooltip`
      for access-item kinds (nice-to-have; only if cheap).
      Files: src/graph/AccessNode.tsx, src/graph/AccessGraph.css
      Verify: `npx vitest run src/graph/AccessGraphCanvas.test.tsx` passes after
      step 7 adds the chip assertions; interim `npm run build` clean.

- [x] 6. Delete the count edge, add the legend, and drop the edge-type registry.
      Delete `src/graph/AccessCountEdge.tsx`. In
      `src/graph/AccessGraphCanvas.tsx`: remove the `import { AccessCountEdge }`
      and the `const edgeTypes = { accessCount: AccessCountEdge }`; remove the
      `edgeTypes={edgeTypes}` prop from `<ReactFlow>` (plain edges need no
      registry). Add a LEGEND, rendered ONLY in drill-down (inside the
      `inDrilldown` block), as a `Panel position="top-right"` (or bottom-left)
      styled like `.vc-graph-toggle`/`.vc-graph-note`: two rows, each a colored
      swatch (dashed amber / solid green) + text ("Needs review" / "Review
      complete"). Keep the existing back button, layout toggle, minimap, controls,
      and the degenerate "No expanded access" note (move it if it collides with
      the legend's corner). Add a `.vc-graph-legend` CSS block in AccessGraph.css.
      Files: src/graph/AccessGraphCanvas.tsx, src/graph/AccessGraph.css,
      (delete) src/graph/AccessCountEdge.tsx
      Verify: `npm run build` clean (no dangling import); `npm run lint` clean.

- [x] 7. Update/extend the test suite.
      Additive; only the count-badge assertions are UPDATED to the new behavior,
      never deleted. Reuse the existing `row(...)` / `item(...)` factories and
      the scoped `stubRect` pattern; do NOT add a global
      `getBoundingClientRect` stub.
      - `src/sailpoint/accessMatrix.test.ts`: a row from a decided item
        (`decision: 'APPROVE'`) has `reviewStatus: 'complete'`; an undecided item
        → `'needsReview'`; a `reassigned: true` item → `'complete'`; rows carry
        `accessItemKind`/`accessItemId` matching the review item; adding these
        fields does NOT change row count or ids (dedup invariant) — assert against
        the existing 6-golden-row count; needsReview-wins when two items share the
        five-id tuple but differ in status.
      - `src/domain/accessGraph.test.ts`: `reviewStatus` is set on the user's
        direct access-item node AND the `user→item` edge only; downstream
        nodes/edges have `reviewStatus === undefined`; needsReview-wins on a
        shared access-item node reached from a complete and an incomplete row.
      - `src/graph/buildAccessScene.test.ts`: REPLACE the
        "carries pathCount ... accessCount edge type" test with one asserting NO
        edge has `type === 'accessCount'`, no edge `data.pathCount`, and no count
        label; the `user→access-item` edge carries the status marker
        (`data.reviewStatus` + a `vc-graph-edge-<status>` className + stroke/dash
        style); downstream edges are neutral (no `reviewStatus`).
      - `src/graph/AccessGraphCanvas.test.tsx`: add a test that drills into a user
        whose items mix decided + undecided; assert the legend renders (query its
        text); a needs-review access-item node shows a "Needs review" chip (query
        by chip text / aria) and a completed one shows "Reviewed"; assert NO
        numeric count badge appears (`.vc-graph-edge-badge` absent / no stray
        count text). Grid-mode tests stay unchanged and must still pass.
      Files: src/sailpoint/accessMatrix.test.ts, src/domain/accessGraph.test.ts,
      src/graph/buildAccessScene.test.ts, src/graph/AccessGraphCanvas.test.tsx
      Verify: `npx vitest run src/sailpoint/accessMatrix.test.ts
      src/domain/accessGraph.test.ts src/graph/buildAccessScene.test.ts
      src/graph/AccessGraphCanvas.test.tsx` — all green.

- [x] 8. Full verification.
      Run the whole gate and record results in the commit message.
      Files: (none)
      Verify: `npm run build` (tsc -b && vite build, zero type errors),
      `npm run lint` (clean), `npm test` (all green). KNOWN FLAKE:
      `src/state/useProvenance.test.ts` can fail only under full-suite load and
      passes on isolated re-run — if it fails, re-run
      `npx vitest run src/state/useProvenance.test.ts` once to confirm green.

---

## Pipeline file coverage checklist (all six)

- `src/sailpoint/types.ts` — step 1 (types + optional fields on row/node/edge/scene).
- `src/sailpoint/accessMatrix.ts` — step 2 (stamp status + identity; dedup
  needsReview-wins; not in `rowKey`).
- `src/domain/accessGraph.ts` — step 3 (status on access-item node + user→item
  edge only; needsReview-wins).
- `src/graph/buildAccessScene.ts` — step 4 (thread status into scene; remove
  count-badge wiring).
- `src/graph/AccessNode.tsx` (+ AccessGraph.css) — step 5 (chip + accent, not
  color-only).
- `src/graph/AccessGraphCanvas.tsx` — step 6 (delete count edge, drop
  `edgeTypes`, add legend).

## Open assumptions (no stalling)

- The `user→access-item` edge is identified in `deriveAccessGraph` by matching
  the level whose `kind === accessItemKind` using the existing id construction.
  If `accessItemId` is null (e.g. a role/AP that failed deep-fetch), fall back to
  the name-based id the level already uses, so the first present hop is still the
  one marked. Assumed correct from the id scheme documented in `accessGraph.ts`.
- `--vc-warn` / `--vc-allow` are the chosen tokens; if a reviewer prefers a muted
  neutral for "complete" over green, the complete token can be swapped to
  `--vc-text-muted` with a one-line CSS change — green is chosen to match the
  existing "keep access" visual vocabulary.
