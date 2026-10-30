/**
 * Certification access flags.
 *
 * SailPoint shows these on an access item during a certification so the
 * reviewer can weigh them before keeping or removing the access. The names and
 * definitions match the product help for reviewing certifications.
 *
 * Two kinds of flag exist:
 * - Assignment flags come from the review item (new, birthright, time-bound,
 *   comments, and the item's own privilege / cloud / critical-data signals).
 *   They belong to one person and ride the review overlay.
 * - Catalog flags come from the resolved role, access profile, or entitlement
 *   (a manual high-privilege override, a bundle that contains privileged
 *   access, cloud-enabled). They describe the object and are shared.
 *
 * This module is the single place that turns a review item into that list.
 */
import type { AccessFlag, ReviewItemVM } from '../sailpoint/types'

/** Display order. Matches the certification help, most decision-relevant first. */
export const ACCESS_FLAG_ORDER: readonly AccessFlag[] = [
  'newAccess',
  'birthright',
  'highPrivilege',
  'containsPrivileged',
  'timebound',
  'comments',
  'cloudEnabled',
  'criticalData',
]

/** Short name shown beside the icon. */
export const ACCESS_FLAG_LABEL: Record<AccessFlag, string> = {
  newAccess: 'New Access',
  birthright: 'Birthright Access',
  highPrivilege: 'High Privilege (Overridden)',
  containsPrivileged: 'Contains Privileged Access',
  timebound: 'Timebound Access',
  comments: 'Comments',
  cloudEnabled: 'Cloud Enabled',
  criticalData: 'Critical Data Access',
}

/** The definition from SailPoint's certification review help. */
export const ACCESS_FLAG_DEFINITION: Record<AccessFlag, string> = {
  newAccess: 'The access has not been certified previously.',
  birthright:
    'The access has been granted by automated rules, such as lifecycle states.',
  highPrivilege:
    "The entitlement's privilege level has been manually changed to indicate it grants access to sensitive data with high security risks.",
  containsPrivileged:
    'The access profile or role contains an access item with privileged entitlements. Privileged entitlements may grant access to sensitive data with high security risks.',
  timebound: 'The access has a set end date.',
  comments: 'There are comments associated with this access.',
  cloudEnabled: 'This access relates to cloud infrastructure.',
  criticalData: 'This access contains critical data.',
}

/** One flag plus the extra fact to show under its definition, when there is one. */
export interface AccessFlagDetail {
  flag: AccessFlag
  note?: string
}

/** Stable calendar date for an access end timestamp. Invalid input is returned as given. */
export function formatAccessEndDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function impactNote(item: ReviewItemVM): string | undefined {
  if (!item.dataImpact) return undefined
  const level = item.dataImpact.charAt(0).toUpperCase() + item.dataImpact.slice(1)
  return `Impact: ${level}`
}

/**
 * The flags on one review item, in {@link ACCESS_FLAG_ORDER}.
 *
 * An entitlement's `privileged` boolean is the certification API's privilege
 * signal. It raises "High Privilege (Overridden)" unless the payload also says
 * the level was set some other way (`privilegeOverridden === false`). A role or
 * access profile's `privileged` boolean means the bundle contains privileged
 * access, which is a different flag.
 */
export function accessFlagDetails(item: ReviewItemVM): AccessFlagDetail[] {
  const notes = new Map<AccessFlag, string>()
  const present = new Set<AccessFlag>()
  const add = (flag: AccessFlag, note?: string) => {
    present.add(flag)
    if (note) notes.set(flag, note)
  }

  if (item.isNewAccess) add('newAccess')
  if (item.isBirthright) add('birthright')
  if (
    item.accessKind === 'entitlement' &&
    (item.privilegeOverridden === true ||
      (item.isPrivileged && item.privilegeOverridden !== false))
  ) {
    add('highPrivilege')
  }
  if (
    (item.accessKind === 'role' || item.accessKind === 'accessProfile') &&
    item.isPrivileged
  ) {
    add('containsPrivileged')
  }
  const endDate = item.accessEndDate?.trim()
  if (endDate) add('timebound', `Ends ${formatAccessEndDate(endDate)}`)
  const comment = item.comments?.trim()
  if (comment) add('comments', comment)
  if (item.isCloudGoverned) add('cloudEnabled')
  if (item.hasCriticalData || item.dataImpact) add('criticalData', impactNote(item))

  return ACCESS_FLAG_ORDER.filter((flag) => present.has(flag)).map((flag) => {
    const note = notes.get(flag)
    return note ? { flag, note } : { flag }
  })
}

/** Union of flag lists, in {@link ACCESS_FLAG_ORDER}, with duplicates removed. */
export function mergeAccessFlags(
  ...lists: Array<readonly AccessFlag[] | undefined>
): AccessFlag[] {
  const present = new Set<AccessFlag>()
  for (const list of lists) {
    for (const flag of list ?? []) present.add(flag)
  }
  return ACCESS_FLAG_ORDER.filter((flag) => present.has(flag))
}

/**
 * Merges flag notes. The first non-empty note for a flag wins, so the result
 * does not depend on later items repeating the same fact.
 */
export function mergeFlagNotes(
  ...notes: Array<Partial<Record<AccessFlag, string>> | undefined>
): Partial<Record<AccessFlag, string>> {
  const merged: Partial<Record<AccessFlag, string>> = {}
  for (const note of notes) {
    if (!note) continue
    for (const flag of ACCESS_FLAG_ORDER) {
      const value = note[flag]?.trim()
      if (value && !merged[flag]) merged[flag] = value
    }
  }
  return merged
}

/** Notes map for one review item. Empty when no flag carries extra text. */
export function accessFlagNotes(
  item: ReviewItemVM,
): Partial<Record<AccessFlag, string>> {
  const notes: Partial<Record<AccessFlag, string>> = {}
  for (const detail of accessFlagDetails(item)) {
    if (detail.note) notes[detail.flag] = detail.note
  }
  return notes
}
