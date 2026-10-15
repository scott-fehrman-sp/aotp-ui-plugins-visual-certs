# Surface "Reassigned" as a third decision outcome in the overview and sign-off

This change promotes reassignment from an invisible side effect to a first-class outcome displayed next to "Kept" and "Removed". The reassign *decision flow* already existed (dialog, identity picker, API wrapper, optimistic state, priority handling all treat reassignment as resolved) — what was missing was any count of it in the campaign dashboard overview, the decisions chart, and the sign-off summary. The approach threads one new `reassigned` number from `computeMetrics` out to the three display surfaces, counting it as a mutually-exclusive third bucket that advances progress but is neither approved nor revoked. Color/tone reuses the existing blue `--vc-accent` token that the reassign action button already uses, so the third outcome reads consistently across the UI.

Watch for: nothing blocking. The metrics tally correctly excludes reassigned from approved/revoked (confirmed), the DecisionBar a11y summary mirrors all three outcomes (confirmed), and sign-off gating is unchanged (confirmed). The one behavioral nuance worth knowing — not a defect — is that the dashboard fallback branch reports `reassigned: 0` until review items load, matching how approved/revoked already behave there (confirmed).

**Verdict**: APPROVED

## High-level view

The metric itself originates in `computeMetrics`. The item loop now has a fourth branch: an item that is completed, decided, or reassigned counts as reviewed, and within that, `item.reassigned` increments `reassigned` only on the `else` arm after APPROVE/REVOKE — so a reassigned item can never be double-counted as kept or removed. The `CampaignMetrics` interface carries the new field, and the campaign-count fallback leaves it at 0 with a comment, consistent with how approved/revoked are already unknown there.

The display side is three consumers of that one number. The dashboard renders a fourth `MetricCard` ("Reassigned", `tone="reassign"`) after "Removed" and passes `reassigned` into `DecisionBar`. The bar gains a third row, folds reassigned into its `max` so the axis scales correctly, and — most importantly for accessibility — extends the visually-hidden screen-reader summary to read "{n} kept, {m} removed, {k} reassigned". The sign-off summary gains a third `<li>` with a `vc-signoff-reassign` class, and `CertApp` destructures `reassigned` from metrics to feed it in.

The reassign tone is a deliberate reuse of `--vc-accent` (blue) rather than a new token, documented in three places (DecisionBar data, MetricCard.css, SignOffView.css). It reads as "handed off" and stays visually distinct from the allow-green / deny-red pair.

Scope is clean: the reassign decision flow, SDK handshake, and build/plugin config were not touched. Build, lint, and the full test suite (99 tests, 6 new) pass per the coder's verification note.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking action items. The implementation matches the stated scope and the behavioral invariants hold.

</details>

<details>
<summary>Details</summary>

### Mutual exclusivity in the metrics tally

The core correctness question is whether a reassigned item can leak into the approved or revoked counts, and it can't. The loop in `computeMetrics` gates on `item.completed || item.decision || item.reassigned` to decide an item is reviewed, then splits the outcome with an if/else-if chain: `APPROVE`, else `REVOKE`, else `reassigned`. Because reassignment is the final `else` arm, it only fires when there is no `APPROVE`/`REVOKE` decision — the three buckets are structurally mutually exclusive, and reassigned still advances `reviewed`, which feeds `remaining` and `percentComplete`. This matches the semantics documented on `ReviewItemVM.reassigned` and the `isResolved` logic in `priority.ts`, where a reassigned item is "off this reviewer's plate" without being kept or removed.

One edge worth naming: if the underlying data ever had both `decision === 'APPROVE'` and `reassigned === true` on the same item, the decision wins and the reassignment would not be counted. That's the correct precedence for a tally where the buckets must sum to `reviewed`, and the reassign flow doesn't produce that combination, so it's a non-issue — noted only so the precedence is explicit.

### Fallback branch keeps reassigned at 0

