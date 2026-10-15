/**
 * Loads and holds a single campaign's live state (progress counts, phase).
 * `refresh` re-fetches so the dashboard's charts/metrics update after
 * decisions are recorded, and `applyLocal` lets a decision update the cached
 * campaign immediately without waiting for a round trip.
 */
import { useCallback, useEffect, useState } from 'react'
import { FriendlyError, getCampaign } from '../sailpoint/certifications'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import type { CampaignVM } from '../sailpoint/types'

interface State {
  loading: boolean
  campaign: CampaignVM | null
  error: string | null
}

export interface CampaignState extends State {
  /** Re-fetch the campaign from the API. */
  refresh: () => Promise<void>
  /** Replace the cached campaign (e.g. with the response from a decision). */
  applyLocal: (campaign: CampaignVM) => void
}

export function useCampaign(
  api: CertificationsApi,
  campaignId: string | null,
): CampaignState {
  const [state, setState] = useState<State>({
    loading: campaignId !== null,
    campaign: null,
    error: null,
  })

  const load = useCallback(async () => {
    if (!campaignId) return
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const campaign = await getCampaign(api, campaignId)
      setState({ loading: false, campaign, error: null })
    } catch (err) {
      setState({
        loading: false,
        campaign: null,
        error:
          err instanceof FriendlyError
            ? err.message
            : 'Something went wrong loading this review.',
      })
    }
  }, [api, campaignId])

  useEffect(() => {
    // Fetch-on-mount: `load` flips to a loading state then resolves with data
    // or a friendly error. The transition is intentional and guarded, so the
    // set-state-in-effect rule does not apply to this standard data-load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const applyLocal = useCallback(
    (campaign: CampaignVM) => setState((s) => ({ ...s, campaign })),
    [],
  )

  return { ...state, refresh: load, applyLocal }
}
