// Home Stocks tab — grouped by cereal type -> variety -> age bucket.
// Each age-bucket row within a variety is that bucket's own subtotal;
// each variety gets its own subtotal summed across its age buckets;
// each cereal type gets one Total summed across all its varieties. No
// grand total across cereal types (Rice + Palay bags is not a
// meaningful sum). Palay is green, Rice is blue throughout, with a
// clear divider between the two sections.
//
// Age buckets are always rendered in their canonical chronological
// order (0-6, 6.1-12, >12 for Palay; 0-3, >3 for Rice) - matched
// against AGE_BUCKETS' own array position, NOT the object's insertion
// order, which depends on whatever order piles happen to come back
// from the database query and previously caused buckets to appear out
// of sequence (e.g. "6.1-12 months" before "0-6 months").

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, fmtBags, fmtWeight, fmtNetBags, AGE_BUCKETS } from '../utils/calculations.js'
import { computeUnwithdrawnByVariety } from '../utils/unwithdrawnStock.js'
import UnwithdrawnDetailModal from '../components/common/UnwithdrawnDetailModal.jsx'

function SummaryCard({ label, value, sub = false }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={sub ? 'mt-1 text-lg font-medium text-neutral-300' : 'mt-1 text-2xl font-semibold text-app-text'}>
        {value}
      </p>
    </div>
  )
}

const categoryColor = (cerealType) =>
  cerealType === 'Rice' ? 'text-blue-400' : cerealType === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'

/** Sorts age-bucket labels into their canonical chronological order for
 * this cereal type, rather than object insertion order. Falls back to
 * the end of the list for a label that (unexpectedly) isn't in
 * AGE_BUCKETS, rather than crashing on a missing lookup. */
// The unwithdrawn/potential figures must track whichever unit the row
// itself is currently displaying (Bags vs Net Bags), and must never show
// a badge that rounds down to "0" (a few stray kilos of unwithdrawn
// stock rounding to 0.00 net bags isn't worth flagging - the whole point
// is only surfacing rows that genuinely still have something unwithdrawn).
const unwithdrawnAmount = (unwithdrawn, showNetBags) => {
  if (!unwithdrawn) return 0
  return showNetBags ? unwithdrawn.kilos / 50 : unwithdrawn.bags
}
const formatAmount = (amount, showNetBags) => (showNetBags ? fmtNetBags(amount) : fmtBags(amount))

const sortBucketEntries = (cerealType, entries) => {
  const order = (AGE_BUCKETS[cerealType] ?? AGE_BUCKETS.Rice).map((b) => b.label)
  return [...entries].sort(([a], [b]) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi)
  })
}

