// Milling / Test Milling Operations Monitor - mirrors the existing
// AuthorityMonitor pattern (pending list, Completed toggle, tap to
// expand detail), but for MO/TMO operations instead of AI/SIA
// authorities. Shows both stock (WSR/WSI) and sack (ESR/ESI) activity
// together, since a milling operation always involves both.

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ChevronRight, ChevronUp, X, RefreshCw, Check, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { db } from '../../db/dexie.js'
import { computeMillingOrderStatuses } from '../../utils/millingOrderStatus.js'
import { useDebouncedLiveCompute } from '../../utils/useDebouncedLiveCompute.js'
import { fmtBags, fmtWeight, fmtNetBags, fmtKilos, calculateCurrentAge, AGE_BUCKETS, formatTrialLabel, expandTrialNumbers, todayLocalISO } from '../../utils/calculations.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { syncMillingOrdersFromSheets, stripWarehouseCodePrefix, markMillingOrderDone } from '../../services/googleSheetsBridge.js'
import CompletedMillingModal from './CompletedMillingModal.jsx'
import ShrinkFilterRow from './ShrinkFilterRow.jsx'
import { millingOrderMatchesQuery } from '../../utils/monitoringSearch.js'
import useDelayedUnmount from '../../hooks/useDelayedUnmount.js'

const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Same Palay/Rice/By-Products convention used everywhere else in the app
// (see HomeStocks.jsx's categoryColor) - kept here too so this modal's
// colors match instead of using its own ad hoc issue/receive palette.
const categoryColor = (category) =>
  category === 'Rice' ? 'text-blue-400' : category === 'Palay' ? 'text-brand-neon' : 'text-brand-byproduct'

