import { describe, expect, it } from 'vitest'
import { emptyResolvedIdentity } from '../sailpoint/identities'
import type { AccessGraphData } from '../sailpoint/types'
import { withUserIdentities } from './userIdentity'

function graph(): AccessGraphData {
  return {
    nodes: [
      { id: 'user:u1', kind: 'user', label: 'User One' },
      { id: 'role:role-a', kind: 'role', label: 'Role A' },
    ],
    edges: [],
  }
}

describe('withUserIdentities', () => {
  it('stamps isManager onto the matching user node and leaves other nodes alone', () => {
    const source = graph()
    const next = withUserIdentities(source, {
      u1: emptyResolvedIdentity({ identityId: 'u1', isManager: 'Yes', email: 'a@b.c' }),
    })
    expect(next.nodes[0].detail?.isManager).toBe('Yes')
    expect(next.nodes[0].detail?.email).toBe('a@b.c')
    expect(next.nodes[1]).toBe(source.nodes[1])
    expect(next.edges).toBe(source.edges)
  })

  it('keeps a detail field the node already has', () => {
    const source = graph()
    source.nodes[0].detail = { isManager: 'No', department: 'Finance' }
    const next = withUserIdentities(source, {
      u1: emptyResolvedIdentity({ isManager: 'Yes', department: 'Other', title: 'Engineer' }),
    })
    expect(next.nodes[0].detail?.isManager).toBe('No')
    expect(next.nodes[0].detail?.department).toBe('Finance')
    expect(next.nodes[0].detail?.title).toBe('Engineer')
  })

  it('names the user node from first and last name', () => {
    const next = withUserIdentities(graph(), {
      u1: emptyResolvedIdentity({ firstName: 'Ada', lastName: 'Lovelace', title: 'Engineer' }),
    })
    expect(next.nodes[0].label).toBe('Ada Lovelace')
    expect(next.nodes[0].detail?.title).toBe('Engineer')
  })

  it('copies the identity attribute list, and keeps one the node already has', () => {
    const stamped = withUserIdentities(graph(), {
      u1: emptyResolvedIdentity({
        attributes: [
          ['employeeNumber', '900'],
          ['jobTitle', 'Sales Manager'],
        ],
      }),
    })
    expect(stamped.nodes[0].detail?.attributes).toEqual([
      ['employeeNumber', '900'],
      ['jobTitle', 'Sales Manager'],
    ])

    const source = graph()
    source.nodes[0].detail = { attributes: [['department', 'Finance']] }
    const kept = withUserIdentities(source, {
      u1: emptyResolvedIdentity({ attributes: [['department', 'Sales']] }),
    })
    expect(kept.nodes[0].detail?.attributes).toEqual([['department', 'Finance']])
  })

  it('returns the same graph when there is nothing to add', () => {
    const source = graph()
    expect(withUserIdentities(source, {})).toBe(source)
  })
})
