// ProcurementMonitor — Admin-only cross-warehouse view of every
// Procurement-type WSR (palay bought directly from farmers - the same
// "Procurement" transaction nature ProcurementBagsNotification.jsx
// already tracks per-warehouse for sack matching, here surfaced as a
// warehouse-oversight list instead). One card per warehouse, each
// listing its own rows: date, variety, the real counted bags and net
// kilos (both prominent - these are what actually happened), and the
// derived net-bags figure (kilos / 50) shown subtly alongside them -
// same "real count is the point, net bags is a secondary derived
// number" convention RicemillRecoveryDetail.jsx already uses.
//
// Mirrors MillingMonitor/NfaMillingMonitor's own `active` prop shape
// for consistency with AdminMonitoring.jsx's always-mounted/hidden-
// toggle tab pattern, even though this component has no debounced
// recompute of its own to gate.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { fmtBags, fmtWeight, fmtNetBags, calculateNetBags, isProcurementTypeName, effectiveCutoffDate } from '../../utils/calculations.js'

function ProcurementMonitor() {
  const { weightUnit } = useSettings() ?? {}

  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), []) ?? []
  const globalDataStartDate = useLiveQuery(async () => (await db.reportConfig.get('global'))?.dataStartDate || null, []) ?? null

  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const procurementTypeIds = new Set(
    transactionTypes.filter((t) => isProcurementTypeName(t.name)).map((t) => t.transactionTypeId)
  )

  // 'type' is indexed on db.transactions, so this is a real index-range
  // query (not a full scan) that already covers every warehouse at once
  // - no per-warehouse looping needed, grouping happens after the fetch.
  const rawTx = useLiveQuery(
    () => procurementTypeIds.size > 0
      ? db.transactions
          .where('type').equals('WSR')
          .and((t) => t.status === 'Active' && !t.isInitialBalance && procurementTypeIds.has(t.transactionTypeId))
          .toArray()
      : Promise.resolve([]),
    [transactionTypes.length, procurementTypeIds.size]
  ) ?? []

  // Same reporting-cutoff-date rule Reports.jsx/SdoHome.jsx already
  // apply everywhere else - a warehouse's own override, or the global
  // Data Start Date, whichever is later wins.
  const visibleTx = rawTx.filter((t) => {
    const cutoff = effectiveCutoffDate(warehouseMap.get(t.warehouseId)?.reportingCutoffDate, globalDataStartDate)
    return !cutoff || t.date > cutoff
  })

  const byWarehouse = new Map()
  for (const t of visibleTx) {
    if (!byWarehouse.has(t.warehouseId)) byWarehouse.set(t.warehouseId, [])
    byWarehouse.get(t.warehouseId).push(t)
  }

  const cards = [...byWarehouse.entries()]
    .map(([warehouseId, rows]) => ({
      warehouseId,
      warehouse: warehouseMap.get(warehouseId),
      rows: [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    }))
    .filter((c) => c.warehouse)
    .sort((a, b) => (a.warehouse.code ?? '').localeCompare(b.warehouse.code ?? ''))

  if (cards.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-600">
        No Procurement transactions recorded yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {cards.map((c) => (
        <div key={c.warehouseId} className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-base font-semibold text-app-text">
              {c.warehouse.code} — {c.warehouse.name}
            </p>
            <span className="shrink-0 text-xs text-neutral-500">
              {c.rows.length} {c.rows.length === 1 ? 'transaction' : 'transactions'}
            </span>
          </div>
          <div className="space-y-2">
            {c.rows.map((t) => (
              <div key={t.id} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-500">{t.date}</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-app-text">
                      {varietyMap.get(t.varietyId)?.name ?? '—'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold tabular-nums text-app-text">
                      {fmtBags(t.numberOfBags)} <span className="text-xs font-normal text-neutral-500">bags</span>
                    </p>
                    <p className="text-sm tabular-nums text-neutral-300">{fmtWeight(t.netKilos, weightUnit)}</p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-neutral-600">
                      {fmtNetBags(calculateNetBags(t.netKilos))} net bags
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default ProcurementMonitor