When review items aren't loaded (the dashboard can render before the queue arrives), `computeMetrics` falls back to the campaign's aggregate `decisionsMade`/`decisionsTotal`, which have no per-outcome breakdown. The branch leaves `reassigned` at 0 with a comment, exactly as it already does for `approved` and `revoked`. So before items load, the dashboard shows Kept 0 / Removed 0 / Reassigned 0 and only the Reviewed/Still-to-review totals carry information. This is pre-existing behavior extended consistently to the third bucket, not a regression.

### DecisionBar accessibility invariant preserved

The chart's accessibility contract is the visually-hidden `<p>` that mirrors the bar values for screen readers, since the recharts canvas isn't readable. That summary now reads "{approved} kept, {revoked} removed, {reassigned} reassigned." and `DecisionBar.test.tsx` asserts on it directly (`/4 kept, 2 removed, 3 reassigned\./`), including a zero-reassigned case. The `max` for the x-axis domain now includes `reassigned` (`Math.max(approved, revoked, reassigned, 1)`), so a campaign with more reassignments than keeps/removes scales its bars rather than clipping.

### Sign-off gating untouched

`SignOffView` gained a required `reassigned` prop and a third `<li>`, but `canSignOff` still derives solely from `totalItems > 0 && outstanding === 0`. Reassigned items already reduce `outstanding` via the metrics change, which is the only way they should influence the gate — a reassigned item is resolved for this reviewer, so it shouldn't block sign-off. No new branch touches the gate.

### Test coverage

The new and updated tests cover the behavior that matters: `metrics.test.ts` asserts a reassigned item counts as reviewed but not approved/revoked, a four-way split (2 approved / 1 revoked / 1 reassigned / 1 outstanding) with the right `percentComplete`, and the fallback staying at 0. `DecisionBar.test.tsx` locks the a11y summary across all three outcomes including zero. `CampaignDashboard.test.tsx` checks the Reassigned card value, and `SignOffView.test.tsx` adds the new required prop to every render plus a case asserting the "1 reassigned" line.

Not tested: there's no test asserting the DecisionBar `max` scales to the reassigned value (e.g. reassigned exceeding approved/revoked), and no explicit test that the dashboard fallback card shows 0 before items load. Both behaviors are exercised indirectly and are low risk, so this is a note, not a gap that blocks.

### Scope

The out-of-scope surfaces named in the task — the reassign API wrapper (`certifications.ts` reassign call), `IdentityPicker`, the `DecisionDialog` reassign flow, `useDecisions`/`useReviewItems`, `sp-ui-plugin.json`, `vite.config.ts`, and the SDK handshake — are untouched. The `reassigned` references in those files (`useDecisions.ts`, `certifications.ts`, `priority.ts`) are pre-existing reassign-flow infrastructure that this display change reads from, not modifications. Nothing unrelated is bundled in.

</details>

<details>
<summary>File map</summary>

- `src/domain/metrics.ts` — added `reassigned` to `CampaignMetrics`; tally it in the item loop (mutually exclusive, counts toward reviewed); fallback leaves it 0.
- `src/components/charts/DecisionBar.tsx` — third "Reassigned" bar, `max` includes it, hidden a11y summary mirrors all three outcomes.
- `src/components/MetricCard.tsx` + `MetricCard.css` — `tone` union gains `reassign`, wired to `--vc-accent`.
- `src/views/CampaignDashboard.tsx` — "Reassigned" MetricCard after "Removed"; passes `reassigned` to DecisionBar.
- `src/views/SignOffView.tsx` + `SignOffView.css` — new `reassigned` prop and `vc-signoff-reassign` summary line; gating unchanged.
- `src/CertApp.tsx` — destructures `reassigned` from metrics, passes it to SignOffView.
- Tests: `metrics.test.ts`, `DecisionBar.test.tsx` (new), `CampaignDashboard.test.tsx`, `SignOffView.test.tsx`.

No git history in this workspace, so there is no committed diff to link; review is against the working tree.

</details>
