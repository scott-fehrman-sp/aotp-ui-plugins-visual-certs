import { createContext } from 'react'

/**
 * Channel from the canvas to the cards for item SELECTION (the highlight of
 * one node's associated edges). Cards read which node is selected and which
 * reference-only nodes lie on its highlighted path, and call `toggle` to
 * select or deselect. The default is inert so a card rendered outside a
 * canvas still works.
 */
export interface SelectionState {
  /** The selected node id, or null when nothing is selected. */
  selectedId: string | null
  /** Reference-only node ids on the highlighted path (not the selected node). */
  lineageNodeIds: ReadonlySet<string>
  /** Selects `id`, or clears the selection when `id` is already selected. */
  toggle: (id: string) => void
}

export const SelectionContext = createContext<SelectionState>({
  selectedId: null,
  lineageNodeIds: new Set(),
  toggle: () => {},
})