export function MillingOrderDetail({ order, onClose }) {
  const [isClosing, setIsClosing] = useState(false)
  const [detailTab, setDetailTab] = useState('stocks')
  // Per explicit request/screenshots, the layout is now the reverse of
  // before: the summary (By Products/Source Warehouse/Last Activity/
  // Issued/Received) is what shows FIRST, by default - the Stocks/
  // Sacks transaction list only appears once the user actually asks
  // for it. Recovery stays visible in BOTH states (see below), since
  // it's the one figure worth comparing against regardless of which
  // view is open.
  const [showList, setShowList] = useState(false)
  // Summary and the transaction list are mutually exclusive - only one
  // is ever meant to be visible. Running each through its own
  // independent useDelayedUnmount (as a first attempt did) meant both
  // played their 250ms transitions in PARALLEL, so for that whole
  // window both sections were simultaneously mounted - doubling the
  // modal's content height and visibly overlapping mid-transition
  // (confirmed via screen recording). This instead SEQUENCES them:
  // `visibleSection` only flips to the new target once the old one's
  // exit animation has actually finished, so the two are never both on
  // screen at once - the currently-displayed section plays its exit
  // alone, then (and only then) the other one mounts and plays its
  // entrance.
  const SECTION_TRANSITION_MS = 250
  const [visibleSection, setVisibleSection] = useState('summary') // 'summary' | 'list'
  const targetSection = showList ? 'list' : 'summary'
  const isSectionLeaving = visibleSection !== targetSection
  // Render conditions derived from visibleSection (the CURRENTLY active
  // section, which lags behind targetSection until the transition timer
  // below fires).
  const shouldRenderSummary = visibleSection === 'summary'
  const shouldRenderList = visibleSection === 'list'
  useEffect(() => {
    if (!isSectionLeaving) return
    const timer = setTimeout(() => setVisibleSection(targetSection), SECTION_TRANSITION_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSection])
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, 300)
  }

  const { weightUnit, autoAgeMonitoring } = useSettings() ?? {}
  const allTx = [...order.issueTx, ...order.receiptTx].sort((a, b) => {
    const numA = parseInt(String(a.serialNo).replace(/\D/g, ''), 10)
    const numB = parseInt(String(b.serialNo).replace(/\D/g, ''), 10)
    if (Number.isNaN(numA) || Number.isNaN(numB)) return String(a.serialNo).localeCompare(String(b.serialNo))
    return numA - numB
  })
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const piles = useLiveQuery(() => db.piles.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const linkedAuthority = useLiveQuery(async () => {
    if (order.aiNumber) return db.authorities.where('aiNumber').equals(order.aiNumber).first()
    if (order.siaNumber) return db.authorities.where('siaNumber').equals(order.siaNumber).first()
    return null
  }, [order.aiNumber, order.siaNumber])
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w.name]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const pileMap = new Map(piles.map((p) => [p.pileId, p.pileName]))
  // Full pile records (not just the name) - needed to compute each
  // stock transaction's pile's current age/age-bucket the same way
  // HomeStocks.jsx does, using the pile's own initialAgeValue/
  // dateOfReceipt rather than anything stored on the transaction
  // itself (age isn't a transaction-level field - it's the pile's).
  const pileRecordMap = new Map(piles.map((p) => [p.pileId, p]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

  const stockTx = allTx.filter((t) => t.type === 'WSR' || t.type === 'WSI')
  const sackTx = allTx.filter((t) => t.type === 'ESR' || t.type === 'ESI')
  const stockCategoryOf = (t) => t.cerealCategory ?? varietyMap.get(t.varietyId)?.category ?? 'Unknown'
  const sackCategoryOf = (t) => {
    const first = (t.sackLines ?? [])[0]
    return sackTypeMap.get(first?.sackTypeId)?.category ?? t.cerealCategory ?? 'Unknown'
  }

  // Last transaction summary, replacing the previously always-static
  // "Pending" text with something actually informative - e.g. "BSI
  // issued PD1-A 300 bags on 06 Jul 2026".
  const lastTx = [...allTx].sort((a, b) => (a.date > b.date ? -1 : 1))[0]
  // Per explicit correction: the earlier version tried to pack
  // warehouse + category + variety + pile + amount + date into one
  // sentence, which produced a genuinely confusing result (a stray
  // double dash when variety/category both fell back to '—', "pcs"
  // with no indication of what that even meant next to a modal
  // otherwise focused on bags/kg). Stripped down to just what
  // happened, in its own correct unit - "sacks" for an ESI/ESR (sack)
  // transaction, "bags" for a WSI/WSR (stock) one, since those are two
  // different physical counts and conflating them under "pcs" was the
  // actual source of confusion, not just the wording. The date is no
  // longer part of this sentence at all - it's shown in the card's own
  // header instead (see the JSX below).
  const lastTxSummary = (() => {
    if (!lastTx) return null
    const isIssue = lastTx.type === 'WSI' || lastTx.type === 'ESI'
    const isSack = lastTx.type === 'ESI' || lastTx.type === 'ESR'
    const whName = stripWarehouseCodePrefix(warehouseMap.get(lastTx.warehouseId)) || '—'
    // Per explicit follow-up: bare "sacks" still didn't say what was
    // actually in them - naming the real sack type code(s) (e.g.
    // "PPRE50"), same lookup SackRow already uses, is what actually
    // answers "sacks of what?".
    const amount = isSack
      ? (() => {
          const lines = lastTx.sackLines ?? []
          const pieces = lines.reduce((s, l) => s + (l.pieces ?? 0), 0)
          const types = [...new Set(lines.map((l) => sackTypeMap.get(l.sackTypeId)?.code).filter(Boolean))].join(', ')
          return `${fmtBags(pieces)} ${types || 'sacks'}`
        })()
      : `${fmtBags(lastTx.numberOfBags)} bags`
    return `${whName} ${isIssue ? 'issued' : 'received'} ${amount}`
  })()

  // Recovery percent expressed as an equivalent net bags figure, per
  // explicit request - a 50kg bag is the standard conversion used
  // throughout this app's own weight calculations. Deliberately based
  // on the linked AI's own authorized allocation (authorityAllocationKilos),
  // NOT order.issuedKilos - the latter is the sum of actually-posted WSI
  // transactions, so it's 0 (or partial) until milling activity happens,
  // which made this card show a meaningless "0 bags" on fresh MOs and
  // silently disappear once transactions came in and issuedKilos math
  // stopped lining up with recoveryPercent's sheet-side blank rows. The
  // allocation is known at AI-issuance time, so this is always computable.
  const expectedBagsEquivalent = order.type === 'MO' && order.recoveryPercent != null && order.authorityAllocationKilos != null
    ? Math.round((order.authorityAllocationKilos * (order.recoveryPercent / 100)) / 50)
    : null

  // Once the order is done, "expected" switches from the allocation-
  // based preview above to what was actually ISSUED - that's the real
  // "did we get back what we should have for what was actually sent"
  // question, using the exact same math computeMillingOrderStatuses
  // already uses to decide `fulfilled` (an expected figure of 0 counts
  // as automatically met, same as there).
  const isCompleted = order.manuallyCompleted || order.sheetStatus === 'DONE' || order.fulfilled
  const expectedKilosFromIssued = order.type === 'MO' && order.recoveryPercent != null
    ? order.issuedKilos * (order.recoveryPercent / 100)
    : null
  // Per explicit request: the Recovery card's "Actual" must reflect
  // RICE recovery only - By Products (bran, etc.) is a distinct output
  // of the same milling run, not part of the recovery rate being
  // measured, so it must never inflate this figure the way it silently
  // did before (order.receivedKilos/receivedPieces mixed both
  // together). Same WSR/ESR receipt filter shape as byProductsBags
  // below, just inverted.
  const riceReceiptTx = allTx.filter((t) => (t.type === 'WSR' || t.type === 'ESR') && t.cerealCategory !== 'By Products')
  const riceReceivedKilos = riceReceiptTx.filter((t) => t.type === 'WSR').reduce((s, t) => s + (t.netKilos ?? 0), 0)

  const meetsExpectedKilos = expectedKilosFromIssued == null || expectedKilosFromIssued === 0 || riceReceivedKilos >= expectedKilosFromIssued
  const showRecoveryComparison = isCompleted && order.type === 'MO' && order.recoveryPercent != null
  // Per explicit request: the achieved recovery percentage sits inline
  // with the Expected/Actual labels themselves, so the target rate and
  // what was actually achieved can be compared at a glance right there,
  // instead of a separate row underneath (which also made this card
  // tall enough to overflow the modal). Below it, per explicit
  // correction, both columns show Net Bags (kg / 50) - the same unit
  // the Stocks card above uses - not a raw ESR sack-piece count, which
  // is a different physical quantity entirely and was the actual
  // source of confusion ("713 pieces" of what?), not just unlabeled.
  const actualRecoveryPercent = order.issuedKilos > 0 ? (riceReceivedKilos / order.issuedKilos) * 100 : null

  // By Products from this same milling run - same MO/TMO number, but
  // tagged with cerealCategory 'By Products' rather than the main
  // Rice/Palay product. Only relevant for receipts (WSR/ESR), since By
  // Products are a milling OUTPUT, not something issued to be milled.
  const byProductsReceiptTx = allTx.filter((t) => (t.type === 'WSR' || t.type === 'ESR') && t.cerealCategory === 'By Products')
  const byProductsBags = byProductsReceiptTx.reduce((sum, t) => {
    if (t.type === 'WSR') return sum + (t.numberOfBags ?? 0)
    return sum + (t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0)
  }, 0)
  // Per explicit request, the "By Products" card shows the ACTUAL bag
  // count (WSR's own numberOfBags field) rather than a Net-Bags figure
  // derived from kg/50 - a By Products bag isn't guaranteed to weigh
  // exactly 50kg the way this app's other "Net Bags" conversions
  // assume, so the real recorded count is the correct number to show
  // here, not an approximation. Per further explicit request, broken
  // down PER VARIETY (a By Products output can be more than one
  // variety - e.g. different bran grades from the same run), not
  // collapsed into a single combined total the way it was before.
  const byProductsReceivedByVariety = (() => {
    const map = new Map()
    for (const t of byProductsReceiptTx) {
      if (t.type !== 'WSR') continue
      const varietyName = varietyMap.get(t.varietyId)?.name ?? 'Unknown'
      map.set(varietyName, (map.get(varietyName) ?? 0) + (t.numberOfBags ?? 0))
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  })()

  // The issue side (WSI/ESI) is always the unmilled cereal sent TO the
  // mill - typically Palay, but read from the actual transactions
  // rather than hard-coded, in case a run's own cerealCategory differs.
  const issuedCategory = order.issueTx?.find((t) => t.cerealCategory)?.cerealCategory ?? 'Palay'

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`} onClick={handleClose}>
      <div
        className={`flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-neutral-800 bg-neutral-900 ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed section - never scrolls, only Transaction History below
            does. pb-0 only makes sense while that scrollable section is
            actually rendered right below it (its own pt-3 continues the
            spacing) - summary and the transaction list are mutually
            exclusive (see shouldRenderList above), so with the list
            open there's nothing below this section at all, and pb-0
            left its last block sitting flush against the modal's
            bottom edge with no gap. */}
        <div className={`shrink-0 p-4 ${shouldRenderList ? 'pb-0' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold text-app-text">{order.number}</p>
              <p className="text-base text-neutral-400">{order.ricemillName}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* AI/SIA, side by side (not stacked), each its own pill so
                  they read as clearly separate values - same in-line,
                  larger treatment as the list row card. */}
              {(order.aiNumber || order.siaNumber) && (
                <div className="flex items-center gap-1.5">
                  {order.aiNumber && (
                    <span className="rounded-md bg-brand-neon/10 px-2 py-1 text-xs font-bold tabular-nums text-brand-neon">
                      AI {order.aiNumber}
                    </span>
                  )}
                  {order.siaNumber && (
                    <span className="rounded-md bg-blue-500/10 px-2 py-1 text-xs font-bold tabular-nums text-blue-400">
                      SIA {order.siaNumber}
                    </span>
                  )}
                </div>
              )}
              <button type="button" onClick={handleClose} className="rounded-full p-2 text-brand-crimson transition-transform active:scale-90">
                <X size={26} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-base">
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-sm text-neutral-500">{order.type === 'MO' ? 'Batch' : 'Trials Recovered'}</p>
              <p className="font-semibold tabular-nums text-app-text">
                {order.type === 'MO'
                  ? `${order.batchCurrent} of ${order.batchTotal}`
                  : `${(order.recoveredTrials ?? []).length} of 3`}
              </p>
            </div>
            {order.receivingWarehouse && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <p className="text-sm text-neutral-500">Receiving Warehouse</p>
                <p className="font-semibold text-app-text">{order.receivingWarehouse}</p>
              </div>
            )}
          </div>

          {/* Per explicit request/screenshots: summary (By Products/
              Source Warehouse/Last Activity/Issued/Received) is what
              shows by default now - this button reveals the Stocks/
              Sacks transaction list instead, swapping the two, rather
              than a conditionally-hidden button that only appeared when
              optional fields had data. */}
          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-sm font-semibold text-brand-neon"
          >
            {showList ? 'Hide' : 'Show'} full list
            <ChevronUp size={12} className={`transition-transform ${showList ? '' : 'rotate-180'}`} />
          </button>

          {shouldRenderSummary && (
            <div className={!showList ? 'animate-flow-down' : 'animate-flow-up-exit'}>
              {byProductsBags > 0 && (
                <div className="mt-2 rounded-lg border border-brand-byproduct/40 bg-brand-byproduct/10 p-2">
                  <p className="text-sm text-neutral-500">By Products (Total)</p>
                  <p className="font-semibold tabular-nums text-brand-byproduct">{fmtBags(byProductsBags)} bags</p>
                </div>
              )}

              {linkedAuthority?.sourceWarehouse && (
                <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-base">
                  <p className="text-sm text-neutral-500">Source Warehouse</p>
                  <p className="font-semibold text-app-text">{linkedAuthority.sourceWarehouse}</p>
                </div>
              )}

              {lastTxSummary && (
                <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-neutral-500">Last Activity</p>
                    <p className="text-sm text-neutral-500">{fmtDate(lastTx.date)}</p>
                  </div>
                  <p className="mt-1 text-base font-medium text-app-text">{lastTxSummary}</p>
                </div>
              )}

              {/* Per explicit request: the first card is now the stock
                  (kilos-based) side of this run - what was issued
                  (Net Bags, kilos / 50, same derived-unit convention
                  already used in the NFA Ricemill monitor) alongside
                  what came back as Rice (also Net Bags, Rice only - see
                  riceReceivedKilos above). "Net Bags" is stated once in
                  the card's own header rather than repeated per row.
                  The second card is By Products only, as an actual bag
                  count rather than a Net Bags approximation - see
                  byProductsReceivedBags. */}
              <div className="mt-2 grid grid-cols-2 gap-2 text-base">
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                  <p className="text-sm text-neutral-500"><span className="uppercase">Stocks</span> <span className="text-neutral-600">(Net Bags)</span></p>
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-500">{issuedCategory} Issued</span>
                      <span className="font-semibold tabular-nums text-app-text">{fmtNetBags(order.issuedKilos != null ? order.issuedKilos / 50 : null)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-500">Rice Received</span>
                      <span className="font-semibold tabular-nums text-app-text">{fmtNetBags(riceReceivedKilos / 50)}</span>
                    </div>
                  </div>
                </div>
                {/* Per explicit request: broken down per variety (a By
                    Products output can be more than one variety from
                    the same run), not collapsed into one combined
                    total. */}
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                  <p className="text-sm text-neutral-500">By Products</p>
                  <div className="mt-1 space-y-1">
                    {byProductsReceivedByVariety.map(([varietyName, bags]) => (
                      <div key={varietyName} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-neutral-500">{varietyName}</span>
                        <span className="font-semibold tabular-nums text-app-text">{fmtBags(bags)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Per explicit request: Recovery stays visible regardless of
              which section above is open - it's the one figure worth
              comparing at a glance either way, not something tucked
              behind the summary/list toggle. */}
          {showRecoveryComparison ? (
            <div className={`mt-2 rounded-lg border-2 p-2 text-base ${meetsExpectedKilos ? 'border-brand-neon bg-brand-neon/5' : 'border-brand-amber bg-brand-amber/5'}`}>
              <p className="text-sm tabular-nums text-neutral-500"><span className="uppercase">Recovery</span> — Expected vs Actual</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div>
                  {/* Per explicit request: the recovery percentage sits
                      inline with the Expected/Actual label itself, not
                      as a separate row - this also keeps the card the
                      same height it was before the % was added, fixing
                      it overflowing past the modal. Expected's own
                      label is white, not the usual muted grey, per
                      explicit request. */}
                  <p className="text-xs uppercase text-app-text">Expected ({order.recoveryPercent}%)</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-500">Net Kgs</span>
                    <span className="font-semibold tabular-nums text-app-text">{fmtKilos(expectedKilosFromIssued)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-500">Net Bags</span>
                    <span className="font-semibold tabular-nums text-app-text">{fmtNetBags(expectedKilosFromIssued != null ? expectedKilosFromIssued / 50 : null)}</span>
                  </div>
                </div>
                <div>
                  <p className={`text-xs uppercase ${meetsExpectedKilos ? 'text-brand-neon' : 'text-brand-amber'}`}>Actual ({actualRecoveryPercent != null ? actualRecoveryPercent.toFixed(2) : '—'}%)</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-500">Net Kgs</span>
                    <span className={`font-semibold tabular-nums ${meetsExpectedKilos ? 'text-brand-neon' : 'text-brand-amber'}`}>{fmtKilos(riceReceivedKilos)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-500">Net Bags</span>
                    <span className={`font-semibold tabular-nums ${meetsExpectedKilos ? 'text-brand-neon' : 'text-brand-amber'}`}>{fmtNetBags(riceReceivedKilos / 50)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            expectedBagsEquivalent != null && (
              <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-base">
                <p className="text-sm tabular-nums text-neutral-500">Expected Recovery ({order.recoveryPercent}%)</p>
                <p className="font-semibold tabular-nums text-app-text">≈ {fmtBags(expectedBagsEquivalent)} bags</p>
              </div>
            )
          )}

          {shouldRenderList && (
            <div className={`relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1 ${showList ? 'animate-flow-down' : 'animate-flow-up-exit'}`}>
              <div
                className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
                style={{ transform: detailTab === 'stocks' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
              />
              <button type="button" onClick={() => setDetailTab('stocks')} className={`relative z-10 flex-1 rounded-lg py-1.5 text-sm uppercase ${detailTab === 'stocks' ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400'}`}>Stocks</button>
              <button type="button" onClick={() => setDetailTab('sacks')} className={`relative z-10 flex-1 rounded-lg py-1.5 text-sm uppercase ${detailTab === 'sacks' ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400'}`}>Sacks</button>
            </div>
          )}
        </div>

        {/* Only this section scrolls - hidden along with the tab bar
            above while the summary is showing instead, same reasoning:
            the fixed header was crowding out the list, so the two are
            mutually exclusive rather than both fighting for space. */}
        {shouldRenderList && (
          <div className={`min-h-0 flex-1 overflow-y-auto p-4 pt-3 ${showList ? 'animate-flow-down' : 'animate-flow-up-exit'}`}>
            <div key={detailTab} className="animate-flow-down">
              {detailTab === 'stocks' ? (
                <TransactionGroups
                  txs={stockTx}
                  categoryOf={stockCategoryOf}
                  renderRow={(t) => (
                    <StockRow key={t.id} t={t} warehouseMap={warehouseMap} varietyMap={varietyMap} pileMap={pileMap} pileRecordMap={pileRecordMap} weightUnit={weightUnit} autoAgeMonitoring={autoAgeMonitoring} />
                  )}
                />
              ) : (
                <TransactionGroups
                  txs={sackTx}
                  categoryOf={sackCategoryOf}
                  renderRow={(t) => (
                    <SackRow key={t.id} t={t} warehouseMap={warehouseMap} sackTypeMap={sackTypeMap} />
                  )}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// Shared Issued/Received -> cereal (or sack) type grouping shell for both
// tabs - only the row renderer and the category-resolution function differ.
function TransactionGroups({ txs, categoryOf, renderRow }) {
  const issued = txs.filter((t) => t.type === 'WSI' || t.type === 'ESI')
  const received = txs.filter((t) => t.type === 'WSR' || t.type === 'ESR')
  const groupByCategory = (list) => {
    const groups = new Map()
    for (const t of list) {
      const key = categoryOf(t)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(t)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }

  if (txs.length === 0) return <p className="py-2 text-center text-sm text-neutral-500">No transactions recorded yet.</p>

  return (
    <div className="space-y-4">
      {[{ label: 'Issued', list: issued }, { label: 'Received', list: received }].map(({ label, list }) => (
        list.length > 0 && (
          <div key={label}>
            <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
            <div className="mt-2 space-y-3">
              {groupByCategory(list).map(([category, catTxs]) => (
                <div key={category}>
                  <p className={`text-sm font-semibold ${categoryColor(category)}`}>{category}</p>
                  <ul className="mt-1 space-y-2 [contain:layout]">{catTxs.map(renderRow)}</ul>
                </div>
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  )
}

function StockRow({ t, warehouseMap, varietyMap, pileMap, pileRecordMap, weightUnit, autoAgeMonitoring }) {
  const isIssue = t.type === 'WSI'
  // Age isn't a field on the transaction itself - it's the pile's own
  // initialAgeValue/dateOfReceipt, computed the same way HomeStocks.jsx
  // does for its age-bucket grouping. A transaction with no pileId
  // (e.g. a sack-only or unassigned-pile flow) has nothing to compute
  // this from.
  const pile = t.pileId ? pileRecordMap.get(t.pileId) : null
  const ageLabel = (() => {
    if (!pile) return null
    const category = t.cerealCategory ?? varietyMap.get(t.varietyId)?.category ?? 'Rice'
    const age = calculateCurrentAge(pile.initialAgeValue ?? 0, pile.dateOfReceipt, autoAgeMonitoring)
    const buckets = AGE_BUCKETS[category] ?? AGE_BUCKETS.Rice
    const bucket = buckets.find((b) => b.test(age)) ?? buckets[buckets.length - 1]
    return `${age}d · ${bucket.label}`
  })()
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-app-text">
          {t.type} # {t.serialNo}{t.trialNumber ? ` · ${formatTrialLabel(t.trialNumber)}` : ''}
        </span>
        <span className="text-neutral-500">{fmtDate(t.date)}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-neutral-400">
        <div>
          <p className="text-xs uppercase text-neutral-600">{isIssue ? 'Issuing Warehouse' : 'Receiving Warehouse'}</p>
          <p className="text-app-text">{warehouseMap.get(t.warehouseId) ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-neutral-600">Variety</p>
          <p className="text-app-text">{varietyMap.get(t.varietyId)?.name ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-neutral-600">Pile</p>
          <p className="text-app-text">{t.pileId ? (pileMap.get(t.pileId) ?? '—') : '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-neutral-600">Age</p>
          <p className="text-app-text">{ageLabel ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-neutral-600">Bags</p>
          <p className="tabular-nums text-app-text">{fmtBags(t.numberOfBags)}</p>
        </div>
        <div>
          {/* Label already says "Net Kgs" - the value itself no longer
              repeats that wording (fmtWeight's own 'Net' label param
              would glue "Net Kgs"/"Net MT" onto the number), just the
              bare figure + unit, per explicit request. */}
          <p className="text-xs uppercase text-neutral-600">Net Kgs</p>
          <p className="tabular-nums text-app-text">{fmtWeight(t.netKilos ?? 0, weightUnit)}</p>
        </div>
      </div>
    </li>
  )
}

function SackRow({ t, warehouseMap, sackTypeMap }) {
  const isIssue = t.type === 'ESI'
  const lines = t.sackLines ?? []
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-app-text">
          {t.type} # {t.serialNo}{t.trialNumber ? ` · ${formatTrialLabel(t.trialNumber)}` : ''}
        </span>
        <span className="text-neutral-500">{fmtDate(t.date)}</span>
      </div>
      <div className="mt-1.5">
        <p className="text-xs uppercase text-neutral-600">{isIssue ? 'Issuing Warehouse' : 'Receiving Warehouse'}</p>
        <p className="text-app-text">{warehouseMap.get(t.warehouseId) ?? '—'}</p>
      </div>
      {lines.length > 0 && (
        <div className="mt-1.5 space-y-1 border-t border-neutral-800 pt-1.5">
          {lines.map((l, i) => {
            const st = sackTypeMap.get(l.sackTypeId)
            return (
              <div key={i} className="flex items-center justify-between text-neutral-400">
                <span className="text-app-text">{st?.code ?? '—'} · {l.condition ?? '—'}</span>
                <span className="tabular-nums">{fmtBags(l.pieces ?? 0)} pcs</span>
              </div>
            )
          })}
        </div>
      )}
    </li>
  )
}

// Shared pending/completed row renderer - identical progress-bar math
// and layout for both MillingMonitor's inline pending list and
// CompletedMillingModal's list, extracted so the two never drift.
export function MillingOrderRow({ order: o, onSelect, isAdmin = false, isAnimating = false, onToggleComplete, matches = true, gapClass = 'mt-1.5' }) {
  // Progress is issuance (0-50%) plus receipt (0-50%), not a single
  // received-vs-expected ratio - so a fully-issued but not-yet-received
  // order still shows real, visible progress (50%) rather than nothing
  // until receipts start.
  const roundTo3 = (n) => Math.round(n * 1000) / 1000

  // TMO tracks TRIAL COUNT on both halves, not kg/pieces - a
  // fully-issued-but-unreceived TMO should show exactly half full
  // ("Trial 3 of 3" issued, "Trial 0 of 3" received) as a clear visual
  // glimpse without opening the detail. MO is completely unaffected,
  // keeping the kg-based calculation below exactly as it was.
  const issuedTrialsCount = o.type === 'TMO'
    ? new Set((o.issueTx ?? []).flatMap((t) => expandTrialNumbers(t.trialNumber))).size
    : null
  const receivedTrialsCount = o.type === 'TMO' ? (o.recoveredTrials ?? []).length : null

  const issuanceProgress = o.type === 'TMO'
    ? roundTo3(Math.min(1, issuedTrialsCount / 3) * 50)
    : roundTo3(
        (o.authorityAllocationKilos
          ? Math.min(1, o.issuedKilos / o.authorityAllocationKilos)
          : (o.issuedKilos > 0 || o.issuedPieces > 0) ? 1 : 0
        ) * 50
      )

  // Receipt half: proportional to received vs. expected recovery
  // (issued x recovery%, per net kgs - e.g. 30,000kg issued at 63%
  // recovery expects 18,900kg back). Sacks use pieces instead of kilos
  // the same way. Falls back to received-vs-issued directly when no
  // recovery % is set.
  let receiptProgress
  if (o.type === 'TMO') {
    receiptProgress = roundTo3(Math.min(1, receivedTrialsCount / 3) * 50)
  } else {
    const expectedKilos = o.recoveryPercent != null ? o.issuedKilos * (o.recoveryPercent / 100) : null
    const expectedPieces = o.recoveryPercent != null ? o.issuedPieces * (o.recoveryPercent / 100) : null
    const kilosReceiptRatio = expectedKilos
      ? Math.min(1, o.receivedKilos / expectedKilos)
      : o.issuedKilos > 0 ? Math.min(1, o.receivedKilos / o.issuedKilos) : 0
    const piecesReceiptRatio = expectedPieces
      ? Math.min(1, o.receivedPieces / expectedPieces)
      : o.issuedPieces > 0 ? Math.min(1, o.receivedPieces / o.issuedPieces) : 0
    receiptProgress = roundTo3(Math.max(kilosReceiptRatio, piecesReceiptRatio) * 50)
  }

  const progress = roundTo3(issuanceProgress + receiptProgress)
  const hasIssuance = o.issuedKilos > 0 || o.issuedPieces > 0
  const isCompleted = o.manuallyCompleted || o.sheetStatus === 'DONE' || o.fulfilled
  // The kg/piece math behind o.fulfilled only ever tracks the primary
  // stock recovery (rice) - By Products receipts are real but entered
  // inconsistently enough that the app can't verify them, so an order
  // reading as "fulfilled" is a signal to double-check, not proof the
  // whole order (rice + by-products) is actually done. Completion is
  // manual-only now (see isOrderCompleted in MillingMonitor) - this
  // just flags, via an amber border, a pending order whose numbers
  // already look done so the admin knows to go check and confirm it.
  const needsConfirmation = o.fulfilled && !o.manuallyCompleted && o.sheetStatus !== 'DONE'
  // Shows checked/unchecked immediately on tap, independent of the
  // (deliberately delayed) DB write - same pattern as the AI/SIA
  // Monitor's own checkbox.
  const showsChecked = o.manuallyCompleted || isAnimating

  return (
    <ShrinkFilterRow as="li" matches={matches} gapClass={gapClass}>
    <div className={`flex items-stretch gap-2 ${isAnimating ? 'animate-row-complete-out pointer-events-none' : ''}`}>
      {isAdmin && onToggleComplete && (
        <button
          type="button"
          onClick={(e) => onToggleComplete(o, e)}
          aria-label={showsChecked ? 'Mark as pending' : 'Mark as completed'}
          className={`flex w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
            showsChecked
              ? 'border-brand-neon/40 bg-brand-neon/10 text-brand-neon'
              : 'border-neutral-800 text-neutral-600 hover:text-neutral-400'
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-md border ${
              showsChecked ? 'border-brand-neon bg-brand-neon/20' : 'border-neutral-700'
            }`}
          >
            {showsChecked && <Check size={14} />}
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => onSelect(o)}
        className={`flex flex-1 items-center justify-between gap-3 rounded-xl border bg-neutral-950 px-3 py-2.5 text-left active:scale-[0.99] ${
          needsConfirmation ? 'border-brand-amber' : 'border-neutral-800'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-base font-semibold text-app-text">{o.number}</p>
            {/* AI/SIA, in-line with the MO/TMO number itself (same row,
                right edge) per explicit request - larger and easier to
                read than the earlier corner-badge attempt, and doesn't
                add any extra height to the card the way a separate top
                row did. Side by side (not stacked), each its own pill so
                they read as clearly separate values. Visible to every
                role now (this card is shared between the regular user's
                Home and AdminMonitoring), not just the admin-only AI/SIA
                tab it used to be confined to. Every MO/TMO genuinely
                carries BOTH its own AI and SIA (confirmed directly
                against the real Sheet) - shows both when both exist. */}
            {(o.aiNumber || o.siaNumber) && (
              <div className="flex shrink-0 items-center gap-1.5">
                {o.aiNumber && (
                  <span className="rounded-md bg-brand-neon/10 px-2 py-1 text-xs font-bold tabular-nums text-brand-neon">
                    AI {o.aiNumber}
                  </span>
                )}
                {o.siaNumber && (
                  <span className="rounded-md bg-blue-500/10 px-2 py-1 text-xs font-bold tabular-nums text-blue-400">
                    SIA {o.siaNumber}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="truncate text-sm text-neutral-500">
            {o.ricemillName}
            {o.type === 'MO' && o.batchCurrent != null && ` · Batch ${o.batchCurrent} of ${o.batchTotal}`}
          </p>
          {hasIssuance && (
            <>
              {o.type === 'TMO' && (
                <div className="mt-1.5 flex justify-between text-xs tabular-nums text-neutral-500">
                  <span>Trial {issuedTrialsCount} of 3 issued</span>
                  <span>Trial {receivedTrialsCount} of 3 received</span>
                </div>
              )}
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full rounded-full transition-all ${isCompleted ? 'bg-brand-neon' : 'bg-brand-amber'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isCompleted && (o.issuedKilos > 0 || o.issuedPieces > 0) && (
            <AlertTriangle size={14} className="text-brand-amber" />
          )}
          <ChevronRight size={18} className="text-neutral-600" />
        </div>
      </button>
    </div>
    </ShrinkFilterRow>
  )
}

// ── Milling Overview panel (donut + per-order urgency list) ────────────
// Per explicit request (built from the "G1" demo round): sits above the
// MO/TMO list, pending orders only, one instance per tab - since the
// caller's `filtered` is already scoped to whichever tab (Milling/Test
// Milling) is currently active, rendering this once per tab switch
// automatically gives "one overview for Milling and another for Test
// Milling" with no extra plumbing needed.
//
// Donut buckets, per explicit request/correction: On Hand (a real WSI
// issuance exists for this MO/TMO - palay is actually on hand at the
// miller - regardless of whether some has already been received back;
// the old separate "Partial" bucket is gone, folded into On Hand, since
// an order that's been partially received still has real stock on hand
// until fully fulfilled), Waiting (the MO/TMO record exists but has no
// WSI or WSR against it at all yet - nothing has physically happened),
// Ready to Complete (o.fulfilled - the exact same "looks done" signal
// the pending list's own amber-border needsConfirmation cue already
// uses elsewhere in this file, not a new definition of "done").
//
// G1 (not G2/G3): one shared list, not a separate flagged section - an
// overdue On Hand row (nothing received back for OVERDUE_DAYS+) gets
// its own tinted background and day-count badge in place, instead of
// also appearing a second time elsewhere. Capped to a handful of rows,
// prioritized On Hand-oldest-first (most urgent), then Waiting-oldest-
// first, then Ready-to-Complete-newest-first - this stays a genuine
// "at a glance" panel, not the full list restated a second time.
const DONUT_R = 70
const DONUT_C = 2 * Math.PI * DONUT_R
const OVERDUE_DAYS = 7
// 6, not 5 - divides evenly into both the 2-column (sm) and 3-column
// (lg) grid the Per-Order Status list now uses on wider screens, so the
// last row never sits alone with empty space beside it.
const OVERVIEW_ROW_CAP = 6

// Per explicit request: "On Hand" now means specifically that palay was
// actually issued to the miller (a real WSI exists) and nothing has come
// back yet - checked directly against issuedKilos/issuedPieces, not
// inferred from the absence of a receipt. The old "Partial" bucket
// (some received, not yet fulfilled) is gone - an order that's been
// partially received still has real stock on hand at the miller until
// it's fully fulfilled, so it now folds into "On Hand" too, matching the
// explicit instruction to remove Partial rather than rename it. "Waiting"
// replaces it as a genuinely different state: an MO/TMO record exists
// but has no WSI (issuance) or WSR (receipt) against it yet at all -
// nothing has physically happened for this order yet.
const orderBucket = (o) => {
  if (o.fulfilled) return 'ready'
  const issued = (o.issuedKilos ?? 0) + (o.issuedPieces ?? 0)
  return issued > 0 ? 'onHand' : 'waiting'
}

const daysSince = (dateStr) => {
  if (!dateStr) return null
  const then = new Date(`${dateStr}T00:00:00`)
  const now = new Date(`${todayLocalISO()}T00:00:00`)
  return Math.max(0, Math.round((now - then) / (1000 * 60 * 60 * 24)))
}

const BUCKET_META = {
  onHand: { label: 'On Hand', color: '#F5A524', dotClass: 'bg-brand-amber', statusText: 'on hand' },
  waiting: { label: 'Waiting', color: '#378ADD', dotClass: 'bg-blue-400', statusText: 'waiting' },
  ready: { label: 'Ready to Complete', color: '#00FFA3', dotClass: 'bg-brand-neon', statusText: 'fully received' },
}
const BUCKET_RANK = { onHand: 0, waiting: 1, ready: 2 }

// Per explicit request: the sub-line under each row shows the actual
// WAREHOUSE the stock moved through, not the MO/TMO number (already
// shown as this whole panel's own context, and less useful here than
// "where"). On Hand (nothing received back yet) shows the warehouse
// that ISSUED stock to the mill (from the order's own issue
// transactions' warehouseId) - that's the confirmed meaning of "On
// Hand": a warehouse has sent stock to the ricemill, still there.
// Ready shows the warehouse the milled product came back INTO instead -
// order.receivingWarehouse is already a real field on the synced order
// record for this, falling back to a receipt transaction's own
// warehouseId only if that field is somehow blank.
//
// Reported real bug: Waiting (no WSI posted yet at all) was also
// falling into the receivingWarehouse branch, showing the warehouse the
// milled product is expected to come BACK to - but a Waiting order has
// no stock movement of either direction yet, so "waiting" specifically
// means waiting on the ISSUING warehouse to act, not the receiving one.
// There's no dedicated issuing-warehouse field on the order itself, but
// its linked AI/SIA authority's assignedWarehouse (see
// millingOrderStatus.js) is exactly that - the warehouse authorized to
// issue against it, decided before any real transaction happens.
const resolveOrderWarehouseLabel = (o, warehouseMap) => {
  const bucket = orderBucket(o)
  if (bucket === 'onHand') {
    const issueWhId = o.issueTx?.[0]?.warehouseId
    const name = issueWhId ? warehouseMap.get(issueWhId)?.name : null
    return name ? stripWarehouseCodePrefix(name) : null
  }
  if (bucket === 'waiting') {
    const name = o.authorityAssignedWarehouse ? warehouseMap.get(o.authorityAssignedWarehouse)?.name : null
    return name ? stripWarehouseCodePrefix(name) : null
  }
  if (o.receivingWarehouse) return o.receivingWarehouse
  const receiptWhId = o.receiptTx?.[0]?.warehouseId
  const name = receiptWhId ? warehouseMap.get(receiptWhId)?.name : null
  return name ? stripWarehouseCodePrefix(name) : null
}

function MillingOverviewPanel({ filtered, lastActivityDate, warehouseMap }) {
  if (filtered.length === 0) return null

  const total = filtered.length
  const counts = { onHand: 0, waiting: 0, ready: 0 }
  for (const o of filtered) counts[orderBucket(o)] += 1

  let cursor = 0
  const arcs = ['onHand', 'waiting', 'ready']
    .map((key) => {
      const length = total > 0 ? (counts[key] / total) * DONUT_C : 0
      const arc = { key, length, offset: -cursor, ...BUCKET_META[key] }
      cursor += length
      return arc
    })
    .filter((a) => a.length > 0)

  const rows = filtered
    .map((o) => {
      const bucket = orderBucket(o)
      const lastDate = lastActivityDate(o)
      return { order: o, bucket, lastDate, days: daysSince(lastDate) }
    })
    .sort((a, b) => {
      if (BUCKET_RANK[a.bucket] !== BUCKET_RANK[b.bucket]) return BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket]
      return a.bucket === 'ready' ? b.lastDate.localeCompare(a.lastDate) : a.lastDate.localeCompare(b.lastDate)
    })
    .slice(0, OVERVIEW_ROW_CAP)

  // Per explicit follow-up feedback: reworked again from "grouped by
  // ricemill" to "grouped by status" - three columns (On Hand/Waiting/
  // Ready to Complete), one per status, side by side on a large display
  // (matching the donut legend's own 3 statuses 1:1) so a wide screen's
  // space is actually used instead of one narrow list with huge empty
  // margins either side. Stacks back into one section-per-status column
  // on a narrow screen, in the same bucket priority order the rows
  // themselves already sort by. The ricemill name now lives on each
  // entry itself (bold, first line) rather than as a shared group
  // heading, since a mill can appear under more than one status column.
  const rowsByBucket = { onHand: [], waiting: [], ready: [] }
  for (const row of rows) rowsByBucket[row.bucket].push(row)

  return (
    // Per explicit feedback: on a wider viewport this used to stay
    // exactly as small as on mobile, wasting most of the card's own
    // available width - sm:/lg: breakpoints below scale the donut up,
    // widen the legend, and let Per-Order Status flow into two columns
    // once there's genuinely room for it, instead of one narrow column
    // with empty space beside it.
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 sm:p-4">
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="relative h-[92px] w-[92px] shrink-0 sm:h-[130px] sm:w-[130px]">
          <svg viewBox="0 0 168 168" className="h-full w-full">
            <circle cx="84" cy="84" r={DONUT_R} fill="none" stroke="#1c1c1f" strokeWidth="20" />
            {arcs.map((a) => (
              <circle
                key={a.key} cx="84" cy="84" r={DONUT_R} fill="none" stroke={a.color} strokeWidth="20"
                strokeDasharray={`${a.length} ${DONUT_C}`} strokeDashoffset={a.offset}
                transform="rotate(-90 84 84)"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-extrabold tabular-nums text-app-text sm:text-3xl">{total}</span>
            <span className="text-[9px] uppercase tracking-wide text-neutral-500 sm:text-xs">Pending</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-sm sm:gap-3">
          {['onHand', 'waiting', 'ready'].map((key) => (
            <div key={key} className="flex items-center gap-2 text-xs sm:gap-3 sm:text-base">
              <span className="h-2 w-2 shrink-0 rounded-sm sm:h-3 sm:w-3" style={{ background: BUCKET_META[key].color }} />
              <span className="min-w-0 flex-1 truncate font-semibold text-app-text">{BUCKET_META[key].label}</span>
              <span className="shrink-0 font-extrabold tabular-nums" style={{ color: BUCKET_META[key].color }}>{counts[key]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 border-t border-neutral-800 pt-3 sm:mt-4 sm:pt-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 sm:text-xs">Per Ricemill Status</p>
        <div className="mt-2 space-y-4 lg:grid lg:grid-cols-3 lg:gap-x-6 lg:space-y-0">
          {['onHand', 'waiting', 'ready'].map((bucket) => {
            const bucketRows = rowsByBucket[bucket]
            if (bucketRows.length === 0) return null
            return (
              <div key={bucket} className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${BUCKET_META[bucket].dotClass}`} />
                  <p className="text-sm font-bold text-app-text sm:text-base">{BUCKET_META[bucket].label}</p>
                </div>
                <div className="mt-2 space-y-2.5">
                  {bucketRows.map(({ order: o, days }) => {
                    const overdue = bucket === 'onHand' && days != null && days >= OVERDUE_DAYS
                    // Per explicit feedback (two rounds): text was
                    // unreadably small on a large display, AND the
                    // batch number (once pushed to the far edge via
                    // justify-between) left a huge, wasteful gap on a
                    // wide column - kept grouped in the same line as
                    // the warehouse/days text, and every size here
                    // scales up on sm: like the rest of this panel.
                    const detailParts = [
                      resolveOrderWarehouseLabel(o, warehouseMap) ?? o.number,
                      days != null && !overdue ? (days === 0 ? 'today' : `${days}d ago`) : null,
                      o.type === 'MO' && o.batchCurrent != null ? `Batch ${o.batchCurrent} of ${o.batchTotal}` : null,
                    ].filter(Boolean)
                    return (
                      <div key={o.orderId} className={overdue ? 'rounded-lg bg-brand-crimson/5 p-1.5' : ''}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-app-text sm:text-base">{o.ricemillName}</p>
                          {overdue && (
                            <span className="shrink-0 rounded bg-brand-crimson/15 px-1.5 py-0.5 text-xs font-bold text-brand-crimson">⚠ {days}d</span>
                          )}
                        </div>
                        <p className="truncate text-xs text-neutral-500 sm:text-sm">{detailParts.join(' · ')}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MillingMonitor({ isAdmin = false, active = true }) {
  const [topTab, setTopTab] = useState('MO')
  const [showCompletedModal, setShowCompletedModal] = useState(false)
  const [regionalAuthFilter, setRegionalAuthFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)
  const containerRef = useRef(null)
  // orderId currently playing its "marked complete" glow+collapse exit
  // animation - admin-only, mirrors AuthorityMonitor.jsx's exact
  // pattern (delayed DB write, cleared only once the live query
  // confirms the order has actually left the pending list).
  const [completingId, setCompletingId] = useState(null)

  // computeMillingOrderStatuses reads db.millingOrders/db.transactions/
  // db.authorities across every warehouse's own MO/TMO orders - the
  // same expensive-computation-directly-inside-useLiveQuery shape
  // AdminHomeStocks.jsx already hit (docs/technical-design-document.md
  // §2.12): any incoming Dexie Cloud sync write to db.transactions
  // retriggered this admin-wide scan, and useLiveQuery kept showing its
  // previous result while a new one computed, making this page feel
  // sluggish/frozen under real sync traffic. Uses the same shared
  // useDebouncedLiveCompute fix.
  //
  // Confirmed, reported real bug: this component stays mounted the
  // whole time a Monitoring tab is open (see this file's own comment
  // further down), so even with the debounce/maxWait fix, the recompute
  // was still firing on its own cadence in the background while the
  // user was actively on a DIFFERENT Monitoring tab (e.g. marking an
  // authority complete on AI/SIA) - visible as dropped frames/stutter
  // on that other tab's own animation, since this recompute still
  // shares the same single JS main thread. The change signal is frozen
  // to a constant while `active` is false, so no new debounce/maxWait
  // timer ever gets scheduled until this tab is genuinely being looked
  // at again - `orders` simply keeps showing its last-known value while
  // inactive (never cleared), so switching back to this tab shows real
  // data immediately, then refreshes shortly after if anything changed
  // while it was frozen.
  const millingTxCount = useLiveQuery(() => db.transactions.count(), []) ?? 0
  const millingOrderCount = useLiveQuery(() => db.millingOrders.count(), []) ?? 0
  const authorityCountForOrders = useLiveQuery(() => db.authorities.count(), []) ?? 0
  const ordersChangeSignal = active
    ? `${topTab}:${millingTxCount}:${millingOrderCount}:${authorityCountForOrders}`
    : `frozen:${topTab}`
  const ordersRaw = useDebouncedLiveCompute(
    () => computeMillingOrderStatuses(topTab),
    ordersChangeSignal,
    [],
    { maxWaitMs: 30000 }
  )
  const orders = ordersRaw ?? []
  const authorities = useLiveQuery(() => db.authorities.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))

  useEffect(() => {
    if (!completingId) return
    const stillPending = orders.some((o) => o.orderId === completingId && !(o.manuallyCompleted || o.sheetStatus === 'DONE'))
    if (!stillPending) setCompletingId(null)
  }, [orders, completingId])

  // Reported: switching MO/TMO, or navigating away to a different
  // Monitoring tab and back (this component stays mounted the whole
  // time - see AdminMonitoring.jsx's own comment on why), left the old
  // search text sitting there. This component has no `active` prop of
  // its own to unmount on - reset explicitly instead, on either signal.
  useEffect(() => {
    setSearchQuery('')
  }, [topTab])
  useEffect(() => {
    if (!active) setSearchQuery('')
  }, [active])

  // Reported: searching while scrolled down never brought the matching
  // rows into view - and a first version that only scrolled once (empty
  // -> non-empty) wasn't enough, per follow-up feedback: continuing to
  // type needs to keep bringing the (changing) results into view too.
  // Scrolls this card into view on every real change to the search text.
  useEffect(() => {
    if (searchQuery.trim()) containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [searchQuery])

  // Must match .animate-row-complete-out's duration in index.css.
  const ROW_EXIT_MS = 700

  const toggleManualComplete = (order, e) => {
    e.stopPropagation()
    setCompletingId(order.orderId)
    setTimeout(() => {
      db.millingOrders.update(order.orderId, { manuallyCompleted: true })
      // Best-effort, fire-and-forget - same pattern already used
      // elsewhere for natural completion (StockFormBase/SackFormBase).
      // The local flag is the source of truth either way; this just
      // keeps the Sheet's own STATUS column in sync for anyone viewing
      // it directly.
      markMillingOrderDone(order.type, order.number)
    }, ROW_EXIT_MS)
  }

  const handleSyncNow = async () => {
    setIsSyncing(true)
    const result = await syncMillingOrdersFromSheets()
    setIsSyncing(false)
    if (result.ok) {
      toast.success(`Synced ${result.count} MO/TMO record(s)`)
    } else if (result.reason === 'already_syncing') {
      toast.error('A sync is already in progress — try again in a moment')
    } else if (result.reason === 'offline') {
      toast.error('No connection — try again once online')
    } else {
      toast.error('Sync failed — check the console for details')
    }
  }

  // Regional Authority Number (and every other authority-linked field a
  // broad search should match - customer name, O.R. number, remarks...)
  // comes from the AI/SIA the order links to (via the order's own
  // aiNumber/siaNumber), not stored on the order directly.
  const authorityByOrderId = new Map(
    orders.map((o) => [
      o.orderId,
      authorities.find((a) => (o.aiNumber && a.aiNumber === o.aiNumber) || (o.siaNumber && a.siaNumber === o.siaNumber)) ?? null,
    ])
  )
  const regionalAuthByOrder = new Map(
    [...authorityByOrderId].map(([orderId, auth]) => [orderId, auth?.regionalAuthorityNumber ?? null])
  )
  // Broad match (MO/TMO number, ricemill name, receiving warehouse,
  // plus the linked authority's customer name, regional/AI/SIA number,
  // O.R. number, remarks/notes, source warehouse) per explicit request -
  // see monitoringSearch.js for the exact field list. Kept separate from
  // the pending-list filter below so non-matching rows stay mounted and
  // animate away/back in as the user types (see ShrinkFilterRow).
  const matchesQuery = (o) => millingOrderMatchesQuery(o, searchQuery, authorityByOrderId.get(o.orderId), warehouseMap)

  // Sheet-marked DONE is unconditionally completed, regardless of what
  // the kg/piece-based fulfilled calculation separately says -
  // previously only fulfilled was checked here, so an order marked
  // DONE directly on the sheet but not also satisfying that math (e.g.
  // missing/mismatched recovery %) would incorrectly keep showing in
  // the pending list forever.
  //
  // Deliberately NOT filtering out orders whose only local activity
  // predates the earliest configured Sheet Source's Date From - a
  // previous version of this filter did that and it hid the order
  // from BOTH the pending and Completed lists entirely, not just from
  // some separate total. Any synced MO/TMO the user still needs to
  // act on (e.g. entering a By Products receipt for an order that
  // happens to have one old transaction) must stay visible somewhere -
  // matches the same rule already established for AI/SIA Authorities
  // (round 8: cutoff excludes pre-cutoff data from the inventory MATH
  // only, never from AuthorityMonitor's own pending/completed lists).
  const passesSharedFilters = (o) => {
    if (regionalAuthFilter.trim() && regionalAuthByOrder.get(o.orderId) !== regionalAuthFilter.trim()) return false
    return true
  }
  // Completion is manual-only, per explicit request: o.fulfilled (the
  // kg/piece recovery math) only ever tracks primary stock, never By
  // Products - a real MO/TMO with inconsistently-entered by-products
  // receipts can read as "fulfilled" while genuinely still open. An
  // order this is true of shows an amber border in the pending list
  // instead (see needsConfirmation in MillingOrderRow above) so the
  // admin can verify and mark it complete themselves, rather than the
  // app silently moving it to Completed on its own.
  const isOrderCompleted = (o) => o.manuallyCompleted || o.sheetStatus === 'DONE'
  // Inline list is always pending-only now - completed orders live in
  // their own modal (CompletedMillingModal below) instead of replacing
  // this list in place, matching the AI/SIA Monitor's own
  // pending-list/separate-completed-modal convention.
  // Sorted by MO/TMO number, descending (was previously unsorted -
  // Dexie's cursor order on a `where('type').equals()` query is not
  // guaranteed to match the Sheet's own row/number order), per
  // explicit request. `numeric: true` makes "...-10" sort before
  // "...-9" (not after, which plain string comparison would give).
  const filtered = orders
    .filter((o) => !isOrderCompleted(o) && passesSharedFilters(o))
    .sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true, sensitivity: 'base' }))
  // Newest activity first, oldest last - per explicit request, matches
  // CompletedAuthorityModal's own newest-first sort.
  const lastActivityDate = (o) => {
    const dates = [...(o.issueTx ?? []), ...(o.receiptTx ?? [])].map((t) => t.date).filter(Boolean)
    if (dates.length) return dates.reduce((max, d) => (d > max ? d : max))
    // No local transaction ever posted for this order (fully done via
    // some other path before this app tracked it, or never transacted
    // through the app at all) - fall back to the Sheet's own recorded
    // milling date instead of sorting it into an arbitrary position.
    return o.dateOfMilling ?? ''
  }
  const completedFiltered = orders
    .filter((o) => isOrderCompleted(o) && passesSharedFilters(o))
    .sort((a, b) => lastActivityDate(b).localeCompare(lastActivityDate(a)))

  const availableRegionalAuthNumbers = [...new Set([...regionalAuthByOrder.values()].filter(Boolean))].sort()

  return (
    <div ref={containerRef} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <h2 className="text-base font-semibold text-app-text">Milling Operations</h2>
          <ChevronUp size={16} className={`shrink-0 text-neutral-500 transition-transform ${isExpanded ? '' : 'rotate-180'}`} />
        </button>
        {isExpanded && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={isSyncing}
            aria-label="Sync MO/TMO Now"
            className="flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 transition-all active:scale-90 disabled:opacity-50"
          >
            <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => setShowCompletedModal(true)}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-400 transition-all active:scale-95"
          >
            Show Completed
          </button>
        </div>
        )}
      </div>

      {isExpanded && (
      <div className="relative mt-3 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: topTab === 'MO' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {['MO', 'TMO'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTopTab(t)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-base ${topTab === t ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400'}`}
          >
            {t === 'MO' ? 'Milling' : 'Test Milling'}
          </button>
        ))}
      </div>
      )}

      {isExpanded && <MillingOverviewPanel filtered={filtered} lastActivityDate={lastActivityDate} warehouseMap={warehouseMap} />}

      {isExpanded && (
        <div className="relative mt-3">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 py-2 pl-9 pr-9 text-sm text-app-text outline-none focus:border-brand-neon"
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
      )}

      {isExpanded && availableRegionalAuthNumbers.length > 0 && (
        <select
          value={regionalAuthFilter}
          onChange={(e) => setRegionalAuthFilter(e.target.value)}
          className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text"
        >
          <option value="">All Authority Numbers</option>
          {availableRegionalAuthNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}

      {isExpanded && (
      <ul className="mt-3 animate-flow-down [contain:layout]" key={topTab}>
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-neutral-500">
            No pending {topTab} operations.
          </p>
        )}
        {filtered.length > 0 && filtered.every((o) => !matchesQuery(o)) && (
          <p className="py-4 text-center text-xs text-neutral-500">No pending {topTab} operations match that search.</p>
        )}
        {filtered.map((o) => (
          <MillingOrderRow
            key={o.orderId}
            order={o}
            onSelect={setSelectedOrder}
            isAdmin={isAdmin}
            isAnimating={completingId === o.orderId}
            onToggleComplete={toggleManualComplete}
            matches={matchesQuery(o)}
          />
        ))}
      </ul>
      )}

      {isExpanded && filtered.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setIsExpanded(false)
            containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          aria-label="Collapse list back to top"
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-neutral-500 transition-colors hover:text-app-text"
        >
          <ChevronUp size={16} />
        </button>
      )}

      {selectedOrder && <MillingOrderDetail order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
      {showCompletedModal && (
        <CompletedMillingModal
          orders={completedFiltered}
          authorities={authorities}
          warehouseMap={warehouseMap}
          type={topTab}
          onSelectOrder={setSelectedOrder}
          onClose={() => setShowCompletedModal(false)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  )
}

export default MillingMonitor
