# Verification: hide / show completed access items

## Gates (worktree, after harness removal)
- `npm run build` (tsc -b && vite build): exit 0, zero type errors (only the existing chunk-size warning).
- `npm run lint` (eslint .): clean.
- `npm test`: run twice, 44 files / 490 tests passed both times (baseline 449; +41 new/extended). No useProvenance failures.
- package.json / package-lock.json untouched.

## Unit / RTL tests added
- `completedFilter.test.ts` (17): predicates, status-less and mixed never hidden, both reachability examples, orphaned lineage/sources, distinct hiddenCount, all-complete, order/identity/no-mutation/idempotent, composition with withoutReference, real pipeline (Alice/Bob), gap-free LR/TB lanes.
- `GraphControls.test.tsx`: four buttons in order, labels incl. `(N hidden)`, null/0 count, icon swap, grid-disabled, tooltip.
- `AccessGraphCanvas.test.tsx` (hide completed items): default state, hide/show/announcements, demoted nested entitlement, reference composition, persistence across Back/users, all-complete note vs empty note, status-less/mixed item.
- `.selection`: visible selection survives; hidden selection cleared and not restored; status-only refresh completes selected item. `.fit`: one refit per toggle (both directions), disabled in grid, lane packing LR/TB. `.zoom`: visible count in hint, one plan per toggle, hint disappears when few remain. `.emphasis`: hover emphasis cleared on toggle.

## Real-browser verification (Chrome headless via puppeteer-core, temporary Vite harness, since deleted)
Real AccessMatrixView in the real app shell with the real stylesheets. Fixtures: mixed, dense (26 first-level), long (65), mostlyDone, allDone, empty. Viewports 1700x1000 and 1100x700, LR/TB, reference shown/hidden, each hide + restore cycle.
Result: **ALL PASS, 3165 checks, 0 failures** (final run).
- C1 toolbar order Layout/Reference/Completed/Minimap, 32px circle; no completed card remains, every needs-review card remains.
- C2 remaining nodes/edges equal an independent reachability oracle computed from pre-click DOM edges; C3 shared nested nodes stay, demoted direct+nested entitlement is a muted reference card without icon and with no user edge, status edge/border/ring colors agree per status.
- C4 lanes in order role<access profile<entitlement<source, evenly spaced (112 LR / 248 TB), no overlap. C5 at most one viewport change per toggle, nodes inside the canvas and clear of overlays for graphs that fit, restore returns identical ids, graph positions and zoom.
- C6 aria-pressed/label with count/active/icon, announcements, legend unchanged. C7 selection of a hidden item cleared (no pressed card, no highlighted/dimmed edges, no stale announcement, not restored on show); visible selection survives with whole visible lineage in its status color. C8 allDone note (top-center, no overlap, no scroll hint), empty keeps old note. C9 no page scroll, canvas ends at window bottom. C10 preference persists across Back and other users with their own count; grid disabled with hover label, tooltip left of button inside viewport; long fixture hint 65 -> 22 items equals visible first-level items; hint disappears when few remain. C11 Tab/Enter/Space, focus stays, Escape closes tooltip without leaving drill-down, dark mode.
- Reported (not failures): long/dense graphs at 1100x700 open in the existing readable-zoom scroll mode (strict containment n/a); no minZoom clamp occurred.
- Finding while verifying: none requiring source changes.

## Screenshots (this folder)
01-mixed-shown-1700, 02-mixed-hidden-1700, 03-mixed-hidden-ref-hidden-1700, 04-mixed-hidden-tb-1700, 04b-mixed-shown-tb-1700, 05-mixed-hidden-1100x700, 06-allDone-hidden-1700, 07-allDone-hidden-1100x700, 08-dense-shown-1700, 08b-dense-shown-1100x700, 09-dense-hidden-1700, 09b-dense-hidden-1100x700, 10-grid-disabled-tooltip-1700, 11-mixed-hidden-dark-1700, 12-empty-1700, 13-hint-hidden-focus-1700, 14-toolbar-shown, 15-toolbar-hidden, 16-hover-hint-hidden-1700, 17-toolbar-hidden-dark (.png). Driver kept as `verify-driver.mjs.txt`.
