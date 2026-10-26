import type { AccessGraphData } from '../sailpoint/types'

/**
 * Stamps each ATTRIBUTE node with the number of distinct entitlement nodes
 * that link directly to it in this graph.
 *
 * The full graph shares reference nodes between people, while a drill-down and
 * its filters retain only a subset of those links. Calculate from the supplied
 * edges rather than retaining a count from an earlier, larger graph, so the
 * card always agrees with the links presently shown.
 *
 * The input is never mutated. Nodes whose count is already current retain
 * their identity, which keeps pure filter no-op results stable.
 */
export function withAttributeEntitlementCounts(graph: AccessGraphData): AccessGraphData {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]))
  const entitlementIdsByAttribute = new Map<string, Set<string>>()

  for (const edge of graph.edges) {
    if (kinds.get(edge.from) !== 'entitlement' || kinds.get(edge.to) !== 'attribute') {
      continue
    }
    const entitlementIds = entitlementIdsByAttribute.get(edge.to) ?? new Set<string>()
    entitlementIds.add(edge.from)
    entitlementIdsByAttribute.set(edge.to, entitlementIds)
  }

  let changed = false
  const nodes = graph.nodes.map((node) => {
    if (node.kind !== 'attribute') return node
    const entitlementCount = String(entitlementIdsByAttribute.get(node.id)?.size ?? 0)
    if (node.detail?.entitlementCount === entitlementCount) return node
    changed = true
    return {
      ...node,
      detail: { ...node.detail, entitlementCount },
    }
  })

  return changed ? { ...graph, nodes } : graph
}
