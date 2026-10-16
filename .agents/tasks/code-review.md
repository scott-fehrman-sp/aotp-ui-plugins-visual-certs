# Access provenance ("How they got this") — code review

The change adds a decision-support feature to the certification review queue: a
headline grant-mechanism badge (Q4) plus an on-demand requester→approver chain
(Q5), scoped to Option A. It lands as a thin data module
(`provenance.ts`: resolver + matcher + mapper), a lazy non-blocking hook
(`useProvenance.ts`), and a self-contained presentational component
(`AccessProvenance.tsx` + `.css`), threaded through the existing card chain and
wired into `CampaignRoute`. The approach keeps provenance strictly off the
critical path: the queue renders and is interactive from the item list alone,
and provenance resolves afterward per-identity. Scope was held tightly — no new
scopes, no manifest/vite change, keep/remove/reassign untouched.

Watch for: nothing blocking. Verification evidence (build/test/lint all clean,
135 tests) is present and credible [confirmed], the code matches the approved
design on every locked point I checked [confirmed], and the two subtle
correctness traps the design called out (the always-true `if
(event.accessRequest)` regression and the decision-flashes-loading regression)
are both avoided and pinned by tests [confirmed].

**Verdict**: APPROVED

## High-level view

Q5's approval chain is built exactly as specified. The resolver keys the
request fetch on `identitySummary.identityId` (via `ReviewItemVM.identityId`),
the matcher pairs a `RequestedItemStatus` to the item by name + type, and the
mapper emits `requester.name` / `created` / `requesterComment.comment` plus an
`approvalDetails[]` chain (`currentOwner.name`, mapped `ManualWorkItemState`,
`modified`, `comment`) rendered oldest-first as a scannable sequence.

Q4's mechanism is never fabricated. `role` comes only from the item being a role
and is never emitted from history. `request` vs `direct` is derived from a
request row, or — when only history matched — from an explicit `hasRequestSignal`
predicate on populated sub-fields, dodging the always-true-object trap. When
nothing is conclusive the mapper returns an honest `direct`/`unknown`, and 400/403
degrade the card rather than erroring it.

The per-identity promise cache guarantees one fetch per identity and is reset on
campaign change through an effect that recreates the resolver when `campaignId`
changes — not on unmount, matching the keyless `CampaignRoute`. The resolve
effect keys on a memoized id-set signature, so keep/remove/reassign neither
re-fetch nor flash loading.

The experimental header is guaranteed by passing `xSailPointExperimental: 'true'`
on the history call. Accessibility mirrors `WhyThisOrder`: `aria-expanded` /
`aria-controls` disclosure, `aria-live="polite"` badge region, a self-contained
`.vc-chip` using only `--vc-` tokens, and mechanism conveyed by text + icon, not
color alone.

<details>
<summary>Issues (0)</summary>

No blocking or actionable findings. The one accepted scope boundary
(entitlement-granted-via-a-role cannot be detected in the `2.1.28` client and
surfaces as `request`/`direct`/`unknown`) is documented in the design as a
locked limitation, not a bug.

</details>

<details>
<summary>Details</summary>

### Q5 approval chain

`createProvenanceResolver.fetchRequests` calls
`listAccessRequestStatusV1({ requestedFor: identityId, limit: 250 })`, and
`identityId` originates from `toReviewItemVM` as
`item.identitySummary?.identityId ?? ''` (`certifications.ts:255`), so the fetch
is keyed on the identity exactly as required. `matchRequest` pairs a
`RequestedItemStatus` to the item on trimmed, case-insensitive name AND the
mapped type token, preferring the most recent `created` on multi-match. The
mapper populates `request` from `requester.name` → `requestedBy`, `created` →
`requestedOn`, `requesterComment.comment` → `justification`, and builds
`approvals` from `approvalDetails[]` in array order (oldest first) with
`currentOwner.name` → approver, `modified` → `decidedOn`, `comment` → comment.
`AccessProvenance` renders this as "Requested by … on …" followed by an ordered
list of "{approver} — {decision} on {decidedOn}" with the comment beneath and the
justification as a quoted block — a clean requester→approver(s) flow. The
integration test confirms the end-to-end keying (`requestedFor: 'identity-1'`)
and name+type match resolving to "Via access request" [confirmed].

### Q4 mechanism is never fabricated

The mapper's decision order is faithful to the design. `role` is returned only
on `item.accessKind === 'role'` and is unit-tested to never arise from a history
event with `accessItemType: 'role'` on a non-role item [confirmed]. The
history-only branch computes

```ts
const hasRequestSignal =
  event.governanceEvent?.type === 'accessRequest' ||
  Boolean(event.accessRequest?.requesterId ?? event.accessRequest?.requesterName)
```

which tests populated sub-fields rather than the always-present `accessRequest`
object — the specific regression the design warned about. The empty-`accessRequest`
→ `direct` case is pinned by a test [confirmed]. Honest `direct`/`unknown` are
distinct terminal states, and `historyUnavailable` only reshapes the disclosure
copy. History 400/403 degrade to `events: null` in `fetchHistory`'s catch, and
the request path's soft 401/403 vs hard 429/5xx/network split is driven by
`toFriendlyError(error).status` with `hard = status === 429 || status ===
undefined || status >= 500`. I confirmed `FriendlyError` carries `.status`
through for exactly these codes (`certifications.ts:59-110`), so the
classification the resolver relies on is sound [confirmed].

