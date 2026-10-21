# Review: hover edge emphasis and readable zoom for long graphs

Verdict: APPROVED. No blocking findings; five non-blocking items are in review.json.

I re-ran build, lint and npm test in the worktree. Build exited 0, lint was clean, and 41 files / 389 tests passed. Worktree `git status` is empty and package.json / package-lock.json are untouched. No harness or puppeteer remains in the worktree, and the branch has no remote ref. I opened the standard-shown hover, dense-hidden open and dense-shown 1000x700 screenshots. They match the recorded numbers.

Watch for (all non-blocking):
- The code comments claim the user and nearest items are always clear of overlays. The report records one exception: dense, 1000x700, shown reference, LR layout, minimap on. There Profile 2 sits under the minimap (confirmed in the screenshot).
- The "wheel reaches last item 16/16" row overstates. In that same scenario the last item also needs a horizontal pan.
- In the four 1000x700 shown scenarios, Controls fit-view still cuts nodes at the unchanged 0.15 minZoom.
- The 0.3 trigger sits 0.015 below the lowest standard-graph fit zoom (0.315). The report states this honestly as D4.
- The scroll hint has not been checked at canvas widths below 1000 px. Its role=status element mounts together with its text, which some screen readers do not announce.
