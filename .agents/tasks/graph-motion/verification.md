# Verification: smooth transitions for the access graph canvas

Worktree: `.worktrees/graph-motion` (branch `feature/graph-motion`, base 44435ae). Everything below was run; nothing is inferred.

## 1. Gates (after the temporary harness, driver and puppeteer install were removed and `npm ci --ignore-scripts` restored node_modules)

| Command | Result |
| --- | --- |
| `npm run build` (`tsc -b && vite build`) | exit 0, zero type errors, `built in 645ms` |
| `npm run lint` (`eslint .`) | exit 0, no output |
| `npm test` run 1 | Test Files 49 passed (49), Tests 623 passed (623) |
| `npm test` run 2 | Test Files 49 passed (49), Tests 623 passed (623) |

Baseline before any change (unmodified main): 46 files / 537 tests. New: 3 test files (graphTransition 54, useGraphTransition 16, AccessGraphCanvas.motion 16 = 86 tests). All 537 existing tests pass UNCHANGED (no existing test file was edited).

## 2. Real-browser timeline (puppeteer-core 23, installed Chrome, headless, 1700x1000 and 1100x700)

Driver ran the scenarios against a harness that renders the real `AccessMatrixView` in the real shell with the real stylesheets. It was deleted before the commit. Logs of the two final runs:
- `timeline-run-production-build.log`: harness built with `vite build` and served with `vite preview` (production React): **437 / 437 assertions passed**.
- `timeline-run-dev-server.log`: Vite dev server (React dev build, StrictMode off except the `?strict=1` T6 runs): 435 / 437. The two misses (same check at both sizes) are `drill-dense` camera start 245-250 ms and end 678-683 ms against dev-mode limits of 250 / 670 ms; the production build starts that camera at 74-123 ms. This is dev-mode React overhead, not a logic failure.
- `timeline-results.json` = the production-build run (437 results + extra metrics). `baseline.json` = the same scenarios on the unmodified code.

Motion duration M = 450 ms (`--motion-ms`). The sampler is an in-page `requestAnimationFrame` loop started before the click (about 60 frames per scenario).

### Key numbers (production build)

