import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import type { AccessSceneNode } from './buildAccessScene'
import {
  ARRIVING_CLASS,
  ENTERING_CLASS,
  EXITING_CLASS,
  MAX_ANIMATED_NODES,
  REVEAL_CLASS,
  SETTLING_CLASS,
  arrange,
  classifyById,
  exceedsAnimationBudget,
  frameOrder,
  hasClassToken,
  highlightFrameEdges,
  isFramePlaced,
  markExiting,
  markExitingEdge,
  movedNodeIds,
  needsSettle,
  originPosition,
  parseMotionMs,
  planTransition,
  resolveOriginPositions,
  revealDelayMs,
  stageRevealNodes,
  stripTransitionClasses,
  withTransitionClass,
} from './graphTransition'

function node(id: string, x = 0, y = 0, extra: Partial<AccessSceneNode> = {}): AccessSceneNode {
  return {
    id,
    type: 'access',
    position: { x, y },
    width: 200,
    height: 64,
    data: { kind: 'entitlement', label: id },
    ...extra,
  } as AccessSceneNode
}
function edge(source: string, target: string, className?: string): Edge {
  return { id: `e:${source}:${target}`, source, target, className }
}
const ids = (items: { id: string }[]) => items.map((item) => item.id)
const byId = (nodes: AccessSceneNode[]) => new Map(nodes.map((n) => [n.id, n]))

describe('classifyById', () => {
  it('splits staying, entering and exiting ids', () => {
    const result = classifyById([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])
    expect([...result.staying]).toEqual(['b'])
    expect([...result.entering]).toEqual(['c'])
    expect([...result.exiting]).toEqual(['a'])
  })
})

describe('class helpers', () => {
  it('appends a transition token to the existing classes', () => {
    expect(withTransitionClass('vc-graph-edge-status vc-graph-edge-needsReview', ENTERING_CLASS)).toBe(
      'vc-graph-edge-status vc-graph-edge-needsReview entering',
    )
    expect(withTransitionClass(undefined, EXITING_CLASS)).toBe('exiting')
  })
  it('never stacks or duplicates transition tokens', () => {
    const once = withTransitionClass('vc-graph-edge-reference', ENTERING_CLASS)
    expect(withTransitionClass(once, EXITING_CLASS)).toBe('vc-graph-edge-reference exiting')
    expect(withTransitionClass('a entering entering', ENTERING_CLASS)).toBe('a entering')
  })
  it('returns undefined instead of an empty class', () => {
    expect(withTransitionClass(undefined)).toBeUndefined()
    expect(withTransitionClass('entering')).toBeUndefined()
    expect(stripTransitionClasses('exiting reveal')).toBeUndefined()
  })
  it('strips every transition token but keeps the others', () => {
    expect(
      stripTransitionClasses(`keep entering exiting ${REVEAL_CLASS} ${SETTLING_CLASS} ${ARRIVING_CLASS} also`),
    ).toBe('keep also')
  })
  it('matches whole tokens only', () => {
    expect(hasClassToken('a entering-soon', 'entering')).toBe(false)
    expect(hasClassToken('a entering', 'entering')).toBe(true)
  })
})

describe('reveal delay', () => {
  it('uses the lead for zero or one card', () => {
    expect(revealDelayMs(0, 0, 450)).toBe(450)
    expect(revealDelayMs(0, 1, 450)).toBe(450)
  })
  it('steps 70ms for small counts', () => {
    expect(revealDelayMs(0, 5, 0)).toBe(0)
    expect(revealDelayMs(3, 5, 0)).toBe(210)
    expect(revealDelayMs(2, 5, 450)).toBe(590)
  })
  it('caps the cascade at 1400ms for large counts', () => {
    expect(revealDelayMs(39, 40, 0)).toBe(1400)
    expect(revealDelayMs(199, 200, 0)).toBe(1400)
    expect(revealDelayMs(199, 200, 450)).toBe(1850)
  })
})

