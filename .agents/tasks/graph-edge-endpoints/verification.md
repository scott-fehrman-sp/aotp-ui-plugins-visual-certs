# Diagnosis evidence: access graph edge endpoints off the card borders

Worktree `.worktrees/edge-ends` (branch `fix/graph-edge-endpoints`, HEAD 9e62179). Nothing below is inferred from memory: every number was measured in installed Chrome (headless, puppeteer-core 23, `--ignore-certificate-errors --no-sandbox`) against the real `AccessMatrixView` in the real shell (`.vc-app > header > main.vc-main > .vc-route`) with the real stylesheets in the `main.tsx` order plus `App.css`. Harness, driver, analysis scripts and raw JSON are in this directory (`harness/`, `results/`). No source file was changed; the one prototype (fix B) was applied, measured, saved as `harness/protoB-reference.patch` and reverted.

## 1. Method

- Fixtures (from `src/test/reviewStatusFixture.ts` `statusGraph`, built in `harness/edge-harness.tsx.txt`): `mixed` (2 roles, 3 access profiles, 6 first-level entitlements, all four statuses, nested lineage, 4 sources, plus users 2 and 3), `dense` (4 access profiles, 1 role, 25 first-level entitlements wrapping into 3 columns, nested nodes, 3 sources), `shot1` (screenshot 1: access profile "ERP Employee Access" selected, 13 nested entitlements View_Reports, Internal_Employee, User, ... wrapped into 2 sub-columns, source PRISM; entitlement All_Employee_Entra with source "Entra ID - tessailpoint"), `lane11` (11 first-level entitlements, one approved: hide-completed takes the lane 11 -> 10).
- Settled = no `entering`/`exiting`/`vc-graph-edge-settling`/`vc-graph-edge-arriving` class, no running finite animation or transition, viewport transform unchanged for 10 consecutive frames. Measured again 500 ms later (`drift` was 0.00 in every run).
- For EVERY rendered edge: id parsed as `e:<fromId>:<toId>` against the rendered node ids, first/last path point through `getScreenCTM()`, compared with the `.react-flow__node` wrapper rect (200x64 flow units x zoom, no border, never scaled). LR: source on the RIGHT border, target on the LEFT border, vertical centre; TB: bottom/top, horizontal centre. `dxBorder` = signed distance from the border along the lane axis (negative = inside the card, positive = outside). `dCross` = offset from the card centre. Also measured: `edge-vs-handle` = distance from the path end to the handle `<div>` really drawn in the DOM (nonzero = React Flow holds STALE handle bounds). A MutationObserver recorded the class list and the card's computed transform at the moment each card wrapper first entered the DOM.
- Scenarios, each at 1700x1000 and 1100x700, LR and TB (TB = toggle the layout control after drill-in, as a user would), motion ON and motion OFF (`prefers-reduced-motion: reduce` emulation -> `--motion-ms: 0`): `drill-initial`, `drill-early` (click while the grid cascade is still running), `drill-wait` (+2 s), `hide-completed` on/off, `reference` hide/show, `layout` LR<->TB, `select` (access profile, deselect, entitlement), `hover`, `select-toggle` (select, then completed/reference/layout toggles), `wrap` (lane11, 11<->10), `back-other` (Back to all users, drill into another user, back, again), `resize` (window shrink and back), `rapid` (5 reference toggles 90 ms apart, 4 completed toggles), `shot1-select`, `zoom` (Controls zoom-in 8x to MAX_ZOOM 1.8, then out to 0.42), `blink` (per-frame sampler: does a staying edge ever leave the DOM during a toggle). Console errors/warnings were collected per run (favicon, `getNodesBounds` and resource-load noise ignored): none in any run.
- Servers: `vite build` + `vite preview` (production) AND the Vite dev server (`createServer`, StrictMode ON as in `main.tsx`). Dev and prod agree to the second decimal (tables below are prod; dev summaries in section 5).
- Commits: (1) `44435ae` before transitions (separate worktree `.worktrees/bisect-pre`, own `npm ci`, harness files copied), (2) `9e62179` current, (3) `9e62179` with `withMeasured` returning the node unchanged (temporary edit, reverted), (4) `9e62179` + prototype fix B.

