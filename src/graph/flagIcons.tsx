/**
 * Distinct glyphs for the certification access flags.
 *
 * One shape per flag, stroked with `currentColor`, so the card and the detail
 * panel draw the same mark. Color is a single attention tint set by CSS; the
 * shape is what tells the flags apart. The glyph is decorative wherever a text
 * label already names the flag. Pass `labelled` when the icon is the only name.
 */
import type { ReactNode } from 'react'
import type { AccessFlag } from '../sailpoint/types'
import { ACCESS_FLAG_LABEL } from '../domain/accessFlags'

const FLAG_SHAPE: Record<AccessFlag, ReactNode> = {
  // Four-point spark: access that has never been certified.
  newAccess: (
    <path
      d="M9 2.5 L10.2 7.2 L15 8.5 L10.2 9.8 L9 14.5 L7.8 9.8 L3 8.5 L7.8 7.2 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  // Seedling: granted automatically, such as by a lifecycle state.
  birthright: (
    <>
      <path d="M9 15.5 V8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M9 10 C9 6.5 5 6 4.5 8.5 C6.5 9 8 10 9 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M9 8.5 C9 5 13 4.5 13.5 7 C11.5 7.5 10 8.5 9 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  // Shield: the entitlement's privilege level was manually raised.
  highPrivilege: (
    <path
      d="M9 2.5 L14.5 4.5 V9.2 C14.5 12.4 12.2 14.6 9 15.5 C5.8 14.6 3.5 12.4 3.5 9.2 V4.5 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  // Stacked layers: a role or access profile that contains privileged access.
  containsPrivileged: (
    <>
      <path d="M9 3 L14.5 6 L9 9 L3.5 6 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3.5 9 L9 12 L14.5 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 12 L9 15 L14.5 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Clock: the access has an end date.
  timebound: (
    <>
      <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 5.5 V9 L11.5 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Speech bubble: a comment is attached to this access.
  comments: (
    <path
      d="M3.5 4.5 H14.5 V11.5 H8 L5 14.5 V11.5 H3.5 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  // Cloud: the access reaches cloud infrastructure.
  cloudEnabled: (
    <path
      d="M6 13.5 H12.2 C14 13.5 15.2 12.2 15.2 10.7 C15.2 9.2 14 8.1 12.5 8.1 C12.3 6.2 10.8 4.8 8.8 4.8 C6.9 4.8 5.4 6.1 5.2 7.9 C3.8 8.1 2.8 9.2 2.8 10.6 C2.8 12.2 4.1 13.5 6 13.5 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  ),
  // Diamond: the access contains critical data.
  criticalData: (
    <path
      d="M9 2.5 L15 9 L9 15.5 L3 9 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
}

/**
 * The flag glyph. Decorative by default (the surrounding text names the flag).
 * `labelled` gives it an accessible name for the card, where the icon is the
 * visible signal and a screen-reader summary lists the set.
 */
export function FlagIcon({
  flag,
  labelled = false,
}: {
  flag: AccessFlag
  labelled?: boolean
}) {
  const label = ACCESS_FLAG_LABEL[flag]
  const a11y = labelled
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const }
  return (
    <svg
      className="vc-graph-flag-icon"
      data-flag={flag}
      viewBox="0 0 18 18"
      width="14"
      height="14"
      {...a11y}
    >
      {labelled ? <title>{label}</title> : null}
      {FLAG_SHAPE[flag]}
    </svg>
  )
}
