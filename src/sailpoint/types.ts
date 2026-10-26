/**
 * View-model types for the Visual Certifications plugin.
 *
 * These are deliberately decoupled from the generated `sailpoint-api-client`
 * DTOs. The data layer (`certifications.ts`) maps raw API responses into these
 * shapes so the UI never has to reason about optional/nullable API fields or
 * SailPoint jargon. Everything a component renders comes from here.
 */
// The per-domain DTO types (CertificationDecision, etc.) are only exported from
// the module subpath, not the package root, so import them from there.
import type { CertificationDecision } from 'sailpoint-api-client/certifications/api'

/** How strongly the campaign requires a comment on each decision. */
export type CommentRequirement = 'all' | 'revokeOnly' | 'none'

/** The lifecycle phase of a certification, in plain terms. */
export type CampaignPhase = 'notStarted' | 'inProgress' | 'done'

/**
 * A certification campaign the signed-in user must review, normalized for the
 * UI. One `IdentityCertificationDto` maps to one of these.
 */
export interface CampaignVM {
  /** Certification id (used for all item/decision/sign-off calls). */
  id: string
  /** Human-friendly campaign name. */
  name: string
  /** Optional description set by the admin who created the campaign. */
  description: string | null
  /** Normalized lifecycle phase. */
  phase: CampaignPhase
  /** Decisions already made. */
  decisionsMade: number
  /** Total decisions required. */
  decisionsTotal: number
  /** Deadline (ISO string) or null when the campaign has no due date. */
  due: string | null
  /** When the reviewer signed off, or null if not signed. */
  signed: string | null
  /** Whether this campaign requires a comment, and when. */
  commentRequirement: CommentRequirement
}

/** The kind of access being reviewed, in plain language. */
export type AccessKind = 'entitlement' | 'role' | 'accessProfile' | 'access'

/** Priority bucket a review item falls into, for charts and chips. */
export type PriorityLevel = 'high' | 'medium' | 'low' | 'none'

/**
 * A single thing to review: one person + one piece of access they hold.
 * Maps from `AccessReviewItem`.
 */
export interface ReviewItemVM {
  /** Review item id (the id passed back in a ReviewDecision). */
  id: string
  /**
   * The identity whose access is under review. Used as the join key for
   * provenance lookups (one fetch per identity). Empty string when the API
   * never set it.
   */
  identityId: string
  /** Whether a decision has already been made on this item. */
  completed: boolean
  /** The decision already recorded, if any. */
  decision: CertificationDecision | null
  /**
   * True when this item was resolved by REASSIGNING it to someone else to
   * review. This is a THIRD outcome, distinct from the APPROVE/REVOKE recorded
   * in `decision`: the item leaves this reviewer's list but was neither kept
   * nor removed by them. Metrics and ordering treat it as resolved.
   */
  reassigned: boolean
  /** Comment already recorded, if any. */
  comments: string | null
  /** Display name of the person whose access is under review. */
  personName: string
  /** Display name of the access (entitlement/role/etc.). */
  accessName: string
  /** What kind of access this is. */
  accessKind: AccessKind
  /** Plain-language description of the access, if the API provided one. */
  accessDescription: string | null
  /** Name of the system/source the access lives on, if known. */
  sourceName: string | null
  /**
   * Id of the role / access profile / entitlement under review, read from
   * `item.accessSummary.{role|accessProfile|entitlement}.id`. Null when not
   * applicable (the generic `access` fallback kind, which carries no composition
   * id in the role/AP/entitlement id space). The access matrix uses this id to
   * resolve the access's composition; existing consumers ignore it. Optional so
   * existing `ReviewItemVM` fixtures/consumers compile unchanged (backward
   * compatible); `toReviewItemVM` always populates it.
   */
  accessId?: string | null
  /** True when this access was granted since the last review. */
  isNewAccess: boolean
  /** True when this is elevated/admin ("privileged") access. */
  isPrivileged: boolean
  /** True when the access touches cloud-governed resources. */
  isCloudGoverned: boolean
  /** Impact level of the data this access can reach, if DAS data exists. */
  dataImpact: PriorityLevel | null
  /** Days of recorded usage, or null when usage is unknown. */
  usageDays: number | null
  /** SailPoint AI recommendation string, if present (e.g. APPROVE/DENY). */
  aiRecommendation: string | null
  /** Whether the access can actually be revoked (some cannot). */
  revocable: boolean
}