## 2. Result: max |dxBorder| / max |dCross| in px per scenario and commit (prod build; max over fixtures and both window sizes; "pre" has no motion code so its on/off runs are identical and are pooled)

PASS tolerance is 1.5 px.

#### LR

| scenario | pre 44435ae | 9e62179 motion ON | 9e62179 motion OFF | 9e62179 no `measured`, ON | 9e62179 + fix B ON | + fix B OFF |
|---|---|---|---|---|---|---|
| drill-initial | 2.87 / 0.00 | **7.61** / 0.02 | 2.87 / 0.00 | 7.61 / 0.02 | 0.41 / 0.00 | 0.41 / 0.00 |
| drill-early | 2.87 / 0.00 | **7.61** / 0.02 | 2.87 / 0.00 | 7.61 / 0.02 | 0.41 / 0.00 | 0.41 / 0.00 |
| drill-wait | 2.87 / 0.00 | **7.61** / 0.02 | 2.87 / 0.00 | 7.61 / 0.02 | 0.41 / 0.00 | 0.41 / 0.00 |
| hide-completed | 3.33 / 0.00 | **8.84** / 0.03 | 3.33 / 0.00 | 7.61 / 0.02 | 0.48 / 0.00 | 0.48 / 0.00 |
| reference | 3.67 / 0.00 | **9.75** / 0.03 | 3.67 / 0.00 | 7.61 / 0.02 | 0.52 / 0.00 | 0.52 / 0.00 |
| layout | 2.87 / 1.09 | **7.61** / 1.09 | 2.87 / 1.09 | 7.61 / 1.09 | 0.41 / 0.00 | 0.41 / 0.00 |
| select | 2.87 / 0.00 | **7.61** / 0.02 | 2.87 / 0.00 | 7.61 / 0.02 | 0.41 / 0.00 | 0.41 / 0.00 |
| hover | 2.87 / 0.00 | **7.61** / 0.02 | 2.87 / 0.00 | 7.61 / 0.02 | 0.41 / 0.00 | 0.41 / 0.00 |
| select-toggle | 4.30 / 1.23 | **11.40** / 1.23 | 4.30 / 1.23 | 8.84 / 1.23 | 0.61 / 0.00 | 0.61 / 0.00 |
| wrap 11<->10 | 2.87 / 0.00 | **7.61** / 0.02 | 2.87 / 0.00 | 7.61 / 0.02 | 0.41 / 0.00 | 0.41 / 0.00 |
| back-other | 3.33 / 0.00 | **8.84** / 0.03 | 3.33 / 0.00 | 8.84 / 0.03 | 0.48 / 0.00 | 0.48 / 0.00 |
| resize | 2.87 / 0.00 | **7.61** / 0.02 | 2.87 / 0.00 | 7.61 / 0.02 | 0.41 / 0.00 | 0.41 / 0.00 |
| rapid | 3.67 / 0.00 | **9.75** / 0.03 | 3.67 / 0.00 | 7.61 / 0.02 | 0.52 / 0.00 | 0.52 / 0.00 |
| shot1-select | 2.70 / 0.00 | **7.18** / 0.02 | 2.70 / 0.00 | 7.18 / 0.02 | 0.39 / 0.00 | 0.39 / 0.00 |
| zoom (to 1.8) | 6.30 / 0.00 | **16.72** / 0.05 | 6.30 / 0.00 | not run | 0.90 / 0.00 | 0.90 / 0.00 |
| blink (toggles) | 3.67 / 1.09 | **9.75** / 1.09 | 3.67 / 1.09 | not run | 0.52 / 0.00 | 0.52 / 0.00 |
| **ALL** | 6.30 / 1.23 | **16.72** / 1.23 | 6.30 / 1.23 | 8.84 / 1.23 | **0.90 / 0.00** | **0.90 / 0.00** |

#### TB

