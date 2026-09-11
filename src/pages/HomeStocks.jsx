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

import { useState, useEffect, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, fmtBags, fmtWeight, fmtNetBags, fmtKilos, AGE_BUCKETS } from '../utils/calculations.js'
import { computeUnwithdrawnByVariety, computeUnwithdrawnByVarietyAge } from '../utils/unwithdrawnStock.js'
import { computePileStockBreakdown } from '../utils/pileLedger.js'
import useDelayedUnmount from '../hooks/useDelayedUnmount.js'
import CountUpNumber from '../components/common/CountUpNumber.jsx'
import UnwithdrawnDetailModal from '../components/common/UnwithdrawnDetailModal.jsx'
import PillToggle from '../components/common/PillToggle.jsx'

// One useLiveQuery per pile, each its own independent Dexie
// subscription - React's Rules of Hooks don't allow a hook call per
// loop iteration inside one shared component, so this is its own
// component instance per pile (same reasoning as VarietyCard's own
// comment below). This is what actually completes the #6 performance
// fix: with each pile's recompute genuinely independent, saving a
// transaction against Pile A only re-triggers PILE A's own subscription
// (Dexie's fine-grained tracking watches the exact pileId-keyed
// transaction range this reads) - every other pile's already-computed
// entry is untouched, instead of the whole batched Promise.all
// (previously one shared query covering every pile at once) re-running
// for all of them just because one changed. Renders nothing itself -
// reports its result up to the parent via onData, keyed by pileId.
function PileWeightSubscriber({ pileId, warehouseCutoffDate, sackTypes, onData }) {
  // computePileStockBreakdown combines this warehouse-level cutoff with
  // the global Data Start Date override itself internally - only the raw
  // per-warehouse value needs to be passed down here, not a pre-combined
  // one. Reads the full variety+sack-weight breakdown directly (rather
  // than the weight-only computePileStockBySackWeight wrapper) so a By
  // Products pile's real variety mix survives into the grouping below
  // instead of being collapsed away before it ever gets there - the
  // exact, reported cause of every By Products variety showing as a
  // blank "—" line instead of its real name.
  const breakdown = useLiveQuery(
    () => computePileStockBreakdown(pileId, '9999-12-31', { reportingCutoffDate: warehouseCutoffDate }, sackTypes),
    [pileId, warehouseCutoffDate, sackTypes]
  )
  useEffect(() => {
    if (breakdown) onData(pileId, breakdown)
  }, [pileId, breakdown, onData])
  return null
}

