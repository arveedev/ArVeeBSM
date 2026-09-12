// Home Piles list — tap a pile to open the WSR/WSI/WTS action menu, tap
// its age to edit it directly. Pile card layout: Pile Name + Age on row
// 1; bags (prominent) + net bags (subtext) on the left of row 2, net
// kilos + avg weight/bag on the right.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, calculateNetBags, calculateAverageWeightPerBag, fmtBags, fmtWeight, fmtNetBags, fmtAge, ageGradientColor } from '../utils/calculations.js'
import { computePileStockBreakdown } from '../utils/pileLedger.js'
import { formatPileStockGroups, groupHeading, fmtGroupDate } from '../utils/pileStockGroups.js'
import PileActionSheet from '../components/common/PileActionSheet.jsx'
import EditPileAgeDialog from '../components/common/EditPileAgeDialog.jsx'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

// Same category colors used elsewhere (AuthorityPickerModal's own
// categoryColor) - applied here as a filled badge instead of plain
// text so a pile's variety is actually noticeable at a glance, not
// just small gray text easy to skim past.
const varietyBadgeClass = (category) => {
  if (category === 'Rice') return 'bg-blue-500/15 text-blue-400'
  if (category === 'Palay') return 'bg-brand-neon/15 text-brand-neon'
  if (category === 'By Products') return 'bg-brand-byproduct/15 text-brand-byproduct'
  return 'bg-neutral-800 text-neutral-300'
}

// Left accent bar color, matched to the pile's own cereal type - same
// mapping as varietyBadgeClass above, replacing an earlier icon-badge
// idea (dropped per explicit request - it didn't suit the card).
const accentBarClass = (cerealType) => {
  if (cerealType === 'Rice') return 'bg-blue-500'
  if (cerealType === 'Palay') return 'bg-brand-neon'
  if (cerealType === 'By Products') return 'bg-brand-byproduct'
  return 'bg-neutral-700'
}

