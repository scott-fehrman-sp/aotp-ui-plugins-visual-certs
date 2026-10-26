/**
 * Shared per-kind line-art glyphs for the access graph.
 *
 * One distinct glyph per node kind (user / role / access profile / entitlement
 * / attribute / source). Used by the node card's lower-left corner icon and by the detail
 * panel's kind badge, so both show the same visual shorthand for a kind. The
 * glyphs are `currentColor`-stroked on an 18×18 viewBox, so the caller controls
 * size and color; they carry no accessible name (the kind is named in text
 * beside them and in the card's accessible name).
 *
 * Lives in its own module (not AccessNode) so a plain constant/component can be
 * shared without tripping react-refresh's "only export components" rule.
 */
import type { ReactNode } from 'react'
import type { AccessGraphNodeKind } from '../sailpoint/types'

/** A distinct line-art glyph per node kind. */
const KIND_ICON_SHAPE: Record<AccessGraphNodeKind, ReactNode> = {
  // Person: head + shoulders.
  user: (
    <>
      <circle cx="9" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 15.5 C3.5 11.9 6 10.5 9 10.5 C12 10.5 14.5 11.9 14.5 15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),
  // Role: ID badge.
  role: (
    <>
      <rect x="3.5" y="3" width="11" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="7.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 12.5 C6 10.8 7.2 10 9 10 C10.8 10 12 10.8 12 12.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // Access profile: stacked layers / bundle.
  accessProfile: (
    <>
      <path d="M9 2.5 L15.5 6 L9 9.5 L2.5 6 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2.5 9.5 L9 13 L15.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Entitlement: a key.
  entitlement: (
    <>
      <circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.1 8.1 L15 15 M12.5 12.5 L14 11 M14 14 L15.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Attribute: a tag, the schema field an entitlement is filed under.
  attribute: (
    <>
      <path
        d="M2.5 6 H10 L15 9 L10 12 H2.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="5.5" cy="9" r="1" fill="currentColor" />
    </>
  ),
  // Source: a database cylinder.
  source: (
    <>
      <ellipse cx="9" cy="4.5" rx="5.5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 4.5 V13.5 C3.5 14.6 6 15.5 9 15.5 C12 15.5 14.5 14.6 14.5 13.5 V4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 9 C3.5 10.1 6 11 9 11 C12 11 14.5 10.1 14.5 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
}

/**
 * The per-kind glyph as a 16×16 decorative SVG. `className` lets each host set
 * its own sizing / per-kind tint; a `kind-<kind>` modifier and `data-kind` hook
 * are always applied. Hidden from assistive tech (`aria-hidden`).
 */
export function KindIcon({
  kind,
  className,
}: {
  kind: AccessGraphNodeKind
  /** Base class; the component appends ` kind-<kind>`. */
  className: string
}) {
  return (
    <svg
      className={`${className} kind-${kind}`}
      data-kind={kind}
      viewBox="0 0 18 18"
      width="16"
      height="16"
      aria-hidden="true"
    >
      {KIND_ICON_SHAPE[kind]}
    </svg>
  )
}
