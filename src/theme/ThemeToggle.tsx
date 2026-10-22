import './ThemeToggle.css'
import { useTheme } from './theme-context'

/**
 * Header control that flips the plugin between light and dark. Shows a moon in
 * light mode (tap to go dark) and a sun in dark mode (tap to go light), with an
 * `aria-pressed` state so assistive tech announces the current theme.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      type="button"
      className="vc-theme-toggle"
      onClick={toggle}
      aria-label={label}
      aria-pressed={dark}
      title={label}
    >
      <ThemeIcon dark={dark} />
    </button>
  )
}

function ThemeIcon({ dark }: { dark: boolean }) {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      {dark ? (
        // Sun: tap to return to light.
        <>
          <circle cx="12" cy="12" r="4" {...stroke} />
          <path
            d="M12 3v1.8M12 19.2V21M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M3 12h1.8M19.2 12H21M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3"
            {...stroke}
          />
        </>
      ) : (
        // Moon: tap to go dark.
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 1 0 10.5 10.5Z" {...stroke} />
      )}
    </svg>
  )
}