function HomePiles() {
  const { autoAgeMonitoring, weightUnit } = useSettings() ?? {}
  const { currentWarehouseId } = useWarehouse() ?? {}

  const [openMenuPileId, setOpenMenuPileId] = useState(null)
  const [editingAgePile, setEditingAgePile] = useState(null)
  // Which Rice/Palay piles have their breakdown expanded - By Products
  // always shows its breakdown (no collapse), so this only ever gates
  // Rice/Palay's optional expand-arrow.
  const [expandedPileIds, setExpandedPileIds] = useState(() => new Set())
  const toggleExpanded = (pileId) => setExpandedPileIds((prev) => {
    const next = new Set(prev)
    if (next.has(pileId)) next.delete(pileId)
    else next.add(pileId)
    return next
  })
  // Separate from expandedPileIds above (that one gates the Rice/Palay
  // multi-group sack-weight breakdown). This gates the plain Bags/Net Kg
  // tile pair's own tap-to-reveal subtext (net bags under Bags, kg/bag
  // avg under Net Kg) - a distinct, always-available interaction on
  // every pile's primary summary, not tied to whether it has multiple
  // sack-weight groups.
  const [openTilePileIds, setOpenTilePileIds] = useState(() => new Set())
  const toggleTiles = (pileId) => setOpenTilePileIds((prev) => {
    const next = new Set(prev)
    if (next.has(pileId)) next.delete(pileId)
    else next.add(pileId)
    return next
  })

  const piles = useLiveQuery(async () => {
    if (!currentWarehouseId) return []
    return db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
  }, [currentWarehouseId]) ?? []

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

  // Same batched-per-warehouse breakdown pattern as Piles.jsx - see
  // computePileStockBreakdown's own doc comment for why this exists
  // (a pile's flat currentBags/currentKilos/varietyId fields can't
  // reflect a mix of sack weights/conditions or - for By Products -
  // varieties).
  const pileIdsKey = piles.map((p) => p.pileId).sort().join(',')
  const breakdownMap = useLiveQuery(async () => {
    if (piles.length === 0) return new Map()
    const entries = await Promise.all(
      piles.map(async (p) => [p.pileId, await computePileStockBreakdown(p.pileId, '9999-12-31', null, sackTypes)])
    )
    return new Map(entries)
  }, [pileIdsKey, sackTypes]) ?? new Map()

  const pileList = [...piles].sort((a, b) => byAlpha(a.pileName, b.pileName))
  const enrichedPiles = pileList.map((p) => {
    const raw = breakdownMap.get(p.pileId) ?? []
    const groupRows = raw.length > 1 ? formatPileStockGroups(raw, { varietyMap, sackTypeMap, cerealType: p.cerealType }) : []
    return {
      ...p,
      age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
      variety: varietyMap.get(p.varietyId),
      groupRows,
    }
  })

  const handlePileAction = (pile, type) => {
    setOpenMenuPileId(null)
    if (typeof window.openTransactionForm === 'function') {
      window.openTransactionForm(type, { pileId: pile.pileId, varietyId: pile.varietyId })
    }
  }

  return (
    <div className="mt-4">
      <p className="text-xs text-neutral-500">Tap a pile to record a receipt or issuance.</p>

      {pileList.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          No piles recorded for this facility yet.
        </p>
      ) : (
        <>
          {/* Shown once for the whole list, not repeated per pile/
              warehouse - a generic newest/oldest convention, deliberately
              with no numbers on it, since the actual scale a pile's color
              is computed against differs by cereal type (see
              ageGradientColor/AGE_GRADIENT_MAX_DAYS - Rice and By
              Products max out at 6 months, Palay at 24, reflecting their
              genuinely different shelf lives). */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] text-neutral-600">newest</span>
            <div
              className="h-1 flex-1 rounded-full"
              style={{ background: 'linear-gradient(90deg, rgb(0,255,163), rgb(250,204,21), rgb(245,158,11), rgb(239,68,68))' }}
            />
            <span className="text-[10px] text-neutral-600">oldest</span>
          </div>

          <ul className="mt-2 space-y-2">
            {enrichedPiles.map((p) => {
              const netBags = calculateNetBags(p.currentKilos ?? 0)
              const avgWeight = calculateAverageWeightPerBag(p.currentKilos ?? 0, p.currentBags ?? 0)
              const isByProducts = p.cerealType === 'By Products'
              const isMultiGroup = p.groupRows.length > 1
              // By Products always lists every group, no collapsed total -
              // the variety mix IS the point. Rice/Palay keeps its plain
              // summary and gets an optional expand arrow instead.
              const isExpanded = expandedPileIds.has(p.pileId)
              const totalBags = p.groupRows.reduce((sum, r) => sum + r.bags, 0)
              const totalKilos = p.groupRows.reduce((sum, r) => sum + r.kilos, 0)
              const tilesOpen = openTilePileIds.has(p.pileId)
              const ageColor = ageGradientColor(p.age, p.cerealType)

              return (
                <li key={p.pileId} className="relative">
                  <div className="flex overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                    <div className={`w-1 shrink-0 ${accentBarClass(p.cerealType)}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenMenuPileId(p.pileId)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-base font-medium text-app-text transition-opacity active:opacity-70"
                        >
                          <span className="truncate">{p.pileName}</span>
                          {p.variety && (
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-semibold ${varietyBadgeClass(p.variety.category)}`}>
                              {p.variety.name}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingAgePile({ pile: p, age: p.age })}
                          className="shrink-0 whitespace-nowrap rounded-md px-1 py-0.5 text-sm font-bold tabular-nums transition-opacity active:opacity-70"
                          style={{ color: ageColor }}
                        >
                          {fmtAge(p.age)}
                        </button>
                      </div>

                      {isByProducts && isMultiGroup ? (
                        <div className="mt-2 space-y-2">
                          {p.groupRows.map((row) => (
                            <div key={row.key} className="border-t border-neutral-800 pt-1.5">
                              <p className="text-sm font-semibold text-brand-byproduct">{groupHeading(row)}</p>
                              {row.lastReceivedDate && (
                                <div className="flex justify-between text-sm text-neutral-400">
                                  <span>Received</span>
                                  <span className="text-app-text">{fmtGroupDate(row.lastReceivedDate)}</span>
                                </div>
                              )}
                              <div className="flex justify-between text-base tabular-nums">
                                <span className="text-neutral-400">Bags</span>
                                <span className="font-medium text-app-text">{fmtBags(row.bags)}</span>
                              </div>
                              <div className="flex justify-between text-base tabular-nums">
                                <span className="text-neutral-400">Net Kg</span>
                                <span className="font-medium text-app-text">{fmtWeight(row.kilos, weightUnit)}</span>
                              </div>
                            </div>
                          ))}
                          <div className="border-t-2 border-brand-byproduct pt-1.5">
                            <div className="flex justify-between text-base tabular-nums">
                              <span className="font-bold text-brand-byproduct">TOTAL Bags</span>
                              <span className="font-bold text-app-text">{fmtBags(totalBags)}</span>
                            </div>
                            <div className="flex justify-between text-base tabular-nums">
                              <span className="font-bold text-brand-byproduct">TOTAL Net Kg</span>
                              <span className="font-bold text-app-text">{fmtWeight(totalKilos, weightUnit)}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => toggleTiles(p.pileId)}
                              className="rounded-lg bg-neutral-950 px-2.5 py-2 text-center transition-colors active:bg-neutral-800"
                            >
                              <p className="text-[10px] uppercase text-neutral-500">Bags</p>
                              <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtBags(p.currentBags ?? 0)}</p>
                              {tilesOpen && (
                                <div className="mt-1.5 border-t border-neutral-800 pt-1.5">
                                  <p className="text-sm font-semibold tabular-nums text-neutral-300">{fmtNetBags(netBags)}</p>
                                  <p className="text-[10px] uppercase text-neutral-500">net bags</p>
                                </div>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleTiles(p.pileId)}
                              className="rounded-lg bg-neutral-950 px-2.5 py-2 text-center transition-colors active:bg-neutral-800"
                            >
                              <p className="text-[10px] uppercase text-neutral-500">Net Kg</p>
                              <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtWeight(p.currentKilos ?? 0, weightUnit)}</p>
                              {tilesOpen && (
                                <div className="mt-1.5 border-t border-neutral-800 pt-1.5">
                                  <p className="text-sm font-semibold tabular-nums text-neutral-300">{avgWeight.toFixed(2)}</p>
                                  <p className="text-[10px] uppercase text-neutral-500">kg / bag avg</p>
                                </div>
                              )}
                            </button>
                          </div>
                          {isMultiGroup && (
                            <>
                              <button
                                type="button"
                                onClick={() => toggleExpanded(p.pileId)}
                                className="mt-1 flex w-full justify-center py-0.5"
                                aria-label={isExpanded ? 'Hide sack-weight breakdown' : 'Show sack-weight breakdown'}
                              >
                                <ChevronDown size={16} className={`text-brand-neon transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                              {isExpanded && (
                                <div className="space-y-2">
                                  {p.groupRows.map((row) => (
                                    <div key={row.key} className="border-t border-neutral-800 pt-1.5">
                                      <p className="text-sm font-semibold text-brand-neon">{groupHeading(row)}</p>
                                      <div className="flex justify-between text-base tabular-nums">
                                        <span className="text-neutral-400">Bags</span>
                                        <span className="font-medium text-app-text">{fmtBags(row.bags)}</span>
                                      </div>
                                      <div className="flex justify-between text-base tabular-nums">
                                        <span className="text-neutral-400">Net Kg</span>
                                        <span className="font-medium text-app-text">{fmtWeight(row.kilos, weightUnit)}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {openMenuPileId === p.pileId && (
                    <PileActionSheet
                      onSelect={(type) => handlePileAction(p, type)}
                      onClose={() => setOpenMenuPileId(null)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {editingAgePile && (
        <EditPileAgeDialog
          pile={editingAgePile.pile}
          currentAge={editingAgePile.age}
          onClose={() => setEditingAgePile(null)}
        />
      )}
    </div>
  )
}

export default HomePiles
