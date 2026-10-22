# Smooth transitions for the access graph canvas

Ports org-graph's phased scene transition (entering at origin, two rAFs to final positions, timeout drops exiting, generation guard) into the access graph. The pure planning lives in `graphTransition.ts`, scheduling in `useGraphTransition.ts`, the motion duration in `useMotionMs.ts`, and `AccessGraphCanvas.tsx` feeds the hook the structural scene and animates the camera from the target bounds. The two required differences are present: transition classes are appended (existing `vc-graph-edge-*` classes survive), and `MAX_ANIMATED_NODES = 400` applies instantly on large graphs. The recorded evidence (437/437 browser assertions on the production build, screenshots, clean worktree) supports the claims.

Watch for: (1) entering edges are restyled by `highlightEdges`, which departs from the brief but is documented and verified (confirmed, non-blocking); (2) some edge/card detachment remains during large layout moves even with the fade refinement, up to about 240 px for about 9 frames (confirmed from the report, non-blocking); (3) the camera fit now also re-fires when `placed` flips, so a data refresh that moves cards refits only when motion is on (possible, non-blocking).

**Verdict**: APPROVED

## High-level view

The transition engine is a faithful port. A pure `planTransition` produces start, settle and final frames. The hook releases the later phases only after the start frame is committed, which fixes a real defect: a slow render could otherwise skip phase 1 and make cards pop in. Classes are appended, large graphs bypass animation, and with motion 0 (reduced motion, jsdom) the hook returns the target untouched, so all 537 existing tests ran unchanged.

The hook is fed the structural scene. Hover and selection restyle `frame.edges` afterwards, and every reader of the scene (selection validity, lineage, counts, announcements) still reads the target scene. The camera fit is computed from target nodes and gated on `placed`. Its first fit has duration 0, later fits use `motionMs`, and the final viewport equals the old fit in all 13 scenarios at both sizes.

CSS follows org-graph's `vc-graph-` naming and adds the `--motion-fast-ms` token, `entering`/`exiting` opacity 0 with card scale .94, pointer-events none on exiting nodes and edges, a reveal cascade and reduced-motion overrides. It also adds three keyframe fixes found in the browser: exiting fade, edge arriving and edge settling.

The end state is untouched. The diff touches 9 files, all under `src/graph`. No builder, filter, review pipeline, control panel, page layout, `accessCounts.ts`, `CampaignDashboard*` or package file changed. The worktree is clean, no puppeteer remains in `node_modules`, and `dist/` is gitignored.

<details>
<summary>Issues (4)</summary>

1. **Entering edges restyled (accepted deviation)** — the brief said no inline opacity on entering or exiting edges; only exiting edges are excluded. Confirmed safe: React Flow spreads `style` onto the inner `<path>` and `className` onto the outer `<g>`, so the opacities multiply. T7 shows 29 entering edges fading monotonically. No action beyond keeping the note in the PR description.
2. **Residual edge detachment during layout flips** — with the fade refinement, edges with opacity above 0.5 still sit up to 242 px from their handle for up to 9 frames (layout LR<->TB); 89 px in hide-completed. Without the refinement it was 1838 px for 25 frames. Acceptable; optionally push the arrive delay later for moves longer than about 200 px.
3. **Fit re-fires on `placed` flips without a `fitKey` change** — `FitOnSceneChange` depends on `placed`. A graph-prop refresh that moves cards with motion on now refits, whereas baseline and motion 0 do not. Possible, not observed; check by refreshing data with a new item while zoomed in.
4. **Two dev-server timing misses** — `drill-dense` camera start and end run 245-250 ms and 678-683 ms against limits of 250 and 670 ms. Production passes, with the start at 74-123 ms. Dev-mode overhead; no action.

</details>

<details>
<summary>Details</summary>

## Hook scheduling and interrupts

`useGraphTransition` keeps a `displayed` ref, so an interrupted update plans from the frame actually on screen, including leftover exiting and entering cards. A superseded update's rAFs and timeout are cancelled in the effect cleanup, and the generation guard covers a callback that already fired. The coder's T6 results (five toggles in 200 ms, click then Back, click then Escape, resize mid-transition, each repeated under StrictMode) show clean final states with unique ids, no leftover flags and a viewport equal to a single clean trigger.

## Entering-edge restyle

