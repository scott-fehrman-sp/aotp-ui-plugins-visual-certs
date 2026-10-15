# Reassign display — verification note

Task: surface the "Reassigned" count as a first-class third decision outcome
alongside "Kept" (approved) and "Removed" (revoked) in the campaign
overview/dashboard and the sign-off summary. Display + metrics only; the
reassign decision flow was already implemented and was not touched.

## Changes

- `src/domain/metrics.ts` — added `reassigned: number` to `CampaignMetrics`;
  tallies it in the item loop (mutually exclusive from APPROVE/REVOKE) and
  returns it. Fallback branch leaves it 0 (same as approved/revoked), with a
  comment noting items aren't loaded there.
- `src/components/charts/DecisionBar.tsx` — added `reassigned` prop, a third
  "Reassigned" bar, `max` now includes it, and the visually-hidden summary now
  reads "{approved} kept, {revoked} removed, {reassigned} reassigned."
  Fill color reuses the existing `--vc-accent` token (the same accent the
  `.vc-btn-reassign` action already uses) — a blue, distinct from the
  allow/deny greens/reds. No new CSS variable needed.
- `src/components/MetricCard.tsx` + `MetricCard.css` — extended the `tone`
  union with `reassign`, wired to `--vc-accent`, matching the bar.
- `src/views/CampaignDashboard.tsx` — added a "Reassigned" MetricCard
  (`tone="reassign"`) after "Removed" and passed `reassigned` to `DecisionBar`.
- `src/views/SignOffView.tsx` + `SignOffView.css` — added `reassigned` prop and
  a third `<li>` with a `vc-signoff-reassign` span (blue accent). Sign-off
  gating untouched.
- `src/CertApp.tsx` — destructured `reassigned` from metrics and passed it to
  `SignOffView`.

Tests added/updated: `metrics.test.ts` (reassigned count, four-way split,
fallback = 0), new `DecisionBar.test.tsx` (summary includes reassigned),
`CampaignDashboard.test.tsx` (Reassigned card value), `SignOffView.test.tsx`
(new required prop on all renders + a case asserting the reassigned line).

## Commands run (from repo root)

- `npm run build` → exit 0. `tsc -b && vite build` type-checked and bundled
  with no errors.
- `npm run lint` → exit 0. Clean.
- `npm test -- --run` → exit 0. 18 files, 99 tests passed (93 baseline + 6 new).

Note: DecisionBar tests emit benign recharts "width(0)/height(0)" stderr
warnings because jsdom gives ResponsiveContainer no layout; the tests assert on
the always-rendered visually-hidden summary, so they pass. This matches the
pre-existing CampaignDashboard test that also renders DecisionBar.

No git repo here, so nothing was committed. No temp/debug files created.
