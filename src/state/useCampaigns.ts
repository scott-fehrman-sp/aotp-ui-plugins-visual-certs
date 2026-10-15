/**
 * Loads the certifications the signed-in user must review. Exposes a simple
 * loading / error / data state plus a `reload` so views can retry after a
 * failure or refresh after changes.
 */
import { useCallback, useEffect, useState } from 'react'
import { FriendlyError, listMyCampaigns } from '../sailpoint/certifications'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import type { CampaignVM } from '../sailpoint/types'

interface State {
  loading: boolean
  campaigns: CampaignVM[] | null
  error: string | null
}

export interface CampaignsState extends State {
  reload: () => void
}

const INITIAL: State = { loading: true, campaigns: null, error: null }

export function useCampaigns(api: CertificationsApi): CampaignsState {
  const [state, setState] = useState<State>(INITIAL)
  // Bumped to force a reload.
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    // All state transitions happen inside this async flow (never synchronously
    // in the effect body), which keeps renders predictable.
    const run = async () => {
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        const campaigns = await listMyCampaigns(api)
        if (!cancelled) setState({ loading: false, campaigns, error: null })
      } catch (err) {
        if (cancelled) return
        setState({
          loading: false,
          campaigns: null,
          error:
            err instanceof FriendlyError
              ? err.message
              : 'Something went wrong loading your reviews.',
        })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [api, nonce])

  return { ...state, reload }
}
