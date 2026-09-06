// Small centered sort/filter modal for one Regional Authority Number's
// Issuance/Receipt lists (RicemillRecoveryDetail.jsx) - same portal +
// centered-box pattern as ConfirmDialog.jsx, since this is a quick
// in-place control rather than a full-screen browsing experience.

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export const DEFAULT_SORT = 'date-desc'

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Date (Newest first)' },
  { value: 'date-asc', label: 'Date (Oldest first)' },
  { value: 'kilos-desc', label: 'Net Kgs (High to low)' },
  { value: 'kilos-asc', label: 'Net Kgs (Low to high)' },
]

function RicemillSortFilterModal({ sortBy, dateFrom, dateTo, onChange, onClose }) {
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
            <label className="text-xs text-neutral-500">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onChange({ sortBy, dateFrom: e.target.value, dateTo })}
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onChange({ sortBy, dateFrom, dateTo: e.target.value })}
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon"
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
