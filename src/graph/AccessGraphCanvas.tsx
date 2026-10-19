import { useMemo, useState } from 'react'
import {
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import type { AccessGraphData, AccessSceneNodeData, RankDir } from '../sailpoint/types'
import { buildAccessScene } from './buildAccessScene'
import { AccessNode } from './AccessNode'
import { useColorMode } from './useColorMode'
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
 * The React Flow canvas that renders the access graph. Structure mirrors
 * org-graph's `OrgCanvas`: a `ReactFlowProvider` wrapping a surface that holds
 * the layout direction, derives `colorMode` from the OS color scheme, memoizes
 * the pure `buildAccessScene`, and renders the read-only graph (no dragging, no
 * connecting) with a minimap, controls, and a direction toggle panel.
 */
export function AccessGraphCanvas({ graph }: AccessGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasSurface graph={graph} />
    </ReactFlowProvider>
  )
}

function CanvasSurface({ graph }: AccessGraphCanvasProps) {
  const [rankdir, setRankdir] = useState<RankDir>('LR')
  const colorMode = useColorMode()
  const scene = useMemo(() => buildAccessScene(graph, rankdir), [graph, rankdir])

  return (
    <div className="vc-graph-wrap">
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
        <Panel position="top-left">
          <button
            type="button"
            className="vc-graph-toggle"
            aria-pressed={rankdir === 'TB'}
            onClick={() => setRankdir((d) => (d === 'LR' ? 'TB' : 'LR'))}
          >
            {rankdir === 'LR' ? 'Layout: vertical' : 'Layout: horizontal'}
          </button>
        </Panel>
      </ReactFlow>
    </div>
  )
}
