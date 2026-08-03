// Milling / Test Milling Operations Monitor - mirrors the existing
// AuthorityMonitor pattern (pending list, Completed toggle, tap to
// expand detail), but for MO/TMO operations instead of AI/SIA
// authorities. Shows both stock (WSR/WSI) and sack (ESR/ESI) activity
// together, since a milling operation always involves both.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ChevronRight, X, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { db } from '../../db/dexie.js'
import { computeMillingOrderStatuses } from '../../utils/millingOrderStatus.js'
import { fmtBags, fmtWeight } from '../../utils/calculations.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { syncMillingOrdersFromSheets } from '../../services/googleSheetsBridge.js'

const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}

function MillingOrderDetail({ order, onClose }) {
  const { weightUnit } = useSettings() ?? {}
  const allTx = [...order.issueTx, ...order.receiptTx].sort((a, b) => (a.date < b.date ? -1 : 1))
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const piles = useLiveQuery(() => db.piles.toArray(), []) ?? []
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w.name]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v.name]))
  const pileMap = new Map(piles.map((p) => [p.pileId, p.pileName]))

  // Recovery percent expressed as an equivalent net bags figure, per
  // explicit request - a 50kg bag is the standard conversion used
  // throughout this app's own weight calculations.
  const expectedBagsEquivalent = order.type === 'MO' && order.recoveryPercent != null
    ? Math.round((order.issuedKilos * (order.recoveryPercent / 100)) / 50)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-base font-bold text-app-text">{order.number}</p>
            <p className="text-sm text-neutral-400">{order.ricemillName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-neutral-400 hover:text-app-text">
            <X size={20} />
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
          <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
            <p className="text-xs text-neutral-500">Status</p>
            <p className={`font-semibold ${order.fulfilled ? 'text-brand-neon' : 'text-brand-amber'}`}>
              {order.fulfilled ? 'Fulfilled' : 'Pending'}
            </p>
          </div>
        </div>

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
        <ul className="mt-1.5 space-y-2">
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
                <p className="mt-1.5 text-[10px] text-neutral-600">{t.serialNo}</p>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function MillingMonitor() {
  const [topTab, setTopTab] = useState('MO')
  const [showCompleted, setShowCompleted] = useState(false)
  const [regionalAuthFilter, setRegionalAuthFilter] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)

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

  const filtered = orders.filter((o) => {
    if (o.fulfilled !== showCompleted) return false
    if (regionalAuthFilter.trim() && regionalAuthByOrder.get(o.orderId) !== regionalAuthFilter.trim()) return false
    return true
  })

  const availableRegionalAuthNumbers = [...new Set([...regionalAuthByOrder.values()].filter(Boolean))].sort()

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-app-text">Milling Operations</h2>
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
            onClick={() => setShowCompleted((v) => !v)}
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
            onClick={() => setTopTab(t)}
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
          <option value="">All Regional Authority Numbers</option>
          {availableRegionalAuthNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}

      <ul className="mt-3 space-y-1.5">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-neutral-500">
            No {showCompleted ? 'completed' : 'pending'} {topTab} operations.
          </p>
        )}
        {filtered.map((o) => {
          // Progress from issuance to expected receipt, based on
          // recovery % - takes the max of stock (kilos) and sack
          // (pieces) progress since either or both can apply to the
          // same MO/TMO simultaneously. 0% until anything has been
          // issued at all.
          const expectedKilos = o.recoveryPercent != null ? o.issuedKilos * (o.recoveryPercent / 100) : null
          const expectedPieces = o.recoveryPercent != null ? o.issuedPieces * (o.recoveryPercent / 100) : null
          const kilosProgress = expectedKilos ? Math.min(100, (o.receivedKilos / expectedKilos) * 100) : null
          const piecesProgress = expectedPieces ? Math.min(100, (o.receivedPieces / expectedPieces) * 100) : null
          const progress = Math.max(kilosProgress ?? 0, piecesProgress ?? 0)
          const hasIssuance = o.issuedKilos > 0 || o.issuedPieces > 0

          return (
          <li key={o.orderId}>
            <button
              type="button"
              onClick={() => setSelectedOrder(o)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-left active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-app-text">{o.number}</p>
                <p className="truncate text-xs text-neutral-500">{o.ricemillName}</p>
                {hasIssuance && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className={`h-full rounded-full transition-all ${o.fulfilled ? 'bg-brand-neon' : 'bg-brand-amber'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!o.fulfilled && (o.issuedKilos > 0 || o.issuedPieces > 0) && (
                  <AlertTriangle size={14} className="text-brand-amber" />
                )}
                <ChevronRight size={18} className="text-neutral-600" />
              </div>
            </button>
          </li>
          )
        })}
      </ul>

      {selectedOrder && <MillingOrderDetail order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
    </div>
  )
}

export default MillingMonitor
