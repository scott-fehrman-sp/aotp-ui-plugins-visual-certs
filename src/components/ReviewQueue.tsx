import type { PrioritizedItem } from '../domain/priority'
import type { DecisionChoice } from '../sailpoint/types'
import { ReviewItemCard } from './ReviewItemCard'
import { WhyThisOrder } from './WhyThisOrder'
import './ReviewQueue.css'

interface ReviewQueueProps {
  ordered: PrioritizedItem[]
  noRiskSignals: boolean
  /** Open a decision for a specific item. */
  onDecide: (itemId: string, choice: DecisionChoice) => void
}

/**
 * The prioritized, visual-first list of things to review. The first still-to-do
 * item is marked "Review this first" so the user always has a clear starting
 * point, and the "Why this order?" explainer builds trust in the ordering.
 */
export function ReviewQueue({ ordered, noRiskSignals, onDecide }: ReviewQueueProps) {
  // The first outstanding (not yet decided) item gets the "first" badge.
  const firstOutstandingId = ordered.find((o) => !o.item.completed)?.item.id

  return (
    <div className="vc-queue">
      <WhyThisOrder noRiskSignals={noRiskSignals} />
      <ul className="vc-queue-list">
        {ordered.map(({ item, priority }) => (
          <ReviewItemCard
            key={item.id}
            item={item}
            priority={priority}
            isFirst={item.id === firstOutstandingId}
            onDecide={(choice) => onDecide(item.id, choice)}
          />
        ))}
      </ul>
    </div>
  )
}
