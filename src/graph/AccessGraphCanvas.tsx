import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useStoreApi,
  getNodesBounds,
  type NodeMouseHandler,
} from '@xyflow/react'
import type { AccessGraphData, AccessSceneNodeData, RankDir } from '../sailpoint/types'
import type { UserDetailState } from '../state/useAccessMatrix'
import { buildAccessScene, type AccessSceneNode } from './buildAccessScene'
import { buildUserGridScene } from './buildUserGridScene'
import { copyFirstLevelStatus } from '../domain/reviewOverlay'
import type { ResolvedIdentity } from '../sailpoint/identities'
import { userSubgraph } from './userSubgraph'
import { withUserIdentities } from './userIdentity'
import { withoutReference } from './referenceFilter'
import { userCompletion, withoutCompleted } from './completedFilter'
import { computeFitPadding, measureOverlays, planFit, toFitViewPadding } from './fitPadding'
import { EmphasisContext } from './EmphasisContext'
import { EMPTY_SELECTION, SelectionContext, type SelectionState } from './SelectionContext'
import { hasReviewStatus } from './emphasizeEdges'
import {
  connectedNodeIds,
  isNeedsReviewItem,
  isSelectableNodeData,
  lineageNodeIds,
} from './selectEdges'
import { highlightFrameEdges, isFramePlaced } from './graphTransition'
import { useGraphTransition } from './useGraphTransition'
import { useMotionMs } from './useMotionMs'
import { ScrollHint } from './ScrollHint'
import { GraphControls } from './GraphControls'
import { GraphContextMenu, type GraphContextMenuState } from './GraphContextMenu'
import { graphControlItems } from './graphControlItems'
import { GraphLegend } from './GraphLegend'
import { NodeDetailPanel } from './NodeDetailPanel'
import { AccessNode, PinnedAccessCard } from './AccessNode'
import { useColorMode } from './useColorMode'
import { EmptyState } from '../components/EmptyState'
import { createPortal } from 'react-dom'
import './AccessGraph.css'

/** React Flow node-type registry for the access graph. */
const nodeTypes = { access: AccessNode }

interface AccessGraphCanvasProps {
  /** The derived graph (nodes + edges) from the access matrix. */
  graph: AccessGraphData
  /**
   * Where the drill-down "Back to all users" button is rendered, so the host
   * view can place it OUTSIDE the canvas next to its own "Back to overview"
   * button (in the app title bar, beside the application title). The canvas
   * still owns the selected-user state; it just portals the button into this
   * element.
   *  - `undefined` (prop omitted): the button renders inside the canvas, in a
   *    top-left panel, as it always has (standalone use / existing tests).
   *  - an element: the button is portaled into it.
   *  - `null`: the host's slot has not mounted yet; render nothing for now.
   */
  backSlot?: HTMLElement | null
  /**
   * Test seam: the motion duration in ms. When omitted the duration is read
   * from the `--motion-ms` CSS token (0 under `prefers-reduced-motion`, and 0
   * where no stylesheet is loaded, e.g. jsdom, which turns every transition
   * off). Hosts have no reason to set it.
   */
  motionMs?: number
  /**
   * Each user's lazily-resolved full composition, keyed by BARE identity id
   * (e.g. `"u1"`, not the namespaced graph node id `"user:u1"`). Supplying
   * this (even as `{}`) switches the drill-down to LAZY mode: `graph` is
   * assumed to carry only each user's directly-held first-level items (no
   * deeper lineage), drilling into a user calls `onUserSelected` so the host
   * can resolve that user's full composition on demand, and the drill-down
   * shows that user's SHALLOW first-level items immediately while the full
   * composition is loading, swapping in the resolved `graph` from this map's
   * entry once it is `'ready'`.
   *
   * Omitting this prop (the default) keeps the original, non-lazy behavior:
   * `graph` is assumed to already carry everyone's full composition, and the
   * drill-down is simply `userSubgraph(graph, id)`.
   */
  userDetails?: Record<string, UserDetailState>
  /**
   * Called with a user's BARE identity id (not the namespaced node id) when
   * they are selected for processing (their grid card is clicked / drilled
   * into). Only meaningful together with `userDetails`; a non-lazy caller has
   * no reason to pass it.
   */
  onUserSelected?: (userId: string) => void
  /**
   * Fired with the currently-viewed user's `userDetails` entry (looked up by
   * the canvas itself from `selectedUserId`), or `null` outside a drill-down
   * or before `onUserSelected` has been called for the viewed user. Lets a
   * host that needs to react to that state (e.g. a per-user "unresolved"
   * banner rendered outside the canvas) without owning the selection itself.
   */
  onUserDetailChange?: (detail: UserDetailState | null) => void
  /**
   * Identity detail for users already looked up, keyed by bare identity id.
   * The host loads this for EVERY user when the map opens (see
   * `useAccessMatrix`) so the grid cards can show name, title, department,
   * location, country, and the manager mark before anyone is selected. Merged
   * onto the user nodes for display only; it does not replace `graph.nodes`.
   */
  identities?: Record<string, ResolvedIdentity>
}

/** Shared empty lineage, so "nothing selected" keeps a stable context value. */
const NO_LINEAGE: ReadonlySet<string> = new Set()
/** Stable empty selection list. `setState` of this same array bails out. */
const EMPTY_IDS: string[] = []

function allNeedReview(ids: readonly string[], nodes: readonly AccessSceneNode[]): boolean {
  return ids.every((id) => {
    const data = nodes.find((node) => node.id === id)?.data
    return data !== undefined && isNeedsReviewItem(data)
  })
}