| Check | Result |
| --- | --- |
| T1 grid -> drill-down (mixed, 1700x1000) | clicked card travels 718 px, largest one-frame step 8% of travel, never moves backwards; unmounted: never. Baseline code: 100% of the travel in the first frame. Other users: opacity falls monotonically through intermediate values, removed by 463 ms. 27 lineage cards: first frame class `entering`, opacity 0, **0 px** from the user card (all hops), end opacity 1 with no class. Dense: 47 lineage cards, same result. |
| T2 camera | The viewport interpolates over about 27 frames (baseline: 1 frame). Largest per-frame step 10-12% of the move (d3 ease), no regress. Starts 74-123 ms after the click (2 frames of settle + the overlay-measure frame), ends 459-556 ms. **Final viewport equals the pre-feature fit in all 13 scenarios x 2 sizes** (tolerance 0.5 px / 0.001 zoom). |
| T3 stray cards | 0 frames with a visible card at the canvas corner or at the flow origin in any scenario. (Off-canvas opaque cards during the camera sweep are expected while the camera moves; recorded, not asserted.) |
| T4 edge/card detachment (path end to handle, edges with opacity > 0.5) | With the edge fade-in: done-dense max 89 px / 6 violating frames; layout-mixed 239 px / 9; layout-dense 242 px / 9; ref-mixed 76 px / 6; lane11 46 px / 3 (1100x700 roughly half). **Without** the refinement (`vc-graph-edge-settling` animation disabled): 536 px / 21; 1815 px / 24; 1838 px / 25; 468 px / 21; 373 px / 18. Baseline code has no motion, so no detachment. Drill-in entering edges: max 253 px / 9 frames (the edges wait 40% of M, then fade in as the cards arrive). Drill-out (exiting edges stretching from the moving user card to the fading lineage): max 555 px / 8 frames; they are at low opacity while stretched. **Decision: KEEP the refinement** (cuts violating frames by 2-3x and the worst distance by 2-8x). |
| T5 toggles | hide/show completed (dense), reference hide/show, layout LR<->TB (mixed, dense), lane 11->10 wrap: staying cards approach monotonically, removed cards fade through intermediate opacities and unmount by 469 ms, entering cards start at a related card (<= 2.5 px) with opacity < 0.1 and end at 1, new edges fade in with no pop (largest one-frame opacity step 0.10), staying edges never blink off, no `entering`/`exiting`/`settling` left after M+150, final positions equal the pure builders (max error 0 px), edge id sets equal. |
| T6 interrupts | 5 alternating reference toggles in 200 ms: correct final state, no duplicate ids, no flags, all opaque, viewport equals a single toggle. Click then Back at 120 ms, click then Escape at 100 ms: clean grid, viewport equals the grid fit. Resize mid-transition: viewport equals a fresh load at the new size. (a) and (b) repeated under `<StrictMode>`: pass. |
| T7 | Hover at +100 ms and click at +350 ms during hide-completed: no new entering/exiting nodes, staying cards stay monotone, hover emphasis (stroke width 3.5) done in **144 ms**, others dimmed. Entering reference edges with an active selection: 29 edges fade in monotonically (0 non-monotonic steps, 0 steps over 0.35) and the selected edge is intact. |
| T8 reduced motion | `--motion-ms` computes to `0s`, grid opaque at once, no transition flags in any frame, positions final in the first sample, final viewport equals the baseline, the viewport changes in 1 frame (a jump, never a glide). |
| T9 initial grid | First frame with cards: all at opacity <= 0.05 (no flash). First vs last card opacity differ by 1.0 at some frame (progressive); cascade complete after 1700 ms (limit 2330); only 1 distinct viewport while cards are visible (no camera animation from the default); final viewport equals the baseline. |
| T10 | `big` (451 nodes, over the 400 guard): no frame has an entering or exiting card; the first changed frame already has all 451 nodes. Frame pacing (rAF only, dense scenarios): median 16.7 ms, p95 16.8 ms in all 6 runs (**not** flagged; limit 50 ms). |
| T11 | 0 console errors / warnings / page errors. (Filtered: a favicon 404, and React Flow's dev-only `getNodesBounds` notice, which the unmodified code also prints because it calls the standalone `getNodesBounds`.) |
| T12 | Canvas bottom is 1 px from the window bottom minus the 12 px shell padding, no page scroll, nothing under overlays, lanes ordered user, role, access profile, entitlement, source, at most 10 per lane and wrapped into `ceil(n/10)` lanes (dense: 37 entitlements in 4 lanes), in every scenario at both sizes. |

### Abruptness, before vs after (grid -> drill-down, `baseline.json` vs `timeline-results.json`)

| | clicked card, largest one-frame step | frames in which the viewport changes |
| --- | --- | --- |
| before (unmodified) | 100% of the travel (first frame) | 1 |
| after | 8.5% of the travel | 26-27 |

## 3. Screenshots (contact sheets, 1700x1000, frames picked from a CDP screencast; labels show the target and the ACTUAL elapsed ms)

All in `.agents/tasks/graph-motion/`. I opened each one.

- `motion-1-grid-to-drilldown-mixed.png`: t=0 the grid of 8 users. 100 ms: the other users are already faded out, User 1 sits where it was with a faint ghost behind it, the 27 lineage cards are at the user position and invisible. 194 ms: lineage cards are half transparent and fanning out from the user, no edge drawn yet. 296 ms: cards nearly in their lanes (roles, access profiles, entitlements, sources) while the camera zooms out; the first status edges are fading in attached to cards. 448 ms: everything in place, edges attached; 553 ms: final. Nothing pops and no edge floats free.
- `motion-2-drilldown-to-grid-mixed.png`: t=0 the full drill-down. 103 ms: the lineage cards fade out in place while the camera starts to move; the exiting edges stretch to the user card, which has started to glide left (they are fading). 204/302 ms: lineage almost gone, the user card glides toward its grid cell, the camera zooms in. 450 ms: only User 1 remains, still empty grid. 694 ms: the other users cascade in one after another (User 2, then a faint User 3). Reads as the mirror of 1.
- `motion-3-hide-completed-dense.png`: 25 entitlements in 3 columns. 101 ms: completed cards (green and red outlines) are fading, the remaining cards already moving. 200 ms: remaining cards glide to the re-wrapped lanes, cards cross paths briefly (they are moving between two layouts), removed cards ghosted, edges nearly invisible. 265 ms: cards close to their final cells, edges fading in. 553/576 ms: final 2-column layout, all edges attached. No snap, no card at the corner.
- `motion-4-layout-lr-to-tb-mixed.png`: 98 ms: the whole graph is already rotating, cards on diagonal paths, edges hidden. 199 ms: cards spread on the way from rows to columns, some overlap mid-glide, edges still hidden. 304 ms: the tree is nearly in place, the edges fade in and are attached. 450/516 ms: final top-to-bottom tree.
- `motion-5-initial-grid-reveal.png`: 30 ms: blank page (still loading, the canvas has not mounted). 596 ms: first rows visible, the last visible ones half transparent, the rest not yet shown. 997 and 1498 ms: the cascade continues row by row. 1800 ms: all 40 cards opaque, the camera never moved.
- `motion-final-drilldown-1700x1000.png`, `motion-final-drilldown-1100x700.png`: settled drill-down (mixed): legend bottom-left above the zoom controls, minimap bottom-right, vertical control panel top-right, canvas to the bottom of the window, nothing under an overlay.

## 4. Decisions and deviations from the brief (all deliberate, each with the reason)

1. **Entering edges ARE restyled by `highlightEdges`; only EXITING edges are excluded.** The brief's premise (inline opacity would beat the stylesheet `opacity: 0`) does not hold for this DOM: in React Flow 12.12 the inline style is on the inner `<path>` and the class on the outer `<g>`, so the two multiply. Checked in the browser (T7): 29 entering edges with an active selection fade in monotonically, no pop. Skipping them would instead make them pop to their dimmed style when the transition ends.
2. **Entering/settling edges fade with a keyframe animation** (`vc-graph-edge-arriving` / `-settling`, delayed 40% of M) instead of the `entering` transition. React Flow mounts an edge only after both cards are measured, which can be after the class was cleared, and a staying edge cannot use the transition (the reversal shortening factor). Measured effect: see T4 above.
3. **`measured` is set on every card of an animated frame.** React Flow forgets a card's handle positions when it gets a new node object without `measured`, and the edges of an unmeasured card disappear for a frame; without it every edge blinked off at the start of phase 2 and at the end of the transition (seen in the first browser run). End state is unchanged (the size is the one the builders already set).
4. **Frame order = previous order, then new items** (`frameOrder`), not "target order". Putting the exiting cards after the staying ones made React move their DOM nodes, which cancelled the fade (the card snapped to invisible) and would drop focus. Found in the browser.
5. **Exiting cards/edges fade with keyframes** (`vc-graph-fade-out`), because a card that was revealing (grid -> drill-down) has an animation holding its opacity and removing it does not start a transition. Found in the browser.
6. **Clock of phases 2 and 3 starts when the start frame is committed**, not when the update is planned (a 450-node render takes longer than two frames in dev, which skipped phase 1 entirely and made cards pop in). Found in the browser.
7. **Phase 1 keeps staying cards at their target position** (they start gliding at once) while the camera starts after the cards are placed: the camera starts about 2-3 frames (32-50 ms) after the first card movement. Ends are within one frame of each other (camera tail is imperceptible).
8. Multi-hop origins (`resolveOriginPositions`), the `placed`-gated fit, a zero-motion bypass and the staged initial frame are as in the plan. The first display of the grid uses lead 0 (no camera move to wait for); later cascades use M.
9. The pure helpers live in `graphTransition.ts` (as the plan says); `useGraphTransition.ts` holds the hook, `useMotionMs.ts` the CSS reader.
10. Not changed: the scene builders, filters, `userSubgraph`, the review pipeline, control panel behavior, `App.css` / `AccessMatrixView.css`, `accessCounts.ts`, `CampaignDashboard*`, package files. No new dependency.

## 5. Cleanup proof

`git status --short` (after cleanup, before commit): only
```
 M src/graph/AccessGraph.css
 M src/graph/AccessGraphCanvas.tsx
 M src/graph/tokens.css
?? src/graph/AccessGraphCanvas.motion.test.tsx
?? src/graph/graphTransition.test.ts
?? src/graph/graphTransition.ts
?? src/graph/useGraphTransition.test.ts
?? src/graph/useGraphTransition.ts
?? src/graph/useMotionMs.ts
```
`git diff --stat -- package.json package-lock.json` is empty. The harness HTML/TSX, the fixtures, the driver, the debug script, `.motion-tmp` and `dist` were deleted; `npm ci --ignore-scripts` removed puppeteer-core (`ls node_modules | grep -c puppeteer` = 0).
