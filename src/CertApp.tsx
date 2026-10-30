import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { EmptyState } from './components/EmptyState'
import { ErrorState } from './components/ErrorState'
import { LoadingState } from './components/LoadingState'
import { DecisionDialog } from './components/DecisionDialog'
import { computeMetrics } from './domain/metrics'
import type { PluginRuntime } from './sailpoint/sdkClient'
import type { DecisionChoice } from './sailpoint/types'
import { useCampaign } from './state/useCampaign'
import { useCampaigns } from './state/useCampaigns'
import { useDecisions } from './state/useDecisions'
import { useAccessMatrix } from './state/useAccessMatrix'
import { useProvenance } from './state/useProvenance'
import { useReviewItems } from './state/useReviewItems'
import { AccessMatrixView } from './views/AccessMatrixView'
import { CampaignDashboard } from './views/CampaignDashboard'
import { CampaignPicker } from './views/CampaignPicker'
import { ReviewView } from './views/ReviewView'
import { SignOffView } from './views/SignOffView'

interface CertAppProps {
  runtime: PluginRuntime
}

/** The internal views the plugin can show for a connected user. */
type Route =
  | { view: 'picker' }
  | { view: 'dashboard'; campaignId: string }

/**
 * The connected application: once we have an authenticated runtime, this loads
 * the user's campaigns and routes between the picker and the per-campaign
 * dashboard. It reports its internal route to the ISC App Shell so reloads and
 * shared links land on the right view.
 */
export function CertApp({ runtime }: CertAppProps) {
  const { certificationsApi, sdk } = runtime
  const { loading, campaigns, error, reload } = useCampaigns(certificationsApi)

  // Restore the campaign from the host-provided subPath on first mount, e.g.
  // `campaign/<id>`. Falls back to no explicit selection.
  const deepLinkedId = useMemo<string | null>(() => {
    const sub = runtime.context.page.subPath ?? ''
    const match = /^campaign\/([^/]+)/.exec(sub)
    return match ? decodeURIComponent(match[1]) : null
  }, [runtime.context.page.subPath])

  // The campaign the user has explicitly chosen. `null` means "no explicit
  // choice yet". We DERIVE the actual view below rather than mutating state in
  // an effect: that keeps the single-campaign auto-advance a pure computation.
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkedId)

  // Effective route, computed from the user's choice and the loaded campaigns:
  //  - an explicit/deep-linked selection wins;
  //  - otherwise, a lone campaign auto-advances to its dashboard;
  //  - otherwise, show the picker.
  const route = useMemo<Route>(() => {
    if (selectedId) return { view: 'dashboard', campaignId: selectedId }
    if (campaigns && campaigns.length === 1) {
      return { view: 'dashboard', campaignId: campaigns[0].id }
    }
    return { view: 'picker' }
  }, [selectedId, campaigns])

  // Report the current route to the App Shell so the host URL reflects it.
  useEffect(() => {
    const subPath = route.view === 'dashboard' ? `campaign/${route.campaignId}` : ''
    // setRoute silently ignores invalid paths; we don't need its result.
    void sdk.navigation.setRoute(subPath)
  }, [route, sdk])

  const goToDashboard = useCallback(
    (campaignId: string) => setSelectedId(campaignId),
    [],
  )
  const goToPicker = useCallback(() => {
    // Re-fetch the campaign list so the picker cards reflect progress made on
    // the dashboard/review views, instead of the counts captured at first load.
    setSelectedId(null)
    reload()
  }, [reload])

  // Only show the full-screen loader on the FIRST load (no campaigns yet). A
  // background reload (e.g. returning to the picker) keeps the existing cards
  // on screen and updates them in place when the fetch resolves, so navigating
  // back doesn't blank the UI.
  if (loading && !campaigns) {
    return <LoadingState message="Loading your reviews…" />
  }

  if (error && !campaigns) {
    return (
      <ErrorState
        title="We couldn't load your reviews"
        message={error}
        onRetry={reload}
      />
    )
  }

  if (!campaigns || campaigns.length === 0) {
    return (
      <EmptyState
        title="You're all caught up"
        message="You don't have any access reviews to complete right now. When one is assigned to you, it'll show up here."
      />
    )
  }

  if (route.view === 'dashboard') {
    return (
      <CampaignRoute
        runtime={runtime}
        campaignId={route.campaignId}
        showBack={campaigns.length > 1}
        onBack={goToPicker}
      />
    )
  }

  return <CampaignPicker campaigns={campaigns} onSelect={goToDashboard} />
}

/**
 * A back link that belongs beside the application title. When the app shell's
 * title slot is present the link is portaled into it (the same place the
 * access map and the review graph put their back links). Before that lookup
 * finishes nothing is rendered, so the link never flashes under the title.
 * Without the shell it stays in the page flow.
 */
export function TitleBackLink({
  slot,
  onClick,
  children,
}: {
  slot: HTMLElement | null | undefined
  onClick: () => void
  children: string
}) {
  const button = (
    <button type="button" className="vc-link-btn" onClick={onClick}>
      {children}
    </button>
  )
  if (slot === undefined) return null
  if (slot) return createPortal(button, slot)
  return button
}

interface CampaignRouteProps {
  runtime: PluginRuntime
  campaignId: string
  showBack: boolean
  onBack: () => void
}

/** Steps within a single campaign. */
type CampaignStep = 'dashboard' | 'review' | 'signoff' | 'matrix'

