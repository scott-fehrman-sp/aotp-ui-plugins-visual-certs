/**
 * The data layer between the generated `sailpoint-api-client` and the UI.
 *
 * Every ISC certification call goes through here so the rest of the app only
 * ever sees the clean view-model types from `types.ts` and friendly,
 * already-humanized error messages — never raw DTOs or axios/HTTP noise.
 */
import type {
  AccessReviewItem,
  CampaignReference,
  CertificationsApi,
  IdentityCertificationDto,
  ReviewDecision,
  ReviewReassign,
} from 'sailpoint-api-client/certifications/api'
import {
  CertificationDecision,
  ReassignReferenceTypeEnum,
} from 'sailpoint-api-client/certifications/api'
import type {
  AccessKind,
  CampaignPhase,
  CampaignVM,
  CommentRequirement,
  DecisionChoice,
  PriorityLevel,
  ReviewItemVM,
} from './types'

/** A decision the UI wants to record, before it becomes a ReviewDecision. */
export interface DecisionInput {
  /** The review item id. */
  itemId: string
  /** Allow (keep) or remove (revoke) the access. */
  choice: DecisionChoice
  /** Optional comment chosen or typed by the reviewer. */
  comment?: string
  /** Whether this decision is part of a bulk action. */
  bulk?: boolean
}

/** A reassignment the UI wants to record, before it becomes a ReviewReassign. */
export interface ReassignInput {
  /** The certification the item belongs to. */
  certificationId: string
  /** The review item being handed off. */
  itemId: string
  /** The identity id that should review the item instead. */
  reassignToId: string
  /** Why the item is being reassigned (the API requires a reason). */
  reason: string
}

/**
 * Error carrying a message that is safe to show a non-technical user. The data
 * layer catches every raw failure and rethrows one of these.
 */
export class FriendlyError extends Error {
  /** HTTP status when known, for callers that want to branch (e.g. 403). */
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'FriendlyError'
    this.status = status
  }
}

/**
 * Converts any thrown value (axios error, SDK `ApiError`, network failure) into
 * a `FriendlyError` with plain-language text. We never surface raw response
 * bodies: they are untrusted and may contain confusing or sensitive detail.
 */
export function toFriendlyError(error: unknown): FriendlyError {
  // Pull an HTTP status off whichever error shape we got.
  const status =
    (isRecord(error) &&
      (asNumber(get(error, 'status')) ??
        asNumber(get(get(error, 'response'), 'status')))) ||
    undefined

  if (status === 401 || status === 403) {
    return new FriendlyError(
      "It looks like you don't have permission to view this. Please check with your SailPoint administrator.",
      status,
    )
  }
  if (status === 404) {
    return new FriendlyError(
      "We couldn't find this review. It may have been completed or removed.",
      status,
    )
  }
  if (status === 429) {
    return new FriendlyError(
      'SailPoint is busy right now. Please wait a moment and try again.',
      status,
    )
  }
  if (typeof status === 'number' && status >= 500) {
    return new FriendlyError(
      'SailPoint ran into a problem on its end. Please try again in a few minutes.',
      status,
    )
  }
  // Network / timeout / unknown.
  return new FriendlyError(
    "We couldn't reach SailPoint. Please check your connection and try again.",
    status,
  )
}

// --- small untyped-access helpers (keep error handling tidy) ----------------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function get(v: unknown, key: string): unknown {
  return isRecord(v) ? v[key] : undefined
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

// --- mappers: raw DTO -> view model -----------------------------------------

/** Maps the campaign's comment requirement enum to our plain union. */
function toCommentRequirement(
  campaign: CampaignReference | undefined,
): CommentRequirement {
  switch (campaign?.mandatoryCommentRequirement) {
    case 'ALL_DECISIONS':
      return 'all'
    case 'REVOKE_ONLY_DECISIONS':
      return 'revokeOnly'
    default:
      return 'none'
  }
}

/** Maps the SailPoint certification phase to a plain lifecycle phase. */
function toPhase(dto: IdentityCertificationDto): CampaignPhase {
  if (dto.phase === 'SIGNED' || dto.signed) return 'done'
  if ((dto.decisionsMade ?? 0) > 0) return 'inProgress'
  return 'notStarted'
}

