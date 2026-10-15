# Implementation Plan — "Reassign" decision for Access Review plugin

Context discovered during exploration (grounding for every item below):

- Build: `npm run build` (= `tsc -b && vite build`). Tests: `npm test` (= `vitest run`).
  Lint: `npm run lint`. Baseline is green: 67 tests pass. **No git repo** here —
  do NOT run git commands; rely on `npm test`/`npm run build` for verification.
- Decisions flow: `ReviewQueue` → `ReviewItemCard` buttons → `onDecide(itemId, choice)` →
  `CertApp.CampaignRoute.handleDecide` → `useDecisions.open(item, choice)` → `DecisionDialog`
  → `useDecisions.confirm(comment)` → `certifications.decide(...)` →
  `review.applyDecision` / `revertDecision` (optimistic) + `onCampaignUpdated`.
- `DecisionChoice` is the union `'allow' | 'remove'` (src/sailpoint/types.ts). It is used
  as a `Record` key in language.ts (`DECISION_LABEL`, `DECISION_MEANING`, `CANNED_COMMENTS`)
  and branched on in several components. Adding `'reassign'` to this union forces every
  `Record<DecisionChoice, …>` and every exhaustive branch to be updated — that is the main
  cross-cutting ripple and is intentional (compiler finds all sites).
- API ground truth (verified in node_modules/sailpoint-api-client):
  - `CertificationsApi.reassignIdentityCertificationsV1({ id, reviewReassign })` →
    `AxiosPromise<IdentityCertificationDto>` (so `.data` is the DTO). `id` is the
    **certification id**. Request-parameters (object) overload — same call style as the
    existing `makeIdentityDecisionV1({ id, reviewDecision })`.
  - `ReviewReassign = { reassign: ReassignReference[]; reassignTo: string; reason: string }`.
  - `ReassignReference = { id: string; type: ReassignReferenceTypeEnum }`;
    `ReassignReferenceTypeEnum` = `{ TargetSummary:'TARGET_SUMMARY', Item:'ITEM', IdentitySummary:'IDENTITY_SUMMARY' }`.
    For one access-review item use `{ id: itemId, type: ReassignReferenceTypeEnum.Item }`.
  - All exported from the subpath `sailpoint-api-client/certifications/api` (same subpath
    the existing code imports `CertificationsApi`/`CertificationDecision` from).
  - Identity search: `SearchApi.searchPostV1({ search: { indices:[Index.Identities],
    query:{ query }, sort:[…] }, limit, count })` from subpath
    `sailpoint-api-client/search/api`. Response `.data` is `Array<object>` (untyped rows);
    `.headers['x-total-count']` holds the total. This mirrors the sibling org-graph plugin
    (org-graph/src/data/sailpoint-directory.ts). `Index.Identities === 'identities'`.
- Auth/threading: `initPlugin` (src/sailpoint/sdkClient.ts) builds API classes from one
  `Configuration` (from `Configuration.autoconfigure()`), stores them on `PluginRuntime`,
  and the app reads `runtime.certificationsApi`. A new `SearchApi` must be built the same
  way and added to `PluginRuntime`, then threaded through `CertApp`.
- Metrics/priority decision (RECOMMENDED, to be documented in code): a reassigned item is
  **resolved from this reviewer's perspective** and counts toward "reviewed" progress and
  leaves the outstanding queue, exactly like a decided item. It is counted as neither
  "kept" nor "removed" (it is a third outcome). `completed` stays the signal that an item
  is resolved; a new `decision` sentinel distinguishes reassigned items for display.

---

- [ ] 1. Extend view-model types for the reassign outcome.
      Add `'reassign'` to the `DecisionChoice` union. Add a reassign-recipient view model
      `IdentityOption { id: string; displayName: string; email: string }`. Decide how a
      reassigned item is represented on `ReviewItemVM`: keep `decision: CertificationDecision | null`
      for keep/remove and add a separate boolean/flag `reassigned: boolean` (preferred —
      avoids overloading the APPROVE/REVOKE enum). Document the choice in a comment.
      Files: src/sailpoint/types.ts
      Verify: `npm run build` type-checks (expect downstream errors until later items land;
      this item alone just needs the types to be well-formed) and `npm test` still green for
      unchanged modules. Final verification is at item 12.

