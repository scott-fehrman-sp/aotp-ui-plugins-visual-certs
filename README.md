# Access Review — SailPoint ISC UI Plugin

A full-page [SailPoint Identity Security Cloud (ISC) UI plugin](https://developer.sailpoint.com/docs/ui-plugins)
that turns an access **certification campaign** into a guided, visual workflow a
non-technical manager can finish with confidence.

Instead of the default spreadsheet-style certification screen, this plugin:

- **Tells you where to start.** It opens on a visual dashboard and puts the
  items most worth your attention first, with a clear "Review this first"
  marker.
- **Shows, not tells.** Progress, decisions, priority, and time left are
  presented as charts; a plain table exists only as an optional drill-down.
- **Tracks progress live.** Reviewed vs. remaining, kept vs. removed, and time
  against the deadline update instantly as you decide.
- **Makes decisions plain.** You "Keep access" or "Remove access" (not
  "approve/revoke"), each with a plain-language confirmation and a reason you
  can pick from a dropdown or type yourself.
- **Avoids jargon.** Where a SailPoint term is unavoidable, it's explained
  inline.

---

## Table of contents

- [How it works](#how-it-works)
- [The priority ("what to review first") model](#the-priority-what-to-review-first-model)
- [Charting library](#charting-library)
- [Project layout](#project-layout)
- [Prerequisites](#prerequisites)
- [Local development](#local-development)
- [Build and deploy to a tenant](#build-and-deploy-to-a-tenant)
- [API scopes](#api-scopes)
- [Testing](#testing)
- [What the docs confirm vs. what we derived](#what-the-docs-confirm-vs-what-we-derived)

---

## How it works

When ISC mounts the plugin, the
[`@sailpoint/ui-plugin-sdk`](https://www.npmjs.com/package/@sailpoint/ui-plugin-sdk)
completes an iframe handshake with the ISC "App Shell" and:

1. Resolves the signed-in user and tenant via `sdk.getContext()`.
2. Registers `window.sailpointConfig()`, which returns a fresh
   `{ baseurl, accessToken }` on demand.

The plugin then calls `Configuration.autoconfigure()` from
[`sailpoint-api-client`](https://www.npmjs.com/package/sailpoint-api-client),
which reads that provider and re-reads the token on every request — so **the
plugin never handles tokens itself** and every API call runs with the signed-in
reviewer's session, honoring ISC's security model.

All certification data and decisions go through the documented certification
APIs via the typed client:

| What | API method | Purpose |
| --- | --- | --- |
| Your campaigns | `CertificationsApi.listIdentityCertificationsV1({ reviewerIdentity: 'me' })` | The reviews assigned to you |
| One campaign | `getIdentityCertificationV1({ id })` | Live progress (decisions made/total, due date, phase) |
| Items to review | `listIdentityAccessReviewItemsV1({ id })` | Each person + the access they hold |
| Keep / remove | `makeIdentityDecisionV1({ id, reviewDecision })` | `APPROVE` = keep, `REVOKE` = remove |
| Finish | `signOffIdentityCertificationV1({ id })` | Finalizes decisions and starts the actual access changes |

The user flow is: **pick a campaign** (skipped if you only have one) → **visual
dashboard** → **prioritized review queue** → **keep/remove decisions** →
**sign-off**.

## The priority ("what to review first") model

The access-review-items API cannot sort by risk, and ISC does **not** expose a
single numeric identity-level risk score on these items. To still give a clear
starting point, the plugin computes a transparent 0–100 "attention score" from
the risk signals that *are* present on each item, then shows the user, in plain
language, exactly why each item ranked where it did.

The weighting lives in one documented place — `src/domain/priority.ts` — and is
surfaced to the user through the **"Why this order?"** panel so the ordering is
trustworthy and easy to adjust:

| Signal | Why it matters | Weight |
| --- | --- | --- |
| Flagged by SailPoint AI | The platform itself suggests removing the access | 40 |
| Reaches sensitive data (DAS impact HIGH) | Can touch regulated/sensitive data | 25 (14 medium / 6 low) |
| Elevated / admin ("privileged") access | Powerful rights deserve scrutiny | 20 |
| New since last review | No one has confirmed it yet | 12 |
| Rarely used (0 recorded usage days) | Classic removal candidate | 8 |
| Cloud-governed | Mild nudge | 5 |

If an item has **no** signals it scores 0; when an entire campaign has no
signals the queue falls back to a stable alphabetical order (by person, then
access) and the UI says so. Already-decided items sink to the bottom so
outstanding work is always on top.

## Charting library

**[Recharts](https://recharts.org/) (v2).** It renders charts as declarative
React SVG components with no `<canvas>`, global singletons, or direct DOM
assumptions, which makes it a safe fit for the sandboxed plugin iframe. It's
lightweight, produces accessible SVG, and covers the donut / bar / gauge visuals
this plugin needs. Every chart is paired with a visually-hidden text summary so
the information is available to screen readers, not just sighted users.

## Project layout

```
src/
  main.tsx                  App entry; mounts <App/> inside an error boundary
  App.tsx                   Connects to ISC, then renders the connected app
  CertApp.tsx               Routing: picker ↔ dashboard ↔ review ↔ sign-off
  sailpoint/
    sdkClient.ts            SDK handshake + api-client autoconfigure
    certifications.ts       Typed API wrappers + friendly error mapping
    types.ts                View-model types (decoupled from raw DTOs)
  domain/
    priority.ts             Attention-score weights, scoring, reasons (commented)
    metrics.ts              Progress %, kept/removed, time-to-deadline
    language.ts             Jargon → plain language + canned decision comments
  components/               Reusable UI (states, charts, cards, dialog, table)
  views/                    CampaignPicker, CampaignDashboard, ReviewView, SignOffView
  state/                    Data hooks (useCampaigns, useCampaign, useReviewItems, useDecisions)
```

## Prerequisites

- **Node.js 22+** and npm.
- The **SailPoint CLI** (`sail`) with the `ui-plugins` command group, logged in
  to your tenant. See
  [Create a plugin instance](https://developer.sailpoint.com/docs/ui-plugins).
- A tenant where you can register and deploy a UI plugin, and an account that is
  a **reviewer on at least one certification** (or a Certification Admin) so
  there's data to see.

## Local development

```bash
npm install            # install dependencies
npm run start          # start the dev server on port 4200
sail ui-plugins link   # tell ISC to load your local code (uses build.port = 4200)
```

`sail ui-plugins link` prints a developer URL of the form
`https://<tenant>/ui/plugin/<plugin-instance-id>?spPluginDev=visual-certs`. Open
it to run your local build live inside ISC with a local-dev badge. (You must
register the instance once first — see below — before linking.)

When you're done: `sail ui-plugins unlink`.

## Build and deploy to a tenant

```bash
npm run build          # type-check + bundle to ./dist
sail ui-plugins create # register the plugin instance in your tenant (first time only)
sail ui-plugins upload # deploy ./dist as the active asset bundle
```

- `create` reads `sp-ui-plugin.json` and registers the `visual-certs` alias in
  whichever tenant your CLI is authenticated against.
- `build` runs `tsc -b && vite build`; the output goes to `./dist`
  (`build.outDir` in the manifest).
- `upload` deploys the already-built assets; it does **not** build for you, so
  run `npm run build` first. The most recent upload becomes the active bundle.

The plugin occupies the `full-page` slot declared in `sp-ui-plugin.json`.

## API scopes

`sp-ui-plugin.json` declares:

```json
"apiScopes": ["sp:scopes:all"]
```

This is the value shown in the
[CLI command / manifest reference](https://developer.sailpoint.com/docs/ui-plugins/cli-command-reference/).
`sp:scopes:all` grants the plugin access to the APIs the **signed-in user's
level already allows** — it does not widen a user's permissions. A manager only
ever sees and decides the certifications they're authorized to review; a
Certification Admin sees the certification APIs their level covers.

> **Note on granular scopes.** SailPoint has not published a definitive,
> per-endpoint certification scope string (for example an `idn:certification-*`
> family) in the referenced documentation, and community guidance indicates
> fine-grained API scopes are still being rolled out. Rather than invent one,
> this plugin uses the documented `sp:scopes:all` value and relies on ISC's
> user-level authorization. If/when your tenant documents narrower certification
> scopes, tighten this array to the least privilege your reviewers need.

## Testing

```bash
npm test        # run the unit + component + end-to-end-flow tests once
npm run test:watch
npm run lint
```

Tests use [Vitest](https://vitest.dev/) + React Testing Library and the plugin
SDK's built-in mock App Shell (`@sailpoint/ui-plugin-sdk/testing`), so the full
flow — connect → pick → dashboard → prioritized review → keep/remove → sign-off
— is exercised without a live tenant.

## What the docs confirm vs. what we derived

**Confirmed from the official SDK/docs and used as-is:**

- The handshake + `window.sailpointConfig()` auth model, and
  `Configuration.autoconfigure()` — from the `@sailpoint/ui-plugin-sdk` and
  `sailpoint-api-client` packages.
- The certification endpoints, request shapes, and the `APPROVE`/`REVOKE`
  decision enum, the `mandatoryCommentRequirement` setting, and the
  progress/phase fields — from the generated `sailpoint-api-client` types.
- The manifest shape and `sp:scopes:all` — from the UI-plugins CLI/manifest
  reference.

**Derived by this plugin (and documented in code):**

- The **priority / attention score**. ISC does not expose a single risk score on
  certification items, so the score is a transparent composite of the signals
  that are present (see
  [the priority model](#the-priority-what-to-review-first-model) and
  `src/domain/priority.ts`), with an alphabetical fallback when no signals exist.
- All **plain-language labels and canned comments** (`src/domain/language.ts`),
  chosen for a non-technical audience.

If an API detail isn't confirmed by the referenced documentation, the plugin
implements the closest documented alternative rather than guessing — and this
section calls out where that applies.
