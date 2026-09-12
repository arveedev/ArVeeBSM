// Admin Home Stocks tab.
// 1. Net bags per province, per category.
// 2. Breakdown per warehouse, per category.
// 3. Age grouping per province, warehouse, category.
// "Net bags" = each pile's cutoff-aware current total (respects the
// Data Start Date override, same as HomeStocks.jsx), not
// pile.currentKilos read directly - see computeCurrentPileStatesBatch's
// own comment for why this page used to bypass that override entirely.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useSettings } from '../context/SettingsContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, fmtBags, fmtNetBags, fmtWeight, AGE_BUCKETS } from '../utils/calculations.js'
import { computeCurrentPileStatesBatch } from '../utils/pileLedger.js'
import { Section, Th, Td, Empty } from './AdminHomeShared.jsx'
import { stripWarehouseCodePrefix } from '../services/googleSheetsBridge.js'
import { computeUnwithdrawnByCategoryAge, UNSPECIFIED_AGE } from '../utils/unwithdrawnStock.js'
import { computeWarehouseCategoryStock } from '../utils/warehouseCategoryStock.js'
import UnwithdrawnDetailModal from '../components/common/UnwithdrawnDetailModal.jsx'
import PillToggle from '../components/common/PillToggle.jsx'
import CountUpNumber from '../components/common/CountUpNumber.jsx'

const CATEGORIES = ['Rice', 'Palay', 'By Products']
const BREAKDOWN_TABS = ['Breakdown', 'Age Grouping']