- [ ] 2. Add the reassign API wrapper + view-model mapping in the data layer.
      Add `reassignReviewItem(api, { certificationId, itemId, reassignToId, reason })` that
      builds `ReviewReassign` using `ReassignReferenceTypeEnum.Item` (import the enum as a
      value from `sailpoint-api-client/certifications/api`, mirroring the existing
      `CertificationDecision` import), calls `api.reassignIdentityCertificationsV1({ id:
      certificationId, reviewReassign })`, maps `res.data` through the existing `toCampaignVM`,
      and wraps errors with `toFriendlyError`. Follow the exact style of `decide`/`signOff`.
      Files: src/sailpoint/certifications.ts
      Verify: `npx vitest run src/sailpoint` — new unit tests (item 11) pass; existing ones stay green.

- [ ] 3. Add the identity-search helper (data layer) using the Search API.
      Create `searchIdentities(api: SearchApi, rawQuery: string, opts?): Promise<IdentityOption[]>`
      that builds a name/email contains-query (adapt `buildNameQuery` + `escapeSearchTerm`
      from org-graph/src/data/sailpoint-directory.ts, fields: firstName, lastName, email,
      emailAddress, attributes.firstname, attributes.lastname, attributes.email), calls
      `api.searchPostV1({ search:{ indices:[Index.Identities], query:{ query }, sort:['name'] },
      limit: 25, count:false })`, and maps each untyped row to `IdentityOption` (defensive
      field reads for id, displayName/name, email/emailAddress — follow the defensive style
      of org-graph's map-identity.ts, trimmed to 3 fields). Return `[]` for blank/too-short
      (<2 chars) input. Wrap failures in `toFriendlyError`. Put this in a new module to keep
      certifications.ts focused on certs.
      Files: src/sailpoint/identities.ts (new)
      Verify: `npx vitest run src/sailpoint` — new identities tests (item 11) pass.

- [ ] 4. Thread a SearchApi through PluginRuntime.
      Add `searchApi: SearchApi` to `PluginRuntime`; in `initPlugin` build
      `new SearchApi(configuration)` from the SAME `configuration` used for
      `certificationsApi`/`summariesApi`. Import `SearchApi` from `sailpoint-api-client`
      (root re-exports it, same as `CertificationsApi`). Do NOT touch the handshake logic.
      Files: src/sailpoint/sdkClient.ts
      Verify: `npx vitest run src/sailpoint/sdkClient.test.ts` passes (update the test's
      Configuration/injection if it asserts on the runtime shape).

- [ ] 5. Add reassign comment presets + plain-language labels.
      Add a `reassign` entry to `CANNED_COMMENTS` and `DECISION_LABEL`/`DECISION_MEANING`
      (now `Record<DecisionChoice, …>` must cover `'reassign'`). Suggested presets:
      "This isn't my direct report.", "This belongs to another manager.",
      "A subject-matter expert should review this.", "I'm covering while this person is on leave."
      Label `reassign` → "Reassign"; meaning → plain sentence e.g. "Someone else will review
      this item. It leaves your list once you reassign it."
      Files: src/domain/language.ts
      Verify: `npx vitest run src/domain/language.test.ts` passes (extend it in item 11).

- [ ] 6. Make the metrics/priority decision explicit and documented.
      In metrics.ts `computeMetrics`: count a reassigned item (new `reassigned` flag or
      `completed`) toward `reviewed`/progress, but NOT toward `approved`/`revoked`. Add a
      clear comment stating reassignment = resolved-from-this-reviewer. In priority.ts
      `prioritize`/`countByPriority`: a reassigned item sinks to the bottom and is excluded
      from outstanding counts, same as decided items — gate on the same "resolved" predicate.
      Confirm `ReviewView`'s `outstanding`/`allDecided` computation treats reassigned as
      resolved (it filters on `item.completed`, so item 7 must set `completed` on reassign).
      Files: src/domain/metrics.ts, src/domain/priority.ts
      Verify: `npx vitest run src/domain` — updated metrics/priority tests (item 11) pass.

- [ ] 7. Extend useDecisions to support the reassign action.
      Add a reassign path: either widen `PendingDecision`/`open` to carry `choice:'reassign'`
      and add a `confirmReassign({ identityId, comment })`, or add a parallel
      `pendingReassign` + `openReassign`/`confirmReassign`. Preferred: reuse the existing
      `pending` with `choice:'reassign'` and add `confirmReassign(identityId, comment)` that
      optimistically marks the item resolved via a new `review.applyReassign(itemId, comment)`
      (add to useReviewItems alongside applyDecision/revertDecision), calls
      `reassignReviewItem`, then `onCampaignUpdated`; roll back with `revertDecision` on error
      using the existing friendly-error handling. Needs `certificationId` (the campaignId
      already passed) and the `SearchApi`-independent recipient id from the dialog.
      Files: src/state/useDecisions.ts, src/state/useReviewItems.ts
      Verify: `npx vitest run src/state` — new reassign tests (item 11) pass; existing green.

- [ ] 8. Build the reusable, accessible IdentityPicker component.
      Searchable combobox: text input (debounced 275ms via a small `useDebouncedValue` hook
      or inline `setTimeout`), results in a `role="listbox"` with `role="option"` items,
      `aria-expanded`/`aria-activedescendant`, arrow-key + Enter + Escape handling, visible
      loading/empty/error states, and "selected person" display with a clear button. Props:
      `{ searchApi, value: IdentityOption | null, onChange, disabled? }` — calls
      `searchIdentities` from item 3. Do not query for <2 chars. Mirror the plugin's existing
      CSS class naming (`vc-…`).
      Files: src/components/IdentityPicker.tsx (new), src/components/IdentityPicker.css (new)
      Verify: `npx vitest run src/components/IdentityPicker.test.tsx` (item 11) passes.

- [ ] 9. Add the Reassign flow to the decision dialog.
      Extend `DecisionDialog` to handle `choice==='reassign'`: render the `IdentityPicker`
      (needs a new `searchApi` prop, passed only for reassign) ABOVE the existing preset-or-
      custom comment control (reuse the current comment combobox logic unchanged), require
      BOTH a selected identity AND a non-empty comment before enabling confirm, and call a new
      `onConfirmReassign(identityId, comment)` instead of `onConfirm`. Keep keep/remove paths
      untouched. Title/meaning come from the item-5 language entries. Alternatively split into
      a dedicated `ReassignDialog` reusing the comment sub-logic — pick ONE; the single-dialog
      approach keeps focus-trap/escape handling in one place and is preferred.
      Files: src/components/DecisionDialog.tsx, src/components/DecisionDialog.css
      Verify: `npx vitest run src/components/DecisionDialog.test.tsx` (extended in item 11) passes.

- [ ] 10. Add the "Reassign" action to the card/queue and wire it through CertApp.
      ReviewItemCard: add a third button "Reassign" alongside Keep/Remove (and show a
      "Reassigned" state for resolved-by-reassign items, like the Kept/Removed badges).
      ReviewQueue: no signature change if `onDecide(itemId, choice)` now accepts `'reassign'`.
      CertApp.CampaignRoute: `handleDecide` already opens the dialog for any choice; pass
      `runtime.searchApi` into `DecisionDialog`, and wire `onConfirmReassign` to
      `decisions.confirmReassign`. DrillDownTable: show "Reassigned" for reassigned items.
      Files: src/components/ReviewItemCard.tsx, src/components/ReviewItemCard.css,
      src/components/ReviewQueue.tsx, src/components/DrillDownTable.tsx, src/CertApp.tsx
      Verify: `npx vitest run src/components src/CertApp.test.tsx` passes (tests in item 11).

- [ ] 11. Add/extend the test suite.
      New: src/sailpoint/identities.test.ts (query building, mapping, blank/short input, error
      mapping), src/components/IdentityPicker.test.tsx (debounced search, keyboard nav,
      selection, loading/empty/error, a11y roles). Extended: certifications.test.ts (reassign
      wrapper builds correct ReviewReassign + maps DTO + friendly errors), useDecisions.test.ts
      (reassign optimistic apply/persist/rollback), DecisionDialog.test.tsx (reassign requires
      both identity + comment), ReviewQueue.test.tsx (third button fires onDecide with
      'reassign'), metrics.test.ts + priority.test.ts (reassigned counts as reviewed/resolved),
      language.test.ts (reassign presets present), sdkClient.test.ts (searchApi on runtime).
      Follow the existing fakeApi/renderHook/RTL patterns exactly.
      Files: the test files listed above (new + edited)
      Verify: `npm test` — all tests pass.

- [ ] 12. Full verification pass.
      Run the project's real gates end to end and fix any integration seams between items.
      Files: none (verification only)
      Verify: `npm run lint` clean, `npm run build` succeeds (tsc -b + vite build),
      `npm test` all green with the new tests included.

## Open assumptions (reasonable defaults taken; flag if wrong)

- Reassign uses the **synchronous** `reassignIdentityCertificationsV1` (single item), not the
  async batch `submitReassignCertsAsyncV1`. The feature reassigns one item at a time.
- Reassigned items are marked resolved via `completed:true` + a `reassigned` flag so they leave
  the queue and count as reviewed; they are excluded from kept/removed tallies.
- Identity search uses the Search API (`indices:['identities']`) exactly as the sibling
  org-graph plugin does, limit 25, no paging for the picker.
