import { Graph, layout } from '@dagrejs/dagre'
import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type {
  AccessGraphData,
  AccessGraphNodeKind,
  AccessReviewStatus,
} from '../sailpoint/types'
import { statusSubgraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import {
  buildAccessScene,
  CARD_Z_INDEX,
  MAX_ITEMS_PER_LANE,
  NODE_HEIGHT,
  NODE_USER_HEIGHT,
  NODE_WIDTH,
  nodeHeightFor,
  splitLane,
  WRAP_GAP,
  type AccessScene,
} from './buildAccessScene'
import { withoutCompleted } from './completedFilter'
import { isStatusEdge, withoutReference } from './referenceFilter'

type Dir = 'LR' | 'TB'
const DIRS: Dir[] = ['LR', 'TB']
const RANK_SEP = 120
const MARGIN = 24
const NODE_SEP = 48

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
  }
}

const pad = (i: number) => String(i + 1).padStart(3, '0')

/** `n` first-level entitlements (one shared source), `done` of them approved. */
function ents(n: number, done = 0, sourceFor?: (i: number) => string): StatusRow[] {
  return Array.from({ length: n }, (_, i) => {
    const sourceId = sourceFor ? sourceFor(i) : 's1'
    return row({
      id: `e${pad(i)}`,
      entitlement: `Ent ${pad(i)}`,
      entitlementId: `e${pad(i)}`,
      source: `Source ${sourceId}`,
      sourceId,
      reviewStatus: i < done ? 'approved' : 'needsReview',
      accessItemKind: 'entitlement',
      accessItemId: `e${pad(i)}`,
      accessItemName: `Ent ${pad(i)}`,
    })
  })
}
/** `n` first-level roles with no nested content. */
function roles(n: number, status: AccessReviewStatus = 'needsReview'): StatusRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      id: `r${pad(i)}`,
      role: `Role ${pad(i)}`,
      roleId: `r${pad(i)}`,
      reviewStatus: status,
      accessItemKind: 'role',
      accessItemId: `r${pad(i)}`,
      accessItemName: `Role ${pad(i)}`,
    }),
  )
}
/** `n` first-level access profiles with no nested content. */
function aps(n: number): StatusRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      id: `a${pad(i)}`,
      accessProfile: `AP ${pad(i)}`,
      accessProfileId: `a${pad(i)}`,
      reviewStatus: 'needsReview',
      accessItemKind: 'accessProfile',
      accessItemId: `a${pad(i)}`,
      accessItemName: `AP ${pad(i)}`,
    }),
  )
}

const rankOf = (n: { position: { x: number; y: number } }, d: Dir) =>
  d === 'LR' ? n.position.x : n.position.y
const crossOf = (n: { position: { x: number; y: number } }, d: Dir) =>
  d === 'LR' ? n.position.y : n.position.x

const lane = (scene: AccessScene, kind: AccessGraphNodeKind) =>
  scene.nodes.filter((n) => n.data.kind === kind)

/** A lane's nodes grouped by rank coordinate (ascending); each group by cross. */
function subLanes(scene: AccessScene, kind: AccessGraphNodeKind, d: Dir) {
  const groups = new Map<number, AccessScene['nodes']>()
  for (const n of lane(scene, kind)) {
    const g = groups.get(rankOf(n, d)) ?? []
    g.push(n)
    groups.set(rankOf(n, d), g)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, nodes]) => ({
      rank,
      nodes: [...nodes].sort((a, b) => crossOf(a, d) - crossOf(b, d)),
    }))
}
const sizes = (scene: AccessScene, kind: AccessGraphNodeKind, d: Dir) =>
  subLanes(scene, kind, d).map((s) => s.nodes.length)
const ranks = (scene: AccessScene, kind: AccessGraphNodeKind, d: Dir) =>
  subLanes(scene, kind, d).map((s) => s.rank)

const SUB_STEP = (d: Dir) => (d === 'LR' ? NODE_WIDTH : NODE_HEIGHT) + WRAP_GAP
const CROSS_STRIDE = (d: Dir) => (d === 'LR' ? NODE_HEIGHT : NODE_WIDTH) + NODE_SEP