### Name+type matcher and the sentinel guard

`isUnmatchableFallbackName` returns true for empty/whitespace and the
`"this access"` sentinel, and `matchRequest` applies it only on the `access`
fallback (typed items match on name + type and are unaffected). A null-`type`
request row is non-matching for typed items and matches only the `access`
fallback. Tests cover the sentinel, empty/whitespace, null-type-vs-typed, the
name-only fallback, case-insensitive/trimmed match, the most-recent tie-break,
and no-match [confirmed].

### Per-identity cache and the no-flash guard

The resolver's `Map<string, Promise<RawIdentityProvenance>>` returns the cached
promise on repeat `forIdentity` calls, so concurrent and repeat lookups dedupe to
one round-trip — tested to call each API once across three `forIdentity` calls
[confirmed]. The hook keeps the resolver in a ref and recreates it when
`campaignId` changes (tracked by `resolverCampaignRef`), seeding an empty map on
a fresh campaign so no identity shared across campaigns returns a stale promise;
the campaign-change-reset test asserts a second fetch for the same identity
after a keyless rerender [confirmed]. The resolve effect depends on
`[idSig, campaignId]` where `idSig` is the memoized joined id set, and the
per-item seed never downgrades a `ready` entry to `loading`. The "decision
preserves ids → no re-fetch, no loading flash" test confirms the guard
[confirmed]. The reset is handled inside the hook via a synchronous
resolver-recreate rather than a separate setState effect, which the verification
note explains resolved a `react-hooks/set-state-in-effect` lint error — a sound
way to keep the reset race-free.

### Experimental header

`fetchHistory` passes `xSailPointExperimental: 'true'` on
`getHistoricalIdentityEventsV1`; the design verified the `2.1.28` client always
writes `X-SailPoint-Experimental` when the param is set. A resolver test asserts
the param is passed [confirmed].

### Accessibility

`AccessProvenance` mirrors `WhyThisOrder`: a native `<button>` with
`aria-expanded={open}` and `aria-controls={panelId}` (`useId()`), collapsed by
default, and an `aria-live="polite"` badge row whose `min-height` reserves the
resolved badge height to avoid a shift on async resolution. The badge redeclares
`.vc-chip` in `AccessProvenance.css` so it does not depend on `ReviewItemCard.css`
being in the tree, and uses only existing `--vc-accent`/`--vc-accent-bg`/
`--vc-surface-alt`/`--vc-text-muted`/`--vc-border` tokens. Mechanism is conveyed
by label text plus an icon prefix (`aria-hidden`), never color alone. The
component test asserts the toggle flips `aria-expanded` and reveals the chain
[confirmed].

### Scope

The diff touches only the planned files. `sp-ui-plugin.json` and `vite.config.ts`
are not in the changed set (confirmed via `git diff --name-only`), the SDK
handshake in `sdkClient.ts` is unchanged beyond constructing the two new clients
(no `IdentitiesApi`, no autoconfigure change), and `ReviewItemCard`'s
keep/remove/reassign action column is untouched — the provenance block is
inserted after the priority chips in `.vc-item-text`, exactly as specified. The
`DrillDownTable` branch of `ReviewView` is left alone (card-view only). The
`idn:identity-history:read` scope comment is present near the
`identityHistoryApi` construction [confirmed].

### Tests and verification

Verification evidence (`verification.md`) reports `npm run build` clean,
`npm test` 135/135 (100 baseline + 35 new), and `npm run lint` clean. The three
new test files exist and cover the design's required cases: matcher branches +
sentinel guard, every mapper branch including the empty-`accessRequest`→`direct`
pin and "history never emits role", the full `ManualWorkItemState` mapping,
resolver fetch-once/parallel/soft-vs-hard/experimental-flag, hook
grouping/unavailable/no-flash/re-resolve/campaign-reset, component badge+
disclosure+degraded copy, and the non-gating integration assertion. I read all
four and they match the claims [confirmed]. No full re-run was needed; the
evidence is specific and the code supports it.

</details>

<details>
<summary>File map</summary>

- `src/sailpoint/types.ts` — provenance view-model types + `identityId` on `ReviewItemVM`
- `src/sailpoint/certifications.ts` — populate `identityId` in `toReviewItemVM`
- `src/sailpoint/sdkClient.ts` — construct + thread the two new API clients
- `src/sailpoint/provenance.ts` — resolver + matcher + mapper (new)
- `src/state/useProvenance.ts` — lazy per-identity provenance hook (new)
- `src/components/AccessProvenance.tsx` / `.css` — badge + disclosure (new)
- `src/views/ReviewView.tsx`, `src/components/ReviewQueue.tsx`, `src/components/ReviewItemCard.tsx` — props chain
- `src/CertApp.tsx` — wire `useProvenance` into `CampaignRoute`
- test files: `provenance.test.ts`, `useProvenance.test.ts`, `AccessProvenance.test.tsx`, plus extended `certifications`/`sdkClient`/`CertApp`/`ReviewQueue` suites and fixture `identityId` additions

</details>
