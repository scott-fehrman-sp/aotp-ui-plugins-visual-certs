import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'

// Regression: edge endpoints drifted 8-17px inside the cards because React Flow
// measures each <Handle> once (getBoundingClientRect) and caches the offsets,
// and the handles were children of `.vc-graph-card`, which is scaled to 94%
// while a card enters/reveals and has a 4px left stripe. jsdom has no layout, so
// these tests pin the structural invariant that keeps the measurement honest:
// handles are children of the React Flow node wrapper, and the scale is only
// ever applied to the card.

const HANDLE_IDS = [
  'top-in',
  'top-out',
  'bottom-in',
  'bottom-out',
  'left-in',
  'left-out',
  'right-in',
  'right-out',
]

function row(overrides: Partial<StatusRow>): StatusRow {
  return {
    id: 'r',
    userId: 'u1',
    user: 'User One',
    role: '',
    roleId: null,
    accessProfile: '',
    accessProfileId: null,
    entitlement: '',
    entitlementId: null,
    source: '',
    sourceId: null,
    unresolved: false,
    ...overrides,
  } as AccessMatrixRowVM & StatusRow
}

function graph() {
  return statusGraph([
    row({
      id: '1',
      userId: 'u1',
      user: 'User One',
      role: 'Role A',
      roleId: 'role-a',
      accessProfile: 'foo',
      accessProfileId: 'ap-foo',
      entitlement: 'read',
      entitlementId: 'e1',
      source: 'engr db',
      sourceId: 's1',
      reviewStatus: 'needsReview',
      accessItemKind: 'role',
      accessItemId: 'role-a',
    }),
    row({
      id: '2',
      userId: 'u2',
      user: 'User Two',
      entitlement: 'write',
      entitlementId: 'e2',
      source: 'accounting db',
      sourceId: 's2',
    }),
  ])
}

function nodeWrappers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.react-flow__node'))
}

function expectHandlesOnWrappers(container: HTMLElement) {
  const wrappers = nodeWrappers(container)
  expect(wrappers.length).toBeGreaterThan(0)
  for (const wrapper of wrappers) {
    const handles = Array.from(wrapper.querySelectorAll<HTMLElement>('.react-flow__handle'))
    expect(handles.map((h) => h.getAttribute('data-handleid'))).toEqual(HANDLE_IDS)
    for (const handle of handles) {
      const id = handle.getAttribute('data-handleid') ?? ''
      // Direct child of the node wrapper: never inside the scaled, bordered card.
      expect(handle.parentElement).toBe(wrapper)
      expect(handle.closest('.vc-graph-card')).toBeNull()
      expect(handle.classList.contains(id.endsWith('-out') ? 'source' : 'target')).toBe(true)
    }
    const card = wrapper.querySelector('.vc-graph-card')
    expect(card).not.toBeNull()
    expect(card?.querySelector('.react-flow__handle')).toBeNull()
  }
}

describe('AccessNode handles', () => {
  it('overview grid: the eight handles are children of the node wrapper, not of the card', () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    expectHandlesOnWrappers(container)
    const card = screen.getByRole('button', { name: 'Show access for User One' })
    // The tooltip measures its anchor's first element child; it must stay the card.
    expect(card.parentElement?.firstElementChild).toBe(card)
  })

  it('drill-down: the eight handles are children of the node wrapper, not of the card', () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expectHandlesOnWrappers(container)
    const card = screen.getByLabelText('Role: Role A')
    expect(card.parentElement?.firstElementChild).toBe(card)
  })
})

describe('AccessGraph.css', () => {
  // Strip comments and @keyframes blocks (their from/to frames legitimately use
  // scale()), then split into flat `selectors { declarations }` rules. Rules
  // inside @media come out as their own flat rules too.
  // Read from disk: vitest runs with `css: false`, which empties `?raw` imports.
  const css = readFileSync(resolve(process.cwd(), 'src/graph/AccessGraph.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()),
    body: m[2],
  }))
  const setsTransform = (body: string) => /(?:^|[\s;])transform\s*:/.test(body)

  it('scaling stays on the card, never on an ancestor of the handles', () => {
    const scaling = rules.filter((r) => r.body.includes('scale('))
    expect(scaling.length).toBeGreaterThan(0)
    for (const rule of scaling) {
      for (const selector of rule.selectors) {
        expect(selector.endsWith('.vc-graph-card')).toBe(true)
      }
    }
  })

  it('never sets a transform on the React Flow node wrapper', () => {
    const wrapperRules = rules.filter((r) =>
      r.selectors.some((s) => /\.react-flow__node(\.[\w-]+)*$/.test(s)),
    )
    expect(wrapperRules.length).toBeGreaterThan(0)
    for (const rule of wrapperRules) {
      expect(setsTransform(rule.body)).toBe(false)
      expect(rule.body).not.toContain('scale(')
    }
  })
})
