// ProcurementMonitor — Admin-only cross-warehouse view of every
// Procurement-type WSR (palay bought directly from farmers - the same
// "Procurement" transaction nature AppHeader.jsx's notification bell
// already tracks per-warehouse for sack matching, here surfaced as a
// warehouse-oversight list instead). One card per warehouse, grouped by
// variety within it (each variety gets its own subtotal), plus an
// overall per-warehouse TOTAL. Each row shows date and the real counted
// bags on the left; net kilos and the derived net-bags figure (kilos /
// 50) on the right - both large and readable, per explicit correction
// (an earlier pass made net bags too small/subtle to read).
//
// Search (by warehouse or variety), a warehouse filter, a sort order,
// and an optional period range are all client-side over the same
// already-fetched dataset - no extra query per control, since the
// underlying transaction count per warehouse is small enough that
// re-filtering in JS on every keystroke is cheap.

import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { fmtBags, fmtWeight, fmtNetBags, calculateNetBags, isProcurementTypeName, effectiveCutoffDate } from '../../utils/calculations.js'
import PeriodPresetPicker from './PeriodPresetPicker.jsx'
import CalendarDatePicker from './CalendarDatePicker.jsx'

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

function ProcurementMonitor() {
  const { weightUnit } = useSettings() ?? {}
  const [searchQuery, setSearchQuery] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [sortBy, setSortBy] = useState('date-desc')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  // '' | 'paid' | 'unpaid' - per explicit request, a WSR only counts as
  // Paid when an Active Purchase Receipt exists for it on the SDO side
  // (purchaseReceipts.wsrTransactionId) - nothing here is derived from
  // any other field on the transaction itself.
  const [paymentFilter, setPaymentFilter] = useState('')
  const periodToPickerRef = useRef(null)

  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), []) ?? []
  const globalDataStartDate = useLiveQuery(async () => (await db.reportConfig.get('global'))?.dataStartDate || null, []) ?? null
  const activePrs = useLiveQuery(() => db.purchaseReceipts.where('status').equals('Active').toArray(), []) ?? []
  const paidWsrIds = new Set(activePrs.map((pr) => pr.wsrTransactionId).filter(Boolean))

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
  const cutoffFilteredTx = rawTx.filter((t) => {
    const cutoff = effectiveCutoffDate(warehouseMap.get(t.warehouseId)?.reportingCutoffDate, globalDataStartDate)
    return !cutoff || t.date > cutoff
  })

  // Period range is optional - blank From/To (the default) shows every
  // Procurement transaction ever recorded, matching this tab's original
  // "monitor all" scope; setting a range narrows it the same way
  // Reports.jsx's Statement period does.
  const periodFilteredTx = cutoffFilteredTx.filter((t) => {
    if (periodFrom && t.date < periodFrom) return false
    if (periodTo && t.date > periodTo) return false
    return true
  })

  // Per explicit request, the variety filter is replaced by a warehouse
  // filter - cards are already grouped by warehouse, so this just jumps
  // straight to one instead of scrolling past every other warehouse.
  const warehouseFilteredTx = warehouseFilter
    ? periodFilteredTx.filter((t) => t.warehouseId === warehouseFilter)
    : periodFilteredTx

  const paymentFilteredTx = paymentFilter
    ? warehouseFilteredTx.filter((t) => (paymentFilter === 'paid') === paidWsrIds.has(t.id))
    : warehouseFilteredTx

  const q = searchQuery.trim().toLowerCase()
  const visibleTx = q
    ? paymentFilteredTx.filter((t) => {
        const w = warehouseMap.get(t.warehouseId)
        const varietyName = varietyMap.get(t.varietyId)?.name ?? ''
        return (
          (w?.code ?? '').toLowerCase().includes(q) ||
          (w?.name ?? '').toLowerCase().includes(q) ||
          varietyName.toLowerCase().includes(q)
        )
      })
    : paymentFilteredTx

  const sortRows = (rows) => {
    const sorted = [...rows]
    switch (sortBy) {
      case 'date-asc': return sorted.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      case 'bags-desc': return sorted.sort((a, b) => (b.numberOfBags ?? 0) - (a.numberOfBags ?? 0))
      case 'bags-asc': return sorted.sort((a, b) => (a.numberOfBags ?? 0) - (b.numberOfBags ?? 0))
      case 'date-desc':
      default: return sorted.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    }
  }

  const byWarehouse = new Map()
  for (const t of visibleTx) {
    if (!byWarehouse.has(t.warehouseId)) byWarehouse.set(t.warehouseId, [])
    byWarehouse.get(t.warehouseId).push(t)
  }

  const cards = [...byWarehouse.entries()]
    .map(([warehouseId, rows]) => {
      const totalBags = rows.reduce((s, t) => s + (t.numberOfBags ?? 0), 0)
      const totalKilos = rows.reduce((s, t) => s + (t.netKilos ?? 0), 0)

      // Per explicit request: within each warehouse, rows group by
      // variety, each variety carrying its own subtotal.
      const byVariety = new Map()
      for (const t of rows) {
        const key = t.varietyId ?? '—'
        if (!byVariety.has(key)) byVariety.set(key, [])
        byVariety.get(key).push(t)
      }
      const varietyGroups = [...byVariety.entries()]
        .map(([varietyId, vRows]) => ({
          varietyId,
          varietyName: varietyMap.get(varietyId)?.name ?? '—',
          rows: sortRows(vRows),
          subtotalBags: vRows.reduce((s, t) => s + (t.numberOfBags ?? 0), 0),
          subtotalKilos: vRows.reduce((s, t) => s + (t.netKilos ?? 0), 0),
        }))
        .sort((a, b) => a.varietyName.localeCompare(b.varietyName))

      return {
        warehouseId,
        warehouse: warehouseMap.get(warehouseId),
        rowCount: rows.length,
        varietyGroups,
        totalBags,
        totalKilos,
      }
    })
    .filter((c) => c.warehouse)
    .sort((a, b) => (a.warehouse.code ?? '').localeCompare(b.warehouse.code ?? ''))

  const warehouseOptions = warehouses
    .filter((w) => byWarehouse.has(w.warehouseId))
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search warehouse or variety"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 py-2 pl-9 pr-9 text-sm text-app-text outline-none focus:border-brand-neon"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-500 transition-colors hover:text-app-text"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <select
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-app-text"
        >
          <option value="">All warehouses</option>
          {warehouseOptions.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-app-text"
        >
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Paid = an Active Purchase Receipt exists for this WSR on the
          SDO side; everything else is Unpaid - per explicit request. */}
      <div className="relative mt-2 flex gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
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
            onClick={() => setPaymentFilter(p.id)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm transition-colors active:scale-95 ${
              paymentFilter === p.id ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400 hover:text-app-text'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Period range is optional (blank = every Procurement transaction
          ever recorded) - same true 50/50 two-column split as Reports.jsx
          on wide screens, stacked on narrow ones. */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Period From</label>
            <CalendarDatePicker
              value={periodFrom}
              label="Start Date"
              required={false}
              onChange={(iso) => { setPeriodFrom(iso); periodToPickerRef.current?.open() }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Period To</label>
            <CalendarDatePicker ref={periodToPickerRef} value={periodTo} label="End Date" required={false} onChange={setPeriodTo} />
          </div>
        </div>
        <PeriodPresetPicker onSelectRange={(from, to) => { setPeriodFrom(from); setPeriodTo(to) }} currentFrom={periodFrom} currentTo={periodTo} />
      </div>

      {cards.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-600">
          No Procurement transactions match.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {cards.map((c) => (
            <div key={c.warehouseId} className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-base font-semibold text-app-text">
                  {c.warehouse.code} — {c.warehouse.name}
                </p>
                <span className="shrink-0 text-xs text-neutral-500">
                  {c.rowCount} {c.rowCount === 1 ? 'transaction' : 'transactions'}
                </span>
              </div>

              <div className="space-y-4">
                {c.varietyGroups.map((vg) => (
                  <div key={vg.varietyId}>
                    <p className="mb-2 text-base font-bold text-app-text">{vg.varietyName}</p>
                    <div className="space-y-2">
                      {vg.rows.map((t) => (
                        <div key={t.id} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm text-neutral-500">{t.date}</p>
                                {paidWsrIds.has(t.id) ? (
                                  <span className="rounded-full bg-brand-neon/10 px-2.5 py-1 text-xs font-bold uppercase text-brand-neon">Paid</span>
                                ) : (
                                  <span className="rounded-full bg-brand-amber/10 px-2.5 py-1 text-xs font-bold uppercase text-brand-amber">Unpaid</span>
                                )}
                              </div>
                              <p className="mt-1 text-2xl font-bold tabular-nums text-app-text">
                                {fmtBags(t.numberOfBags)} <span className="text-sm font-normal text-neutral-500">bags</span>
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-2xl font-bold tabular-nums text-app-text">{fmtWeight(t.netKilos, weightUnit)}</p>
                              <p className="mt-1 text-base font-semibold tabular-nums text-neutral-400">
                                {fmtNetBags(calculateNetBags(t.netKilos))} net bags
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Only meaningful with 2+ varieties in this warehouse -
                        a single-variety card's subtotal would just repeat
                        the card's own TOTAL below it, so it's skipped. */}
                    {c.varietyGroups.length > 1 && (
                      <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="text-sm font-bold uppercase text-neutral-400">Subtotal</span>
                            <p className="mt-1 text-xl font-bold tabular-nums text-app-text">{fmtBags(vg.subtotalBags)} <span className="text-sm font-normal text-neutral-500">bags</span></p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xl font-bold tabular-nums text-app-text">{fmtWeight(vg.subtotalKilos, weightUnit)}</p>
                            <p className="mt-1 text-base font-semibold tabular-nums text-neutral-400">{fmtNetBags(calculateNetBags(vg.subtotalKilos))} net bags</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-lg border border-brand-neon/40 bg-brand-neon/5 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-sm font-bold uppercase text-brand-neon">Total</span>
                    <p className="mt-1 text-xl font-bold tabular-nums text-app-text">{fmtBags(c.totalBags)} <span className="text-sm font-normal text-neutral-500">bags</span></p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xl font-bold tabular-nums text-app-text">{fmtWeight(c.totalKilos, weightUnit)}</p>
                    <p className="mt-1 text-base font-semibold tabular-nums text-neutral-400">{fmtNetBags(calculateNetBags(c.totalKilos))} net bags</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProcurementMonitor
