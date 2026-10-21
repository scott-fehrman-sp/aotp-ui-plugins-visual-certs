import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { buildAccessScene, type AccessSceneNode } from './buildAccessScene'
import { buildUserGridScene } from './buildUserGridScene'
import { userSubgraph } from './userSubgraph'
import { withoutReference } from './referenceFilter'
import { withoutCompleted } from './completedFilter'
import { computeFitPadding, measureOverlays, planFit, toFitViewPadding } from './fitPadding'
import { EmphasisContext } from './EmphasisContext'
import { SelectionContext, type SelectionState } from './SelectionContext'
import { highlightEdges, isSelectableNodeData, lineageNodeIds } from './selectEdges'
import { ScrollHint } from './ScrollHint'
import { GraphControls } from './GraphControls'
import { AccessNode, StatusIcon } from './AccessNode'
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
   * button (saving the canvas's top-left corner and keeping both back controls
   * together). The canvas still owns the selected-user state; it just portals
   * the button into this element.
   *  - `undefined` (prop omitted): the button renders inside the canvas, in a
   *    top-left panel, as it always has (standalone use / existing tests).
   *  - an element: the button is portaled into it.
   *  - `null`: the host's slot has not mounted yet; render nothing for now.
   */
  backSlot?: HTMLElement | null
}

/** Shared empty lineage, so "nothing selected" keeps a stable context value. */
const NO_LINEAGE: ReadonlySet<string> = new Set()

/** Zoom range of the canvas (also the bounds planFit clamps to). */
const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.8

/** Minimap dot color per layer, matched to the card accents. */
const MINIMAP_COLOR: Record<string, string> = {
  user: '#0b4f8a',
  role: '#6b3fa0',
  accessProfile: '#0e7a43',
  entitlement: '#9c5836',
  source: '#3a4d5e',
}

/**
 * The React Flow canvas for the access graph. It has two modes:
 *
 * 1. OVERVIEW (default): only `user`-kind cards, laid out in a centered grid
 *    (`buildUserGridScene`), each a selectable control. No edges; the layout and
 *    reference toggles in the control panel are disabled (they only apply to the
 *    dagre drill-down layout).
 * 2. DRILL-DOWN: activating a user card shows ONLY that user's forward-reachable
 *    subgraph (`buildAccessScene(userSubgraph(graph, id), rankdir)`), with a
 *    "Back to all users" panel control and Escape returning to the grid. The
 *    reference toggle can hide the reference-only lineage (nested items,
 *    sources) so only the reviewable first level remains.
 *
 * SELECTION (drill-down only). Clicking a first-level card (role, access
 * profile or directly-held entitlement), or pressing Enter / Space on it,
 * selects it; doing it again deselects. One item at a time. The selected item's
 * associated edges (its user -> item edge plus every visible edge downstream to
 * the sources) are highlighted in its status color and all other edges dim; see
 * `highlightEdges`. Reference-only cards are not selectable. The selection is
 * cleared by clicking the same card, clicking the empty pane, or Escape (the
 * first Escape clears the selection, only a second one returns to the grid),
 * and by drilling into another user, going back, or a new node set. It survives
 * the layout, reference, completed and minimap toggles and a status-only
 * refresh, except that hiding completed items clears the selection when the
 * selected item gets hidden. Selecting
 * is a cheap edge restyle: the scene, the node objects and the fit are
 * untouched, exactly like hover.
 *
 * Every fit (drill-down entry, user switch, reference/layout/minimap toggle,
 * window resize) is overlay-aware: it pads the viewport by the measured size of
 * the legend, minimap, controls and panels so no card sits under them.
 *
 * A right-side vertical control panel (`GraphControls`, in both modes) holds the
 * layout direction, reference visibility, completed-items visibility and
 * minimap toggles. Those preferences live in memory and survive switching users
 * and grid/drill-down. The completed toggle (drill-down only) hides the
 * first-level items whose status is approved / revoked / reassigned plus any
 * lineage left orphaned (`withoutCompleted`), re-lays out and refits once.
 *
 * Structure mirrors org-graph's `OrgCanvas`: a `ReactFlowProvider` wrapping a
 * surface that reads the viewport width from the React Flow store, derives
 * `colorMode` from the OS color scheme, memoizes the pure scene builders, and
 * renders a read-only graph (no dragging, no connecting) with a minimap and
 * controls. When the graph has no users it renders an `EmptyState` instead.
 */