// Concept B (picked) - countUp/format (raw number + its formatter)
// animates the figure up from its previous value instead of snapping;
// passing the already-formatted `value` string directly (existing
// call sites elsewhere) still works exactly as before.
function SummaryCard({ label, value, countUp, format, sub = false }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={sub ? 'mt-1 text-lg font-medium tabular-nums text-neutral-300' : 'mt-1 text-2xl font-semibold tabular-nums text-app-text'}>
        {countUp != null && format ? <CountUpNumber value={countUp} format={format} /> : value}
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
// Plain kg/MT number, no unit suffix - the column header ("NET KG"/
// "NET MT") already says the unit, so repeating it on every row (as the
// old inline "138 bags · 4,543.25 kg" text did) was reported as
// cluttered/redundant once the fixed-column layout below already labels
// each column once. fmtWeight remains the one place that still prints
// its own unit suffix (used for the KG/MT toggle's normal behavior
// elsewhere in the app), so this is a separate, deliberately bare
// formatter just for these grid cells.
const fmtWeightPlain = (kilos, weightUnit) =>
  weightUnit === 'mt'
    ? Number(kilos / 1000).toLocaleString('en-PH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : fmtKilos(kilos)
// Fixed, shared across every row (header labels, the main variety row,
// each age-bucket row, and the unwithdrawn/potential rows) so numbers
// land on the same right edge everywhere - each row is its own separate
// CSS grid, so an "auto"-sized column would size independently per row
// and silently drift out of alignment with its neighbors; a literal
// shared width is what keeps them lined up.
const STOCK_GRID_COLS = 'minmax(0,1fr) 68px 116px'

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
  bucketEntries, bucketUnwithdrawnMap, flatUnwithdrawn, isByProducts,
  showNetBags, weightUnit, isExpanded, onToggle, onOpenDetail,
}) {
  // By Products bags don't have a standard 50kg weight, so the "net
  // bags" conversion (kilos / 50) the page's Bags/Net Bags toggle
  // normally applies simply doesn't mean anything there - always shows
  // the real bag count regardless of the toggle. See
  // unwithdrawnStock.js's bagsKilosMismatch for the matching fix on the
  // drill-down modal side.
  const effectiveShowNetBags = isByProducts ? false : showNetBags
  const unitLabel = effectiveShowNetBags ? 'net bags' : 'bags'
  const weightColLabel = weightUnit === 'mt' ? 'net mt' : 'net kg'

  const hasAnyBucketUnwithdrawn = !isByProducts && bucketEntries.some(([label]) => {
    const uw = bucketUnwithdrawnMap?.get(label)
    const amt = unwithdrawnAmount(uw, effectiveShowNetBags)
    return amt >= (effectiveShowNetBags ? 0.005 : 1)
  })
  // Previously required MORE THAN one age bucket to be expandable at
  // all, so a variety whose entire stock sat in a single bucket (e.g.
  // only ever received within the last 0-3 months, no older stock yet)
  // showed no arrow and no age-group detail whatsoever - there was
  // nothing wrong with the bucket itself, just nothing else to compare
  // it against. A single bucket is still worth showing, so the user can
  // see which age group the variety's stock actually belongs to.
  // By Products never expands into age buckets at all - its own AI
  // ageGroup free text essentially never resolves to a real bucket (see
  // computeUnwithdrawnByVarietyAge's own comment), so there's nothing
  // genuine to drill into there; it shows its flat unwithdrawn/potential
  // figure directly below the main row instead (see hasFlatUnwithdrawn).
  const hasExpandableDetail = !isByProducts && (hasAnyBucketUnwithdrawn || bucketEntries.length > 0)

  // The detail region's HEIGHT animates (via CSS grid-template-rows
  // 0fr -> 1fr), not just its opacity/translateY - a transform-based
  // reveal (the animate-flow-down used elsewhere) doesn't change actual
  // document height progressively, so the arrow below it would just
  // snap to its new position the instant the block mounts rather than
  // genuinely sliding down as the block grows. Height-animating this
  // wrapper is what makes the arrow (and anything else below) reflow
  // smoothly frame-by-frame instead of jumping.
  const shouldRenderDetail = useDelayedUnmount(isExpanded, 300)

  const varietyTotalAmt = effectiveShowNetBags ? varietyKilos / 50 : varietyBags
  const flatUnwithdrawnAmt = flatUnwithdrawn ? unwithdrawnAmount(flatUnwithdrawn, false) : 0
  const hasFlatUnwithdrawn = isByProducts && flatUnwithdrawnAmt >= 1

  return (
    <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-800/30 px-2.5 py-2">
      {/* Column headers, once per card - every row below (main figures,
          age buckets, unwithdrawn/potential) reuses this exact same
          grid so the unit only needs to be named here, not repeated as
          text on every single row. */}
      <div className="grid gap-x-2 text-right text-[9px] font-semibold uppercase tracking-wide text-neutral-500" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
        <span />
        <span>{unitLabel}</span>
        <span>{weightColLabel}</span>
      </div>

      <div
        onClick={hasExpandableDetail ? onToggle : undefined}
        className={`mt-0.5 rounded-md transition-colors ${hasExpandableDetail ? 'cursor-pointer active:bg-neutral-800/60' : ''}`}
      >
        <div className="grid items-baseline gap-x-2" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
          <span className="truncate text-base font-semibold text-app-text">{varietyName}</span>
          <span className="text-right text-base font-bold tabular-nums text-app-text">
            <CountUpNumber value={Math.max(0, varietyTotalAmt)} format={(v) => formatAmount(v, effectiveShowNetBags)} />
          </span>
          <span className="text-right text-sm font-semibold tabular-nums text-app-text">
            <CountUpNumber value={Math.max(0, varietyKilos)} format={(v) => fmtWeightPlain(v, weightUnit)} />
          </span>
        </div>
      </div>

      {hasFlatUnwithdrawn && (
        <div className="mt-1.5 space-y-0.5 border-t border-neutral-800/50 pt-1.5">
          <button
            type="button"
            onClick={() => onOpenDetail({ varietyIds: [varietyId], title: `${varietyName} — Unwithdrawn`, subtitle: `${cerealType} · Unwithdrawn`, rawBags: true })}
            className="grid w-full items-center gap-x-2 rounded-md bg-red-400/10 px-1.5 py-1 text-left transition-colors hover:bg-red-400/20 active:scale-[0.99]"
            style={{ gridTemplateColumns: STOCK_GRID_COLS }}
          >
            <span className="text-[10px] font-medium text-red-400/90">Unwithdrawn ›</span>
            <span className="text-right text-sm font-bold tabular-nums text-red-400">{formatAmount(flatUnwithdrawn.bags, false)}</span>
            <span className="text-right text-xs font-semibold tabular-nums text-red-400/90">{fmtWeightPlain(flatUnwithdrawn.kilos, weightUnit)}</span>
          </button>
          <div className="grid items-center gap-x-2 px-1.5" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
            <span className="text-[10px] font-medium text-brand-amber/80">Potential</span>
            <span className="text-right text-sm font-semibold tabular-nums text-brand-amber">{formatAmount(Math.max(0, varietyBags - flatUnwithdrawn.bags), false)}</span>
            <span className="text-right text-xs font-medium tabular-nums text-brand-amber/90">{fmtWeightPlain(Math.max(0, varietyKilos - flatUnwithdrawn.kilos), weightUnit)}</span>
          </div>
        </div>
      )}

      {!isByProducts && (
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
                const bucketUnwithdrawnAmt = unwithdrawnAmount(bucketUnwithdrawn, effectiveShowNetBags)
                const bucketHasUnwithdrawn = bucketUnwithdrawnAmt >= (effectiveShowNetBags ? 0.005 : 1)
                const bucketTotalAmt = effectiveShowNetBags ? totals.kilos / 50 : totals.bags

                return (
                  <div key={bucketLabel} className="border-b border-neutral-800/50 py-1">
                    <div className="grid items-baseline gap-x-2" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
                      <span className="pl-2 text-sm text-neutral-400">{bucketLabel}</span>
                      <span className="text-right text-sm font-semibold tabular-nums text-neutral-200">
                        <CountUpNumber value={Math.max(0, bucketTotalAmt)} format={(v) => formatAmount(v, effectiveShowNetBags)} />
                      </span>
                      <span className="text-right text-xs font-medium tabular-nums text-neutral-300">
                        <CountUpNumber value={Math.max(0, totals.kilos)} format={(v) => fmtWeightPlain(v, weightUnit)} />
                      </span>
                    </div>
                    {bucketHasUnwithdrawn && (
                      <div className="mt-1 space-y-0.5 pl-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onOpenDetail({ varietyIds: [varietyId], bucketFilter: { category: cerealType, label: bucketLabel }, title: `${varietyName} — ${bucketLabel}`, subtitle: `${cerealType} · Unwithdrawn`, rawBags: false }) }}
                          className="grid w-full items-center gap-x-2 rounded-md bg-red-400/10 px-1.5 py-0.5 text-left transition-colors hover:bg-red-400/20 active:scale-[0.99]"
                          style={{ gridTemplateColumns: STOCK_GRID_COLS }}
                        >
                          <span className="text-[10px] font-medium text-red-400/90">Unwithdrawn ›</span>
                          <span className="text-right text-sm font-semibold tabular-nums text-red-400">{formatAmount(bucketUnwithdrawnAmt, effectiveShowNetBags)}</span>
                          <span className="text-right text-xs font-medium tabular-nums text-red-400/90">{fmtWeightPlain(bucketUnwithdrawn?.kilos ?? 0, weightUnit)}</span>
                        </button>
                        <div className="grid items-center gap-x-2 px-1.5" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
                          <span className="text-[10px] font-medium text-brand-amber/80">Potential</span>
                          <span className="text-right text-sm font-medium tabular-nums text-brand-amber">{formatAmount(Math.max(0, bucketTotalAmt - bucketUnwithdrawnAmt), effectiveShowNetBags)}</span>
                          <span className="text-right text-xs font-medium tabular-nums text-brand-amber/90">{fmtWeightPlain(Math.max(0, totals.kilos - (bucketUnwithdrawn?.kilos ?? 0)), weightUnit)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      )}

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
  hasUnwithdrawn, unwithdrawnAmt, unwithdrawnKilos, unitLabel, cerealVarietyIds, onOpenDetail, rawBags,
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

  const totalAmt = rawBags ? cerealBags : (showNetBags ? cerealKilos / 50 : cerealBags)
  const weightColLabel = weightUnit === 'mt' ? 'net mt' : 'net kg'

  return (
    <div className="mt-3 [perspective:600px]">
      <div
        key={flipKey}
        className={`${flipDirection === 'open' ? 'animate-card-flip-open' : 'animate-card-flip-close'} rounded-lg border-t-2 px-2 py-2 ${cerealType === 'Rice' ? 'border-blue-400 bg-blue-400/10' : cerealType === 'Palay' ? 'border-brand-neon bg-brand-neon/10' : 'border-brand-byproduct bg-brand-byproduct/10'}`}
      >
        <div className="grid gap-x-2 text-right text-[9px] font-semibold uppercase tracking-wide text-neutral-500" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
          <span />
          <span>{unitLabel}</span>
          <span>{weightColLabel}</span>
        </div>
        <div className="grid items-baseline gap-x-2" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
          <span className={`text-base font-bold ${color}`}>Total ({cerealType})</span>
          <span className={`text-right text-lg font-bold tabular-nums ${color}`}>{formatAmount(Math.max(0, totalAmt), rawBags ? false : showNetBags)}</span>
          <span className={`text-right text-base font-bold tabular-nums ${color}`}>{fmtWeightPlain(Math.max(0, cerealKilos), weightUnit)}</span>
        </div>
        {displayed && (
          <div className="mt-2 space-y-1 border-t border-neutral-800/50 pt-2">
            <button
              type="button"
              onClick={() => onOpenDetail({ varietyIds: cerealVarietyIds, title: `${cerealType} — Unwithdrawn`, subtitle: 'All varieties in this category', rawBags })}
              className="grid w-full items-center gap-x-2 rounded-md bg-red-400/15 px-1.5 py-1 text-left transition-colors hover:bg-red-400/25 active:scale-[0.99]"
              style={{ gridTemplateColumns: STOCK_GRID_COLS }}
            >
              <span className="text-xs font-medium text-red-400/90">Unwithdrawn ›</span>
              <span className="text-right text-base font-bold tabular-nums text-red-400">{formatAmount(unwithdrawnAmt, rawBags ? false : showNetBags)}</span>
              <span className="text-right text-sm font-semibold tabular-nums text-red-400/90">{fmtWeightPlain(unwithdrawnKilos, weightUnit)}</span>
            </button>
            <div className="grid items-center gap-x-2 px-1.5" style={{ gridTemplateColumns: STOCK_GRID_COLS }}>
              <span className="text-xs font-medium text-brand-amber/80">Potential</span>
              <span className="text-right text-base font-semibold tabular-nums text-brand-amber">{formatAmount(Math.max(0, totalAmt - unwithdrawnAmt), rawBags ? false : showNetBags)}</span>
              <span className="text-right text-sm font-medium tabular-nums text-brand-amber/90">{fmtWeightPlain(Math.max(0, cerealKilos - unwithdrawnKilos), weightUnit)}</span>
            </div>
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
  //
  // Populated by one PileWeightSubscriber instance PER PILE (rendered
  // below), each an independent Dexie subscription, merged into this
  // single state Map via onData - completes the #6 performance fix: a
  // save against one pile now only re-triggers that pile's own entry
  // here, leaving every other pile's already-computed entry untouched,
  // instead of one shared query recomputing every pile in the
  // warehouse whenever any single one of them changed.
  const [pileStockBreakdown, setPileStockBreakdown] = useState(new Map())
  const handlePileWeightData = useCallback((pileId, breakdown) => {
    setPileStockBreakdown((prev) => {
      const existing = prev.get(pileId)
      // Bail out of the state update entirely when the new breakdown is
      // equivalent to what's already stored - React treats a new array
      // reference as a genuine change regardless of content, which
      // would otherwise re-render on every subscriber's initial mount
      // even for piles whose figures didn't actually move. Groups are
      // compared by their own composite key (varietyId::sackTypeId::
      // mtsCondition, matching computePileStockBreakdown's own grouping)
      // rather than array order, which isn't guaranteed stable.
      const keyOf = (g) => `${g.varietyId ?? ''}::${g.sackTypeId ?? ''}::${g.mtsCondition ?? ''}`
      if (existing && existing.length === breakdown.length) {
        const existingByKey = new Map(existing.map((g) => [keyOf(g), g]))
        const unchanged = breakdown.every((g) => {
          const e = existingByKey.get(keyOf(g))
          return e && e.bags === g.bags && e.kilos === g.kilos
        })
        if (unchanged) return prev
      }
      const next = new Map(prev)
      next.set(pileId, breakdown)
      return next
    })
  }, [])

  const warehouseForCutoff = useLiveQuery(
    () => currentWarehouseId ? db.warehouses.get(currentWarehouseId) : null,
    [currentWarehouseId]
  )
  const pileWeightSackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []

  const enrichedPiles = piles.map((p) => ({
    ...p,
    age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
    variety: varietyMap.get(p.varietyId),
  }))

  // First pass: for each variety, collect every distinct weight actually
  // present across its piles' REAL stock (per pileStockBreakdown, not
  // the stale pile-level field) - only varieties with genuinely more
  // than one distinct weight need separating at all. A variety using a
  // single sack condition throughout (the common case) stays as one
  // plain-named line, exactly as before this feature existed. By
  // Products is deliberately excluded, per an earlier explicit request
  // that it always show as a single unseparated line regardless of how
  // many distinct sack weights are technically in use (still true below
  // even though the variety-name fix changes how it groups) - unlike
  // Rice/Palay's, that weight-separation decision wasn't reported as
  // wrong and isn't being changed here.
  const weightsByVariety = new Map()
  for (const p of enrichedPiles) {
    if (p.variety?.category === 'By Products') continue
    const varietyName = p.variety?.name ?? '—'
    const breakdown = pileStockBreakdown.get(p.pileId)
    if (!breakdown) continue
    for (const g of breakdown) {
      if (g.weight === 'unspecified') continue
      if (!weightsByVariety.has(varietyName)) weightsByVariety.set(varietyName, new Set())
      weightsByVariety.get(varietyName).add(g.weight)
    }
  }

  // cerealType -> displayLabel -> ageBucketLabel -> { bags, kilos }
  // displayLabel is "varietyName (weight)" only when that variety has
  // more than one distinct weight in use - otherwise just the plain
  // variety name, merging everything into one line as usual. Age
  // bucketing stays a whole-PILE property (a pile's age is one value
  // regardless of how many sack weights/varieties are mixed within it),
  // so each pile's portions all land in that same pile's one age bucket.
  const stockGroups = {}
  // cerealType -> groupLabel -> varietyId, so the unwithdrawn-stock
  // lookup (keyed by varietyId) can be joined back onto each rendered
  // variety row below.
  const groupVarietyId = {}
  for (const p of enrichedPiles) {
    const cerealType = p.variety?.category ?? p.cerealType ?? 'Unknown'
    const buckets = AGE_BUCKETS[cerealType] ?? AGE_BUCKETS.Rice
    const bucket = buckets.find((b) => b.test(p.age)) ?? buckets[buckets.length - 1]
    const breakdown = pileStockBreakdown.get(p.pileId)
      ?? [{ varietyId: p.varietyId, weight: 'unspecified', bags: p.currentBags ?? 0, kilos: p.currentKilos ?? 0 }]

    if (cerealType === 'By Products') {
      // Real variety mix (piles.varietyId is null/unreliable for By
      // Products, confirmed - see computePileStockBreakdown's own doc
      // comment) - grouped by each group's own varietyId, resolved to
      // its real name via varietyMap, instead of the pile-level field
      // that was producing a blank "—" line for every By Products pile
      // regardless of how many real varieties it actually held. Still
      // never separated by sack weight (folded together here), matching
      // the existing, unchanged weight-separation decision above.
      const byVarietyId = new Map()
      for (const g of breakdown) {
        const key = g.varietyId ?? ''
        if (!byVarietyId.has(key)) byVarietyId.set(key, { bags: 0, kilos: 0 })
        const entry = byVarietyId.get(key)
        entry.bags += g.bags
        entry.kilos += g.kilos
      }
      for (const [varietyId, totals] of byVarietyId) {
        const groupLabel = (varietyId && varietyMap.get(varietyId)?.name) || '—'

        stockGroups[cerealType] ??= {}
        stockGroups[cerealType][groupLabel] ??= {}
        stockGroups[cerealType][groupLabel][bucket.label] ??= { bags: 0, kilos: 0 }
        stockGroups[cerealType][groupLabel][bucket.label].bags += totals.bags
        stockGroups[cerealType][groupLabel][bucket.label].kilos += totals.kilos

        groupVarietyId[cerealType] ??= {}
        groupVarietyId[cerealType][groupLabel] = varietyId || null
      }
      continue
    }

    const varietyName = p.variety?.name ?? '—'
    const needsSeparation = (weightsByVariety.get(varietyName)?.size ?? 0) > 1
    const byWeight = new Map()
    for (const g of breakdown) {
      if (!byWeight.has(g.weight)) byWeight.set(g.weight, { bags: 0, kilos: 0 })
      const entry = byWeight.get(g.weight)
      entry.bags += g.bags
      entry.kilos += g.kilos
    }

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
        <SummaryCard label="Total Bags" countUp={totalBags} format={fmtBags} />
        <SummaryCard
          label={weightUnit === 'mt' ? 'Total Net (MT)' : 'Total Net Bags'}
          countUp={weightUnit === 'mt' ? totalKilos : totalNetBags}
          format={weightUnit === 'mt' ? (v) => fmtWeight(v, 'mt') : fmtNetBags}
          sub
        />
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
    {/* Renders nothing visible - each mounts its own independent
        per-pile Dexie subscription (see PileWeightSubscriber's own
        comment above) and reports into pileStockBreakdown via onData. */}
    {piles.map((p) => (
      <PileWeightSubscriber
        key={p.pileId}
        pileId={p.pileId}
        warehouseCutoffDate={warehouseForCutoff?.reportingCutoffDate}
        sackTypes={pileWeightSackTypes}
        onData={handlePileWeightData}
      />
    ))}
    <div className="relative mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="absolute right-4 top-4">
        <PillToggle
          options={[{ value: false, label: 'Bags' }, { value: true, label: 'Net Bags' }]}
          value={showNetBags}
          onChange={setShowNetBags}
        />
      </div>
      {/* Keyed on both toggles AND the current warehouse (concept L,
          picked) so switching either a toggle or the warehouse itself
          replays this entrance animation on the now-different values,
          instead of the numbers just silently swapping in place. */}
      <div key={`${weightUnit}-${showNetBags}-${currentWarehouseId}`} className="animate-flow-down">
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
            <p className={`text-lg font-bold uppercase ${color}`}>{cerealType}</p>
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
                const isByProducts = cerealType === 'By Products'
                const flatUnwithdrawn = isByProducts && varietyId ? (unwithdrawnMap.get(varietyId) ?? null) : null

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
                    flatUnwithdrawn={flatUnwithdrawn}
                    isByProducts={isByProducts}
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
              const isByProducts = cerealType === 'By Products'
              const cerealVarietyIds = [...new Set(Object.values(groupVarietyId[cerealType] ?? {}))]
              const cerealUnwithdrawn = cerealVarietyIds.reduce((acc, vid) => {
                const uw = unwithdrawnMap.get(vid)
                return uw ? { bags: acc.bags + uw.bags, kilos: acc.kilos + uw.kilos } : acc
              }, { bags: 0, kilos: 0 })
              const cerealEffectiveShowNetBags = isByProducts ? false : showNetBags
              const cerealUnwithdrawnAmt = unwithdrawnAmount(cerealUnwithdrawn, cerealEffectiveShowNetBags)
              // By Products variety cards have no expand/collapse state
              // any more (see VarietyCard's own comment - age buckets
              // never genuinely applied there), so gating the Total's
              // own unwithdrawn/potential reveal on "some variety is
              // expanded" would mean it could never show at all for
              // that category. Only Rice/Palay still ties its Total
              // reveal to a variety being expanded.
              const hasCerealUnwithdrawn = (isByProducts || categoryHasExpanded) && cerealUnwithdrawnAmt >= (cerealEffectiveShowNetBags ? 0.005 : 1)
              const cerealUnitLabel = cerealEffectiveShowNetBags ? 'net bags' : 'bags'
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
                  unwithdrawnKilos={cerealUnwithdrawn.kilos}
                  unitLabel={cerealUnitLabel}
                  cerealVarietyIds={cerealVarietyIds}
                  onOpenDetail={setDetailContext}
                  rawBags={isByProducts}
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
        rawBags={detailContext.rawBags}
        onClose={() => setDetailContext(null)}
      />
    )}
    </>
  )
}

export default HomeStocks
