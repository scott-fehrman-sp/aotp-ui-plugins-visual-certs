import { createContext, type Dispatch, type SetStateAction } from 'react'

/**
 * Channel from first-level cards to the canvas for hover / keyboard-focus
 * emphasis. The value is two stable state setters, so providing it never
 * re-renders consumers; only the canvas (which owns the state) restyles edges.
 * The default is a no-op so a card rendered outside a canvas still works.
 */
export interface EmphasisSetters {
  setHover: Dispatch<SetStateAction<string | null>>
  setFocus: Dispatch<SetStateAction<string | null>>
}

export const EmphasisContext = createContext<EmphasisSetters>({
  setHover: () => {},
  setFocus: () => {},
})
