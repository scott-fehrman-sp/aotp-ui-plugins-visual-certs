# Design Review — Access Provenance ("How they got this")

**Design under review:** `.agents/tasks/provenance-design.md`
**Cross-checked against:** `.agents/tasks/access-context-investigation.md`,
`node_modules/sailpoint-api-client@2.1.28` (`.d.ts` + `.js`), and the repo source
(`src/CertApp.tsx`, `src/sailpoint/certifications.ts`, `src/state/useReviewItems.ts`,
`src/components/WhyThisOrder.tsx`).

This is the **fourth** review pass. The design carries documented responses to passes
1–3. I reviewed the document fresh and re-verified every DTO/line/path claim against
the installed client and the live source rather than trusting the design's
"re-verified this pass" notes or its own pass-3 response section.

---

## Verdict basis

Count of blocking findings below: **0 MEDIUM, 0 HIGH** (and 0 NIT). Per the mechanical
rule (HIGH+MEDIUM > 0 ⇒ CHANGES_REQUESTED; else APPROVED), the verdict is **APPROVED**.

The three findings carried over from pass 3 are all genuinely resolved in the design
text, and a fresh read surfaced no new ambiguity, unverified assumption, feasibility
gap, scope creep, conflict, or unspecified error/validation path.

---

## Resolution of the three pass-3 findings (the gating items this pass)

### Pass-3 Finding 1 (MEDIUM) — resolver cache must not rely on unmount — RESOLVED

Verified in `src/CertApp.tsx`: `<CampaignRoute runtime={runtime} campaignId={route.campaignId} showBack={…} onBack={…} />` carries **no `key` prop**, so a campaign switch
re-renders the same instance rather than remounting it. The design now handles this
correctly:

- §4 holds the `ProvenanceResolver` in a `useRef`, states explicitly "It is NOT reset
  on unmount," and recreates the resolver (plus `setByItemId({})`) in a dedicated
  effect **keyed on `[campaignId, accessRequestsApi, identityHistoryApi]`**.
- The hook signature is `useProvenance(accessRequestsApi, identityHistoryApi, campaignId, items)` — exactly as required.
- §8's invariant is reworded to "One fetch per identity (per campaign)" with the same
  reset mechanism, so §4 and §8 wording now agree.
- §10's `CampaignRoute` wire-point and the §5.0 threading pass `campaignId` through,
  and §9 adds a required campaign-change reset test (rerender with a new `campaignId`
  on the same instance → assert resolver recreated and `byItemId` cleared).

This is the recommended Option A from the prior pass (not the wider-blast-radius `key`
option). Confirmed consistent across §4, §8, §9, and §10. ✔

### Pass-3 Finding 2 (NIT) — stylesheet terminology — RESOLVED

Verified there are no `*.module.css` files anywhere in `src/` (file search returned
none). The "Technology stack (locked)" section now reads **"global per-component
stylesheets with globally shared class names"** — each component does `import './X.css'`,
no CSS Modules — and names `.vc-chip` as a globally scoped class. §5a additionally
notes the cross-file coupling and takes the self-contained route (redeclare `.vc-chip`
in the new `AccessProvenance.css`). Terminology is now accurate. ✔

### Pass-3 Finding 3 (NIT) — sentinel/empty-name guard for the `access` fallback — RESOLVED

Verified `src/sailpoint/certifications.ts` line 195: `const fallbackName = summary?.access?.name ?? 'this access'`. The matcher in §3b now treats the sentinel
`'this access'` and any empty/whitespace `accessName` as **non-matching for the `access`
fallback** (`accessName.trim().toLowerCase() === 'this access'` or `accessName.trim() === ''` → skip). §7's `accessName` validation bullet documents the same guard, and §9's
matcher tests pin it (an `access`-fallback item named `"this access"` must not match a
request row literally named `"this access"`). Documented in both §3b and §7 as
required. ✔

---

## Additional verification requested