/** How a reviewer-facing access was most likely granted. */
export type GrantMechanism = 'role' | 'request' | 'direct' | 'unknown'

/** A single approval step in the request's approval chain. */
export interface ApprovalStepVM {
  /** Who reviewed this step (display name), or null if unknown. */
  approver: string | null
  /** Plain-language outcome of this step. */
  decision: 'approved' | 'rejected' | 'pending' | 'unknown'
  /** When the decision was made (ISO string), or null. */
  decidedOn: string | null
  /** Approver's comment, if any. */
  comment: string | null
}

/** The original access request that produced this access, if one exists. */
export interface AccessRequestSummaryVM {
  /** Who requested it (display name), or null. */
  requestedBy: string | null
  /** When it was requested (ISO string), or null. */
  requestedOn: string | null
  /** The requester's stated justification, if any. */
  justification: string | null
}

/** Provenance for one review item. Always present once resolved; fields degrade. */
export interface AccessProvenanceVM {
  /** The review item id this provenance belongs to (join key for the UI). */
  itemId: string
  /** Headline mechanism (the user's priority). */
  grantMechanism: GrantMechanism
  /** Plain-language headline label, e.g. "Via access request". */
  mechanismLabel: string
  /** The source request, or null when no request is on record. */
  request: AccessRequestSummaryVM | null
  /** The approval chain, oldest step first; empty when none on record. */
  approvals: ApprovalStepVM[]
  /** When the access was granted (ISO), from history when available, else null. */
  grantedOn: string | null
  /**
   * True when the experimental history endpoint could not be reached (400/403)
   * or returned nothing — used to word the degraded state honestly.
   */
  historyUnavailable: boolean
}

/**
 * Resolution status of one item's provenance (async, non-blocking). Declared
 * here (not in the hook) so the components import it from `../sailpoint/types`
 * alongside the other view models — the repo never imports a type from a
 * `state/` hook into a component.
 */
export type ProvenanceStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

/** Per-item provenance entry the UI consumes, keyed by review item id. */
export interface ProvenanceEntry {
  status: ProvenanceStatus
  data: AccessProvenanceVM | null
}

/**
 * The decisions a reviewer can make, in business language. `reassign` hands the
 * item to someone else to review rather than keeping or removing the access.
 */
export type DecisionChoice = 'allow' | 'remove' | 'reassign'

/**
 * A person who can receive a reassigned item, trimmed to what the recipient
 * picker needs to show and submit. Mapped from an identity-search result row.
 */
export interface IdentityOption {
  /** Identity id, used as the `reassignTo` value. */
  id: string
  /** Name shown in the picker. */
  displayName: string
  /** Email shown as a secondary line to disambiguate same-named people. */
  email: string
}

/** Signed-in user, trimmed to what the UI needs. */
export interface CurrentUser {
  id: string
  displayName: string
  email: string
  isCertAdmin: boolean
}

// --- access expansion matrix -------------------------------------------------

