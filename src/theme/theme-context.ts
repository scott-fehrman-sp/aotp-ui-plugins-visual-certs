import { createContext, useContext } from 'react'

/** Light or dark — the two themes the plugin ships. */
export type ThemeMode = 'light' | 'dark'

export interface ThemeState {
  /** The active theme. */
  theme: ThemeMode
  /** Flip between light and dark. */
  toggle: () => void
}

export const ThemeContext = createContext<ThemeState | null>(null)

/**
 * Read the current theme and a toggle. Must be used inside `ThemeProvider`.
 * Mirrors the sibling `org-graph` plugin's theme hook so the two read alike.
 */
export function useTheme(): ThemeState {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
