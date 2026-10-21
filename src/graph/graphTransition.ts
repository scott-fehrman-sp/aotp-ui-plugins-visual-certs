/**
 * Pure planning for the access graph's scene transitions.
 *
 * Ported from org-graph's `use-graph-transition.ts` (same phases, same class
 * names, same stagger math) and split so the fragile timing code in
 * `useGraphTransition` stays tiny: everything that DECIDES what a frame
 * contains lives here, framework-free and unit-tested.
 *
 * Two deliberate differences from org-graph:
 *  1. Transition classes are APPENDED to a node's / edge's existing className
 *     (our edges carry `vc-graph-edge-needsReview`, `-reference`, ... that drive
 *     status styling; replacing the class would lose them).
 *  2. A size guard (`MAX_ANIMATED_NODES`): huge graphs apply instantly.
 *
 * Phases of an animated update (`kind: 'phased'`):
 *  - start:  staying cards (their TARGET position, so they glide at once),
 *            entering cards at an ORIGIN position with `entering` (opacity 0,
 *            scaled card), exiting cards of the previous frame marked `exiting`.
 *  - settle: two animation frames later: entering cards at their final position
 *            with the class cleared, so they glide + fade in.
 *  - final:  after the motion duration: exactly the target, exiting cards gone.
 * Every frame lists the previous frame's cards in their previous order (see
 * `frameOrder`), so React only ever inserts or removes DOM nodes and never moves
 * one (a moved DOM node loses focus and cancels its CSS transition).
 */
import type { CSSProperties } from 'react'
import type { Edge } from '@xyflow/react'
import { NODE_HEIGHT, NODE_WIDTH, type AccessSceneNode } from './buildAccessScene'
import { highlightEdges } from './selectEdges'

/** Gap between consecutive cards of the grid cascade, capped by REVEAL_SPAN_MS. */
export const REVEAL_STEP_MS = 70
/** The whole cascade never takes longer than this. */
export const REVEAL_SPAN_MS = 1400
/**
 * Above this many nodes (previous frame + next frame) a transition is skipped
 * and the target is applied instantly: hundreds of simultaneously transitioning,
 * doubled-up cards (the old and the new scene are both mounted) make the frame
 * rate drop, which looks worse than a clean cut.
 */
export const MAX_ANIMATED_NODES = 400

export const ENTERING_CLASS = 'entering'
export const EXITING_CLASS = 'exiting'
export const REVEAL_CLASS = 'reveal'
/** Keyframe class for a STAYING edge whose endpoint card moves (see `needsSettle`). */
export const SETTLING_CLASS = 'vc-graph-edge-settling'
/**
 * Keyframe class for an ENTERING edge once its `entering` class is cleared. React
 * Flow mounts an edge only after both of its cards are measured, which can be
 * later than that clear; a keyframe animation fades the edge in from the moment
 * it mounts, where a CSS transition would never start and the edge would pop in.
 */
export const ARRIVING_CLASS = 'vc-graph-edge-arriving'

const TRANSITION_TOKENS: readonly string[] = [
  ENTERING_CLASS,
  EXITING_CLASS,
  REVEAL_CLASS,
  SETTLING_CLASS,
  ARRIVING_CLASS,
]

/** 'instant': plain transition. 'stagger': cards new to the screen cascade in. */
export type TransitionReveal = 'instant' | 'stagger'

export interface GraphFrame {
  nodes: AccessSceneNode[]
  edges: Edge[]
  key: string
}

export interface FrameContent {
  nodes: AccessSceneNode[]
  edges: Edge[]
}

type Position = { x: number; y: number }

/* ------------------------------------------------------------ class helpers */

const tokensOf = (className: string | undefined): string[] =>
  (className ?? '').split(/\s+/).filter(Boolean)

/** True when `token` is one of the whitespace-separated classes. */
export function hasClassToken(className: string | undefined, token: string): boolean {
  return tokensOf(className).includes(token)
}

/** Removes the transition tokens, keeping every other class. `undefined` when none are left. */
export function stripTransitionClasses(className: string | undefined): string | undefined {
  const kept = tokensOf(className).filter((token) => !TRANSITION_TOKENS.includes(token))
  return kept.length > 0 ? kept.join(' ') : undefined
}

