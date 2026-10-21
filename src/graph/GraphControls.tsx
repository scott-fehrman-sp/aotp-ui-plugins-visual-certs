import type { RankDir } from '../sailpoint/types'
import { ControlHint } from './ControlHint'
import { ControlIcon } from './ControlIcons'
import './GraphControls.css'

interface GraphControlsProps {
  /** Layout and reference toggles only apply while drilled into a user. */
  inDrilldown: boolean
  rankdir: RankDir
  onToggleLayout: () => void
  showReference: boolean
  onToggleReference: () => void
  showMinimap: boolean
  onToggleMinimap: () => void
}

/**
 * The right-side vertical control panel for the access graph, styled after
 * org-graph's floating toolbar. Top to bottom: layout direction, reference
 * nodes/links visibility, minimap visibility.
 */
export function GraphControls({
  inDrilldown,
  rankdir,
  onToggleLayout,
  showReference,
  onToggleReference,
  showMinimap,
  onToggleMinimap,
}: GraphControlsProps) {
  const leftToRight = rankdir === 'LR'
  const layoutLabel = !inDrilldown
    ? 'Layout (open a user to change)'
    : leftToRight
      ? 'Layout: vertical'
      : 'Layout: horizontal'
  const referenceLabel = !inDrilldown
    ? 'Reference nodes and links (open a user to change)'
    : showReference
      ? 'Hide reference nodes and links'
      : 'Show reference nodes and links'
  const minimapLabel = showMinimap ? 'Hide minimap' : 'Show minimap'

  return (
    <div className="vc-graph-controls" role="toolbar" aria-label="Graph controls">
      <ControlHint label={layoutLabel}>
        <button
          type="button"
          className={`vc-graph-control${leftToRight ? ' vc-graph-control-active' : ''}`}
          aria-label={layoutLabel}
          aria-pressed={leftToRight}
          disabled={!inDrilldown}
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
          disabled={!inDrilldown}
          onClick={onToggleReference}
        >
          <ControlIcon name="reference" />
        </button>
      </ControlHint>
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
    </div>
  )
}