`highlightFrameEdges` removes only `exiting` edges from `highlightEdges` and re-appends them untouched. This also keeps exiting edges out of the lineage walk. Entering edges keep their `entering` or `vc-graph-edge-arriving` class and get the selection or dim style on the inner path, which multiplies with the wrapper's opacity. Skipping them would make them pop to the dimmed style when the transition ends, so the chosen behavior is better than the brief's. The plan recorded the same deviation up front and T7 checked it.

## Edge fade by keyframes

Entering and settling edges use `animation ... backwards` with a delay of 40% of the motion duration, not the `entering` transition. React Flow mounts an edge only after both cards are measured, which can happen after the class was cleared. A staying edge also can't use the transition, because of the reversing shortening factor. The animation ends 60 ms before the class is removed, so removal never cuts the fade short. Edges are invisible during the first 180 ms, which hides most of the detachment. After that they are at opacity above 0.5 while cards are still travelling in the large layout flips. The reported 242 px and 9 frames match what the "motion-4" frames show: cards are mid-glide and edges appear at the 300 ms frame already attached. This is a polish gap, not a defect.

## Camera

The fit takes target nodes through a ref that is not a dependency, so a scene change adds no trigger of its own. `placed` (every target card in the frame at its target position, none `entering`) turns the fit into one call per transition: the cards' first render flips `placed` false, the settle frame flips it true. `hasFitted` makes only the first fit instant.

`placed` also re-triggers the effect whenever positions change without a `fitKey` change. With motion on, a data refresh that moves cards refits after the glide; baseline would not refit, and motion 0 would not either. The result is usually desirable (the new content gets framed) and was not seen in testing. It should be mentioned in the PR so the user can decide.

## Tests

Three new files hold 86 tests: pure planning 54, hook 16, canvas integration 16. No existing test file changed, and the fit-count tests still pass because motion is 0 there. The tests cover drill-in and drill-out with element identity, keyboard focus, hide completed, hover and selection not starting a transition, rapid toggling, size guard and reduced motion. Not covered in jsdom: any real CSS, so the visual claims rest on the browser run. I did not re-run build, lint or tests, as instructed.

## Evidence check

Screenshots were opened, and they match the described behavior:

- **Grid to drill-down (mixed):** other users fade, the user card glides, lineage emerges from the user card at opacity 0 and fans out, edges attach as they fade in, the camera zooms smoothly, and the final frame is the normal layout.
- **Drill-down to grid:** the lineage fades in place, the user glides to its cell, then the other users cascade in one by one.
- **Hide completed (dense):** removed cards ghost out, remaining cards glide into the re-wrapped columns (25 entitlements wrapped into 3 columns, then 2), nothing is stuck at the corner, and the final state is clean with attached edges.
- **Layout LR to TB:** the tree rotates through diagonal paths, edges are hidden at 98 and 199 ms and attached at 304 ms, and the end state is the TB tree.
- **Initial grid reveal:** blank at 30 ms, then a row-by-row cascade, with no flash and no camera move.
- **Final 1100x700 and 1700x1000 states:** legend, minimap and control panel are in place, and the canvas reaches the bottom of the window.

The timeline JSON has 437 results, 437 passing. The dev-server log has the two documented timing misses, and the coder's reason (React dev overhead) is plausible given production passes at 74-123 ms.

## Cleanup and end state

`git status` is clean. The one commit (9e62179) changes `AccessGraph.css`, `AccessGraphCanvas.tsx`, `tokens.css`, `graphTransition.ts`, `useGraphTransition.ts`, `useMotionMs.ts` and three new test files. `package.json` and `package-lock.json` are untouched, with no new runtime dependency. The worktree has no harness, driver, `.motion-tmp` or puppeteer in `node_modules`. `dist/` exists but is gitignored build output.

</details>

<details>
<summary>File map</summary>

- `src/graph/graphTransition.ts` — pure planner, class helpers, origins, order, size guard, camera `placed` check, motion parsing (new)
- `src/graph/useGraphTransition.ts` — phase scheduler hook (new)
- `src/graph/useMotionMs.ts` — reads `--motion-ms` (new)
- `src/graph/AccessGraphCanvas.tsx` — uses the frame, target-based animated fit, `motion-on`, `motionMs` test seam
- `src/graph/AccessGraph.css` — motion rules, reveal, exiting/arriving/settling keyframes, reduced-motion overrides
- `src/graph/tokens.css` — `--motion-fast-ms`
- `src/graph/graphTransition.test.ts`, `useGraphTransition.test.ts`, `AccessGraphCanvas.motion.test.tsx` — new tests (86)

Full diff: `git diff main...feature/graph-motion` in `.worktrees/graph-motion`.

</details>
