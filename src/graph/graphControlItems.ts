/**
 * The control-panel actions, in toolbar order, shared by the icon toolbar and
 * the canvas context menu so the two cannot drift. The user grid is only the
 * minimap toggle. Drill-down adds layout, reference, completed, legend, and
 * the details panel around it. Each label is the action a click performs
 * (the toolbar's accessible name), not a separate description of the state.
 */
import type { RankDir } from '../sailpoint/types'
import type { ControlIconName } from './ControlIcons'

export interface GraphControlItem {
  id: string
  label: string
  icon: ControlIconName
  /** Mirrors the toolbar button's pressed state. */
  pressed: boolean
  onSelect: () => void
}

export function graphControlItems(input: {
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
}): GraphControlItem[] {
  const leftToRight = input.rankdir === 'LR'
  const layout: GraphControlItem = {
    id: 'layout',
    label: leftToRight ? 'Layout: vertical' : 'Layout: horizontal',
    icon: 'layout',
    pressed: leftToRight,
    onSelect: input.onToggleLayout,
  }
  const reference: GraphControlItem = {
    id: 'reference',
    label: input.showReference
      ? 'Hide reference nodes and links'
      : 'Show reference nodes and links',
    icon: 'reference',
    pressed: input.showReference,
    onSelect: input.onToggleReference,
  }
  const completed: GraphControlItem = {
    id: 'completed',
    label: input.showCompleted
      ? 'Hide completed items'
      : input.hiddenCompletedCount === null
        ? 'Show completed items'
        : `Show completed items (${input.hiddenCompletedCount} hidden)`,
    icon: input.showCompleted ? 'completed' : 'completedHidden',
    pressed: input.showCompleted,
    onSelect: input.onToggleCompleted,
  }
  const legend: GraphControlItem = {
    id: 'legend',
    label: input.showLegend ? 'Hide legend' : 'Show legend',
    icon: 'legend',
    pressed: input.showLegend,
    onSelect: input.onToggleLegend,
  }
  const minimap: GraphControlItem = {
    id: 'minimap',
    label: input.showMinimap ? 'Hide minimap' : 'Show minimap',
    icon: 'minimap',
    pressed: input.showMinimap,
    onSelect: input.onToggleMinimap,
  }
  const detail: GraphControlItem = {
    id: 'detail',
    label: input.showDetail ? 'Hide details panel' : 'Show details panel',
    icon: 'detail',
    pressed: input.showDetail,
    onSelect: input.onToggleDetail,
  }
  if (!input.inDrilldown) return [minimap]
  return [layout, reference, completed, legend, minimap, detail]
}
