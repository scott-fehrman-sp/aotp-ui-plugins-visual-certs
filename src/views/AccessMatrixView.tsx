import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import { EmptyState } from '../components/EmptyState'
import { LoadingState } from '../components/LoadingState'
import { AccessGraphCanvas } from '../graph/AccessGraphCanvas'
import type { AccessDecisionRequest } from '../graph/accessDecision'
import type { CommentRequirement } from '../sailpoint/types'
import type { AccessMatrixState, UserDetailState } from '../state/useAccessMatrix'
import './AccessMatrixView.css'

interface AccessMatrixViewProps {
  campaignName: string
  /** The resolved matrix state (status/graph/userDetails/resolveUser) from useAccessMatrix. */
  matrix: AccessMatrixState
  /** Back to the campaign dashboard. */
  onBack: () => void
  /**
   * Back to the campaign list. Passed only when that list is a real stop
   * (more than one review). Shown ahead of the closer back links so the row
   * grows as the operator goes deeper: all reviews, then overview, then —
   * once a user is open — all users.
   */
  onBackToReviews?: () => void
  /** Campaign comment rule for the access-item decision dialogs. */
  commentRequirement?: CommentRequirement
  /** Identity search for reassigning selected access items. */
  searchApi?: SearchApi
  /** Saves an approve, revoke, or reassign from the access map. */
  onAccessDecision?: (request: AccessDecisionRequest) => Promise<void>
}

/**
 * The access expansion map screen: an interactive node/edge graph. The grid
 * (`matrix.graph`) shows every user plus each review item's directly-held
 * role / access profile / entitlement, at ZERO role / access-profile /
 * entitlement / source API cost (see `useAccessMatrix`'s doc). Drilling into a
 * user is "selecting them for processing": it calls `matrix.resolveUser`,
 * which is the only thing that calls those four APIs, and only for that one
 * user's items. The canvas shows that user's first-level items immediately
 * from `matrix.graph` while the full composition (nested lineage, sources)
 * resolves, then swaps it in from `matrix.userDetails` once ready. Handles its
 * own empty state and a non-fatal banner, scoped to the user currently
 * drilled into, for any of their rows that soft-degraded.
 */
export function AccessMatrixView({
  campaignName,
  matrix,
  onBack,
  onBackToReviews,
  commentRequirement,
  searchApi,
  onAccessDecision,
}: AccessMatrixViewProps) {
  // The element the canvas portals its drill-down "Back to all users" button
  // into. Held in state (via a callback ref) so the canvas re-renders once the
  // slot exists. `null` until mounted tells the canvas to wait rather than fall
  // back to drawing the button inside the graph.
  const [backSlot, setBackSlot] = useState<HTMLElement | null>(null)

  // The app-header slot the unresolved notice portals into so it sits inline
  // with the "Access Review" title (top-right) instead of taking room above the
  // graph. Resolved after mount; `null` falls back to no header notice.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  // The slot beside the application title. `undefined` until the lookup runs,
  // then the element or `null` when this view is rendered without the app shell.
  const [titleNav, setTitleNav] = useState<HTMLElement | null | undefined>(undefined)
  useEffect(() => {
    setHeaderSlot(document.getElementById('vc-header-slot'))
    setTitleNav(document.getElementById('vc-title-nav'))
  }, [])

  // The currently drilled-into user's lazy resolution, reported by the canvas
  // (which owns the selection state) so the non-fatal "unresolved" banner can
  // be scoped to THAT user rather than the whole campaign — there is no
  // campaign-wide resolution any more to have a count for. `null` outside a
  // drill-down, or before `resolveUser` has been called for the viewed user.
  const [activeUserDetail, setActiveUserDetail] = useState<UserDetailState | null>(null)

  // Leave the map, and (in a user's drill-down) go back to the all-users grid.
  // Portaled beside the application title so the row doesn't sit above the graph.
  // Higher-level stops come first, and each deeper screen adds the next link.
  const mapNav = (
    <nav className="vc-matrix-nav" aria-label="Access map navigation">
      {onBackToReviews && (
        <button type="button" className="vc-link-btn" onClick={onBackToReviews}>
          ← All Reviews
        </button>
      )}
      <button type="button" className="vc-link-btn" onClick={onBack}>
        ← Overview
      </button>
      <span ref={setBackSlot} className="vc-matrix-nav-slot" />
    </nav>
  )

  return (
    <section className="vc-matrix-view" aria-label={`Access map for ${campaignName}`}>
      {titleNav === undefined
        ? null
        : titleNav
          ? createPortal(mapNav, titleNav)
          : mapNav}

      {/* The visible "All access paths" sub-heading was removed to give the
          graph more vertical room. A visually hidden heading keeps the page
          outline for screen-reader users at zero space cost. */}
      <h2 className="vc-matrix-sr-heading">All access paths</h2>

      {matrix.status === 'idle' && (
        <LoadingState message="Building the access map…" />
      )}

      {matrix.status === 'ready' && matrix.graph.nodes.length === 0 && (
        <EmptyState
          title="No access to map"
          message="There's no reviewable access to expand into a map for this review."
        />
      )}

      {matrix.status === 'ready' && matrix.graph.nodes.length > 0 && (
        <>
          {activeUserDetail?.status === 'ready' &&
            activeUserDetail.unresolvedCount > 0 &&
            headerSlot &&
            createPortal(
              <div className="vc-banner vc-matrix-unresolved" role="status">
                <span>
                  {activeUserDetail.unresolvedCount}{' '}
                  {activeUserDetail.unresolvedCount === 1
                    ? 'access path couldn’t'
                    : 'access paths couldn’t'}{' '}
                  be fully resolved for this user and{' '}
                  {activeUserDetail.unresolvedCount === 1 ? 'is' : 'are'} marked
                  Unresolved.
                </span>
              </div>,
              headerSlot,
            )}

          <AccessGraphCanvas
            graph={matrix.graph}
            backSlot={backSlot}
            userDetails={matrix.userDetails}
            identities={matrix.identities}
            onUserSelected={matrix.resolveUser}
            onUserDetailChange={setActiveUserDetail}
            commentRequirement={commentRequirement}
            searchApi={searchApi}
            onAccessDecision={onAccessDecision}
          />
        </>
      )}
    </section>
  )
}
