import { createContext } from 'react'

/**
 * Channel from the canvas to the cards for item SELECTION (the highlight of
 * the selected nodes' associated edges). Cards read which nodes are selected
 * and which reference-only nodes lie on a highlighted path, and call `toggle`
 * to select or deselect. The default is inert so a card rendered outside a
 * canvas still works.
 */
export interface SelectionState {
  /** Selected node ids. Empty when nothing is selected. */
  selectedIds: ReadonlySet<string>
  /** Reference-only node ids on a highlighted path (not a selected node). */
  lineageNodeIds: ReadonlySet<string>
  /**
   * Selects `id`. A needs-review access item is added or removed and the
   * other needs-review items stay selected. Any other node replaces the
   * selection with just that node, or clears it when it was the only one.
   */
  toggle: (id: string) => void
}

/** Stable empty selection, so "nothing selected" keeps a stable context value. */
export const EMPTY_SELECTION: ReadonlySet<string> = new Set()

export const SelectionContext = createContext<SelectionState>({
  selectedIds: EMPTY_SELECTION,
  lineageNodeIds: new Set(),
  toggle: () => {},
})
