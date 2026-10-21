import { createContext } from 'react'

/**
 * Channel from the canvas to the first-level cards for item SELECTION (the
 * highlight of one access item's associated edges). Cards read which item is
 * selected and which reference-only nodes lie in its lineage, and call `toggle`
 * to select or deselect. The default is inert so a card rendered outside a
 * canvas still works.
 */
export interface SelectionState {
  /** The selected first-level node id, or null when nothing is selected. */
  selectedId: string | null
  /** Reference-only node ids reachable downstream of the selected item. */
  lineageNodeIds: ReadonlySet<string>
  /** Selects `id`, or clears the selection when `id` is already selected. */
  toggle: (id: string) => void
}

export const SelectionContext = createContext<SelectionState>({
  selectedId: null,
  lineageNodeIds: new Set(),
  toggle: () => {},
})
