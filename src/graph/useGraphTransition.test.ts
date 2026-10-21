import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import type { Edge } from '@xyflow/react'
import type { AccessSceneNode } from './buildAccessScene'
import { MAX_ANIMATED_NODES, type TransitionReveal } from './graphTransition'
import { useGraphTransition } from './useGraphTransition'
import { useMotionMs } from './useMotionMs'

const MOTION = 450

function node(id: string, x = 0, y = 0): AccessSceneNode {
  return {
    id,
    type: 'access',
    position: { x, y },
    width: 200,
    height: 64,
    data: { kind: 'entitlement', label: id },
  } as AccessSceneNode
}
function edge(source: string, target: string): Edge {
  return { id: `e:${source}:${target}`, source, target, className: 'vc-graph-edge-reference' }
}

interface Props {
  nodes: AccessSceneNode[]
  edges: Edge[]
  key: string
  ms: number
  reveal: TransitionReveal
}
const props = (p: Partial<Props> & Pick<Props, 'nodes' | 'edges'>): Props => ({
  key: 'k',
  ms: MOTION,
  reveal: 'instant',
  ...p,
})
const ids = (items: { id: string }[]) => items.map((item) => item.id)
const cls = (nodes: AccessSceneNode[], id: string) => nodes.find((n) => n.id === id)?.className

