/**
 * A graph edge that shows a small count badge when more than one access path
 * runs through it, with a hover/focus tooltip explaining what the number means.
 *
 * The derived graph dedupes edges and records `pathCount` — how many distinct
 * expanded access paths (user → … → source) traverse this exact link. An edge
 * used by a single path carries no badge; a shared link shows its count so a
 * reviewer can see "this hop is reused by N of the user's paths" at a glance.
 *
 * The label is rendered as HTML via `EdgeLabelRenderer` (not an SVG `<text>`)
 * specifically so it can carry a native `title` tooltip and be keyboard
 * focusable — SVG edge labels can't do either cleanly.
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'

/** The payload the scene builder attaches to each edge. */
export interface AccessEdgeData extends Record<string, unknown> {
  /** How many expanded access paths traverse this edge (>= 1). */
  pathCount: number
}

/** The sentence shown on hover/focus, worded for a non-technical reviewer. */
function tooltipText(pathCount: number): string {
  return `${pathCount} access paths run through this link — the number of separate ways this user reaches the connected access.`
}

export function AccessCountEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const pathCount = (data as AccessEdgeData | undefined)?.pathCount ?? 1

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {pathCount > 1 && (
        <EdgeLabelRenderer>
          <span
            className="vc-graph-edge-badge"
            // `nodrag`/`nopan` keep interactions from panning the canvas; the
            // transform centers the badge on the edge midpoint.
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title={tooltipText(pathCount)}
            tabIndex={0}
            role="img"
            aria-label={tooltipText(pathCount)}
          >
            {pathCount}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
