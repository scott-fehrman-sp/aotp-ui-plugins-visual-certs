# Verification

## Change 1 (hover/focus)

Branch `feature/graph-hover-and-readable-zoom`, commit `4e6fe8e` (`feat(graph): raise hovered or focused item's status edge above cards and dim the rest`). Real Chrome (headless, `/Applications/Google Chrome.app`), `puppeteer-core@23` (`--no-save`), Vite JS API on https://localhost:5199. Harness copies: `harness/` in this directory (graph-harness.html, graph-harness.tsx, harness-driver.mjs). Nothing from the harness is committed; worktree `git status` is clean and package.json / package-lock.json are untouched.

### Matrix

fixture (standard Alice Adams: 5 first-level cards; dense Amos Cunningham: 25) x viewport (1700x1000, 1000x700) x reference (shown, hidden) x layout (LR, TB) x minimap (on, off) = 32 scenarios. Driver summary: `h1-summary-full.json`.

Hover-tested cards: 440 (every first-level card that is on-canvas and hit-testable). 40 dense cards could not be hover-tested because at the 0.15 minZoom they sit outside the canvas or under an overlay (the long-list case FEAT-002 addresses; e.g. dense shown LR 1700 map-on has 3, 1000x700 map-on has 7). Those 40 were still covered by the `focus()` and Tab assertions (all 480 first-level cards).

### Per-assertion results (pass / fail), full 32-scenario run

| Assertion | pass | fail |
|---|---|---|
| H1-a exactly one `.vc-graph-edge-emphasized`, it is the card's incoming edge | 440 | 0 |
| H1-a emphasized edge thicker (2 -> 3.5) | 440 | 0 |
| H1-a edge layer z-index above card z-index (edge svg 10 vs node 2) | 440 | 0 |
| H1-b every other edge dimmed (status 0.25, reference 0.12) | 440 | 0 |
| H1-b stroke colors / dashes unchanged | 440 | 0 |
| H1-c raised edge painted over crossed cards (pixel) | 50 | 1 (see below) |
| H1-c before hover the edge was not painted over those cards | 51 | 0 |
| H1-d no flicker for 500 ms at center / left border / top border | 440 x 3 | 0 |
| H1-d elementFromPoint stays inside the card at center / left / top | 440 x 3 | 0 |
| H1-e node + viewport transforms byte-identical during hover | 440 | 0 |
| H1-e transforms identical after leave; viewport zoom unchanged | 440 / 32 | 0 |
| H1-f edge classes/styles string-identical after leave | 440 | 0 |
| H1-g `focus()` emphasizes the card's edge, tooltip opens, blur restores | 480 x 3 | 0 |
| H1-g reference-only node hover changes no edge | 160 | 0 |
| H1-g real Tab traversal: first-level cards emphasize their edge + tooltip | 504 x 2 | 0 |
| H1-g real Tab on user / reference cards emphasizes nothing | 200 | 0 |
| H1-g real Tab reaches every first-level card | 32 | 0 |

Total 9,606 checks, 1 failure. 51 cards cross another card (860 crossing sample points over the matrix); the edge is painted over the crossed card at 100% of samples whenever the stroke is at least 1 screen px.

### The one failure, and why it is not a product defect

`dense/1700x1000/shown/LR/map-off`, Entitlement 03 (reassigned, dotted blue): 11 of 13 sample points matched (85%, threshold 90% for sub-pixel strokes). The viewport is at the 0.15 minZoom, so the 3.5 px stroke is 0.5 px on screen (dotted dashes 0.3 px), which is below what a pixel color check can resolve. The same card passes in `map-on` and reproduces only at this zoom. Supplemental runs with the viewport zoomed in (ctrl+wheel) show no failures:
- dense shown LR 1700 map-on, zoom 0.79: 10 cards, 8 with crossings, 220 points, min match 1.00 (`h1-summary-zoomin1.json`)
- dense shown LR 1700 map-off, zoom 0.88: 11 cards, 9 crossings, 227 points, min match 1.00 (`h1-summary-zoomin1-nomap.json`)
- dense shown LR / TB 1700 map-on, zoom 1.8: 0 failures (`h1-summary-zoomin.json`, `zoomin4`)

