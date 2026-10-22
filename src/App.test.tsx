import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { PluginRuntime } from './sailpoint/sdkClient'
import { ThemeProvider } from './theme/ThemeProvider'

// The app header now hosts a theme toggle, which reads context from
// ThemeProvider. Production wires that provider in main.tsx; the test renders
// App on its own, so we supply the provider here.
function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  )
}

// Mock the SDK bootstrap so the app's init flow is deterministic in tests
// (no real iframe handshake happens under jsdom).
const initPlugin = vi.hoisted(() => vi.fn())
vi.mock('./sailpoint/sdkClient', () => ({ initPlugin }))

// Mock the connected app so App's only responsibility — the init boundary —
// is tested in isolation. CertApp has its own test.
vi.mock('./CertApp', () => ({
  CertApp: ({ runtime }: { runtime: PluginRuntime }) => (
    <div>Connected app for {runtime.user.displayName}</div>
  ),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('App init boundary', () => {
  it('renders the plugin title', () => {
    initPlugin.mockReturnValue(new Promise(() => {})) // stay loading
    renderApp()
    expect(
      screen.getByRole('heading', { name: /access review/i }),
    ).toBeInTheDocument()
  })

  it('renders the connected app once init succeeds', async () => {
    initPlugin.mockResolvedValue({
      user: { id: 'u1', displayName: 'Dana Reviewer', email: '', isCertAdmin: false },
    } as unknown as PluginRuntime)

    renderApp()

    expect(await screen.findByText(/connected app for dana reviewer/i)).toBeInTheDocument()
  })

  it('shows a friendly error when the connection fails', async () => {
    initPlugin.mockRejectedValue(new Error('handshake failed'))

    renderApp()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't connect/i)
    })
    expect(screen.queryByText(/handshake failed/i)).not.toBeInTheDocument()
  })
})
