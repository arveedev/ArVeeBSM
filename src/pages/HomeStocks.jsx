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

import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, fmtBags, fmtWeight, fmtNetBags, AGE_BUCKETS } from '../utils/calculations.js'
import { computeUnwithdrawnByVariety, computeUnwithdrawnByVarietyAge } from '../utils/unwithdrawnStock.js'
import { computePileStockBySackWeight } from '../utils/pileLedger.js'
import useDelayedUnmount from '../hooks/useDelayedUnmount.js'
import UnwithdrawnDetailModal from '../components/common/UnwithdrawnDetailModal.jsx'
import PillToggle from '../components/common/PillToggle.jsx'

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

// Extracted into its own component (rather than an inline render inside
// a .map()) specifically so it can call useDelayedUnmount - React's
// Rules of Hooks don't allow a hook call per loop iteration inside one
// shared component body, but each VarietyCard here is its own component
// instance, so each gets its own safely.
function VarietyCard({
  varietyName, varietyBags, varietyKilos, varietyId, cerealType,
  bucketEntries, bucketUnwithdrawnMap,
  showNetBags, weightUnit, isExpanded, onToggle, onOpenDetail,
}) {
  const unitLabel = showNetBags ? 'net bags' : 'bags'
  const hasAnyBucketUnwithdrawn = bucketEntries.some(([label]) => {
    const uw = bucketUnwithdrawnMap?.get(label)
    const amt = unwithdrawnAmount(uw, showNetBags)
    return amt >= (showNetBags ? 0.005 : 1)
  })
  // Previously required MORE THAN one age bucket to be expandable at
  // all, so a variety whose entire stock sat in a single bucket (e.g.
  // only ever received within the last 0-3 months, no older stock yet)
  // showed no arrow and no age-group detail whatsoever - there was
  // nothing wrong with the bucket itself, just nothing else to compare
  // it against. A single bucket is still worth showing, so the user can
  // see which age group the variety's stock actually belongs to.
  const hasExpandableDetail = hasAnyBucketUnwithdrawn || bucketEntries.length > 0

  // The detail region's HEIGHT animates (via CSS grid-template-rows
  // 0fr -> 1fr), not just its opacity/translateY - a transform-based
  // reveal (the animate-flow-down used elsewhere) doesn't change actual
  // document height progressively, so the arrow below it would just
  // snap to its new position the instant the block mounts rather than
  // genuinely sliding down as the block grows. Height-animating this
  // wrapper is what makes the arrow (and anything else below) reflow
  // smoothly frame-by-frame instead of jumping.
  const shouldRenderDetail = useDelayedUnmount(isExpanded, 300)

  return (
    <div className="mt-3">
      <div
        onClick={hasExpandableDetail ? onToggle : undefined}
        className={`rounded-lg bg-neutral-800/50 px-2 py-1.5 transition-colors ${hasExpandableDetail ? 'cursor-pointer active:bg-neutral-800' : ''}`}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <span className="truncate text-sm font-semibold text-app-text">{varietyName}</span>
          <div className="text-right">
            <p className="whitespace-nowrap text-sm font-semibold text-app-text">
              {showNetBags ? `${fmtNetBags(varietyKilos / 50)} net bags` : `${fmtBags(varietyBags)} bags`}
            </p>
            <p className="whitespace-nowrap text-sm font-semibold text-app-text">{fmtWeight(varietyKilos, weightUnit, 'Net')}</p>
          </div>
        </div>
      </div>

      <div
        className="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {shouldRenderDetail && (
            <div className="mt-1 space-y-1">
              {bucketEntries.map(([bucketLabel, totals]) => {
                // Real per-bucket figure, not an estimate - each AI's
                // own ageGroup field resolves to a specific bucket
                // (computeUnwithdrawnByVarietyAge), so this is the
                // actual unwithdrawn amount for THIS age group, not the
                // variety's total prorated by bag share.
                const bucketUnwithdrawn = bucketUnwithdrawnMap?.get(bucketLabel)
                const bucketUnwithdrawnAmt = unwithdrawnAmount(bucketUnwithdrawn, showNetBags)
                const bucketHasUnwithdrawn = bucketUnwithdrawnAmt >= (showNetBags ? 0.005 : 1)
                const bucketTotalAmt = showNetBags ? totals.kilos / 50 : totals.bags

                return (
                  <div key={bucketLabel} className="border-b border-neutral-800/50 py-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <span className="truncate pl-2 text-xs text-neutral-400">{bucketLabel}</span>
                      <div className="text-right">
                        <p className="whitespace-nowrap text-xs text-neutral-300">
                          {showNetBags ? `${fmtNetBags(totals.kilos / 50)} net bags` : `${fmtBags(totals.bags)} bags`}
                        </p>
                        <p className="whitespace-nowrap text-xs text-neutral-300">{fmtWeight(totals.kilos, weightUnit, 'Net')}</p>
                      </div>
                    </div>
                    {bucketHasUnwithdrawn && (
                      <div className="mt-1 flex items-center justify-between gap-2 pl-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onOpenDetail({ varietyIds: [varietyId], bucketFilter: { category: cerealType, label: bucketLabel }, title: `${varietyName} — ${bucketLabel}`, subtitle: `${cerealType} · Unwithdrawn` }) }}
                          className="whitespace-nowrap rounded-md bg-red-400/10 px-1.5 py-0.5 text-xs font-medium text-red-400/90 transition-colors hover:bg-red-400/20 active:scale-95 sm:text-sm"
                        >
                          {formatAmount(bucketUnwithdrawnAmt, showNetBags)} {unitLabel} unwithdrawn
                        </button>
                        <p className="whitespace-nowrap text-xs text-brand-amber/90 sm:text-sm">
                          Potential: {formatAmount(Math.max(0, bucketTotalAmt - bucketUnwithdrawnAmt), showNetBags)} {unitLabel}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {hasExpandableDetail && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 flex w-full justify-center py-1"
          aria-label={isExpanded ? 'Hide details' : 'Show details'}
        >
          {/* The rotate only starts once the 300ms height-slide above
              has actually finished (transition-delay matches that
              duration) - flipping at the same moment the slide starts
              made the arrow's own motion (rotating) compete with the
              content's motion (sliding) instead of reading as two
              connected steps: slide, then flip to show the new state. */}
          <ChevronDown
            size={16}
            className={`text-brand-neon transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            style={{ transitionDelay: '300ms' }}
          />
        </button>
      )}
    </div>
  )
}

// Extracted for the same reason as VarietyCard above (Rules of Hooks -
// each cereal type's total needs its own useState/useEffect instance,
// not one shared across a .map() loop). Flips between "just the actual
// figure" and "actual + unwithdrawn/potential detail" as a genuine
// two-sided card turn: `displayed` lags one animation-half behind the
// real `hasUnwithdrawn` value, so the OLD content is still what's
// showing for the first half of the rotation (until the card is
// edge-on and invisible), then the NEW content takes over for the
// second half - see the `card-flip` keyframes in index.css for why a
// single element can fake two faces this way.
const FLIP_MS = 600

function CerealTotal({
  cerealType, color, cerealBags, cerealKilos, showNetBags, weightUnit,
  hasUnwithdrawn, unwithdrawnAmt, unitLabel, cerealVarietyIds, onOpenDetail,
}) {
  const [displayed, setDisplayed] = useState(hasUnwithdrawn)
  const [flipKey, setFlipKey] = useState(0)
  // Opening (revealing the detail) hinges on the bottom edge; closing
  // hinges on the top edge - a real board flips over its opposite edge
  // each time, not the same pivot back and forth.
  const [flipDirection, setFlipDirection] = useState(hasUnwithdrawn ? 'open' : 'close')

  useEffect(() => {
    if (hasUnwithdrawn === displayed) return
    setFlipDirection(hasUnwithdrawn ? 'open' : 'close')
    setFlipKey((k) => k + 1)
    const t = setTimeout(() => setDisplayed(hasUnwithdrawn), FLIP_MS / 2)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnwithdrawn])

  return (
    <div className="mt-3 [perspective:600px]">
      <div
        key={flipKey}
        className={`${flipDirection === 'open' ? 'animate-card-flip-open' : 'animate-card-flip-close'} rounded-lg border-t-2 px-2 py-2 ${cerealType === 'Rice' ? 'border-blue-400 bg-blue-400/10' : cerealType === 'Palay' ? 'border-brand-neon bg-brand-neon/10' : 'border-brand-byproduct bg-brand-byproduct/10'}`}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <span className={`truncate text-sm font-bold ${color}`}>Total ({cerealType})</span>
          <div className="text-right">
            <p className={`whitespace-nowrap text-base font-bold ${color}`}>
              {showNetBags ? `${fmtNetBags(cerealKilos / 50)} net bags` : `${fmtBags(cerealBags)} bags`}
            </p>
            <p className={`whitespace-nowrap text-base font-bold ${color}`}>{fmtWeight(cerealKilos, weightUnit, 'Net')}</p>
          </div>
        </div>
        {displayed && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-800/50 pt-2">
            <button
              type="button"
              onClick={() => onOpenDetail({ varietyIds: cerealVarietyIds, title: `${cerealType} — Unwithdrawn`, subtitle: 'All varieties in this category' })}
              className="whitespace-nowrap rounded-md bg-red-400/15 px-1.5 py-0.5 text-sm font-bold text-red-400 transition-colors hover:bg-red-400/25 active:scale-95 sm:text-base"
            >
              {formatAmount(unwithdrawnAmt, showNetBags)} {unitLabel} unwithdrawn
            </button>
            <p className="whitespace-nowrap text-xs font-medium text-brand-amber sm:text-sm">
              Potential: {formatAmount(Math.max(0, (showNetBags ? cerealKilos / 50 : cerealBags) - unwithdrawnAmt), showNetBags)} {unitLabel}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function HomeStocks({ warehouseId } = {}) {
  const { autoAgeMonitoring, weightUnit } = useSettings() ?? {}
  const { currentWarehouseId: contextWarehouseId } = useWarehouse() ?? {}
  const currentWarehouseId = warehouseId ?? contextWarehouseId
  // Toggles the middle column between showing bags count or net bags -
  // net bags is not shown by default, kept out of view until the user
  // explicitly asks for it, for a cleaner default look.
  const [showNetBags, setShowNetBags] = useState(false)
  // { varietyIds, bucketFilter, title, subtitle } for the unwithdrawn
  // drill-down modal, or null when closed.
  const [detailContext, setDetailContext] = useState(null)
  // Per-variety age-bucket detail is collapsed by default, keyed on
  // "cerealType::varietyName".
  const [expandedVarieties, setExpandedVarieties] = useState(() => new Set())
  const toggleVarietyBreakdown = (key) => {
    setExpandedVarieties((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const piles = useLiveQuery(async () => {
    if (!currentWarehouseId) return []
    return db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
  }, [currentWarehouseId]) ?? []

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const varietyCategoryMap = new Map(varieties.map((v) => [v.varietyId, v.category]))
  const unwithdrawnMap = useLiveQuery(
    () => computeUnwithdrawnByVariety(currentWarehouseId),
    [currentWarehouseId]
  ) ?? new Map()
  // varietyId -> Map(bucketLabel -> { bags, kilos }) - real per-bucket
  // figures (see unwithdrawnStock.js), replacing an earlier proportional
  // estimate that showed the same full-variety numbers under every
  // bucket regardless of which one was tapped.
  const unwithdrawnByVarietyAge = useLiveQuery(
    () => computeUnwithdrawnByVarietyAge(currentWarehouseId, varietyCategoryMap),
    [currentWarehouseId, varieties]
  ) ?? new Map()

  // pileId -> Map(weight -> { bags, kilos }) - the ACTUAL sack weight(s)
  // making up each pile's current stock, from its real transaction
  // history (see computePileStockBySackWeight's own comment for why
  // piles.mtsSackTypeId alone can't answer this: it only reflects
  // whichever weight a pile was first CREATED with, never updated by
  // later receipts, even though an ordinary Rice/Palay pile - locked to
  // one variety for life, but never locked to one sack weight - can
  // genuinely accumulate more than one weight over its lifetime.
  const pileStockByWeight = useLiveQuery(async () => {
    if (piles.length === 0) return new Map()
    const warehouse = currentWarehouseId ? await db.warehouses.get(currentWarehouseId) : null
    const entries = await Promise.all(
      piles.map(async (p) => [p.pileId, await computePileStockBySackWeight(p.pileId, '9999-12-31', warehouse)])
    )
    return new Map(entries)
  }, [piles, currentWarehouseId]) ?? new Map()

  const enrichedPiles = piles.map((p) => ({
    ...p,
    age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
    variety: varietyMap.get(p.varietyId),
  }))

  // First pass: for each variety, collect every distinct weight actually
  // present across its piles' REAL stock (per pileStockByWeight, not the
  // stale pile-level field) - only varieties with genuinely more than
  // one distinct weight need separating at all. A variety using a
  // single sack condition throughout (the common case) stays as one
  // plain-named line, exactly as before this feature existed. By
  // Products is deliberately excluded, per an earlier explicit request
  // that it always show as a single unseparated line regardless of how
  // many distinct sack weights are technically in use - unlike
  // Rice/Palay's, that decision wasn't reported as wrong and isn't
  // being changed here.
  const weightsByVariety = new Map()
  for (const p of enrichedPiles) {
    if (p.variety?.category === 'By Products') continue
    const varietyName = p.variety?.name ?? '—'
    const byWeight = pileStockByWeight.get(p.pileId)
    if (!byWeight) continue
    for (const [weight] of byWeight) {
      if (weight === 'unspecified') continue
      if (!weightsByVariety.has(varietyName)) weightsByVariety.set(varietyName, new Set())
      weightsByVariety.get(varietyName).add(weight)
    }
  }

  // cerealType -> displayLabel -> ageBucketLabel -> { bags, kilos }
  // displayLabel is "varietyName (weight)" only when that variety has
  // more than one distinct weight in use - otherwise just the plain
  // variety name, merging everything into one line as usual. Age
  // bucketing stays a whole-PILE property (a pile's age is one value
  // regardless of how many sack weights are mixed within it), so each
  // pile's per-weight portions all land in that same pile's one age
  // bucket - only the weight split changes what's inside it.
  const stockGroups = {}
  // cerealType -> groupLabel -> varietyId, so the unwithdrawn-stock
  // lookup (keyed by varietyId) can be joined back onto each rendered
  // variety row below.
  const groupVarietyId = {}
  for (const p of enrichedPiles) {
    const cerealType = p.variety?.category ?? p.cerealType ?? 'Unknown'
    const varietyName = p.variety?.name ?? '—'
    const needsSeparation = (weightsByVariety.get(varietyName)?.size ?? 0) > 1
    const buckets = AGE_BUCKETS[cerealType] ?? AGE_BUCKETS.Rice
    const bucket = buckets.find((b) => b.test(p.age)) ?? buckets[buckets.length - 1]
    const byWeight = pileStockByWeight.get(p.pileId) ?? new Map([['unspecified', { bags: p.currentBags ?? 0, kilos: p.currentKilos ?? 0 }]])

    for (const [weight, totals] of byWeight) {
      const groupLabel = needsSeparation && weight !== 'unspecified' ? `${varietyName} (${weight.toFixed(3)})` : varietyName

      stockGroups[cerealType] ??= {}
      stockGroups[cerealType][groupLabel] ??= {}
      stockGroups[cerealType][groupLabel][bucket.label] ??= { bags: 0, kilos: 0 }
      stockGroups[cerealType][groupLabel][bucket.label].bags += totals.bags
      stockGroups[cerealType][groupLabel][bucket.label].kilos += totals.kilos

      groupVarietyId[cerealType] ??= {}
      groupVarietyId[cerealType][groupLabel] = p.varietyId
    }
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
  // Explicit hierarchy, not alphabetical - Rice first, then Palay,
  // then By Products last, per explicit request. Anything unexpected
  // (not in this list) sorts after all three rather than crashing.
  const CEREAL_TYPE_ORDER = ['Rice', 'Palay', 'By Products']
  const sortedGroups = Object.entries(stockGroups)
    .filter(([, byVariety]) => { const t = groupTotals(byVariety); return t.bags > 0 || t.kilos > 0 })
    .sort(([a], [b]) => {
      const ai = CEREAL_TYPE_ORDER.indexOf(a)
      const bi = CEREAL_TYPE_ORDER.indexOf(b)
      return (ai === -1 ? CEREAL_TYPE_ORDER.length : ai) - (bi === -1 ? CEREAL_TYPE_ORDER.length : bi)
    })

  return (
    <>
    <div className="relative mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="absolute right-4 top-4">
        <PillToggle
          options={[{ value: false, label: 'Bags' }, { value: true, label: 'Net Bags' }]}
          value={showNetBags}
          onChange={setShowNetBags}
        />
      </div>
      {/* Keyed on both toggles so switching either one replays this
          entrance animation on the now-different values, instead of the
          numbers just silently swapping in place. */}
      <div key={`${weightUnit}-${showNetBags}`} className="animate-flow-down">
      {sortedGroups.map(([cerealType, byVariety], i) => {
        const cerealBags = Object.values(byVariety)
          .flatMap((v) => Object.values(v))
          .reduce((s, v) => s + v.bags, 0)
        const cerealKilos = Object.values(byVariety)
          .flatMap((v) => Object.values(v))
          .reduce((s, v) => s + v.kilos, 0)
        const color = categoryColor(cerealType)

        // The cereal Total's own unwithdrawn/potential detail mirrors
        // whether ANY variety in this cereal type is currently
        // expanded - collapsed by default alongside the variety cards.
        const categoryHasExpanded = Object.keys(byVariety).some((v) => expandedVarieties.has(`${cerealType}::${v}`))

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
                if (varietyId) shownVarietyIds.add(varietyId)
                const bucketEntries = sortBucketEntries(cerealType, Object.entries(byBucket))
                const varietyKey = `${cerealType}::${varietyName}`
                const isExpanded = expandedVarieties.has(varietyKey)
                const bucketUnwithdrawnMap = varietyId ? unwithdrawnByVarietyAge.get(varietyId) : null

                return (
                  <VarietyCard
                    key={varietyName}
                    varietyName={varietyName}
                    varietyBags={varietyBags}
                    varietyKilos={varietyKilos}
                    varietyId={varietyId}
                    cerealType={cerealType}
                    bucketEntries={bucketEntries}
                    bucketUnwithdrawnMap={bucketUnwithdrawnMap}
                    showNetBags={showNetBags}
                    weightUnit={weightUnit}
                    isExpanded={isExpanded}
                    onToggle={() => toggleVarietyBreakdown(varietyKey)}
                    onOpenDetail={setDetailContext}
                  />
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
              const hasCerealUnwithdrawn = categoryHasExpanded && cerealUnwithdrawnAmt >= (showNetBags ? 0.005 : 1)
              const cerealUnitLabel = showNetBags ? 'net bags' : 'bags'
              return (
                <CerealTotal
                  cerealType={cerealType}
                  color={color}
                  cerealBags={cerealBags}
                  cerealKilos={cerealKilos}
                  showNetBags={showNetBags}
                  weightUnit={weightUnit}
                  hasUnwithdrawn={hasCerealUnwithdrawn}
                  unwithdrawnAmt={cerealUnwithdrawnAmt}
                  unitLabel={cerealUnitLabel}
                  cerealVarietyIds={cerealVarietyIds}
                  onOpenDetail={setDetailContext}
                />
              )
            })()}
          </div>
        )
      })}
      </div>
    </div>
    {detailContext && (
      <UnwithdrawnDetailModal
        warehouseId={currentWarehouseId}
        varietyIds={detailContext.varietyIds}
        bucketFilter={detailContext.bucketFilter}
        title={detailContext.title}
        subtitle={detailContext.subtitle}
        onClose={() => setDetailContext(null)}
      />
    )}
    </>
  )
}

export default HomeStocks