/** Converts one certification DTO into a {@link CampaignVM}. */
export function toCampaignVM(dto: IdentityCertificationDto): CampaignVM {
  return {
    id: dto.id ?? '',
    name: dto.name ?? 'Access review',
    description: dto.campaign?.description ?? null,
    phase: toPhase(dto),
    decisionsMade: dto.decisionsMade ?? 0,
    decisionsTotal: dto.decisionsTotal ?? 0,
    due: dto.due ?? null,
    signed: dto.signed ?? null,
    commentRequirement: toCommentRequirement(dto.campaign),
  }
}

/** Normalizes a HIGH/MEDIUM/LOW string to our PriorityLevel, if recognizable. */
function toDataImpact(value: string | undefined): PriorityLevel | null {
  switch (value?.toUpperCase()) {
    case 'HIGH':
      return 'high'
    case 'MEDIUM':
      return 'medium'
    case 'LOW':
      return 'low'
    default:
      return null
  }
}

/**
 * Determines what kind of access an item represents and pulls out the common
 * display fields. An AccessReviewItem carries exactly one of
 * entitlement/accessProfile/role under `accessSummary`.
 */
function describeAccess(item: AccessReviewItem): {
  accessKind: AccessKind
  accessId: string | null
  accessName: string
  accessDescription: string | null
  sourceName: string | null
  isPrivileged: boolean
  isCloudGoverned: boolean
  dataImpact: PriorityLevel | null
  usageDays: number | null
  revocable: boolean
} {
  const summary = item.accessSummary
  const entitlement = summary?.entitlement ?? null
  const accessProfile = summary?.accessProfile ?? null
  const role = summary?.role ?? null
  const fallbackName = summary?.access?.name ?? 'this access'

  if (entitlement) {
    return {
      accessKind: 'entitlement',
      accessId: entitlement.id ?? null,
      accessName: entitlement.name ?? fallbackName,
      accessDescription: entitlement.description ?? null,
      sourceName: entitlement.sourceName ?? null,
      isPrivileged: entitlement.privileged === true,
      isCloudGoverned: entitlement.cloudGoverned === true,
      dataImpact: toDataImpact(entitlement.dataAccess?.impactScore?.value),
      usageDays: entitlement.account?.activityInsights?.usageDays ?? null,
      revocable: entitlement.revocable !== false,
    }
  }
  if (accessProfile) {
    return {
      accessKind: 'accessProfile',
      accessId: accessProfile.id ?? null,
      accessName: accessProfile.name ?? fallbackName,
      accessDescription: accessProfile.description ?? null,
      sourceName: null,
      isPrivileged: accessProfile.privileged === true,
      isCloudGoverned: accessProfile.cloudGoverned === true,
      dataImpact: null,
      usageDays: null,
      revocable: true,
    }
  }
  if (role) {
    return {
      accessKind: 'role',
      accessId: role.id ?? null,
      accessName: role.name ?? fallbackName,
      accessDescription: role.description ?? null,
      sourceName: null,
      isPrivileged: role.privileged === true,
      isCloudGoverned: false,
      dataImpact: null,
      usageDays: null,
      revocable: role.revocable !== false,
    }
  }
  return {
    accessKind: 'access',
    // The design is explicit: do NOT read `summary.access.id` into `accessId`.
    // An `access`-kind item's id is not in the role/AP/entitlement id space, no
    // resolver call would consume it, and reading it would only invite a
    // mis-fetch — so it stays null and the matrix degrades the row honestly.
    accessId: null,
    accessName: fallbackName,
    accessDescription: null,
    sourceName: null,
    isPrivileged: false,
    isCloudGoverned: false,
    dataImpact: null,
    usageDays: null,
    revocable: true,
  }
}

/** Converts one access review item DTO into a {@link ReviewItemVM}. */
export function toReviewItemVM(item: AccessReviewItem): ReviewItemVM {
  const access = describeAccess(item)
  return {
    id: item.id ?? '',
    // Join key for provenance lookups; empty when the API omitted it.
    identityId: item.identitySummary?.identityId ?? '',
    completed: item.completed === true,
    decision: item.decision ?? null,
    // `reassigned` is not part of the generated AccessReviewItem type, so read
    // it defensively off the raw row. Default false when the API never sets it.
    reassigned: (item as { reassigned?: boolean }).reassigned === true,
    comments: item.comments ?? null,
    personName: item.identitySummary?.name ?? 'this person',
    isNewAccess: item.newAccess === true,
    aiRecommendation: null, // IAI recommendation is attached at decision time; see note below.
    ...access,
  }
}