function selectionAnnouncement(
  label: string,
  count: number,
  change: 'add' | 'remove' | 'replace',
): string {
  if (count === 0) return 'Selection cleared.'
  if (change === 'replace' || (change === 'add' && count === 1)) {
    return `Highlighting the links for ${label}. Press Escape to clear.`
  }
  const items = count === 1 ? 'item' : 'items'
  const verb = change === 'remove' ? 'removed from' : 'added to'
  return `${label} ${verb} the selection. ${count} ${items} selected. Press Escape to clear.`
}
/** The `user:<id>` node-id namespace prefix (see `domain/accessGraph.ts`). */
const USER_ID_PREFIX = 'user:'

/** Zoom range of the canvas (also the bounds planFit clamps to). */
const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.8

/** Kinds a reviewer can approve, revoke, or reassign. Reference copies are excluded. */
const DECISION_KINDS = new Set<AccessSceneNodeData['kind']>([
  'role',
  'accessProfile',
  'entitlement',
])

/**
 * A reviewable access item in drill-down gets the decision menu. User cards
 * (including the user grid) and reference-only nodes do not.
 */
function showsDecisionMenu(
  data: Pick<AccessSceneNodeData, 'kind' | 'reference'>,
  inDrilldown: boolean,
): boolean {
  return inDrilldown && !data.reference && DECISION_KINDS.has(data.kind)
}

function suppressContextMenu(event: { preventDefault(): void; stopPropagation(): void }) {
  event.preventDefault()
  event.stopPropagation()
}

/** Minimap dot color per layer, matched to the card accents. */
const MINIMAP_COLOR: Record<string, string> = {
  user: '#0b4f8a',
  role: '#6b3fa0',
  accessProfile: '#0e7a43',
  entitlement: '#9c5836',
  attribute: '#0f6f86',
  source: '#3a4d5e',
}

/**
 * The React Flow canvas for the access graph. It has two modes:
 *
 * 1. OVERVIEW (default): only `user`-kind cards, laid out in a centered grid
 *    (`buildUserGridScene`), each a selectable control. No edges. The control
 *    panel is only the minimap toggle; layout, reference, completed, legend and
 *    detail apply to the dagre drill-down.
 * 2. DRILL-DOWN: activating a user card shows ONLY that user's forward-reachable
 *    subgraph (`buildAccessScene(userSubgraph(graph, id), rankdir)`), with a
 *    "Back to all users" panel control and Escape returning to the grid. The
 *    reference toggle can hide the reference-only lineage (nested items,
 *    sources) so only the reviewable first level remains. The user card itself
 *    is not part of that layout: it is pinned in the upper left, beside the
 *    control panel, and stays there while the access items pan and zoom.
 *
 * SELECTION (drill-down only). Clicking any card except the user, or pressing
 * Enter / Space on it, selects it. Access items that still need review
 * accumulate: each click adds or removes that item and the other needs-review
 * items stay selected. A completed item or a reference-only card replaces the
 * selection with just that card, and clicking it again clears it. Each
 * selected item's associated edges (its user -> item edge plus every visible
 * edge downstream to the sources) are highlighted in that item's status color
 * and all other edges dim; see `highlightSelection`. The selection is cleared
 * by clicking the empty pane or Escape (the first Escape clears the selection,
 * only a second one returns to the grid), and by drilling into another user,
 * going back, or a new node set. It survives the layout, reference, completed
 * and minimap toggles and a status-only refresh, except that hiding completed
 * items drops a selected item that gets hidden. Selecting is a cheap edge
 * restyle: the scene, the node objects and the fit are untouched, exactly
 * like hover.
 *
 * Every fit (drill-down entry, user switch, reference/layout/minimap toggle,
 * window resize) is overlay-aware: it pads the viewport by the measured size of
 * the legend, minimap, controls and panels so no card sits under them.
 *
 * A left-side vertical control panel (`GraphControls`) is present in both modes.
 * The user grid shows only the minimap toggle. Drill-down adds layout direction,
 * reference visibility, completed-items visibility, the node legend and the
 * detail panel. Those preferences live in memory and survive switching users
 * and grid/drill-down. The completed toggle (drill-down only) hides the
 * first-level items whose status is approved / revoked / reassigned plus any
 * lineage left orphaned (`withoutCompleted`), re-lays out and refits once.
 *
 * CONTEXT MENUS. Right-click on the canvas background opens a menu with the
 * same actions as the control panel for the current mode, then zoom in, zoom
 * out, and fit. Right-click on a user card (grid or the pinned drill-down
 * card) or on a reference-only node does nothing. Right-click on a reviewable
 * access item (role, access profile, or entitlement) offers Approve, Revoke,
 * and Reassign; those actions are disabled until a decision flow is connected.
 *
 * TRANSITIONS. Scene updates (grid <-> drill-down, hide completed / reference,
 * layout, lane wrapping) animate like org-graph's: the scene builders still
 * produce the final nodes and edges, and `useGraphTransition` turns each update
 * into frames: cards that stay glide to their new position, cards that leave
 * fade and scale out (inert, then removed), cards that arrive fade in from a
 * related card, and the viewport animates over the same `--motion-ms`. Cards new
 * to the overview grid cascade in. Only the STRUCTURAL scene is animated; hover
 * and selection restyle the frame's edges afterwards, so they never start a
 * transition. Everything that reads the scene (selection, counts, notes, the
 * scroll hint, announcements) reads the TARGET scene, not the frame.
 *
 * Structure mirrors org-graph's `OrgCanvas`: a `ReactFlowProvider` wrapping a
 * surface that reads the viewport width from the React Flow store, derives
 * `colorMode` from the OS color scheme, memoizes the pure scene builders, and
 * renders a read-only graph (no dragging, no connecting) with a minimap and
 * controls. When the graph has no users it renders an `EmptyState` instead.
 */