function setup(initial: Props) {
  return renderHook((p: Props) => useGraphTransition(p.nodes, p.edges, p.key, p.ms, p.reveal), {
    initialProps: initial,
  })
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

const USER = node('user', 0, 0)
const FIRST = props({ nodes: [USER, node('gone', 100, 100)], edges: [edge('user', 'gone')] })
const SECOND = props({
  key: 'k2',
  nodes: [node('user', 0, 0), node('role', 300, 0), node('ap', 600, 0)],
  edges: [edge('user', 'role'), edge('role', 'ap')],
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useGraphTransition', () => {
  it('applies an empty previous frame immediately (no entering classes)', () => {
    const { result } = setup(FIRST)
    expect(ids(result.current.nodes)).toEqual(['user', 'gone'])
    expect(result.current.nodes.every((n) => n.className === undefined)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('phase 1: staying + entering at the origin + exiting', () => {
    const { result, rerender } = setup(FIRST)
    rerender(SECOND)
    const nodes = result.current.nodes
    expect(ids(nodes)).toEqual(['user', 'gone', 'role', 'ap'])
    expect(cls(nodes, 'role')).toBe('entering')
    expect(nodes.find((n) => n.id === 'role')!.position).toEqual({ x: 0, y: 0 })
    expect(cls(nodes, 'gone')).toBe('exiting')
    expect(cls(nodes, 'user')).toBeUndefined()
    expect(result.current.edges.find((e) => e.id === 'e:user:gone')!.className).toBe(
      'vc-graph-edge-reference exiting',
    )
    expect(result.current.edges.find((e) => e.id === 'e:user:role')!.className).toBe(
      'vc-graph-edge-reference entering',
    )
  })

  it('phase 2: two frames later the entering cards sit at their final position', () => {
    const { result, rerender } = setup(FIRST)
    rerender(SECOND)
    advance(15)
    expect(cls(result.current.nodes, 'role')).toBe('entering')
    advance(17)
    const role = result.current.nodes.find((n) => n.id === 'role')!
    expect(role.position).toEqual({ x: 300, y: 0 })
    expect(role.className).toBeUndefined()
    expect(cls(result.current.nodes, 'gone')).toBe('exiting')
  })

  it('does not start the clock before the first frame is committed', () => {
    const { result, rerender } = setup(FIRST)
    rerender(SECOND)
    // The frame is committed by act; nothing has run yet.
    expect(cls(result.current.nodes, 'role')).toBe('entering')
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })

  it('after the motion duration the exiting cards are gone and the frame is the target', () => {
    const { result, rerender } = setup(FIRST)
    rerender(SECOND)
    advance(MOTION - 1)
    expect(ids(result.current.nodes)).toContain('gone')
    advance(1)
    expect(ids(result.current.nodes)).toEqual(['user', 'role', 'ap'])
    expect(result.current.nodes.every((n) => n.className === undefined)).toBe(true)
    expect(result.current.edges.map((e) => e.className)).toEqual([
      'vc-graph-edge-reference',
      'vc-graph-edge-reference',
    ])
    expect(result.current.key).toBe('k2')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns the target arrays untouched when motion is 0', () => {
    const { result, rerender } = setup(props({ ...FIRST, ms: 0 }))
    expect(result.current.nodes).toBe(FIRST.nodes)
    rerender(props({ ...SECOND, ms: 0 }))
    expect(result.current.nodes).toBe(SECOND.nodes)
    expect(result.current.edges).toBe(SECOND.edges)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a second update mid-transition cancels the first and ends in the second target', () => {
    const { result, rerender } = setup(FIRST)
    rerender(SECOND)
    advance(100)
    const THIRD = props({
      key: 'k3',
      nodes: [node('user', 0, 0), node('role', 300, 0), node('extra', 900, 0)],
      edges: [edge('user', 'role'), edge('role', 'extra')],
    })
    rerender(THIRD)
    const unique = (list: { id: string }[]) => new Set(ids(list)).size === list.length
    expect(unique(result.current.nodes)).toBe(true)
    expect(unique(result.current.edges)).toBe(true)
    advance(MOTION + 20)
    expect(ids(result.current.nodes)).toEqual(['user', 'role', 'extra'])
    expect(result.current.nodes.every((n) => n.className === undefined)).toBe(true)
    expect(result.current.nodes.find((n) => n.id === 'extra')!.position).toEqual({ x: 900, y: 0 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a card that returns while exiting stays and loses its exiting class', () => {
    const { result, rerender } = setup(FIRST)
    rerender(SECOND)
    advance(50)
    rerender(props({ ...FIRST, key: 'k4' }))
    advance(MOTION + 20)
    expect(ids(result.current.nodes)).toEqual(['user', 'gone'])
    expect(result.current.nodes.every((n) => n.className === undefined)).toBe(true)
  })

  it('applies instantly past the size guard', () => {
    const big = Array.from({ length: MAX_ANIMATED_NODES }, (_, i) => node(`n${i}`, i, 0))
    const { result, rerender } = setup(props({ nodes: big, edges: [] }))
    rerender(props({ key: 'k2', nodes: [node('other')], edges: [] }))
    expect(ids(result.current.nodes)).toEqual(['other'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmounting clears every timer and frame', () => {
    const { rerender, unmount } = setup(FIRST)
    rerender(SECOND)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('stagger', () => {
    const grid = (n: number, x = 0) => Array.from({ length: n }, (_, i) => node(`u${i}`, x + i * 10, 0))
    const delay = (n: AccessSceneNode) => (n.style as Record<string, string> | undefined)?.['--reveal-delay']

    it('is born staged on the first render', () => {
      const { result } = setup(props({ nodes: grid(3), edges: [], reveal: 'stagger' }))
      expect(result.current.nodes.map((n) => n.className)).toEqual(['reveal', 'reveal', 'reveal'])
      expect(result.current.nodes.map(delay)).toEqual(['0ms', '70ms', '140ms'])
    })

    it('a reflow keeps the delays of the cards on screen and does not replay the cascade', () => {
      const { result, rerender } = setup(props({ nodes: grid(3), edges: [], reveal: 'stagger' }))
      const before = result.current.nodes.map(delay)
      rerender(props({ key: 'k2', nodes: grid(3, 40), edges: [], reveal: 'stagger' }))
      expect(result.current.nodes.map(delay)).toEqual(before)
      expect(result.current.nodes[0].position.x).toBe(40)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('returning to the grid: the clicked card stays, the lineage fades out and is removed', () => {
      const { result, rerender } = setup(props({ nodes: [node('user'), node('role', 300, 0)], edges: [edge('user', 'role')] }))
      rerender(props({ key: 'g', nodes: [node('user', 50, 50), node('other', 300, 0)], edges: [], reveal: 'stagger' }))
      expect(cls(result.current.nodes, 'user')).toBeUndefined()
      expect(cls(result.current.nodes, 'other')).toBe('reveal')
      expect(cls(result.current.nodes, 'role')).toBe('exiting')
      advance(MOTION)
      expect(ids(result.current.nodes)).toEqual(['user', 'other'])
    })
  })
})

describe('useMotionMs', () => {
  it('the override wins', () => {
    const ref = createRef<HTMLElement>()
    const { result } = renderHook(() => useMotionMs(450, ref))
    expect(result.current).toBe(450)
  })
  it('is 0 where no stylesheet defines --motion-ms (jsdom)', () => {
    const ref = createRef<HTMLElement>()
    const { result } = renderHook(() => useMotionMs(undefined, ref))
    expect(result.current).toBe(0)
  })
  it('reads the token from the computed style', () => {
    document.documentElement.style.setProperty('--motion-ms', '300ms')
    try {
      const ref = createRef<HTMLElement>()
      const { result } = renderHook(() => useMotionMs(undefined, ref))
      expect(result.current).toBe(300)
    } finally {
      document.documentElement.style.removeProperty('--motion-ms')
    }
  })
})
