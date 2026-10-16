import type { PrioritizedItem } from '../domain/priority'
import type { DecisionChoice, ProvenanceEntry } from '../sailpoint/types'
import { ReviewItemCard } from './ReviewItemCard'
import './ReviewQueue.css'

interface ReviewQueueProps {
  ordered: PrioritizedItem[]
  /** Open a decision for a specific item. */
  onDecide: (itemId: string, choice: DecisionChoice) => void
  /** Per-item provenance (from useProvenance), keyed by review item id. */
  provenanceByItemId: Record<string, ProvenanceEntry>
}

/**
 * The prioritized, visual-first list of things to review. The first still-to-do
 * item is marked "Review this first" so the user always has a clear starting
 * point. The "Why this order?" explainer is rendered by ReviewView, above the
 * scroll panel, so it stays visible while this list scrolls.
 */
export function ReviewQueue({
  ordered,
  onDecide,
  provenanceByItemId,
}: ReviewQueueProps) {
  // The first outstanding (not yet decided) item gets the "first" badge.
  const firstOutstandingId = ordered.find((o) => !o.item.completed)?.item.id

  return (
    <div className="vc-queue">
      <ul className="vc-queue-list">
        {ordered.map(({ item, priority }) => (
          <ReviewItemCard
            key={item.id}
            item={item}
            priority={priority}
            isFirst={item.id === firstOutstandingId}
            onDecide={(choice) => onDecide(item.id, choice)}
            provenance={provenanceByItemId[item.id]}
          />
        ))}
      </ul>
    </div>
  )
}
