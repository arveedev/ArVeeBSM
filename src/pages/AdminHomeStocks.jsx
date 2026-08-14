// Admin Home Stocks tab.
// 1. Net bags per province, per category.
// 2. Breakdown per warehouse, per category.
// 3. Age grouping per province, warehouse, category.
// "Net bags" = pile.currentKilos / 50, the live running total on each
// pile, not a re-derivation from transaction history.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight } from 'lucide-react'
import { useSettings } from '../context/SettingsContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, fmtNetBags, fmtWeight, AGE_BUCKETS } from '../utils/calculations.js'
import { Section, Th, Td, Empty } from './AdminHomeShared.jsx'
import { stripWarehouseCodePrefix } from '../services/googleSheetsBridge.js'
import { computeUnwithdrawnByVariety } from '../utils/unwithdrawnStock.js'
import UnwithdrawnDetailModal from '../components/common/UnwithdrawnDetailModal.jsx'

const CATEGORIES = ['Rice', 'Palay', 'By Products']
const BREAKDOWN_TABS = ['Breakdown', 'Age Grouping']

function AdminHomeStocks({ onWarehouseSelect }) {
  const { autoAgeMonitoring, weightUnit } = useSettings() ?? {}
  const [breakdownTab, setBreakdownTab] = useState('Breakdown')
  // { warehouseId, varietyIds, title, subtitle } for the unwithdrawn
  // drill-down modal, or null when closed.
  const [detailContext, setDetailContext] = useState(null)

  // netBags is bags-of-50kg. When the toggle is set to MT, it converts
  // back to kilos (× 50, the confirmed inverse of bags = kilos / 50)
  // then to metric tons via the same fmtWeight used everywhere else in
  // the app, rather than staying in bags - bags is a count, not a
  // weight unit, so it has no MT equivalent of its own.
  const fmt = (netBags) => weightUnit === 'mt' ? fmtWeight(netBags * 50, 'mt') : fmtNetBags(netBags)

  const provinces = useLiveQuery(() => db.provinces.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const piles = useLiveQuery(() => db.piles.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyCategoryMap = new Map(varieties.map((v) => [v.varietyId, v.category]))

  // Same "authorized but not yet withdrawn" concept as HomeStocks, here
  // rolled up to warehouse+category (this page has no per-variety
  // breakdown) - warehouseId -> category -> unwithdrawn net bags. Kept
  // in kilos internally (not the separate bag-count field) so it can be
  // formatted the same way as the rest of this page - net bags, or MT
  // when that's the active weight unit.
  const unwithdrawnByWarehouse = useLiveQuery(async () => {
    const result = new Map()
    for (const w of warehouses) {
      const byVariety = await computeUnwithdrawnByVariety(w.warehouseId)
      const byCategory = new Map()
      for (const [varietyId, uw] of byVariety) {
        const cat = varietyCategoryMap.get(varietyId) ?? 'Unknown'
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + uw.kilos / 50)
      }
      result.set(w.warehouseId, byCategory)
    }
    return result
  }, [warehouses, varieties]) ?? new Map()

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
                <Th right>Rice ({weightUnit === 'mt' ? 'MT' : 'Net Bags'})</Th>
                <Th right>Palay ({weightUnit === 'mt' ? 'MT' : 'Net Bags'})</Th>
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
                const riceTotal = pp.filter((p) => p.cerealType === 'Rice').reduce((s, p) => s + p.netBags, 0)
                const palayTotal = pp.filter((p) => p.cerealType === 'Palay').reduce((s, p) => s + p.netBags, 0)
                return (
                  <tr key={province.provinceId} className="border-b border-neutral-800/50">
                    <Td>
                      <span className="font-medium text-app-text">{province.code}</span>
                      <span className="ml-1 text-xs text-neutral-500">{province.name}</span>
                    </Td>
                    <Td right><span className="text-blue-400">{fmt(riceTotal)}</span></Td>
                    <Td right><span className="text-brand-neon">{fmt(palayTotal)}</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {sortedProvinces.length > 0 && (() => {
          // Two genuinely separate totals - Rice and Palay tracked
          // independently, not combined into one meaningless
          // cross-category sum.
          const riceBranchTotal = enrichedPiles.filter((p) => p.cerealType === 'Rice').reduce((s, p) => s + p.netBags, 0)
          const palayBranchTotal = enrichedPiles.filter((p) => p.cerealType === 'Palay').reduce((s, p) => s + p.netBags, 0)
          return (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Total — Rice ({weightUnit === 'mt' ? 'MT' : 'Net Bags'})
                </span>
                <span className="text-sm font-bold text-blue-400">{fmt(riceBranchTotal)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Total — Palay ({weightUnit === 'mt' ? 'MT' : 'Net Bags'})
                </span>
                <span className="text-sm font-bold text-brand-neon">{fmt(palayBranchTotal)}</span>
              </div>
            </div>
          )
        })()}
      </Section>

      <div className="relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: breakdownTab === BREAKDOWN_TABS[0] ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {BREAKDOWN_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setBreakdownTab(t)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium ${breakdownTab === t ? 'text-brand-contrast' : 'text-neutral-400'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {breakdownTab === 'Breakdown' && (
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
                        const unwithdrawnNetBags = unwithdrawnByWarehouse.get(warehouse.warehouseId)?.get(cat) ?? 0
                        // Guard against a rounds-to-zero badge (see HomeStocks.jsx
                        // for the same reasoning) - only flag rows with a
                        // genuinely meaningful unwithdrawn amount.
                        const hasUnwithdrawn = unwithdrawnNetBags >= 0.005
                        const catVarietyIds = varieties.filter((v) => v.category === cat).map((v) => v.varietyId)
                        return (
                          <tr key={cat} className="border-b border-neutral-800/50">
                            <Td><span className={`font-semibold ${colorClass}`}>{cat}</span></Td>
                            <Td right>
                              <span className={`text-base font-bold ${colorClass}`}>
                                {fmt(sum)}
                                {hasUnwithdrawn && (
                                  <button
                                    type="button"
                                    onClick={() => setDetailContext({
                                      warehouseId: warehouse.warehouseId,
                                      varietyIds: catVarietyIds,
                                      title: `${cat} — Unwithdrawn`,
                                      subtitle: `${province?.code} · ${stripWarehouseCodePrefix(warehouse.name)}`,
                                    })}
                                    className="ml-1.5 whitespace-nowrap rounded-md bg-red-400/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-red-400 transition-colors hover:bg-red-400/25 active:scale-95"
                                  >
                                    {fmt(unwithdrawnNetBags)} unwithdrawn
                                  </button>
                                )}
                              </span>
                              {hasUnwithdrawn && (
                                <div className="mt-0.5 text-[11px]">
                                  <span className="text-brand-amber">Potential: {fmt(Math.max(0, sum - unwithdrawnNetBags))}</span>
                                </div>
                              )}
                            </Td>
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
      )}

      {breakdownTab === 'Age Grouping' && (
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
                    const buckets = AGE_BUCKETS[cat] ?? AGE_BUCKETS.Rice
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
      )}
      {detailContext && (
        <UnwithdrawnDetailModal
          warehouseId={detailContext.warehouseId}
          varietyIds={detailContext.varietyIds}
          title={detailContext.title}
          subtitle={detailContext.subtitle}
          onClose={() => setDetailContext(null)}
        />
      )}
    </>
  )
}

export default AdminHomeStocks