/** Maps the UI's allow/remove choice to the API's APPROVE/REVOKE enum. */
export function toCertificationDecision(
  choice: DecisionChoice,
): CertificationDecision {
  return choice === 'allow'
    ? CertificationDecision.Approve
    : CertificationDecision.Revoke
}

// --- API wrappers ------------------------------------------------------------

/** Page size for item fetches; the API caps limit at 250. */
const PAGE_SIZE = 250

/**
 * Lists the certifications the signed-in user is responsible for reviewing.
 * Uses `reviewerIdentity: 'me'` so the API scopes to the current user.
 */
export async function listMyCampaigns(
  api: CertificationsApi,
): Promise<CampaignVM[]> {
  try {
    const res = await api.listIdentityCertificationsV1({
      reviewerIdentity: 'me',
      limit: 250,
      // Surface the most urgent (soonest due) first in the raw list.
      sorters: 'due',
    })
    return res.data.map(toCampaignVM)
  } catch (error) {
    throw toFriendlyError(error)
  }
}

/** Fetches a single campaign's current state (used to refresh live progress). */
export async function getCampaign(
  api: CertificationsApi,
  id: string,
): Promise<CampaignVM> {
  try {
    const res = await api.getIdentityCertificationV1({ id })
    return toCampaignVM(res.data)
  } catch (error) {
    throw toFriendlyError(error)
  }
}

/**
 * Fetches every access review item for a campaign, paging until the API returns
 * a short page. Priority ordering happens later (client-side) because the API
 * cannot sort by risk.
 */
export async function listReviewItems(
  api: CertificationsApi,
  campaignId: string,
): Promise<ReviewItemVM[]> {
  try {
    const items: ReviewItemVM[] = []
    let offset = 0
    // Guard against an unexpectedly huge campaign / a non-advancing API.
    for (let page = 0; page < 1000; page++) {
      const res = await api.listIdentityAccessReviewItemsV1({
        id: campaignId,
        limit: PAGE_SIZE,
        offset,
      })
      const batch = res.data ?? []
      items.push(...batch.map(toReviewItemVM))
      if (batch.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
    return items
  } catch (error) {
    throw toFriendlyError(error)
  }
}

/**
 * Records one or more allow/remove decisions. Comments must already satisfy the
 * campaign's requirement; the caller (DecisionDialog) enforces that.
 */
export async function decide(
  api: CertificationsApi,
  campaignId: string,
  decisions: DecisionInput[],
): Promise<CampaignVM> {
  try {
    const reviewDecision: ReviewDecision[] = decisions.map((d) => ({
      id: d.itemId,
      decision: toCertificationDecision(d.choice),
      bulk: d.bulk ?? false,
      ...(d.comment ? { comments: d.comment } : {}),
    }))
    const res = await api.makeIdentityDecisionV1({
      id: campaignId,
      reviewDecision,
    })
    return toCampaignVM(res.data)
  } catch (error) {
    throw toFriendlyError(error)
  }
}

/**
 * Finalizes all decisions on a campaign and starts any required access changes.
 * This is irreversible; the UI gates it behind an explicit confirmation.
 */
export async function signOff(
  api: CertificationsApi,
  campaignId: string,
): Promise<CampaignVM> {
  try {
    const res = await api.signOffIdentityCertificationV1({ id: campaignId })
    return toCampaignVM(res.data)
  } catch (error) {
    throw toFriendlyError(error)
  }
}

/**
 * Hands a single review item off to another identity to review. The reason is
 * required by the API; the caller (DecisionDialog) enforces that a comment was
 * provided. Returns the refreshed campaign so progress counts stay in sync.
 */
export async function reassignReviewItem(
  api: CertificationsApi,
  { certificationId, itemId, reassignToId, reason }: ReassignInput,
): Promise<CampaignVM> {
  try {
    const reviewReassign: ReviewReassign = {
      // We only ever reassign one item at a time from the queue; the API takes
      // an array so a future bulk action can grow this list.
      reassign: [{ id: itemId, type: ReassignReferenceTypeEnum.Item }],
      reassignTo: reassignToId,
      reason,
    }
    const res = await api.reassignIdentityCertificationsV1({
      id: certificationId,
      reviewReassign,
    })
    return toCampaignVM(res.data)
  } catch (error) {
    throw toFriendlyError(error)
  }
}
