# Drill-down graph: per-user live review status and reference-only nested links

Fixes the drill-down graph so review status is a per-user first-level concept. Status was stamped on user-shared nodes, so rings and icons disagreed with edge colours and leaked between users. It was also baked in at resolve time, so it went stale after a decision. Status is now a live overlay on structurally marked first-level edges, node status is copied from the viewed user's own first-level edge, and deeper links render as muted reference hairlines. I read the diff, the plan, FEAT-001..003 findings, the verification note and the screenshot. I did not re-run build, lint or tests, and no spot-check was needed.

Watch for: minor presentation nits only, none blocking (possible, see Issues).

**Verdict**: APPROVED

## High-level view

The root cause was confirmed by reproduction tests before the fix. Node status was global and shared across users while the user-to-item edge was per user. `useAccessMatrix` also baked status into resolved rows. The fix separates structure from status: `deriveAccessGraph` marks each user-to-item review hop (`firstLevel` plus `reviewKey`) and stamps no status. `applyReviewStatus` joins current review items onto those edges in a `useMemo`. `userSubgraph` derives node status from the viewed user's first-level edge only. Ring, corner icon and user-edge colour therefore come from one value, and another user's status cannot reach a node.

The join key uses the review item's own `identityId`/`accessKind`/`accessId` (falling back to name) on both sides. It no longer depends on the resolved composition id. Aggregation is one rank table (`REVIEW_STATUS_RANK` in `metrics.ts`) with an order-independent `aggregateReviewStatus` and a `mixed` flag. The duplicate tables are gone.

In the scene, status edges get a status class, `zIndex: 1` and the four existing styles. Every other edge is a reference hairline (`var(--edge)`, width 1, opacity .45, solid, `zIndex: 0`). Non-user nodes without a status get `reference: true` and are muted, with no ring or icon. Cards sit at `zIndex: 2` so status lines never strike through names. The legend gains a distinct "Reference only (not reviewed)" row and is lifted clear of the zoom controls.

The resolver is not re-invoked on a decision, and `graph.nodes` stays reference-stable. Hook tests assert both.

<details>
<summary>Issues (3)</summary>

1. **Reference card hover** (confirmed, non-blocking) — hovering a reference card gets no accent ring because the reference rule has equal specificity and comes later. Optional: add a `:hover` rule if hover affordance is wanted there.
2. **Edges pass behind reference cards** (possible, non-blocking) — in the screenshot, a user-edge (e.g. red to Global Administrators) passes behind the semi-transparent "Sales Nested AP" reference card and can look like it originates there. Optional: raise reference card opacity or route differently.
3. **reviewKey first-wins** (confirmed, informational) — if two different review accessIds resolve to the same node, the first edge's key wins (documented in FEAT-001 as not expected in practice). No action unless it is observed.

</details>

<details>
<summary>Details</summary>

## Diagnosis-first evidence

FEAT-001 lists 14 tests that failed against unchanged source and pass now. They cover the cross-user leak (`node needsReview` vs `edge approved`, and a nested-only node showing `approved`), the stale status in `useAccessMatrix`, and first-level edge-set equality. They also cover zero-composition AP and role first hops, blank-label first hops, and aggregation, id matching and name fallback in `reviewOverlay`. FEAT-001 also records which tests were guards that already passed: deeper edges were never stamped, and id mismatch was not a live bug. The verification note maps each root cause to a passing test. Evidence is sufficient.

## Single-source status in userSubgraph

`userSubgraph` copies nodes, strips any `reviewStatus`/`reviewMixed` defensively, and sets them only from a kept edge with `from === userNodeId`, `firstLevel` and a `reviewStatus`. A nested-only node therefore has no status. A node that is both first-level and nested keeps its first-level status. A `firstLevel` edge with no matching review item stays unstyled (reference). That is the correct fail-quiet behaviour, though an unmatched item would silently look like reference.

## Live overlay in useAccessMatrix

The resolve effect and its `idSig` key are unchanged, and `graph` is `useMemo(applyReviewStatus(structural, items ?? []))`. `applyReviewStatus` returns the same `nodes` array and a fresh `edges` array. The tests assert unchanged resolver call counts (role, access profile, entitlement) after a decision, an updated edge status, and a stable `nodes` reference. The canvas resets on `graph.nodes`, so a status-only change does not eject the reviewer from the drill-down.

## Reference treatment

The legend, hover-ring preservation for status cards, the removal of the dead `border-left-color` rules, and the `zIndex` layering (nodes 2 > status edges 1 > reference edges 0) are all in place and covered by scene and canvas tests. Reference edges are styled both inline and in CSS. No new colour tokens are added.

## Visual verification

`review-status-after.png` exists (1800x1100) and I read it. Whole graph fits after drill-in. Status cards carry a ring and one lower-right icon: amber exclamation for needs review, green check for approved, red X for revoked, blue arrow for reassigned. User edges match: amber dashed, solid green, solid red, blue dotted. Nested-only entitlements, the nested access profile and the sources are muted, ringless and iconless, joined by thin grey hairlines under the status lines. The legend shows four icon rows plus "Reference only (not reviewed)" with a hairline swatch, above the zoom controls. FEAT-003 records the full assertion table (icon == card == edge status for 22 nodes, reference edge computed styles, z-order, legend/controls non-overlap, second-user no-leak). It also records three visual defects found and fixed (fit on drill-in, edges over names, legend over controls), each with a unit test. Cleanup is confirmed: the worktree `git status` is clean and no harness or puppeteer remains.

## Constraints

`package.json`, `package-lock.json`, `accessCounts.ts`, `CampaignDashboard*` and `buildUserGridScene.ts` show no diff against main. `computeMetrics` has only a comment change. `rowKey` excludes enrichment, and `accessItemName` is enrichment only. No `pathCount` badge, no text status chip, and no global `getBoundingClientRect` stub appear in the diff. Status maps are `Record<AccessReviewStatus, …>` and the edge-style switch has no default.

Open question, report only: the dashboard "Access items" metric counts distinct leaf entitlements, which no longer equals first-level reviewable items in the graph.

</details>

<details>
<summary>File map</summary>

Full diff: `git diff main...HEAD` in `.worktrees/review-status-fix` (branch `feature/graph-review-status-fix`, 3 commits).

- `src/domain/reviewOverlay.ts` (+ test): new live status join and `reviewKey`.
- `src/domain/metrics.ts` (+ test): single rank table and `aggregateReviewStatus`.
- `src/domain/accessGraph.ts` (+ test): first-level marker and `reviewKey`, no status, blank-label fallback.
- `src/sailpoint/accessMatrix.ts` (+ test), `types.ts`: row status removed, `accessItemName` added, bare first-level rows for empty AP/role.
- `src/graph/userSubgraph.ts` (+ test): per-user node status from the first-level edge.
- `src/graph/buildAccessScene.ts` (+ test): status vs reference edges, zIndex, node `reference` flag.
- `src/graph/AccessNode.tsx` (+ test), `NodeTooltip.tsx`: reference class, `data-review-status`, tooltip lines.
- `src/graph/AccessGraphCanvas.tsx` (+ test), `AccessGraph.css`: legend row, fit-on-scene-change, reset on `graph.nodes`, reference styles.
- `src/state/useAccessMatrix.ts` (+ test): `useMemo` overlay.
- `src/test/reviewStatusFixture.ts`: shared test fixture.

</details>
