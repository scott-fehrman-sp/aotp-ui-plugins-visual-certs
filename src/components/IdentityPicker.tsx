import { useEffect, useId, useRef, useState } from 'react'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import { FriendlyError, searchIdentities } from '../sailpoint/identities'
import type { IdentityOption } from '../sailpoint/types'
import './IdentityPicker.css'

interface IdentityPickerProps {
  /** The Search API used to look identities up by name/email. */
  searchApi: SearchApi
  /** The currently selected person, or null when none is chosen. */
  value: IdentityOption | null
  /** Fired when the selection changes (an option is picked or cleared). */
  onChange: (value: IdentityOption | null) => void
  /** Disable interaction (e.g. while the parent dialog is submitting). */
  disabled?: boolean
  /** Id for the search field, so a visible label can point at it. */
  inputId?: string
}

/** How long to wait after the last keystroke before searching. */
const DEBOUNCE_MS = 275

/**
 * A reusable, keyboard-operable searchable picker for choosing a person to
 * reassign a review item to. It wraps the ISC identity search behind an
 * accessible combobox/listbox so the reviewer can find someone by typing part
 * of their name or email.
 *
 * Accessibility: the text input is a `combobox` that controls a `listbox` of
 * `option`s; ArrowUp/ArrowDown move the active option (tracked with
 * aria-activedescendant), Enter selects it, and Escape closes the list. The
 * query is debounced (~275ms) and never fires for fewer than two characters so
 * a single keystroke doesn't hit the API — matching searchIdentities' own guard.
 */
export function IdentityPicker({
  searchApi,
  value,
  onChange,
  disabled = false,
  inputId,
}: IdentityPickerProps) {
  const listId = useId()
  const optionIdPrefix = useId()

  // What the user has typed, and its debounced counterpart that drives search.
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  const [results, setResults] = useState<IdentityOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  // Index of the keyboard-highlighted option, or -1 when nothing is active.
  const [activeIndex, setActiveIndex] = useState(-1)

  const rootRef = useRef<HTMLDivElement>(null)

  // Debounce the raw query so we only search when typing pauses.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  // Whether the debounced query is long enough to search. searchIdentities also
  // guards this, but tracking it here lets us show "Searching…" only for a real
  // query and keep the effect's state updates off the synchronous render path.
  const term = debounced.trim()
  const canSearch = term.replace(/\s/g, '').length >= 2

  // Run the search when the debounced query settles. All state updates happen
  // asynchronously (inside the promise handlers or a microtask) so this effect
  // never sets state synchronously during render.
  useEffect(() => {
    let cancelled = false
    // Defer all state updates to a microtask so this effect never sets state
    // synchronously during render (which would cascade re-renders).
    queueMicrotask(() => {
      if (cancelled) return
      if (!canSearch) {
        setResults([])
        setLoading(false)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      searchIdentities(searchApi, term)
        .then((options) => {
          if (cancelled) return
          setResults(options)
          setActiveIndex(options.length > 0 ? 0 : -1)
        })
        .catch((err) => {
          if (cancelled) return
          setResults([])
          setError(
            err instanceof FriendlyError
              ? err.message
              : "We couldn't search for people just now. Please try again.",
          )
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [term, canSearch, searchApi])

  // Close the list when focus leaves the whole widget.
  useEffect(() => {
    const onFocusOut = (e: FocusEvent) => {
      if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
        setOpen(false)
      }
    }
    const node = rootRef.current
    node?.addEventListener('focusout', onFocusOut)
    return () => node?.removeEventListener('focusout', onFocusOut)
  }, [])

  const select = (option: IdentityOption) => {
    onChange(option)
    setOpen(false)
    setQuery('')
    setDebounced('')
    setResults([])
    setActiveIndex(-1)
  }

  const clear = () => {
    onChange(null)
    setQuery('')
    setDebounced('')
    setResults([])
    setActiveIndex(-1)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length === 0) return
      setOpen(true)
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length === 0) return
      setOpen(true)
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault()
        select(results[activeIndex])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
  }

  // When a person is already chosen, show them with a Clear button instead of
  // the search field — the reviewer rarely needs to change it.
  if (value) {
    return (
      <div className="vc-picker" ref={rootRef}>
        <div className="vc-picker-selected">
          <span className="vc-picker-selected-text">
            <span className="vc-picker-selected-name">
              {value.displayName || value.id}
            </span>
            {value.email && (
              <span className="vc-picker-selected-email">{value.email}</span>
            )}
          </span>
          <button
            type="button"
            className="vc-link-btn"
            onClick={clear}
            disabled={disabled}
          >
            Clear
          </button>
        </div>
      </div>
    )
  }

  const showList =
    open && (loading || error !== null || results.length > 0 || debounced.trim().length > 0)
  const activeId =
    open && activeIndex >= 0 && activeIndex < results.length
      ? `${optionIdPrefix}-${results[activeIndex].id}`
      : undefined

  return (
    <div className="vc-picker" ref={rootRef}>
      <input
        id={inputId}
        type="text"
        className="vc-picker-input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Search by name or email…"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {showList && (
        <ul id={listId} className="vc-picker-list" role="listbox">
          {loading && (
            <li className="vc-picker-status" aria-live="polite">
              Searching…
            </li>
          )}
          {!loading && error !== null && (
            <li className="vc-picker-status vc-picker-error" role="alert">
              {error}
            </li>
          )}
          {!loading &&
            error === null &&
            results.length === 0 &&
            debounced.trim().replace(/\s/g, '').length >= 2 && (
              <li className="vc-picker-status">No matches</li>
            )}
          {!loading &&
            error === null &&
            results.map((option, index) => (
              <li
                key={option.id}
                id={`${optionIdPrefix}-${option.id}`}
                className={
                  index === activeIndex
                    ? 'vc-picker-option vc-picker-option-active'
                    : 'vc-picker-option'
                }
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => {
                  // Prevent the input losing focus before the click registers.
                  e.preventDefault()
                  select(option)
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="vc-picker-option-name">
                  {option.displayName || option.id}
                </span>
                {option.email && (
                  <span className="vc-picker-option-email">{option.email}</span>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