Reported as a measurement limit of a sub-pixel stroke, not hidden. Resolving dense graphs to a readable zoom is FEAT-002.

### D8 paint-check result (decides the fallback)

The raised edge IS painted over crossed cards in real Chrome. DOM facts: each zIndex group is its own `<svg style="z-index: N">` sibling of the node layer inside `.react-flow__viewport`; status edges are z 1, reference 0, cards (`.react-flow__node`) 2, the raised edge svg 10. Before hover, matched pixels over crossed cards: 0% (max across all scenarios 0); on hover: 100% (>=95% required). Therefore the D8 ViewportPortal fallback is NOT needed and was not implemented.

### How the check works (so FEAT-002 can reuse it)

Edge path sampled at dash "on" centers with `getPointAtLength`, mapped through `getScreenCTM`; points kept only where inside a different card, inside the canvas, not under a panel / minimap / controls, and not under the (portal) tooltip. A baseline screenshot (pointer parked) and a hover screenshot are decoded in the page (`createImageBitmap`; `data:` fetch is blocked by the dev server CSP so the PNG is decoded via `atob` + Blob). A sample counts when the best pixel in its 3x3 neighborhood is within 45 rgb units of the status color, or at least 8 rgb units closer than the baseline pixel.

### Screenshots (all opened with read_file and inspected)

- `h1-standard-shown-before-1700.png`: baseline, no hover, all edges at rest.
- `h1-standard-shown-hover-1700.png`: hovering Read; its green edge is thick, drawn over the Role A and Billing cards, all other edges faded, tooltip open.
- `h1-keyboard-focus-1700.png`: same card via keyboard focus; same emphasis plus tooltip.
- `h1-standard-hidden-hover-1700.png`: reference hidden, single lane; Read edge thick, others faded, no crossings.
- `h1-standard-shown-tb-hover-1700.png`: TB layout; Login edge raised over the Role A card, others faded.
- `h1-standard-shown-hover-1000x700.png`: 1000x700 viewport (zoom 0.4); same behavior.
- `h1-dense-shown-hover-1700.png`, `h1-dense-shown-tb-hover-1700.png`, `h1-dense-hidden-hover-1700.png` (+ 1000x700 variants): dense graph at minZoom 0.15, the emphasis works but the cards are illegible (FEAT-002 scope).
- `h1zoomin-dense-shown-hover-1700.png`: dense graph zoomed to 0.79; Entitlement 03 edge (blue dotted) clearly raised over Profile 2 / Finance Role cards, others faded.
- `h1-*-before-*.png`: baselines for each shown-mode hover.

Observation to keep in mind: the raised edge strikes through the label of a card it crosses (e.g. "Billing", "Role A"). That is the intended trade (the user asked for the path to be traceable over cards); it only happens while a card is hovered or focused.

### Gates

- `npx vitest run src/graph`: 148 tests pass (emphasizeEdges.test.ts 10, AccessGraphCanvas.emphasis.test.tsx 10, buildAccessScene.test.ts 45 incl. golden positions unchanged).
- `npm run build`: exit 0.
- `npm run lint`: clean (run after the harness was deleted).
- `npm test`: 40 files / 359 tests pass (useProvenance flake did not occur).
- `git status --short`: empty. `package.json`, `package-lock.json` untouched. `git diff --stat main...HEAD`: AccessGraph.css, AccessGraphCanvas.tsx, AccessNode.tsx, EmphasisContext.ts, buildAccessScene.ts, emphasizeEdges.ts, and the two new test files.

## Change 2 (readable zoom for long lists + scroll hint)
Commits on `feature/graph-hover-and-readable-zoom`: `7099ebf` (feat) plus a follow-up commit that tunes `scrollAxisPenalty` to 2 (see Tuning). Real Chrome via `puppeteer-core@23` (`--no-save`), Vite JS API on https://localhost:5199. Harness copies are in `harness/` (driver now has `--mode=z1|z2|z|z2base`). The harness is deleted from the worktree, `npm ci --ignore-scripts` removed puppeteer.

