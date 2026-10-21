# Verification: access-graph layout fixes (A, B, C)

Worktree: `.worktrees/layout-fixes`, branch `feature/graph-layout-fixes`.

## What was run

Real Chrome (`/Applications/Google Chrome.app`, headless, puppeteer-core@23 installed with `--no-save`) against a temporary harness page that renders `AccessGraphCanvas` with the app's real stylesheets in `main.tsx` order (`@xyflow/react/dist/style.css`, `graph/tokens.css`, `index.css`). The dev server was started from the driver through Vite's JS API (`createServer`, port 5199, strict, the project `vite.config.ts` so HTTPS/basicSsl is identical to `npm run dev -- --port 5199 --strictPort`; the shell wrapper refuses to background `npm run dev`).

Fixtures: `standard` (Alice Adams: Role A reassigned, Billing needsReview, Admin revoked, Read/Login approved, nested Foo/Delete/Write/Pay, sources Directory/ERP; plus Bob), `dense` (user "Amos Cunningham": 4 first-level access profiles with nested entitlements, 1 first-level role containing an AP + direct entitlement, 20 directly-held entitlements mixing all four statuses, nested-only nodes, 3 sources; 25 first-level items, 44 nodes shown), `grid30` (30 users), `lonely` (user with no lineage, shows the note).

Viewports 1700x1000 and 1000x700. Per fixture and viewport: grid with minimap on/off; drill-down shown LR, shown TB, shown TB without minimap, back to LR; reference hidden LR, hidden LR without minimap, hidden TB, hidden TB without minimap, back to LR; reference shown again; window resize round trip (shown and hidden, no clicks in between); Back to all users then drill into Bob (standard). 76 scenario snapshots per run. After every settled fit (viewport transform unchanged for 8 frames):

1. no `.react-flow__node` rect intersects any `.react-flow__panel` overlay (legend, minimap when present, Controls, right toolbar, Back panel, note, attribution) by more than 0.5 px;
2. every node rect is inside the canvas rect (1 px tolerance);
3. REFERENCE HIDDEN: 121 samples along every first-level status edge path (`getPointAtLength` mapped through `getScreenCTM`) must not fall inside any node other than the edge's two endpoints (rects shrunk 2 px);
4. REFERENCE HIDDEN: all first-level nodes share one column (LR) / row (TB), lane after the user, cards do not overlap, user centered on the lane span (1 px), lane order = kind (role, accessProfile, entitlement) then label then id;
5. REFERENCE SHOWN: each kind sits in its own lane, lanes ordered user < role < accessProfile < entitlement < source;
6. legend rows: four statuses always; "Reference only (not reviewed)" only when reference is shown.

Clamp rule: when the fit is pinned at the existing `minZoom` 0.15, assertions 1 and 2 cannot be satisfied by any padding; they are REPORTED (not failed) in that case. Everything else is still enforced.

## Before (unmodified commit 947f501) vs after

| Metric | Before | After |
|---|---|---|
| Scenario snapshots with at least one failure | 40 of 76 | 0 of 76 |
| (1) node under an overlay | 70 hits (33 minimap, 28 legend, 8 toolbar, 1 attribution) | 0 |
| (2) node outside canvas | 39 | 0 (136 reported, all in `dense` at the 0.15 clamp, see below) |
| (3) hidden-mode status edge behind a non-endpoint card | 280 hits (standard 1700x1000 hidden LR: 5 of 5 edges; Billing, Login, Admin, Read behind Role A, Admin also behind Billing) | 0 |
| (4) hidden-mode lane violations | 172 | 0 |
| Standard fixture zoom, hidden LR | 1.331 (1700x1000), 0.783 (1000x700) | 0.785 (1700x1000), 0.492 (1000x700) |
| Standard fixture zoom, shown LR | 0.929 (1700x1000), 0.614 (1000x700) | 0.644 (1700x1000), 0.404 (1000x700) |

The before run reproduces all three defects: Billing/Login/Admin/Read edges behind Role A (A), "Login intersects minimap" at 1700x1000 hidden (B), "Alice Adams and Role A intersect legend" at 1000x700 (C), plus the missed refit on minimap toggle and on window resize.

Cost of the fix: the graph is drawn smaller, because the overlays now take space (the strip model gives each overlay to its thinnest canvas side). At 1000x700 the standard fixture is at 0.49 (hidden) / 0.40 (shown) zoom, well above the 0.15 minimum. `.vc-graph-wrap` height (`min(70vh, 640px)`) was NOT changed: padding alone removes every overlap for the standard, grid and lonely fixtures.

### Dense fixture and the minZoom clamp (reported, not a regression)

