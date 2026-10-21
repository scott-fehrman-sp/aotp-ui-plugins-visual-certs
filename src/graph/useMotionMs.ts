import { useEffect, useState, type RefObject } from 'react'
import { readMotionMs } from './graphTransition'

/**
 * The graph's motion duration in ms, read from the `--motion-ms` token. It is 0
 * under `prefers-reduced-motion` (tokens.css) and whenever no stylesheet is
 * loaded (jsdom), which turns every transition off.
 *
 * The wrapper does not exist on the first render, so the first value comes from
 * the root element (the token lives on `:root`, the wrapper inherits it); it is
 * re-read from the wrapper after mount and whenever the reduced-motion
 * preference changes. `override` is a test seam that wins over the CSS value.
 */
export function useMotionMs(
  override: number | undefined,
  wrapRef: RefObject<HTMLElement | null>,
): number {
  const [measured, setMeasured] = useState(() =>
    readMotionMs(typeof document === 'undefined' ? null : document.documentElement),
  )

  useEffect(() => {
    if (override !== undefined) return
    const reread = () => setMeasured(readMotionMs(wrapRef.current ?? document.documentElement))
    reread()
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    query.addEventListener('change', reread)
    return () => query.removeEventListener('change', reread)
  }, [override, wrapRef])

  return override ?? measured
}
