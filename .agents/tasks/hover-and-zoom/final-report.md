# Final report: hover-and-zoom

Branch `feature/graph-hover-and-readable-zoom` (worktree `.worktrees/hover-and-zoom`). Not pushed, not merged.

## Commits
- 4e6fe8e feat(graph): raise hovered or focused item's status edge above cards and dim the rest
- 7099ebf feat(graph): open long lists at a readable zoom with a scroll hint
- ea7fc07 fix(graph): default scroll-axis penalty 2 after real-browser tuning

## Change 1: hover/focus emphasis
Hovering or keyboard-focusing an access item raises its status edge above the cards and dims the other edges.
Files: `EmphasisContext.ts`, `emphasizeEdges.ts` (+test), `AccessNode.tsx`, `AccessGraphCanvas.tsx`, `AccessGraph.css`, `buildAccessScene.ts`, `AccessGraphCanvas.emphasis.test.tsx`.

## Change 2: readable zoom for long lists
In drill-down, when the fit-everything zoom is below 0.3, the graph opens at a readable zoom and a scroll hint shows. Otherwise the existing fit is unchanged.
Files: `fitPadding.ts` (+test; adds `planFit`, `readableViewport`, `isGraphOutOfView`, `scrollAxis` options), `ScrollHint.tsx`, `AccessGraphCanvas.tsx`, `AccessGraph.css`, `AccessGraphCanvas.zoom.test.tsx`, `AccessGraphCanvas.fit.test.tsx`.

13 files changed, 1307 insertions, 22 deletions. `package.json` and `package-lock.json` unchanged.

## Gates (run in the worktree)
- `git status --short`: empty
- `package.json`/`package-lock.json` diff vs main: empty
- No harness or driver files tracked
- `npm run build`: pass (only the existing chunk-size warning)
- `npm run lint`: pass
- `npm test`: 41 files, 389 tests, all pass (first run)

## Assumptions
- D3: When the user card does not fit in a top-aligned window, the readable view starts centered on the user. It starts at the lane top only when the user fits.
- D4: Two constants in `fitPadding.ts`. `SCROLL_MODE_FIT_ZOOM = 0.3` is the fit zoom below which the graph counts as long. `READABLE_MIN_ZOOM = 0.65` is the zoom used for long graphs. Keeping them separate avoids a jump between modes.
- D5: Overlay strip assignment accounts for the scroll axis (`y` for LR, `x` for TB). Strips on that axis have their thickness multiplied by `scrollAxisPenalty` (default 2, tuned in a real browser). Applied padding stays the real thickness.

## Revised overlay invariant
- Mode A (fit zoom >= 0.3): the old strict rule holds. No node intersects an overlay by more than 0.5 px, and every node is inside the canvas.
- Mode B (fit zoom < 0.3):
  - Zoom is `READABLE_MIN_ZOOM`.
  - The user card and its 3 nearest lane items are fully visible and clear of overlays.
  - Any node wholly inside the free region is clear of overlays.
  - Nodes outside the canvas or cut by an edge are allowed, since they are reached by scrolling.
  - First and last items can be scrolled into clear view.
  - The hint pill never overlaps other controls.

## Known behavior
Window resize still resets manual pan/zoom by refitting. This is more noticeable with the readable zoom.

## Screenshots
In `.agents/tasks/hover-and-zoom/`:
- Hover: `h1-{standard,dense}-{shown,hidden}[-tb]-{before,hover}-{1700,1000x700}.png`, `h1-keyboard-focus-1700.png`, `h1zoomin-dense-shown[-tb]-{before,hover}-1700.png`
- Zoom: `z1-dense-{hidden,shown}[-tb]-open-*.png`, `z1-dense-hidden-scrolled-end-1700.png`, `z1-dense-fitview-1700.png`, `z1-dense-shown-open-nomap-1700.png`
- Regression: `z2-standard-shown-1700.png`, `z2-standard-hidden-1000x700.png`, `explore-standard-shown.png`
- Logs and summaries: `*.json`, `h1-final-regress.log`, `z-final.log`; see also `verification.md`

## Merge
From main: `git merge feature/graph-hover-and-readable-zoom`
