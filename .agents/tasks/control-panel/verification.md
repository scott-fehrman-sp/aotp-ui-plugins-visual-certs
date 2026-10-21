# Verification: graph control panel (branch feature/graph-control-panel)

Run in the worktree `.worktrees/control-panel`:
- `npm run build` (tsc -b && vite build): exit 0, zero type errors.
- `npm run lint`: clean.
- `npm test`: 36 files / 294 tests passed. useProvenance flake did not occur.
- New tests: referenceFilter.test.ts (10), GraphControls.test.tsx (10), AccessGraphCanvas.test.tsx "graph controls panel" (11). Tooltip tests use scoped stubRect on one element, no global getBoundingClientRect stub.
- `git diff main --stat -- src/domain src/views src/sailpoint package.json package-lock.json`: empty.

Real-browser check (temporary Vite harness + puppeteer-core@23 on installed Chrome, https://localhost:5199, 1700x1000 and 1000x700): script printed ALL PASS (~90 checks):
- toolbar 15px from canvas right/top edge; 3 buttons ~32x32, same x, increasing y; no overlap with minimap, Controls, legend, Back button (drill-down, reference hidden, TB layout, grid, 1000x700).
- reference hidden: 0 reference nodes, 0 sources, 0 reference edges, 6 nodes (user + 5 first-level), all inside canvas (re-fit), legend loses only the reference row; restoring brings back all 12 nodes.
- layout flip: user->source axis horizontal (LR) -> vertical (TB) -> horizontal; nodes inside canvas after re-fit.
- minimap 1 -> 0 -> 1; works in grid; layout/reference disabled in grid, minimap enabled.
- tooltip fully inside viewport, left of button, vertically centered; tooltip also shows on a disabled grid button.
- hidden reference + minimap preferences survive Back and drilling into Bob.
Screenshots (read and reviewed): 1-drilldown-default, 2-reference-hidden, 3-minimap-hidden, 4-grid, 5-tooltip, 5b-tooltip-disabled-grid, 6-small-1000x700, 7-dark (.png) in this folder.
Harness, script and puppeteer-core removed; `npm ci --ignore-scripts` run; package.json / package-lock.json untouched.
