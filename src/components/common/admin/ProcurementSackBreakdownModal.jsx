// Procurement Sack Breakdown — admin-only, opened from the icon beside
// the "Procurement" label on AdminMonitoring.jsx. Shows every distinct
// sack weight/condition combo (e.g. "50kg - BN") actually used across
// Procurement-type WSRs, each with its own Bags/Net Kg total, for a
// chosen date period and (optionally) one warehouse - independent of
// whatever Search/Sort & Filter/Period state ProcurementMonitor's own
// list currently has, since this is a separate lookup, not a view of
// the same filtered list.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Package } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useSettings } from '../../../context/SettingsContext.jsx'
import { fmtBags, fmtWeight, isProcurementTypeName, effectiveCutoffDate, getPeriodPresetRanges } from '../../../utils/calculations.js'
import PeriodPresetPicker from '../PeriodPresetPicker.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'

function ProcurementSackBreakdownModal({ onClose }) {
  const { weightUnit } = useSettings() ?? {}
  const [periodFrom, setPeriodFrom] = useState(() => getPeriodPresetRanges(0).monthFrom)
  const [periodTo, setPeriodTo] = useState(() => getPeriodPresetRanges(0).monthTo)
  const [warehouseFilter, setWarehouseFilter] = useState('')

  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const globalDataStartDate = useLiveQuery(async () => (await db.reportConfig.get('global'))?.dataStartDate || null, []) ?? null

  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))
  const procurementTypeIds = new Set(
    transactionTypes.filter((t) => isProcurementTypeName(t.name)).map((t) => t.transactionTypeId)
  )

  const rawTx = useLiveQuery(
    () => procurementTypeIds.size > 0
      ? db.transactions
          .where('type').equals('WSR')
          .and((t) => t.status === 'Active' && !t.isInitialBalance && procurementTypeIds.has(t.transactionTypeId))
          .toArray()
      : Promise.resolve([]),
    [transactionTypes.length, procurementTypeIds.size]
  ) ?? []

  // Same reporting-cutoff rule ProcurementMonitor.jsx itself applies.
  const cutoffFilteredTx = rawTx.filter((t) => {
    const cutoff = effectiveCutoffDate(warehouseMap.get(t.warehouseId)?.reportingCutoffDate, globalDataStartDate)
    return !cutoff || t.date > cutoff
  })

  const periodFilteredTx = cutoffFilteredTx.filter((t) => {
    if (periodFrom && t.date < periodFrom) return false
    if (periodTo && t.date > periodTo) return false
    return true
  })

  const visibleTx = warehouseFilter
    ? periodFilteredTx.filter((t) => t.warehouseId === warehouseFilter)
    : periodFilteredTx

  const warehouseOptions = warehouses
    .filter((w) => cutoffFilteredTx.some((t) => t.warehouseId === w.warehouseId))
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))

  const byGroup = new Map()
  for (const t of visibleTx) {
    const key = t.mtsSackTypeId && t.mtsCondition ? `${t.mtsSackTypeId}::${t.mtsCondition}` : 'unspecified'
    if (!byGroup.has(key)) {
      const sackType = t.mtsSackTypeId ? sackTypeMap.get(t.mtsSackTypeId) : null
      byGroup.set(key, {
        key,
        label: sackType && t.mtsCondition ? `${sackType.code} - ${t.mtsCondition}` : 'Unspecified',
        rowCount: 0,
        totalBags: 0,
        totalKilos: 0,
      })
    }
    const group = byGroup.get(key)
    group.rowCount += 1
    group.totalBags += t.numberOfBags ?? 0
    group.totalKilos += t.netKilos ?? 0
  }

  const groups = [...byGroup.values()].sort((a, b) => b.totalBags - a.totalBags)
  const grandBags = groups.reduce((s, g) => s + g.totalBags, 0)
  const grandKilos = groups.reduce((s, g) => s + g.totalKilos, 0)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-app-text">
            <Package size={17} className="text-brand-neon" /> Sack Type &amp; Condition Breakdown
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-neutral-500 transition-colors hover:text-app-text"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          Every sack weight/condition combo used across Procurement transactions in this period.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Period From</label>
            <CalendarDatePicker value={periodFrom} label="Start Date" required={false} onChange={setPeriodFrom} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Period To</label>
            <CalendarDatePicker value={periodTo} label="End Date" required={false} onChange={setPeriodTo} />
          </div>
        </div>
        <div className="mt-2">
          <PeriodPresetPicker
            onSelectRange={(from, to) => { setPeriodFrom(from); setPeriodTo(to) }}
            onMonthChange={(from, to) => { setPeriodFrom(from); setPeriodTo(to) }}
            currentFrom={periodFrom}
            currentTo={periodTo}
          />
        </div>

        <select
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text"
        >
          <option value="">All warehouses</option>
          {warehouseOptions.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>)}
        </select>

        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-600">
            No Procurement transactions match this period{warehouseFilter ? ' and warehouse' : ''}.
          </p>
        ) : (
          <>
            <div className="mt-3 rounded-xl border border-brand-neon/30 bg-brand-neon/5 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-neon/70">Total</p>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-xl font-bold tabular-nums text-brand-neon">
                  {fmtBags(grandBags)} <span className="text-sm font-normal text-neutral-500">bags</span>
                </p>
                <p className="text-base font-semibold tabular-nums text-app-text">{fmtWeight(grandKilos, weightUnit, 'Net')}</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {groups.map((g) => (
                <div key={g.key} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-semibold text-app-text">{g.label}</span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {g.rowCount} {g.rowCount === 1 ? 'transaction' : 'transactions'}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <div className="min-w-0 rounded-lg bg-neutral-900 px-1.5 py-1.5 text-center">
                      <p className="text-[10px] uppercase text-neutral-500">Bags</p>
                      <p className="mt-0.5 break-words text-base font-bold tabular-nums text-app-text">{fmtBags(g.totalBags)}</p>
                    </div>
                    <div className="min-w-0 rounded-lg bg-neutral-900 px-1.5 py-1.5 text-center">
                      <p className="text-[10px] uppercase text-neutral-500">Net Kg</p>
                      <p className="mt-0.5 break-words text-base font-bold tabular-nums text-app-text">{fmtWeight(g.totalKilos, weightUnit).replace(/\s*(kg|MT)$/, '')}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

export default ProcurementSackBreakdownModal
