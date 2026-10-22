import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext, type ThemeMode } from './theme-context'

export type { ThemeMode }

/**
 * localStorage key for the user's explicit theme choice. Namespaced to the
 * plugin so it never collides with the host App Shell or sibling plugins.
 */
const STORAGE_KEY = 'visual-certs-theme'

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Initial theme: an explicit stored choice wins; otherwise fall back to the
 * OS `prefers-color-scheme`. Storage can be blocked inside a hardened iframe,
 * so reads are defensive.
 */
function readTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage unavailable (hardened iframe); fall through to OS preference.
  }
  return prefersDark() ? 'dark' : 'light'
}

/**
 * Owns the theme choice for the whole plugin. Adapted from the sibling
 * `org-graph` plugin's `ThemeProvider`:
 *  - defaults to the OS `prefers-color-scheme`;
 *  - lets the user override via {@link useTheme}'s `toggle`, persisted to
 *    localStorage;
 *  - drives styling by setting `data-theme` on `<html>`, which the `--vc-*`
 *    app tokens and the graph tokens both key off of.
 *
 * While the user has made no explicit choice, the provider keeps following the
 * OS preference live (e.g. the system flips to dark at sunset).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(readTheme)
  // Whether the active theme came from an explicit user toggle (vs. the OS).
  const [explicit, setExplicit] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored === 'light' || stored === 'dark'
    } catch {
      return false
    }
  })

  // Reflect the theme onto the document so CSS tokens and React Flow pick it up.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  // Follow the OS preference live until the user makes an explicit choice.
  useEffect(() => {
    if (explicit) return
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setTheme(query.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [explicit])

  const value = useMemo(
    () => ({
      theme,
      toggle: () =>
        setTheme((current) => {
          const next = current === 'dark' ? 'light' : 'dark'
          setExplicit(true)
          try {
            localStorage.setItem(STORAGE_KEY, next)
          } catch {
            // Ignore persistence failures; keep the in-memory choice.
          }
          return next
        }),
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
