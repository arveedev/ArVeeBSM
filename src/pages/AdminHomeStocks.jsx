// Admin Home Stocks tab.
// 1. Net bags per province, per category.
// 2. Breakdown per warehouse, per category.
// 3. Age grouping per province, warehouse, category.
// "Net bags" = pile.currentKilos / 50, the live running total on each
// pile, not a re-derivation from transaction history.

import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight } from 'lucide-react'
import { useSettings } from '../context/SettingsContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, fmtNetBags, fmtWeight, AGE_BUCKETS } from '../utils/calculations.js'
import { Section, Th, Td, Empty } from './AdminHomeShared.jsx'
import { stripWarehouseCodePrefix } from '../services/googleSheetsBridge.js'

const CATEGORIES = ['Rice', 'Palay', 'By Products']

function AdminHomeStocks({ onWarehouseSelect }) {
  const { autoAgeMonitoring, weightUnit } = useSettings() ?? {}

  // netBags is bags-of-50kg. When the toggle is set to MT, it converts
  // back to kilos (× 50, the confirmed inverse of bags = kilos / 50)
  // then to metric tons via the same fmtWeight used everywhere else in
  // the app, rather than staying in bags - bags is a count, not a
  // weight unit, so it has no MT equivalent of its own.
  const fmt = (netBags) => weightUnit === 'mt' ? fmtWeight(netBags * 50, 'mt') : fmtNetBags(netBags)

  const provinces = useLiveQuery(() => db.provinces.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const piles = useLiveQuery(() => db.piles.toArray(), []) ?? []

  const provinceMap = new Map(provinces.map((p) => [p.provinceId, p]))

  const enrichedPiles = piles.map((p) => ({
    ...p,
    age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
    netBags: (p.currentKilos ?? 0) / 50,
  }))

  const sortedProvinces = [...provinces].sort((a, b) => a.code.localeCompare(b.code))
  const sortedWarehouses = [...warehouses].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <Section title={weightUnit === 'mt' ? 'Metric Tons by Province & Category' : 'Net Bags by Province & Category'}>
        {sortedProvinces.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800">
                <Th>Province</Th>
                {CATEGORIES.map((c) => <Th key={c} right>{c}</Th>)}
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {sortedProvinces.map((province) => {
                const wIds = new Set(
                  warehouses
                    .filter((w) => w.provinceId === province.provinceId)
                    .map((w) => w.warehouseId)
                )
                const pp = enrichedPiles.filter((p) => wIds.has(p.warehouseId))
                const catTotals = Object.fromEntries(
                  CATEGORIES.map((c) => [c, pp.filter((p) => p.cerealType === c)
                    .reduce((s, p) => s + p.netBags, 0)])
                )
                const total = Object.values(catTotals).reduce((a, b) => a + b, 0)
                return (
                  <tr key={province.provinceId} className="border-b border-neutral-800/50">
                    <Td>
                      <span className="font-medium text-app-text">{province.code}</span>
                      <span className="ml-1 text-xs text-neutral-500">{province.name}</span>
                    </Td>
                    {CATEGORIES.map((c) => <Td key={c} right>{fmt(catTotals[c])}</Td>)}
                    <Td right><span className="font-semibold text-brand-neon">{fmt(total)}</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {sortedProvinces.length > 0 && (() => {
          // Branch total: Rice + Palay only, explicitly excluding By
          // Products - the same pattern already used for cerealType
          // filtering, just summed across every province at once
          // rather than one province at a time.
          const branchTotal = enrichedPiles
            .filter((p) => p.cerealType === 'Rice' || p.cerealType === 'Palay')
            .reduce((s, p) => s + p.netBags, 0)
          return (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Branch Total (Rice + Palay)</span>
              <span className="text-sm font-bold text-brand-neon">{fmt(branchTotal)}</span>
            </div>
          )
        })()}
      </Section>

      <Section title="Stock Breakdown — Warehouse & Category">
        {sortedWarehouses.length === 0 ? <Empty /> : (
          <div className="space-y-4">
            {sortedWarehouses.map((warehouse) => {
              const wPiles = enrichedPiles.filter((p) => p.warehouseId === warehouse.warehouseId)
              if (wPiles.length === 0) return null
              const province = provinceMap.get(warehouse.provinceId)
              return (
                <div key={warehouse.warehouseId}>
                  <button
                    type="button"
                    onClick={() => onWarehouseSelect?.(warehouse)}
                    className="flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm font-bold text-app-text transition-all hover:border-brand-neon/50 hover:bg-brand-neon/10 hover:text-brand-neon active:scale-95"
                  >
                    {province?.code} · {stripWarehouseCodePrefix(warehouse.name)}
                    <ChevronRight size={14} />
                  </button>
                  <table className="mt-1 w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800">
                        <Th>Category</Th>
                        <Th right>{weightUnit === 'mt' ? 'MT' : 'Net Bags'}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {CATEGORIES.map((cat) => {
                        const sum = wPiles.filter((p) => p.cerealType === cat)
                          .reduce((s, p) => s + p.netBags, 0)
                        if (sum === 0) return null
                        const colorClass = cat === 'Rice' ? 'text-blue-400' : cat === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'
                        return (
                          <tr key={cat} className="border-b border-neutral-800/50">
                            <Td><span className={`font-semibold ${colorClass}`}>{cat}</span></Td>
                            <Td right><span className={`text-base font-bold ${colorClass}`}>{fmt(sum)}</span></Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Stock Age Grouping">
        {sortedProvinces.length === 0 ? <Empty /> : (
          <div className="space-y-6">
            {sortedProvinces.map((province) => {
              const provinceWarehouses = sortedWarehouses.filter(
                (w) => w.provinceId === province.provinceId
              )
              if (provinceWarehouses.length === 0) return null
              return (
                <div key={province.provinceId}>
                  <p className="mb-2 text-sm font-semibold text-app-text">
                    {province.code} — {province.name}
                  </p>
                  {CATEGORIES.map((cat) => {
                    const buckets = AGE_BUCKETS[cat]
                    const hasData = provinceWarehouses.some((w) =>
                      enrichedPiles.some(
                        (p) => p.warehouseId === w.warehouseId && p.cerealType === cat
                      )
                    )
                    if (!hasData) return null
                    return (
                      <div key={cat} className="mt-3">
                        <p className={`mb-1 text-sm font-bold uppercase ${cat === 'Rice' ? 'text-blue-400' : cat === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'}`}>
                          {cat}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-neutral-800">
                                <Th>Warehouse</Th>
                                {buckets.map((b) => <Th key={b.label} right>{b.label.replace(/\s*months?$/i, '')}</Th>)}
                                <Th right>Total</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {provinceWarehouses.map((warehouse) => {
                                const wCatPiles = enrichedPiles.filter(
                                  (p) => p.warehouseId === warehouse.warehouseId &&
                                         p.cerealType === cat
                                )
                                if (wCatPiles.length === 0) return null
                                const bucketTotals = buckets.map((b) =>
                                  wCatPiles.filter((p) => b.test(p.age))
                                    .reduce((s, p) => s + p.netBags, 0)
                                )
                                const total = bucketTotals.reduce((a, b) => a + b, 0)
                                return (
                                  <tr key={warehouse.warehouseId} className="border-b border-neutral-800/50">
                                    <Td>
                                      <button
                                        type="button"
                                        onClick={() => onWarehouseSelect?.(warehouse)}
                                        className="flex items-center gap-0.5 font-medium text-app-text transition-colors hover:text-brand-neon"
                                      >
                                        {warehouse.name}
                                        <ChevronRight size={12} className="text-neutral-600" />
                                      </button>
                                    </Td>
                                    {bucketTotals.map((val, i) => <Td key={i} right>{fmt(val)}</Td>)}
                                    <Td right>
                                      <span className={`font-semibold ${cat === 'Rice' ? 'text-blue-400' : cat === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'}`}>
                                        {fmt(total)}
                                      </span>
                                    </Td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            <tfoot>
                              {(() => {
                                const catPiles = enrichedPiles.filter(
                                  (p) => provinceWarehouses.some((w) => w.warehouseId === p.warehouseId) &&
                                         p.cerealType === cat
                                )
                                const columnTotals = buckets.map((b) =>
                                  catPiles.filter((p) => b.test(p.age)).reduce((s, p) => s + p.netBags, 0)
                                )
                                const grandTotal = columnTotals.reduce((a, b) => a + b, 0)
                                return (
                                  <tr className="border-t-2 border-neutral-700">
                                    <Td><span className="font-bold text-app-text">Total</span></Td>
                                    {columnTotals.map((val, i) => (
                                      <Td key={i} right>
                                        <span className={`font-bold ${cat === 'Rice' ? 'text-blue-400' : cat === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'}`}>{fmt(val)}</span>
                                      </Td>
                                    ))}
                                    <Td right>
                                      <span className={`font-bold ${cat === 'Rice' ? 'text-blue-400' : cat === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'}`}>
                                        {fmt(grandTotal)}
                                      </span>
                                    </Td>
                                  </tr>
                                )
                              })()}
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </>
  )
}

export default AdminHomeStocks
