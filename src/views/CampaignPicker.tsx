import { daysUntil } from '../domain/metrics'
import { deadlineText } from '../domain/language'
import type { CampaignVM } from '../sailpoint/types'
import './CampaignPicker.css'

interface CampaignPickerProps {
  campaigns: CampaignVM[]
  /** Called with the chosen campaign id. */
  onSelect: (campaignId: string) => void
  now?: Date
}

/**
 * Shown when the user has more than one review to do. Lists each as a card with
 * plain-language progress and deadline, most urgent first, so the user can pick
 * where to start. (With a single campaign the app skips this and goes straight
 * to the dashboard.)
 */
export function CampaignPicker({ campaigns, onSelect, now }: CampaignPickerProps) {
  return (
    <section className="vc-picker" aria-label="Choose a review to work on">
      <h2 className="vc-picker-title">You have {campaigns.length} reviews to do</h2>
      <p className="vc-picker-sub">Pick one to get started. We've put the ones due soonest first.</p>
      <ul className="vc-picker-list">
        {campaigns.map((c) => {
          const total = c.decisionsTotal
          const done = c.decisionsMade
          const percent = total > 0 ? Math.round((done / total) * 100) : 0
          const days = daysUntil(c.due, now)
          const overdue = days !== null && days < 0
          // Progress tier drives the card's accent color (see CSS). Tiers:
          // none (0%), started (1–49%), underway (50–99%), complete (100%).
          const progressTier =
            percent >= 100
              ? 'complete'
              : percent >= 50
                ? 'underway'
                : percent > 0
                  ? 'started'
                  : 'none'
          return (
            <li key={c.id}>
              <button
                type="button"
                className="vc-picker-card"
                data-progress={progressTier}
                onClick={() => onSelect(c.id)}
              >
                <div className="vc-picker-card-main">
                  <span className="vc-picker-name">{c.name}</span>
                  {c.description && (
                    <span className="vc-picker-desc">{c.description}</span>
                  )}
                </div>
                <div className="vc-picker-meta">
                  <span className="vc-picker-progress">{percent}% done</span>
                  <span
                    className="vc-picker-deadline"
                    data-overdue={overdue}
                  >
                    {deadlineText(days)}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
