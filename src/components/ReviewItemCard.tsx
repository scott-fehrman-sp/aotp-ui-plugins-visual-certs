import { ACCESS_KIND_HELP, ACCESS_KIND_LABEL } from '../domain/language'
import type { ItemPriority } from '../domain/priority'
import type { DecisionChoice, ReviewItemVM } from '../sailpoint/types'
import './ReviewItemCard.css'

interface ReviewItemCardProps {
  item: ReviewItemVM
  priority: ItemPriority
  /** True for the top outstanding item, which gets a "Review this first" badge. */
  isFirst: boolean
  /** Open the decision dialog for a choice (allow/remove). */
  onDecide: (choice: DecisionChoice) => void
}

/**
 * A single review item as a visual card: who, what access (in plain language),
 * why it's prioritized (reason chips), and the two decisions. Already-decided
 * items show their outcome and offer to change it.
 */
export function ReviewItemCard({
  item,
  priority,
  isFirst,
  onDecide,
}: ReviewItemCardProps) {
  const kindLabel = ACCESS_KIND_LABEL[item.accessKind]
  const kindHelp = ACCESS_KIND_HELP[item.accessKind]
  // An item is "resolved" either by a keep/remove decision OR by being
  // reassigned to someone else — all three leave the outstanding queue.
  const reassigned = item.completed && item.reassigned
  const decided = item.completed && (item.decision != null || reassigned)

  return (
    <li
      className="vc-item"
      data-priority={priority.level}
      data-decided={
        decided ? (reassigned ? 'reassign' : item.decision) : undefined
      }
    >
      {isFirst && !decided && (
        <div className="vc-item-first">Review this first</div>
      )}

      <div className="vc-item-body">
        <div className="vc-item-text">
          <p className="vc-item-person">{item.personName}</p>
          <p className="vc-item-access">
            has {kindLabel}: <strong>{item.accessName}</strong>
            {item.sourceName && (
              <span className="vc-item-source"> in {item.sourceName}</span>
            )}
          </p>
          <p className="vc-item-kind-help" title={kindHelp}>
            {kindHelp}
          </p>
          {item.accessDescription && (
            <p className="vc-item-desc">{item.accessDescription}</p>
          )}

          {priority.reasons.length > 0 && (
            <ul className="vc-chips" aria-label="Why this is prioritized">
              {priority.reasons.map((r) => (
                <li key={r.key} className="vc-chip" title={r.explanation}>
                  {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="vc-item-actions">
          {decided ? (
            <div className="vc-item-decided">
              <span
                className={
                  reassigned
                    ? 'vc-decided-badge vc-decided-reassign'
                    : item.decision === 'APPROVE'
                      ? 'vc-decided-badge vc-decided-allow'
                      : 'vc-decided-badge vc-decided-deny'
                }
              >
                {reassigned
                  ? 'Reassigned'
                  : item.decision === 'APPROVE'
                    ? 'Kept'
                    : 'Removed'}
              </span>
              {item.comments && (
                <span className="vc-item-comment">“{item.comments}”</span>
              )}
              <button
                type="button"
                className="vc-link-btn"
                onClick={() =>
                  onDecide(
                    reassigned
                      ? 'reassign'
                      : item.decision === 'APPROVE'
                        ? 'remove'
                        : 'allow',
                  )
                }
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="vc-btn vc-btn-allow"
                onClick={() => onDecide('allow')}
              >
                Keep
              </button>
              <button
                type="button"
                className="vc-btn vc-btn-deny"
                onClick={() => onDecide('remove')}
                disabled={!item.revocable}
                title={
                  item.revocable
                    ? undefined
                    : "This access can't be removed from here."
                }
              >
                Remove
              </button>
              <button
                type="button"
                className="vc-btn vc-btn-reassign"
                onClick={() => onDecide('reassign')}
              >
                Reassign
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
