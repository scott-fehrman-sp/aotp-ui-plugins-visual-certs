import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { ErrorState } from './ErrorState'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Catches any unexpected rendering error anywhere in the app and shows a
 * friendly recovery screen instead of a blank page. This is the last line of
 * defense; expected failures (API errors, empty data) are handled closer to
 * where they happen with their own states.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log for developers via the console only. We never render raw error text
    // to the user, and avoid logging anything that could carry sensitive data.
    console.error('Visual Certifications plugin crashed:', error.message, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="Something went wrong"
          message="The page ran into an unexpected problem. Refreshing usually fixes it."
          onRetry={() => window.location.reload()}
        />
      )
    }
    return this.props.children
  }
}