### What was built
- `fitPadding.ts`: `READABLE_MIN_ZOOM = 0.65`, `SCROLL_MODE_FIT_ZOOM = 0.3`, `scrollAxis` / `scrollAxisPenalty` options, pure `planFit`, `readableViewport`, `isGraphOutOfView`; `measureOverlays` skips `.vc-graph-fit-ignore`. Revised invariant documented in the file and on `FitOnSceneChange`.
- `AccessGraphCanvas.tsx`: `FitOnSceneChange` plans in drill-down; mode fit keeps today's `fitView({padding})`, mode readable calls `setViewport(viewport, {duration: 0})`. Refit triggers unchanged (`fitKey`, canvas width/height). `minZoom` 0.15 and `Controls` unchanged. An unmeasured (0x0) canvas always takes the normal fit.
- `ScrollHint.tsx` (role=status pill, top-center, `pointer-events: none`, `vc-graph-fit-ignore`): shown only in drill-down, not for a degenerate user, only when the last plan for the current fitKey was the readable path AND part of the graph is out of view. **Hint included** (not dropped).
- Tests: fitPadding (+21), `AccessGraphCanvas.zoom.test.tsx` (7), fit test mock gained a `setViewport` spy only. No `Element.prototype` / `HTMLElement.prototype` stubs.

### Assumptions (stated in the plan, confirmed in the browser)
- D3: the user sits at the lane midpoint, so the literal "top of the lane" would put the user off-screen. Rank axis is start-aligned, a long cross axis is centered on the user (screenshots show the user with ~4 items above and below). Layout unchanged.
- D4: two constants. 0.65 is the zoom used (card label 15 px * 0.65 = 9.75 px effective; measured `fontPx * zoom >= 9.5` in all 16 dense scenarios); 0.3 is the trigger. The standard graph's lowest fit zoom is 0.315 (shown, TB, 1000x700, map on), so it stays on the old path. That margin is thin; a smaller viewport would flip it to the readable path.
- D5: overlays are assigned away from the scroll axis with `scrollAxisPenalty`.

### Tuning (from screenshots and numbers)
- READABLE_MIN_ZOOM 0.65 and SCROLL_MODE_FIT_ZOOM 0.3 kept: text is legible in `z1-dense-hidden-open-1700.png`, and the cut-off at 0.3 separates standard (0.315..1.2) from dense (0.15..0.25).
- `scrollAxisPenalty`: 3 (plan default) vs 2 vs 1.5 on the 1000x700 shown scenarios. With 3, the last item needed 2-D panning in LR and TB and TB had 4 cut nodes; with 2 only LR shown 1000x700 needs 2-D panning (all others reach first/last with the wheel along the scroll axis), so the default is 2. 1.5 gave the same result as 2.

### Z1 (dense, 25 first-level items) 16 scenarios, run `z-summary-final.json`
| Assertion | pass | fail |
|---|---|---|
| zoom == 0.65 +/- 0.005 | 16 | 0 |
| effective label font >= 9.5 px | 16 | 0 |
| user + 3 nearest items fully inside canvas | 64 | 0 |
| user + 3 nearest items clear of every overlay | 63 | 1 |
| hint: role=status, text "25 items — scroll or drag to see all" | 16 | 0 |
| hint overlaps no toolbar/Back/legend/minimap/Controls; inside canvas | 16 + 16 | 0 |
| wheel reaches LAST item fully inside, clear of overlays | 16 | 0 |
| wheel reaches FIRST item likewise | 16 | 0 |
| scrolling keeps zoom; drag pans; ctrl-wheel bottoms at 0.15 | 16 x 3 | 0 |
| Controls fit-view: zoom >= 0.15; hint hidden iff everything in view | 16 + 16 | 0 |
| resize round trip refits to 0.65, user stays clear (1 scenario) | 2 | 0 |

The one failure, reported not hidden: `dense/1000x700/shown/LR/map-on`, the 3rd-nearest item (Profile 2) is partly under the minimap. At that size the legend (265 px) and minimap/toolbar (229 px) strips leave ~474 px of a 968 px canvas for a 5-column shown graph. Lowering the zoom does not fix it (checked arithmetically) and the other three required cards are clear. In that scenario the wheel alone reaches the last item only after also panning horizontally (2-D); everywhere else the vertical wheel (horizontal in TB) is enough.

