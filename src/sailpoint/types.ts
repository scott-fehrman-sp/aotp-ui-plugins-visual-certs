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
  /** Namespaced, unique node id, e.g. 'role:<roleId>' or 'source:name:<name>'. */
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
 * user → … → source. A renderer can walk it from users (follow `from→to`) or
 * from sources (follow `to→from`); it is bidirectional-traversal-ready without
 * storing reverse edges (see `deriveAccessGraph` docs).
 */
export interface AccessGraphData {
  nodes: AccessGraphNode[]
  edges: AccessGraphEdge[]
}
