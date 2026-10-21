# Verification: access-graph item selection (downstream path highlighting)

Worktree: `.worktrees/edge-selection`, branch `feature/graph-item-selection`. Iteration 1 (no review.json existed).

## Gates (run in the worktree after teardown)
- `npm run build` (tsc -b && vite build): 0 type errors, built.
- `npm run lint` (eslint .): clean.
- `npm test`: 43 files, 444 tests, all passed (no useProvenance flake this run).
- Before teardown, `npx vitest run src/graph`: 14 files / 230 tests passed (new: `selectEdges.test.ts` 25 tests, `AccessGraphCanvas.selection.test.tsx` 23 tests; every existing emphasis/fit/zoom/canvas test passes unchanged).

## What was built
- `src/graph/selectEdges.ts` (pure): `isSelectableNodeData`, `lineageEdgeIds`, `lineageNodeIds` (BFS over visible edges, visited-node guard), `highlightEdges(edges, selectedId, emphasisId)` composing with `emphasizeEdges` via exported `incomingStatusEdge/raiseEdge/dimEdge`. Nothing selected returns exactly `emphasizeEdges` (same array identity for null).
- `src/graph/SelectionContext.ts`; `AccessNode.tsx`: first-level cards `role=button`, `aria-pressed`, same names, `aria-describedby` -> status icon, Enter/Space (preventDefault); classes `selected`, `lineage`, `reference-dim`.
- `AccessGraphCanvas.tsx`: `selectedItemId` state, resets via adjust-during-render (node set change, user change), Escape ordering, `onPaneClick`, `elementsSelectable={false}`, announcements. Scene, `fitKey` and the fit effect do not reference selection.
- `AccessGraph.css`: selected ring (status ring + `--canvas` gap + `--ink` ring), lineage/dim card opacities, pointer-events none for selected/lineage edges.
- Upstream (parent -> item reference) edges are NOT associated; documented in `selectEdges.ts` (one-line change to include).

## Real-browser verification (Chrome headless via puppeteer-core@23, Vite JS API on :5199)
Matrix: fixtures standard / dense (25 first-level items) / both (entitlement first-level AND nested under a held AP) x 1700x1000 and 1000x700 x reference shown/hidden x LR/TB, minimap on. Every first-level card of every kind selected (real click when hit-testable, otherwise focus + Enter: dense had 14-17 keyed of 25). Summary: `sel-summary-full.json`: 3717 pass / 6 fail across 43 assertions.

| Assertion | Result |
|---|---|
| S1 marked edge set == independently computed forward-reachable set + incoming edge (parsed from DOM ids), one marker per edge | 256/256 |
| S1/S2 user edge: selected class, 3.5, stroke == item status token (resolved via probe); lineage solid 2.5 opacity 1 same stroke | 256/256 |
| S2 edge layer z-index above node layer | 256/256 |
| S2 pixel proof (crossed samples of associated edges inside other cards painted in status color, more than baseline) | 57/59 at 1x; 2 sub-pixel misses (below) |
| S3 every non-associated edge opacity < 0.3 | 256/256 |
| S4 exactly one aria-pressed=true; lineage ref nodes opacity 1, other ref nodes ~0.45; no status icon on reference nodes | 256/256 |
| S5 reference hidden -> only user->item edge; shown again -> full lineage; and the reverse; selection kept | 64/64 |
| S6 layout + minimap toggles keep selection and highlighted set; deselect restores baseline edge snapshot byte-for-byte | 64/64, 256/256 |
| S7 Escape clears first / second Escape to grid; real pane click clears; no card keeps focus after pane click; no stuck emphasis; ref-card click no-op; Back clears; re-drill clean | all pass |
| S8 select/deselect leave every node transform and the viewport transform byte-identical (click path) | 124/124 + 124/124 |
| S9 nothing-selected hover = shipped behavior; preview of B while A selected (stable over 20 samples/400 ms); hover of A adds nothing; drag-pan on a card does not toggle | 24/24 each |
| S10 Enter selects, Space toggles, Space does not scroll page/pane/viewport, focus-visible outline renders | 24/24 each |
| S10 Tab reaches every first-level card | 20/24 first run (see below), 13/13 after fix |

Failures and how they resolved (all measurement limits, no product defects):
- S10 Tab 23/25 on dense: driver capped Tab presses at 120; dense has ~45 tabbable cards plus panel buttons. Raised the cap to 260 and re-ran dense 1000x700 LR behaviors: pass (`sel-summary-tabcheck.json`). The other three dense combos were not re-run individually (same cause, same driver cap).
- S2 pixel proof, standard 1000x700 shown TB (2 selections): 2.5px strokes at ~0.4 zoom are sub-pixel at 1x (33% and 48% matched). Re-ran the scenario at deviceScaleFactor 2: 5/5 pass (`sel-summary-dsf2.json`, 103/103 assertions).
- Driver-only: an Escape sent while a panel button held focus closed its tooltip first (existing ControlHint behavior); blurred before Escape.

React Flow selection neutralized: no `.selected` / `.selectable` on nodes or edges (also unit-tested); edges ignore the pointer.

## Screenshots (in this directory) and what they show
Each was opened and inspected.
- `sel-standard-shown-LR-1700-baseline.png`: nothing selected, status edges in their own colors, reference hairlines; identical to shipped.
- `sel-standard-shown-LR-1700-selected-role.png` (+ `-2x.png`): Role A reassigned: Alice->Role A dotted thick blue; Role A -> Foo/Delete, Foo -> Read/Write, all -> ERP drawn solid blue over the cards they cross (e.g. over Foo); second neutral ring around Role A distinct from its blue status ring; Directory and Pay muted; other user edges faint.
- `...-selected-entitlement.png`: Admin (revoked): red user->Admin edge plus red Admin->Directory; the rest dimmed. The raised red edge crosses the Role A label (by design, same as the shipped hover raise).
- `sel-standard-shown-TB-1700-selected.png`: same lineage in vertical layout, blue to ERP.
- `sel-standard-hidden-LR-1700-selected.png`: reference hidden, only user->Role A thick dotted blue; others faint.
- `sel-standard-shown-LR-1000x700-selected.png`: same at the small viewport.
- `sel-standard-bothlevels-selected-role.png` / `-selected-read.png`: Role A lights Foo->Read and Read->ERP, user->Read stays dim; selecting Read lights only user->Read (green) and Read->ERP.
- `sel-standard-hover-preview.png`: Billing selected (amber lineage to Pay/ERP), hovering Role A adds its blue edge as a preview; tooltip works.
- `sel-standard-keyboard-focus-selected.png`: keyboard-selected Read (green path, selected ring, tooltip on focus).
- `sel-standard-dark-selected.png`: dark scheme: ring and light-blue path visible. Note: in this harness the React Flow canvas stays light in dark mode (existing behavior, unrelated).
- `sel-dense-shown-LR-1700-selected.png`, `-selected-entitlement.png`, `sel-dense-hidden-LR-1700-selected.png`, `sel-dense-shown-TB-1000x700-selected.png`: 25-item graph: selection works at the readable zoom without moving the viewport; amber role path through Finance AP to sources; others dimmed but faintly visible.
- JSON: `sel-summary-full.json`, `sel-summary-tabcheck.json`, `sel-summary-dsf2.json`. Harness copy: `harness/` (not committed).

## Teardown
Harness html/tsx, driver and the puppeteer-core install removed (`npm ci --ignore-scripts`); `git status` shows only the 8 intended src files; package.json / package-lock.json untouched. The vite process on PID 28209 is the user's main-repo dev server, not started by this task.