/**
 * Review status of the user's directly-held (first-level) access item, for the
 * drill-down graph. Four states: `'needsReview'` = no decision recorded yet; `'approved'`
 * = reviewer KEPT the access (`decision === 'APPROVE'`); `'revoked'` = reviewer
 * REMOVED the access (`decision === 'REVOKE'`); `'reassigned'` = the item was
 * handed to someone else to review, which is TERMINAL for this reviewer and
 * takes precedence over a recorded decision. See `reviewStatusOf` in
 * `domain/metrics.ts`, the single source of truth; `isItemReviewed` is true for
 * `'approved'`, `'revoked'`, and `'reassigned'`. Only the FIRST hop off the user
 * (the role / access profile / directly-held entitlement under review) carries
 * this; deeper explanatory hops stay neutral. Status is a LIVE per-user overlay
 * (see `domain/reviewOverlay.ts`), never baked into resolved matrix rows.
 */
export type AccessReviewStatus =
  | 'needsReview'
  | 'approved'
  | 'revoked'
  | 'reassigned'

/**
 * One fully-expanded row of the access matrix: a single path from a user to a
 * leaf entitlement on a source. Blank (empty-string) role/accessProfile cells
 * mean that level is NOT on this path (see the expansion rules). `entitlement`
 * and `source` are populated on a real leaf row; they are blank only on an
 * `unresolved` row — and specifically always blank together on the degenerate
 * `access`-kind row (which has no leaf at all; see the mapper's `access`
 * fallback). A fetch-failure `unresolved` row still carries whatever ids/names
 * were known from the parent ref before the deep fetch failed.
 */
