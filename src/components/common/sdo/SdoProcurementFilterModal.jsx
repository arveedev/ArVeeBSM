// Sort/filter modal for SdoHome.jsx's own For Payment/Completed list -
// per explicit request, mirrors ProcurementMonitor.jsx's own Sort &
// Filter modal shape but holds Period From/To + month picker/period
// presets + Sort by instead (Warehouse and Variety stay their own
// always-visible row on the page itself, not in this modal - per
// explicit request, the opposite split from ProcurementMonitor.jsx).
// No payment-status control here - the page's own "For Payment"/
// "Completed" tabs already ARE that filter (each tab is already scoped
// to exactly one payment state), so a second one in here would be
// redundant with, and could contradict, whichever tab is selected.
//
// Unlike ProcurementMonitor.jsx, Period From/To default to blank (no
// restriction) - this list's whole job is surfacing every outstanding
// unpaid WSR regardless of age, so defaulting it to the current month
// the way that admin-wide screen does would silently hide older unpaid
// records an SDO still needs to act on. Same centered-box modal
// pattern as ProcurementSortFilterModal.jsx/RicemillSortFilterModal.jsx.

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import PeriodPresetPicker from '../PeriodPresetPicker.jsx'

const SORTS = [
  { id: 'date-desc', label: 'Date (Newest)' },
  { id: 'date-asc', label: 'Date (Oldest)' },
  { id: 'bags-desc', label: 'Bags (Highest)' },
  { id: 'bags-asc', label: 'Bags (Lowest)' },
]

function SdoProcurementFilterModal({ periodFrom, periodTo, sortBy, onChange, onReset, onClose }) {
  const periodToPickerRef = useRef(null)

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

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Period</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Period From</label>
            <CalendarDatePicker
              value={periodFrom}
              label="Start Date"
              required={false}
              onChange={(iso) => { onChange({ periodFrom: iso }); periodToPickerRef.current?.open() }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Period To</label>
            <CalendarDatePicker
              ref={periodToPickerRef}
              value={periodTo}
              label="End Date"
              required={false}
              onChange={(iso) => onChange({ periodTo: iso })}
            />
          </div>
        </div>
        <div className="mt-2">
          <PeriodPresetPicker
            onSelectRange={(from, to) => onChange({ periodFrom: from, periodTo: to })}
            onMonthChange={(from, to) => onChange({ periodFrom: from, periodTo: to })}
            currentFrom={periodFrom}
            currentTo={periodTo}
          />
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

export default SdoProcurementFilterModal
