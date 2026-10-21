import { getNodesBounds, Panel, useStore } from '@xyflow/react'
import { isGraphOutOfView } from './fitPadding'

/**
 * Muted "scroll or drag" pill for long drill-down graphs, top-center. Shown
 * only while the graph opened at the readable zoom (`active`) AND part of it is
 * out of view, so it disappears once the Controls fit-view button shows
 * everything. It is a polite status message, never intercepts the pointer
 * (wheel and drag pass through) and is ignored by the overlay-aware fit
 * (`vc-graph-fit-ignore`): it sits inside the band the back button reserves.
 */
export function ScrollHint({ itemCount, active }: { itemCount: number; active: boolean }) {
  // Boolean selector: re-renders only when the answer flips, not per pan frame.
  const outOfView = useStore((s) =>
    isGraphOutOfView(getNodesBounds(s.nodes), s.transform, {
      width: s.width,
      height: s.height,
    }),
  )
  if (!active || !outOfView) return null
  return (
    <Panel position="top-center" className="vc-graph-hint-panel vc-graph-fit-ignore">
      <p className="vc-graph-hint" role="status">
        {itemCount} {itemCount === 1 ? 'item' : 'items'} — scroll or drag to see all
      </p>
    </Panel>
  )
}