describe('stageRevealNodes', () => {
  const delay = (n: AccessSceneNode) => (n.style as Record<string, string> | undefined)?.['--reveal-delay']
  it('reveals new cards with a staggered delay and leaves the position alone', () => {
    const next = [node('a', 1, 2), node('b', 3, 4)]
    const staged = stageRevealNodes(next, new Map(), 100)
    expect(staged.map((n) => n.className)).toEqual(['reveal', 'reveal'])
    expect(staged.map(delay)).toEqual(['100ms', '170ms'])
    expect(staged[1].position).toEqual({ x: 3, y: 4 })
  })
  it('keeps the class and delay of a card still revealing, so a reflow does not replay it', () => {
    const first = stageRevealNodes([node('a'), node('b'), node('c')], new Map(), 0)
    const moved = [node('c', 9, 9), node('a', 5, 5), node('d')]
    const staged = stageRevealNodes(moved, byId(first), 0)
    expect(staged[0].className).toBe('reveal')
    expect(delay(staged[0])).toBe(delay(first[2]))
    expect(delay(staged[1])).toBe(delay(first[0]))
    expect(delay(staged[2])).toBe('140ms')
  })
  it('does not reveal a card already on screen that is not revealing', () => {
    const shown = node('a')
    const target = node('a', 5, 5)
    const staged = stageRevealNodes([target], byId([shown]), 0)
    expect(staged[0]).toBe(target)
  })
})

describe('originPosition', () => {
  const prev = byId([node('p', 10, 20), node('q', 30, 40)])
  it('starts at the previous-frame neighbour linked by an incoming edge', () => {
    const n = node('n', 500, 500)
    expect(originPosition(n, [n], [edge('p', 'n')], prev)).toEqual({ x: 10, y: 20 })
  })
  it('then by an outgoing edge', () => {
    const n = node('n', 500, 500)
    expect(originPosition(n, [n], [edge('n', 'q')], prev)).toEqual({ x: 30, y: 40 })
  })
  it('then at the laid-out parent', () => {
    const parent = node('parent', 70, 80)
    const n = node('n', 500, 500)
    expect(originPosition(n, [parent, n], [edge('parent', 'n')], prev)).toEqual({ x: 70, y: 80 })
  })
  it('falls back to 24px below its own position', () => {
    const n = node('n', 500, 500)
    expect(originPosition(n, [n], [], prev)).toEqual({ x: 500, y: 524 })
  })
})

describe('resolveOriginPositions', () => {
  it('starts a second-hop card at the first hop origin, not at its parent final position', () => {
    const user = node('user', 0, 0)
    const role = node('role', 300, 100)
    const ap = node('ap', 600, 200)
    const origins = resolveOriginPositions(
      [user, role, ap],
      [edge('user', 'role'), edge('role', 'ap')],
      byId([node('user', 0, 0)]),
    )
    expect(origins.get('role')).toEqual({ x: 0, y: 0 })
    expect(origins.get('ap')).toEqual({ x: 0, y: 0 })
  })
  it('falls back to originPosition when no path reaches a card on screen', () => {
    const lone = node('lone', 5, 5)
    const origins = resolveOriginPositions([lone], [], new Map())
    expect(origins.get('lone')).toEqual({ x: 5, y: 29 })
  })
})

describe('moved nodes and settling edges', () => {
  it('reports only cards that move more than half a pixel', () => {
    const moved = movedNodeIds(byId([node('a', 0, 0), node('b', 0, 0)]), [node('a', 0.2, 0), node('b', 0, 3)])
    expect([...moved]).toEqual(['b'])
  })
  it('settles an edge whose source or target moves', () => {
    expect(needsSettle(edge('a', 'b'), new Set(['b']))).toBe(true)
    expect(needsSettle(edge('a', 'b'), new Set(['c']))).toBe(false)
  })
})

