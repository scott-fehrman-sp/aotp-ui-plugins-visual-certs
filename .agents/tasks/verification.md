# Verification — Access Provenance ("How they got this")

Feature implemented per `.agents/tasks/plan.md` and `.agents/tasks/provenance-design.md`
(Q4 grant-mechanism headline + Q5 access-request justification/approval chain,
Option A). First-iteration implementation: `.agents/tasks/review.json` carried a
`CHANGES_REQUESTED` verdict with an **empty** `findings` array and no `reviewDoc`
reference; it is the design-review artifact (matching `design-review.json`), not a
code review of this implementation, and no `code-review.md` exists. None of the
feature source files existed yet, so the plan was implemented from scratch.

## Commands run and outcomes

All commands run from the repo root on macOS (Node v22.19.0).

### `npm run build` — CLEAN
`tsc -b && vite build` completed with no type errors.
```
✓ 1068 modules transformed.
dist/assets/index-BjWcKXz0.js   278.87 kB │ gzip: 85.92 kB
✓ built in 240ms
```

### `npm test` — PASS (100 baseline + 35 new = 135)
`vitest run`:
```
Test Files  22 passed (22)
     Tests  135 passed (135)
```
Baseline was 100 tests / 19 files; now 135 tests / 22 files. New/extended tests:
- `src/sailpoint/provenance.test.ts` (new, 21): matcher name/type + case-insensitive
  + most-recent tie-break + `access` name-only fallback + no-match + the
  `"this access"` sentinel and empty/whitespace non-match; mapper for every branch
  (role, request + multi-step approval chain, history-only `request`, empty-
  `accessRequest`-object → `direct`, governance-null → `direct`, history never emits
  `role`, honest `unknown`, `historyUnavailable`); full `ManualWorkItemState` → decision
  mapping; resolver fetch-once-per-identity, experimental-flag path, history 400/403 →
  `events: null` without sinking requests, request 401/403 soft (not hard), request
  5xx hard.
- `src/state/useProvenance.test.ts` (new, 6): grouping by identity with no per-item
  fan-out, `loading`→`ready`, `unavailable` for missing `identityId` and hard failure,
  no re-fetch/no-loading-flash on a decision that preserves ids, re-resolution on
  id-set change, and campaign-change reset (same instance, no remount → resolver
  recreated + shared identity re-fetched).
- `src/components/AccessProvenance.test.tsx` (new, 7): badge per status
  (loading/ready request/ready role/unavailable), disclosure `aria-expanded` toggle
  revealing the requester→approver chain, honest empty copy for direct, degraded copy
  for `historyUnavailable`.
- `src/sailpoint/certifications.test.ts` (extended): asserts `identityId` populated from
  `identitySummary.identityId` and `''` when absent.
- `src/sailpoint/sdkClient.test.ts` (extended): asserts `accessRequestsApi` and
  `identityHistoryApi` are defined on the runtime.
- `src/CertApp.test.tsx` (extended): integration test — queue + keep/remove interactive
  immediately while provenance resolves afterward into a "Via access request" badge
  (proving provenance does not gate the list); existing keep/remove/reassign/sign-off
  flow tests unchanged and green. All three runtimes extended with fake
  `accessRequestsApi`/`identityHistoryApi`.
- Existing fixture factories (`ReviewQueue`, `DrillDownTable`, `DecisionDialog`,
  `CampaignDashboard`, `priority`, `metrics`, `useDecisions`) gained the now-required
  `identityId` field; `ReviewQueue` renders pass `provenanceByItemId={{}}`.

### `npm run lint` — CLEAN
`eslint .` reported no problems. (One intermediate `react-hooks/set-state-in-effect`
error from a separate reset effect was resolved by folding the resolver-recreate +
state-seed into the single resolve effect.)

## Files

New: `src/sailpoint/provenance.ts`, `src/state/useProvenance.ts`,
`src/components/AccessProvenance.tsx`, `src/components/AccessProvenance.css`, plus the
three new test files above.

Modified (non-test): `src/sailpoint/types.ts`, `src/sailpoint/certifications.ts`,
`src/sailpoint/sdkClient.ts`, `src/views/ReviewView.tsx`,
`src/components/ReviewQueue.tsx`, `src/components/ReviewItemCard.tsx`, `src/CertApp.tsx`.

## Constraints honored
- `sp-ui-plugin.json` (scopes still `sp:scopes:all`), `vite.config.ts`, and the SDK
  handshake unchanged — only the two new clients were constructed/threaded.
- No `IdentitiesApi` added (Q3 out of scope).
- Keep/remove/reassign behavior unchanged; `useReviewItems` untouched.
- Experimental header sent via `xSailPointExperimental: 'true'` on the history call.
- One fetch per identity (promise cache); provenance loads after the list and never
  re-fetches on a decision (effect keyed on `[idSig, campaignId]`, not the array ref).
- Honest degraded states; 400/403 degrade rather than erroring the card; the only
  `unavailable` paths are a missing `identityId` or a hard (429/5xx/network)
  request-fetch failure.
- No temp/scratch files created.