/**
 * APPENDS `token` to the existing classes (any previous transition token is
 * removed first, so tokens never stack or duplicate). With no token it just
 * strips. Returns `undefined` instead of '' so untouched objects stay identical.
 */
export function withTransitionClass(
  className: string | undefined,
  token?: string,
): string | undefined {
  const kept = tokensOf(stripTransitionClasses(className))
  if (token) kept.push(token)
  return kept.length > 0 ? kept.join(' ') : undefined
}

const hasTransitionClass = (className: string | undefined): boolean =>
  tokensOf(className).some((token) => TRANSITION_TOKENS.includes(token))

/* ------------------------------------------------------------------- reveal */

/** Delay of the card at `index` in a cascade of `count` cards (count <= 1: just the lead). */
export function revealDelayMs(index: number, count: number, leadMs: number): number {
  if (count <= 1) return leadMs
  const step = Math.min(REVEAL_STEP_MS, REVEAL_SPAN_MS / (count - 1))
  return leadMs + Math.round(index * step)
}

const DELAY_VAR = '--reveal-delay'

function revealDelayOf(node: AccessSceneNode): string | undefined {
  const value = (node.style as Record<string, unknown> | undefined)?.[DELAY_VAR]
  return typeof value === 'string' ? value : undefined
}

function withDelay(node: AccessSceneNode, delay: string): AccessSceneNode {
  return {
    ...node,
    className: withTransitionClass(node.className, REVEAL_CLASS),
    style: { ...node.style, [DELAY_VAR]: delay } as CSSProperties,
  }
}

/**
 * New cards cascade in (`reveal` + a staggered `--reveal-delay`). A card already
 * on screen that is still revealing keeps its class AND its delay (a resize that
 * reflows the grid must not replay or cut short the cascade); any other card
 * already on screen is left alone.
 */
export function stageRevealNodes(
  nextNodes: AccessSceneNode[],
  prevById: Map<string, AccessSceneNode>,
  leadMs: number,
): AccessSceneNode[] {
  return nextNodes.map((node, index) => {
    const prior = prevById.get(node.id)
    if (prior && hasClassToken(prior.className, REVEAL_CLASS)) {
      return withDelay(node, revealDelayOf(prior) ?? '0ms')
    }
    if (prior) return node
    return withDelay(node, `${revealDelayMs(index, nextNodes.length, leadMs)}ms`)
  })
}

/* ----------------------------------------------------------- id classification */

export interface IdClassification {
  staying: Set<string>
  entering: Set<string>
  exiting: Set<string>
}

/** Splits two id lists into the ids in both, only in `next`, and only in `previous`. */
export function classifyById(
  previous: ReadonlyArray<{ id: string }>,
  next: ReadonlyArray<{ id: string }>,
): IdClassification {
  const previousIds = new Set(previous.map((item) => item.id))
  const nextIds = new Set(next.map((item) => item.id))
  return {
    staying: new Set([...nextIds].filter((id) => previousIds.has(id))),
    entering: new Set([...nextIds].filter((id) => !previousIds.has(id))),
    exiting: new Set([...previousIds].filter((id) => !nextIds.has(id))),
  }
}

/* ------------------------------------------------------------------ origins */

/**
 * Where an ENTERING card starts: at the card it is linked to that was already
 * on screen (via an incoming edge, then an outgoing one), else at its laid-out
 * parent's position, else just below its own position. Same order as org-graph.
 */
export function originPosition(
  node: AccessSceneNode,
  nextNodes: AccessSceneNode[],
  nextEdges: Edge[],
  previous: Map<string, AccessSceneNode>,
): Position {
  const anchor =
    nextEdges.find((edge) => edge.target === node.id && previous.has(edge.source)) ??
    nextEdges.find((edge) => edge.source === node.id && previous.has(edge.target))
  if (anchor) {
    const relatedId = previous.has(anchor.source) ? anchor.source : anchor.target
    return previous.get(relatedId)?.position ?? node.position
  }
  const laidOutParent = nextEdges.find((edge) => edge.target === node.id)
  if (laidOutParent) {
    return nextNodes.find((item) => item.id === laidOutParent.source)?.position ?? node.position
  }
  return { x: node.position.x, y: node.position.y + 24 }
}

