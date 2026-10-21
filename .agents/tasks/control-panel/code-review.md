# Right-side vertical control panel for the access graph

Adds an org-graph-style pill toolbar (`<Panel position="top-right">`, `role="toolbar"`, "Graph controls") with Layout, Reference and Minimap buttons. The layout toggle moves out of the top-left panel. A new pure `withoutReference` filter removes nested-only nodes, sources and reference edges from the scene before layout, and it shares its first-level/reference predicates with `buildAccessScene`. Preferences are in-memory `useState` in `CanvasSurface`, so they survive user and mode switches.

Watch for: (1) with reference hidden, straight user→first-level edges run behind intermediate cards and read as a chain (likely, non-blocking); (2) at 1700x1000 with reference hidden, the minimap occludes the bottom-right "Login" card, because the fit ignores overlay panels (confirmed in screenshot 2, non-blocking).

**Verdict**: APPROVED

## High-level view

The hide/show reference behavior is a pure function over the already-overlaid subgraph. It reuses the same two predicates (`isReferenceNode`, `isStatusEdge`) that `buildAccessScene` now calls, so what gets hidden is exactly what is drawn muted today. Layout is recomputed on the filtered graph and the fit key includes reference state and rankdir, so the view re-fits on both toggles. The "No expanded access" note is still computed from the unfiltered subgraph and moved to `top-center`.

The panel is a presentational `GraphControls` with a locally ported `ControlHint` tooltip. It uses graph tokens only (`--line`, `--control`, `--accent`, `--accent-soft`, `--shadow`, `--ink`, with `var(--panel, var(--control))` following the NodeTooltip precedent) and no `--vc-*`. Light and dark both render correctly in the screenshots.

Verification is thorough: build, lint and the full suite were run, 31 new tests were added, and a real-browser puppeteer pass (~90 checks) was recorded and cleaned up. The remaining concerns are visual and advisory.

<details>
<summary>Issues (2)</summary>

1. **Overlay-unaware fit hides a reviewable node (possible/likely, non-blocking)** — with reference hidden at 1700x1000 the minimap covers part of the "Login" card (screenshot 2). Consider a `fitView` padding or an inset that accounts for the minimap, or accept it as pre-existing fit behavior.
2. **Edges pass behind intermediate cards (likely, non-blocking)** — with reference hidden, the Alice→Admin status edge is a straight horizontal line behind Role A and Billing, so it reads as Role A–Billing–Admin. This is a consequence of the layer-pinned layout and the existing edge routing. Consider offsetting those edges or documenting it, since the user's rule is that only first-level items are actionable.

</details>

<details>
<summary>Details</summary>

### Reference filter and shared predicates

`referenceFilter.ts` keeps `kind === 'user'` or status-bearing nodes, and keeps edges only when they carry a `reviewStatus` and both endpoints survive. That drops nested-only nodes, all sources and every reference edge. A node that is both first-level and nested stays, and its nested incoming edge goes. `buildAccessScene` now calls `isReferenceNode` and `isStatusEdge`, so no second definition of first-level exists. The `isStatusEdge(edge) && edge.reviewStatus` condition in the builder is redundant (type narrowing only).

### Panel wiring and state

`visibleGraph` is memoized over `subgraph` and `showReference`, and `isDegenerate` stays on the unfiltered `subgraph`. A user with lineage but no reviewed edges therefore never gets the "No expanded access" note. The `sceneKey` includes reference state and rankdir, so both toggles re-fit and the minimap toggle does not.

### Tooltip and keyboard behavior

`ControlHint` consumes Escape only while the tooltip is open, so the first Escape closes it and the second leaves the drill-down. Disabled buttons are not focusable, so their explanation tooltip is mouse-only.

### Fit versus overlay panels, and edge readability

Screenshot 2 (reference hidden, 1700x1000) shows the minimap covering the Login card's right part. Screenshot 6 (1000x700) shows the legend covering Role A and the minimap crossing edges. The legend and minimap overlap is a pre-existing limitation of `fitView`, which ignores overlays. The reference toggle makes it more likely, since the graph then fills the canvas width. The minimap is now one click away from being hidden, which mitigates the problem.

In the same screenshot the Alice→Admin edge is a straight line behind Role A and Billing. Cards sit above edges, so line stubs emerge on both sides of Billing and look like a Billing→Admin link. The data is correct. The risk is that an approver misreads lineage, which matters because the product intent is that only first-level links are actionable and linkage is shown for reference.

### Test coverage

New tests cover the filter (10), `GraphControls` (10) and 11 canvas tests. The canvas tests cover toolbar placement and order, layout, minimap and reference toggles, preferences surviving user and mode switches, the first-level-and-nested node, the note for users with and without lineage, and the tooltip with Escape. Not tested in jsdom: geometry, which the browser pass covered.

### Scope and hygiene

`git status` is clean, and `--ignored` shows only `dist/` and `node_modules/`. There are no harness or script files, no puppeteer in `node_modules`, and `package.json` and `package-lock.json` show no diff. No changes touch `src/domain`, `src/views`, `src/sailpoint`, `NodeTooltip*`, `accessCounts` or `CampaignDashboard*`. The only change outside the new files is the one-line predicate swap in `buildAccessScene.ts` plus the CSS selector fix. Eight screenshots exist (1, 2, 3, 4, 5, 5b, 6 and 7-dark) and show the required states.

</details>

<details>
<summary>File map</summary>

- `src/graph/referenceFilter.ts` (+test): pure predicates and `withoutReference`.
- `src/graph/GraphControls.tsx` / `.css` (+test): the vertical toolbar.
- `src/graph/ControlHint.tsx`: left-opening portal tooltip.
- `src/graph/ControlIcons.tsx`: layout, reference and minimap icons.
- `src/graph/AccessGraphCanvas.tsx` (+test): state, filter pipeline, panel mount, legend, note, announcements.
- `src/graph/buildAccessScene.ts`: calls the shared predicates.
- `src/graph/AccessGraph.css`: `.vc-graph-nav-panel` replaces the dead selector.

Full diff: `git diff main` in `.worktrees/control-panel`.

</details>
