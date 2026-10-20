import { useEffect, useMemo, useState } from 'react'
import {
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useStore,
  type NodeMouseHandler,
} from '@xyflow/react'
import type { AccessGraphData, AccessSceneNodeData, RankDir } from '../sailpoint/types'
import { buildAccessScene, type AccessSceneNode } from './buildAccessScene'
import { buildUserGridScene } from './buildUserGridScene'
import { userSubgraph } from './userSubgraph'
import { AccessNode } from './AccessNode'
import { useColorMode } from './useColorMode'
import { EmptyState } from '../components/EmptyState'
import './AccessGraph.css'

/** React Flow node-type registry for the access graph. */
const nodeTypes = { access: AccessNode }

interface AccessGraphCanvasProps {
  /** The derived graph (nodes + edges) from the access matrix. */
  graph: AccessGraphData
}

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
 *    (`buildUserGridScene`), each a selectable control. No edges, no direction
 *    toggle — the LR/TB toggle is meaningless without the dagre layout.
 * 2. DRILL-DOWN: activating a user card shows ONLY that user's forward-reachable
 *    subgraph (`buildAccessScene(userSubgraph(graph, id), rankdir)`), with a
 *    "Back to all users" panel control and Escape returning to the grid.
 *
 * Structure mirrors org-graph's `OrgCanvas`: a `ReactFlowProvider` wrapping a
 * surface that reads the viewport width from the React Flow store, derives
 * `colorMode` from the OS color scheme, memoizes the pure scene builders, and
 * renders a read-only graph (no dragging, no connecting) with a minimap and
 * controls. When the graph has no users it renders an `EmptyState` instead.
 */
export function AccessGraphCanvas({ graph }: AccessGraphCanvasProps) {
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
      <CanvasSurface graph={graph} />
    </ReactFlowProvider>
  )
}

function CanvasSurface({ graph }: AccessGraphCanvasProps) {
  const [rankdir, setRankdir] = useState<RankDir>('LR')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const colorMode = useColorMode()
  const width = useStore((state) => state.width)

  // Reset to the grid whenever the campaign/graph changes. Tracking the prior
  // graph in state and adjusting during render is React's recommended pattern
  // for deriving state from props (avoids the extra commit + effect round-trip
  // of resetting in a useEffect, which the lint config also disallows).
  const [prevGraph, setPrevGraph] = useState(graph)
  if (prevGraph !== graph) {
    setPrevGraph(graph)
    setSelectedUserId(null)
  }

  // Escape returns to the grid while in drill-down (ignore typing contexts).
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
      setSelectedUserId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedUserId])

  const userCount = useMemo(
    () => graph.nodes.filter((node) => node.kind === 'user').length,
    [graph],
  )

  const subgraph = useMemo(
    () => (selectedUserId ? userSubgraph(graph, selectedUserId) : null),
    [graph, selectedUserId],
  )

  const scene = useMemo(() => {
    if (selectedUserId === null) {
      return buildUserGridScene(
        graph,
        width || window.innerWidth,
        setSelectedUserId,
      )
    }
    return buildAccessScene(subgraph ?? { nodes: [], edges: [] }, rankdir)
  }, [graph, selectedUserId, subgraph, rankdir, width])

  const inDrilldown = selectedUserId !== null
  // A degenerate user (no outgoing edges) yields a single-node subgraph.
  const isDegenerate = inDrilldown && (subgraph?.edges.length ?? 0) === 0

  // Mouse convenience: in grid mode, clicking a card also drills in.
  const onNodeClick: NodeMouseHandler<AccessSceneNode> = (_event, node) => {
    if (selectedUserId === null) setSelectedUserId(node.id)
  }

  return (
    <div className="vc-graph-wrap">
      <p className="sr-only" aria-live="polite">
        {inDrilldown ? 'Showing access for one user' : `Showing ${userCount} users`}
      </p>
      <ReactFlow
        nodes={scene.nodes}
        edges={scene.edges}
        nodeTypes={nodeTypes}
        colorMode={colorMode}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        panOnScroll
        fitView
        minZoom={0.15}
        maxZoom={1.8}
        onNodeClick={onNodeClick}
      >
        <MiniMap
          pannable
          zoomable
          maskColor={colorMode === 'dark' ? 'rgba(16,22,29,0.72)' : 'rgba(238,242,246,0.72)'}
          nodeColor={(node) =>
            MINIMAP_COLOR[(node.data as AccessSceneNodeData).kind] ?? '#9aafc2'
          }
        />
        <Controls showInteractive={false} />
        {inDrilldown && (
          <Panel position="top-left">
            <button
              type="button"
              className="vc-graph-toggle"
              onClick={() => setSelectedUserId(null)}
            >
              ← Back to all users
            </button>
            <button
              type="button"
              className="vc-graph-toggle"
              aria-pressed={rankdir === 'TB'}
              onClick={() => setRankdir((d) => (d === 'LR' ? 'TB' : 'LR'))}
            >
              {rankdir === 'LR' ? 'Layout: vertical' : 'Layout: horizontal'}
            </button>
          </Panel>
        )}
        {inDrilldown && (
          <Panel position="bottom-left">
            <div className="vc-graph-legend" role="group" aria-label="Review status legend">
              <p className="vc-graph-legend-title">Review status</p>
              <span className="vc-graph-legend-row">
                <span
                  aria-hidden="true"
                  className="vc-graph-legend-swatch vc-graph-legend-swatch-needsReview"
                />
                Needs review
              </span>
              <span className="vc-graph-legend-row">
                <span
                  aria-hidden="true"
                  className="vc-graph-legend-swatch vc-graph-legend-swatch-complete"
                />
                Review complete
              </span>
            </div>
          </Panel>
        )}
        {isDegenerate && (
          <Panel position="top-right">
            <p className="vc-graph-note">No expanded access for this user.</p>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}
