import { useId, useState } from 'react'
import './WhyThisOrder.css'

interface WhyThisOrderProps {
  /** When true, the campaign had no risk data and the order is alphabetical. */
  noRiskSignals: boolean
}

/** The factors we use to order the list, in plain language. */
const FACTORS = [
  {
    label: 'Flagged by SailPoint AI',
    text: "SailPoint's built-in AI suggested the access may no longer be appropriate.",
  },
  {
    label: 'Reaches sensitive data',
    text: 'The access can get to information marked as sensitive or high-impact.',
  },
  {
    label: 'Elevated / admin access',
    text: 'Powerful "admin" access that can make broad changes.',
  },
  {
    label: 'New since last review',
    text: 'Access granted since the last review, so no one has confirmed it yet.',
  },
  {
    label: 'Rarely used',
    text: 'No recorded sign the access has been used.',
  },
  {
    label: 'Cloud-governed',
    text: 'The access touches cloud resources governed centrally.',
  },
]

/**
 * A disclosure that explains why the list is ordered the way it is, so the user
 * trusts the ordering. Collapsed by default to keep the queue focused.
 */
export function WhyThisOrder({ noRiskSignals }: WhyThisOrderProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div className="vc-why">
      <button
        type="button"
        className="vc-why-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Why this order?
      </button>
      {open && (
        <div id={panelId} className="vc-why-panel">
          {noRiskSignals ? (
            <p>
              This review didn't include extra risk information, so we've simply
              listed everything in alphabetical order by person. Start at the top
              and work your way down.
            </p>
          ) : (
            <>
              <p>
                We put the items most worth your attention first. An item moves up
                the list when any of these are true:
              </p>
              <ul className="vc-why-list">
                {FACTORS.map((f) => (
                  <li key={f.label}>
                    <strong>{f.label}:</strong> {f.text}
                  </li>
                ))}
              </ul>
              <p className="vc-why-note">
                Anything already decided moves to the bottom so you always see
                outstanding work first.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
