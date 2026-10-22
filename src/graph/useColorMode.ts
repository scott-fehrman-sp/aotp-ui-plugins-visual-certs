import { useEffect, useState } from 'react'

/**
 * Tracks the active theme so the React Flow canvas matches the rest of the
 * plugin. The theme is driven by the `data-theme` attribute that
 * `ThemeProvider` sets on <html> (which it seeds from the OS
 * `prefers-color-scheme` and the in-app toggle then overrides). We read that
 * attribute and watch it for changes. Falls back to `prefers-color-scheme`,
 * then to `'light'` when neither is available (e.g. jsdom), keeping the test
 * path deterministic.
 */
export function useColorMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(() => read())

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement

    const sync = () => setMode(read())
    sync()

    // The attribute is the source of truth; watch it so a toggle re-renders us.
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })

    // When no explicit theme is set yet, still follow the OS preference live.
    const query =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null
    query?.addEventListener('change', sync)

    return () => {
      observer.disconnect()
      query?.removeEventListener('change', sync)
    }
  }, [])

  return mode
}

function read(): 'light' | 'dark' {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.theme
    if (attr === 'light' || attr === 'dark') return attr
  }
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}