/**
 * Origins for every entering card, resolved over several hops. `originPosition`
 * alone would start a second-hop card (an access profile under an entering
 * role) at its parent's FINAL position; here each round starts a card at the
 * origin of an already-resolved neighbour, so the whole lineage emerges from a
 * card that was on screen. Cards with no path to one fall back to
 * `originPosition`.
 */
export function resolveOriginPositions(
  nextNodes: AccessSceneNode[],
  nextEdges: Edge[],
  previous: Map<string, AccessSceneNode>,
): Map<string, Position> {
  const origins = new Map<string, Position>()
  const known = new Map<string, Position>()
  for (const [id, node] of previous) known.set(id, node.position)
  let remaining = nextNodes.filter((node) => !previous.has(node.id))
  while (remaining.length > 0) {
    const resolved = new Map<string, Position>()
    for (const node of remaining) {
      const anchor =
        nextEdges.find((edge) => edge.target === node.id && known.has(edge.source)) ??
        nextEdges.find((edge) => edge.source === node.id && known.has(edge.target))
      if (!anchor) continue
      const relatedId = anchor.target === node.id ? anchor.source : anchor.target
      resolved.set(node.id, known.get(relatedId) ?? node.position)
    }
    if (resolved.size === 0) break
    for (const [id, position] of resolved) {
      origins.set(id, position)
      known.set(id, position)
    }
    remaining = remaining.filter((node) => !resolved.has(node.id))
  }
  for (const node of remaining) {
    origins.set(node.id, originPosition(node, nextNodes, nextEdges, previous))
  }
  return origins
}

/* ------------------------------------------------------------ moved / settle */

/** Ids of cards on screen whose position changes by more than half a pixel. */
export function movedNodeIds(
  prevById: Map<string, AccessSceneNode>,
  nextNodes: AccessSceneNode[],
): Set<string> {
  const moved = new Set<string>()
  for (const node of nextNodes) {
    const prior = prevById.get(node.id)
    if (!prior) continue
    if (
      Math.abs(prior.position.x - node.position.x) > 0.5 ||
      Math.abs(prior.position.y - node.position.y) > 0.5
    ) {
      moved.add(node.id)
    }
  }
  return moved
}

/**
 * A STAYING edge whose source or target card moves is drawn by React Flow at the
 * final geometry immediately, while the cards glide there with a CSS transition.
 * Those edges fade in over the motion instead of floating free.
 */
export function needsSettle(edge: Edge, movedIds: Set<string>): boolean {
  return movedIds.has(edge.source) || movedIds.has(edge.target)
}

/* ------------------------------------------------------------------ exiting */

/**
 * Gives a card the size React Flow would measure for it (the scene builders set
 * `width` / `height`). React Flow forgets a card's measured handle positions
 * whenever it receives a NEW node object without `measured`, and an edge whose
 * card is unmeasured is not drawn until the card is measured again: every edge
 * would blink off for a frame each time a card changes object between phases.
 * With `measured` the handle positions are kept and the edges stay mounted.
 */
export function withMeasured(node: AccessSceneNode): AccessSceneNode {
  if (node.measured?.width !== undefined && node.measured.height !== undefined) return node
  return {
    ...node,
    measured: { width: node.width ?? NODE_WIDTH, height: node.height ?? NODE_HEIGHT },
  }
}

/** A leaving card: `exiting` appended, out of the tab order, hidden from assistive tech. */
export function markExiting(node: AccessSceneNode): AccessSceneNode {
  return {
    ...withMeasured(node),
    className: withTransitionClass(node.className, EXITING_CLASS),
    focusable: false,
    domAttributes: { ...node.domAttributes, 'aria-hidden': true, inert: true },
  }
}

/** A leaving edge: `exiting` appended, not focusable, hidden from assistive tech. */
export function markExitingEdge(edge: Edge): Edge {
  return {
    ...edge,
    className: withTransitionClass(edge.className, EXITING_CLASS),
    focusable: false,
    domAttributes: { ...edge.domAttributes, 'aria-hidden': true },
  }
}