| scenario | pre 44435ae | 9e62179 ON | 9e62179 OFF | no `measured`, ON | + fix B ON | + fix B OFF |
|---|---|---|---|---|---|---|
| drill-initial / early / wait / select / hover / resize / shot1-select | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 |
| hide-completed | 0.41 / 1.23 | **1.73** / 1.23 | 0.41 / 1.23 | 1.73 / 1.23 | 0.41 / 0.00 | 0.41 / 0.00 |
| reference | 0.49 / 1.48 | **1.73** / 1.48 | 0.49 / 1.48 | 1.73 / 1.48 | 0.49 / 0.00 | 0.49 / 0.00 |
| layout | 2.87 / 1.09 | 2.87 / 1.09 | 2.87 / 1.09 | 2.87 / 1.09 | 0.41 / 0.00 | 0.41 / 0.00 |
| select-toggle | 3.33 / 1.60 | **7.61** / 1.59 | 3.33 / 1.60 | 7.61 / 1.60 | 0.53 / 0.00 | 0.53 / 0.00 |
| wrap | 0.36 / 1.09 | **1.73** / 1.09 | 0.36 / 1.09 | 1.73 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 |
| back-other | 0.41 / 1.23 | **1.96** / 1.23 | 0.41 / 1.23 | 1.96 / 1.23 | 0.41 / 0.00 | 0.41 / 0.00 |
| rapid | 0.49 / 1.48 | 0.49 / 1.48 | 0.49 / 1.48 | 0.49 / 1.48 | 0.49 / 0.00 | 0.49 / 0.00 |
| zoom (to 1.8) | 0.90 / 2.70 | 0.90 / 2.70 | 0.90 / 2.70 | not run | 0.90 / 0.00 | 0.90 / 0.00 |
| **ALL** | 3.33 / 2.70 | **7.61** / 2.70 | 3.33 / 2.70 | 7.61 / 1.60 | **0.90 / 0.00** | **0.90 / 0.00** |

(The `layout` and `select-toggle` TB rows include a step measured in LR after a layout switch, hence 2.87 / 3.33 / 7.61.) Full per-scenario tables: `results/combined-tables.md`; raw per-step data: `results/*.json`.

#### Endpoints beyond the 1.5 px tolerance, and stale handle bounds

| set | failing endpoints | runs failing / runs | max path-end-vs-DOM-handle LR / TB |
|---|---|---|---|
| pre 44435ae (on+off pooled) | 11382 | 128 / 256 | 0.00 / 0.00 |
| 9e62179 motion ON | 12638 | 82 / 128 | **10.64 / 4.84** |
| 9e62179 motion OFF | 5691 | 64 / 128 | 0.00 / 0.00 |
| 9e62179, `measured` disabled, ON | 9131 | 67 / 112 | 5.63 / 4.84 |
| 9e62179 + fix B ON | **0** | 0 / 128 | 0.00 / 0.00 |
| 9e62179 + fix B OFF | **0** | 0 / 128 | 0.00 / 0.00 |

#### Edge blink (a staying edge missing from the DOM for a frame during hide/show completed, hide/show reference, layout; 40 toggles per mode)

| set | edges that blinked |
|---|---|
| pre 44435ae | 592 per mode (every staying edge: the old code has no `measured`) |
| 9e62179 ON | 0 (what `measured` was added for) |
| 9e62179 OFF (reduced motion / immediate path) | 592 (unchanged from pre; out of scope) |
| 9e62179 + fix B ON / OFF | 0 / 592 (no change from 9e62179) |

## 3. Hypotheses