export function AccessGraphCanvas({ graph, backSlot }: AccessGraphCanvasProps) {
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
      <CanvasSurface graph={graph} backSlot={backSlot} />
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
 *   content START is aligned to the overlay-free region (rank axis), or the
 *   user is centered when the lane is too long to start-align it (the user
 *   sits at the lane midpoint), and overlays are assigned away from the scroll
 *   axis. The user card and nearest items are clear of every overlay; the rest
 *   is reached by scrolling or dragging, and the scroll hint says so. The
 *   Controls fit-view button still shows everything.
 * The overview grid keeps the plain overlay-aware `fitView`. Refit triggers are
 * unchanged (`fitKey`, canvas size); node data is read inside the frame
 * callback so scene changes do not add triggers.
 */
function FitOnSceneChange({
  fitKey,
  rankdir,
  inDrilldown,
  onPlan,
}: {
  fitKey: string
  rankdir: RankDir
  inDrilldown: boolean
  onPlan: (outcome: FitOutcome) => void
}) {
  const { fitView, setViewport, getNodes } = useReactFlow()
  const store = useStoreApi()
  // Canvas size changes (window resize) must refit too.
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = store.getState().domNode
      if (!root) {
        void fitView()
        return
      }
      const { canvas, overlays } = measureOverlays(root)
      const nodes = inDrilldown ? getNodes() : []
      const user = nodes.find(
        (node) => (node.data as AccessSceneNodeData).kind === 'user',
      )
      if (!user) {
        void fitView({ padding: toFitViewPadding(computeFitPadding(canvas, overlays)) })
        onPlan({ fitKey, long: false })
        return
      }
      const plan = planFit({
        bounds: getNodesBounds(nodes),
        focus: getNodesBounds([user]),
        canvas,
        overlays,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        scrollAxis: rankdir === 'LR' ? 'y' : 'x',
      })
      if (plan.mode === 'readable') {
        void setViewport(plan.viewport, { duration: 0 })
      } else {
        void fitView({ padding: toFitViewPadding(plan.padding) })
      }
      onPlan({ fitKey, long: plan.mode === 'readable' })
    })
    return () => cancelAnimationFrame(frame)
    // rankdir and inDrilldown are encoded in fitKey; onPlan, setViewport and
    // getNodes are stable. So the refit triggers stay exactly fitKey + canvas size.
  }, [fitKey, width, height, fitView, setViewport, getNodes, rankdir, inDrilldown, onPlan, store])
  return null
}

