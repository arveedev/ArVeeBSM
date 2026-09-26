// Sort/filter modal for ProcurementMonitor.jsx - per explicit request,
// warehouse/variety/sort/paid-filter move behind a single button instead
// of stacking four controls above the list on every load; Search and the
// Period/month row both stay inline on the page itself (Search is
// deliberately NOT part of this modal - it needs to stay visible/usable
// without an extra tap, same as Period). Same centered-box modal pattern
// as RicemillSortFilterModal.jsx.

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const SORTS = [
  { id: 'date-desc', label: 'Date (Newest)' },
  { id: 'date-asc', label: 'Date (Oldest)' },
  { id: 'bags-desc', label: 'Bags (Highest)' },
  { id: 'bags-asc', label: 'Bags (Lowest)' },
]

const PAYMENT_FILTERS = [
  { id: '', label: 'All' },
  { id: 'paid', label: 'Paid' },
  { id: 'unpaid', label: 'Unpaid' },
]

function ProcurementSortFilterModal({
  warehouseFilter, varietyFilter, sortBy, paymentFilter,
  warehouseOptions, varietyOptions,
  onChange, onReset, onClose,
}) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
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

        <div className="mt-3 grid grid-cols-2 gap-2">
          <select
            value={warehouseFilter}
            onChange={(e) => onChange({ warehouseFilter: e.target.value })}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text"
          >
            <option value="">All warehouses</option>
            {warehouseOptions.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>)}
          </select>
          <select
            value={varietyFilter}
            onChange={(e) => onChange({ varietyFilter: e.target.value })}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text"
          >
            <option value="">All varieties</option>
            {varietyOptions.map((v) => <option key={v.varietyId} value={v.varietyId}>{v.name}</option>)}
          </select>
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Sort by</p>
        <div className="mt-1.5">
          <select
            value={sortBy}
            onChange={(e) => onChange({ sortBy: e.target.value })}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Payment status</p>
        <div className="relative mt-1.5 flex gap-1 rounded-xl border border-neutral-800 bg-neutral-950 p-1">
          <div
            className="absolute inset-y-1 rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
            style={{
              width: `calc(${100 / PAYMENT_FILTERS.length}% - ${(PAYMENT_FILTERS.length - 1) / PAYMENT_FILTERS.length * 0.25}rem)`,
              transform: `translateX(calc(${PAYMENT_FILTERS.findIndex((p) => p.id === paymentFilter) * 100}% + ${PAYMENT_FILTERS.findIndex((p) => p.id === paymentFilter) * 0.25}rem))`,
            }}
          />
          {PAYMENT_FILTERS.map((p) => (
            <button
              key={p.id || 'all'}
              type="button"
              onClick={() => onChange({ paymentFilter: p.id })}
              className={`relative z-10 flex-1 rounded-lg py-2 text-sm transition-colors active:scale-95 ${
                paymentFilter === p.id ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400 hover:text-app-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onReset}
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

export default ProcurementSortFilterModal