- **Q4 mechanism is never fabricated.** ✔ `grantMechanism = 'role'` is emitted **only**
  when the reviewed item is itself a role (`item.accessKind === 'role'`, §3c step 1).
  History is **never** used to emit `role` — §2 locks this as a known limitation because
  `2.1.28` carries no field encoding "entitlement arrived via a role"
  (`CorrelatedGovernanceEventTypeEnum` is exactly `certification|accessRequest`, and
  `AccessRequestResponse2` has only `requesterId?`/`requesterName?`/`items?` — both
  re-verified in `node_modules`). §3c step 3 is request-vs-direct only, driven by the
  `hasRequestSignal` predicate; `direct` and `unknown` are honest, distinct outcomes.
- **Per-identity cache is fetch-once (no N-per-item).** ✔ §3a uses a
  `Map<string, Promise<RawIdentityProvenance>>` and `forIdentity` returns the cached
  promise if present. §4 groups items by `identityId` and calls `forIdentity` once per
  identity. §9 asserts "one call per identity" and "no per-item fan-out."
- **Experimental header path for `IdentityHistoryApi`.** ✔ Verified in
  `dist/identity_history/api.js`: `getHistoricalIdentityEventsV1` defaults
  `xSailPointExperimental` to `'true'` when undefined and always writes
  `localVarHeaderParameter['X-SailPoint-Experimental']` when non-null. Passing the
  `xSailPointExperimental: 'true'` request param alone guarantees the header, exactly
  as §3a and the Evidence section state.
- **400/403 degrade honestly.** ✔ §3a/§6: a history 400 (experimental header rejected)
  or 403 (scope) sets `events: null`, `historyUnavailable: true`, item stays `ready`;
  a request-fetch 401/403 yields `requests: []`, item stays `ready` as `direct`/`unknown`.
  The single `unavailable` rule (§4/§6) is reserved for missing `identityId` or a hard
  request failure (429/5xx/network via `requestsFailedHard`).
- **Accessibility patterns specified.** ✔ Disclosure uses `aria-expanded`/`aria-controls`
  with a `useId()` panel id (mirrors `WhyThisOrder`, verified in source); the badge
  container carries `aria-live="polite"` as a stated requirement (§5a + Accessibility
  invariants); mechanism conveyed by text, not color alone; loading placeholder reserves
  equal height to avoid layout/focus shift.
- **Scope stays strictly Q4/Q5 Option A.** ✔ Q1/Q2(standalone)/Q3 explicitly out of
  scope; Q2 grant date only as an incidental history detail; `IdentitiesApi` deliberately
  NOT added; no manifest/`vite.config.ts`/handshake change; `useReviewItems` decision
  logic untouched.

---

## Findings

None. No HIGH, MEDIUM, or NIT findings on this pass.

---

## Verified Assumptions (checked against source / client this pass)

1. **Client version** — `node_modules/sailpoint-api-client/package.json` → `2.1.28`. ✔
2. **Root exports** — `dist/index.d.ts` line **119** `AccessRequestsApi`, line **162**
   `IdentityHistoryApi`. Design's citations are exact. ✔
3. **`CampaignRoute` has no `key`** — confirmed in `src/CertApp.tsx`; a campaign switch
   re-renders rather than remounts, which is precisely why the §4 explicit-reset effect
   (not unmount) is required and correct. ✔
4. **`CampaignRoute` destructures `{ certificationsApi, searchApi }`** — confirmed
   (`src/CertApp.tsx`); extending it with the two new clients is a minimal, accurate
   change. ✔
5. **`describeAccess` sentinel** — `src/sailpoint/certifications.ts` line 195 sets the
   `access`-fallback name to `summary?.access?.name ?? 'this access'`, confirming the
   §3b/§7 sentinel guard targets a real value. ✔
6. **`useReviewItems` `.map()` preserves ids** — `applyDecision`/`applyReassign`/
   `revertDecision` each `.map()` a new array matched on `item.id === itemId`, flipping
   only `completed`/`decision`/`reassigned`/`comments`. The §4 `idSig` guard genuinely
   prevents re-runs on decisions. ✔
7. **`WhyThisOrder` disclosure pattern** — `useId()`, `<button aria-expanded aria-controls>`
   confirmed in source; `AccessProvenance` mirrors it. ✔
