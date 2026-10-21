/**
 * Inline SVG icons for the graph control panel. Same style as org-graph's
 * `nodes/icons.tsx`: 24px viewBox, 1.8 stroke, round caps/joins, `currentColor`.
 */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const paths = {
  layout: (
    <>
      <rect x="4" y="4" width="6" height="5" rx="1" {...stroke} />
      <rect x="14" y="4" width="6" height="5" rx="1" {...stroke} />
      <rect x="9" y="15" width="6" height="5" rx="1" {...stroke} />
      <path d="M7 9v2.2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9" {...stroke} />
    </>
  ),
  // One item on the left linked to two reference items on the right.
  reference: (
    <>
      <rect x="3.5" y="9" width="6" height="6" rx="1" {...stroke} />
      <rect x="15" y="3.5" width="5.5" height="5" rx="1" {...stroke} />
      <rect x="15" y="15.5" width="5.5" height="5" rx="1" {...stroke} />
      <path d="M9.5 12h2.5V6h3M12 12v6.5h3" {...stroke} />
    </>
  ),
  // A check mark in a circle: completed items are shown.
  completed: (
    <>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="M8 12.5l2.8 2.8L16.2 9.2" {...stroke} />
    </>
  ),
  // The same icon dimmed and struck through: completed items are hidden.
  completedHidden: (
    <>
      <circle cx="12" cy="12" r="8.5" {...stroke} opacity=".4" />
      <path d="M8 12.5l2.8 2.8L16.2 9.2" {...stroke} opacity=".4" />
      <path d="M5.5 18.5L18.5 5.5" {...stroke} />
    </>
  ),
  minimap: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" {...stroke} />
      <rect x="12" y="12" width="6.5" height="6.5" rx="1" {...stroke} />
    </>
  ),
}

export function ControlIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="vc-graph-control-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon={name}
    >
      {paths[name]}
    </svg>
  )
}