function AdminHomeStocks({ onWarehouseSelect }) {
  const { autoAgeMonitoring, weightUnit } = useSettings() ?? {}
  const [breakdownTab, setBreakdownTab] = useState('Breakdown')
  // { warehouseId, varietyIds, title, subtitle } for the unwithdrawn
  // drill-down modal, or null when closed.
  const [detailContext, setDetailContext] = useState(null)
  // Age Grouping's mobile card list: which warehouse+category rows are
  // expanded to show their full age-bucket breakdown, keyed as
  // `${warehouseId}::${cat}` since the same warehouse can appear under
  // more than one category. Collapsed by default - see the mobile card
  // row's own comment for why (Reveal: the breakdown is one tap away,
  // not gone).
  const [expandedAgeRows, setExpandedAgeRows] = useState(new Set())
  const toggleAgeRow = (key) => {
    setExpandedAgeRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Actual vs Potential inventory toggles - kept as two independent
  // states (not shared) since the top card and the Breakdown tab are
  // separate controls that shouldn't move together. Both always default
  // to Actual per explicit request, since that's what this page showed
  // before the unwithdrawn feature existed.
  const [topCardShowPotential, setTopCardShowPotential] = useState(false)
  const [breakdownShowPotential, setBreakdownShowPotential] = useState(false)

  // netBags is bags-of-50kg. When the toggle is set to MT, it converts
  // back to kilos (× 50, the confirmed inverse of bags = kilos / 50)
  // then to metric tons via the same fmtWeight used everywhere else in
  // the app, rather than staying in bags - bags is a count, not a
  // weight unit, so it has no MT equivalent of its own.
  const fmt = (netBags) => weightUnit === 'mt' ? fmtWeight(netBags * 50, 'mt') : fmtNetBags(netBags)
  // Reported, confirmed real bug: By Products figures on this page were
  // shown as "net bags" (kilos / 50) exactly like Rice/Palay, even
  // though By Products bags don't have a standard 50kg weight - the
  // figure shown here (e.g. "2,873.69") never matched the SAME
  // warehouse's own By Products total on HomeStocks.jsx (e.g. "3,149"
  // real bags), which is the actual, correct bag count. bags is the
  // real count (already reliable via resolveBags - see
  // unwithdrawnStock.js), kilos still converts to MT the same way
  // weight always does (that conversion is valid regardless of bag
  // weight, since it never goes through a bags-based figure).
  const fmtByProducts = (bags, kilos) => weightUnit === 'mt' ? fmtWeight(kilos, 'mt') : fmtBags(bags)

  const provinces = useLiveQuery(() => db.provinces.toArray(), []) ?? []
  // Confirmed, reported real bug: an NFA-owned Mechanical Dryer or
  // Ricemill is a fundamentally different kind of facility - it
  // doesn't hold warehouse stock, it's a milling/drying process stop
  // (see the warehouses table's own facilityType schema comment). A
  // ricemill with an AI authorized against it for milling was showing
  // up as its own "warehouse" card here, and its outstanding amount
  // was being subtracted from its province's Potential as if it were
  // ordinary warehouse-held stock. Filtered out once, here, so every
  // computation and listing below this line only ever sees real
  // warehouses - facilityType is unset ('Warehouse' is the implicit
  // default) on every record created before this field existed.
  const warehouses = (useLiveQuery(() => db.warehouses.toArray(), []) ?? [])
    .filter((w) => (w.facilityType ?? 'Warehouse') === 'Warehouse')
  const piles = useLiveQuery(() => db.piles.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyCategoryMap = new Map(varieties.map((v) => [v.varietyId, v.category]))

  // Single shared per-warehouse computation (see warehouseCategoryStock.js's
  // own top comment for why this replaced two separately-maintained
  // implementations that kept drifting apart) - warehouseId -> category
  // -> { actualBags, actualKilos, unwithdrawnBags, unwithdrawnKilos }.
  // Powers the Province table and Stock Breakdown section below; Age
  // Grouping still uses its own per-age-bucket computation further down
  // (a different shape - per bucket, not per warehouse total).
  const sackTypesForStock = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const warehouseCategoryStock = useLiveQuery(async () => {
    if (warehouses.length === 0) return new Map()
    const result = new Map()
    await Promise.all(warehouses.map(async (w) => {
      result.set(w.warehouseId, await computeWarehouseCategoryStock(w.warehouseId, { varieties, sackTypes: sackTypesForStock }))
    }))
    return result
  }, [warehouses, varieties, sackTypesForStock]) ?? new Map()

  // Age Grouping shows POTENTIAL (actual minus unwithdrawn) instead of
  // raw actual inventory - warehouseId -> category -> Map(bucketLabel
  // -> unwithdrawn net bags), same underlying computation, bucketed by
  // each AI's own ageGroup this time instead of collapsed to one total.
  const unwithdrawnAgeByWarehouse = useLiveQuery(async () => {
    const result = new Map()
    for (const w of warehouses) {
      result.set(w.warehouseId, await computeUnwithdrawnByCategoryAge(w.warehouseId, varietyCategoryMap))
    }
    return result
  }, [warehouses, varieties]) ?? new Map()

  const provinceMap = new Map(provinces.map((p) => [p.provinceId, p]))

  // Cutoff-aware current totals (respects each warehouse's own Reports
  // Start Date and the global Data Start Date override) instead of
  // pile.currentBags/currentKilos directly - see
  // computeCurrentPileStatesBatch's own comment for why this page
  // previously ignored that override entirely.
  const warehouseCutoffByWarehouseId = new Map(warehouses.map((w) => [w.warehouseId, w.reportingCutoffDate]))
  const pileStates = useLiveQuery(async () => {
    if (piles.length === 0) return new Map()
    return computeCurrentPileStatesBatch(piles, warehouseCutoffByWarehouseId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piles, warehouses]) ?? new Map()

  const enrichedPiles = piles.map((p) => {
    const state = pileStates.get(p.pileId)
    return {
      ...p,
      age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
      netBags: (state?.kilos ?? p.currentKilos ?? 0) / 50,
      // Real bag count - see fmtByProducts's own comment for why By
      // Products consumers need this instead of netBags.
      bags: state?.bags ?? p.currentBags ?? 0,
      kilos: state?.kilos ?? p.currentKilos ?? 0,
      // Reported, confirmed real bug: every category filter on this
      // page (riceActual/palayActual, the Stock Breakdown cards, Age
      // Grouping) read the pile's own stored cerealType field directly,
      // which can disagree with its variety's real category (the same
      // reason HomeStocks.jsx already resolves this via
      // `p.variety?.category ?? p.cerealType` instead of trusting the
      // pile field alone - see that file's own stockGroups comment). A
      // pile whose stored cerealType silently drifted from its
      // variety's own category was being counted as "actual" stock on
      // HomeStocks.jsx (which trusts the variety) but SILENTLY EXCLUDED
      // from this page's own Actual total (which didn't) - while the
      // unwithdrawn side (computeUnwithdrawnByVariety, keyed by
      // varietyId -> variety.category, never touches the pile's own
      // field at all) still counted it in full. That gap is exactly
      // what let a warehouse's own Potential on HomeStocks.jsx
      // (correctly positive) disagree with the Province-level overview
      // for the same warehouse (incorrectly clamped to 0) - confirmed,
      // reported case: Catanduanes Rice showing 434.72 on its own
      // warehouse page but 0 on the province overview. Falls back to
      // the pile's own field only when the variety can't be resolved at
      // all (the same case HomeStocks.jsx falls back for - a By
      // Products pile, whose own varietyId field is unreliable; see
      // pileLedger.js's own documentation of that gap).
      cerealType: varietyCategoryMap.get(p.varietyId) ?? p.cerealType ?? 'Unknown',
    }
  })

  const sortedProvinces = [...provinces].sort((a, b) => a.code.localeCompare(b.code))
  const sortedWarehouses = [...warehouses].sort((a, b) => a.name.localeCompare(b.name))

  // Computed once here (not separately inside the table/card render AND
  // the branch-total card below, as it previously was) so the total is
  // ALWAYS exactly the sum of what the rows above it actually show.
  // Reported, confirmed real bug: the branch total used to be
  // recomputed independently from the raw branch-wide actual/unwithdrawn
  // figures, which could come out LOWER than summing the displayed rows
  // whenever a single province's own potential went negative (more
  // unwithdrawn than actual, e.g. AIs authorized ahead of stock physically
  // arriving) - that province correctly clamps to 0 for display, but an
  // independent branch-wide computation still subtracted that province's
  // full (now-invisible) excess from the total, making Total < the
  // provinces' own displayed sum. Same reasoning already proven correct
  // and applied to the Age Grouping tab's own totals further down this
  // file - the fix here is identical: derive every total by summing the
  // already-clamped per-row values, never by recomputing independently.
  const provinceRows = sortedProvinces.map((province) => {
    const wIds = warehouses
      .filter((w) => w.provinceId === province.provinceId)
      .map((w) => w.warehouseId)
    const sumFor = (cat, field) => wIds.reduce((s, wId) => s + (warehouseCategoryStock.get(wId)?.get(cat)?.[field] ?? 0), 0)
    const riceActual = sumFor('Rice', 'actualKilos') / 50
    const palayActual = sumFor('Palay', 'actualKilos') / 50
    // Potential mode swaps the plain number for actual-minus-unwithdrawn,
    // no badge/tag - the enriched breakdown view lives only on the
    // Breakdown tab, not here.
    const riceValue = topCardShowPotential
      ? Math.max(0, riceActual - sumFor('Rice', 'unwithdrawnKilos') / 50)
      : riceActual
    const palayValue = topCardShowPotential
      ? Math.max(0, palayActual - sumFor('Palay', 'unwithdrawnKilos') / 50)
      : palayActual
    return { province, riceValue, palayValue }
  })
  const riceBranchValue = provinceRows.reduce((s, r) => s + r.riceValue, 0)
  const palayBranchValue = provinceRows.reduce((s, r) => s + r.palayValue, 0)

  return (
    <>
      <Section
        title={weightUnit === 'mt' ? 'Metric Tons by Province & Category' : 'Net Bags by Province & Category'}
        headerRight={(
          <PillToggle
            options={[{ value: false, label: 'Actual' }, { value: true, label: 'Potential' }]}
            value={topCardShowPotential}
            onChange={setTopCardShowPotential}
          />
        )}
      >
        {/* Keyed on both the weight unit and the Actual/Potential
            toggle, so switching either replays the entrance animation
            on the now-different figures instead of them silently
            swapping in place. */}
        <div key={`${weightUnit}-${topCardShowPotential}`} className="animate-flow-down">
        {sortedProvinces.length === 0 ? (
          <Empty />
        ) : (() => {
          // Computed once, rendered twice below (a plain table at sm+,
          // a card list under sm) - reported, real bug: the table's
          // whitespace-nowrap Rice/Palay columns had no room to breathe
          // on a real phone next to the Province column's own code+name
          // text, so the numbers ran close to (and visually read as
          // "almost out of bounds" against) the row's edge instead of
          // sitting aligned. Same six-move-method card treatment this
          // file already uses for the Age Grouping breakdown below -
          // Rank (the two figures ARE the point, shown big), Stack
          // (province name above, figures below instead of beside),
          // Breakpoint (table only renders where columns actually have
          // room).
          const unitLabel = weightUnit === 'mt' ? 'MT' : 'Net Bags'

          return (
            <>
              <div className="hidden sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-800">
                      <Th>Province</Th>
                      <Th right>Rice ({unitLabel})</Th>
                      <Th right>Palay ({unitLabel})</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {provinceRows.map(({ province, riceValue, palayValue }) => (
                      <tr key={province.provinceId} className="border-b border-neutral-800/50">
                        <Td>
                          <span className="font-medium text-app-text">{province.code}</span>
                          <span className="ml-1 text-xs text-neutral-500">{province.name}</span>
                        </Td>
                        <Td right><span className="text-base font-bold tabular-nums text-blue-400"><CountUpNumber value={riceValue} format={fmt} /></span></Td>
                        <Td right><span className="text-base font-bold tabular-nums text-brand-neon"><CountUpNumber value={palayValue} format={fmt} /></span></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2 sm:hidden">
                {provinceRows.map(({ province, riceValue, palayValue }) => (
                  <div key={province.provinceId} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-2.5">
                    <p className="text-sm font-medium text-app-text">
                      {province.code} <span className="text-xs text-neutral-500">{province.name}</span>
                    </p>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-neutral-500">Rice ({unitLabel})</p>
                        <p className="text-base font-bold tabular-nums text-blue-400"><CountUpNumber value={riceValue} format={fmt} /></p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-neutral-500">Palay ({unitLabel})</p>
                        <p className="text-base font-bold tabular-nums text-brand-neon"><CountUpNumber value={palayValue} format={fmt} /></p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        })()}
        {sortedProvinces.length > 0 && (() => {
          // riceBranchValue/palayBranchValue are the SUM of provinceRows'
          // own already-clamped values (computed once, above) - see that
          // computation's own comment for why this must never be
          // recomputed independently from the raw branch-wide figures.
          // Same card shape as each province card above (grid-cols-2,
          // Rice left/Palay right) so this reads as one more card in the
          // same stack instead of a visually distinct summary block - a
          // slightly brighter border is the only thing setting it apart.
          const unitLabel = weightUnit === 'mt' ? 'MT' : 'Net Bags'
          return (
            <>
              <div className="mt-2 hidden items-center justify-between rounded-lg border border-neutral-600 bg-neutral-950 px-3 py-2 sm:flex">
                <span className="text-sm font-bold uppercase tracking-wide text-app-text">Total</span>
                <div className="flex gap-8">
                  <span className="text-base font-bold tabular-nums text-blue-400"><CountUpNumber value={riceBranchValue} format={fmt} /></span>
                  <span className="text-base font-bold tabular-nums text-brand-neon"><CountUpNumber value={palayBranchValue} format={fmt} /></span>
                </div>
              </div>

              <div className="mt-2 rounded-lg border border-neutral-600 bg-neutral-950/50 p-2.5 sm:hidden">
                <p className="text-sm font-bold uppercase tracking-wide text-app-text">Total</p>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-neutral-500">Rice ({unitLabel})</p>
                    <p className="text-base font-bold tabular-nums text-blue-400"><CountUpNumber value={riceBranchValue} format={fmt} /></p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-neutral-500">Palay ({unitLabel})</p>
                    <p className="text-base font-bold tabular-nums text-brand-neon"><CountUpNumber value={palayBranchValue} format={fmt} /></p>
                  </div>
                </div>
              </div>
            </>
          )
        })()}
        </div>
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
      <Section
        title="Stock Breakdown — Warehouse & Category"
        headerRight={(
          <PillToggle
            options={[{ value: false, label: 'Actual' }, { value: true, label: 'Potential' }]}
            value={breakdownShowPotential}
            onChange={setBreakdownShowPotential}
          />
        )}
      >
        {/* Keyed on both the weight unit and this tab's own Actual/
            Potential toggle - see the top card's identical comment. */}
        <div key={`${weightUnit}-${breakdownShowPotential}`} className="animate-flow-down">
        {sortedWarehouses.length === 0 ? <Empty /> : (() => {
          // Per explicit request - grouped by province, one heading
          // above that province's own warehouses, instead of repeating
          // the province code on every single warehouse card. A
          // warehouse with nothing to show (see the per-warehouse skip
          // below) is filtered out BEFORE grouping, so a province with
          // every warehouse currently empty doesn't render a heading
          // over nothing.
          const hasVisibleStock = (warehouse) => {
            const wStock = warehouseCategoryStock.get(warehouse.warehouseId)
            return wStock && [...wStock.values()].some((c) => c.actualBags !== 0 || c.actualKilos !== 0 || c.unwithdrawnBags !== 0 || c.unwithdrawnKilos !== 0)
          }
          const provinceGroups = sortedProvinces
            .map((province) => ({
              province,
              provinceWarehouses: sortedWarehouses.filter((w) => w.provinceId === province.provinceId && hasVisibleStock(w)),
            }))
            .filter((g) => g.provinceWarehouses.length > 0)

          return (
            <div className="space-y-4">
              {provinceGroups.map(({ province, provinceWarehouses }) => (
                <div key={province.provinceId}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                    {province.code} <span className="font-medium normal-case text-neutral-600">{province.name}</span>
                  </p>
                  {/* Same boxed-card layout as the Province table above,
                      per explicit request - one tappable box per
                      warehouse (the whole box, not just a small pill
                      inside it) that opens that warehouse's own
                      Overview, same as tapping a warehouse name already
                      did elsewhere on this page (onWarehouseSelect). */}
                  <div className="space-y-2">
                    {provinceWarehouses.map((warehouse) => {
                      const wStock = warehouseCategoryStock.get(warehouse.warehouseId)
                      return (
                        <div
                          key={warehouse.warehouseId}
                          role="button"
                          tabIndex={0}
                          onClick={() => onWarehouseSelect?.(warehouse)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onWarehouseSelect?.(warehouse) }}
                          className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-950/50 p-2.5 transition-all hover:border-brand-neon/50 active:scale-[0.99]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-base font-bold text-app-text">
                              {stripWarehouseCodePrefix(warehouse.name)}
                            </p>
                            <ChevronRight size={16} className="shrink-0 text-neutral-600" />
                          </div>
                          <div className="mt-2 space-y-2">
                            {CATEGORIES.map((cat) => {
                              const isByProducts = cat === 'By Products'
                              const catStock = wStock.get(cat)
                              const sumBags = catStock?.actualBags ?? 0
                              const sumKilos = catStock?.actualKilos ?? 0
                              const sum = sumKilos / 50
                              const unwithdrawnBags = catStock?.unwithdrawnBags ?? 0
                              const unwithdrawnKilos = catStock?.unwithdrawnKilos ?? 0
                              const unwithdrawnNetBags = unwithdrawnKilos / 50
                              // Same reasoning as the card-level filter above -
                              // a category with real unwithdrawn stock but zero
                              // actual (nothing received into a pile yet) still
                              // needs to show, not disappear as if there were
                              // nothing to report for it.
                              if (sumBags === 0 && sumKilos === 0 && unwithdrawnBags === 0 && unwithdrawnKilos === 0) return null
                              const colorClass = cat === 'Rice' ? 'text-blue-400' : cat === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'
                              // Guard against a rounds-to-zero badge (see HomeStocks.jsx
                              // for the same reasoning) - only flag rows with a
                              // genuinely meaningful unwithdrawn amount.
                              const hasUnwithdrawn = breakdownShowPotential && (isByProducts ? unwithdrawnBags >= 1 : unwithdrawnNetBags >= 0.005)
                              // Reported, real bug: the toggle above claims
                              // "Potential" but the headline figure never
                              // actually changed - it always showed the plain
                              // actual total regardless of which pill was
                              // selected, with the unwithdrawn/potential detail
                              // only ever appearing as a small, easy-to-miss
                              // annotation underneath. The headline itself now
                              // switches to the real potential (actual minus
                              // unwithdrawn) when that toggle is on, matching
                              // the Province table above it.
                              const displayValue = breakdownShowPotential
                                ? (isByProducts ? Math.max(0, sumBags - unwithdrawnBags) : Math.max(0, sum - unwithdrawnNetBags))
                                : (isByProducts ? sumBags : sum)
                              const displayKilos = breakdownShowPotential ? Math.max(0, sumKilos - unwithdrawnKilos) : sumKilos
                              const catVarietyIds = varieties.filter((v) => v.category === cat).map((v) => v.varietyId)
                              return (
                                <div key={cat} className="flex items-center justify-between gap-2">
                                  <span className={`text-sm font-semibold ${colorClass}`}>{cat}</span>
                                  <div className="text-right">
                                    <span className={`text-lg font-bold tabular-nums ${colorClass}`}>
                                      {isByProducts
                                        ? <CountUpNumber value={displayValue} format={(v) => fmtByProducts(v, displayKilos)} />
                                        : <CountUpNumber value={displayValue} format={fmt} />}
                                    </span>
                                    {hasUnwithdrawn && (
                                      <div className="mt-0.5 flex items-center justify-end gap-1.5">
                                        {/* stopPropagation - this sits inside the
                                            card's own click-to-navigate area, but
                                            opens the Unwithdrawn detail instead,
                                            not the warehouse Overview. */}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setDetailContext({
                                              warehouseId: warehouse.warehouseId,
                                              varietyIds: catVarietyIds,
                                              title: `${cat} — Unwithdrawn`,
                                              subtitle: `${province.code} · ${stripWarehouseCodePrefix(warehouse.name)}`,
                                              rawBags: isByProducts,
                                            })
                                          }}
                                          className="whitespace-nowrap rounded-md bg-red-400/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-red-400 transition-colors hover:bg-red-400/25 active:scale-95"
                                        >
                                          {isByProducts ? fmtBags(unwithdrawnBags) : fmt(unwithdrawnNetBags)} unwithdrawn
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
        </div>
      </Section>
      )}

      {breakdownTab === 'Age Grouping' && (() => {
        // Computed once per warehouse and reused for both the body rows
        // AND the footer/branch totals, so any total is always exactly
        // the sum of what's actually displayed above it. Recomputing a
        // total independently from raw actual/unwithdrawn sums went
        // wrong whenever a warehouse's own unwithdrawn amount for a
        // bucket exceeded its actual stock there - that row clamps to 0
        // and silently drops the excess, but an independently-computed
        // total would still subtract that full excess from the
        // aggregate, producing a total lower than the rows summed to.
        const computeRows = (scopeWarehouses, cat) => {
          const buckets = AGE_BUCKETS[cat] ?? AGE_BUCKETS.Rice
          const rows = scopeWarehouses
            .map((warehouse) => {
              const wCatPiles = enrichedPiles.filter(
                (p) => p.warehouseId === warehouse.warehouseId && p.cerealType === cat
              )
              if (wCatPiles.length === 0) return null
              const bucketTotals = buckets.map((b) => {
                const actual = wCatPiles.filter((p) => b.test(p.age)).reduce((s, p) => s + p.netBags, 0)
                const uw = unwithdrawnAgeByWarehouse.get(warehouse.warehouseId)?.get(cat)?.get(b.label) ?? 0
                return Math.max(0, actual - uw)
              })
              // Unwithdrawn stock whose age couldn't be determined (no
              // parseable ageGroup) can't be attributed to one specific
              // bucket column - only reduces the row total.
              const unspecified = unwithdrawnAgeByWarehouse.get(warehouse.warehouseId)?.get(cat)?.get(UNSPECIFIED_AGE) ?? 0
              const total = Math.max(0, bucketTotals.reduce((a, b) => a + b, 0) - unspecified)
              return { warehouse, bucketTotals, total }
            })
            .filter(Boolean)
          const columnTotals = buckets.map((_, i) => rows.reduce((s, r) => s + r.bucketTotals[i], 0))
          const grandTotal = rows.reduce((s, r) => s + r.total, 0)
          return { buckets, rows, columnTotals, grandTotal }
        }
        const catColor = (cat) => cat === 'Rice' ? 'text-blue-400' : cat === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'

        return (
        <Section title="Stock Age Grouping">
          <p className="mb-3 text-xs text-neutral-500">
            Potential stock (actual minus unwithdrawn AI-authorized stock), not raw actual inventory.
          </p>

          {/* Keyed on the weight unit, same reasoning as the top card
              and Breakdown tab above - this tab has no Actual/Potential
              toggle of its own (it always shows potential), but its
              figures still change when KG/MT is switched. */}
          <div key={weightUnit} className="animate-flow-down">

          {/* Total Branch - per-cereal, per-age-group totals aggregated
              across every province, shown before the province breakdown.
              A plain flex strip, not a table - there is only ever one
              row of values here (the branch total), so a table's column-
              stretching behavior (which needed a whole extra anchor
              column to counteract on a wide screen) was solving a
              problem this layout does not need to have at all. Each
              stat sizes to its own content and gap-controlled spacing
              stays tight and even regardless of viewport width. */}
          <div className="mb-6 rounded-xl border border-brand-neon/30 bg-brand-neon/5 p-3">
            <p className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-neon">Total Branch</p>
            {CATEGORIES.map((cat) => {
              const { buckets, columnTotals, grandTotal } = computeRows(sortedWarehouses, cat)
              if (grandTotal === 0 && columnTotals.every((v) => v === 0)) return null
              return (
                <div key={cat} className="mt-2 first:mt-0">
                  <p className={`mb-1.5 text-sm font-bold uppercase ${catColor(cat)}`}>{cat}</p>
                  {/* 2 columns on mobile, 4 on sm+ - fixing this at 4
                      columns unconditionally (the previous attempt) was
                      what squeezed each tile too narrow for its own
                      number on a phone, forcing truncate to clip real
                      values (unacceptable - every figure has to stay
                      fully visible). At 2 columns, tiles simply wrap
                      into extra rows instead of getting squeezed, so
                      nothing needs clipping at any width. The invisible
                      spacer only renders at sm+ (a 2-bucket category
                      like Rice has no 3rd bucket to fill that slot) so
                      Total stays pinned to the last cell of the row on
                      desktop; on mobile the spacer is dropped entirely
                      and Total just starts its own fresh row via normal
                      DOM-order wrapping, which needs no special pinning
                      since there is no shared row to align across. */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {buckets.map((b, i) => (
                      <div key={b.label} className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-2.5 py-2">
                        <p className="text-xs uppercase text-neutral-500">{b.label.replace(/\s*months?$/i, '')}</p>
                        <p className={`text-base font-semibold tabular-nums ${catColor(cat)}`}><CountUpNumber value={columnTotals[i]} format={fmt} /></p>
                      </div>
                    ))}
                    {buckets.length < 3 && <div className="hidden sm:block" aria-hidden="true" />}
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-2.5 py-2">
                      <p className="text-xs uppercase text-neutral-500">Total</p>
                      <p className={`text-base font-bold tabular-nums ${catColor(cat)}`}><CountUpNumber value={grandTotal} format={fmt} /></p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {sortedProvinces.length === 0 ? <Empty /> : (
            <div className="space-y-4">
              {sortedProvinces.map((province) => {
                const provinceWarehouses = sortedWarehouses.filter(
                  (w) => w.provinceId === province.provinceId
                )
                if (provinceWarehouses.length === 0) return null
                return (
                  <div key={province.provinceId} className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
                    <p className="mb-2 text-base font-semibold text-app-text">
                      {province.code} — {province.name}
                    </p>
                    {CATEGORIES.map((cat) => {
                      const hasData = provinceWarehouses.some((w) =>
                        enrichedPiles.some(
                          (p) => p.warehouseId === w.warehouseId && p.cerealType === cat
                        )
                      )
                      if (!hasData) return null
                      const { buckets, rows, columnTotals, grandTotal } = computeRows(provinceWarehouses, cat)
                      return (
                        <div key={cat} className="mt-3 first:mt-0">
                          <p className={`mb-1 text-base font-bold uppercase ${catColor(cat)}`}>
                            {cat}
                          </p>
                          {/* Two renders of the same rows, not one table
                              trying to serve both: sm+ keeps the plain
                              table (every bucket column has room to
                              breathe at that width), below sm switches to
                              a tap-to-expand card per warehouse - see this
                              block's own README-style comment further
                              down for the full "six moves" reasoning. */}
                          <div className="hidden overflow-x-auto sm:block">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-neutral-800">
                                  <Th>Warehouse</Th>
                                  {buckets.map((b) => <Th key={b.label} right>{b.label.replace(/\s*months?$/i, '')}</Th>)}
                                  <Th right>Total</Th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(({ warehouse, bucketTotals, total }) => (
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
                                    {bucketTotals.map((val, i) => <Td key={i} right><span className="tabular-nums"><CountUpNumber value={val} format={fmt} /></span></Td>)}
                                    <Td right>
                                      <span className={`font-semibold tabular-nums ${catColor(cat)}`}>
                                        <CountUpNumber value={total} format={fmt} />
                                      </span>
                                    </Td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-neutral-700">
                                  <Td><span className="font-bold text-app-text">Total</span></Td>
                                  {columnTotals.map((val, i) => (
                                    <Td key={i} right>
                                      <span className={`font-bold tabular-nums ${catColor(cat)}`}><CountUpNumber value={val} format={fmt} /></span>
                                    </Td>
                                  ))}
                                  <Td right>
                                    <span className={`font-bold tabular-nums ${catColor(cat)}`}>
                                      <CountUpNumber value={grandTotal} format={fmt} />
                                    </span>
                                  </Td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>

                          {/* Below sm: the same "many age columns squeezed
                              onto one line" table was the actual reported
                              problem (real figures getting clipped at the
                              edge, not just needing a scroll) - restructured
                              per the six-move method instead of shrinking
                              further:
                              Rank   - Total is the headline, the full
                                       per-bucket breakdown is secondary.
                              Stack  - warehouse name + Total on one line,
                                       breakdown below instead of beside.
                              Slot   - Total always sits in the same spot
                                       (top-right of the row) on every card.
                              Label  - each bucket keeps a short unit ("mo")
                                       once it's off a shared column header.
                              Reveal - the full breakdown isn't gone, it's
                                       one tap away (expand in place), never
                                       a separate page.
                              Breakpoint - this card list only renders below
                                       sm; the plain table above still
                                       renders at sm+, where the columns
                                       have room. */}
                          <div className="space-y-2 sm:hidden">
                            {rows.map(({ warehouse, bucketTotals, total }) => {
                              const rowKey = `${warehouse.warehouseId}::${cat}`
                              const isExpanded = expandedAgeRows.has(rowKey)
                              // Last bucket is always the oldest (see
                              // AGE_BUCKETS - every category's list is
                              // ordered youngest to oldest) - stock sitting
                              // there is the one figure worth surfacing
                              // even before the row is expanded, since
                              // ageing stock is a real spoilage signal,
                              // not just another number.
                              const oldestIdx = buckets.length - 1
                              const oldestAmount = bucketTotals[oldestIdx]
                              const hasOldStock = oldestAmount > 0
                              return (
                                <div key={warehouse.warehouseId} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => onWarehouseSelect?.(warehouse)}
                                      className="flex min-w-0 items-center gap-1 text-base font-medium text-app-text transition-colors hover:text-brand-neon"
                                    >
                                      {hasOldStock && (
                                        <span className="mr-0.5 h-2 w-2 shrink-0 rounded-full bg-red-400" aria-hidden="true" />
                                      )}
                                      <span className="truncate">{warehouse.name}</span>
                                      <ChevronRight size={14} className="shrink-0 text-neutral-600" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => toggleAgeRow(rowKey)}
                                      aria-label={isExpanded ? 'Hide age breakdown' : 'Show age breakdown'}
                                      aria-expanded={isExpanded}
                                      className="flex shrink-0 items-center gap-1 active:scale-95"
                                    >
                                      <span className={`text-lg font-bold tabular-nums ${catColor(cat)}`}><CountUpNumber value={total} format={fmt} /></span>
                                      <ChevronDown size={16} className={`text-neutral-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                  </div>
                                  {hasOldStock && (
                                    <p className="mt-1 text-sm tabular-nums text-red-400">
                                      {fmt(oldestAmount)} at {buckets[oldestIdx].label.replace(/\s*months?$/i, '')} mo
                                    </p>
                                  )}
                                  {isExpanded && (
                                    <div className="mt-2 grid grid-cols-3 gap-2 border-t border-neutral-800 pt-2">
                                      {buckets.map((b, i) => (
                                        <div key={b.label} className="rounded-md bg-neutral-900 px-2 py-1.5">
                                          <p className="text-xs uppercase text-neutral-500">{b.label.replace(/\s*months?$/i, '')} mo</p>
                                          <p className="text-base font-semibold tabular-nums text-app-text"><CountUpNumber value={bucketTotals[i]} format={fmt} /></p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                            <div className="flex items-center justify-between border-t-2 border-neutral-700 pt-2">
                              <span className="text-base font-bold text-app-text">Total</span>
                              <span className={`text-lg font-bold tabular-nums ${catColor(cat)}`}><CountUpNumber value={grandTotal} format={fmt} /></span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
          </div>
        </Section>
        )
      })()}
      {detailContext && (
        <UnwithdrawnDetailModal
          warehouseId={detailContext.warehouseId}
          varietyIds={detailContext.varietyIds}
          title={detailContext.title}
          subtitle={detailContext.subtitle}
          rawBags={detailContext.rawBags}
          onClose={() => setDetailContext(null)}
        />
      )}
    </>
  )
}

export default AdminHomeStocks
