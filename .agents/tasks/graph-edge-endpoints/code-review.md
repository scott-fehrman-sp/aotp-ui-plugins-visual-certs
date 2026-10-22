# Access-graph handles moved out of the scaled card

The fix moves the eight React Flow `<Handle>`s in `AccessNode` out of `<article class="vc-graph-card">` and renders them as siblings of the `NodeTooltip`. They are now direct children of the `.react-flow__node` wrapper, which is never scaled, has no border and is exactly 200x64. This removes the cause of the endpoint regression introduced with the smooth transitions (commit 9e62179). React Flow measured the handles once while the card was at `scale(0.94)` and cached the result through `measured`. It also removes an older padding-box offset caused by the card's 4px left stripe. CSS rules, transitions, scene builders and `graphTransition.ts` are untouched.

Watch for: only one low-confidence item remains. The user's screenshot showed edges extending beyond the node, but the harness never reproduced an outside overshoot, so the fix's link to that exact symptom rests on reasoning (possible, non-blocking). The residual error is a 0.90px hairline outside the border at zoom 1.8.

**Verdict**: APPROVED

## High-level view

The root cause is fixed, not masked. Handles measured inside a scaled, bordered box produced stale cached offsets. Handles on the unscaled wrapper measure the true node box at any card transform, so the cache is correct from the first measurement. The evidence supports this: stale-vs-DOM handle error drops from 10.64px to 0.00 with motion on, and the motion-off inset (up to 6.30px at zoom 1.8) disappears too.

Browser evidence is strict and complete. All 14 scenarios plus zoom and blink were run in production and dev, at both window sizes, in LR and TB, with motion on and off (256 runs each). Every settled state has max |dxBorder| 0.90px and max |dCross| 0.00px, against the 1.5px bar. 18329 failing endpoints before became 0 after.

Smooth transitions are preserved. Final viewport and card rects are identical to the shipped build, the largest one-frame glide step and edge opacity step are unchanged, and no leftover classes remain. Mid-transition detachment is equal or better for layout switches and grid-to-drill-in. Hide-completed and hide-reference peaks are 3 to 5px higher at their worst frame than the shipped build, but still well under the shipped 89px figure.

Scope is tight: three files changed (`AccessNode.tsx`, a comment in `AccessGraph.css`, one new test file). The tests pin the structural invariant that caused the bug.

<details>
<summary>Issues (3)</summary>

1. **Symptom link not reproduced (possible, non-blocking)** — the circled "edge beyond the node" was not reproduced in 3,400+ settled measurements; the explanation (dash phase and under-card offsets) is reasoned, not shown. Ask the user to confirm with the screenshot scenario after merge.
2. **Mid-transition peak slightly higher on hide toggles (confirmed, non-blocking)** — hide-completed mixed 26.4 to 31.4px, dense 75.3 to 78.5px; hide-reference mixed 52.7 to 55.7px. Still below the shipped 89px, with edges mostly transparent at that frame. No action required.
3. **Layout guard is regex-based (possible, non-blocking)** — the CSS guard in `AccessNode.handles.test.tsx` parses flat rules with a regex. It would miss nested CSS or `transform` set via other properties (`scale:` shorthand). Acceptable for the current stylesheet; revisit if CSS nesting is adopted.

</details>

<details>
<summary>Details</summary>

### Why moving the handles fixes both defects

React Flow measures handle offsets with `getBoundingClientRect` on mount and on forced re-measures, and `withMeasured` deliberately carries those values across scene updates so edges do not blink. Before, the handles lived under `.vc-graph-card`, which is `scale(0.94)` while entering. A card's size does not change when its scale animates back to 1, so nothing triggered a re-measure and the shrunken offsets became permanent. The same placement left handles positioned against the card's padding box, 3.5 flow units inside the 4px left stripe.

On the wrapper, neither condition applies. The wrapper is never scaled and has no border, so the one cached measurement is the true node box whatever the card's transform is at mount. `withMeasured` is kept as is. The diagnosis showed it is what holds edge blink at 0 (592 without it), and re-measuring after settle would only add store churn. The remaining 0.5-unit offset is React Flow centring its 1px handle on the wrapper edge, hence 0.90px outside at zoom 1.8.

```
before:  .react-flow__node > NodeTooltip > article.vc-graph-card (scale .94, 4px stripe) > Handle x8
after:   .react-flow__node > [ NodeTooltip > article.vc-graph-card ]  +  Handle x8
```

Handles keep `pointer-events: none`, `opacity: 0` and 1x1 size (`.vc-graph-handle`, unchanged rule), so hit-testing and tooltip behaviour are unaffected. `NodeTooltip` still measures the card as its first element child, and the test asserts that.

### Evidence quality

The tables in `verification.md` come from the real `AccessMatrixView` in installed Chrome, not jsdom. The baseline was reproduced on the unfixed build before coding and matched the diagnosis, so the "after" numbers are comparable. They include the strict endpoint check against the wrapper rect (not just the DOM handle), the dCross check, the stale-vs-handle check, unsettled-step and console-error counts, and the blink sampler. The reduced-motion and size-guard paths were covered by the motion-off runs, which hold the same 0.90px. The 592 blink figure with motion off is unchanged from before and pre-dates the fix.

The mid-transition table compares the shipped build and the fixed build, with two repetitions of the fixed build differing by up to 2.9px. Layout switches are equal within noise. The number of frames with a visible edge more than 2px off its handle fell from 72-94 to 10-11 for drill and hide/show, and stayed at 14 for layout.

### Tests

`AccessNode.handles.test.tsx` has four tests. Two assert, for the overview grid and the drill-down, that each node wrapper holds exactly the eight handles in order as direct children, that none is inside `.vc-graph-card`, that source/target classes match the ids, and that the card remains the tooltip anchor's first element child. Two CSS guards read `AccessGraph.css` from disk (vitest runs with `css: false`) and assert that every `scale(` rule outside `@keyframes` ends in `.vc-graph-card` and that no `.react-flow__node` rule sets `transform`. The mutation check reported in the commit shows each pair fails when the invariant is broken. No existing test was edited, and there is no global `getBoundingClientRect` stub. jsdom cannot measure geometry, so the real regression guarantee lives in the browser evidence, which is not part of the committed suite; that is an accepted limit of the unit tests.

### Do-not-change areas and hygiene

`git diff main...HEAD --name-only` lists only `AccessGraph.css` (comment only), `AccessNode.handles.test.tsx` and `AccessNode.tsx`. Scene builders and golden positions, filters, review-status pipeline, control panel, lane wrapping, fit padding, selection and hover, page-fill layout, `accessCounts`, `CampaignDashboard*`, `package.json` and `package-lock.json` are not in the diff. No dependency was added. In the worktree, `git status --short` is empty, the harness/driver/vite config files are gone, `node_modules` contains no puppeteer entry, and `git worktree list` shows only main and edge-ends. A Chrome and vite process are running on the machine, but the verification notes attribute the vite process to the main repo's own dev server, and the Chrome processes belong to the user's browser. This review did not re-run the gates; it relies on the commit message and `verification.md` (build, lint and `npm test` twice, 50 files / 627 tests).

</details>

<details>
<summary>File map</summary>

- `src/graph/AccessNode.tsx` — `<Handles />` moved out of the card to a sibling in both the grid and drill-down returns; explanatory comments.
- `src/graph/AccessGraph.css` — comment above `.vc-graph-handle` only.
- `src/graph/AccessNode.handles.test.tsx` — new structural and CSS-guard tests.

Full diff: `git -C .worktrees/edge-ends diff main...HEAD` (commit 96d2322).

</details>