export function AccessGraphCanvas({
  graph,
  backSlot,
  motionMs,
  userDetails,
  onUserSelected,
  onUserDetailChange,
  identities,
}: AccessGraphCanvasProps) {
  const hasUsers = useMemo(
    () => graph.nodes.some((node) => node.kind === 'user'),
    [graph],
  )

  if (!hasUsers) {
    return (
      <EmptyState
        title="No users to map"
        message="There are no users with reviewable access to show in this map."
      />
    )
  }

  return (
    <ReactFlowProvider>
      <CanvasSurface
        graph={graph}
        backSlot={backSlot}
        motionMs={motionMs}
        userDetails={userDetails}
        onUserSelected={onUserSelected}
        onUserDetailChange={onUserDetailChange}
        identities={identities}
      />
    </ReactFlowProvider>
  )
}

/** What the latest refit decided, keyed by the fit it belongs to. */
interface FitOutcome {
  fitKey: string
  /** True when the graph opened at the readable zoom (a long list). */
  long: boolean
}

/**
 * Re-fits the viewport whenever `fitKey` or the canvas size changes. React
 * Flow's `fitView` prop only fits once on mount, so without this the drill-down
 * keeps the overview grid's zoom (up to 1.8x) and most of the graph sits
 * off-screen.
 *
 * The fit is OVERLAY-AWARE: React Flow fits to the whole canvas rectangle and
 * ignores the widgets drawn over it (legend, minimap, zoom controls, control
 * panel, back button, notes), so the live rectangle of every `.react-flow__panel`
 * is measured one frame after the change (once the panels have laid out) and
 * turned into per-side pixel padding. The graph may end up smaller at small
 * viewports, but never under an overlay.
 *
 * REVISED INVARIANT for long graphs. Fitting a 25-item lane into the canvas
 * pins the zoom at the minimum and leaves illegible cards, so in drill-down
 * `planFit` decides per refit:
 * - Mode A (fit-everything zoom >= SCROLL_MODE_FIT_ZOOM): today's `fitView`
 *   with overlay padding, strict: no node under an overlay, all nodes inside.
 * - Mode B (below it, a long list): `setViewport` at READABLE_MIN_ZOOM. The
 *   content START is aligned to the overlay-free region (the pinned user card
 *   is one of those overlays, so the first items sit clear of it), and overlays
 *   are assigned away from the scroll axis. The rest of a long list is reached
 *   by scrolling or dragging, and the scroll hint says so. The Controls
 *   fit-view button still shows everything.
 * The overview grid keeps the plain overlay-aware `fitView`. Refit triggers are
 * unchanged (`fitKey`, canvas size); node data is read inside the frame
 * callback so scene changes do not add triggers.
 *
 * The bounds always come from the TARGET scene's nodes, never from the store:
 * during a transition the store holds entering cards at their origin and
 * exiting cards at their old position. The fit waits until `placed` (the store
 * holds every target card at its final position), so it starts together with
 * the cards' glide, and it animates over the same `--motion-ms` (the first fit
 * of the canvas is instant). The final camera is the one the unanimated code
 * produced.
 */
function FitOnSceneChange({
  fitKey,
  rankdir,
  inDrilldown,
  targetNodes,
  placed,
  motionMs,
  onPlan,
}: {
  fitKey: string
  rankdir: RankDir
  inDrilldown: boolean
  /** The TARGET scene's nodes: the fit is computed from these, never from the store. */
  targetNodes: AccessSceneNode[]
  /** True once the store holds every target card at its final position. */
  placed: boolean
  /** Duration of the camera move; the first fit of the canvas is always instant. */
  motionMs: number
  onPlan: (outcome: FitOutcome) => void
}) {
  const { fitView, setViewport } = useReactFlow()
  const store = useStoreApi()
  // Canvas size changes (window resize) must refit too.
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  // The latest target nodes, read inside the frame callback. Declared before the
  // fit effect so it is current when that runs; it is not a dependency, so a
  // scene change adds no refit trigger of its own.
  const targetRef = useRef(targetNodes)
  useEffect(() => {
    targetRef.current = targetNodes
  })
  const hasFitted = useRef(false)
  useEffect(() => {
    // During a transition the store holds entering cards at their origin; wait
    // until the target positions are in place, then fit once, in step with the
    // cards' own glide.
    if (!placed) return
    const frame = requestAnimationFrame(() => {
      const duration = hasFitted.current ? motionMs : 0
      hasFitted.current = true
      const target = targetRef.current
      const ids = target.map((node) => ({ id: node.id }))
      const root = store.getState().domNode
      if (!root) {
        void fitView({ duration })
        return
      }
      const { canvas, overlays } = measureOverlays(root)
      const padding = toFitViewPadding(computeFitPadding(canvas, overlays))
      // Grid, or a drill-down whose only card is the pinned user: frame whatever
      // flow nodes there are. The pinned card is a panel, so measureOverlays
      // already keeps the items clear of it.
      if (!inDrilldown || target.length === 0) {
        void fitView({ nodes: ids, padding, duration })
        onPlan({ fitKey, long: false })
        return
      }
      const bounds = getNodesBounds(target)
      const plan = planFit({
        bounds,
        // The user card is pinned, so a long list opens at the start of the
        // access items (A→Z) instead of centering a card that is no longer in
        // the layout.
        focus: { x: bounds.x, y: bounds.y, width: 0, height: 0 },
        canvas,
        overlays,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        scrollAxis: rankdir === 'LR' ? 'y' : 'x',
      })
      if (plan.mode === 'readable') {
        void setViewport(plan.viewport, { duration })
      } else {
        void fitView({ nodes: ids, padding: toFitViewPadding(plan.padding), duration })
      }
      onPlan({ fitKey, long: plan.mode === 'readable' })
    })
    return () => cancelAnimationFrame(frame)
    // rankdir and inDrilldown are encoded in fitKey; onPlan and setViewport are
    // stable. So the refit triggers stay fitKey + canvas size (+ `placed`, which
    // only defers the fit until the target positions are in the store).
  }, [fitKey, width, height, placed, motionMs, fitView, setViewport, rankdir, inDrilldown, onPlan, store])
  return null
}