Hidden mode, dense (25 first-level items, lane about 2,800 px tall): 0 pass-behind edges and all lane checks pass in every scenario. Overlay/containment is fully satisfied where the fit can reach it: 1700x1000 hidden LR without minimap 0.200, hidden TB 0.238. It is pinned at `minZoom` 0.15 for hidden LR with the minimap (1700x1000) and for all dense scenarios at 1000x700, so some cards fall outside the canvas / under the legend there (136 reported items). That is a consequence of the existing `minZoom` {0.15} and the 640 px canvas height, not of the padding. If the user wants it solved, options are: a taller canvas, lower `minZoom`, or collapsing long lanes into multiple columns. Not changed.

## DEFECT A measurement: SHOWN mode, first-level status edges passing behind a non-endpoint card

Same sampler, reference shown, 1700x1000 (unchanged lane layout, cards above edges by design):

| Fixture | Layout | Status edges | Hits | Distinct edges passing behind a card |
|---|---|---|---|---|
| standard | LR | 5 | 5 | 4: Billing, Login, Admin, Read behind Role A; Read also behind Billing |
| standard | TB | 5 | 5 | 4 (same) |
| dense | LR (fit pinned at 0.15) | 25 | 6 | 4: Profile 2 and Entitlement 03 behind Finance Role; Entitlement 06 behind Finance Role and Profile 3; Entitlement 09 behind Finance Role and Profile 4 |
| dense | TB | 25 | 6 | 4 (same) |

Count is NON-ZERO. Screenshots: `after-dense-shown-1700.png`, `after-shown-1700.png`, `after-shown-1000x700.png`. Cause: in shown mode the user's direct edges to items in later lanes run straight through the role/AP lanes. Cards sit above edges (`zIndex` 2 vs 1) so an edge disappears behind the card and reappears, and its color can read as part of another edge. Nothing implemented, because the only safe fixes change what the reviewer sees. Proposed mitigations, in order of size:

(a) on hover/focus of an item, draw its incoming status edge above cards and dim the others (smallest; needs hover state in the canvas and an edge `zIndex` update);
(b) route directly-held items' status edges around the intermediate lanes (needs custom edges);
(c) a "focus item" mode that fades unrelated cards.

Recommendation: leave it for the user to choose. The hidden-reference mode, which is the one reviewers use to act on items, now has none.

## Screenshots (all in this folder, all opened and checked)

Taken with the fixed code (`after-*`); the same scenarios on the unfixed code are `before-*`.

- `after-hidden-1700.png`: standard, hidden LR, 1700x1000. User card with Role A, Billing, Admin, Login, Read in one column, ordered role, access profile, entitlements by label. Every status edge visible end to end: blue dotted Role A, amber dashed Billing, red Admin, green Login/Read. Minimap bottom-right clear of all cards, legend and controls clear.
- `after-hidden-1000x700.png`: same at 1000x700. Legend no longer covers the user or Role A; graph smaller, all overlays clear.
- `after-hidden-tb-1700.png`: hidden TB. One row of five cards under the user, user centered, edges distinct and colored per status, nothing under the minimap or legend.
- `after-shown-1700.png`, `after-shown-1000x700.png`: shown mode, lane layout unchanged; legend with the "Reference only" row, cards clear of legend and minimap.
- `after-hidden-nomap-1000x700.png`: minimap hidden, graph refit to use the freed bottom-right space.
- `after-dense-hidden-1700.png`, `after-dense-hidden-1000x700.png`: 25-item lane, shows the minZoom clamp described above.
- `after-dense-shown-1700.png`, `after-dense-shown-tb-1700.png`: dense shown mode (measurement above); pinned at 0.15 / 0.162.
- `after-grid-1700x1000.png`, `after-grid-1000x700.png`, `after-grid30-1700x1000.png`, `after-grid30-1000x700.png`: overview grid; user cards clear of the right control panel, zoom controls and minimap (the unfixed 1700x1000 grid30 had "User 30 Name" under the minimap).

## Gates (in the worktree, after the harness, driver and puppeteer were removed with `npm ci --ignore-scripts`)

- `npm run build`: exit 0, no type errors.
- `npm run lint`: clean.
- `npm test`: 38 files, 339 tests, all pass (useProvenance flake did not occur).
- New pure/RTL tests: single-lane builder tests (both rankdirs: one lane, ordering, no overlap, centering, edges and node data identical to lanes mode, determinism, no mutation, empty graph), golden shown-mode positions captured before the builder change, `fitPadding.test.ts` (padding math, `measureOverlays` with per-instance rect stubs), `AccessGraphCanvas.fit.test.tsx` (px padding on fit, refit on minimap/reference/layout/Back, overlay-driven padding, one column/row in hidden mode). No global `getBoundingClientRect` stub was added.
- `git status`: only `src/graph/AccessGraphCanvas.tsx`, `buildAccessScene.ts`, `buildAccessScene.test.ts`, `fitPadding.ts`, `fitPadding.test.ts`, `AccessGraphCanvas.fit.test.tsx`; `package.json` / `package-lock.json` untouched.