- **H1 CONFIRMED, and it is the regression.** Motion ON only. Cards first mounted with the `entering` class have `matrix(0.94, 0, 0, 0.94, 0, 0)` as card transform at first appearance (recorded). React Flow's ResizeObserver callback on mount is `force: true` (`@xyflow/react/dist/esm/index.js` line ~2160) and `updateNodeInternals` measures each `<Handle>` with `getBoundingClientRect` (`getHandleBounds`, `@xyflow/system` ~939), so the offsets are measured on a card scaled to 94% around its centre. The card size does not change when the scale animates back to 1, so React Flow never re-measures and the scene builders' `measured` (kept to stop edge blinking) preserves the wrong offsets. Quantitatively: scaled left handle x = 100 - (100 - 3.5) x 0.94 = 9.29 flow units (should be 0); at zoom 0.819 that is 7.61 px, at zoom 1.8 it is 16.72 px, both EXACTLY what was measured. Of the endpoints belonging to cards whose first mount was `entering`, 2136 of 2136 (LR) had a path end that disagreed with the DOM handle by > 0.5 px, against 0 of 544 for cards first mounted in the grid `reveal` state (the user card; it is re-measured on drill-in because its `sourcePosition` prop changes, which makes React Flow re-measure with `force: true`, `@xyflow/react` index.js ~2211-2221; `buildUserGridScene.ts` sets no `sourcePosition`/`targetPosition`, the drill-down builder sets both). That also explains why a layout switch "heals" the stale bounds: the same `sourcePosition`/`targetPosition` change forces a re-measure, now at scale 1 (TB stale endpoints: 348 of 2136, only cards that entered while already in TB).
- **Not a camera/zoom variant (killed).** `updateNodeInternals` takes the zoom from `getComputedStyle(viewport).transform` (the DOM), not from the store, so the offsets are consistent with the camera at that instant. Evidence: with fix B the endpoints are exact in `drill-early` (click during the grid cascade and the camera tween), `rapid`, `resize` and at zoom 1.8, with the same camera motion as before.
- **`measured` is not the cause (killed as the sole cause).** With `withMeasured` disabled the displacement stays (8.84 / 5.63 vs 11.40 / 7.11): the stale offsets are measured at mount while `entering`, and the re-measure that follows a new object without `measured` also happens while the card's own scale transition is still running. `measured` only makes the wrong value permanent and must stay (it is what removes the edge blink: 592 -> 0).
- **H2 KILLED** (lane wrapping 44435ae/b474f19 and selection/emphasis restyle). At `44435ae` (after both wrapping commits, before transitions) the path end always equals the DOM handle (`edge-vs-handle` 0.00) in every scenario including `wrap`, `select`, `hover`, `shot1-select`. The selection ring and hover shadow are `box-shadow`s and change no box.
- **H3 CONFIRMED as a SECOND, older defect that the 1.5 px bar exposes.** Even with motion OFF and even at `44435ae` the endpoints are not on the card border: the `<Handle>`s are children of `.vc-graph-card`, which is `position: relative` with `border-left: 4px` and 1 px on the other sides, and React Flow positions a handle against the PADDING box. Result (measured, constant in flow units): the LR target endpoint sits 3.5 units INSIDE the left border (2.87 px at zoom 0.82, 4.30 px at 1.2, 6.30 px at 1.8), the right/top/bottom endpoints 0.5 inside, and in TB the horizontal anchor is 1.5 units right of the card centre (`dCross` 1.09 px at 0.73, 2.70 px at 1.8). Under the 1.5 px bar this fails from zoom 0.43 up in every settled state of both `44435ae` and `9e62179`. It contributes the 2.87 px of the 7.61 px in the table.
- **No "outside" endpoint reproduced.** In 3,400+ settled measurements of the unfixed code (44435ae and 9e62179, dev and prod, zoom 0.42-1.8), no endpoint was ever outside the border (max outside = 0.00 px); all deviations are INSIDE the card. (With fix B the 0.5-unit remainder is OUTSIDE by up to 0.9 px at zoom 1.8, i.e. a hairline touching the border.) The screenshot's "starts ~15 px outside" is most likely the dash phase: the status edges are dashed/dotted and start 7-17 px under the card, so the first VISIBLE dash can begin well after the border. Not verifiable without the screenshot; fix B removes the cause either way (endpoints within 0.9 px of the border at all zooms).

## 4. Motion ON vs motion OFF at 9e62179

With motion OFF (reduced motion; no `entering` class ever applied; every card is measured at scale 1) the displacement is exactly the old H3 offset (max 4.30 px LR, 3.33 TB; stale-vs-DOM 0.00). With motion ON it grows to 11.40 px (16.72 px at zoom 1.8), stale-vs-DOM up to 10.64 px. So the user-visible regression (10-20 px, differing card to card, depending on when each card was first mounted) is in the motion path; the 3.5-unit left offset is older and is also fixed by B.

## 5. Candidate fixes, decided by evidence