Exempt (scroll-state) node counts per scenario, from `z-final.log` (total / fully visible and clear / outside canvas / cut by canvas / under an overlay):
- 1700x1000 shown LR: 40 / 18 / 21 / 1 / 0 (same with map off); shown TB: 40 / 18 / 18 / 2 / 2.
- 1700x1000 hidden LR: 26 / 9 / 16 / 1 / 0; hidden TB: 26 / 10 / 14 / 2 / 0.
- 1000x700 shown LR map-on: 40 / 5 / 26 / 7 / 2; map-off: 40 / 7 / 26 / 7 / 0; shown TB map-on: 40 / 7 / 27 / 0 / 6; map-off 40 / 10 / 27 / 0 / 3.
- 1000x700 hidden LR: 26 / 7 / 18 / 1 / 0; hidden TB: 26 / 6 / 18 / 2 / 0.

Fit-view (Controls button) results: shows every node (hint disappears) in 12 of 16 scenarios (zoom 0.16-0.25). In the four 1000x700 shown scenarios the graph does not fit even at the 0.15 minZoom (2 cut in LR, 4 cut in TB) so the hint correctly stays; that is unchanged fit-view behavior, not a regression.

Observation: a card scrolled behind the top-center hint pill is partly covered while the hint shows (visible in `z1-dense-hidden-open-1700.png`, Entitlement 04). That is the allowed scroll state; the pill never intercepts the pointer.

### Z2 (standard graph, 16 scenarios)
| Assertion | pass | fail |
|---|---|---|
| old strict invariant: no node under an overlay (>0.5 px) | 16 | 0 |
| old strict invariant: every node inside canvas (1 px) | 16 | 0 |
| no hint, no role=status | 16 | 0 |
| zoom equals the pre-change zoom recorded from commit 4e6fe8e (+/-0.01) | 16 | 0 |
| zoom equals the documented table (0.785/0.492 hidden, 0.644/0.404 shown) | 4 | 0 |
| hidden: one lane; shown: per-kind lanes | 8 + 8 | 0 |

The pre-change zooms were measured by temporarily checking out `src/graph` from 4e6fe8e (`z2-baseline-zooms.json`), then restoring HEAD.

### H1 regression on the final code (32 scenarios, `h1-summary-final-regress.json`)
6,118 checks, 0 failures: 204 cards hover-tested (dense cards are mostly off-canvas at readable zoom, so far fewer hover-reachable cards than the 440 in Change 1), 77 crossing cards pass the pixel check (raised edge painted over cards; 0% before hover), 480 focus() / 504 Tab checks pass, flicker and elementFromPoint checks pass. The earlier sub-pixel failure at zoom 0.15 is gone because dense graphs no longer open at 0.15.

### Screenshots (all opened with read_file)
`z1-dense-hidden-open-1700.png` (user mid-canvas, Entitlements 05-12 legible, hint top-center), `z1-dense-hidden-scrolled-end-1700.png` (end of list, Entitlement 20 fully visible), `z1-dense-hidden-open-1000x700.png`, `z1-dense-shown-open-1700.png` (user, Finance Role, profiles, entitlements, sources), `z1-dense-shown-open-1000x700.png` (shows the minimap/legend crowding above), `z1-dense-hidden-tb-1700.png` (user on top, items along a row, cut at both sides), `z1-dense-fitview-1700.png` (whole graph, hint gone), `z2-standard-shown-1700.png`, `z2-standard-hidden-1000x700.png` (unchanged, no hint), plus extra `z1-dense-shown-open-nomap-1700.png`, `z1-dense-shown-tb-open-1700.png`, `z1-dense-hidden-tb-open-1000x700.png`.

### Notes
- Window resize resets any manual pan/zoom (refit on canvas size change is unchanged). With a readable zoom the reviewer has more scrolled state to lose, so this is more noticeable.
- Fit-view uses React Flow's default padding 0.1 (D7 unchanged).

### Gates (final)
- `npx vitest run src/graph`: 12 files pass. `npm test`: 41 files / 389 tests pass. `npm run build`: exit 0. `npm run lint`: clean (after harness deletion and `npm ci --ignore-scripts`).
- `git status --short`: empty; `package.json` / `package-lock.json` untouched.