export interface AccessMatrixRowVM {
  /** Stable, deterministic row id = join of the five tuple fields + ids. */
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
  /**
   * The user's department, for the graph's user-node tooltip. Enrichment only:
   * attaches to `userId` (independent of the access path), so it is present on
   * EVERY row for that user — including the degenerate `access`-kind all-blank
   * row and unresolved rows. '' / absent when the identity lookup soft-degraded
   * or the attribute was unmapped. Optional so existing fixtures compile
   * unchanged; never part of the five-id dedup key.
   */
  userDepartment?: string
  /** The user's location, same semantics as {@link userDepartment}. */
  userLocation?: string
  /** The user's country, same semantics as {@link userDepartment}. */
  userCountry?: string
  /**
   * Richer per-identity detail for the user node's detail panel (email, title,
   * manager, lifecycle state, etc.), same enrichment semantics as
   * {@link userDepartment}: attaches to `userId`, lands on every row for that
   * user, '' / absent when the identity lookup soft-degraded, never part of the
   * dedup key.
   */
  userEmail?: string
  /**
   * The user's given (first) name, same enrichment semantics as
   * {@link userDepartment}. Combined with {@link userLastName} to form the
   * user node's "FIRST LAST" label; '' / absent when the identity lookup
   * soft-degraded or the attribute was unmapped. Never part of the dedup key.
   */
  userFirstName?: string
  /**
   * The user's family (last) name, same semantics as {@link userFirstName}.
   * Also the key the user grid sorts on.
   */
  userLastName?: string
  userTitle?: string
  userPhone?: string
  /** 'Yes' / 'No' / '' — whether the identity manages others. */
  userIsManager?: string
  /** Manager's display name, from the identity's `managerRef.name`. */
  userManager?: string
  /** Lifecycle state name (e.g. "active"), from `lifecycleState.stateName`. */
  userLifecycleState?: string
  /** Identity status (e.g. "ACTIVE"), from `identityStatus`. */
  userIdentityState?: string
  /** The identity's own id (shown as "Identity ID"). */
  userIdentityId?: string
  /**
   * The role's human-readable description, for the role-node tooltip. Present
   * only on a resolved role row; '' / absent when unavailable. Enrichment only;
   * never part of the dedup key.
   */
  roleDescription?: string
  /** The role's owner display name. Role rows only. */
  roleOwner?: string
  /** True when the role is enabled. Role rows only. */
  roleEnabled?: boolean
  /** True when the role is directly requestable. Role rows only. */
  roleRequestable?: boolean
  /** The role's privilege level. Role rows only. */
  rolePrivilegeLevel?: string
  /** True when the role is dimensional. Role rows only. */
  roleDimensional?: boolean
  /** The role's created timestamp (ISO). Role rows only. */
  roleCreated?: string
  /** The role's last-modified timestamp (ISO). Role rows only. */
  roleModified?: string
  /** The access profile's description, same semantics as {@link roleDescription}. */
  accessProfileDescription?: string
  /** The access profile's source name. Access-profile rows only. */
  accessProfileSource?: string
  /** The access profile's owner display name. Access-profile rows only. */
  accessProfileOwner?: string
  /** True when the access profile is enabled. Access-profile rows only. */
  accessProfileEnabled?: boolean
  /** True when the access profile is directly requestable. Access-profile rows only. */
  accessProfileRequestable?: boolean
  /** The access profile's created timestamp (ISO). Access-profile rows only. */
  accessProfileCreated?: string
  /** The access profile's last-modified timestamp (ISO). Access-profile rows only. */
  accessProfileModified?: string
  /** The entitlement's description, same semantics as {@link roleDescription}. */
  entitlementDescription?: string
  /** The entitlement's source-schema attribute name (e.g. `memberOf`). Leaf rows only. */
  entitlementAttribute?: string
  /** The entitlement's raw value on the source. Leaf rows only. */
  entitlementValue?: string
  /** The entitlement's source-schema object type (e.g. `group`). Leaf rows only. */
  entitlementObjectType?: string
  /** True when the entitlement is privileged. Leaf rows only. */
  entitlementPrivileged?: boolean
  /** True when the entitlement is cloud governed. Leaf rows only. */
  entitlementCloudGoverned?: boolean
  /** True when the entitlement is directly requestable. Leaf rows only. */
  entitlementRequestable?: boolean
  /** The entitlement owner's display name. Leaf rows only. */
  entitlementOwner?: string
  /** The entitlement's tags, comma-joined. Leaf rows only. */
  entitlementTags?: string
  /** The entitlement's created timestamp (ISO). Leaf rows only. */
  entitlementCreated?: string
  /** The entitlement's last-modified timestamp (ISO). Leaf rows only. */
  entitlementModified?: string
  /**
   * The entitlement's free-form source attributes as ordered `[key, value]`
   * pairs (the ISC "Additional Attributes" section). Leaf rows only.
   */
  entitlementAttributes?: Array<[string, string]>
  /** The source's description, same semantics as {@link roleDescription}. */
  sourceDescription?: string
  /** The source's owner display name. Leaf rows only. */
  sourceOwner?: string
  /** The source's type (e.g. "Active Directory"). Leaf rows only. */
  sourceType?: string
  /** The source's connector name. Leaf rows only. */
  sourceConnector?: string
  /** The source's connection type. Leaf rows only. */
  sourceConnectionType?: string
  /** The source's category. Leaf rows only. */
  sourceCategory?: string
  /** The source's cluster name. Leaf rows only. */
  sourceCluster?: string
  /** True when the source is authoritative. Leaf rows only. */
  sourceAuthoritative?: boolean
  /** True when the source is healthy. Leaf rows only. */
  sourceHealthy?: boolean
  /** The source's status. Leaf rows only. */
  sourceStatus?: string
  /** The source's created timestamp (ISO). Leaf rows only. */
  sourceCreated?: string
  /** The source's last-modified timestamp (ISO). Leaf rows only. */
  sourceModified?: string
  /**
   * The KIND of the user's directly-held access item (the first hop off the
   * user node): the role, access profile, or entitlement under review. Lets the
   * graph mark the user→child edge as a first-level review hop (see
   * {@link AccessGraphEdge.firstLevel}). `undefined` for the generic `access`
   * fallback (no composition node). Enrichment only; never part of the dedup
   * key. Review STATUS is deliberately NOT on the row: it is a live overlay
   * applied after resolution so a decision never needs a re-resolve.
   */
  accessItemKind?: AccessGraphNodeKind
  /**
   * The id of the user's directly-held access item (`ReviewItemVM.accessId`),
   * paired with {@link accessItemKind}. Null when the review item carried no id.
   * Enrichment only; never part of the dedup key.
   */
  accessItemId?: string | null
  /**
   * The review item's own display name (`ReviewItemVM.accessName`), paired with
   * {@link accessItemKind}. Used as the review-key fallback when the item has no
   * id and as the node label when the resolved label is blank. Enrichment only;
   * never part of the dedup key.
   */
  accessItemName?: string
}