function HomeStocks({ warehouseId } = {}) {
  const { autoAgeMonitoring, weightUnit } = useSettings() ?? {}
  const { currentWarehouseId: contextWarehouseId } = useWarehouse() ?? {}
  const currentWarehouseId = warehouseId ?? contextWarehouseId
  // Toggles the middle column between showing bags count or net bags -
  // net bags is not shown by default, kept out of view until the user
  // explicitly asks for it, for a cleaner default look.
  const [showNetBags, setShowNetBags] = useState(false)
  // { varietyIds, title, subtitle } for the unwithdrawn drill-down modal,
  // or null when closed.
  const [detailContext, setDetailContext] = useState(null)

  const piles = useLiveQuery(async () => {
    if (!currentWarehouseId) return []
    return db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
  }, [currentWarehouseId]) ?? []

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))
  const unwithdrawnMap = useLiveQuery(
    () => computeUnwithdrawnByVariety(currentWarehouseId),
    [currentWarehouseId]
  ) ?? new Map()

  const enrichedPiles = piles.map((p) => ({
    ...p,
    age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
    variety: varietyMap.get(p.varietyId),
  }))

  // First pass: for each variety, collect every distinct MTS weight in
  // use across its piles - only varieties with genuinely more than one
  // distinct weight need separating at all. A variety using a single
  // sack condition throughout (the common case) stays as one plain-
  // named line, exactly as before this feature existed.
  const weightsByVariety = new Map()
  for (const p of enrichedPiles) {
    const varietyName = p.variety?.name ?? '—'
    const mtsWeight = sackTypeMap.get(p.mtsSackTypeId)?.weights?.[p.mtsCondition]
    if (mtsWeight == null) continue
    if (!weightsByVariety.has(varietyName)) weightsByVariety.set(varietyName, new Set())
    weightsByVariety.get(varietyName).add(mtsWeight)
  }

  // cerealType -> displayLabel -> ageBucketLabel -> { bags, kilos }
  // displayLabel is "varietyName (mtsWeight)" only when that variety
  // has more than one distinct weight in use - otherwise just the
  // plain variety name, merging everything into one line as usual.
  const stockGroups = {}
  // cerealType -> groupLabel -> varietyId, so the unwithdrawn-stock
  // lookup (keyed by varietyId) can be joined back onto each rendered
  // variety row below.
  const groupVarietyId = {}
  for (const p of enrichedPiles) {
    const cerealType = p.variety?.category ?? p.cerealType ?? 'Unknown'
    const varietyName = p.variety?.name ?? '—'
    const mtsWeight = sackTypeMap.get(p.mtsSackTypeId)?.weights?.[p.mtsCondition]
    const needsSeparation = cerealType !== 'By Products' && (weightsByVariety.get(varietyName)?.size ?? 0) > 1
    const groupLabel = needsSeparation && mtsWeight != null ? `${varietyName} (${mtsWeight.toFixed(3)})` : varietyName
    const buckets = AGE_BUCKETS[cerealType] ?? AGE_BUCKETS.Rice
    const bucket = buckets.find((b) => b.test(p.age)) ?? buckets[buckets.length - 1]

    stockGroups[cerealType] ??= {}
    stockGroups[cerealType][groupLabel] ??= {}
    stockGroups[cerealType][groupLabel][bucket.label] ??= { bags: 0, kilos: 0 }
    stockGroups[cerealType][groupLabel][bucket.label].bags += p.currentBags ?? 0
    stockGroups[cerealType][groupLabel][bucket.label].kilos += p.currentKilos ?? 0

    groupVarietyId[cerealType] ??= {}
    groupVarietyId[cerealType][groupLabel] = p.varietyId
  }

  const totalBags = piles.reduce((sum, p) => sum + (p.currentBags ?? 0), 0)
  const totalKilos = piles.reduce((sum, p) => sum + (p.currentKilos ?? 0), 0)
  const totalNetBags = totalKilos / 50

  const hasStocks = Object.keys(stockGroups).length > 0

  if (!hasStocks) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SummaryCard label="Total Bags" value={fmtBags(totalBags)} />
        <SummaryCard label={weightUnit === 'mt' ? 'Total Net (MT)' : 'Total Net Bags'} value={weightUnit === 'mt' ? fmtWeight(totalKilos, 'mt') : fmtNetBags(totalNetBags)} sub />
      </div>
    )
  }

  // A cereal type/variety fully drawn down to 0 bags/kilos should stop
  // showing up here rather than lingering as an empty card.
  const groupTotals = (byVariety) => {
    const vals = Object.values(byVariety).flatMap((v) => Object.values(v))
    return { bags: vals.reduce((s, v) => s + v.bags, 0), kilos: vals.reduce((s, v) => s + v.kilos, 0) }
  }
  const sortedGroups = Object.entries(stockGroups)
    .filter(([, byVariety]) => { const t = groupTotals(byVariety); return t.bags > 0 || t.kilos > 0 })
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <>
    <div className="relative mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <span className="text-xs text-neutral-500">{showNetBags ? 'Net Bags' : 'Bags'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={showNetBags}
          onClick={() => setShowNetBags((v) => !v)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${showNetBags ? 'bg-brand-neon' : 'bg-neutral-700'}`}
        >
          <span
            className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
            style={{ transform: showNetBags ? 'translateX(16px)' : 'translateX(0)' }}
          />
        </button>
      </div>
      {sortedGroups.map(([cerealType, byVariety], i) => {
        const cerealBags = Object.values(byVariety)
          .flatMap((v) => Object.values(v))
          .reduce((s, v) => s + v.bags, 0)
        const cerealKilos = Object.values(byVariety)
          .flatMap((v) => Object.values(v))
          .reduce((s, v) => s + v.kilos, 0)
        const color = categoryColor(cerealType)

        return (
          <div
            key={cerealType}
            className={`mt-4 first:mt-0 ${i > 0 ? 'border-t-2 border-neutral-700 pt-4' : ''}`}
          >
            <p className={`text-base font-bold uppercase ${color}`}>{cerealType}</p>
            {(() => {
              // A variety split across multiple sack-weight lines (see
              // weightsByVariety above) would otherwise have its
              // unwithdrawn total shown - and counted into the cereal
              // total - once per split. Track which varietyIds have
              // already had their unwithdrawn figure rendered/summed
              // within this cereal type so it appears exactly once.
              const shownVarietyIds = new Set()
              return Object.entries(byVariety)
                .filter(([, byBucket]) => {
                  const vals = Object.values(byBucket)
                  return vals.reduce((s, v) => s + v.bags, 0) > 0 || vals.reduce((s, v) => s + v.kilos, 0) > 0
                })
                .sort(([a], [b]) => a.localeCompare(b)).map(([varietyName, byBucket]) => {
                const varietyBags = Object.values(byBucket).reduce((s, v) => s + v.bags, 0)
                const varietyKilos = Object.values(byBucket).reduce((s, v) => s + v.kilos, 0)
                const varietyId = groupVarietyId[cerealType]?.[varietyName]
                const unwithdrawn = varietyId && !shownVarietyIds.has(varietyId) ? unwithdrawnMap.get(varietyId) : null
                const unwithdrawnAmt = unwithdrawnAmount(unwithdrawn, showNetBags)
                const hasUnwithdrawn = unwithdrawnAmt >= (showNetBags ? 0.005 : 1)
                if (varietyId) shownVarietyIds.add(varietyId)

                return (
                  <div key={varietyName} className="mt-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg bg-neutral-800/50 px-2 py-1.5">
                      <span className="truncate text-sm font-semibold text-app-text">{varietyName}</span>
                      <div className="text-right">
                        <p className="whitespace-nowrap text-sm font-semibold text-app-text">
                          {showNetBags ? `${fmtNetBags(varietyKilos / 50)} net bags` : `${fmtBags(varietyBags)} bags`}
                          {hasUnwithdrawn && (
                            <button
                              type="button"
                              onClick={() => setDetailContext({ varietyIds: [varietyId], title: varietyName, subtitle: `${cerealType} · Unwithdrawn` })}
                              className="ml-1.5 whitespace-nowrap rounded-md bg-red-400/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-red-400 transition-colors hover:bg-red-400/25 active:scale-95"
                            >
                              {formatAmount(unwithdrawnAmt, showNetBags)} unwithdrawn
                            </button>
                          )}
                        </p>
                        <p className="whitespace-nowrap text-sm font-semibold text-app-text">{fmtWeight(varietyKilos, weightUnit, 'Net')}</p>
                        {hasUnwithdrawn && (
                          <p className="whitespace-nowrap text-[11px] text-brand-amber">
                            Potential: {formatAmount(Math.max(0, (showNetBags ? varietyKilos / 50 : varietyBags) - unwithdrawnAmt), showNetBags)} {showNetBags ? 'net bags' : 'bags'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 space-y-1">
                      {sortBucketEntries(cerealType, Object.entries(byBucket)).map(([bucketLabel, totals]) => (
                        <div key={bucketLabel} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-b border-neutral-800/50 py-1">
                          <span className="truncate pl-2 text-xs text-neutral-400">{bucketLabel}</span>
                          <div className="text-right">
                            <p className="whitespace-nowrap text-xs text-neutral-300">
                              {showNetBags ? `${fmtNetBags(totals.kilos / 50)} net bags` : `${fmtBags(totals.bags)} bags`}
                            </p>
                            <p className="whitespace-nowrap text-xs text-neutral-300">{fmtWeight(totals.kilos, weightUnit, 'Net')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            })()}
            {(() => {
              const cerealVarietyIds = [...new Set(Object.values(groupVarietyId[cerealType] ?? {}))]
              const cerealUnwithdrawn = cerealVarietyIds.reduce((acc, vid) => {
                const uw = unwithdrawnMap.get(vid)
                return uw ? { bags: acc.bags + uw.bags, kilos: acc.kilos + uw.kilos } : acc
              }, { bags: 0, kilos: 0 })
              const cerealUnwithdrawnAmt = unwithdrawnAmount(cerealUnwithdrawn, showNetBags)
              const hasCerealUnwithdrawn = cerealUnwithdrawnAmt >= (showNetBags ? 0.005 : 1)
              return (
                <div className={`mt-3 rounded-lg border-t-2 px-2 py-2 ${cerealType === 'Rice' ? 'border-blue-400 bg-blue-400/10' : cerealType === 'Palay' ? 'border-brand-neon bg-brand-neon/10' : 'border-brand-byproduct bg-brand-byproduct/10'}`}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <span className="truncate text-xs font-medium text-neutral-500">Total ({cerealType})</span>
                    <div className="text-right">
                      <p className={`whitespace-nowrap text-sm font-bold ${color}`}>
                        {showNetBags ? `${fmtNetBags(cerealKilos / 50)} net bags` : `${fmtBags(cerealBags)} bags`}
                        {hasCerealUnwithdrawn && (
                          <button
                            type="button"
                            onClick={() => setDetailContext({ varietyIds: cerealVarietyIds, title: `${cerealType} — Unwithdrawn`, subtitle: 'All varieties in this category' })}
                            className="ml-1.5 whitespace-nowrap rounded-md bg-red-400/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-red-400 transition-colors hover:bg-red-400/25 active:scale-95"
                          >
                            {formatAmount(cerealUnwithdrawnAmt, showNetBags)} unwithdrawn
                          </button>
                        )}
                      </p>
                      <p className={`whitespace-nowrap text-sm font-bold ${color}`}>{fmtWeight(cerealKilos, weightUnit, 'Net')}</p>
                      {hasCerealUnwithdrawn && (
                        <p className="whitespace-nowrap text-[11px] text-brand-amber">
                          Potential: {formatAmount(Math.max(0, (showNetBags ? cerealKilos / 50 : cerealBags) - cerealUnwithdrawnAmt), showNetBags)} {showNetBags ? 'net bags' : 'bags'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
    {detailContext && (
      <UnwithdrawnDetailModal
        warehouseId={currentWarehouseId}
        varietyIds={detailContext.varietyIds}
        title={detailContext.title}
        subtitle={detailContext.subtitle}
        onClose={() => setDetailContext(null)}
      />
    )}
    </>
  )
}

export default HomeStocks
