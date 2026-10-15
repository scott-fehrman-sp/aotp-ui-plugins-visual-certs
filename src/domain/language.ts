/**
 * Plain-language helpers. A single place to keep business-friendly wording so
 * the whole plugin stays free of SailPoint jargon, and so canned decision
 * comments are consistent and easy to adjust.
 */
import type { AccessKind, DecisionChoice } from '../sailpoint/types'

/**
 * Short, non-technical names for the kinds of access a reviewer sees. We avoid
 * terms like "entitlement" in the primary label and explain them inline where
 * unavoidable.
 */
export const ACCESS_KIND_LABEL: Record<AccessKind, string> = {
  entitlement: 'permission',
  accessProfile: 'access bundle',
  role: 'job role',
  access: 'access',
}

/** A one-line inline explanation for each access kind, for a tooltip/helper. */
export const ACCESS_KIND_HELP: Record<AccessKind, string> = {
  entitlement:
    'A specific permission in a connected system (SailPoint calls this an "entitlement").',
  accessProfile:
    'A bundle of related permissions grouped together (SailPoint calls this an "access profile").',
  role: 'A set of access that goes with a particular job (SailPoint calls this a "role").',
  access: 'Something this person can get to or do.',
}

/** Plain-language label for each decision. */
export const DECISION_LABEL: Record<DecisionChoice, string> = {
  allow: 'Keep access',
  remove: 'Remove access',
  reassign: 'Reassign',
}

/** Short confirmation sentence describing what each decision does. */
export const DECISION_MEANING: Record<DecisionChoice, string> = {
  allow: 'This person keeps this access. Nothing changes for them.',
  remove: "This access will be taken away after you sign off. The person won't be able to use it.",
  reassign: 'Someone else will review this item. It leaves your list once you reassign it.',
}

/**
 * Pre-defined, decision-relevant comments offered in the decision dialog's
 * dropdown. Kept short and in business language. The reviewer can always pick
 * "Write my own…" to enter a custom comment instead.
 */
export const CANNED_COMMENTS: Record<DecisionChoice, string[]> = {
  allow: [
    "Access is still needed for this person's job",
    'Reviewed and appropriate for their role',
    "Confirmed with the person's manager",
    'Required for a current project',
  ],
  remove: [
    'No longer needed for their job',
    'Person changed roles',
    'Access was never appropriate',
    'Unused access',
    'Too much access for the role',
  ],
  reassign: [
    "This isn't my direct report.",
    'This belongs to another manager.',
    'A subject-matter expert should review this.',
    "I'm covering while this person is on leave.",
  ],
}

/** Human sentence for days remaining against a deadline. */
export function deadlineText(daysRemaining: number | null): string {
  if (daysRemaining === null) return 'No deadline set'
  if (daysRemaining < 0) {
    const overdue = Math.abs(daysRemaining)
    return `${overdue} ${overdue === 1 ? 'day' : 'days'} overdue`
  }
  if (daysRemaining === 0) return 'Due today'
  return `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`
}
