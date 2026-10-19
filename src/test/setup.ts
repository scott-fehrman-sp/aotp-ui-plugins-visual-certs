// Vitest global setup. Adds jest-dom matchers (toBeInTheDocument, etc.) and a
// ResizeObserver stub that Recharts' ResponsiveContainer needs under jsdom.
import '@testing-library/jest-dom/vitest'

// jsdom does not implement ResizeObserver, which Recharts relies on to measure
// its container. Provide a no-op so charts render without throwing in tests.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// jsdom does not implement matchMedia, which the graph's colorMode hook calls
// (and React Flow touches internally). Return a non-matching, no-op query so
// the default 'light' color mode is deterministic in tests.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom does not implement DOMMatrixReadOnly, which React Flow's node-internals
// update touches when it mounts a node. A minimal identity-matrix stub lets the
// access graph canvas mount in tests (geometry is still asserted via the pure
// builders, never read back off the DOM).
if (!('DOMMatrixReadOnly' in globalThis)) {
  class DOMMatrixReadOnlyStub {
    m22 = 1
  }
  ;(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly =
    DOMMatrixReadOnlyStub
}
