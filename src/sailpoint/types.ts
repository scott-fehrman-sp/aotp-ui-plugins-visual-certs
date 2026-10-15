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