- **B (chosen, prototype measured).** Render the eight `<Handle>`s as siblings of the `NodeTooltip`/`<article>` in `AccessNode.tsx` instead of children of `.vc-graph-card` (two `return`s: grid card and drill-down card). They become direct children of the React Flow node wrapper (`position: absolute`, no border, 200x64, never scaled): the scale(0.94) in `AccessGraph.css` still applies only to `.vc-graph-card` (visual effect identical), and the containing block is now the full outer box. Prototype results: 0 failing endpoints in 256 runs (prod and dev), max |dxBorder| 0.90 px (at zoom 1.8; the constant 0.5-unit remainder is React Flow centring its 1 px handle on the wrapper edge), max |dCross| 0.00, stale-vs-DOM 0.00, blink unchanged (0 ON). Existing suite with the prototype applied: 49 files / 623 tests pass.
- **A (`useUpdateNodeInternals` after settle): rejected as the fix.** It would remove the 94% error but cannot reach the bar: with motion OFF (everything freshly measured at scale 1) the endpoints are already 6.30 px off at zoom 1.8 because of H3, so A alone leaves ~1/3 of the run matrix failing. It also needs a reliable "card transform transition ended" signal (by the timers in `useGraphTransition` the `final` frame lands at M after the start commit while the card's scale transition starts ~2 frames after it, so it ends slightly later; inferred from the code, not measured), re-measures on every settle, and risks edge flicker. Strictly worse than B and unnecessary once B holds.
- **C (explicit `node.handles`): rejected (from source, not run).** `getEdgePosition` prefers `internals.handleBounds` over `node.handles`, and the mount-time ResizeObserver measurement (`force: true`) overwrites the user handles with the DOM value; removing the DOM `<Handle>`s would leave `handleBounds = {source: null, target: null}` (truthy), so no handle is found. It cannot make the bounds independent of the DOM.
- **D:** nothing else found. The size guard, `measured`, camera, class phases and scene builders are unaffected.

## 6. Dev server numbers (same harness, StrictMode on)

| set | ON LR (max px / stale) | ON TB | OFF LR | OFF TB |
|---|---|---|---|---|
| 9e62179 | 11.40 / 7.11 | 7.61 / 4.84 | 4.30 / 0.00 | 3.33 / 0.00 |
| 44435ae | 4.30 / 0.00 | 3.33 / 0.00 | 4.30 / 0.00 | 3.33 / 0.00 |
| 9e62179 + fix B | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 |

## 7. State left behind

`.worktrees/edge-ends` is clean (`git status --short` empty; the temporary harness, driver, vite config and `.edge-harness-dist/` were deleted; `npm ci --ignore-scripts` removed `puppeteer-core`; `package.json`/`package-lock.json` never changed). The extra worktree `.worktrees/bisect-pre` was removed. No dev/preview server is running. The harness is preserved in `harness/` for the implementer (plan step 1).

---

# After the fix (implementation step)

Branch `fix/graph-edge-endpoints`, worktree `.worktrees/edge-ends`. Fix = plan candidate B: the eight `<Handle>`s are rendered as siblings of the `NodeTooltip`/`<article class="vc-graph-card">` in both returns of `AccessNode` (direct children of the React Flow node wrapper) instead of children of the scaled, bordered card. `src/graph/AccessNode.tsx` (+ comments), `src/graph/AccessGraph.css` (comment only), new `src/graph/AccessNode.handles.test.tsx`. Nothing else changed: `graphTransition.ts` (`withMeasured`), `useGraphTransition.ts`, canvas, builders, controls, `package.json`, `package-lock.json` are untouched, no existing test edited.

Why one fix is enough (a second one, `useUpdateNodeInternals`, was not needed): the handles now live on a box that is never scaled and has no border, so the one-time `getBoundingClientRect` measurement React Flow caches is already the true node box, whatever the card's transform is at mount. That removes both the 94% scale error (H1) and the padding-box offset (H3). Re-measuring after settle would only add store churn.

## 1. Real-browser matrix (same harness and driver as the diagnosis, recreated from `harness/`, temporary and now deleted)

Baseline reproduced BEFORE touching the code (prod build of 9e62179, 256 runs): motion ON LR max 16.72 px, TB 7.61; motion OFF LR 6.30, TB 3.33; path-end-vs-DOM-handle up to 10.64 px with motion ON, 0.00 with motion OFF. Identical to the diagnosis numbers.

AFTER the fix (256 runs prod build + 256 runs dev server with StrictMode; scenarios: drill-initial, drill-early, drill-wait, hide-completed, reference, layout, select, hover, select-toggle, wrap, back-other, resize, rapid, shot1-select, zoom (to 1.8 and 0.42), blink; fixtures mixed/dense/shot1/lane11; 1700x1000 and 1100x700; LR and TB; motion ON and OFF):

| set | max \|dxBorder\| LR ON / OFF | TB ON / OFF | max \|dCross\| | max path-end-vs-DOM-handle | endpoints > 1.5 px | unsettled steps | run errors / console errors |
|---|---|---|---|---|---|---|---|
| before (9e62179, prod) | 16.72 / 6.30 | 7.61 / 3.33 | 2.70 | 10.64 | 18329 | 0 | 0 |
| after, prod | 0.90 / 0.90 | 0.90 / 0.90 | 0.00 | 0.00 | **0** | 0 | 0 / 0 |
| after, dev | 0.90 / 0.90 | 0.90 / 0.90 | 0.00 | 0.00 | **0** | 0 | 0 / 0 |

0.90 px is at zoom 1.8 and is the hairline OUTSIDE the border (React Flow centres the 1 px handle on the wrapper edge); at the fit zoom (0.42 to 0.95) it is 0.36 to 0.61 px. Drift between the two measurements 500 ms apart was 0.00. The per-scenario table (max over fixtures and both sizes; "dxBorder / dCross"):


#### LR  (max |dxBorder| / max |dCross| px; max over fixtures and both window sizes)

| scenario | before ON | before OFF | after prod ON | after prod OFF | after dev ON | after dev OFF |
|---|---|---|---|---|---|---|
| drill-initial | 7.61 / 0.02 | 2.87 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| drill-early | 7.61 / 0.02 | 2.87 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| drill-wait | 7.61 / 0.02 | 2.87 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| hide-completed | 8.84 / 0.03 | 3.33 / 0.00 | 0.48 / 0.00 | 0.48 / 0.00 | 0.48 / 0.00 | 0.48 / 0.00 |
| reference | 9.75 / 0.03 | 3.67 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 |
| layout | 7.61 / 1.09 | 2.87 / 1.09 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| select | 7.61 / 0.02 | 2.87 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| hover | 7.61 / 0.02 | 2.87 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| select-toggle | 11.40 / 1.23 | 4.30 / 1.23 | 0.61 / 0.00 | 0.61 / 0.00 | 0.61 / 0.00 | 0.61 / 0.00 |
| wrap | 7.61 / 0.02 | 2.87 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| back-other | 8.84 / 0.03 | 3.33 / 0.00 | 0.48 / 0.00 | 0.48 / 0.00 | 0.48 / 0.00 | 0.48 / 0.00 |
| resize | 7.61 / 0.02 | 2.87 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| rapid | 9.75 / 0.03 | 3.67 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 |
| shot1-select | 7.18 / 0.02 | 2.70 / 0.00 | 0.39 / 0.00 | 0.39 / 0.00 | 0.39 / 0.00 | 0.39 / 0.00 |
| zoom | 16.72 / 0.05 | 6.30 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 |
| blink | 9.75 / 1.09 | 3.67 / 1.09 | 0.52 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 | 0.52 / 0.00 |
| **ALL** | 16.72 / 1.23 | 6.30 / 1.23 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 |

#### TB  (max |dxBorder| / max |dCross| px; max over fixtures and both window sizes)

| scenario | before ON | before OFF | after prod ON | after prod OFF | after dev ON | after dev OFF |
|---|---|---|---|---|---|---|
| drill-initial | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| drill-early | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| drill-wait | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| hide-completed | 1.73 / 1.23 | 0.41 / 1.23 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| reference | 1.73 / 1.48 | 0.49 / 1.48 | 0.49 / 0.00 | 0.49 / 0.00 | 0.49 / 0.00 | 0.49 / 0.00 |
| layout | 2.87 / 1.09 | 2.87 / 1.09 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| select | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| hover | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| select-toggle | 7.61 / 1.59 | 3.33 / 1.60 | 0.53 / 0.00 | 0.53 / 0.00 | 0.53 / 0.00 | 0.53 / 0.00 |
| wrap | 1.73 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| back-other | 1.96 / 1.23 | 0.41 / 1.23 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 | 0.41 / 0.00 |
| resize | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| rapid | 0.49 / 1.48 | 0.49 / 1.48 | 0.49 / 0.00 | 0.49 / 0.00 | 0.49 / 0.00 | 0.49 / 0.00 |
| shot1-select | 0.36 / 1.09 | 0.36 / 1.09 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 | 0.36 / 0.00 |
| zoom | 0.90 / 2.70 | 0.90 / 2.70 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 |
| blink | 2.87 / 1.48 | 2.87 / 1.48 | 0.49 / 0.00 | 0.49 / 0.00 | 0.49 / 0.00 | 0.49 / 0.00 |
| **ALL** | 7.61 / 2.70 | 3.33 / 2.70 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 | 0.90 / 0.00 |

Edge blink (staying edges that left the DOM for one frame, 40 toggles per mode): before ON 0 / OFF 592; after prod ON 0 / OFF 592; after dev ON 0 / OFF 592. The OFF number is the pre-existing immediate (reduced-motion) path and is unchanged.

Raw data: `after-fix/data/before-prod.json`, `after-prod.json`, `after-dev.json`, `tables.md`.

## 2. Smoothness and mid-transition detachment (per-frame sampler, rAF, 1700x1000, motion on, prod build, before = 9e62179 build, after = fixed build)

| timeline (1700x1000, motion on) | clicked card max 1-frame step, before / after | max detach px, before / after (rep 1) / after (rep 2) | frames with a visible (opacity>0.5) edge >2px off its handle, before / after | new-edge max 1-frame opacity step, before / after | blinking staying edges | leftover transition classes | final viewport and node rects identical |
|---|---|---|---|---|---|---|---|
| grid->drill mixed | 8.1% / 8.1% | 222.9 / 218.5 / 218.3 | 72 / 11 | 0.18 / 0.18 | 0 / 0 | 0 / 0 | true |
| hide-completed mixed | - | 26.4 / 31.4 / 31.4 | 86 / 10 | - | 0 / 0 | 0 / 0 | true |
| hide-reference mixed | - | 52.7 / 55.7 / 55.7 | 93 / 10 | - | 0 / 0 | 0 / 0 | true |
| layout LR->TB mixed | - | 207.7 / 207.5 / 207.7 | 14 / 14 | - | 0 / 0 | 0 / 0 | true |
| layout TB->LR mixed | - | 204.5 / 204.4 / 204.8 | 14 / 14 | - | 0 / 0 | 0 / 0 | true |
| grid->drill dense | 8% / 8% | 273.1 / 267.8 / 267.6 | 73 / 11 | 0.18 / 0.18 | 0 / 0 | 0 / 0 | true |
| hide-completed dense | - | 75.3 / 78.5 / 78.4 | 94 / 10 | - | 0 / 0 | 0 / 0 | true |
| hide-reference dense | - | 83.8 / 84.9 / 84.8 | 94 / 10 | - | 0 / 0 | 0 / 0 | true |
| layout LR->TB dense | - | 241 / 242.8 / 239.9 | 14 / 14 | - | 0 / 0 | 0 / 0 | true |
| layout TB->LR dense | - | 240.5 / 240.6 / 241 | 14 / 14 | - | 0 / 0 | 0 / 0 | true |
| lane wrap 11->10 | - | 83.4 / 83.2 / 83.1 | 86 / 10 | - | 0 / 0 | 0 / 0 | true |

Reading: the clicked card glides with the same largest one-frame step (8% of its travel) and never moves backwards; the camera tween changes the viewport in the same number of frames; new edges fade in with the same largest one-frame opacity step (0.18) and nothing pops; no staying edge blinks; no `entering`/`exiting`/`settling`/`arriving` class is left behind; the final viewport and the final rect of every card are identical to the shipped build (so identical to the pure builders and the pre-feature fit). Largest mid-transition detachment (path end to DOM handle, visible edges): layout switch 239.9 to 242.8 px over 14 to 15 frames (before 240.5 to 241.0, shipped figure 242), grid -> drill-down 218 to 268 px (before 223 to 273), hide-completed 31.4 mixed / 78.5 dense (before 26.4 / 75.3, shipped figure 89), hide-reference 55.7 / 84.9, lane wrap 83.2. Two repetitions of the fixed build differ by up to 2.9 px (sampling phase of a card moving 30 px per frame), so the layout rows are equal within noise. The hide-completed / hide-reference rows are about 3 to 5 px larger at the worst frame because the constant 3.5 to 7 px inward error that used to be counted at every frame is gone and the endpoints now sit on the true border, so the same moving card differs by that amount at the peak; both stay below the shipped 89 px, the edges are at that moment mostly transparent, and the number of frames in which a visible edge is more than 2 px off its handle fell from 72-94 to 10-11 (hide/show, drill) and is unchanged (14) for layout switches. Raw: `after-fix/data/smooth-*.json`.

## 3. Screenshots (1700x1000, LR, fixture shot1, production build), looked at, before and after

Files in `after-fix/screenshots/`: `before-*` / `after-*` `shot1-ap-selected.png` (access profile "ERP Employee Access" selected, lineage into the 2-column wrapped entitlement lane, then PRISM), `shot2-ent-selected-hover.png` (entitlement All_Employee_Entra selected and hovered, edge to source "Entra ID - tessailpoint"), plus 6x crops (68x44 css px) of card border midpoints: `*-crop-N-<card>-left|right.png`.

What I see:
- Before, source PRISM left border: the converging orange edges run past the white card's left stripe and end about 7 css px INSIDE the card (the tip pokes over the stripe). After: the tips stop exactly at the outer edge of the pale-blue left stripe, flush with the card, no overlap.
- Before, wrapped entitlement Internal_Employee left border: the edge stub ends about 7 px inside the stripe. After: it ends at the stripe's outer edge.
- Before, selected + hovered All_Employee_Entra, right side: the green edge starts about 5 px inside the card, crossing the green selection border and ending in a visible square stub on the white card. After: the green line starts at the outer green border and leaves the card cleanly; the dark hover/selection ring sits just outside it.
- After, "Entra ID - tessailpoint" left border: the green edge ends flush with the stripe. After, ERP Employee Access right border: the orange edges fan out starting at the card's border (under the selection ring), nothing overlaps the card body.
- Whole-canvas screenshots: edges visibly meet every card on its border in both situations; layout, colors, dimming of non-lineage cards, tooltip and the legend ("Reference Only") look the same as before.
I did not observe the "outside the node" overshoot the user circled in any of 3,400+ settled measurements (see section 3 of the diagnosis); what the fix removes is the 7 to 17 px inside offset, and the maximum residual is now 0.9 px outside at zoom 1.8.

## 4. Tests added (src/graph/AccessNode.handles.test.tsx, 4 tests; no existing test changed)

- grid and drill-down: every `.react-flow__node` wrapper has exactly the eight handles (`top-in ... right-out`) as DIRECT children, `handle.closest('.vc-graph-card')` is null, the card contains no handle, source/target classes match the ids, and the card is the tooltip anchor's first element child.
- CSS guard (reads `AccessGraph.css` from disk because vitest runs with `css: false`, which empties `?raw`): "scaling stays on the card, never on an ancestor of the handles" (every rule using `scale(` outside `@keyframes` ends in `.vc-graph-card`) and no rule on `.react-flow__node[.state]` sets `transform:` or `scale`.
- Mutation check done once: with `<Handles />` moved back inside the `<article>` the two DOM tests fail; with the `.reveal .vc-graph-card` scale rule moved to the wrapper the two CSS tests fail. Restored afterwards. No global `getBoundingClientRect` stub.

## 5. Gates (run on the clean tree, after cleanup)

- `npm run build` (tsc -b && vite build): exit 0, no type errors (only the existing >500 kB chunk notice).
- `npm run lint` (eslint .): exit 0, no output.
- `npm test` run twice: both exit 0, 50 files / 627 tests passed (baseline 49 / 623 + the new file with 4 tests), including useProvenance and the Recharts dashboard test.

## 6. State left behind

Deleted: root `edge-harness.html`, `src/test/edge-harness.tsx`, `vite.edge-harness.config.ts`, `edge-driver.mjs`, `smooth-driver.mjs`, `.edge-harness-dist/`; `npm ci --ignore-scripts` removed `puppeteer-core` (0 puppeteer entries in node_modules); the bisect worktree was already gone (`git worktree list` shows only main and edge-ends). `git status` shows only `M src/graph/AccessGraph.css`, `M src/graph/AccessNode.tsx`, `?? src/graph/AccessNode.handles.test.tsx`; `package.json` / `package-lock.json` unchanged. A `vite` process belonging to the main repo's node_modules (pid 48664) was already running and is not mine. The smoothness driver is saved as `harness/smooth-driver.mjs.txt`.
