import { useEffect, useState } from 'react'
import './App.css'
import { CertApp } from './CertApp'
import { ErrorState } from './components/ErrorState'
import { LoadingState } from './components/LoadingState'
import { initPlugin } from './sailpoint/sdkClient'
import type { PluginRuntime } from './sailpoint/sdkClient'
import { ThemeToggle } from './theme/ThemeToggle'

type InitState =
  | { status: 'loading' }
  | { status: 'ready'; runtime: PluginRuntime }
  | { status: 'error' }

/**
 * Root of the Visual Certifications plugin.
 *
 * Task 2 establishes the connection to ISC on mount and shows loading, a
 * connected confirmation, or a friendly error. Later tasks replace the "ready"
 * body with the campaign picker, dashboard, review queue, and sign-off.
 */
function App() {
  const [state, setState] = useState<InitState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const runtime = await initPlugin()
        if (!cancelled) setState({ status: 'ready', runtime })
      } catch {
        // We deliberately do not surface the raw error: it may carry sensitive
        // or confusing technical detail. The user gets a plain-language state.
        if (!cancelled) setState({ status: 'error' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="vc-app">
      <header className="vc-header">
        <h1 className="vc-title">Access Review</h1>
        <div className="vc-header-actions">
          {/* Right-aligned slot in the app header. Views deeper in the tree (e.g.
              the access map's unresolved-paths notice) portal content here so it
              sits inline with the title instead of stealing canvas space. */}
          <div id="vc-header-slot" className="vc-header-slot" />
          <ThemeToggle />
        </div>
      </header>
      <main className="vc-main">
        {state.status === 'loading' && (
          <LoadingState message="Connecting to your SailPoint tenant…" />
        )}
        {state.status === 'error' && (
          <ErrorState
            title="We couldn't connect"
            message="We weren't able to reach SailPoint just now. Please refresh the page to try again."
            onRetry={() => window.location.reload()}
          />
        )}
        {state.status === 'ready' && <CertApp runtime={state.runtime} />}
      </main>
    </div>
  )
}

export default App