function CanvasSurface({
  graph,
  backSlot,
  motionMs: motionMsProp,
  userDetails,
  onUserSelected,
  onUserDetailChange,
  identities: prefetchedIdentities,
}: AccessGraphCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const motionMs = useMotionMs(motionMsProp, wrapRef)
  // `motion-on` is applied one frame after mount so the first display does not
  // slide its cards in from the origin (as org-graph's OrgCanvas does).
  const [motionOn, setMotionOn] = useState(false)
  useEffect(() => {
    if (motionMs <= 0) return
    const id = requestAnimationFrame(() => setMotionOn(true))
    return () => cancelAnimationFrame(id)
  }, [motionMs])
  // All control-panel options start off; the reviewer enables each from the
  // control panel. The layout button is "active" (pressed) only in LR, so it
  // starts in TB to match the other options' off state.
  const [rankdir, setRankdir] = useState<RankDir>('TB')
  const [showReference, setShowReference] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [showMinimap, setShowMinimap] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [menu, setMenu] = useState<GraphContextMenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const [announcement, setAnnouncement] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  // Selected node ids whose edges are highlighted. Needs-review access items
  // may share this list; every other selectable node is alone in it.
  const [selectedIds, setSelectedIds] = useState<string[]>(EMPTY_IDS)
  // The node whose details the fly-out panel describes. Independent of the
  // edge-highlight selection above: ANY node kind (including the user node,
  // deeper hops and reference-only nodes) can be the detail target.
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null)
  const colorMode = useColorMode()
  const width = useStore((state) => state.width)

  // Reset to the grid whenever the campaign/node set changes. Keyed on
  // `graph.nodes` (not `graph`) so a status-only refresh, which rebuilds edges
  // but reuses the nodes array, does not kick the reviewer out of the
  // drill-down. Tracking the prior value in state and adjusting during render is
  // React's recommended pattern for deriving state from props (the lint config
  // disallows resetting in a useEffect).
  const [prevNodes, setPrevNodes] = useState(graph.nodes)
  if (prevNodes !== graph.nodes) {
    setPrevNodes(graph.nodes)
    setSelectedUserId(null)
    setSelectedIds(EMPTY_IDS)
    setDetailNodeId(null)
  }

  // The selected items belong to one user's drill-down: drilling into another
  // user, going back to the grid or Escape-to-grid all drop them. (Layout,
  // reference and minimap toggles and status-only refreshes keep them.)
  const [prevUserId, setPrevUserId] = useState(selectedUserId)
  if (prevUserId !== selectedUserId) {
    setPrevUserId(selectedUserId)
    setSelectedIds(EMPTY_IDS)
    // Entering, leaving or switching a user's drill-down shows a different node
    // set, so a detail target from the previous scene no longer applies.
    setDetailNodeId(null)
  }

  const userCount = useMemo(
    () => graph.nodes.filter((node) => node.kind === 'user').length,
    [graph],
  )

  // This user's first-level items straight from `graph`: in LAZY mode `graph`
  // only ever carries that much (see `userDetails`' doc), so this is cheap and
  // always available the instant a user is drilled into, even before (or if)
  // their full composition resolves. In non-lazy mode `graph` already carries
  // everyone's full composition, so this already IS the whole drill-down.
  // Prefetched identities (every user, loaded with the map) plus any identity
  // recorded on a selected user's detail. Applied onto the cards without
  // replacing `graph.nodes` (that reference is what tells a real campaign
  // change from a status-only refresh).
  const identities = useMemo(() => {
    const byId: Record<string, ResolvedIdentity> = { ...prefetchedIdentities }
    if (!userDetails) return byId
    for (const [id, detail] of Object.entries(userDetails)) {
      if (detail.identity) byId[id] = detail.identity
    }
    return byId
  }, [prefetchedIdentities, userDetails])
  const graphWithIdentity = useMemo(
    () => withUserIdentities(graph, identities),
    [graph, identities],
  )

  const shallowSubgraph = useMemo(
    () => (selectedUserId ? userSubgraph(graphWithIdentity, selectedUserId) : null),
    [graphWithIdentity, selectedUserId],
  )
  const lazy = userDetails !== undefined
  const selectedIdentityId = selectedUserId
    ? selectedUserId.slice(USER_ID_PREFIX.length)
    : null
  const selectedUserDetail =
    lazy && selectedIdentityId ? userDetails[selectedIdentityId] ?? null : null
  // Lazy mode: swap in the user's fully-resolved composition once it is
  // ready. That graph is structural only, so the live review status is copied
  // from the shallow subgraph (same reviewKey) and then stamped onto the
  // first-level nodes by `userSubgraph`. Skipping either step makes the
  // default "hide reference" filter drop every access item — the drill-down
  // goes blank, and the pinned card's "X% (Y of Z)" drops to 0 of 0, the
  // moment resolution finishes. Until then (not yet requested, loading, or
  // errored) — and always in non-lazy mode — `shallowSubgraph` is everything
  // there is to show.
  const subgraph = useMemo(() => {
    if (!selectedUserId || !shallowSubgraph) return shallowSubgraph
    if (selectedUserDetail?.status !== 'ready') return shallowSubgraph
    return userSubgraph(
      withUserIdentities(
        copyFirstLevelStatus(selectedUserDetail.graph, shallowSubgraph),
        identities,
      ),
      selectedUserId,
    )
  }, [selectedUserId, selectedUserDetail, shallowSubgraph, identities])

  // Report the viewed user's lazy-resolution state upward on every change
  // (entering/leaving a drill-down, or that resolution progressing), so a host
  // that renders its own chrome around the canvas (e.g. a per-user
  // "unresolved" banner) can track it without owning the selection itself.
  useEffect(() => {
    onUserDetailChange?.(selectedUserDetail ?? null)
  }, [selectedUserDetail, onUserDetailChange])

  // Always computed (even while completed items are shown) so the hidden count
  // is known for the button label and the announcement.
  const completedResult = useMemo(
    () => (subgraph ? withoutCompleted(subgraph) : null),
    [subgraph],
  )

  // The completed filter is applied FIRST, then the reference filter (with
  // reference hidden only the user + needs-review first-level items remain).
  // The layout below is recomputed on the filtered graph, so there are no gaps.
  const visibleGraph = useMemo(() => {
    if (!subgraph || !completedResult) return subgraph
    const base = showCompleted ? subgraph : completedResult.graph
    return showReference ? base : withoutReference(base)
  }, [subgraph, completedResult, showCompleted, showReference])

  const scene = useMemo(() => {
    if (selectedUserId === null) {
      return buildUserGridScene(
        graphWithIdentity,
        width || window.innerWidth,
        setSelectedUserId,
      )
    }
    // Reference shown OR hidden, each access type keeps its own column (LR) /
    // row (TB), in the fixed order role, access profile, entitlement (then
    // sources when reference is shown). Hiding reference only removes the
    // nested lineage and the sources; the reviewable items stay in the same
    // lanes, so toggling reference never rearranges them by kind.
    // The completion percentage is taken from the unfiltered subgraph: the
    // visible graph may already have completed items removed.
    return buildAccessScene(visibleGraph ?? { nodes: [], edges: [] }, rankdir, {
      completion: userCompletion(subgraph?.edges ?? [], selectedUserId),
    })
  }, [graphWithIdentity, selectedUserId, visibleGraph, subgraph, rankdir, width])

  // The drill-down shows one user, so the hop from that user to each access
  // item adds no path information. Review status stays on the access-item
  // card. Drop those edges before layout transitions and drawing.
  const drawnEdges = useMemo(
    () => scene.edges.filter((edge) => !hasReviewStatus(edge)),
    [scene.edges],
  )

  const inDrilldown = selectedUserId !== null
  // A menu opened in one mode describes that mode's controls (or that scene's
  // nodes). Entering, leaving, or switching a drill-down closes it.
  const menuScope = inDrilldown ? selectedUserId ?? '' : 'grid'
  const [seenMenuScope, setSeenMenuScope] = useState(menuScope)
  if (seenMenuScope !== menuScope) {
    setSeenMenuScope(menuScope)
    setMenu(null)
  }
  // The drilled-in user is pinned beside the controls (see the panel below),
  // so it is not a flow node: the layout still reserves its lane, but the
  // camera frames only the access items.
  const pinnedUser = inDrilldown
    ? scene.nodes.find((node) => node.data.kind === 'user')
    : undefined
  const layoutNodes = useMemo(
    () => (pinnedUser ? scene.nodes.filter((node) => node.id !== pinnedUser.id) : scene.nodes),
    [scene.nodes, pinnedUser],
  )

  // Hover / keyboard-focus emphasis. A card whose scene is replaced (user,
  // reference or layout change) may unmount without a mouseleave/blur, so any
  // emphasis is cleared when the scene identity changes (adjust-during-render,
  // as above). The context value is a stable pair of setters, so hovering
  // re-renders only this surface (an edge restyle), never every card.
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const emphasis = useMemo(() => ({ setHover: setHoverId, setFocus: setFocusId }), [])
  const sceneKey = `${selectedUserId}|${showReference}|${showCompleted}|${rankdir}`
  const [prevSceneKey, setPrevSceneKey] = useState(sceneKey)
  if (prevSceneKey !== sceneKey) {
    setPrevSceneKey(sceneKey)
    setHoverId(null)
    setFocusId(null)
  }
  // What React Flow renders: the structural scene run through the transition.
  // Hover / selection are NOT inputs (they restyle `frame.edges` below).
  const frame = useGraphTransition(
    layoutNodes,
    drawnEdges,
    sceneKey,
    motionMs,
    inDrilldown ? 'instant' : 'stagger',
  )
  // True once every target card sits in the frame at its final position (see
  // `FitOnSceneChange`).
  const placed = useMemo(
    () => isFramePlaced(frame.nodes, layoutNodes),
    [frame.nodes, layoutNodes],
  )
  // Pointer wins; a keyboard-focused card stays emphasized once the pointer
  // leaves another card. Purely an edge restyle: no layout or refit input.
  const emphasisId = hoverId ?? focusId
  // Any non-user node of the current scene can be selected. Several
  // needs-review access items can be selected together. A reference node
  // highlights the path through it; a first-level item highlights its status
  // edge and downstream lineage.
  const selectedNodes = useMemo(() => {
    if (!inDrilldown || selectedIds.length === 0) return []
    return selectedIds.flatMap((id) => {
      const node = scene.nodes.find((candidate) => candidate.id === id)
      return node && isSelectableNodeData(node.data) ? [node] : []
    })
  }, [inDrilldown, selectedIds, scene.nodes])
  const hasSelection = selectedNodes.length > 0
  // A selected item hidden by the completed filter is dropped (not merely
  // inert), so it cannot silently come back when completed items are shown
  // again. Items that are still visible stay selected.
  if (inDrilldown && !showCompleted && selectedNodes.length !== selectedIds.length) {
    setSelectedIds(selectedNodes.length === 0 ? EMPTY_IDS : selectedNodes.map((node) => node.id))
  }
  // The data of the node the detail fly-out describes, resolved against the
  // CURRENT scene so a node hidden by the reference / completed filter (or gone
  // after a layout / mode change) simply yields `null` rather than stale data.
  // Any kind qualifies — the detail target is independent of the edge selection.
  const detailNode = useMemo(
    () => scene.nodes.find((candidate) => candidate.id === detailNodeId)?.data ?? null,
    [scene.nodes, detailNodeId],
  )
  // Drop a detail target the filters have hidden so it cannot silently return
  // when the filter is relaxed, mirroring the selection's drop-if-hidden rule.
  if (detailNodeId !== null && detailNode === null) {
    setDetailNodeId(null)
  }
  // Selection composes with the hover emphasis inside `highlightSelection`;
  // with nothing selected this is exactly `emphasizeEdges`.
  const displayEdges = useMemo(() => {
    const sole = selectedNodes.length === 1 ? selectedNodes[0] : null
    const highlighted =
      !inDrilldown || selectedNodes.length === 0
        ? null
        : sole
          ? sole.id
          : selectedNodes.map((node) => node.id)
    const options =
      selectedNodes.length > 1
        ? {
            reviewStatuses: Object.fromEntries(
              selectedNodes.flatMap((node) =>
                node.data.reviewStatus ? [[node.id, node.data.reviewStatus] as const] : [],
              ),
            ),
          }
        : sole?.data.reference
          ? { reference: true as const }
          : sole?.data.reviewStatus
            ? { reviewStatus: sole.data.reviewStatus }
            : undefined
    return highlightFrameEdges(
      frame.edges,
      highlighted,
      inDrilldown ? emphasisId : null,
      options,
    )
  }, [frame.edges, selectedNodes, emphasisId, inDrilldown])
  const lineage = useMemo(() => {
    if (selectedNodes.length === 0) return NO_LINEAGE
    if (selectedNodes.length === 1 && selectedNodes[0].data.reference) {
      return connectedNodeIds(scene.edges, selectedNodes[0].id)
    }
    const ids = new Set<string>()
    for (const node of selectedNodes) {
      for (const related of lineageNodeIds(scene.edges, node.id)) ids.add(related)
    }
    return ids
  }, [scene.edges, selectedNodes])
  const selectedIdSet = useMemo(() => {
    if (selectedNodes.length === 0) return EMPTY_SELECTION
    return new Set(selectedNodes.map((node) => node.id))
  }, [selectedNodes])

  const clearSelection = useCallback(() => {
    setSelectedIds(EMPTY_IDS)
    setAnnouncement('Selection cleared.')
  }, [])
  const toggleSelection = useCallback(
    (id: string) => {
      const data = scene.nodes.find((node) => node.id === id)?.data
      if (!data || !isSelectableNodeData(data)) return
      const label = data.label
      if (isNeedsReviewItem(data)) {
        if (selectedIds.includes(id)) {
          const next = selectedIds.filter((existing) => existing !== id)
          setSelectedIds(next.length === 0 ? EMPTY_IDS : next)
          setAnnouncement(selectionAnnouncement(label, next.length, 'remove'))
          return
        }
        if (selectedIds.length > 0 && !allNeedReview(selectedIds, scene.nodes)) {
          setSelectedIds([id])
          setAnnouncement(selectionAnnouncement(label, 1, 'replace'))
          return
        }
        const next = [...selectedIds, id]
        setSelectedIds(next)
        setAnnouncement(selectionAnnouncement(label, next.length, 'add'))
        return
      }
      if (selectedIds.length === 1 && selectedIds[0] === id) {
        setSelectedIds(EMPTY_IDS)
        setAnnouncement('Selection cleared.')
        return
      }
      setSelectedIds([id])
      setAnnouncement(selectionAnnouncement(label, 1, 'replace'))
    },
    [scene.nodes, selectedIds],
  )
  const selection = useMemo<SelectionState>(
    () => ({ selectedIds: selectedIdSet, lineageNodeIds: lineage, toggle: toggleSelection }),
    [selectedIdSet, lineage, toggleSelection],
  )

  // Escape: the first press clears a selection; only with nothing selected does
  // it return to the grid (ignore typing contexts).
  useEffect(() => {
    if (selectedUserId === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (typing) return
      if (hasSelection) {
        clearSelection()
        return
      }
      setSelectedUserId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedUserId, hasSelection, clearSelection])

  // Outcome of the latest refit, used by the scroll hint. Keyed by fitKey so a
  // stale outcome from a previous scene never shows.
  const [fitOutcome, setFitOutcome] = useState<FitOutcome | null>(null)
  const fitKey = `${
    inDrilldown
      ? `${selectedUserId}|${showReference ? 'ref' : 'noref'}|${rankdir}|${
          showCompleted ? 'done' : 'nodone'
        }|${showLegend ? 'legend' : 'nolegend'}`
      : 'grid'
  }|${showMinimap ? 'map' : 'nomap'}`
  const itemCount = useMemo(
    () =>
      scene.nodes.filter((node) => node.data.kind !== 'user' && !node.data.reference)
        .length,
    [scene.nodes],
  )

  // A degenerate user (no outgoing edges) yields a single-node subgraph. Judged
  // on the UNFILTERED subgraph so neither the reference nor the completed filter
  // triggers the empty note.
  const isDegenerate = inDrilldown && (subgraph?.edges.length ?? 0) === 0
  // Every first-level item is complete and hidden: only the user node is left.
  // Judged before the reference filter so that toggle cannot change the note.
  const allCompletedHidden =
    inDrilldown &&
    !showCompleted &&
    !isDegenerate &&
    (completedResult?.graph.nodes.every((node) => node.kind === 'user') ?? false)

  // Lazy mode only: the reference toggle reveals nested lineage / sources,
  // which only exist once the user's full composition has resolved. While it
  // is loading (or errored) the reference toggle would otherwise look like it
  // did nothing (no reference nodes to show yet, rather than none existing).
  const referencePending =
    lazy &&
    inDrilldown &&
    showReference &&
    !isDegenerate &&
    selectedUserDetail?.status !== 'ready'
  const retryUserDetail = () => {
    if (selectedIdentityId) onUserSelected?.(selectedIdentityId)
  }

  // Mouse convenience: in grid mode, clicking a card also drills in; in
  // drill-down, clicking a card selects or deselects it. Needs-review access
  // items accumulate; other cards replace the selection.
  const onNodeClick: NodeMouseHandler<AccessSceneNode> = (_event, node) => {
    if (selectedUserId === null) {
      // Grid mode: clicking a user card drills into that user — "selecting
      // them for processing" — so in lazy mode this is also exactly the one
      // place their full composition is requested. The detail target is set
      // in the drill-down scene (below) once the user is open; setting it
      // here would be dropped by the scene-change reset anyway.
      setSelectedUserId(node.id)
      onUserSelected?.(node.id.slice(USER_ID_PREFIX.length))
      return
    }
    // Drill-down: the click both drives the detail fly-out (any node kind) and,
    // for every node except the user, toggles the edge-highlight selection.
    setDetailNodeId((current) => (current === node.id ? null : node.id))
    if (isSelectableNodeData(node.data)) toggleSelection(node.id)
  }
  // Clicking the empty pane (never a card) clears the selection and the detail
  // target.
  const onPaneClick = () => {
    if (hasSelection) clearSelection()
    setDetailNodeId(null)
  }
  // Right-click. The pane handler only runs when the event target is the pane
  // itself (React Flow ignores bubbled context menus), so a card never opens
  // the canvas menu. Cards and edges still suppress the browser menu.
  const onPaneContextMenu = (event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault()
    setMenu({ kind: 'canvas', x: event.clientX, y: event.clientY })
  }
  const onNodeContextMenu: NodeMouseHandler<AccessSceneNode> = (event, node) => {
    suppressContextMenu(event)
    if (showsDecisionMenu(node.data, inDrilldown)) {
      setMenu({ kind: 'decision', x: event.clientX, y: event.clientY })
      return
    }
    setMenu(null)
  }
  const onEdgeContextMenu = (event: ReactMouseEvent) => {
    suppressContextMenu(event)
    setMenu(null)
  }
  const onPinnedContextMenu = (event: ReactMouseEvent) => {
    suppressContextMenu(event)
    setMenu(null)
  }

  const toggleLayout = () => {
    const next: RankDir = rankdir === 'LR' ? 'TB' : 'LR'
    setRankdir(next)
    setAnnouncement(
      `Layout changed to ${next === 'LR' ? 'vertical' : 'horizontal'}.`,
    )
  }
  const toggleReference = () => {
    setShowReference(!showReference)
    setAnnouncement(
      showReference
        ? 'Reference nodes and links hidden.'
        : 'Reference nodes and links shown.',
    )
  }
  const toggleCompleted = () => {
    setShowCompleted(!showCompleted)
    setAnnouncement(
      showCompleted
        ? `Completed items hidden (${completedResult?.hiddenCount ?? 0}).`
        : 'Completed items shown.',
    )
  }
  const toggleMinimap = () => {
    setShowMinimap(!showMinimap)
    setAnnouncement(showMinimap ? 'Minimap hidden.' : 'Minimap shown.')
  }
  const toggleLegend = () => {
    setShowLegend(!showLegend)
    setAnnouncement(showLegend ? 'Legend hidden.' : 'Legend shown.')
  }
  const toggleDetail = () => {
    setShowDetail(!showDetail)
    setAnnouncement(showDetail ? 'Details panel hidden.' : 'Details panel shown.')
  }
  const controlItems = graphControlItems({
    inDrilldown,
    rankdir,
    onToggleLayout: toggleLayout,
    showReference,
    onToggleReference: toggleReference,
    showCompleted,
    onToggleCompleted: toggleCompleted,
    hiddenCompletedCount: completedResult ? completedResult.hiddenCount : null,
    showMinimap,
    onToggleMinimap: toggleMinimap,
    showLegend,
    onToggleLegend: toggleLegend,
    showDetail,
    onToggleDetail: toggleDetail,
  })

  return (
    <div className="vc-graph-wrap" ref={wrapRef}>
      <p className="sr-only" aria-live="polite">
        {inDrilldown ? 'Showing access for one user' : `Showing ${userCount} users`}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <EmphasisContext.Provider value={emphasis}>
      <SelectionContext.Provider value={selection}>
      <ReactFlow
        nodes={frame.nodes}
        edges={displayEdges}
        className={motionMs > 0 && motionOn ? 'motion-on' : undefined}
        nodeTypes={nodeTypes}
        colorMode={colorMode}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        panOnScroll
        fitView
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
      >
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            maskColor={colorMode === 'dark' ? 'rgba(16,22,29,0.72)' : 'rgba(238,242,246,0.72)'}
            nodeColor={(node) =>
              MINIMAP_COLOR[(node.data as AccessSceneNodeData).kind] ?? '#9aafc2'
            }
          />
        )}
        <Controls showInteractive={false} />
        <FitOnSceneChange
          fitKey={fitKey}
          rankdir={rankdir}
          inDrilldown={inDrilldown}
          targetNodes={layoutNodes}
          placed={placed}
          motionMs={motionMs}
          onPlan={setFitOutcome}
        />
        {inDrilldown && !isDegenerate && (
          <ScrollHint
            itemCount={itemCount}
            active={fitOutcome?.fitKey === fitKey && fitOutcome.long}
          />
        )}
        <Panel position="top-left" className="vc-graph-controls-panel">
          <GraphControls
            inDrilldown={inDrilldown}
            rankdir={rankdir}
            onToggleLayout={toggleLayout}
            showReference={showReference}
            onToggleReference={toggleReference}
            showCompleted={showCompleted}
            onToggleCompleted={toggleCompleted}
            hiddenCompletedCount={completedResult ? completedResult.hiddenCount : null}
            showMinimap={showMinimap}
            onToggleMinimap={toggleMinimap}
            showLegend={showLegend}
            onToggleLegend={toggleLegend}
            showDetail={showDetail}
            onToggleDetail={toggleDetail}
          />
        </Panel>
        {pinnedUser && (
          <Panel position="top-left" className="vc-graph-user-pin">
            <PinnedAccessCard
              id={pinnedUser.id}
              data={pinnedUser.data}
              onContextMenu={onPinnedContextMenu}
              onActivate={() =>
                setDetailNodeId((current) =>
                  current === pinnedUser.id ? null : pinnedUser.id,
                )
              }
            />
          </Panel>
        )}
        {inDrilldown && backSlot === undefined && (
          <Panel position="top-left" className="vc-graph-nav-panel">
            <button
              type="button"
              className="vc-graph-toggle"
              onClick={() => setSelectedUserId(null)}
            >
              ← All Users
            </button>
          </Panel>
        )}
        {/* Hosted by the parent view: the same button, portaled into the slot
            next to the view's own "Back to overview" button, outside the canvas. */}
        {inDrilldown && backSlot
          ? createPortal(
              <button
                type="button"
                className="vc-link-btn"
                onClick={() => setSelectedUserId(null)}
              >
                ← All Users
              </button>,
              backSlot,
            )
          : null}
        {/* The node legend is its own bottom-left panel, offset in CSS to sit
            beside the zoom controls (React Flow pins every same-position panel
            to the same corner). The user grid never mounts it. */}
        {inDrilldown && showLegend && (
          <Panel position="bottom-left" className="vc-graph-legend-panel">
            <GraphLegend />
          </Panel>
        )}
        {showDetail && (
          <Panel position="top-right" className="vc-graph-right-stack">
            <NodeDetailPanel
              node={detailNode}
              onClose={() => setShowDetail(false)}
            />
          </Panel>
        )}
        {isDegenerate && (
          <Panel position="top-center">
            <p className="vc-graph-note">No expanded access for this user.</p>
          </Panel>
        )}
        {allCompletedHidden && (
          <Panel position="top-center">
            <p className="vc-graph-note">
              All access items are complete. Show completed items to see them.
            </p>
          </Panel>
        )}
        {referencePending && selectedUserDetail?.status === 'error' && (
          <Panel position="top-center">
            <p className="vc-graph-note">
              Couldn&rsquo;t load this user&rsquo;s full access details.{' '}
              <button type="button" className="vc-link-btn" onClick={retryUserDetail}>
                Try again
              </button>
            </p>
          </Panel>
        )}
        {referencePending && selectedUserDetail?.status !== 'error' && (
          <Panel position="top-center">
            <p className="vc-graph-note">Loading this user&rsquo;s full access details…</p>
          </Panel>
        )}
        {menu && (
          <GraphContextMenu
            menu={menu}
            items={controlItems}
            motionMs={motionMs}
            onClose={closeMenu}
          />
        )}
      </ReactFlow>
      </SelectionContext.Provider>
      </EmphasisContext.Provider>
    </div>
  )
}
