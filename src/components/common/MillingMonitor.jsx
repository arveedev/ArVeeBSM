// Milling / Test Milling Operations Monitor - mirrors the existing
// AuthorityMonitor pattern (pending list, Completed toggle, tap to
// expand detail), but for MO/TMO operations instead of AI/SIA
// authorities. Shows both stock (WSR/WSI) and sack (ESR/ESI) activity
// together, since a milling operation always involves both.

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ChevronRight, ChevronUp, X, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { db } from '../../db/dexie.js'
import { computeMillingOrderStatuses } from '../../utils/millingOrderStatus.js'
import { fmtBags, fmtWeight } from '../../utils/calculations.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { syncMillingOrdersFromSheets, stripWarehouseCodePrefix } from '../../services/googleSheetsBridge.js'

const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}

function MillingOrderDetail({ order, onClose }) {
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, 300)
  }

  const { weightUnit } = useSettings() ?? {}
  const allTx = [...order.issueTx, ...order.receiptTx].sort((a, b) => {
    const numA = parseInt(String(a.serialNo).replace(/\D/g, ''), 10)
    const numB = parseInt(String(b.serialNo).replace(/\D/g, ''), 10)
    if (Number.isNaN(numA) || Number.isNaN(numB)) return String(a.serialNo).localeCompare(String(b.serialNo))
    return numA - numB
  })
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const piles = useLiveQuery(() => db.piles.toArray(), []) ?? []
  const linkedAuthority = useLiveQuery(async () => {
    if (order.aiNumber) return db.authorities.where('aiNumber').equals(order.aiNumber).first()
    if (order.siaNumber) return db.authorities.where('siaNumber').equals(order.siaNumber).first()
    return null
  }, [order.aiNumber, order.siaNumber])
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w.name]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v.name]))
  const pileMap = new Map(piles.map((p) => [p.pileId, p.pileName]))

  // Last transaction summary, replacing the previously always-static
  // "Pending" text with something actually informative - e.g. "BSI
  // issued PD1-A 300 bags on 06 Jul 2026".
  const lastTx = [...allTx].sort((a, b) => (a.date > b.date ? -1 : 1))[0]
  const lastTxSummary = (() => {
    if (!lastTx) return null
    const isIssue = lastTx.type === 'WSI' || lastTx.type === 'ESI'
    const isSack = lastTx.type === 'ESI' || lastTx.type === 'ESR'
    const whName = stripWarehouseCodePrefix(warehouseMap.get(lastTx.warehouseId)) || '—'
    const variety = varietyMap.get(lastTx.varietyId) ?? '—'
    const pileName = lastTx.pileId ? pileMap.get(lastTx.pileId) : null
    const varietyAndPile = pileName ? `${variety} (${pileName})` : variety
    const amount = isSack
      ? `${fmtBags((lastTx.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0))} pcs`
      : `${fmtBags(lastTx.numberOfBags)} net bags`
    return `${whName} ${isIssue ? 'issued' : 'received'} ${varietyAndPile} ${amount} on ${fmtDate(lastTx.date)}`
  })()

  // Recovery percent expressed as an equivalent net bags figure, per
  // explicit request - a 50kg bag is the standard conversion used
  // throughout this app's own weight calculations.
  const expectedBagsEquivalent = order.type === 'MO' && order.recoveryPercent != null
    ? Math.round((order.issuedKilos * (order.recoveryPercent / 100)) / 50)
    : null

  // By Products from this same milling run - same MO/TMO number, but
  // tagged with cerealCategory 'By Products' rather than the main
  // Rice/Palay product. Only relevant for receipts (WSR/ESR), since By
  // Products are a milling OUTPUT, not something issued to be milled.
  const byProductsBags = allTx
    .filter((t) => t.cerealCategory === 'By Products' && (t.type === 'WSR' || t.type === 'ESR'))
    .reduce((sum, t) => {
      if (t.type === 'WSR') return sum + (t.numberOfBags ?? 0)
      return sum + (t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0)
    }, 0)

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`} onClick={handleClose}>
      <div
        className={`flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-neutral-800 bg-neutral-900 ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed section - never scrolls, only Transaction History below does */}
        <div className="shrink-0 p-4 pb-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-base font-bold text-app-text">{order.number}</p>
              <p className="text-sm text-neutral-400">{order.ricemillName}</p>
            </div>
            <button type="button" onClick={handleClose} className="rounded-full p-2 text-brand-crimson transition-transform active:scale-90">
              <X size={26} strokeWidth={2.5} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-xs text-neutral-500">{order.type === 'MO' ? 'Batch' : 'Trials Recovered'}</p>
              <p className="font-semibold text-app-text">
                {order.type === 'MO'
                  ? `${order.batchCurrent} of ${order.batchTotal}`
                  : `${(order.recoveredTrials ?? []).length} of 3`}
              </p>
            </div>
            {order.receivingWarehouse && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <p className="text-xs text-neutral-500">Receiving Warehouse</p>
                <p className="font-semibold text-app-text">{order.receivingWarehouse}</p>
              </div>
            )}
          </div>

          {byProductsBags > 0 && (
            <div className="mt-2 rounded-lg border border-brand-byproduct/40 bg-brand-byproduct/10 p-2">
              <p className="text-xs text-neutral-500">By Products (Total)</p>
              <p className="font-semibold text-brand-byproduct">{fmtBags(byProductsBags)} bags</p>
            </div>
          )}

          {linkedAuthority?.sourceWarehouse && (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-sm">
              <p className="text-xs text-neutral-500">Source Warehouse</p>
              <p className="font-semibold text-app-text">{linkedAuthority.sourceWarehouse}</p>
            </div>
          )}

          {lastTxSummary && (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-xs text-neutral-500">Last Activity</p>
              <p className="text-sm font-medium text-app-text">{lastTxSummary}</p>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-xs text-neutral-500">Issued</p>
              <p className="font-semibold text-app-text">{fmtBags(order.issuedPieces)} sacks</p>
              <p className="font-semibold text-app-text">{fmtWeight(order.issuedKilos, weightUnit, 'Net')}</p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-xs text-neutral-500">Received</p>
              <p className="font-semibold text-app-text">{fmtBags(order.receivedPieces)} sacks</p>
              <p className="font-semibold text-app-text">{fmtWeight(order.receivedKilos, weightUnit, 'Net')}</p>
            </div>
          </div>

          {expectedBagsEquivalent != null && (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-sm">
              <p className="text-xs text-neutral-500">Expected Recovery ({order.recoveryPercent}%)</p>
              <p className="font-semibold text-app-text">≈ {fmtBags(expectedBagsEquivalent)} bags</p>
            </div>
          )}

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Transaction History</p>
        </div>

        {/* Only this section scrolls */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-1.5">
          <ul className="space-y-2">
            {allTx.length === 0 && <p className="py-2 text-center text-xs text-neutral-500">No transactions recorded yet.</p>}
            {allTx.map((t) => {
              const isIssue = t.type === 'WSI' || t.type === 'ESI'
              const isSack = t.type === 'ESI' || t.type === 'ESR'
              const bagsOrPieces = isSack
                ? (t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0)
                : t.numberOfBags
              return (
                <li key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold ${isIssue ? 'text-brand-neon' : 'text-brand-amber'}`}>
                      {isIssue ? 'Issued' : 'Received'} {isSack ? '(Sacks)' : '(Stock)'}
                      {t.trialNumber ? ` · Trial ${t.trialNumber}` : ''}
                    </span>
                    <span className="text-neutral-500">{fmtDate(t.date)}</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-neutral-400">
                    <div>
                      <p className="text-[10px] uppercase text-neutral-600">Miller</p>
                      <p className="text-app-text">{t.customerName ?? order.ricemillName ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-neutral-600">Warehouse</p>
                      <p className="text-app-text">{warehouseMap.get(t.warehouseId) ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-neutral-600">Variety</p>
                      <p className="text-app-text">{varietyMap.get(t.varietyId) ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-neutral-600">Pile</p>
                      <p className="text-app-text">{t.pileId ? (pileMap.get(t.pileId) ?? '—') : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-neutral-600">{isSack ? 'Pieces' : 'Bags'}</p>
                      <p className="text-app-text">{fmtBags(bagsOrPieces)}</p>
                    </div>
                    {!isSack && (
                      <div>
                        <p className="text-[10px] uppercase text-neutral-600">Net Kgs</p>
                        <p className="text-app-text">{fmtWeight(t.netKilos ?? 0, weightUnit, 'Net')}</p>
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-app-text">{t.type} # {t.serialNo}</p>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  )
}

function MillingMonitor() {
  const [topTab, setTopTab] = useState('MO')
  const [showCompleted, setShowCompleted] = useState(false)
  const [regionalAuthFilter, setRegionalAuthFilter] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)
  const containerRef = useRef(null)

  const orders = useLiveQuery(() => computeMillingOrderStatuses(topTab), [topTab]) ?? []
  const authorities = useLiveQuery(() => db.authorities.toArray(), []) ?? []

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

  // Regional Authority Number comes from the AI/SIA the order links to
  // (via the order's own aiNumber/siaNumber), not stored on the order
  // directly.
  const regionalAuthByOrder = new Map(
    orders.map((o) => {
      const auth = authorities.find((a) => (o.aiNumber && a.aiNumber === o.aiNumber) || (o.siaNumber && a.siaNumber === o.siaNumber))
      return [o.orderId, auth?.regionalAuthorityNumber ?? null]
    })
  )

  const sheetSources = useLiveQuery(() => db.sheetSources.toArray(), []) ?? []
  // Earliest dateFrom across every configured source - an order is
  // only ever excluded if it HAS recorded activity and that activity
  // is entirely before this cutoff. An order with no transactions at
  // all yet (brand new) is never excluded on this basis, since it is
  // current by definition, not historical data outside the configured
  // range.
  const earliestSourceDateFrom = sheetSources.length > 0
    ? sheetSources.map((s) => s.dateFrom).filter(Boolean).sort()[0]
    : null

  const filtered = orders.filter((o) => {
    if (earliestSourceDateFrom) {
      const allDates = [...(o.issueTx ?? []), ...(o.receiptTx ?? [])].map((t) => t.date).filter(Boolean)
      if (allDates.length > 0 && allDates.every((d) => d < earliestSourceDateFrom)) return false
    }
    // Sheet-marked DONE is unconditionally completed, regardless of
    // what the kg/piece-based fulfilled calculation separately says -
    // previously only fulfilled was checked here, so an order marked
    // DONE directly on the sheet but not also satisfying that math
    // (e.g. missing/mismatched recovery %) would incorrectly keep
    // showing in the pending list forever.
    const isCompleted = o.sheetStatus === 'DONE' || o.fulfilled
    if (isCompleted !== showCompleted) return false
    if (regionalAuthFilter.trim() && regionalAuthByOrder.get(o.orderId) !== regionalAuthFilter.trim()) return false
    return true
  })

  const availableRegionalAuthNumbers = [...new Set([...regionalAuthByOrder.values()].filter(Boolean))].sort()

  return (
    <div ref={containerRef} className={`rounded-2xl border p-4 transition-all ${showCompleted ? 'border-brand-neon shadow-[0_0_16px_-4px_rgba(0,255,163,0.4)] bg-neutral-900' : 'border-neutral-800 bg-neutral-900'}`}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <h2 className="text-base font-semibold text-app-text">Milling Operations</h2>
          <ChevronUp size={16} className={`shrink-0 text-neutral-500 transition-transform ${isExpanded ? '' : 'rotate-180'}`} />
        </button>
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
            onClick={() => { setShowCompleted((v) => !v); setIsExpanded(true) }}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${showCompleted ? 'bg-brand-neon text-brand-contrast' : 'border border-neutral-700 text-neutral-400'}`}
          >
            {showCompleted ? 'Showing Completed' : 'Show Completed'}
          </button>
        </div>
      </div>

      <div className="relative mt-3 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: topTab === 'MO' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {['MO', 'TMO'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTopTab(t); setIsExpanded(true) }}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium ${topTab === t ? 'text-brand-contrast' : 'text-neutral-400'}`}
          >
            {t === 'MO' ? 'Milling' : 'Test Milling'}
          </button>
        ))}
      </div>

      {availableRegionalAuthNumbers.length > 0 && (
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
      <ul className="mt-3 space-y-1.5 animate-flow-down" key={`${topTab}-${showCompleted}`}>
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-neutral-500">
            No {showCompleted ? 'completed' : 'pending'} {topTab} operations.
          </p>
        )}
        {filtered.map((o) => {
          // Progress is issuance (0-50%) plus receipt (0-50%), not a
          // single received-vs-expected ratio - so a fully-issued but
          // not-yet-received order still shows real, visible progress
          // (50%) rather than nothing until receipts start.
          const roundTo3 = (n) => Math.round(n * 1000) / 1000

          // TMO tracks TRIAL COUNT on both halves, not kg/pieces - a
          // fully-issued-but-unreceived TMO should show exactly half
          // full ("Trial 3 of 3" issued, "Trial 0 of 3" received) as
          // a clear visual glimpse without opening the detail. MO is
          // completely unaffected, keeping the kg-based calculation
          // below exactly as it was.
          const issuedTrialsCount = o.type === 'TMO'
            ? new Set((o.issueTx ?? []).map((t) => t.trialNumber).filter(Boolean)).size
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

          // Receipt half: proportional to received vs. expected
          // recovery (issued x recovery%, per net kgs - e.g. 30,000kg
          // issued at 63% recovery expects 18,900kg back). Sacks use
          // pieces instead of kilos the same way. Falls back to
          // received-vs-issued directly when no recovery % is set.
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
          const isCompleted = o.sheetStatus === 'DONE' || o.fulfilled

          return (
          <li key={o.orderId}>
            <button
              type="button"
              onClick={() => setSelectedOrder(o)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-left active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-app-text">{o.number}</p>
                <p className="truncate text-xs text-neutral-500">
                  {o.ricemillName}
                  {o.type === 'MO' && o.batchCurrent != null && ` · Batch ${o.batchCurrent} of ${o.batchTotal}`}
                </p>
                {hasIssuance && (
                  <>
                    {o.type === 'TMO' && (
                      <div className="mt-1.5 flex justify-between text-[10px] text-neutral-500">
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
          </li>
          )
        })}
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
    </div>
  )
}

export default MillingMonitor