describe('markExiting', () => {
  it('appends exiting, removes the card from the tab order and from assistive tech', () => {
    const marked = markExiting(node('a', 1, 2, { className: 'x entering' }))
    expect(marked.className).toBe('x exiting')
    expect(marked.focusable).toBe(false)
    expect(marked.domAttributes).toMatchObject({ 'aria-hidden': true, inert: true })
    expect(marked.measured).toEqual({ width: 200, height: 64 })
  })
  it('marks an edge without losing its status class', () => {
    const marked = markExitingEdge(edge('a', 'b', 'vc-graph-edge-status vc-graph-edge-revoked'))
    expect(marked.className).toBe('vc-graph-edge-status vc-graph-edge-revoked exiting')
    expect(marked.focusable).toBe(false)
  })
})

describe('size guard', () => {
  it('allows exactly the maximum and rejects one more', () => {
    expect(exceedsAnimationBudget(MAX_ANIMATED_NODES - 10, 10)).toBe(false)
    expect(exceedsAnimationBudget(MAX_ANIMATED_NODES - 10, 11)).toBe(true)
  })
})

describe('frameOrder and arrange', () => {
  it('keeps the previous order first, then new ids in target order', () => {
    expect(frameOrder([{ id: 'b' }, { id: 'a' }, { id: 'x' }], [{ id: 'n2' }, { id: 'a' }, { id: 'n1' }])).toEqual([
      'b',
      'a',
      'x',
      'n2',
      'n1',
    ])
  })
  it('lists items in that order and skips ids without an item', () => {
    expect(ids(arrange(['b', 'gone', 'a'], [{ id: 'a' }, { id: 'b' }]))).toEqual(['b', 'a'])
  })
})

