# Access Expansion Matrix — Technical Design

## Overview

This feature adds an **Access Expansion Matrix** to the Visual Certifications
plugin: a normalized, sortable table that shows every path from a user in a
certification campaign down to the leaf **entitlement** they effectively hold
and the **source** that entitlement lives on. A single reviewed access can be an
entitlement (already a leaf), an access profile (expands into one row per
entitlement), or a role (expands into one row per leaf reachable through the
role — via its access profiles and/or its directly-attached entitlements). Each
distinct `(user, role, accessProfile, entitlement, source)` tuple is exactly one
row.

The task delivers **two** things and explicitly **excludes** a third:

1. **The sortable matrix view** (`AccessMatrixView.tsx` + `.css` + `.test.tsx`),
   reachable from the campaign dashboard, backed by a new data layer
   (`accessMatrix.ts`), a composition resolver that mirrors `provenance.ts`, and
   a `useAccessMatrix` hook that mirrors `useProvenance`.
2. **A pure, exported, documented `matrix → graph` derivation function**
   (`deriveAccessGraph` in `src/domain/accessGraph.ts`) with unit tests. It turns
   the matrix rows into `{ nodes, edges }` suitable for a future bidirectional
   (users ↔ sources) graph renderer.
3. **NOT in scope for this task:** a visual graph renderer (SVG/canvas/force
   layout). `deriveAccessGraph` produces the graph *data model* only; drawing it
   is a separate future task. This split is confirmed in
   [Scope](#scope-confirmation-open-question-3) below.

The stack is **locked**: React 19 + TypeScript + Vite, Vitest + React Testing
Library, Node 22+. No new runtime dependencies. `npm run lint`, `tsc -b`, and
`npm run build` must stay green; `npm test` gets new suites.

---

## Technology stack (locked)

- **Language/runtime:** TypeScript, React 19 function components + hooks, Vite
  bundler, Node 22+.
- **API client:** `sailpoint-api-client ^2.1.28`. Import **API classes** from the
  package root (matching `sdkClient.ts`, which imports `CertificationsApi` etc.
  from `'sailpoint-api-client'`) and import **model/DTO types** from the module
  subpaths (matching `certifications.ts`, which imports from
  `'sailpoint-api-client/certifications/api'`).
- **Tests:** Vitest + RTL, co-located `*.test.ts(x)` beside the unit under test
  (matches `src/domain/*.test.ts` for pure modules and `src/views/*.test.tsx`
  for screens).
- **Styling:** plain CSS files with `vc-`-prefixed class names, co-located beside
  the component. No CSS-in-JS.
- **No new npm packages** and **no manifest/scope change** — the manifest already
  declares `sp:scopes:all`, which covers roles/access-profiles/entitlements read.

---

## Data model (view-model types — add to `src/sailpoint/types.ts`)

All new types live in `src/sailpoint/types.ts` with the heavy JSDoc style already
present, decoupled from generated DTOs. Components import these from
`../sailpoint/types`; they never import a type out of a `state/` hook.

```ts
/**
 * One fully-expanded row of the access matrix: a single path from a user to a
 * leaf entitlement on a source. Blank (empty-string) role/accessProfile cells
 * mean that level is NOT on this path (see the expansion rules). `entitlement`
 * and `source` are always populated on a real leaf row; `unresolved` marks a
 * row whose leaf detail could not be fetched (soft degrade).
 */
export interface AccessMatrixRowVM {
  /** Stable, deterministic row id = hash/join of the five tuple fields + ids. */
  id: string
  /** Identity id of the user (join key; same source as ReviewItemVM.identityId). */
  userId: string
  /** Display name of the user. */
  user: string
  /** Role display name, or '' when a role is not on this path. */
  role: string
  /** Role id when a role is on the path, else null (used for graph node ids). */
  roleId: string | null
  /** Access-profile display name, or '' when an AP is not on this path. */
  accessProfile: string
  /** Access-profile id when an AP is on the path, else null. */
  accessProfileId: string | null
  /**
   * Leaf entitlement display name. Populated on a real leaf row; '' only on an
   * `unresolved` row — and blank specifically on the degenerate `access`-kind
   * row (which has no leaf at all; see the mapper's `access` fallback).
   */
  entitlement: string
  /** Entitlement id, or null when unresolved. */
  entitlementId: string | null
  /**
   * Source display name the entitlement lives on. Populated on a real leaf row;
   * '' when unresolved/unknown (always '' on the degenerate `access`-kind row).
   */
  source: string
  /** Source id when known, else null. */
  sourceId: string | null
  /**
   * True when some level on this path could not be resolved (missing permission
   * or fetch failure). The row still renders with an 'Unresolved' marker in the
   * blank cells rather than being dropped — mirrors provenance soft-degrade.
   */
  unresolved: boolean
}

/** The kind of a graph node — the five node layers of the matrix. */
export type AccessGraphNodeKind =
  | 'user'
  | 'role'
  | 'accessProfile'
  | 'entitlement'
  | 'source'

/**
 * A node in the access graph derived from the matrix. `id` is namespaced by
 * kind (e.g. `user:<identityId>`) so the same display name never collides
 * across layers or with another layer's id space.
 */
export interface AccessGraphNode {
  /** Namespaced, unique node id, e.g. 'role:<roleId>' or 'source:<name>'. */
  id: string
  /** Which layer this node belongs to. */
  kind: AccessGraphNodeKind
  /** Human-readable label (the display name). */
  label: string
}

/**
 * A directed edge along a path, parent → child, with blank levels skipped
 * (e.g. a direct entitlement yields user→entitlement→source, no role/AP hop).
 * Edges are deduped; `pathCount` records how many matrix rows traverse this
 * same edge, so a future renderer can weight it.
 */
export interface AccessGraphEdge {
  /** Source (parent) node id. */
  from: string
  /** Target (child) node id. */
  to: string
  /** Number of matrix rows that traverse this exact edge (>= 1). */
  pathCount: number
}

/**
 * The derived graph: deduped nodes + deduped directed edges. Direction is
 * user → … → source. The renderer can walk it from users (follow `from→to`) or
 * from sources (follow `to→from`); it is bidirectional-traversal-ready without
 * storing reverse edges (see deriveAccessGraph docs).
 */
export interface AccessGraphData {
  nodes: AccessGraphNode[]
  edges: AccessGraphEdge[]
}
```

**Why ids as well as names:** the user's example and the sort/display are by
*name*, but graph nodes must dedupe by *identity*, not label (two entitlements
named "read" on different sources are different nodes). Carrying both the
display string (for the table and labels) and the id (for node identity and
dedup) in the row keeps `deriveAccessGraph` a pure, lossless transform of the
rows and avoids a second fetch. When an id is unknown (unresolved), the graph
derivation falls back to a `kind:name:parentContext` synthetic id so the row
still contributes a stable node — documented in the function.

---

## Expansion rules and the worked example

### Rules (restated precisely)

- **Entitlement access** → exactly **one** leaf row: `role=''`, `accessProfile=''`,
  `entitlement`+`source` populated.
- **Access-profile access** → **one row per entitlement** in the AP: `role=''`,
  `accessProfile=<AP name>`, `entitlement`+`source` populated. The source is the
  **entitlement's own source**, resolved per leaf (not the AP's `source` ref) —
  see [Source resolution](#source-the-leaf-entitlements-source).
- **Role access** → **one row per leaf** reachable through the role:
  - for each access profile on the role: one row per entitlement in that AP, with
    `role=<role name>`, `accessProfile=<AP name>`;
  - for each **directly-attached** entitlement on the role: one row with
    `role=<role name>`, `accessProfile=''`.
  - Total rows = (Σ over the role's APs of that AP's entitlement count) + (count
    of the role's direct entitlements).

### Worked example → exactly 6 rows (drives the acceptance tests)

Fixture: **User One** holds three reviewed accesses —
1. **Role A**, composed as: AP **`foo`** containing 2 entitlements `read` and
   `write` (both on **engr db**), **plus** 1 **directly-attached** entitlement
   `delete` (on **engr db**).  → `2 + 1 = 3` rows.
2. AP **`bar`** containing 2 entitlements `read` and `search` (both on
   **accounting db**). → `2` rows.
3. A **direct entitlement** `read` on **phone app**. → `1` row.

Total = `3 + 2 + 1 = 6` rows:

| user     | role   | accessProfile | entitlement | source        |
|----------|--------|---------------|-------------|---------------|
| User One | Role A | foo           | read        | engr db       |
| User One | Role A | foo           | write       | engr db       |
| User One | Role A |               | delete      | engr db       |
| User One |        | bar           | read        | accounting db |
| User One |        | bar           | search      | accounting db |
| User One |        |               | read        | phone app     |

> **Fixture note (corrects the spec's internally inconsistent first rows).** The
> task spec's worked example rendered the AP cell **blank** on the `read` row and
> filled (`foo`) only on the `write` row, while also stating AP `foo` holds 2
> entitlements. Those two statements contradict each other: a `read` row with
> `role=Role A` and a **blank** AP cell means `read` is a *role-direct*
> entitlement, which is incompatible with `foo = {read, write}` and with `delete`
> being the sole direct entitlement. This design **corrects** that inconsistency
> rather than reproducing it. Role A's composition is fixed as: **AP `foo` =
> {read, write}**, so **BOTH** the `read` and `write` rows carry
> `accessProfile='foo'` (the two rows differ only by `entitlement`); and the
> role's single **direct entitlement = {delete}**, so the `delete` row has
> `accessProfile=''`. This is the only reading of "AP `foo` has 2 entitlements"
> that satisfies the design's own role-expansion rule ("for each AP on the role:
> one row per entitlement in that AP, with `accessProfile=<AP name>`"). The row
> **count (6)** and overall shape (one AP with 2 ents + 1 direct ent on the role;
> a second standalone AP `bar` with 2 ents; one direct ent on `phone app`) are
> faithful to the user's example. **The table above is the single golden fixture;
> the acceptance tests in `accessGraph.test.ts`, `accessMatrixSort.test.ts`, and
> `accessMatrix.test.ts` all assert this exact shape — both `foo` rows filled,
> `delete` row blank.**

The test fixture is built from **stubbed resolver outputs** (plain objects), not
live API calls, so it is deterministic and documents the composition explicitly.

---

## Dedup / normalization (open question 1 — decided)

**Decision: one row per distinct `(userId, roleId, accessProfileId,
entitlementId, sourceId)` tuple. Distinct paths are distinct rows; identical
tuples collapse to one.**

- Reaching the same leaf entitlement on the same source **via two different
  paths** (e.g. once through Role A → AP foo, once as a direct AP grant) yields
  **two rows**, because the `(roleId, accessProfileId)` prefix differs — this is
  what the user's example implies ("show all the paths").
- Reaching the *same leaf through the exact same path twice* (e.g. the same role
  resolved for the same user from two review items, or an entitlement that
  appears in a role both directly and would otherwise duplicate) collapses to
  **one** row via a `Map` keyed on the five-id tuple.
- Dedup key uses **ids**, not display names, so two different entitlements that
  happen to share a name are never merged. When an id is missing (unresolved
  leaf), the key falls back to the display name for that slot so unresolved rows
  still dedup sensibly rather than multiplying.

This normalization happens in the pure mapper `buildMatrixRows` (below), before
sorting and before graph derivation, so both the table and the graph see the
same canonical row set.

---

## Blank-cell sort order (open question 2 — decided)

**Decision: blank (`''`) role/accessProfile cells sort as an empty string, which
in ascending order places them FIRST (before any populated value), and in
descending order places them LAST. Comparison is case-insensitive,
locale-aware (`localeCompare` with `{ sensitivity: 'base' }`), applied uniformly
to every column.**

Rationale: treating blank as empty-string is the least surprising, needs no
special-casing branch, and stays consistent across all five sortable columns. It
also keeps the sort a pure, total ordering (a stable tiebreak chain avoids
flaky ordering of equal keys). The visually-hidden table caption states the
convention so screen-reader users understand where blanks land.

**Tiebreak chain (stable, deterministic):** when the active sort column compares
equal, fall back in fixed order `user → role → accessProfile → entitlement →
source`, then finally the row `id`, so the ordering is total and reproducible
regardless of input order. Implemented as a pure `compareRows(column, direction)`
comparator in `src/domain/accessMatrixSort.ts` with its own unit tests.

---

## Scope confirmation (open question 3 — confirmed)

This task ships **(a)** the sortable matrix view and **(b)** the pure
`deriveAccessGraph` function + unit tests. It does **NOT** ship a visual graph
renderer. `deriveAccessGraph` returns `AccessGraphData` (nodes/edges) only. A
later task will consume that data model to draw the graph (users-first or
sources-first). The design keeps the graph model renderer-agnostic and
traversal-ready in both directions so that future task needs no changes here.

---

## Architecture & layering

The feature follows the existing four-layer shape exactly:

```
sdkClient.ts        → add RolesApi, AccessProfilesApi, EntitlementsApi to PluginRuntime
   │
accessMatrix.ts     → data layer: composition RESOLVER (fetch-once + cache, mirrors
   │                   provenance.ts) + pure MAPPER buildMatrixRows (DTO-free output)
   │
domain/
  accessGraph.ts    → PURE deriveAccessGraph(rows) → AccessGraphData  (+ unit tests)
  accessMatrixSort.ts → PURE compareRows / sortRows                   (+ unit tests)
   │
state/useAccessMatrix.ts → hook: { status, rows, graph, error }, mirrors useProvenance
   │
views/AccessMatrixView.tsx (+ .css + .test.tsx) → sortable table UI
   │
CertApp.tsx         → add a 'matrix' campaign step reached from the dashboard
```

### 1. `sdkClient.ts` — add three API clients

Add to `PluginRuntime`, constructed from the **same autoconfigured
`Configuration`**, following the exact pattern used for `accessRequestsApi` /
`identityHistoryApi`:

```ts
import {
  AccessProfilesApi,
  // …existing imports…
  EntitlementsApi,
  RolesApi,
} from 'sailpoint-api-client'

export interface PluginRuntime {
  // …existing fields…
  /** Resolves a role's composition (access profiles + direct entitlements). */
  rolesApi: RolesApi
  /** Resolves an access profile's entitlements + its source. */
  accessProfilesApi: AccessProfilesApi
  /** Resolves a leaf entitlement's SOURCE (the matrix 'source' column). */
  entitlementsApi: EntitlementsApi
}
```

In `initPlugin`, after the existing clients:

```ts
const rolesApi = new RolesApi(configuration)
const accessProfilesApi = new AccessProfilesApi(configuration)
const entitlementsApi = new EntitlementsApi(configuration)
// …add to the returned object…
```

No other change to `sdkClient.ts`. Tests that build a runtime stub add three
mock clients; the view/hook tests inject these as plain mocks.

### 2. `accessMatrix.ts` — data layer (resolver + mapper)

New file `src/sailpoint/accessMatrix.ts`. It has two halves, mirroring
`provenance.ts`: an impure **resolver** (network + per-id promise cache +
soft-degrade) and a pure **mapper**. It reuses `toFriendlyError` / `FriendlyError`
from `certifications.ts`; it invents **no** new error handling.

#### 2a. Which role API to use (API fact — decided)

**Decision: use `getRoleV1({ id })` and read `role.accessProfiles` (shallow
`AccessProfileRef[]`) + `role.entitlements` (shallow `EntitlementRef[]`). Do NOT
use `getRoleEntitlementsV1`.**

Confirmed by reading the generated `.d.ts`:
- `Role.accessProfiles?: AccessProfileRef[] | null` and
  `Role.entitlements?: EntitlementRef[]` — this **preserves the path structure**
  the matrix needs: we can tell which entitlements come through an AP vs. are
  attached directly to the role, which is exactly the `role` vs. `role+AP` row
  distinction.
- `getRoleEntitlementsV1` returns a **flattened** entitlement set that **loses**
  the AP-vs-direct distinction, so it cannot produce the correct blank/populated
  AP cells. Rejected.

Confirmed ref shapes (from the `.d.ts`, do not re-investigate):
- `AccessProfileRef` = `{ id?, type?, name? }` — **shallow**, no source, no
  entitlements. → an AP on a role must be re-fetched with `getAccessProfileV1`.
- `EntitlementRef` = `{ type?, id?, name?|null }` — **shallow**, **no source**. →
  every leaf entitlement must be re-fetched with `getEntitlementV1` to get its
  source.

#### 2b. Source — the leaf entitlement's source (API fact — decided)

**Decision: the matrix `source` value = the entitlement's own source name,
resolved via `getEntitlementV1({ id })`, which returns `EntitlementV2` with
`source?: EntitlementV2Source` = `{ id?, type?, name? }`.** We use
`source.name` for the column and `source.id` for the graph node id.

We deliberately do **not** use `AccessProfile.source` as the matrix source: the
spec says the source column is "the SOURCE THE ENTITLEMENT LIVES ON." For an AP
whose entitlements all live on the AP's source these coincide, but resolving per
leaf is correct in all cases and uniform across the three access kinds. (The
`EntitlementRef` inside an AP/role body carries no source, confirming the
re-fetch is required.)

#### 2c. The resolver (mirrors `createProvenanceResolver`)

```ts
export interface AccessCompositionResolver {
  /** Role body (access profiles + direct entitlements). null = soft-degraded. */
  role(id: string): Promise<ResolvedRole | null>
  /** AP body (entitlement refs + source). null = soft-degraded. */
  accessProfile(id: string): Promise<ResolvedAccessProfile | null>
  /** Entitlement body (name + source). null = soft-degraded. */
  entitlement(id: string): Promise<ResolvedEntitlement | null>
}
```

- **Three independent `Map<string, Promise<…>>` caches**, one per id space (role
  id, AP id, entitlement id), exactly like provenance's per-identity map:
  concurrent lookups for the same id dedupe to a single round-trip, and every id
  is fetched **at most once** regardless of how many users hold it (open question
  4). The cache lives for the resolver's lifetime; the hook recreates the
  resolver on campaign change (same lifecycle as `useProvenance`).
- Each fetch is wrapped in `try/catch`. **Soft-degrade on any failure: return
  `null`** (not throw). This is the provenance philosophy — a per-id failure
  never sinks the whole matrix. `toFriendlyError(error).status` classifies, but
  for the matrix every failure (401/403 lack-of-permission **and** 429/5xx/
  network) degrades that id to `null`; the row is marked `unresolved` rather than
  the matrix failing. Rationale: unlike provenance's `requestsFailedHard` signal
  (which drives a per-item `unavailable`), the matrix is an all-or-nothing table
  where one bad role should not blank the screen; honest partial data is more
  useful. The hook surfaces a non-fatal banner count of unresolved rows (below).
- `ResolvedRole`/`ResolvedAccessProfile`/`ResolvedEntitlement` are **internal**
  DTO-free shapes (not exported to components) carrying exactly `{ id, name,
  accessProfileRefs, entitlementRefs }` / `{ id, name, entitlementRefs }` /
  `{ id, name, sourceId, sourceName }`.

#### 2d. The mapper `buildMatrixRows` (pure, async orchestration + pure assembly)

Because expansion requires fetching composition, the top-level
`resolveMatrix(items, resolver)` is **async** (it awaits resolver calls), but the
**row-assembly from already-resolved composition is a pure helper** that the unit
tests call directly with stubbed composition — no network. Shape:

```ts
/** Expands review items into canonical, deduped matrix rows. Async: fetches
 *  composition via the resolver (cached). Degrades unresolved leaves to an
 *  `unresolved` row rather than throwing. */
export async function resolveMatrix(
  items: ReviewItemVM[],
  resolver: AccessCompositionResolver,
): Promise<AccessMatrixRowVM[]>
```

Algorithm per review item (keyed off `item.accessKind` + the id from
`item.accessSummary`'s role/accessProfile/entitlement — the entry points
`describeAccess` already surfaces; the resolver needs the **id**, so the mapper
reads the id from the review item's access summary, see note below):

- `entitlement`: resolve the entitlement → one leaf row (`role=''`, `AP=''`).
- `accessProfile`: resolve the AP → for each entitlement ref, resolve that
  entitlement → one row (`role=''`, `AP=ap.name`).
- `role`: resolve the role → (a) for each `accessProfileRef`, resolve the AP,
  then each of its entitlements → row (`role=role.name`, `AP=ap.name`); (b) for
  each direct `entitlementRef`, resolve the entitlement → row
  (`role=role.name`, `AP=''`).
- `access` (the generic fallback kind — a review item whose `accessSummary`
  carries only the generic `access` object, no role/AP/entitlement): produces
  **exactly one** row, fully specified as a degenerate all-blank-leaf:
  `unresolved: true`, `role=''`, `roleId=null`, `accessProfile=''`,
  `accessProfileId=null`, `entitlement=''`, `entitlementId=null`, `source=''`,
  `sourceId=null`, with **only** `user`/`userId` populated from the item.
  Rationale: `describeAccess` reads this kind's name from `summary.access`
  (`AccessSummaryAccess` carries `id?`+`name?`), but the matrix cannot expand it
  — there is no role/AP/entitlement id to resolve against and no leaf to fetch —
  so it degrades honestly rather than fabricating a leaf. We deliberately do
  **not** read `summary.access.id` into `accessId`: an `access` item's id is not
  in the role/AP/entitlement id space, no resolver call would consume it, and
  reading it would only invite a mis-fetch; `accessId` stays `null` for this
  kind. This is the one non-fetch-failure path to an `unresolved` row, and it is
  the only `unresolved` row that also carries a blank `entitlement` **and** a
  blank `source` (a fetch-failure unresolved row still has an entitlement/source
  id from the ref that could not be deep-fetched). The dedup key for this row
  falls back to the five display-name slots (all `''` except the user), so two
  such rows for the same user collapse to one.

Each leaf resolution yields `entitlement`/`entitlementId`/`source`/`sourceId`.
If any required resolver call returns `null`, emit an **`unresolved: true`** row
that still carries whatever is known (user always; role/AP name when the parent
resolved) and leaves the missing slots blank with the dedup-key falling back to
names. Then feed all rows through the dedup `Map` (five-id key) and return.

> **Note on reading the entry-point id.** `describeAccess` in `certifications.ts`
> currently extracts role/AP/entitlement **name** (and sets `accessKind`) but not
> the composition **id**. The matrix needs the id to call the resolver. Decision:
> extend `ReviewItemVM` with an optional **`accessId: string | null`** (the id of
> the role/AP/entitlement under review, from
> `item.accessSummary.{role|accessProfile|entitlement}.id`) and populate it in
> `toReviewItemVM`/`describeAccess`. This is a minimal, backward-compatible
> addition (existing consumers ignore it) and keeps the matrix from re-reading
> raw DTOs. The field is documented in `types.ts`.

### 3. `src/domain/accessGraph.ts` — the pure derivation (CORE DELIVERABLE)

```ts
/**
 * Derives a deduped node/edge graph from the access matrix rows. PURE: no I/O,
 * no mutation of inputs, deterministic output order. Direction is
 * user → (role?) → (accessProfile?) → entitlement → source, with absent
 * (blank) levels SKIPPED so the chain always connects consecutive present
 * levels:
 *   - direct entitlement:        user → entitlement → source
 *   - AP grant:                  user → accessProfile → entitlement → source
 *   - role direct entitlement:   user → role → entitlement → source
 *   - role → AP → entitlement:   user → role → accessProfile → entitlement → source
 *
 * Nodes dedupe by namespaced id (`<kind>:<id-or-name>`). Edges dedupe by
 * (from,to) and accumulate `pathCount`. Reverse traversal (sources → users) is
 * supported by walking edges on `to`; no reverse edges are stored. Unresolved
 * rows contribute only the nodes/edges for the levels that are known.
 *
 * All-blank-leaf case: a degenerate `access`-kind row (user populated;
 * role/accessProfile/entitlement/source all blank, their ids all null)
 * contributes **only the `user` node** and **no edges** — no entitlement or
 * source node is synthesized when both are blank, because there is no leaf to
 * anchor a path. (For every other kind, entitlement and source are
 * conceptually present and always yield nodes, with their ids possibly
 * synthetic on a fetch-failure `unresolved` row.)
 */
export function deriveAccessGraph(rows: AccessMatrixRowVM[]): AccessGraphData
```

Node id scheme (documented in the JSDoc and asserted in tests):
- `user:<userId>`
- `role:<roleId>` (falls back to `role:name:<roleName>` if `roleId` is null)
- `accessProfile:<accessProfileId>` (fallback `accessProfile:name:<apName>`)
- `entitlement:<entitlementId>` (fallback
  `entitlement:name:<sourceId|sourceName>:<entName>` so same-named entitlements on
  different sources stay distinct even without an id)
- `source:<sourceId>` (fallback `source:name:<sourceName>`)

Algorithm: for each row, build the **ordered list of present levels** (drop any
with a blank name/null id in the role/AP slots; user is always present;
entitlement/source are present when non-blank, with their ids possibly synthetic
on a fetch-failure `unresolved` row). The **all-blank-leaf** row (the degenerate
`access`-kind row, where entitlement **and** source are both blank) collapses to
a single present level — the user — so it adds only the `user` node and no edge.
Add each level as a node (deduped by id into a `Map`), then add an edge between
each consecutive pair (deduped by `from|to` into a `Map`, incrementing
`pathCount`); a single-level list contributes no edge. Return nodes and edges as
arrays in **insertion order** (deterministic for a given row order; the row order
is already canonical and sorted upstream, and tests pass a fixed row order).

**Testability:** 100% unit-testable, no mocks. Tests cover: the 6-row worked
example → expected node set (1 user, 1 role, 2 APs `foo`/`bar`, entitlements
`read@engr`, `write@engr`, `delete@engr`, `read@accounting`, `search@accounting`,
`read@phone`, 3 sources) and expected edges including the correct **skips**
(the `delete` role-direct row produces `user→role→entitlement→source` with no AP
hop; the `read@phone` direct row produces `user→entitlement→source`); node dedup
(the single `User One` node, the single `engr db` source shared by three
entitlements); edge `pathCount` accumulation; same-name-different-source
entitlements staying distinct; unresolved-row partial contribution; the
**all-blank-leaf `access`-kind row** → contributes exactly one `user` node and
**zero** edges (no entitlement/source node synthesized); and empty input →
empty graph.

### 4. `src/domain/accessMatrixSort.ts` — pure sort

`compareRows(column, direction)` → a comparator, and `sortRows(rows, column,
direction)` → a new sorted array (never mutates input). Implements the
blank-as-empty-string, case-insensitive, locale-aware ordering with the fixed
tiebreak chain from the sort-order decision. Fully unit-testable; tests assert
blanks-first ascending / blanks-last descending, case-insensitivity, and total
determinism on equal keys.

### 5. `state/useAccessMatrix.ts` — the hook (mirrors `useProvenance`)

```ts
export interface AccessMatrixState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  rows: AccessMatrixRowVM[]
  graph: AccessGraphData
  /** Count of rows that soft-degraded (unresolved), for a non-fatal banner. */
  unresolvedCount: number
  error: string | null
  reload: () => void
}

export function useAccessMatrix(
  rolesApi: RolesApi,
  accessProfilesApi: AccessProfilesApi,
  entitlementsApi: EntitlementsApi,
  campaignId: string,
  items: ReviewItemVM[] | null,
): AccessMatrixState
```

Mirrors `useProvenance` conventions:
- Creates the resolver via a `useRef`, recreated when `campaignId` changes
  (tracked by a `resolverCampaignRef`), so a campaign switch gets a fresh cache
  but a decision-driven `items` rebuild does **not** (keyed on a stable id
  signature `idSig`, not the array reference).
- Runs `resolveMatrix(items, resolver)` in an effect; sets `status:'loading'`
  while awaiting, then `status:'ready'` with `rows` + `graph =
  deriveAccessGraph(rows)` + `unresolvedCount`. A `cancelled` guard drops a
  stale resolution. Because every resolver call soft-degrades, `status:'error'`
  is reserved for a truly fatal condition (e.g. the whole items load failed
  upstream — in practice the view receives `items` already loaded, so error is
  rare); unresolved leaves surface via `unresolvedCount`, not `error`.
- **Loading UX (open question 4 — decided): the matrix view shows a loading
  state while the expansion resolves (unlike provenance, which is a
  non-blocking per-item enhancement).** Rationale: the matrix is the *primary*
  content of its own screen — there is nothing else to show behind it, so a
  single "Building the access map…" loading state is clearer than a half-filled
  table that keeps mutating. Resolution still benefits from the per-id cache and
  concurrent dedupe, so it is as fast as possible; the view just gates its table
  render on `status === 'ready'`. This keeps the view off the critical path of
  the review queue (it is a separate step), satisfying the "never block the main
  flow" spirit while giving the matrix screen a clean single-shot render.

### 6. `views/AccessMatrixView.tsx` (+ `.css` + `.test.tsx`)

A new **sortable** table screen. Props:

```ts
interface AccessMatrixViewProps {
  campaignName: string
  matrix: AccessMatrixState   // from useAccessMatrix (status/rows/graph/…)
  onBack: () => void
}
```

Renders (mirroring `ReviewView`'s structure: a `← Back` link, an
`aria-label`led `<section>`, and self-managed loading/empty/error states via the
shared `LoadingState`/`EmptyState`/`ErrorState` components):
- **Loading:** `<LoadingState message="Building the access map…" />` while
  `status === 'loading'`.
- **Empty:** `<EmptyState>` when ready with zero rows.
- **Unresolved banner:** when `unresolvedCount > 0`, a non-fatal `vc-banner`
  (role="status") like "N access paths couldn't be fully resolved and are marked
  Unresolved" — honest degrade, screen stays usable.
- **Table:** one `<table class="vc-matrix-table">` with a visually-hidden
  `<caption>` summarizing contents **and the blank-sorts-first convention** (the
  accessibility "visually-hidden summary" requirement). Five columns: User, Role,
  Access profile, Entitlement, Source.

#### Accessibility (required)

- Each header cell is `<th scope="col">` containing a real `<button type="button">`
  that toggles sort for that column.
- The active column's `<th>` carries `aria-sort="ascending" | "descending"`;
  inactive columns carry `aria-sort="none"`. Clicking the active column flips
  direction; clicking a new column sorts it ascending.
- Row header: the User cell per row is `<th scope="row">` so each row is
  associated with the person.
- Blank role/AP cells render visually empty but include a visually-hidden "—"/
  "(not applicable)" so screen readers don't read an empty cell ambiguously;
  unresolved cells render a visible "Unresolved" marker.
- The caption states the sort convention (blanks first ascending).

#### Sort interaction

Local component state `{ column, direction }` (default `user`/`ascending`). The
rendered rows are `useMemo(() => sortRows(matrix.rows, column, direction), …)`.
Sorting is pure/client-side (the data is already fully in hand) — no re-fetch.

#### Why a NEW table, not extending `DrillDownTable` (justification required)

I read `DrillDownTable.tsx`. It is a **static, non-sortable** table hard-wired to
`PrioritizedItem[]` (person / access / type / priority / decision columns, with
`priority`-specific rendering and no header interaction, no `aria-sort`, no
`scope="row"`). Its columns, data shape, and purpose (a secondary priority
drill-down of review *items*) do not overlap the matrix's five expanded-path
columns or its sortable-header requirement. Adapting it would mean
parameterizing columns, cell renderers, sort state, keyboard/ARIA sort
semantics, and row-header handling — effectively a different component wearing
the same name, which would also risk regressing its existing consumer
(`ReviewView`). **Decision: build a dedicated `AccessMatrixView` table.** It
reuses the shared `vc-table` **CSS conventions** (`vc-table-wrap` from
`DrillDownTable.css`; `vc-visually-hidden` is a global utility defined in
`charts/charts.css` and available app-wide via Vite's bundled CSS) by adding
matrix-specific classes in `AccessMatrixView.css`, so the visual language stays
consistent without coupling the components.

### 7. `CertApp.tsx` — routing / integration (open question 5 — decided)

**Decision: add a new `'matrix'` step to the existing per-campaign
`CampaignStep` union (`'dashboard' | 'review' | 'signoff'` → add `'matrix'`),
reached by a button on the `CampaignDashboard`. The matrix is a drill-down of a
single campaign, so it belongs inside `CampaignRoute`, not as a new top-level
`Route`.** This keeps the picker↔dashboard↔review↔sign-off flow intact and adds
one sibling view.

Wiring in `CampaignRoute`:
- Call `const matrix = useAccessMatrix(rolesApi, accessProfilesApi,
  entitlementsApi, campaignId, review.items)` next to the existing
  `useProvenance` call (it consumes the same `review.items`, so it piggybacks on
  the already-loaded item list and never triggers a second item fetch).
- Add a `step === 'matrix'` branch rendering
  `<AccessMatrixView campaignName={campaign.name} matrix={matrix}
  onBack={() => setStep('dashboard')} />`.
- `CampaignDashboard` gets a new optional prop `onViewMatrix?: () => void` and
  renders a secondary button ("View access map" / "See all access paths") beside
  the primary CTA; `CampaignRoute` passes `() => setStep('matrix')`. The button
  is additive and does not disturb the existing dashboard layout/tests (new
  optional prop, default undefined → button not rendered when absent).

No change to the top-level `Route` type or the App Shell `subPath` reporting
(the matrix is a transient drill-down within a campaign, consistent with how
`review`/`signoff` steps are not separately deep-linked today).

---

## Error handling (concrete, per operation)

| Operation | Failure conditions | Recoverable? | Caller receives | Logged? |
|---|---|---|---|---|
| `rolesApi.getRoleV1` | 401/403 (no permission), 404 (role gone), 429/5xx, network | **Soft-degrade**: resolver returns `null`; mapper emits an `unresolved` row (user + nothing else known) | `null` from `resolver.role(id)` | No raw DTO logged; nothing surfaced beyond the unresolved marker. Classified via `toFriendlyError` only to decide (currently all → null). |
| `accessProfilesApi.getAccessProfileV1` | same set | Soft-degrade → `null`; mapper emits `unresolved` row carrying the role name (if the role resolved) and blank AP/entitlement | `null` | As above |
| `entitlementsApi.getEntitlementV1` | same set | Soft-degrade → `null`; mapper emits `unresolved` row carrying role/AP names when known, blank entitlement/source | `null` | As above |
| `resolveMatrix` overall | Only throws if given malformed input (defensive); API failures never throw | n/a — returns rows (some possibly `unresolved`) | `AccessMatrixRowVM[]` | n/a |
| `useAccessMatrix` effect | A thrown error from `resolveMatrix` (not expected in normal operation) | Caller can `reload()` | `status:'error'`, `error:` friendly message via `toFriendlyError` | No |
| View render | `status:'error'` → `<ErrorState onRetry={matrix.reload}>`; `unresolvedCount>0` → non-fatal banner | Yes (retry) | friendly text | No |

**Degrade shape (decided):** an unresolved leaf becomes a row with
`unresolved:true`, the known names filled, the unknown slots `''`/`null`, and the
UI renders a visible "Unresolved" marker in the affected cells plus the
aggregate banner. The matrix **never** fails wholesale because one role/AP/
entitlement could not be read — mirroring `provenance.ts`'s soft-degrade
philosophy exactly. We never surface raw DTOs or HTTP noise (reuse
`toFriendlyError`).

## Input validation (external inputs)

| Input | Required/optional | Type | Limits | Behavior on failure |
|---|---|---|---|---|
| `item.accessKind` | required | union | one of entitlement/role/accessProfile/access | unknown/`access` kind → one degenerate all-blank-leaf row (`unresolved:true`, user populated, role/AP/entitlement/source `''` + ids null); never throws |
| `item.accessId` (new) | optional | `string\|null` | — | null id → cannot resolve composition → `unresolved` leaf row for that item |
| `item.identityId` | required for a usable row | string | — | empty → row still built with blank user id; `user` label falls back to `item.personName` (which `toReviewItemVM` already defaults to "this person") |
| resolver ids (role/AP/entitlement) | required to fetch | string | — | empty/missing → skip fetch, treat as `null` (soft-degrade) |
| API response fields (`name`, `source.name`, refs) | all optional per `.d.ts` | — | — | missing name → `''`; missing source → unresolved source slot; missing refs array → treated as empty (role/AP contributes no leaves) |
| sort `column`/`direction` | component-internal | union | fixed set | invalid → defaults to `user`/`ascending` (not user-reachable; defensive) |

## Invariants and ownership

- **One row per distinct five-id tuple** — owned by `buildMatrixRows`/
  `resolveMatrix`'s dedup `Map` (the single place that assembles rows), so both
  the table and the graph consume an already-canonical set.
- **Blank means "level not on this path"** — owned by the mapper (only the mapper
  decides when to emit `''`); the view and graph treat `''`/null uniformly and
  never invent a level.
- **Graph node identity = id-namespaced key** — owned by `deriveAccessGraph`; the
  mapper guarantees ids are carried on rows so the graph can dedup losslessly.
- **Fetch-at-most-once-per-id + concurrent dedupe** — owned by the resolver's
  three promise `Map`s (mirrors provenance); the hook owns resolver lifecycle
  (recreate on campaign change only).

---

## Testing strategy

**Pure unit tests (no mocks, highest value):**
- `src/domain/accessGraph.test.ts` — the 6-row worked example → exact nodes/edges
  incl. level-skips, dedup, `pathCount`, same-name-different-source distinctness,
  unresolved partial rows, empty input.
- `src/domain/accessMatrixSort.test.ts` — blanks-first ascending / blanks-last
  descending, case-insensitive locale compare, stable total order on ties.
- `src/sailpoint/accessMatrix.test.ts` — the pure row-assembly half of
  `resolveMatrix` driven by a **stub resolver** returning canned
  role/AP/entitlement composition for the worked example → exactly the 6 rows in
  the documented shape; plus dedup of an identical path; plus a `null` resolver
  result → `unresolved` row (no throw); plus an **`access`-kind item → exactly
  one all-blank-leaf row** (`unresolved:true`, user populated, role/AP/
  entitlement/source all `''` with ids null) and two such rows for the same user
  collapsing to one.

**Component tests (Vitest + RTL):**
- `src/views/AccessMatrixView.test.tsx` — renders the 6 rows from a stubbed
  `matrix` prop; clicking a column header sets `aria-sort` and reorders rows
  (assert blanks-first); loading/empty/error/unresolved-banner states; `<th
  scope>` presence and the visually-hidden caption text.

**Hook test (optional, light):**
- `src/state/useAccessMatrix.test.ts` — with mock API clients returning the
  worked-example composition: resolves to `status:'ready'`, 6 rows, a graph with
  the expected node count, and that a decision-driven `items` rebuild (same ids)
  does not re-run resolution — mirroring `useProvenance.test.ts`'s id-signature
  assertion.

Everything is unit-testable; the only I/O (three API calls) is isolated behind
the resolver interface and mocked. The expansion/graph logic — the risky part —
is pure and exhaustively testable from fixtures.

**Verification gates:** `npm run lint`, `tsc -b` (via `npm run build`), and
`npm test` must all pass before this feature is considered done.

---

## Files touched (summary)

- **Add** `src/sailpoint/accessMatrix.ts` (resolver + mapper)
- **Add** `src/domain/accessGraph.ts` + `accessGraph.test.ts`
- **Add** `src/domain/accessMatrixSort.ts` + `accessMatrixSort.test.ts`
- **Add** `src/state/useAccessMatrix.ts` (+ optional `.test.ts`)
- **Add** `src/views/AccessMatrixView.tsx` + `.css` + `.test.tsx`
- **Edit** `src/sailpoint/types.ts` — add `AccessMatrixRowVM`, `AccessGraphNode`,
  `AccessGraphEdge`, `AccessGraphData`, `AccessGraphNodeKind`; add `accessId` to
  `ReviewItemVM`.
- **Edit** `src/sailpoint/sdkClient.ts` — add `rolesApi`/`accessProfilesApi`/
  `entitlementsApi` to `PluginRuntime` + `initPlugin`.
- **Edit** `src/sailpoint/certifications.ts` — populate `accessId` in
  `describeAccess`/`toReviewItemVM`.
- **Edit** `src/CertApp.tsx` — add `'matrix'` step + `useAccessMatrix` wiring.
- **Edit** `src/views/CampaignDashboard.tsx` (+ `.css`) — add optional
  `onViewMatrix` button.
- **Add** `src/sailpoint/accessMatrix.test.ts`.

No manifest change, no new dependency, stack unchanged.
```

---

## Responses to design review (`design-review.md`, verdict CHANGES_REQUESTED)

All three findings are **addressed** in this revision. None were backlogged or
ignored; each change aligns with the original requirements (the worked-example
row count/shape, the honest-degrade philosophy, and the CSS-reuse justification).

- **Finding 1 [HIGH] — self-contradictory worked-example fixture.** Addressed.
  The golden table's `read` row now carries `accessProfile='foo'` (both `foo`
  rows filled; `delete` row blank), matching the design's own role-expansion
  rule. The "Fixture note" was rewritten to state plainly that the design
  **corrects** the spec's blank-read/`foo`-write inconsistency (explaining why
  the spec's shape violated the expansion rule) rather than adopting it, and to
  name the three test suites that assert this single golden shape. Row count (6)
  and overall shape are unchanged and remain faithful to the user's example.

- **Finding 2 [MEDIUM] — `access`-kind degenerate row underspecified.**
  Addressed. The mapper's `access` fallback now fully specifies the row:
  `unresolved:true`, `role=''`/`roleId=null`, `accessProfile=''`/
  `accessProfileId=null`, `entitlement=''`/`entitlementId=null`, `source=''`/
  `sourceId=null`, only `user`/`userId` populated; it also states we do **not**
  read `summary.access.id` into `accessId` and why, and gives the dedup-key
  fallback. The `AccessMatrixRowVM` JSDoc for `entitlement`/`source` was updated
  to acknowledge this all-blank case. `deriveAccessGraph`'s JSDoc and algorithm
  now define the all-blank-leaf output (contributes only the `user` node, zero
  edges). The case is pinned by new tests in both `accessGraph.test.ts` (one
  `user` node, zero edges) and `accessMatrix.test.ts` (exactly one row + same-
  user collapse), and the input-validation table row was tightened to match.

- **Finding 3 [NIT] — `vc-visually-hidden` wrong attribution.** Addressed. The
  parenthetical now reads: `vc-table-wrap` from `DrillDownTable.css`;
  `vc-visually-hidden` is a global utility defined in `charts/charts.css` and
  available app-wide via Vite's bundled CSS. (Verified against
  `src/components/charts/charts.css`.) No code impact.