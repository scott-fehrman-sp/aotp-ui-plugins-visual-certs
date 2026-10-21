# Single-lane layout for hidden reference and overlay-aware graph fit

When reference nodes are hidden, `buildAccessScene` now puts the user's first-level items in one lane after the user, so status edges stop running behind other cards (defect A). The viewport fit measures every `.react-flow__panel` overlay and converts it into per-side pixel padding, so cards no longer sit under the minimap, legend or control panel (defects B and C). Both changes are confined to `src/graph/`. The review judged the diff against the coder's real-Chrome evidence in `verification.md` and did not re-run the gates or the harness.

Watch for: (1) a very long single lane (25 items, the dense fixture) is pinned at the existing `minZoom` 0.15 and is unreadable, and overlay clearance is not guaranteed there (confirmed, reported by the coder, inherent to the requested single lane plus the existing minZoom). (2) In shown mode, status edges still pass behind non-endpoint cards (confirmed, measured, deliberately left for the user). (3) The overlay-aware fit costs zoom at small viewports (confirmed, accepted tradeoff).

**Verdict**: APPROVED

## High-level view

The builder gains an `AccessSceneOptions.singleLane` flag, passed by the canvas as `!showReference`. Lanes mode is moved into a helper with unchanged arithmetic and guarded by golden position tests, so shown mode keeps its kind-per-lane layout. Single-lane mode skips dagre, orders role < accessProfile < entitlement, then case-insensitive label, then id, and centers the user on the lane. Edges, node data, tooltips and z-indexes go through the same mapping code as lanes mode.

The fit uses a strip model. Each overlay is assigned to its thinnest canvas side and that side's padding grows to cover it plus a gap. Padding is passed to `fitView` as px strings. Refits now also trigger on minimap toggle and canvas resize. The `.vc-graph-wrap` height is untouched, with the zoom measurements in `verification.md` as the justification.

The browser evidence goes from 40 of 76 failing snapshots before to 0 after. The 280 hidden-mode pass-behind hits, 70 overlay hits and 172 lane violations all drop to 0. The zoom cost is real: the standard fixture at 1000x700 goes from 0.78 to 0.49 (hidden) and from 0.61 to 0.40 (shown).

<details>
<summary>Issues (3)</summary>

1. **Dense lane unreadable at minZoom (likely non-blocking, confirmed behavior)** — a 25-item single lane is pinned at 0.15, cards are unreadable and overlay or containment checks are only reported there. Follow up with the user: a taller canvas, a lower minZoom, or wrapping long lanes into multiple columns. Not part of this change.
2. **Shown-mode edges behind cards (confirmed, measured, out of scope)** — standard fixture has 4 of 5 status edges passing behind non-endpoint cards, dense has 4 of 25. Needs the user's choice among the coder's mitigations (hover-raise, custom routing, focus mode).
3. **Resize refit discards manual pan and zoom (possible)** — the width/height-triggered refit resets any user viewport adjustment on every window resize. Acceptable now, so confirm it is the wanted behavior.

</details>

<details>
<summary>Details</summary>

## One lane after the user when reference is hidden

`singleLanePlacements` puts the user in band 0 and every other node in band 1 at `MARGIN + bandStep`, which is the role column coordinate in lanes mode. Cross positions use the same stride and midpoint-centering formula as lanes mode. The sort runs on a `filter` copy, so the input graph is not mutated, and the id tiebreak uses plain comparison for locale-independent determinism. The user ends up centered on the lane because all cards share one extent. The screenshots (`after-hidden-1700.png`, `after-hidden-1000x700.png`) show Role A, Billing, Admin, Login and Read in order, with every status-colored edge visible end to end and no card crossing another card's edge.

The builder remains pure. Coverage includes both rankdirs: single rank coordinate, ordering, stride, centering for odd, even and single-item lanes, edge and node data equal to lanes mode, shuffled-input determinism, no-mutation and the empty graph. The golden shown-mode test covers three inputs in LR and TB, plus equality of omitted, `{}` and `singleLane:false` options. No test stubs `Element.prototype`; the fit tests use per-instance rect assignment.

## Overlay-aware fit and its cost

`computeFitPadding` assigns each overlay to the thinnest side with a fixed tiebreak, takes the max (not the sum) per side, then caps each axis at 75%. The cap is the one place where the "no overlap" guarantee is explicitly given up. Rects are measured one frame after the change so the panels are laid out. The refit key includes the minimap state, and canvas width and height from the store trigger window-resize refits. The browser run covers both viewports, both references, minimap on and off, both layouts, grid, the lonely note and the resize round trip, with 0 violations on standard, grid30 and lonely.

The cost is that the graph is drawn noticeably smaller, because a bottom-left legend or bottom-right minimap is charged as a full-width strip. The coder measured and reported this, and left the wrap height alone because no overlap remains for the non-dense fixtures. That reasoning holds.

## Dense lane is pinned at minZoom

The dense hidden screenshot shows 25 cards in a column at 0.15, readable only as structure. Edges still do not cross cards (0 pass-behind hits). The residual overlap or containment (136 reported items) occurs only where the fit is clamped to the existing `minZoom={0.15}` and cannot be fixed by padding. This is a direct consequence of the single lane the user asked for with a 25-item user, and the coder documented options. It is not a regression of this change and not a reason to block, but it is likely the next thing the user will notice.

## Shown-mode edges behind cards

Shown-mode positions are unchanged byte for byte (golden tests). The verification measured the dense count (4 of 25 distinct edges pass behind a card) and the standard count (4 of 5), and proposed mitigations in size order without implementing any. This respects the unrequested-layout-change boundary.

## Keep-intact check

`package.json`, `package-lock.json`, `src/domain`, `src/views` and `AccessGraph.css` are untouched. `git status` is clean and no harness, driver or puppeteer files are tracked. The commit touches exactly six files under `src/graph/`. The control panel, legend rows and tooltips are not touched in the diff.

</details>

<details>
<summary>File map</summary>

- `src/graph/buildAccessScene.ts`: `singleLane` option, lanes and single-lane placement helpers, shared node and edge mapping.
- `src/graph/AccessGraphCanvas.tsx`: passes `singleLane: !showReference`, overlay-aware `FitOnSceneChange`, minimap and resize refit.
- `src/graph/fitPadding.ts`: new pure padding math plus the `measureOverlays` DOM read.
- `src/graph/buildAccessScene.test.ts`: golden shown-mode and single-lane tests.
- `src/graph/fitPadding.test.ts`: padding math and `measureOverlays` tests.
- `src/graph/AccessGraphCanvas.fit.test.tsx`: refit wiring tests.

Full diff: `git diff main...feature/graph-layout-fixes` in the `.worktrees/layout-fixes` worktree.

</details>
