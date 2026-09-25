// Customer Name field with autocomplete — searches db.customers once 3+
// characters are typed, shows up to 6 matching suggestions, and on
// selection (or on typing an exact existing name) invokes onMatch with
// the full customer record so the parent form can auto-fill RSBSA/Gender/
// Address/Farmer Org status.
//
// If the typed text starts with "WS" or "Acting WS", suggestions switch
// to matching Warehouse Supervisor users instead (see
// searchWarehouseSupervisors in customerDirectory.js) — useful for
// inter-warehouse transfers where the "customer" is really another
// warehouse's supervisor.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { User, Users, Building2 } from 'lucide-react'
import {
  searchCustomers,
  findCustomerByName,
  searchWarehouseSupervisors,
  searchMpoUsers,
} from '../../utils/customerDirectory.js'
import { inputClass, labelClass } from './shared.js'

const initialsOf = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

const CustomerNameAutocomplete = forwardRef(function CustomerNameAutocomplete(
  // labelRight: optional content rendered inline with the "Customer
  // Name" label itself (e.g. StockFormBase.jsx's Procurement-only
  // Farmers Organization toggle) - per explicit request, that toggle
  // needed to sit right next to this label instead of in its own
  // separate section further down the form.
  { value, onChange, onMatch, warehouseId = null, required = true, labelRight = null },
  ref
) {
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [dropdownRect, setDropdownRect] = useState(null)
  // Per explicit request: Arrow Down/Up moves a highlighted selection
  // through the suggestion list, Tab accepts whichever one is
  // highlighted (same as clicking it) without blocking Tab's own
  // default behavior, so focus still moves on to the next field right
  // after - matches how a native browser autocomplete already feels.
  // -1 means nothing highlighted yet (plain typing, no arrow pressed).
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef(null)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    // Opens the suggestion dropdown programmatically - used when a
    // value was set from OUTSIDE this field (e.g. picking an AI/SIA
    // authority whose customerName is a WS/MPO reference assigned to
    // more than one warehouse) and the caller needs the user to
    // manually disambiguate which one, the same list a manual "WS"
    // type would show. The effect above already computed `suggestions`
    // for the current `value` regardless of whether this is called -
    // this only reveals them.
    openSuggestions: () => setShowSuggestions(true),
  }))

  // A fresh suggestion list (new search results, or the dropdown
  // closing) always starts with nothing highlighted - carrying over a
  // stale index from the previous list could highlight the wrong row,
  // or one that no longer exists.
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [suggestions, showSuggestions])

  useEffect(() => {
    let cancelled = false

    searchWarehouseSupervisors(value).then((wsMatches) => {
      if (cancelled) return

      if (wsMatches.length > 0) {
        setSuggestions(wsMatches)
        // WS suggestions take priority and MUST NOT be overwritten below -
        // a same-named record already saved in db.customers (very likely,
        // since every prior save remembers whoever was typed as
        // "customer") would otherwise stomp the just-picked WS address
        // (with its warehouse name/GID prefix) with whatever generic
        // address that old record happens to hold.
        return
      }

      searchMpoUsers(value).then((mpoMatches) => {
        if (cancelled) return

        if (mpoMatches.length > 0) {
          setSuggestions(mpoMatches)
          return // same reasoning as the WS case above
        }

        searchCustomers(value, 6, warehouseId).then((results) => {
          if (!cancelled) setSuggestions(results)
        })

        // Auto-fill if what's currently typed is already an exact match,
        // even if the user didn't pick it from the dropdown. Only
        // reached once WS/MPO suggestions are ruled out, for the same
        // reason as above.
        findCustomerByName(value, warehouseId).then((match) => {
          if (cancelled || !match) return
          // Real bug found: this only ever called onMatch (which
          // back-fills Address/RSBSA/Gender/etc.), never onChange - so
          // typing a known ALIAS directly (no dropdown click) left the
          // alias text itself sitting in the field and saved verbatim
          // to the transaction/Sheet, while only the side fields
          // silently corrected to the real customer. handleSelect
          // (the dropdown-click path) already does both calls - this
          // matches it, so the visible/saved name is always the real
          // one, never the alias.
          onChange(match.name)
          onMatch(match)
        })
      })
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, warehouseId])

  useEffect(() => {
    const handleClickOutside = (e) => {
      // The dropdown itself now portals to document.body (see the
      // positioning effect below), so it's no longer inside
      // containerRef's own DOM subtree - without also checking
      // dropdownRef here, clicking a suggestion would register as an
      // "outside" click and close the list on mousedown, before its own
      // onClick ever got a chance to fire.
      if (containerRef.current?.contains(e.target)) return
      if (dropdownRef.current?.contains(e.target)) return
      setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Confirmed real bug: this dropdown used to be `position: absolute`
  // inside its own `relative` wrapper, which itself sits inside the
  // parent form modal's scrollable body (`overflow-y-auto`). Even after
  // making the dropdown's own list scrollable, an absolutely-positioned
  // element can never render past its nearest scrolling ancestor's own
  // clipped viewport - so the bottom of a long list still got cut off,
  // with the dropdown's own scrollbar unable to reveal the rest.
  // Portaling straight to document.body and positioning with `fixed` +
  // the input's live getBoundingClientRect() removes it from that
  // ancestor entirely, so it can render (and scroll) freely regardless
  // of where it sits inside a scrolling form. Repositions on scroll
  // (capture: true so this also catches a scroll on the modal's own
  // body, not just the window) and resize, so it tracks the input
  // instead of drifting away from it.
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

  // Per explicit request: Arrow Down/Up moves the highlight through the
  // suggestion list (wrapping at either end), Tab accepts whichever
  // suggestion is currently highlighted - deliberately NOT calling
  // preventDefault for Tab, so the browser's own default focus-advance
  // still happens right after, the same way accepting a native browser
  // autocomplete suggestion and tabbing onward already feels. Enter
  // accepts the same way, but WITH preventDefault (Enter has no useful
  // default action inside a plain text field, and blocking it also
  // stops it from accidentally submitting anything).
  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Tab' && highlightedIndex >= 0) {
      handleSelect(suggestions[highlightedIndex])
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      handleSelect(suggestions[highlightedIndex])
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center justify-between gap-2">
        <label className={labelClass}>Customer Name</label>
        {labelRight}
      </div>
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
        className={`${inputClass} ${required && !(value ?? '').trim() ? '!border-brand-amber' : ''}`}
        placeholder="Name"
        autoComplete="off"
      />

      {showSuggestions && suggestions.length > 0 && dropdownRect && createPortal(
        <ul
          ref={dropdownRef}
          // The text input itself keeps real focus throughout (rows are
          // only ever highlighted via state, never actually focused),
          // so useEntryFormShortcuts' own isTextEditable check already
          // keeps Left/Right out of series navigation while this is
          // open. Marked anyway, explicitly, matching the same
          // data-suppress-form-shortcuts convention CalendarDatePicker/
          // AuthorityPickerModal use - keeps this guarantee from
          // silently depending on "focus never leaves the input" if
          // this dropdown's rows ever become directly focusable later.
          data-suppress-form-shortcuts
          className="fixed z-[62] mt-1.5 divide-y divide-neutral-800 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/50"
          style={{
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            // Same 288px cap as before when there's room for it, but
            // shrinks further (down to a 120px floor) when the input
            // sits low enough on screen that 288px would run off the
            // bottom of the viewport - never a flat max-height that
            // could overflow past the visible screen regardless of
            // where the input actually is.
            maxHeight: Math.max(120, Math.min(288, window.innerHeight - dropdownRect.top - 12)),
          }}
        >
          {suggestions.map((c, i) => (
            <li key={c.customerId}>
              <button
                type="button"
                onClick={() => handleSelect(c)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-800 active:bg-neutral-800 ${
                  i === highlightedIndex ? 'bg-neutral-800' : ''
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    c.isWarehouseSupervisorSuggestion
                      ? 'bg-brand-amber/15 text-brand-amber'
                      : c.isFarmerOrg
                        ? 'bg-brand-neon/15 text-brand-neon'
                        : 'bg-neutral-800 text-neutral-300'
                  }`}
                >
                  {c.isWarehouseSupervisorSuggestion ? (
                    <Building2 size={14} />
                  ) : c.isFarmerOrg ? (
                    <Users size={14} />
                  ) : (
                    initialsOf(c.name) || <User size={14} />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-sm text-app-text">
                    {c.name}
                    {c.warehouseLabel && (
                      <span className="shrink-0 rounded-full bg-brand-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-amber">
                        {c.warehouseLabel}
                      </span>
                    )}
                  </span>
                  {c.address && (
                    <span className="block truncate text-xs text-neutral-500">{c.address}</span>
                  )}
                </span>

                {c.isFarmerOrg && !c.isWarehouseSupervisorSuggestion && (
                  <span className="shrink-0 rounded-full bg-brand-neon/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-neon">
                    Coop
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
})

export default CustomerNameAutocomplete