/**
 * Extra, per-kind detail surfaced on a graph node (its tooltip historically,
 * now the detail panel). For a `user` node the identity fields (department,
 * location, email, title, phone, manager, lifecycle state, …); for every other
 * kind just `description`. Each key is set only when non-empty, so a bare node
 * carries no `detail` at all. Enrichment only; never part of node identity.
 */
export interface NodeDetail {
  /** Non-user node: the item's description. */
  description?: string
  // --- entitlement-node attribute fields -------------------------------------
  // Set only on an entitlement node, each only when non-empty / non-default, so
  // a sparse entitlement never shows a wall of "not set" lines.
  /** The source this entitlement lives on (display name). */
  source?: string
  /** The source-schema attribute name backing the entitlement (e.g. `memberOf`). */
  attribute?: string
  /** The entitlement's raw value on the source. */
  value?: string
  /** The source-schema object type (e.g. `group`). */
  objectType?: string
  /** 'Yes' when the entitlement is privileged (omitted otherwise). */
  privileged?: string
  /** 'Yes' when the entitlement is cloud governed (omitted otherwise). */
  cloudGoverned?: string
  /** 'Yes' when the entitlement is directly requestable (omitted otherwise). */
  requestable?: string
  /** Entitlement owner's display name. */
  owner?: string
  /** Comma-joined tag list. */
  tags?: string
  /** Created timestamp (ISO). */
  created?: string
  /** Last-modified timestamp (ISO). */
  modified?: string
  /** The entitlement's own id. */
  entitlementId?: string
  /**
   * The free-form source attributes as ordered `[key, value]` pairs, rendered
   * under an "Additional attributes" heading (mirrors the ISC panel). Omitted
   * when the entitlement carried none.
   */
  attributes?: Array<[string, string]>
  // --- role / access-profile attribute fields --------------------------------
  // Set only on a role or access-profile node (several keys above — source,
  // owner, requestable, created, modified, description — are reused). Each only
  // when non-empty / non-default so a sparse item stays compact.
  /** 'Yes' when the role / access profile is enabled (omitted otherwise). */
  enabled?: string
  /** The role's privilege level. Role nodes only. */
  privilegeLevel?: string
  /** 'Yes' when the role is dimensional (omitted otherwise). Role nodes only. */
  dimensional?: string
  /** The role's own id. Role nodes only. */
  roleId?: string
  /** The access profile's own id. Access-profile nodes only. */
  accessProfileId?: string
  // --- source-node attribute fields ------------------------------------------
  // Set only on a source node (several keys above — owner, created, modified,
  // description — are reused). Each only when non-empty / non-default.
  /** The source type (e.g. "Active Directory"). Source nodes only. */
  type?: string
  /** The connector name. Source nodes only. */
  connector?: string
  /** The connection type. Source nodes only. */
  connectionType?: string
  /** The source category. Source nodes only. */
  category?: string
  /** The cluster display name. Source nodes only. */
  cluster?: string
  /** 'Yes' when the source is authoritative (omitted otherwise). Source nodes only. */
  authoritative?: string
  /** 'Yes' when the source is healthy (omitted otherwise). Source nodes only. */
  healthy?: string
  /** The source status. Source nodes only. */
  status?: string
  /** The source's own id. Source nodes only. */
  sourceId?: string
  /**
   * How many distinct entitlements link to this attribute node. Attribute nodes
   * only. A decimal string so the detail panel can render it like other fields.
   */
  entitlementCount?: string
  // --- user-node identity fields ---------------------------------------------
  /**
   * The user's given / family name. Carried on a user node so the grid can sort
   * by real last name (the node `label` is the combined "First Last" display
   * string). Not rendered by the detail panel's fixed field list.
   */
  firstName?: string
  lastName?: string
  department?: string
  location?: string
  country?: string
  email?: string
  title?: string
  phone?: string
  /** 'Yes' / 'No' — whether the identity manages others. */
  isManager?: string
  /** Manager's display name. */
  manager?: string
  /** Lifecycle state name (e.g. "active"). */
  lifecycleState?: string
  /** Identity status (e.g. "ACTIVE"). */
  identityState?: string
  /** The identity's own id. */
  identityId?: string
}