/**
 * Loads one campaign's live state plus its review items, and switches between
 * the dashboard overview and the prioritized review queue. The dashboard charts
 * read from the same live items, so progress reflects decisions as they happen.
 *
 * NOTE: in this step decisions are recorded directly (optimistic local update +
 * API call). Task 8 inserts a plain-language confirmation dialog with a comment
 * combo box in front of this handler.
 */
function CampaignRoute({
  runtime,
  campaignId,
  showBack,
  onBack,
}: CampaignRouteProps) {
  const {
    certificationsApi,
    searchApi,
    accessRequestsApi,
    identityHistoryApi,
    accessCompositionResolver,
  } = runtime
  const campaignState = useCampaign(certificationsApi, campaignId)
  const review = useReviewItems(certificationsApi, campaignId)
  // Provenance resolves lazily, after the item list is in hand, and never gates
  // the queue or re-fetches on keep/remove/reassign (see useProvenance).
  const provenance = useProvenance(
    accessRequestsApi,
    identityHistoryApi,
    campaignId,
    review.items,
  )
  // The access matrix piggybacks on the already-loaded review items, so it
  // never triggers a second item fetch. Its overview `graph` costs zero role /
  // access-profile / entitlement / source API calls (see useAccessMatrix's
  // doc); those are only ever called, per user, through `matrix.resolveUser`.
  // `accessCompositionResolver` is the single, session-long resolver on
  // `PluginRuntime`, so its per-id caches persist across every campaign.
  const matrix = useAccessMatrix(accessCompositionResolver, campaignId, review.items)
  const [step, setStep] = useState<CampaignStep>('dashboard')
  // The slot beside the application title. `undefined` until the lookup runs,
  // then the element or `null` when this view is rendered without the app shell.
  const [titleNav, setTitleNav] = useState<HTMLElement | null | undefined>(undefined)
  useEffect(() => {
    // The slot is owned by the app shell, outside this view, so it can only be
    // read after mount — the same lookup the access map uses for its back links.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitleNav(document.getElementById('vc-title-nav'))
  }, [])

  const decisions = useDecisions({
    api: certificationsApi,
    campaignId,
    review,
    onCampaignUpdated: campaignState.applyLocal,
  })

  // The queue hands back an item id + choice; open the confirmation dialog for
  // the matching item so the user confirms (and comments) before anything saves.
  const handleDecide = useCallback(
    (itemId: string, choice: DecisionChoice) => {
      const item = review.items?.find((i) => i.id === itemId)
      if (item) decisions.open(item, choice)
    },
    [review.items, decisions],
  )

  if (campaignState.loading) {
    return <LoadingState message="Loading this review…" />
  }
  if (campaignState.error) {
    return (
      <ErrorState
        title="We couldn't load this review"
        message={campaignState.error}
        onRetry={campaignState.refresh}
      />
    )
  }
  if (!campaignState.campaign) return null

  const campaign = campaignState.campaign

  // Decision tallies drive the sign-off summary and gate. Derived from the live
  // items so they stay in sync with optimistic decisions.
  const metrics = computeMetrics(campaign, review.items)
  const {
    remaining: outstanding,
    total: totalItems,
    approved,
    revoked,
    reassigned,
  } = metrics

  return (
    <div className="vc-route">
      {/* A decision that failed to save surfaces here without losing context. */}
      {decisions.error && (
        <div className="vc-banner vc-banner-error" role="alert">
          <span>{decisions.error}</span>
          <button
            type="button"
            className="vc-banner-dismiss"
            onClick={decisions.clearError}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {step === 'matrix' ? (
        <AccessMatrixView
          campaignName={campaign.name}
          matrix={matrix}
          onBack={() => setStep('dashboard')}
          onBackToReviews={showBack ? onBack : undefined}
          commentRequirement={campaign.commentRequirement}
          searchApi={searchApi}
          onAccessDecision={decisions.confirmAccess}
        />
      ) : step === 'signoff' ? (
        <SignOffView
          api={certificationsApi}
          campaign={campaign}
          outstanding={outstanding}
          totalItems={totalItems}
          approved={approved}
          revoked={revoked}
          reassigned={reassigned}
          onBack={() => setStep('review')}
          onSignedOff={(updated) => {
            campaignState.applyLocal(updated)
            // Stay on the sign-off view, which now shows the "complete" state.
          }}
        />
      ) : step === 'review' ? (
        <ReviewView
          campaignName={campaign.name}
          review={review}
          provenanceByItemId={provenance.byItemId}
          onBack={() => setStep('dashboard')}
          onDecide={handleDecide}
          onSignOff={() => setStep('signoff')}
        />
      ) : (
        <>
          {showBack && (
            <TitleBackLink slot={titleNav} onClick={onBack}>
              ← All Reviews
            </TitleBackLink>
          )}
          <CampaignDashboard
            campaign={campaign}
            items={review.items}
            onStartReviewing={() => setStep('review')}
            onViewMatrix={() => setStep('matrix')}
          />
        </>
      )}

      {decisions.pending && (
        <DecisionDialog
          item={decisions.pending.item}
          choice={decisions.pending.choice}
          commentRequirement={campaign.commentRequirement}
          submitting={decisions.submitting}
          onConfirm={decisions.confirm}
          onCancel={decisions.cancel}
          searchApi={searchApi}
          onConfirmReassign={decisions.confirmReassign}
        />
      )}
    </div>
  )
}