const withEdgeClass = (edge: Edge, token?: string): Edge => ({
  ...edge,
  className: withTransitionClass(edge.className, token),
})

/* -------------------------------------------------------------------- budget */

/** True when animating would put too many cards in flight (see MAX_ANIMATED_NODES). */
export function exceedsAnimationBudget(previousCount: number, nextCount: number): boolean {
  return previousCount + nextCount > MAX_ANIMATED_NODES
}

/* --------------------------------------------------------------------- order */

/**
 * The order a frame lists its items in: everything of the previous frame first,
 * in ITS order (staying and exiting alike), then the new items in target order.
 * React moves a keyed DOM node whose position in the list changed, and a moved
 * node loses its running CSS transition (a card that should fade out would snap
 * to invisible) and its focus. Keeping the previous order means a frame only ever
 * inserts or removes DOM nodes.
 */
export function frameOrder(
  previous: ReadonlyArray<{ id: string }>,
  next: ReadonlyArray<{ id: string }>,
): string[] {
  const ids = previous.map((item) => item.id)
  const seen = new Set(ids)
  for (const item of next) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      ids.push(item.id)
    }
  }
  return ids
}

/** `items` listed in `order` (ids without an item are skipped). */
export function arrange<T extends { id: string }>(order: readonly string[], items: readonly T[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  return order.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
}

/* --------------------------------------------------------------------- plan */

export type TransitionPlan =
  | { kind: 'immediate'; frame: FrameContent }
  | { kind: 'stagger'; start: FrameContent; final: FrameContent; hasExiting: boolean }
  | { kind: 'phased'; start: FrameContent; settle: FrameContent; final: FrameContent }

export interface PlanInput {
  previous: FrameContent
  nextNodes: AccessSceneNode[]
  nextEdges: Edge[]
  reveal: TransitionReveal
  motionMs: number
}

/** Decides what the frames of an update are. Pure: the hook only schedules them. */
export function planTransition({
  previous,
  nextNodes,
  nextEdges,
  reveal,
  motionMs,
}: PlanInput): TransitionPlan {
  const target: FrameContent = { nodes: nextNodes, edges: nextEdges }
  if (motionMs <= 0) return { kind: 'immediate', frame: target }
  if (reveal !== 'stagger' && previous.nodes.length === 0) {
    return { kind: 'immediate', frame: target }
  }
  if (exceedsAnimationBudget(previous.nodes.length, nextNodes.length)) {
    return { kind: 'immediate', frame: target }
  }

  const prevById = new Map(previous.nodes.map((node) => [node.id, node]))
  const nodeIds = classifyById(previous.nodes, nextNodes)
  const edgeIds = classifyById(previous.edges, nextEdges)
  const nodeOrder = frameOrder(previous.nodes, nextNodes)
  const edgeOrder = frameOrder(previous.edges, nextEdges)
  const exitingNodes = previous.nodes
    .filter((node) => nodeIds.exiting.has(node.id))
    .map(markExiting)
  const exitingEdges = previous.edges
    .filter((edge) => edgeIds.exiting.has(edge.id))
    .map(markExitingEdge)

  if (reveal === 'stagger') {
    // The camera glides for the same duration, so the cascade starts once the
    // grid is framed. The very first display has no camera move to wait for.
    const lead = previous.nodes.length === 0 ? 0 : motionMs
    const staged = stageRevealNodes(nextNodes.map(withMeasured), prevById, lead)
    return {
      kind: 'stagger',
      start: {
        nodes: arrange(nodeOrder, [...staged, ...exitingNodes]),
        edges: arrange(edgeOrder, [...nextEdges, ...exitingEdges]),
      },
      final: { nodes: arrange(nodeOrder, staged), edges: arrange(edgeOrder, nextEdges) },
      hasExiting: exitingNodes.length > 0 || exitingEdges.length > 0,
    }
  }

  const moved = movedNodeIds(prevById, nextNodes)
  const nothingChanges =
    nodeIds.entering.size === 0 &&
    nodeIds.exiting.size === 0 &&
    edgeIds.entering.size === 0 &&
    edgeIds.exiting.size === 0 &&
    moved.size === 0 &&
    !previous.nodes.some((node) => hasTransitionClass(node.className)) &&
    !previous.edges.some((edge) => hasTransitionClass(edge.className))
  if (nothingChanges) {
    return {
      kind: 'immediate',
      frame: { nodes: arrange(nodeOrder, nextNodes), edges: arrange(edgeOrder, nextEdges) },
    }
  }

  const origins = resolveOriginPositions(nextNodes, nextEdges, prevById)
  // One object per card for the whole transition (an entering card has a second,
  // for its origin), so React Flow keeps what it measured.
  const shown = nextNodes.map(withMeasured)
  const startNodes = shown.map((node) => {
    if (!nodeIds.entering.has(node.id)) return node
    return {
      ...node,
      position: origins.get(node.id) ?? node.position,
      className: withTransitionClass(node.className, ENTERING_CLASS),
    }
  })
  const startEdges = nextEdges.map((edge) => {
    if (edgeIds.entering.has(edge.id)) return withEdgeClass(edge, ENTERING_CLASS)
    if (needsSettle(edge, moved)) return withEdgeClass(edge, SETTLING_CLASS)
    return edge
  })
  const settleEdges = nextEdges.map((edge) => {
    if (edgeIds.entering.has(edge.id)) return withEdgeClass(edge, ARRIVING_CLASS)
    if (needsSettle(edge, moved)) return withEdgeClass(edge, SETTLING_CLASS)
    return edge
  })
  return {
    kind: 'phased',
    start: {
      nodes: arrange(nodeOrder, [...startNodes, ...exitingNodes]),
      edges: arrange(edgeOrder, [...startEdges, ...exitingEdges]),
    },
    settle: {
      nodes: arrange(nodeOrder, [...shown, ...exitingNodes]),
      edges: arrange(edgeOrder, [...settleEdges, ...exitingEdges]),
    },
    final: { nodes: arrange(nodeOrder, shown), edges: arrange(edgeOrder, nextEdges) },
  }
}

/* ------------------------------------------------------------------- camera */

/**
 * True once every target card sits in the frame at its final position and none
 * is `entering`: only then are the positions React Flow holds the ones the
 * camera must frame, and the fit can start together with the cards' glide.
 */
export function isFramePlaced(
  frameNodes: AccessSceneNode[],
  targetNodes: AccessSceneNode[],
): boolean {
  const byId = new Map(frameNodes.map((node) => [node.id, node]))
  return targetNodes.every((target) => {
    const node = byId.get(target.id)
    return (
      node !== undefined &&
      node.position.x === target.position.x &&
      node.position.y === target.position.y &&
      !hasClassToken(node.className, ENTERING_CLASS)
    )
  })
}

/* --------------------------------------------------------------- edge styling */

/**
 * Hover / selection restyle of the frame's edges. Leaving (`exiting`) edges are
 * not part of the live graph: they are neither restyled nor walked as lineage,
 * so they keep fading out untouched. With none leaving this is exactly
 * `highlightEdges`.
 */
export function highlightFrameEdges(
  frameEdges: Edge[],
  selectedId: string | null,
  emphasisId: string | null,
): Edge[] {
  if (!frameEdges.some((edge) => hasClassToken(edge.className, EXITING_CLASS))) {
    return highlightEdges(frameEdges, selectedId, emphasisId)
  }
  const live = frameEdges.filter((edge) => !hasClassToken(edge.className, EXITING_CLASS))
  const leaving = frameEdges.filter((edge) => hasClassToken(edge.className, EXITING_CLASS))
  return [...highlightEdges(live, selectedId, emphasisId), ...leaving]
}

/* --------------------------------------------------------------- motion duration */

/** Parses a CSS time ('450ms', '0.45s', ' 0ms'). Empty, garbage or negative gives 0. */
export function parseMotionMs(value: string | null | undefined): number {
  const text = (value ?? '').trim()
  const parsed = parseFloat(text)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return /\ds$/i.test(text) ? Math.round(parsed * 1000) : parsed
}

/** Reads `--motion-ms` from the element's computed style (0 when unavailable). */
export function readMotionMs(element: Element | null | undefined): number {
  if (!element) return 0
  return parseMotionMs(getComputedStyle(element).getPropertyValue('--motion-ms'))
}