/** The kind of a graph node — the layers of the matrix. */
export type AccessGraphNodeKind =
  | 'user'
  | 'role'
  | 'accessProfile'
  | 'entitlement'
  | 'attribute'
  | 'source'

/**
 * A node in the access graph derived from the matrix. `id` is namespaced by
 * kind (e.g. `user:<identityId>`) so the same display name never collides
 * across layers or with another layer's id space.
 */
export interface AccessGraphNode {
  /** Namespaced, unique node id, e.g. 'role:<roleId>' or 'source:name:<name>'. */
  id: string
  /** Which layer this node belongs to. */
  kind: AccessGraphNodeKind
  /** Human-readable label (the display name). */
  label: string
  /**
   * Extra detail surfaced in the node's detail panel ({@link NodeDetail}). For
   * a `user` node the identity fields; for every other kind `description`. Each
   * key is set only when non-empty, and `detail` is omitted entirely when a node
   * has no extra data — so a bare node stays `{ id, kind, label }`. Enrichment
   * only; first-wins on dedupe (the first row to introduce a node id sets it).
   */
  detail?: NodeDetail
  /**
   * Review status of this node, set ONLY by `userSubgraph`, and only on the
   * target of the viewed user's own first-level edge (copied from that edge, so
   * node and edge can never disagree). The shared, user-independent graph never
   * carries it: nodes are deduped across users, so a status there would leak
   * between users. Deeper nodes and the user node leave it `undefined`.
   */
  reviewStatus?: AccessReviewStatus
  /**
   * True when the first-level edge this status was copied from aggregates
   * several review items that disagree (see {@link AccessGraphEdge.reviewMixed}).
   * Set only by `userSubgraph` alongside `reviewStatus`.
   */
  reviewMixed?: boolean
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
  /**
   * Review status of this edge: a LIVE per-user overlay set ONLY by
   * `applyReviewStatus` on `firstLevel` edges whose {@link reviewKey} has a
   * review item. Structural derivation never sets it, and deeper edges leave it
   * `undefined`. Aggregation across several review items for one key follows
   * `needsReview > reassigned > revoked > approved` (`aggregateReviewStatus`).
   * `pathCount` is retained for any data-layer consumer, but the drill-down
   * renderer no longer draws a count badge.
   */
  reviewStatus?: AccessReviewStatus
  /**
   * True ONLY on the user→access-item edge that is a real review hop (the
   * user's directly-held role / access profile / entitlement). Every deeper
   * edge leaves it `undefined` and is explanatory reference only.
   */
  firstLevel?: boolean
  /**
   * Join key into the review items for a `firstLevel` edge:
   * `reviewKey(userId, kind, accessId | name)`. Set structurally by
   * `deriveAccessGraph`; matched by `applyReviewStatus`.
   */
  reviewKey?: string
  /**
   * True when {@link reviewStatus} aggregates several review items for this
   * key that do not all share one status (tooltip detail). Set only by
   * `applyReviewStatus`.
   */
  reviewMixed?: boolean
}

