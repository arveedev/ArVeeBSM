// Small centered sort/filter modal for one Regional Authority Number's
// Issuance/Receipt lists (RicemillRecoveryDetail.jsx) - same portal +
// centered-box pattern as ConfirmDialog.jsx, since this is a quick
// in-place control rather than a full-screen browsing experience.
//
// Date range uses the app's own CalendarDatePicker, not native <input
// type="date"> - matches every other date range in the app (Reports.jsx's
// Summary/Stock Statement periods). Picking a From date auto-opens the
// To picker via the same ref-chaining pattern those use, so both ends
// of the range can be set in one uninterrupted flow.

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import CalendarDatePicker from './CalendarDatePicker.jsx'

export const DEFAULT_SORT = 'date-desc'

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Date (Newest first)' },
  { value: 'date-asc', label: 'Date (Oldest first)' },
  { value: 'kilos-desc', label: 'Net Kgs (High to low)' },
  { value: 'kilos-asc', label: 'Net Kgs (Low to high)' },
]

function RicemillSortFilterModal({ sortBy, dateFrom, dateTo, onChange, onClose }) {
  const toPickerRef = useRef(null)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-app-text">Sort &amp; Filter</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-neutral-500 transition-colors hover:text-app-text"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Sort by</p>
        <div className="mt-1.5 space-y-1.5">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ sortBy: opt.value, dateFrom, dateTo })}
              className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                sortBy === opt.value
                  ? 'border-brand-neon bg-brand-neon/10 text-brand-neon'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Date range</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">From</label>
            <CalendarDatePicker
              value={dateFrom}
              label="Start Date"
              required={false}
              placeholder="Any"
              valueClassName="text-sm"
              onChange={(iso) => {
                onChange({ sortBy, dateFrom: iso, dateTo })
                toPickerRef.current?.open()
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">To</label>
            <CalendarDatePicker
              ref={toPickerRef}
              value={dateTo}
              label="End Date"
              required={false}
              placeholder="Any"
              valueClassName="text-sm"
              onChange={(iso) => onChange({ sortBy, dateFrom, dateTo: iso })}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ sortBy: DEFAULT_SORT, dateFrom: '', dateTo: '' })}
            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-brand-neon px-3 py-2.5 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default RicemillSortFilterModal
