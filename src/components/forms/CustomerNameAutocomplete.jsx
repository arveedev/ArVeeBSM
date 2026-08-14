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
  { value, onChange, onMatch, warehouseId = null, required = true },
  ref
) {
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }))

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
          if (!cancelled && match) onMatch(match)
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
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (customer) => {
    onChange(customer.name)
    onMatch(customer)
    setShowSuggestions(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <label className={labelClass}>Customer Name</label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setShowSuggestions(true)
        }}
        onFocus={() => setShowSuggestions(true)}
        className={`${inputClass} ${required && !(value ?? '').trim() ? '!border-brand-amber' : ''}`}
        placeholder="Name"
        autoComplete="off"
      />

      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1.5 w-full divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/50">
          {suggestions.map((c) => (
            <li key={c.customerId}>
              <button
                type="button"
                onClick={() => handleSelect(c)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-800 active:bg-neutral-800"
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
        </ul>
      )}
    </div>
  )
})

export default CustomerNameAutocomplete