/**
 * The derived graph: deduped nodes + deduped directed edges. Direction is
 * user → … → source. A renderer can walk it from users (follow `from→to`) or
 * from sources (follow `to→from`); it is bidirectional-traversal-ready without
 * storing reverse edges (see `deriveAccessGraph` docs).
 */
export interface AccessGraphData {
  nodes: AccessGraphNode[]
  edges: AccessGraphEdge[]
}

// --- access graph scene (React Flow view-model) ------------------------------

/**
 * Layout direction for the access graph's dagre pass. `'LR'` reads the
 * user → source pipeline left-to-right (the default); `'TB'` stacks the five
 * ranks top-to-bottom. These are the only two directions the view toggles
 * between — they map 1:1 onto dagre's `rankdir`.
 */
export type RankDir = 'LR' | 'TB'

/**
 * Which of the access graph's two display modes the canvas is in. `'grid'` is
 * the default overview: only `user`-kind cards laid out in a centered grid, no
 * edges, each card a selectable control. `'drilldown'` is entered by activating
 * a user card and shows ONLY that user's forward-reachable subgraph (user →
 * role / access profile / entitlement / source) laid out with the dagre pass.
 */
export type AccessGraphViewMode = 'grid' | 'drilldown'

/**
 * How far one user's first-level access items have been reviewed. `completed`
 * counts approved, revoked, and reassigned items; `total` is every access item
 * under review; `percent` is `completed / total`, rounded, or 0 when `total`
 * is 0.
 */
export interface UserCompletion {
  percent: number
  completed: number
  total: number
}

/**
 * The `data` payload carried on each React Flow node in the access scene. Kept
 * intentionally small — the custom node renders only a label plus a per-kind
 * accent — so the pure scene builder stays trivially serializable and testable.
 * Extends `Record<string, unknown>` to satisfy React Flow's node-data bound.
 */
export interface AccessSceneNodeData extends Record<string, unknown> {
  /** Which layer this node belongs to (drives the accent color). */
  kind: AccessGraphNodeKind
  /** Human-readable label shown on the card (the node's display name). */
  label: string
  /**
   * True ONLY on grid-mode user cards, where the node renders as an activatable
   * control (button role, keyboard-focusable, Enter/Space → `onSelect`). Left
   * `undefined` on drill-down scene nodes, which keep the read-only card markup.
   */
  interactive?: boolean
  /**
   * Activation handler for a grid-mode user card: invoked on click or
   * Enter/Space to drill into that user's access subgraph. Present only on grid
   * cards (paired with `interactive`); `undefined` on drill-down scene nodes.
   */
  onSelect?: () => void
  /**
   * Extra detail threaded from {@link AccessGraphNode.detail} for the detail
   * panel ({@link NodeDetail}): the identity fields on a user node,
   * `description` on every other kind. Omitted when the node has no extra data.
   * Enrichment only.
   */
  detail?: NodeDetail
  /**
   * Review status threaded from {@link AccessGraphNode.reviewStatus}: set only
   * on the user's directly-held access-item card in drill-down so the node can
   * render a status signal + accent. One of `'needsReview'` / `'approved'` /
   * `'revoked'` / `'reassigned'`. Omitted on every other node (grid user cards,
   * user node, deeper hops).
   */
  reviewStatus?: AccessReviewStatus
  /**
   * True when the status aggregates several disagreeing review items
   * (threaded from {@link AccessGraphNode.reviewMixed}).
   */
  reviewMixed?: boolean
  /**
   * True on a non-user node with no review status: a deeper, reference-only
   * node shown to explain how access derives to a source (not itself reviewed).
   */
  reference?: boolean
  /**
   * Review progress for this user: percent complete plus completed and total
   * access-item counts. Set only on user cards, from the unfiltered review
   * edges, so hiding completed items does not change it. Omitted on every
   * other kind.
   */
  completion?: UserCompletion
}

