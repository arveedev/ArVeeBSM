// Data Start Date — a single global override that makes the ENTIRE app
// behave as if its data starts fresh on a given date. Everything before
// that date is excluded everywhere reportingCutoffDate already applies
// (Reports statements/beginning balances, Home Stocks, Pile List/Layout,
// BIN Card export, Unwithdrawn/potential-inventory math, Empty Sacks) -
// this is the SAME mechanism WarehousesPanel's own per-warehouse
// "Reports Start Date" already uses, just applied to every warehouse at
// once instead of one at a time. Per explicit request: for when not
// every warehouse has finished encoding a prior month's data yet, but
// the app still needs to be usable for the new month right now, without
// the admin manually setting the same cutoff on every single warehouse.
//
// A pile's real starting point on/after this date is whatever beginning
// balance the admin enters for it in Settings > Beginning Balances
// (isInitialBalance transactions always count regardless of any
// cutoff) - this override does not compute or guess one automatically.
//
// Stored on the same global reportConfig record (id: 'global') the
// Signatories panel already manages - dataStartDate is a new field on
// it, no schema migration needed since Dexie only requires migrations
// for INDEXED fields.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { AlertTriangle } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { labelClass, primaryButtonClass, secondaryButtonClass } from './shared.js'

function DataStartDatePanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const [dataStartDate, setDataStartDate] = useState('')
  const [pendingDate, setPendingDate] = useState(null) // date awaiting confirmation, or null
  const [pendingClear, setPendingClear] = useState(false)

  useEffect(() => {
    if (!config) return
    setDataStartDate(config.dataStartDate ?? '')
  }, [config])

  const currentlySet = config?.dataStartDate || null

  const applyDate = async (date) => {
    await db.reportConfig.put({ ...config, id: 'global', dataStartDate: date || null })
    toast.success(date ? `Data start date set to ${date}` : 'Data start date override cleared')
  }

  const handleSaveClick = () => {
    const trimmed = dataStartDate.trim()
    if (!trimmed || trimmed === currentlySet) return
    setPendingDate(trimmed)
  }

  const handleConfirmSave = async () => {
    const date = pendingDate
    setPendingDate(null)
    await applyDate(date)
  }

  const handleConfirmClear = async () => {
    setPendingClear(false)
    setDataStartDate('')
    await applyDate(null)
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Data Start Date</h2>
      <p className="mt-1 text-xs text-neutral-400">
        A single date that overrides every warehouse's own "Reports Start Date" at once - everything
        dated before it is excluded everywhere across the app (Reports, Home Stocks, Pile List/Layout,
        BIN Card export, Unwithdrawn stock), the same way each warehouse's individual setting already
        works, just app-wide with one change. A pile's real total on or after this date still comes
        from whatever beginning balance is entered for it in Settings &gt; Beginning Balances - this
        does not calculate one automatically.
      </p>

      {currentlySet && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-brand-amber/40 bg-brand-amber/10 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm text-brand-amber">
            <AlertTriangle size={16} className="shrink-0" />
            Currently active: nothing before <span className="font-semibold">{currentlySet}</span> is shown anywhere.
          </div>
        </div>
      )}

      <div className="mt-3">
        <label className={labelClass}>Override Date</label>
        <CalendarDatePicker
          value={dataStartDate}
          onChange={setDataStartDate}
          required={false}
          placeholder="No override set"
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={!dataStartDate.trim() || dataStartDate.trim() === currentlySet}
          className={`flex-1 ${primaryButtonClass} disabled:opacity-40`}
        >
          Save
        </button>
        {currentlySet && (
          <button
            type="button"
            onClick={() => setPendingClear(true)}
            className={secondaryButtonClass}
          >
            Clear Override
          </button>
        )}
      </div>

      <ConfirmDialog
        open={pendingDate !== null}
        icon={AlertTriangle}
        title={`Set the data start date to ${pendingDate}?`}
        description="Every warehouse will immediately stop showing anything dated before this in Reports, Home Stocks, Pile List/Layout, BIN Cards, and Unwithdrawn stock. Make sure every pile's beginning balance as of this date is already entered in Beginning Balances first."
        confirmLabel="Set Override"
        onConfirm={handleConfirmSave}
        onCancel={() => setPendingDate(null)}
      />

      <ConfirmDialog
        open={pendingClear}
        icon={AlertTriangle}
        title="Clear the data start date override?"
        description="Every warehouse goes back to using only its own individual Reports Start Date (if any) - older data that was hidden by this override becomes visible again everywhere."
        confirmLabel="Clear"
        onConfirm={handleConfirmClear}
        onCancel={() => setPendingClear(false)}
      />
    </section>
  )
}

export default DataStartDatePanel