describe('planTransition', () => {
  const user = node('user', 0, 0)
  const role = node('role', 300, 0)
  const e1 = edge('user', 'role', 'vc-graph-edge-status vc-graph-edge-needsReview')

  it('is immediate when motion is 0', () => {
    const plan = planTransition({
      previous: { nodes: [user], edges: [] },
      nextNodes: [user, role],
      nextEdges: [e1],
      reveal: 'instant',
      motionMs: 0,
    })
    expect(plan.kind).toBe('immediate')
  })
  it('is immediate with an empty previous frame (instant reveal)', () => {
    const plan = planTransition({
      previous: { nodes: [], edges: [] },
      nextNodes: [user],
      nextEdges: [],
      reveal: 'instant',
      motionMs: 450,
    })
    expect(plan.kind).toBe('immediate')
  })
  it('staggers the very first display with no lead', () => {
    const plan = planTransition({
      previous: { nodes: [], edges: [] },
      nextNodes: [node('a'), node('b')],
      nextEdges: [],
      reveal: 'stagger',
      motionMs: 450,
    })
    expect(plan.kind).toBe('stagger')
    if (plan.kind !== 'stagger') return
    expect(plan.hasExiting).toBe(false)
    expect((plan.start.nodes[0].style as Record<string, string>)['--reveal-delay']).toBe('0ms')
  })
  it('skips the animation past the size guard', () => {
    const many = Array.from({ length: MAX_ANIMATED_NODES }, (_, i) => node(`n${i}`))
    const plan = planTransition({
      previous: { nodes: many, edges: [] },
      nextNodes: [node('extra')],
      nextEdges: [],
      reveal: 'instant',
      motionMs: 450,
    })
    expect(plan.kind).toBe('immediate')
  })
  it('is immediate when nothing changes, in the previous order', () => {
    const a = node('a', 0, 0)
    const b = node('b', 10, 0)
    const plan = planTransition({
      previous: { nodes: [a, b], edges: [] },
      nextNodes: [node('b', 10, 0), node('a', 0, 0)],
      nextEdges: [],
      reveal: 'instant',
      motionMs: 450,
    })
    expect(plan.kind).toBe('immediate')
    if (plan.kind === 'immediate') expect(ids(plan.frame.nodes)).toEqual(['a', 'b'])
  })

  describe('phased', () => {
    const previous = { nodes: [user, node('gone', 100, 100)], edges: [edge('user', 'gone', 'vc-graph-edge-reference')] }
    const plan = planTransition({
      previous,
      nextNodes: [node('user', 0, 0), node('role', 300, 0), node('ap', 600, 0)],
      nextEdges: [e1, edge('role', 'ap', 'vc-graph-edge-reference')],
      reveal: 'instant',
      motionMs: 450,
    })
    if (plan.kind !== 'phased') throw new Error('expected phased')

    it('starts with staying, entering at the origin and exiting cards', () => {
      expect(ids(plan.start.nodes)).toEqual(['user', 'gone', 'role', 'ap'])
      const role = plan.start.nodes.find((n) => n.id === 'role')!
      expect(role.className).toBe('entering')
      expect(role.position).toEqual({ x: 0, y: 0 })
      expect(plan.start.nodes.find((n) => n.id === 'ap')!.position).toEqual({ x: 0, y: 0 })
      expect(plan.start.nodes.find((n) => n.id === 'gone')!.className).toBe('exiting')
      expect(plan.start.nodes.find((n) => n.id === 'user')!.className).toBeUndefined()
    })
    it('appends the transition class to the edge classes instead of replacing them', () => {
      const entering = plan.start.edges.find((e) => e.id === e1.id)!
      expect(entering.className).toBe('vc-graph-edge-status vc-graph-edge-needsReview entering')
      const leaving = plan.start.edges.find((e) => e.id === 'e:user:gone')!
      expect(leaving.className).toBe('vc-graph-edge-reference exiting')
    })
    it('settles the entering cards at their final position and keeps the exiting ones', () => {
      expect(ids(plan.settle.nodes)).toEqual(['user', 'gone', 'role', 'ap'])
      const role = plan.settle.nodes.find((n) => n.id === 'role')!
      expect(role.position).toEqual({ x: 300, y: 0 })
      expect(hasClassToken(role.className, ENTERING_CLASS)).toBe(false)
      expect(plan.settle.nodes.find((n) => n.id === 'gone')!.className).toBe('exiting')
      expect(plan.settle.edges.find((e) => e.id === e1.id)!.className).toBe(
        `vc-graph-edge-status vc-graph-edge-needsReview ${ARRIVING_CLASS}`,
      )
    })
    it('ends with exactly the target ids and no transition classes', () => {
      expect(ids(plan.final.nodes)).toEqual(['user', 'role', 'ap'])
      expect(plan.final.nodes.every((n) => n.className === undefined)).toBe(true)
      expect(plan.final.edges.map((e) => e.className)).toEqual([e1.className, 'vc-graph-edge-reference'])
    })
    it('has unique ids in every frame', () => {
      for (const frame of [plan.start, plan.settle, plan.final]) {
        expect(new Set(ids(frame.nodes)).size).toBe(frame.nodes.length)
        expect(new Set(ids(frame.edges)).size).toBe(frame.edges.length)
      }
    })
    it('keeps the staying card in its DOM slot (no reorder)', () => {
      expect(ids(plan.final.nodes).indexOf('user')).toBe(0)
      expect(plan.start.nodes[0].id).toBe('user')
    })
  })

  it('fades a staying edge in only when one of its cards moves', () => {
    const a = node('a', 0, 0)
    const b = node('b', 100, 0)
    const c = node('c', 200, 0)
    const plan = planTransition({
      previous: { nodes: [a, b, c], edges: [edge('a', 'b'), edge('b', 'c')] },
      nextNodes: [node('a', 0, 0), node('b', 100, 0), node('c', 250, 50)],
      nextEdges: [edge('a', 'b'), edge('b', 'c')],
      reveal: 'instant',
      motionMs: 450,
    })
    if (plan.kind !== 'phased') throw new Error('expected phased')
    expect(plan.start.edges.find((e) => e.id === 'e:a:b')!.className).toBeUndefined()
    expect(plan.start.edges.find((e) => e.id === 'e:b:c')!.className).toBe(SETTLING_CLASS)
    expect(plan.settle.edges.find((e) => e.id === 'e:b:c')!.className).toBe(SETTLING_CLASS)
    expect(plan.final.edges.find((e) => e.id === 'e:b:c')!.className).toBeUndefined()
  })

  it('stagger: reveals cards new to the screen, keeps others, and fades the rest out', () => {
    const plan = planTransition({
      previous: { nodes: [node('user', 0, 0), node('role', 200, 0)], edges: [edge('user', 'role')] },
      nextNodes: [node('user', 50, 50), node('other', 300, 0)],
      nextEdges: [],
      reveal: 'stagger',
      motionMs: 450,
    })
    if (plan.kind !== 'stagger') throw new Error('expected stagger')
    expect(plan.hasExiting).toBe(true)
    expect(ids(plan.start.nodes)).toEqual(['user', 'role', 'other'])
    expect(plan.start.nodes[0].className).toBeUndefined()
    expect(plan.start.nodes.find((n) => n.id === 'other')!.className).toBe('reveal')
    expect(plan.start.nodes.find((n) => n.id === 'role')!.className).toBe('exiting')
    expect(plan.start.edges.map((e) => e.className)).toEqual(['exiting'])
    expect(ids(plan.final.nodes)).toEqual(['user', 'other'])
  })
})

