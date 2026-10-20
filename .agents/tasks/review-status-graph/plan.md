# Implementation Plan: drill-down graph review status + reference-only nested links

Worktree (ALL work happens here, relative paths land in the wrong checkout):
`/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.worktrees/review-status-fix`
(branch `feature/graph-review-status-fix`, base `main` @ 6ff25ba). Source under `<worktree>/src`.
Artifact root: `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.agents/tasks/review-status-graph/`
(a previous task's plan/review were archived to `prior-run/`; the stale APPROVED `review.json` was removed so the loop cannot stop early).

Project facts (read from the repo): Vite 8 + React 19 + `@xyflow/react` 12.12 + dagre; vitest 3 + jsdom (`css:false`).
Gates: `npm run build` (= `tsc -b && vite build`), `npm run lint` (= `eslint .`), `npm test` (= `vitest run`).
Known flake: `src/state/useProvenance.test.ts` can fail only under full-suite load; re-run it alone once, never weaken it.

---

## 1. Diagnosis: what is already PROVED vs what must be CONFIRMED by tests

### PROVED already (read code + a scratch vitest run, scratch file deleted)

**Cause A (the headline bug): review status is stamped on GLOBAL, user-shared nodes, but the edge is per user.**
`deriveAccessGraph` (`src/domain/accessGraph.ts`) dedupes nodes across ALL users by `kind:id`, then `markStatus(nodes.get(levels[1].id), row.reviewStatus)` writes status onto that shared node (max-rank across every user). The `user->item` edge is unique per user, so it holds that user's own status. `userSubgraph` copies the global node as is.
Scratch repro (two users hold entitlement `e1`: U1 approved, U2 needsReview; drill into U1) printed: node `entitlement:e1` = `needsReview`, edge `user:u1->entitlement:e1` = `approved`. That is exactly the screenshot symptom: ring/icon colour disagrees with the line colour.
Second scratch (U1 holds `e1` directly, approved; U2 holds AP `ap1` containing `e1`): in U2's drill-down the NESTED-ONLY node `e1` carries `approved`, so a deeper node shows a status icon/ring it must not have (the "icons are wrong" symptom). Conversely a first-level node whose status was overwritten by another user's higher-rank status shows the wrong icon.
Other users' statuses also make a nested node of user X look reviewable. Nodes that are nested for the viewed user but never first-level for any user show no ring and no icon: these are the "missing status icon" nodes (they look like access items but are only reference).

**Cause B (stale status): confirmed by reading, still needs a failing hook test.**
`useAccessMatrix` resolves in an effect keyed on `idSig`+campaign+reload, so a decision-driven rebuild of `items` (same ids) does not re-resolve. `reviewStatus` is stamped inside `expandItem` (`sailpoint/accessMatrix.ts`) at resolve time and baked into `rows`, and `graph` is derived once in the same `.then`. `AccessMatrixView` renders `matrix.graph`, so after keep/remove/reassign the graph keeps the first-resolve status. The existing test `does not re-resolve when items are rebuilt with the same ids` rebuilds items with `completed:true` but never asserts the graph status, which is why this slipped through.

**Cause C: model gap (first level is not a first-class concept).** Every row creates `user->levels[1]` and the stamp is gated only by `levels[1].kind === row.accessItemKind`. There is no structural marker on edges/nodes saying "this is a reviewed first-level hop", so the scene builder cannot style deeper edges as reference (today they are only "unstyled", inline `strokeWidth:1.5`, CSS `stroke: var(--edge)`, no muting, no z-order).

### Must be CONFIRMED by a failing reproduction test BEFORE changing code (each has a fix planned if confirmed)

| # | Candidate | Repro test (exact name) | File |
|---|-----------|--------------------------|------|
| 1 | Stale status in hook | `useAccessMatrix > reflects a decision made after resolution in graph edge status without re-resolving` | `src/state/useAccessMatrix.test.ts` |
| 2 | ID-space mismatch / null ids | `reviewOverlay > matches by the review item's own accessId even when the resolved composition id differs` and `... falls back to the access name when accessId is null` | `src/domain/reviewOverlay.test.ts` (new) |
| 3 | Multiple review items per (user,kind,id) | `reviewOverlay > aggregates several review items for one user+item deterministically (needsReview > reassigned > revoked > approved), independent of order` and `... flags mixed statuses` | `src/domain/reviewOverlay.test.ts` |
| 4 | Node vs edge from two code paths / cross-user leak (Cause A) | `userSubgraph > stamps node status only from this user's first-level edge (no cross-user leak)`; `userSubgraph > a nested-only node carries no status in another user's drill-down`; `userSubgraph > node status always equals its incoming user edge status across a mixed fixture` | `src/graph/userSubgraph.test.ts` |
| 5 | Spurious / missing first hop | `deriveAccessGraph > user->X edges equal exactly the user's review items` (fixture incl. nested-only entitlement under a held AP; entitlement held directly AND nested; role with blank name); `resolveMatrix > emits a first-level row for an access profile with zero entitlements` and `... for a role with no access profiles or entitlements`; `deriveAccessGraph > deeper edges never carry a review status or first-level marker` | `src/domain/accessGraph.test.ts`, `src/sailpoint/accessMatrix.test.ts` |
| 6 | CSS / z-order / icon | `buildAccessScene > renders status edges above reference edges (zIndex)`; `StatusIcon > renders a distinct shape and accessible name for every status` (loops all four); `AccessGraphCanvas > every first-level card has exactly one icon equal to its card status and its incoming edge status`; real-browser check (jsdom cannot confirm computed stroke/dash/z-order/clipping) | `src/graph/buildAccessScene.test.ts`, `src/graph/AccessGraphCanvas.test.tsx`, browser step |

Evidence read for #6 (not a bug, verify in browser only): React Flow applies `edge.style` inline on the `<path>`, so it already beats `.vc-graph-wrap .react-flow__edge-path{stroke:var(--edge)}`; `STATUS_ICON_SHAPE` has four distinct shapes (exclamation circle, check, X, arrow) and the maps are `Record<AccessReviewStatus,…>` so exhaustive. Two real CSS nits to fix: (a) `.vc-graph-card-status-*{border-left-color}` (specificity 0,1,0) is overridden by `.vc-graph-card.kind-*` (0,2,0) so it is dead (keep the kind accent, delete the dead declaration); (b) `.vc-graph-card:hover{box-shadow:0 0 0 2px var(--accent)}` (0,2,0) replaces the status ring on hover, so keep the status ring on hover with `.vc-graph-card.vc-graph-card-status-*:hover`.

Expected-to-pass (document, add regression tests only): id mismatch is NOT expected to be a live bug once matching uses the review item's own `accessId` on both sides (Cause 2 is closed structurally by design below); the test is a guard.

---

## 2. Design decisions (rationale kept short)

1. **Status is a live overlay, never part of resolved rows or the structural graph.** Composition resolution is expensive, status is cheap. `AccessMatrixRowVM.reviewStatus` and `REVIEW_STATUS_RANK` in `sailpoint/accessMatrix.ts` are removed; rows keep only the structural enrichment `accessItemKind`, `accessItemId`, and new `accessItemName` (all outside `rowKey`).
2. **First level is structural.** `deriveAccessGraph(rows)` marks each user->item edge that is a real review hop with `firstLevel: true` and a `reviewKey` (see 3). It no longer sets `reviewStatus` on any node or edge. Nodes get no status from derivation.
3. **One key space on both sides.** New `src/domain/reviewOverlay.ts` exports `reviewKey(userId, kind, accessId, accessName)` = `${userId}|${kind}|${accessId ?? 'name:' + accessName}`. The row side uses `row.userId/accessItemKind/accessItemId/accessItemName`; the item side uses `item.identityId/accessKind/accessId/accessName`. Matching on the review item's own id means it never depends on the resolved composition id (kills cause 2).
4. **One aggregated status per key.** Aggregation rule: any `needsReview` -> `needsReview` (outstanding work never hidden); otherwise `reassigned` > `revoked` > `approved`. Implemented once as `aggregateReviewStatus` + `REVIEW_STATUS_RANK` exported from `src/domain/metrics.ts` next to `reviewStatusOf`; the duplicate rank tables in `accessGraph.ts` and `accessMatrix.ts` are deleted. The aggregate also yields `mixed` (items disagree) for the tooltip.
5. **`applyReviewStatus(graph, items)` (pure, in `reviewOverlay.ts`)** returns `{ nodes: graph.nodes (same array reference), edges: new array }` where each `firstLevel` edge gets `reviewStatus` (+ `reviewMixed`) from the item index. Reusing the `nodes` reference lets the canvas keep the selected user across status-only changes.
6. **Node status derives from the edge.** `userSubgraph(graph, userId)` stamps `node.reviewStatus` (and `reviewMixed`) ONLY on nodes that are the target of a `firstLevel` user edge with a status, copying the edge value. Everything else has no status. Node ring, node icon and user edge are therefore one value and cannot diverge, and other users' statuses cannot leak (fixes Cause A).
7. **Hook.** `useAccessMatrix` keeps `rows` + a structural graph in state; returns `graph = useMemo(applyReviewStatus(structural, items), [structural, items])`. Resolution effect and its `idSig` key are unchanged (resolver NOT re-invoked on a decision). `CampaignDashboard` counts only node kinds, so `computeAccessCounts` output is unchanged; do not touch `accessCounts.ts`, `CampaignDashboard*`, `computeMetrics`.
8. **Canvas reset keyed on `graph.nodes`**, not `graph`, so a status-only refresh does not kick the reviewer out of the drill-down.
9. **Reference styling.** Edges: status edge = `reviewStatus` present (existing four styles, `zIndex: 1`, class `vc-graph-edge-status vc-graph-edge-<s>`); every other edge = reference (class `vc-graph-edge-reference`, inline `stroke:'var(--edge)'`, `strokeWidth:1`, no dash, `opacity:0.45`, `zIndex:0`, `data.reference:true`). Nodes: a non-user node with no `reviewStatus` gets `data.reference = true` -> card class `vc-graph-card-reference` (opacity ~0.75, no accent ring, lighter border). A node with a status is never `reference`. Existing tokens only (`--vc-warn/allow/deny/accent`, `--edge`, `--line`, `--muted`); no new colour tokens.
10. **Zero-composition first-level items** (AP/role that resolves with no entitlements) emit one bare first-level row instead of vanishing (confirm by test #5 first). A first-level kind whose label is blank is kept (label falls back to `accessItemName`, then `Unnamed <kind>`) so the first hop is never silently replaced by a deeper node. `access`-kind review items still have no node (documented, unchanged).
11. **Tooltip (optional, small):** `NodeTooltip` gets optional `reviewStatusLabel`/`mixed`/`reference` props; first-level nodes show `Review status: X` (+ `(mixed: some items still need review)`), reference-only nodes show a `Reference only (not reviewed)` note. Default rendering for existing calls is unchanged.

---

## 3. Ordered steps

- [ ] **Step 1. Reproduce first (no source changes).** Add the failing tests listed in the table (fixtures: user A with AP `ap-bill` {ent `e-pay`}, role `role-a` {AP `ap-foo` {ents `e-read`,`e-write`}, ent `e-del`}, directly held ents `e-login` (approved), `e-admin` (revoked), `e-read` held directly AND nested in `ap-foo`; user B holds `e-login` (needsReview) and `ap-bill` (reassigned); all four statuses across A's first level). Run `npx vitest run src/domain src/graph src/state src/sailpoint` and record which fail. Expect failures for #1, #4, #5(first-level marker), #6 z-order. Save failing names in the FEAT-001 `findings`.
  Files: new `src/domain/reviewOverlay.test.ts`; extend `src/domain/accessGraph.test.ts`, `src/graph/userSubgraph.test.ts`, `src/graph/buildAccessScene.test.ts`, `src/state/useAccessMatrix.test.ts`, `src/sailpoint/accessMatrix.test.ts`.
  Verify: the new tests fail for the stated reasons against unchanged source.

- [ ] **Step 2. Domain + data layer** (depends on 1). `types.ts` (edge `firstLevel/reviewKey/reviewStatus/reviewMixed`, node `reviewMixed`, row `accessItemName`, drop row `reviewStatus`, scene data `reference/reviewMixed`); `metrics.ts` (`REVIEW_STATUS_RANK`, `aggregateReviewStatus`, tests in `metrics.test.ts`); new `domain/reviewOverlay.ts`; `accessMatrix.ts` (remove status stamping/rank/merge, add `accessItemName`, bare first-level rows); `accessGraph.ts` (first-level marker + reviewKey, no status); `userSubgraph.ts` (derive node status from first-level edge); `useAccessMatrix.ts` (live overlay memo). Rewrite existing assertions that encode the old behaviour (row `reviewStatus`, global node status) to the new model rather than deleting them.
  Verify: `npx vitest run src/domain src/sailpoint src/state src/graph/userSubgraph.test.ts` green; `npx tsc -b` clean.

- [ ] **Step 3. Scene + UI** (depends on 2). `buildAccessScene.ts` (reference vs status edges, zIndex, node `reference` flag), `AccessNode.tsx` (card `vc-graph-card-reference`, `data-review-status` on the card, tooltip props), `NodeTooltip.tsx` (optional lines), `AccessGraphCanvas.tsx` (legend row "Reference only (not reviewed)" with a hairline swatch; reset on `graph.nodes`), `AccessGraph.css` (reference edge/card styles, hairline legend swatch, delete dead border rule, keep status ring on hover). Update `buildAccessScene.test.ts` / `AccessGraphCanvas.test.tsx` expectations that encode old nested styling (`edge.className` undefined for deeper edges becomes `vc-graph-edge-reference`).
  Verify: `npm test` green for graph tests; `npm run build` and `npm run lint` clean.

- [ ] **Step 4. Real-browser check** (depends on 3). Temporary harness + puppeteer-core, screenshot to `<artifact-root>/review-status-after.png` (+ zoom clips), assert via `page.$$eval`, fix visual issues, then delete harness and puppeteer. Details in FEAT-003.
  Verify: screenshot read and described; `git status` shows only intended files; `package.json`/`package-lock.json` untouched.

- [ ] **Step 5. Gates and commit.** `npm run build`, `npm run lint`, `npm test` in the worktree (re-run `useProvenance.test.ts` alone once if it flakes). Commit on the branch with the results recorded in the message. Never push.

---

## 4. Visual-verification harness spec (Step 4)

- Create (temporary, uncommitted): `<worktree>/review-status-harness.html` (copy of `index.html` pointing its module script at `/src/test/review-status-harness.tsx`) and `<worktree>/src/test/review-status-harness.tsx`. The tsx imports `../index.css`, `../graph/tokens.css` (AccessGraphCanvas already imports `AccessGraph.css`), and renders `<div style="height:1000px;width:1700px"><AccessGraphCanvas graph={graph} /></div>`. Add a harness-only style `.vc-graph-wrap{height:1000px}` so the many-entitlement lane is legible.
- Build `graph` through the REAL pipeline: `resolveMatrix(items, stubResolver)` -> `deriveAccessGraph` -> `applyReviewStatus(graph, items)`, with a stub `AccessCompositionResolver` (plain async functions) and a fixture of ReviewItemVMs mirroring the screenshot: user "Amos Cunningham" holding 3 access profiles, 1 role (containing an AP + a direct entitlement), about 14 directly held entitlements, entitlement `e-shared` held directly AND nested in a held AP, a mix of all four statuses across first-level items (mostly needsReview, several approved, one revoked, one reassigned), nested-only entitlements, 4 sources; plus a second user holding `e-shared` and a held AP with different statuses (cross-user leak check).
- Run: `cd <worktree> && npm install --no-save puppeteer-core@23`; `npm run dev -- --port 5199 --strictPort` in the background (HTTPS self-signed); drive `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` via puppeteer-core `launch({executablePath, headless:true, args:['--ignore-certificate-errors','--no-sandbox']})`, viewport 1800x1100, `deviceScaleFactor` 1 for the full shot and 2 for clips; open `https://localhost:5199/review-status-harness.html`, click `[aria-label="Show access for Amos Cunningham"]`, wait for `.react-flow__node` count, screenshot to `/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.agents/tasks/review-status-graph/review-status-after.png`; also a legend clip and a clip of a first-level + a nested-only node.
- `page.$$eval` assertions (print a table of results, fail loudly):
  1. For every `.react-flow__node` whose card has `data-review-status`: exactly one `svg.vc-graph-status-icon`, its `data-review-status` equals the card's, and equals the `vc-graph-edge-<status>` class on the edge `g[data-id="e:user:<id>:<nodeId>"]`.
  2. Every edge not originating at the user node, and every user edge whose target has no status icon, has class `vc-graph-edge-reference`, computed `stroke-dasharray` `none`, computed `stroke-width` <= 1.1, computed opacity < 1.
  3. Cards with class `vc-graph-card-reference` have no `svg.vc-graph-status-icon`; the user card has no reference class.
  4. Computed `stroke-dasharray` on needsReview edges is not `none`; approved/revoked edges are `none`; reassigned is dotted.
  5. Legend contains the four status rows plus "Reference only".
  6. Z-order: in DOM order the group containing status edges comes after reference edges.
  7. Then READ the PNG with the image reader and describe it (rings, icons, dashed amber lines, muted gray hairlines, legend, no clipped icons on long labels).
- Cleanup (mandatory before commit): kill the dev server; delete the harness html/tsx; `npm uninstall` is NOT used (it would edit package.json): remove with `rm -rf node_modules/puppeteer-core` and its deps only if `git status` and `npm ls puppeteer-core` show it; confirm `git -C <worktree> status --short` lists only intended `src/` files and that `git diff --stat -- package.json package-lock.json` is empty. The screenshot lives only under the artifact root (outside the worktree).

## 5. Constraints checklist for every step

Do not touch `src/domain/accessCounts.ts` or `src/views/CampaignDashboard*`; `computeMetrics` unchanged; `rowKey` excludes enrichment; no `pathCount` badge; no text status chip; node name and kind caption still render; grid overview (`buildUserGridScene`) unchanged; status `Record`s and switches exhaustive over `AccessReviewStatus`; keep the scoped `stubRect` pattern in tooltip tests and add no global `getBoundingClientRect` stub.

## 6. Reporting note for the finalizer

Open question to report (do not change): the dashboard "Access items" card counts distinct expanded leaf entitlements, which no longer equals "first-level reviewable items" under this model. Report only.
