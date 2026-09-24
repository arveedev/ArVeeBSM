// Farmer Organization Member Name field with autocomplete — per
// explicit request. Individual FA members previously had no
// autocomplete of their own at all (only the FA/coop's own top-level
// Customer Name field did), and the FA toggle used to silently pre-fill
// every member row from whichever members were saved the LAST time
// that FA was used, which was also explicitly unwanted - a member row
// must always start blank, waiting for real input, and now offers its
// own name-based suggestions sourced from (and saved back to) the same
// db.customers directory CustomerNameAutocomplete.jsx already uses -
// each member is remembered as their own individual customer record,
// separate from the FA/coop's own record, so a farmer's RSBSA/Gender
// carries over the next time their name comes up, in any context.
//
// Deliberately a separate, leaner component rather than reusing
// CustomerNameAutocomplete directly - this field has none of that
// component's WS/MPO-prefix search, per-warehouse address resolution,
// or FA-toggle slot, and duplicating the small amount of shared logic
// here keeps that already-proven component untouched.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { User } from 'lucide-react'
import { searchCustomers, findCustomerByName } from '../../utils/customerDirectory.js'
import { inputClass } from './shared.js'

function MemberNameAutocomplete({ value, onChange, onMatch, placeholder = 'Member Full Name' }) {
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  // Same Arrow Down/Up + Tab-to-accept behavior as CustomerNameAutocomplete.jsx.
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [dropdownRect, setDropdownRect] = useState(null)
  const containerRef = useRef(null)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setHighlightedIndex(-1)
  }, [suggestions, showSuggestions])

  useEffect(() => {
    let cancelled = false
    searchCustomers(value, 6).then((results) => {
      if (!cancelled) setSuggestions(results)
    })
    // Auto-fill if what's currently typed already exactly matches a
    // known name, same as CustomerNameAutocomplete's own exact-match
    // fallback - covers typing a full name directly without picking
    // from the dropdown.
    findCustomerByName(value).then((match) => {
      if (cancelled || !match) return
      onChange(match.name)
      onMatch(match)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (dropdownRef.current?.contains(e.target)) return
      setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!showSuggestions) return
    const updatePosition = () => {
      if (!inputRef.current) return
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownRect({ top: rect.bottom, left: rect.left, width: rect.width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [showSuggestions])

  const handleSelect = (customer) => {
    onChange(customer.name)
    onMatch(customer)
    setShowSuggestions(false)
  }

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Tab' && highlightedIndex >= 0) {
      // Deliberately no preventDefault - Tab's own default focus-advance
      // still happens right after accepting the highlighted suggestion.
      handleSelect(suggestions[highlightedIndex])
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      handleSelect(suggestions[highlightedIndex])
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setShowSuggestions(true)
        }}
        onFocus={() => setShowSuggestions(true)}
        onKeyDown={handleKeyDown}
        className={inputClass}
        placeholder={placeholder}
        autoComplete="off"
      />

      {showSuggestions && suggestions.length > 0 && dropdownRect && createPortal(
        <ul
          ref={dropdownRef}
          className="fixed z-[62] mt-1.5 divide-y divide-neutral-800 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/50"
          style={{
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            maxHeight: Math.max(120, Math.min(288, window.innerHeight - dropdownRect.top - 12)),
          }}
        >
          {suggestions.map((c, i) => (
            <li key={c.customerId}>
              <button
                type="button"
                onClick={() => handleSelect(c)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-800 active:bg-neutral-800 ${
                  i === highlightedIndex ? 'bg-neutral-800' : ''
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-300">
                  <User size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate text-app-text">{c.name}</span>
                {c.rsbsa && <span className="shrink-0 text-xs text-neutral-500">{c.rsbsa}</span>}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
}

export default MemberNameAutocomplete
