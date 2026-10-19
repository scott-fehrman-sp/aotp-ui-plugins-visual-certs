/**
 * Pure extraction of a single user's access subgraph from the full derived
 * graph.
 *
 * `userSubgraph` runs a forward traversal (user → … → source) from one user
 * node over the directed `from→to` edges, collecting exactly the nodes that
 * user can reach and the edges traversed to reach them. Feeding the result to
 * `buildAccessScene` renders the drill-down view for that one user without ever
 * touching the other users' nodes/edges.
 *
 * It is framework-pure: no React, no DOM, no I/O, no mutation of the input
 * graph, deterministic output. Output order mirrors the input graph's node and
 * edge order among the kept items, so identical input yields identical output.
 */
import type { AccessGraphData } from '../sailpoint/types'

/**
 * Returns the forward-reachable subgraph rooted at `userNodeId`.
 *
 * - Unknown id (not a node in `graph`) → empty graph `{ nodes: [], edges: [] }`.
 * - A user with no outgoing edges → just that single user node, zero edges.
 * - Otherwise → the user node plus every node reachable by following `from→to`
 *   edges, and exactly the edges traversed along those paths.
 *
 * PURE and deterministic: does not mutate `graph`; kept nodes/edges preserve
 * the input graph's relative order.
 */
export function userSubgraph(
  graph: AccessGraphData,
  userNodeId: string,
): AccessGraphData {
  const hasRoot = graph.nodes.some((node) => node.id === userNodeId)
  if (!hasRoot) {
    return { nodes: [], edges: [] }
  }

  // Index outgoing edges by their `from` id for an O(1) forward walk.
  const outgoing = new Map<string, typeof graph.edges>()
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from)
    if (list) list.push(edge)
    else outgoing.set(edge.from, [edge])
  }

  const reachableNodeIds = new Set<string>([userNodeId])
  const keptEdgeKeys = new Set<string>()
  const queue: string[] = [userNodeId]

  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const edge of outgoing.get(current) ?? []) {
      keptEdgeKeys.add(`${edge.from}|${edge.to}`)
      if (!reachableNodeIds.has(edge.to)) {
        reachableNodeIds.add(edge.to)
        queue.push(edge.to)
      }
    }
  }

  return {
    nodes: graph.nodes.filter((node) => reachableNodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => keptEdgeKeys.has(`${edge.from}|${edge.to}`)),
  }
}
