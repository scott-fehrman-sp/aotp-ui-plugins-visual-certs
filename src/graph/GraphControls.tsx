import type { RankDir } from '../sailpoint/types'
import { ControlHint } from './ControlHint'
import { ControlIcon } from './ControlIcons'
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
 * node detail panel visibility.
 */
export function GraphControls({
  inDrilldown,
  rankdir,
  onToggleLayout,
  showReference,
  onToggleReference,
  showCompleted,
  onToggleCompleted,
  hiddenCompletedCount,
  showMinimap,
  onToggleMinimap,
  showLegend,
  onToggleLegend,
  showDetail,
  onToggleDetail,
}: GraphControlsProps) {
  const leftToRight = rankdir === 'LR'
  const layoutLabel = leftToRight ? 'Layout: vertical' : 'Layout: horizontal'
  const referenceLabel = showReference
    ? 'Hide reference nodes and links'
    : 'Show reference nodes and links'
  const completedLabel = showCompleted
    ? 'Hide completed items'
    : hiddenCompletedCount === null
      ? 'Show completed items'
      : `Show completed items (${hiddenCompletedCount} hidden)`
  const legendLabel = showLegend ? 'Hide legend' : 'Show legend'
  const minimapLabel = showMinimap ? 'Hide minimap' : 'Show minimap'
  const detailLabel = showDetail ? 'Hide details panel' : 'Show details panel'

  return (
    <div className="vc-graph-controls" role="toolbar" aria-label="Graph controls">
      {inDrilldown && (
        <>
          <ControlHint label={layoutLabel}>
            <button
              type="button"
              className={`vc-graph-control${leftToRight ? ' vc-graph-control-active' : ''}`}
              aria-label={layoutLabel}
              aria-pressed={leftToRight}
              onClick={onToggleLayout}
            >
              <ControlIcon name="layout" />
            </button>
          </ControlHint>
          <ControlHint label={referenceLabel}>
            <button
              type="button"
              className={`vc-graph-control${showReference ? ' vc-graph-control-active' : ''}`}
              aria-label={referenceLabel}
              aria-pressed={showReference}
              onClick={onToggleReference}
            >
              <ControlIcon name="reference" />
            </button>
          </ControlHint>
          <ControlHint label={completedLabel}>
            <button
              type="button"
              className={`vc-graph-control${showCompleted ? ' vc-graph-control-active' : ''}`}
              aria-label={completedLabel}
              aria-pressed={showCompleted}
              onClick={onToggleCompleted}
            >
              <ControlIcon name={showCompleted ? 'completed' : 'completedHidden'} />
            </button>
          </ControlHint>
          <ControlHint label={legendLabel}>
            <button
              type="button"
              className={`vc-graph-control${showLegend ? ' vc-graph-control-active' : ''}`}
              aria-label={legendLabel}
              aria-pressed={showLegend}
              onClick={onToggleLegend}
            >
              <ControlIcon name="legend" />
            </button>
          </ControlHint>
        </>
      )}
      <ControlHint label={minimapLabel}>
        <button
          type="button"
          className={`vc-graph-control${showMinimap ? ' vc-graph-control-active' : ''}`}
          aria-label={minimapLabel}
          aria-pressed={showMinimap}
          onClick={onToggleMinimap}
        >
          <ControlIcon name="minimap" />
        </button>
      </ControlHint>
      {inDrilldown && (
        <ControlHint label={detailLabel}>
          <button
            type="button"
            className={`vc-graph-control${showDetail ? ' vc-graph-control-active' : ''}`}
            aria-label={detailLabel}
            aria-pressed={showDetail}
            onClick={onToggleDetail}
          >
            <ControlIcon name="detail" />
          </button>
        </ControlHint>
      )}
    </div>
  )
}
