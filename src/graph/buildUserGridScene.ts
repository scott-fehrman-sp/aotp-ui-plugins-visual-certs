/**
 * Pure layout for the access graph's OVERVIEW (grid) mode.
 *
 * `buildUserGridScene` filters the derived graph down to its `user`-kind nodes,
 * drops every edge, and positions the user cards in a centered grid — the
 * selectable starting point before an operator drills into one user. The grid
 * geometry mirrors `org-graph/src/graph/layout.ts` → `layoutGrid` (gapX=36,
 * gapY=32, column count derived from the viewport width and the shared card
 * box, origin centered on (0,0)).
 *
 * Like `buildAccessScene`, it is framework-pure: no React, no DOM, no I/O, no
 * mutation of the input graph, deterministic output. Width is an argument (the
 * canvas supplies a live React Flow store width), keeping the builder testable
 * without mounting React Flow.
 */
import type { AccessGraphData } from '../sailpoint/types'
import {
  NODE_USER_HEIGHT,
  NODE_WIDTH,
  type AccessScene,
  type AccessSceneNode,
} from './buildAccessScene'
import { completionPercent } from './completedFilter'

/** Grid gaps, matched to org-graph's `layoutGrid`. */
const GAP_X = 36
const GAP_Y = 32

/**
 * The surname sort key for a user node. Uses the REAL resolved last name
 * (`detail.lastName`, plumbed from the identity's `lastName` attribute). When
 * the identity lookup soft-degraded and no last name was resolved, it falls
 * back to the last whitespace-delimited token of the display label so the card
 * still sorts somewhere sensible rather than collapsing to an empty key.
 */
function lastNameKey(node: AccessGraphData['nodes'][number]): string {
  const resolved = (node.detail?.lastName ?? '').trim()
  if (resolved) return resolved.toLowerCase()
  const tokens = node.label.trim().split(/\s+/).filter(Boolean)
  const key = tokens.length > 1 ? tokens[tokens.length - 1] : node.label
  return key.toLowerCase()
}

/**
 * Builds the centered user grid scene. Zero `user` nodes → empty scene. Each
 * card is marked `interactive` so `AccessNode` renders a focusable button; the
 * caller attaches each card's `onSelect` via the optional `onSelect(nodeId)`
 * factory (the canvas uses it to set the selected user and enter drill-down).
 *
 * User cards are ordered alphabetically by last name (then by full label, then
 * id, for a stable tie-break), so the grid reads A→Z by surname.
 *
 * PURE and deterministic: identical input (same graph + width) yields identical
 * positions. `onSelect` closures are the only non-serializable part and are
 * supplied by the caller.
 */
export function buildUserGridScene(
  graph: AccessGraphData,
  viewportWidth: number,
  onSelect?: (nodeId: string) => void,
): AccessScene {
  const users = graph.nodes
    .filter((node) => node.kind === 'user')
    .sort((a, b) => {
      const byLast = lastNameKey(a).localeCompare(lastNameKey(b), 'en')
      if (byLast !== 0) return byLast
      const byLabel = a.label.toLowerCase().localeCompare(b.label.toLowerCase(), 'en')
      return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id)
    })
  if (users.length === 0) {
    return { nodes: [], edges: [] }
  }

  const columns = Math.max(
    1,
    Math.min(
      users.length,
      Math.floor((Math.max(viewportWidth, 720) - 96) / (NODE_WIDTH + GAP_X)),
    ),
  )
  const rows = Math.ceil(users.length / columns)
  // Every grid card is a USER, so the taller user-card height drives both the
  // cell size and the row stride.
  const totalWidth = columns * NODE_WIDTH + (columns - 1) * GAP_X
  const totalHeight = rows * NODE_USER_HEIGHT + (rows - 1) * GAP_Y
  const originX = -totalWidth / 2
  const originY = -totalHeight / 2

  const nodes: AccessSceneNode[] = users.map((node, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      id: node.id,
      type: 'access',
      position: {
        x: originX + column * (NODE_WIDTH + GAP_X),
        y: originY + row * (NODE_USER_HEIGHT + GAP_Y),
      },
      data: {
        kind: node.kind,
        label: node.label,
        detail: node.detail,
        interactive: true,
        onSelect: onSelect ? () => onSelect(node.id) : undefined,
        // Each grid card is a user under review. Count that user's own
        // first-level edges on the full graph (the grid drops edges, so the
        // number has to be captured here).
        completedPercent: completionPercent(graph.edges, node.id),
      },
      width: NODE_WIDTH,
      height: NODE_USER_HEIGHT,
      draggable: false,
      connectable: false,
    }
  })

  return { nodes, edges: [] }
}