const graphOf = (rows: StatusRow[]) => statusSubgraph(rows)
const sceneOf = (rows: StatusRow[], d: Dir) => buildAccessScene(graphOf(rows), d)

describe('splitLane', () => {
  it('keeps 0..10 items in one chunk', () => {
    for (let n = 0; n <= MAX_ITEMS_PER_LANE; n++) {
      const items = Array.from({ length: n }, (_, i) => i)
      expect(splitLane(items).map((c) => c.length)).toEqual([n])
    }
  })

  it('splits into balanced chunks (larger chunks first)', () => {
    const sizeOf = (n: number) =>
      splitLane(Array.from({ length: n }, (_, i) => i)).map((c) => c.length)
    expect(sizeOf(11)).toEqual([6, 5])
    expect(sizeOf(20)).toEqual([10, 10])
    expect(sizeOf(21)).toEqual([7, 7, 7])
    expect(sizeOf(25)).toEqual([9, 8, 8])
    expect(sizeOf(30)).toEqual([10, 10, 10])
    expect(sizeOf(31)).toEqual([8, 8, 8, 7])
    expect(sizeOf(100)).toEqual(Array(10).fill(10))
  })

  it('is sum-preserving, bounded, balanced and order-preserving for 1..200', () => {
    for (let n = 1; n <= 200; n++) {
      const items = Array.from({ length: n }, (_, i) => i)
      const copy = [...items]
      const chunks = splitLane(items)
      const lens = chunks.map((c) => c.length)
      expect(lens.reduce((a, b) => a + b, 0)).toBe(n)
      expect(Math.max(...lens)).toBeLessThanOrEqual(MAX_ITEMS_PER_LANE)
      expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1)
      expect(chunks).toHaveLength(Math.ceil(n / MAX_ITEMS_PER_LANE))
      expect(chunks.flat()).toEqual(items)
      expect(items).toEqual(copy)
    }
  })
})

