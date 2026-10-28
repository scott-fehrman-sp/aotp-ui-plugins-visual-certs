/**
 * Fills user-node detail from an identity lookup that has already returned.
 *
 * The overview graph is built from review items alone, so a user card has no
 * `isManager` (and no other identity fields) until that user's identity is
 * fetched. The fetch happens when the user is selected, and it can finish
 * before the rest of their access composition. This stamps the returned
 * identity onto the user node so the manager mark and the detail panel update
 * as soon as the identity is known, instead of waiting for the composition
 * graph to replace the card — and so the mark survives going back to the grid.
 *
 * Existing non-empty detail on the node wins, so a fully resolved user node is
 * left as it is. Returns the same graph when nothing changes.
 */
import type { ResolvedIdentity } from '../sailpoint/identities'
import type { AccessGraphData, NodeDetail } from '../sailpoint/types'

const USER_PREFIX = 'user:'

/** Identity fields on a user node. All strings; the attribute list is not one. */
type IdentityDetailKey = {
  [K in keyof NodeDetail]-?: NodeDetail[K] extends string | undefined ? K : never
}[keyof NodeDetail]

function fill(detail: NodeDetail, key: IdentityDetailKey, value: string): boolean {
  if (!value || detail[key]) return false
  detail[key] = value
  return true
}

/** Identity fields the user card and its detail panel render. */
export function detailFromIdentity(identity: ResolvedIdentity): NodeDetail {
  const detail: NodeDetail = {}
  fill(detail, 'firstName', identity.firstName)
  fill(detail, 'lastName', identity.lastName)
  fill(detail, 'department', identity.department)
  fill(detail, 'location', identity.location)
  fill(detail, 'country', identity.country)
  fill(detail, 'email', identity.email)
  fill(detail, 'title', identity.title)
  fill(detail, 'phone', identity.phone)
  fill(detail, 'isManager', identity.isManager)
  fill(detail, 'manager', identity.manager)
  fill(detail, 'lifecycleState', identity.lifecycleState)
  fill(detail, 'identityState', identity.identityState)
  fill(detail, 'identityId', identity.identityId)
  if (identity.attributes.length > 0) detail.attributes = identity.attributes
  return detail
}

export function withUserIdentities(
  graph: AccessGraphData,
  identities: Readonly<Record<string, ResolvedIdentity | undefined>>,
): AccessGraphData {
  const ids = Object.keys(identities)
  if (ids.length === 0) return graph

  let changed = false
  const nodes = graph.nodes.map((node) => {
    if (node.kind !== 'user' || !node.id.startsWith(USER_PREFIX)) return node
    const identity = identities[node.id.slice(USER_PREFIX.length)]
    if (!identity) return node
    const detail: NodeDetail = { ...node.detail }
    const incoming = detailFromIdentity(identity)
    let filled = false
    for (const key of Object.keys(incoming)) {
      if (key === 'attributes') continue
      const field = key as IdentityDetailKey
      const value = incoming[field]
      if (typeof value === 'string' && fill(detail, field, value)) filled = true
    }
    // The attribute list is the whole tenant map, not one of the named
    // fields. A node that already carries one keeps it.
    if (incoming.attributes?.length && !detail.attributes?.length) {
      detail.attributes = incoming.attributes
      filled = true
    }
    const name = [identity.firstName, identity.lastName]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ')
    const label = name || node.label
    if (!filled && label === node.label) return node
    changed = true
    return { ...node, label, detail }
  })

  return changed ? { nodes, edges: graph.edges } : graph
}