8. **Experimental-header auto-apply** — `dist/identity_history/api.js`
   `getHistoricalIdentityEventsV1` defaults `xSailPointExperimental` to `'true'` and
   always sets `X-SailPoint-Experimental`. ✔
9. **`listAccessRequestStatusV1` class method** — `dist/access_requests/api.d.ts` line
   **3512** returns `Promise<AxiosResponse<RequestedItemStatus[]>>` (await + read
   `res.data`). ✔
10. **`requestedFor` is a single `string`** on
    `AccessRequestsApiListAccessRequestStatusV1Request` (confirmed `readonly requestedFor?: string` in the status-list param interface; the `Array<string>` form belongs to the
    create-request DTO). ✔
11. **Status `filters`/`requestState`** — the param interface exposes `filters?` and
    `requestState?` as the design describes; no server-side access-id filter ⇒ client-side
    name+type match justified. ✔
12. **Event DTO shape** (`GetHistoricalIdentityEventsV1200ResponseInner`): `eventType?`
    optional (1083), `dateTime?` optional (1089), `accessItem` **required** (1101, no `?`),
    `governanceEvent: CorrelatedGovernanceEvent | null` **required-but-nullable** (1107),
    `accessItemType?` optional (1113), `accessRequest: AccessRequestResponse2` **required**
    (1125). Design's guard rules match exactly. ✔
13. **`AccessRequestResponse2`** — only `requesterId?`/`requesterName?`/`items?` optional,
    so a naive `if (event.accessRequest)` is always true; the `hasRequestSignal` sub-field
    predicate is necessary and correct. ✔
14. **`CorrelatedGovernanceEventTypeEnum`** = `certification` | `accessRequest` (only two) —
    confirming history can distinguish request-vs-direct but cannot encode "via role." ✔
15. **`AccessItemAssociatedAccessItem.displayName?`** optional — guard `displayName`, not
    the required `accessItem` parent, as the design states. ✔
16. **`ManualWorkItemState`** = `PENDING|APPROVED|REJECTED|EXPIRED|CANCELLED|ARCHIVED`
    (all six) — mapper's explicit six-way mapping (last three → `unknown`) is complete. ✔
17. **`RequestedItemStatusTypeEnum`** = `ACCESS_PROFILE|ROLE|ENTITLEMENT`;
    `RequestedItemStatus.type` is `… | null` (2157), matching the §3b null-type handling. ✔
18. **History `accessItemType` enum** = `account|app|entitlement|role|accessProfile`, so
    the `['entitlement','role','accessProfile']` tokens are valid members. ✔
19. **`CertificationIdentitySummary.identityId?: string`** — line 256; the join key
    `toReviewItemVM` will read is present, and `?? ''` fallback drives the `unavailable`
    rule honestly. ✔
20. **Scope discipline** — Q4/Q5 only; Q1/Q2/Q3 excluded; no `IdentitiesApi`; no manifest/
    `vite.config.ts`/handshake change; `useReviewItems` decision logic untouched. ✔

## Unverified / Wrong Assumptions

No wrong assumptions remain. The two items below are genuinely tenant/runtime dependent,
are acknowledged by the design, and are handled by safe degradation — they are not
findings.

1. **UNVERIFIABLE (acknowledged, acceptable) — history `eventType` literal for
   "access added."** `eventType` is a bare `string`, not enum-pinned, so the exact value
   cannot be confirmed from the type definitions. The design correctly does **not** make
   the matcher depend on the literal — it matches on `accessItem.displayName` +
   `accessItemType` and reads `governanceEvent`, passing `eventTypes: ['AccessAddedEvent']`
   only as a hint and instructing the implementer to drop it if testing shows empty
   results. History is a non-load-bearing enhancement. No change required.
2. **UNVERIFIABLE (tenant-data dependent, acceptable) — whether every tenant populates
   `governanceEvent`/`accessRequest` unambiguously per grant.** The fields are typed and
   present by contract; population per grant is a runtime concern. The mapper degrades to
   `direct`/`unknown` when ambiguous, which is the correct conservative behavior and is
   consistent with the "no fabricated mechanism" invariant. No change required.
