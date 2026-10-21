import { useEffect, useRef, useState } from 'react'
import type { Edge } from '@xyflow/react'
import type { AccessSceneNode } from './buildAccessScene'
import {
  planTransition,
  type FrameContent,
  type GraphFrame,
  type TransitionPlan,
  type TransitionReveal,
} from './graphTransition'

/** The animated part of a plan, waiting for its first frame to be committed. */
interface PendingPhases {
  /** The committed frame that releases the phases (identity compare). */
  frame: GraphFrame
  plan: Exclude<TransitionPlan, { kind: 'immediate' }>
  generationId: number
}

interface Timers {
  outerFrame: number
  innerFrame: number
  timeout: number
}

function cancelTimers(ref: { current: Timers }): void {
  window.cancelAnimationFrame(ref.current.outerFrame)
  window.cancelAnimationFrame(ref.current.innerFrame)
  window.clearTimeout(ref.current.timeout)
  ref.current = { outerFrame: 0, innerFrame: 0, timeout: 0 }
}

/**
 * Turns the structural scene (the nodes / edges the pure builders produced) into
 * the frames React Flow actually renders, so a scene change animates instead of
 * cutting. Ported from org-graph's `useGraphTransition`; what each phase
 * contains is decided by `planTransition` (pure, unit-tested), this hook only
 * schedules them:
 *
 *  1. start:  staying + entering (at their origin, class `entering`) + exiting.
 *  2. two animation frames later: entering cards at their final position with
 *     the class cleared (the CSS transition does the glide and the fade).
 *  3. after `motionMs`: exactly the target; exiting cards are dropped.
 *
 * Unlike org-graph, the clock of phases 2 and 3 starts when the START frame has
 * been COMMITTED, not when the update was planned. Rendering a big scene can
 * take longer than two animation frames; counting from the plan would then skip
 * straight to the final positions and the cards would pop in instead of
 * gliding, and the exit fade would be cut short by the removal timer.
 *
 * A generation counter drops the callbacks of a superseded update, so rapid
 * changes always end in the latest target. With `motionMs === 0` (reduced
 * motion, jsdom) the target is returned as is: no state hop, no extra render.
 *
 * Feed it the STRUCTURAL scene and style the returned edges afterwards
 * (`highlightFrameEdges`): hover and selection must never start a transition.
 */
export function useGraphTransition(
  targetNodes: AccessSceneNode[],
  targetEdges: Edge[],
  graphKey: string,
  motionMs: number,
  reveal: TransitionReveal = 'instant',
): GraphFrame {
  const [frame, setFrame] = useState<GraphFrame>(() => {
    // Born staged: cards that cascade in must never paint fully visible first.
    if (reveal === 'stagger' && motionMs > 0) {
      const plan = planTransition({
        previous: { nodes: [], edges: [] },
        nextNodes: targetNodes,
        nextEdges: targetEdges,
        reveal,
        motionMs,
      })
      if (plan.kind === 'stagger') return { ...plan.start, key: graphKey }
    }
    return { nodes: targetNodes, edges: targetEdges, key: graphKey }
  })
  const displayed = useRef<GraphFrame>({ nodes: [], edges: [], key: '' })
  const generation = useRef(0)
  const pending = useRef<PendingPhases | null>(null)
  const timers = useRef<Timers>({ outerFrame: 0, innerFrame: 0, timeout: 0 })

  // Plans an update and publishes its first frame.
  useEffect(() => {
    const generationId = ++generation.current
    pending.current = null

    if (motionMs <= 0) {
      // The hook returns the target itself; only remember what is on screen.
      displayed.current = { nodes: targetNodes, edges: targetEdges, key: graphKey }
      return
    }

    const plan = planTransition({
      previous: displayed.current,
      nextNodes: targetNodes,
      nextEdges: targetEdges,
      reveal,
      motionMs,
    })
    const first = plan.kind === 'immediate' ? plan.frame : plan.start
    const stamped = { ...first, key: graphKey }
    displayed.current = stamped
    if (plan.kind !== 'immediate') pending.current = { frame: stamped, plan, generationId }
    setFrame(stamped)

    // Superseded by a newer update, or unmounted: drop everything in flight.
    return () => cancelTimers(timers)
  }, [graphKey, motionMs, reveal, targetNodes, targetEdges])

  // Releases the later phases once their first frame is in the DOM.
  useEffect(() => {
    const release = pending.current
    if (!release || release.frame !== frame) return
    pending.current = null
    const { plan, generationId } = release
    const apply = (content: FrameContent) => {
      if (generation.current !== generationId) return
      const stamped = { ...content, key: frame.key }
      displayed.current = stamped
      setFrame(stamped)
    }

    if (plan.kind === 'phased') {
      timers.current.outerFrame = window.requestAnimationFrame(() => {
        timers.current.innerFrame = window.requestAnimationFrame(() => apply(plan.settle))
      })
      timers.current.timeout = window.setTimeout(() => apply(plan.final), motionMs)
    } else if (plan.hasExiting) {
      timers.current.timeout = window.setTimeout(() => apply(plan.final), motionMs)
    }
  }, [frame, motionMs])

  return motionMs <= 0 ? { nodes: targetNodes, edges: targetEdges, key: graphKey } : frame
}