describe('lane wrap past MAX_ITEMS_PER_LANE', () => {
  it('uses the documented constants', () => {
    expect(MAX_ITEMS_PER_LANE).toBe(10)
    expect(WRAP_GAP).toBe(40)
  })

  for (const d of DIRS) {
    describe(d, () => {
      it('10 items stay in ONE lane laid out on the single-lane formula; 11 wrap into two', () => {
        const ten = sceneOf(ents(10), d)
        const crosses = lane(ten, 'entitlement')
          .map((n) => crossOf(n, d))
          .sort((a, b) => a - b)
        expect(sizes(ten, 'entitlement', d)).toEqual([10])
        expect(crosses[0]).toBe(-(9 * CROSS_STRIDE(d)) / 2)
        crosses.forEach((c, i) => expect(c).toBe(crosses[0] + i * CROSS_STRIDE(d)))
        expect(sizes(sceneOf(ents(11), d), 'entitlement', d)).toEqual([6, 5])
      })

      it('wraps roles, access profiles and entitlements alike', () => {
        for (const make of [roles, aps, ents]) {
          const kind =
            make === roles ? 'role' : make === aps ? 'accessProfile' : 'entitlement'
          expect(sizes(sceneOf(make(10), d), kind, d)).toEqual([10])
          expect(sizes(sceneOf(make(11), d), kind, d)).toEqual([6, 5])
        }
      })

      it('splits 11 / 20 / 21 / 25 / 31 as 6+5, 10+10, 7x3, 9+8+8, 8+8+8+7 (<= 10 each)', () => {
        const expected: Record<number, number[]> = {
          11: [6, 5],
          20: [10, 10],
          21: [7, 7, 7],
          25: [9, 8, 8],
          31: [8, 8, 8, 7],
        }
        for (const [n, want] of Object.entries(expected)) {
          const got = sizes(sceneOf(ents(Number(n)), d), 'entitlement', d)
          expect(got).toEqual(want)
          for (const s of got) expect(s).toBeLessThanOrEqual(MAX_ITEMS_PER_LANE)
        }
      })

      it('steps sub-lanes by card extent + WRAP_GAP and centers each on cross 0', () => {
        const scene = sceneOf(ents(25), d)
        const subs = subLanes(scene, 'entitlement', d)
        subs.forEach((sub, i) => {
          if (i > 0) expect(sub.rank - subs[i - 1].rank).toBe(SUB_STEP(d))
          const crosses = sub.nodes.map((n) => crossOf(n, d))
          crosses.forEach((c, j) => {
            if (j > 0) expect(c - crosses[j - 1]).toBe(CROSS_STRIDE(d))
          })
          const extent = d === 'LR' ? NODE_HEIGHT : NODE_WIDTH
          const mid = (crosses[0] + crosses[crosses.length - 1] + extent) / 2
          expect(mid).toBeCloseTo(extent / 2, 9)
        })
      })

      it('reads the original single-lane order across sub-lanes (dagre oracle)', () => {
        for (const n of [11, 25, 31]) {
          const graph = graphOf(ents(n))
          const oracle = new Graph()
          oracle.setDefaultEdgeLabel(() => ({}))
          oracle.setGraph({
            rankdir: d,
            nodesep: NODE_SEP,
            ranksep: RANK_SEP,
            ranker: 'network-simplex',
            marginx: MARGIN,
            marginy: MARGIN,
          })
          for (const node of graph.nodes) {
            oracle.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
          }
          for (const edge of graph.edges) oracle.setEdge(edge.from, edge.to)
          layout(oracle)
          const cross = (id: string) =>
            d === 'TB' ? oracle.node(id).x : oracle.node(id).y
          const expected = graph.nodes
            .filter((node) => node.kind === 'entitlement')
            .map((node) => node.id)
            .sort((a, b) => cross(a) - cross(b) || a.localeCompare(b))
          const scene = buildAccessScene(graph, d)
          const actual = subLanes(scene, 'entitlement', d).flatMap((s) =>
            s.nodes.map((node) => node.id),
          )
          expect(actual).toEqual(expected)
        }
      })

      it('lanes of different kinds never overlap and keep the layer order', () => {
        const rows = [...roles(11), ...aps(3), ...ents(25)]
        const scene = sceneOf(rows, d)
        const order: AccessGraphNodeKind[] = ['user', 'role', 'accessProfile', 'entitlement', 'source']
        let previousEnd = -Infinity
        for (const kind of order) {
          const subs = subLanes(scene, kind, d)
          expect(subs[0].rank).toBeGreaterThan(previousEnd)
          previousEnd = subs[subs.length - 1].rank
        }
      })

      it('never overlaps any two cards; gaps are WRAP_GAP inside a type and RANK_SEP between types', () => {
        const fixtures: StatusRow[][] = [
          ents(11),
          ents(25),
          ents(31),
          [...roles(11), ...aps(1), ...ents(12)],
          [...roles(14), ...aps(23), ...ents(41)],
        ]
        const extent = d === 'LR' ? NODE_WIDTH : NODE_HEIGHT
        for (const rows of fixtures) {
          const scene = sceneOf(rows, d)
          const rects = scene.nodes.map((n) => ({
            x0: n.position.x,
            y0: n.position.y,
            x1: n.position.x + NODE_WIDTH,
            y1: n.position.y + NODE_HEIGHT,
          }))
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i]
              const b = rects[j]
              const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0
              expect(apart).toBe(true)
            }
          }
          const kinds: AccessGraphNodeKind[] = ['user', 'role', 'accessProfile', 'entitlement', 'source']
          let prevEnd: number | null = null
          for (const kind of kinds) {
            const subs = subLanes(scene, kind, d)
            if (subs.length === 0) continue
            if (prevEnd !== null) expect(subs[0].rank - prevEnd).toBeGreaterThanOrEqual(RANK_SEP)
            subs.forEach((s, i) => {
              if (i > 0) expect(s.rank - (subs[i - 1].rank + extent)).toBe(WRAP_GAP)
            })
            prevEnd = subs[subs.length - 1].rank + extent
          }
        }
      })
    })
  }

  describe('worked geometry (11 direct entitlements + one source)', () => {
    const rows = ents(11)
    it('LR: columns 240 apart, centered independently, source shifted by one step', () => {
      const scene = sceneOf(rows, 'LR')
      const subs = subLanes(scene, 'entitlement', 'LR')
      expect(subs.map((s) => s.rank)).toEqual([984, 1224])
      expect(subs[0].nodes.map((n) => n.position.y)).toEqual([-280, -168, -56, 56, 168, 280])
      expect(subs[1].nodes.map((n) => n.position.y)).toEqual([-224, -112, 0, 112, 224])
      // The taller user card is lifted by half its extra height so its center
      // stays on the lane axis (top-left y = 0 - (128 - 64) / 2 = -32).
      expect(scene.nodes.find((n) => n.data.kind === 'user')!.position).toEqual({ x: 24, y: -32 })
      expect(lane(scene, 'source')[0].position.x).toBe(1304 + 240)
    })
    it('TB: rows 104 apart, axes swapped, source shifted by one step', () => {
      const scene = sceneOf(rows, 'TB')
      const subs = subLanes(scene, 'entitlement', 'TB')
      expect(subs.map((s) => s.rank)).toEqual([576, 680])
      expect(subs[0].nodes.map((n) => n.position.x)).toEqual([-620, -372, -124, 124, 372, 620])
      expect(subs[1].nodes.map((n) => n.position.x)).toEqual([-496, -248, 0, 248, 496])
      expect(scene.nodes.find((n) => n.data.kind === 'user')!.position).toEqual({ x: 0, y: 24 })
      expect(lane(scene, 'source')[0].position.y).toBe(760 + 104)
    })
    it('a lane of exactly 10 keeps the golden single-lane positions', () => {
      const lr = sceneOf(ents(10), 'LR')
      expect(
        lane(lr, 'entitlement').map((n) => n.position.y).sort((a, b) => a - b),
      ).toEqual([-504, -392, -280, -168, -56, 56, 168, 280, 392, 504])
      expect(new Set(lane(lr, 'entitlement').map((n) => n.position.x))).toEqual(new Set([984]))
      const tb = sceneOf(ents(10), 'TB')
      expect(
        lane(tb, 'entitlement').map((n) => n.position.x).sort((a, b) => a - b),
      ).toEqual([-1116, -868, -620, -372, -124, 124, 372, 620, 868, 1116])
      expect(new Set(lane(tb, 'entitlement').map((n) => n.position.y))).toEqual(new Set([576]))
    })
  })

  describe('later lanes shift (accumulated); earlier lanes and absent slots hold', () => {
    it('LR: 11 roles + 1 access profile + 12 entitlements + source', () => {
      const rows = [...roles(11), ...aps(1), ...ents(12)]
      const scene = sceneOf(rows, 'LR')
      expect(ranks(scene, 'user', 'LR')).toEqual([24])
      expect(ranks(scene, 'role', 'LR')).toEqual([344, 584])
      expect(ranks(scene, 'accessProfile', 'LR')).toEqual([664 + 240])
      expect(ranks(scene, 'entitlement', 'LR')).toEqual([984 + 240, 1224 + 240])
      expect(ranks(scene, 'source', 'LR')).toEqual([1304 + 480])
      // Gap from each lane's last column to the next present lane is RANK_SEP.
      expect(904 - (584 + NODE_WIDTH)).toBe(RANK_SEP)
      expect(1224 - (904 + NODE_WIDTH)).toBe(RANK_SEP)
      expect(1784 - (1464 + NODE_WIDTH)).toBe(RANK_SEP)
    })
    it('TB: same fixture on the y axis', () => {
      const scene = sceneOf([...roles(11), ...aps(1), ...ents(12)], 'TB')
      expect(ranks(scene, 'user', 'TB')).toEqual([24])
      expect(ranks(scene, 'role', 'TB')).toEqual([208, 312])
      expect(ranks(scene, 'accessProfile', 'TB')).toEqual([392 + 104])
      expect(ranks(scene, 'entitlement', 'TB')).toEqual([576 + 104, 680 + 104])
      expect(ranks(scene, 'source', 'TB')).toEqual([760 + 208])
    })
    for (const d of DIRS) {
      it(`${d}: absent kinds keep their slot (no compaction)`, () => {
        const withAps = ranks(sceneOf([...roles(11), ...aps(2), ...ents(3)], d), 'entitlement', d)
        const without = ranks(sceneOf([...roles(11), ...ents(3)], d), 'entitlement', d)
        expect(without).toEqual(withAps)
        const plain = ranks(sceneOf([...roles(3), ...ents(3)], d), 'entitlement', d)
        expect(without[0] - plain[0]).toBe(SUB_STEP(d))
      })
      it(`${d}: a wrapped lane moves nothing before it`, () => {
        const small = sceneOf([...roles(3), ...ents(3)], d)
        const big = sceneOf([...roles(3), ...ents(25)], d)
        for (const kind of ['user', 'role'] as const) {
          const pos = (s: AccessScene) =>
            Object.fromEntries(lane(s, kind).map((n) => [n.id, n.position]))
          expect(pos(big)).toEqual(pos(small))
        }
      })
    }
  })

  describe('user and source lanes never wrap', () => {
    for (const d of DIRS) {
      it(`${d}: user stays alone in lane 0 centered on cross 0; 15 sources stay one lane`, () => {
        const scene = sceneOf(ents(15, 0, (i) => `s${pad(i)}`), d)
        const user = scene.nodes.find((n) => n.data.kind === 'user')!
        expect(rankOf(user, d)).toBe(MARGIN)
        // The user card's cross-axis CENTER sits on the lane axis. The taller
        // user card (NODE_USER_HEIGHT in LR, where the cross axis is Y) is
        // lifted by half its extra height so its center lines up exactly where a
        // standard card's would (top-left at the lane origin, center at
        // extent/2). In TB the extra height is on the rank axis, so the cross
        // position is unchanged.
        const userCrossExtent = d === 'LR' ? NODE_USER_HEIGHT : NODE_WIDTH
        const standardCrossExtent = d === 'LR' ? NODE_HEIGHT : NODE_WIDTH
        expect(crossOf(user, d) + userCrossExtent / 2).toBeCloseTo(
          standardCrossExtent / 2,
          9,
        )
        expect(lane(scene, 'source')).toHaveLength(15)
        expect(sizes(scene, 'source', d)).toEqual([15])
        const crosses = lane(scene, 'source')
          .map((n) => crossOf(n, d))
          .sort((a, b) => a - b)
        for (let i = 1; i < crosses.length; i++) {
          expect(crosses[i] - crosses[i - 1]).toBe(CROSS_STRIDE(d))
        }
        expect(sizes(scene, 'entitlement', d)).toEqual([8, 7])
      })
    }
  })

  describe('only positions change', () => {
    for (const d of DIRS) {
      it(`${d}: ids, data, handles, z-index and edges match the unwrapped contract`, () => {
        const graph = graphOf([...roles(11), ...aps(2), ...ents(25)])
        const scene = buildAccessScene(graph, d)
        const byId = new Map(graph.nodes.map((n) => [n.id, n]))
        expect(scene.nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id))
        for (const node of scene.nodes) {
          const src = byId.get(node.id)!
          expect(node.type).toBe('access')
          expect(node.data.kind).toBe(src.kind)
          expect(node.data.label).toBe(src.label)
          expect(node.data.detail).toEqual(src.detail)
          expect(node.data.reviewStatus).toBe(src.reviewStatus)
          expect(node.data.reviewMixed).toBe(src.reviewMixed)
          expect(node.width).toBe(NODE_WIDTH)
          // The user card is taller; every other kind keeps NODE_HEIGHT.
          expect(node.height).toBe(nodeHeightFor(src.kind))
          expect(node.sourcePosition).toBe(d === 'LR' ? Position.Right : Position.Bottom)
          expect(node.targetPosition).toBe(d === 'LR' ? Position.Left : Position.Top)
          expect(node.draggable).toBe(false)
          expect(node.connectable).toBe(false)
          expect(node.zIndex).toBe(CARD_Z_INDEX)
        }
        expect(scene.edges).toHaveLength(graph.edges.length)
        scene.edges.forEach((edge, i) => {
          const src = graph.edges[i]
          expect(edge.id).toBe(`e:${src.from}:${src.to}`)
          expect(edge.source).toBe(src.from)
          expect(edge.target).toBe(src.to)
          expect(edge.sourceHandle).toBe(d === 'LR' ? 'right-out' : 'bottom-out')
          expect(edge.targetHandle).toBe(d === 'LR' ? 'left-in' : 'top-in')
          if (isStatusEdge(src) && src.reviewStatus) {
            expect(edge.className).toBe(
              `vc-graph-edge-status vc-graph-edge-${src.reviewStatus}`,
            )
            expect(edge.zIndex).toBe(1)
          } else {
            expect(edge.className).toBe('vc-graph-edge-reference')
            expect(edge.zIndex).toBe(0)
            expect(edge.style).toEqual({ stroke: 'var(--edge)', strokeWidth: 1, opacity: 0.45 })
          }
        })
      })

      it(`${d}: is deterministic, does not mutate the input, and a shuffled input keeps the same shape`, () => {
        const graph = graphOf([...roles(12), ...ents(25)])
        const before = JSON.stringify(graph)
        const a = buildAccessScene(graph, d)
        expect(buildAccessScene(graph, d)).toEqual(a)
        expect(JSON.stringify(graph)).toBe(before)
        const shuffled: AccessGraphData = {
          nodes: [...graph.nodes].reverse(),
          edges: [...graph.edges].reverse(),
        }
        const b = buildAccessScene(shuffled, d)
        // dagre's lane order follows insertion order, so compare the SHAPE only.
        for (const kind of ['user', 'role', 'accessProfile', 'entitlement', 'source'] as const) {
          expect(sizes(b, kind, d)).toEqual(sizes(a, kind, d))
          expect(ranks(b, kind, d)).toEqual(ranks(a, kind, d))
          const crossSets = (s: AccessScene) =>
            subLanes(s, kind, d).map((sub) => sub.nodes.map((n) => crossOf(n, d)))
          expect(crossSets(b)).toEqual(crossSets(a))
        }
      })
    }
  })

  describe('counts are taken after the reference / completed filters', () => {
    for (const d of DIRS) {
      it(`${d}: 12 entitlements unwrap when 3 completed ones are hidden and wrap again`, () => {
        const graph = graphOf(ents(12, 3))
        expect(sizes(buildAccessScene(graph, d), 'entitlement', d)).toEqual([6, 6])
        const hidden = withoutCompleted(graph).graph
        const unwrapped = buildAccessScene(hidden, d)
        expect(sizes(unwrapped, 'entitlement', d)).toEqual([9])
        // Restoring recomputes identical positions from the full graph.
        expect(buildAccessScene(graph, d)).toEqual(buildAccessScene(graph, d))
        expect(sizes(buildAccessScene(graph, d), 'entitlement', d)).toEqual([6, 6])
        // The unwrapped output equals what an independent 9-entitlement graph gives.
        const nine = buildAccessScene(graphOf(ents(9)), d)
        expect(
          lane(unwrapped, 'entitlement').map((n) => crossOf(n, d)).sort((x, y) => x - y),
        ).toEqual(lane(nine, 'entitlement').map((n) => crossOf(n, d)).sort((x, y) => x - y))
      })

      it(`${d}: nested reference entitlements count towards the wrap until reference is hidden`, () => {
        const nested: StatusRow[] = Array.from({ length: 6 }, (_, i) =>
          row({
            id: `n${pad(i)}`,
            role: 'Role X',
            roleId: 'rx',
            accessProfile: 'AP X',
            accessProfileId: 'apx',
            entitlement: `Nested ${pad(i)}`,
            entitlementId: `n${pad(i)}`,
            source: 'Source s1',
            sourceId: 's1',
            ...(i === 0
              ? {
                  reviewStatus: 'needsReview' as const,
                  accessItemKind: 'role' as const,
                  accessItemId: 'rx',
                  accessItemName: 'Role X',
                }
              : {}),
          }),
        )
        const graph = graphOf([...ents(6), ...nested])
        expect(lane(buildAccessScene(graph, d), 'entitlement')).toHaveLength(12)
        expect(sizes(buildAccessScene(graph, d), 'entitlement', d)).toEqual([6, 6])
        const hidden = buildAccessScene(withoutReference(graph), d)
        expect(lane(hidden, 'entitlement')).toHaveLength(6)
        expect(sizes(hidden, 'entitlement', d)).toEqual([6])
      })
    }
  })
})
