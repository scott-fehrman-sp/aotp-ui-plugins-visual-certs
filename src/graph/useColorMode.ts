import { useEffect, useState } from 'react'

/**
 * Tracks the OS `prefers-color-scheme` so the React Flow canvas can match the
 * rest of the plugin (which themes purely via `@media (prefers-color-scheme)`;
 * there is no theme switch to read). Defaults to `'light'` when `matchMedia` is
 * unavailable (e.g. jsdom), keeping the test path deterministic.
 */
export function useColorMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(() => read())

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setMode(query.matches ? 'dark' : 'light')
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return mode
}

function read(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}
