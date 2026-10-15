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