describe('isFramePlaced', () => {
  it('is true when every target card is at its final position and not entering', () => {
    const target = [node('a', 1, 1), node('b', 2, 2)]
    expect(isFramePlaced([...target, markExiting(node('x'))], target)).toBe(true)
  })
  it('is false while a card is entering, elsewhere, or missing', () => {
    const target = [node('a', 1, 1)]
    expect(isFramePlaced([node('a', 1, 1, { className: 'entering' })], target)).toBe(false)
    expect(isFramePlaced([node('a', 0, 0)], target)).toBe(false)
    expect(isFramePlaced([], target)).toBe(false)
  })
})

describe('highlightFrameEdges', () => {
  const status = (id: string, source: string, target: string, className: string): Edge => ({
    id,
    source,
    target,
    className,
    data: { reviewStatus: 'needsReview' },
    style: { stroke: 'x' },
  })
  const item = status('e:user:item', 'user', 'item', 'vc-graph-edge-status vc-graph-edge-needsReview')
  const other = status('e:user:other', 'user', 'other', 'vc-graph-edge-status vc-graph-edge-needsReview')

  it('leaves leaving edges unstyled and keeps their class', () => {
    const leaving = markExitingEdge(status('e:user:gone', 'user', 'gone', 'vc-graph-edge-status'))
    const result = highlightFrameEdges([item, other, leaving], 'item', null)
    const gone = result.find((e) => e.id === 'e:user:gone')!
    expect(gone).toBe(leaving)
    expect(gone.style?.opacity).toBeUndefined()
    expect(gone.className).toContain('exiting')
    expect(result.find((e) => e.id === 'e:user:other')!.style?.opacity).toBeDefined()
  })
  it('restyles entering edges and keeps their entering class', () => {
    const entering: Edge = { ...other, className: `${other.className} entering` }
    const result = highlightFrameEdges([item, entering], 'item', null)
    const restyled = result.find((e) => e.id === entering.id)!
    expect(restyled.className).toContain('entering')
    expect(restyled.className).toContain('vc-graph-edge-needsReview')
    expect(restyled.style?.opacity).toBeDefined()
  })
  it('is exactly highlightEdges when nothing is leaving and nothing is selected', () => {
    const edges = [item, other]
    expect(highlightFrameEdges(edges, null, null)).toBe(edges)
  })
  it('does not walk a leaving edge as lineage', () => {
    const leaving = markExitingEdge({ ...status('e:item:child', 'item', 'child', 'vc-graph-edge-reference') })
    const result = highlightFrameEdges([item, leaving], 'item', null)
    expect(result.find((e) => e.id === 'e:item:child')!.className).not.toContain('vc-graph-edge-lineage')
  })
})

describe('parseMotionMs', () => {
  it.each([
    ['450ms', 450],
    ['0.45s', 450],
    ['0s', 0],
    [' 0ms', 0],
    ['1.5s', 1500],
    ['', 0],
    ['garbage', 0],
    ['-100ms', 0],
    [undefined, 0],
    [null, 0],
  ])('reads %j as %d', (input, expected) => {
    expect(parseMotionMs(input as string | null | undefined)).toBe(expected)
  })
})
