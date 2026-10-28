import type { RankDir } from '../sailpoint/types'
import { ControlHint } from './ControlHint'
import { ControlIcon } from './ControlIcons'
import { graphControlItems } from './graphControlItems'
import './GraphControls.css'

interface GraphControlsProps {
  /** Drill-down shows the full toolbar. The user grid shows only the minimap. */
  inDrilldown: boolean
  rankdir: RankDir
  onToggleLayout: () => void
  showReference: boolean
  onToggleReference: () => void
  /** Completed items (approved / revoked / reassigned) are shown. */
  showCompleted: boolean
  onToggleCompleted: () => void
  /** Completed items the filter hides for this user; null when unknown (grid). */
  hiddenCompletedCount: number | null
  showMinimap: boolean
  onToggleMinimap: () => void
  /** The node legend is shown. The button itself is drill-down only. */
  showLegend: boolean
  onToggleLegend: () => void
  /** The right-side node detail fly-out panel is shown. The button is drill-down only. */
  showDetail: boolean
  onToggleDetail: () => void
}

/**
 * The left-side vertical control panel for the access graph, styled after
 * org-graph's floating toolbar. In the user grid the panel is only the minimap
 * toggle. In drill-down, top to bottom: layout direction, reference nodes/links
 * visibility, completed items visibility, legend visibility, minimap visibility,
 * node detail panel visibility. The canvas context menu lists these same
 * actions (`graphControlItems`).
 */
export function GraphControls(props: GraphControlsProps) {
  const items = graphControlItems(props)
  return (
    <div className="vc-graph-controls" role="toolbar" aria-label="Graph controls">
      {items.map((item) => (
        <ControlHint key={item.id} label={item.label}>
          <button
            type="button"
            className={`vc-graph-control${item.pressed ? ' vc-graph-control-active' : ''}`}
            aria-label={item.label}
            aria-pressed={item.pressed}
            onClick={item.onSelect}
          >
            <ControlIcon name={item.icon} />
          </button>
        </ControlHint>
      ))}
    </div>
  )
}
