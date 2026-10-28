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
  // A keyed list: three swatches, each with a line of text beside it.
  legend: (
    <>
      <rect x="4" y="5" width="3.5" height="3.5" rx="0.8" {...stroke} />
      <rect x="4" y="10.25" width="3.5" height="3.5" rx="0.8" {...stroke} />
      <rect x="4" y="15.5" width="3.5" height="3.5" rx="0.8" {...stroke} />
      <path d="M10.5 6.75H20M10.5 12H20M10.5 17.25H20" {...stroke} />
    </>
  ),
  // A side panel: a framed rectangle with a docked right-hand column, the
  // visual shorthand for the fly-out details panel.
  detail: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" {...stroke} />
      <path d="M14 4.5V19.5" {...stroke} />
      <path d="M16.5 9H18M16.5 12H18M16.5 15H18" {...stroke} />
    </>
  ),
  // Plus, minus, and four corners: the canvas zoom actions (in, out, fit).
  zoomIn: <path d="M12 5.5v13M5.5 12h13" {...stroke} />,
  zoomOut: <path d="M5.5 12h13" {...stroke} />,
  fit: (
    <>
      <path d="M4 9.5V4.5H9M15 4.5h5v5M20 14.5v5h-5M9 19.5H4v-5" {...stroke} />
    </>
  ),
}

export type ControlIconName = keyof typeof paths

export function ControlIcon({ name }: { name: ControlIconName }) {
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