function CanvasSurface({ graph, backSlot }: AccessGraphCanvasProps) {
  const [rankdir, setRankdir] = useState<RankDir>('LR')
  const [showReference, setShowReference] = useState(true)
  // Completed (approved / revoked / reassigned) items are shown by default.
  const [showCompleted, setShowCompleted] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [announcement, setAnnouncement] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  // The selected first-level item (node id) whose edges are highlighted.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
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
    setSelectedItemId(null)
  }

  // The selected item belongs to one user's drill-down: drilling into another
  // user, going back to the grid or Escape-to-grid all drop it. (Layout,
  // reference and minimap toggles and status-only refreshes keep it.)
  const [prevUserId, setPrevUserId] = useState(selectedUserId)
  if (prevUserId !== selectedUserId) {
    setPrevUserId(selectedUserId)
    setSelectedItemId(null)
  }

  const userCount = useMemo(
    () => graph.nodes.filter((node) => node.kind === 'user').length,
    [graph],
  )

  const subgraph = useMemo(
    () => (selectedUserId ? userSubgraph(graph, selectedUserId) : null),
    [graph, selectedUserId],
  )

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
        graph,
        width || window.innerWidth,
        setSelectedUserId,
      )
    }
    // Reference shown OR hidden, each access type keeps its own column (LR) /
    // row (TB), in the fixed order role, access profile, entitlement (then
    // sources when reference is shown). Hiding reference only removes the
    // nested lineage and the sources; the reviewable items stay in the same
    // lanes, so toggling reference never rearranges them by kind.
    return buildAccessScene(visibleGraph ?? { nodes: [], edges: [] }, rankdir)
  }, [graph, selectedUserId, visibleGraph, rankdir, width])

  const inDrilldown = selectedUserId !== null

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
  // Pointer wins; a keyboard-focused card stays emphasized once the pointer
  // leaves another card. Purely an edge restyle: no layout or refit input.
  const emphasisId = hoverId ?? focusId
  // Only a first-level node of the current scene can be the active selection.
  const activeItemId = useMemo(() => {
    if (!inDrilldown || selectedItemId === null) return null
    const node = scene.nodes.find((candidate) => candidate.id === selectedItemId)
    return node && isSelectableNodeData(node.data) ? node.id : null
  }, [inDrilldown, selectedItemId, scene.nodes])
  // A selection whose item was hidden by the completed filter is dropped (not
  // merely inert), so it cannot silently come back when completed items are
  // shown again. Selecting a still-visible item is untouched.
  if (inDrilldown && !showCompleted && selectedItemId !== null && activeItemId === null) {
    setSelectedItemId(null)
  }
  // Selection composes with the hover emphasis inside `highlightEdges`; with
  // nothing selected this is exactly `emphasizeEdges`.
  const displayEdges = useMemo(
    () =>
      highlightEdges(
        scene.edges,
        inDrilldown ? activeItemId : null,
        inDrilldown ? emphasisId : null,
      ),
    [scene.edges, activeItemId, emphasisId, inDrilldown],
  )
  const lineage = useMemo(
    () => (activeItemId === null ? NO_LINEAGE : lineageNodeIds(scene.edges, activeItemId)),
    [scene.edges, activeItemId],
  )

  const clearSelection = useCallback(() => {
    setSelectedItemId(null)
    setAnnouncement('Selection cleared.')
  }, [])
  const toggleSelection = useCallback(
    (id: string) => {
      if (id === activeItemId) {
        clearSelection()
        return
      }
      const label = scene.nodes.find((node) => node.id === id)?.data.label ?? ''
      setSelectedItemId(id)
      setAnnouncement(`Highlighting the links for ${label}. Press Escape to clear.`)
    },
    [activeItemId, scene.nodes, clearSelection],
  )
  const selection = useMemo<SelectionState>(
    () => ({ selectedId: activeItemId, lineageNodeIds: lineage, toggle: toggleSelection }),
    [activeItemId, lineage, toggleSelection],
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
      if (activeItemId !== null) {
        clearSelection()
        return
      }
      setSelectedUserId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedUserId, activeItemId, clearSelection])

  // Outcome of the latest refit, used by the scroll hint. Keyed by fitKey so a
  // stale outcome from a previous scene never shows.
  const [fitOutcome, setFitOutcome] = useState<FitOutcome | null>(null)
  const fitKey = `${
    inDrilldown
      ? `${selectedUserId}|${showReference ? 'ref' : 'noref'}|${rankdir}|${
          showCompleted ? 'done' : 'nodone'
        }`
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

  // Mouse convenience: in grid mode, clicking a card also drills in; in
  // drill-down, clicking a first-level card selects / deselects it.
  const onNodeClick: NodeMouseHandler<AccessSceneNode> = (_event, node) => {
    if (selectedUserId === null) setSelectedUserId(node.id)
    else if (isSelectableNodeData(node.data)) toggleSelection(node.id)
  }
  // Clicking the empty pane (never a card) clears the selection.
  const onPaneClick = () => {
    if (activeItemId !== null) clearSelection()
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

  return (
    <div className="vc-graph-wrap">
      <p className="sr-only" aria-live="polite">
        {inDrilldown ? 'Showing access for one user' : `Showing ${userCount} users`}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <EmphasisContext.Provider value={emphasis}>
      <SelectionContext.Provider value={selection}>
      <ReactFlow
        nodes={scene.nodes}
        edges={displayEdges}
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
          onPlan={setFitOutcome}
        />
        {inDrilldown && !isDegenerate && (
          <ScrollHint
            itemCount={itemCount}
            active={fitOutcome?.fitKey === fitKey && fitOutcome.long}
          />
        )}
        <Panel position="top-right" className="vc-graph-controls-panel">
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
          />
        </Panel>
        {inDrilldown && backSlot === undefined && (
          <Panel position="top-left" className="vc-graph-nav-panel">
            <button
              type="button"
              className="vc-graph-toggle"
              onClick={() => setSelectedUserId(null)}
            >
              ← Back to all users
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
                ← Back to all users
              </button>,
              backSlot,
            )
          : null}
        {inDrilldown && (
          <Panel position="bottom-left" className="vc-graph-legend-panel">
            <div className="vc-graph-legend" role="group" aria-label="Review status legend">
              <p className="vc-graph-legend-title">Review status</p>
              <span className="vc-graph-legend-row">
                <StatusIcon status="needsReview" decorative />
                Needs review
              </span>
              <span className="vc-graph-legend-row">
                <StatusIcon status="approved" decorative />
                Approved
              </span>
              <span className="vc-graph-legend-row">
                <StatusIcon status="revoked" decorative />
                Revoked
              </span>
              <span className="vc-graph-legend-row">
                <StatusIcon status="reassigned" decorative />
                Reassigned
              </span>
              {showReference && (
                <span className="vc-graph-legend-row">
                  <span
                    className="vc-graph-legend-swatch vc-graph-legend-swatch-reference"
                    aria-hidden="true"
                  />
                  Reference Only
                </span>
              )}
            </div>
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
      </ReactFlow>
      </SelectionContext.Provider>
      </EmphasisContext.Provider>
    </div>
  )
}
