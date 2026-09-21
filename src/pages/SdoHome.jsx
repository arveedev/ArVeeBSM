// SDO Home — thin container, same pattern as Home.jsx/AdminHome.jsx:
// Buying Price + Cash on Hand + the WSR payment list (aggregated across
// every warehouse this SDO is assigned to - no warehouse selector, same
// reasoning as Admin's own dashboards never needing one), delegating
// the heavy lifting to sdoCalculations.js and the sdo/* modals.

import { useMemo, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, ArrowUpDown, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { db } from '../db/dexie.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { fmtBags, fmtKilos, isProcurementTypeName, effectiveCutoffDate } from '../utils/calculations.js'
import { computeCashOnHand, resolveBuyingPrice } from '../utils/sdoCalculations.js'
import PurchaseReceiptModal from '../components/common/sdo/PurchaseReceiptModal.jsx'
import CashActionModal from '../components/common/sdo/CashActionModal.jsx'
import AbstractExportModal from '../components/common/sdo/AbstractExportModal.jsx'
import BuyingPriceModal from '../components/common/sdo/BuyingPriceModal.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { queuePrDeletion } from '../services/syncWorker.js'

const LIST_PAGE_SIZE = 50

// Same defensive guard as Reports.jsx's dedupeTransactions - a genuine
// duplicate Dexie record (e.g. a sync-race placeholder) must never be
// shown to the SDO at all, even briefly, rather than appearing as two
// rows for the same WSR and then silently vanishing once a background
// self-heal catches up - per explicit correction, this list must never
// visibly show a "duplicate" in the first place.
const dedupeWsrTransactions = (transactions) => {
  const seenIds = new Set()
  const dedupedById = transactions.filter((t) => {
    if (seenIds.has(t.id)) return false
    seenIds.add(t.id)
    return true
  })
  // Same isPlaceholder concept serialNumber.js's findTransactionBySerial
  // already self-heals by elsewhere - a bare Sheet-import placeholder
  // that slipped in during a sync race - so a real, complete WSR record
  // is preferred over its own leftover placeholder when both exist.
  const isPlaceholder = (t) => t.fromSheetImport && t.needsCompletion && !t.pileId
  const seenKeys = new Map()
  for (const t of dedupedById) {
    const key = `${t.type}::${t.warehouseId}::${t.serialNo}::${t.cerealCategory ?? ''}`
    const existing = seenKeys.get(key)
    if (!existing || (isPlaceholder(existing) && !isPlaceholder(t))) seenKeys.set(key, t)
  }
  return [...seenKeys.values()]
}

function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function SdoHome() {
  const { user } = useAuth()
  const { accessibleWarehouses } = useWarehouse() ?? {}
  const { setPageHeader, setChromeHidden } = usePageHeader() ?? {}

  const [listTab, setListTab] = useState('payment')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search)
  const [sortDesc, setSortDesc] = useState(true)
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE)
  const [activeWsr, setActiveWsr] = useState(null)
  const [cashModal, setCashModal] = useState(null) // 'replenish' | 'liquidate' | null
  const [editingPrice, setEditingPrice] = useState(false)
  const [showAbstractExport, setShowAbstractExport] = useState(false)
  const [mounted, setMounted] = useState(false)
  // Per explicit request: a Cancelled PR must have somewhere to be
  // permanently deleted from - it has no WSR to hang off of when it's a
  // pre-registered "never issued" number, so it can't live in the
  // regular WSR-driven list above and gets its own section instead.
  const [deletePrTarget, setDeletePrTarget] = useState(null)

  // A page/filter/search/sort change invalidates how far the list was
  // paged - back to the first LIST_PAGE_SIZE rows of whatever the new
  // list actually is, rather than an unrelated stale count.
  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE)
  }, [listTab, warehouseFilter, debouncedSearch, sortDesc])

  useEffect(() => {
    setPageHeader?.({ title: 'Disbursing Officer', subtitle: `Welcome back, ${user?.nickname ?? ''}.` })
  }, [user?.nickname])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Hides the header/bottom nav (same chromeHidden switch App.jsx
  // already uses for transaction forms) and locks the page behind the
  // modal from also scrolling, whenever any sdo/* modal is open -
  // without this, the fixed header/nav sat on top of the modal and the
  // page's own scroll plus the modal's own internal scroll produced two
  // visible scrollbars at once.
  const anyModalOpen = Boolean(activeWsr) || Boolean(cashModal) || showAbstractExport || editingPrice || Boolean(deletePrTarget)
  useEffect(() => {
    setChromeHidden?.(anyModalOpen)
    document.body.style.overflow = anyModalOpen ? 'hidden' : ''
    return () => {
      setChromeHidden?.(false)
      document.body.style.overflow = ''
    }
  }, [anyModalOpen])

  const warehouseIds = useMemo(() => (accessibleWarehouses ?? []).map((w) => w.warehouseId), [accessibleWarehouses])
  const warehouseMap = useMemo(() => new Map((accessibleWarehouses ?? []).map((w) => [w.warehouseId, w])), [accessibleWarehouses])

  const globalDataStartDate = useLiveQuery(async () => (await db.reportConfig.get('global'))?.dataStartDate || null, []) ?? null

  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), []) ?? []
  const procurementTypeIds = new Set(transactionTypes.filter((t) => isProcurementTypeName(t.name)).map((t) => t.transactionTypeId))

  // Aggregated across every warehouse this SDO is assigned to - no
  // selector, same as Admin's dashboards showing everything at once.
  // Each warehouse's own reportingCutoffDate (combined with the global
  // Data Start Date override - whichever is later wins) is applied per
  // row, exactly the same rule Reports.jsx already uses everywhere else.
  const wsrTransactions = useLiveQuery(
    () => warehouseIds.length > 0
      ? db.transactions
          .where('warehouseId').anyOf(warehouseIds)
          .and((t) => t.type === 'WSR' && t.status === 'Active' && t.cerealCategory === 'Palay' && procurementTypeIds.has(t.transactionTypeId))
          .toArray()
      : Promise.resolve([]),
    [warehouseIds.join(','), transactionTypes.length]
  ) ?? []

  const visibleWsrTransactions = dedupeWsrTransactions(wsrTransactions).filter((t) => {
    const cutoff = effectiveCutoffDate(warehouseMap.get(t.warehouseId)?.reportingCutoffDate, globalDataStartDate)
    return !cutoff || t.date > cutoff
  })

  const activePrs = useLiveQuery(() => db.purchaseReceipts.where('status').equals('Active').toArray(), []) ?? []
  // Normally exactly one Active PR per WSR. More than one can only mean
  // two PRs were issued for the same WSR - concurrent taps, or two
  // devices issuing offline before syncing - so this is tracked
  // separately from the plain id->PR map, to surface it instead of
  // silently keeping whichever PR happened to sort first.
  const activePrsByWsrId = useMemo(() => {
    const map = new Map()
    for (const pr of activePrs) {
      const list = map.get(pr.wsrTransactionId) ?? []
      list.push(pr)
      map.set(pr.wsrTransactionId, list)
    }
    return map
  }, [activePrs])
  const activePrByWsrId = new Map([...activePrsByWsrId].map(([wsrId, list]) => [wsrId, list[0]]))
  const duplicatePrWsrIds = useMemo(
    () => new Set([...activePrsByWsrId].filter(([, list]) => list.length > 1).map(([wsrId]) => wsrId)),
    [activePrsByWsrId]
  )

  const myActivePrs = useMemo(() => activePrs.filter((pr) => pr.sdoUid === user?.uid), [activePrs, user?.uid])
  const ledgerEntries = useLiveQuery(() => user ? db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray() : [], [user?.uid]) ?? []
  const cashOnHand = computeCashOnHand(ledgerEntries, myActivePrs.map((pr) => pr.totalAmount ?? 0))

  const buyingPrices = useLiveQuery(() => db.buyingPrices.toArray(), []) ?? []
  const currentPriceRow = resolveBuyingPrice(buyingPrices, new Date().toISOString().slice(0, 10))

  const unpaid = visibleWsrTransactions.filter((t) => !activePrByWsrId.has(t.id))
  const paid = visibleWsrTransactions.filter((t) => activePrByWsrId.has(t.id))

  const applySearch = (list) => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return list
    return list.filter((t) =>
      (t.customerName ?? '').toLowerCase().includes(q) ||
      (t.serialNo ?? '').toLowerCase().includes(q) ||
      (activePrByWsrId.get(t.id)?.prNo ?? '').toLowerCase().includes(q)
    )
  }

  const applySort = (list) =>
    [...list].sort((a, b) => (sortDesc ? -1 : 1) * ((a.date ?? '').localeCompare(b.date ?? '')))

  const applyWarehouseFilter = (list) =>
    warehouseFilter ? list.filter((t) => t.warehouseId === warehouseFilter) : list

  const fullList = applySort(applySearch(applyWarehouseFilter(listTab === 'payment' ? unpaid : paid)))
  const visibleList = fullList.slice(0, visibleCount)

  // Every Cancelled PR this SDO has (a real one voided after issuance,
  // or a number reserved as cancelled with nothing behind it at all) -
  // shown only on the Completed tab, each with its own permanent Delete,
  // per explicit request that a cancelled PR must be reachable to purge
  // entirely, not just live on forever as a CANCELLED row.
  const cancelledPrs = useLiveQuery(
    () => user?.uid ? db.purchaseReceipts.where('[sdoUid+status]').equals([user.uid, 'Cancelled']).toArray() : [],
    [user?.uid]
  ) ?? []
  const sortedCancelledPrs = [...cancelledPrs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  const handleDeleteCancelledPr = async () => {
    if (!deletePrTarget) return
    // The underlying WSR's own date (the real delivery date) determines
    // which monthly Sheet source the row lives in, per explicit
    // correction - falls back to the PR's own date only for a
    // placeholder that never had a real WSR to begin with.
    const wsr = deletePrTarget.wsrTransactionId ? await db.transactions.get(deletePrTarget.wsrTransactionId) : null
    await db.purchaseReceipts.delete(deletePrTarget.prId)
    queuePrDeletion(deletePrTarget.prNo, wsr?.date ?? deletePrTarget.date)
    toast.success(`PR ${deletePrTarget.prNo} deleted`)
    setDeletePrTarget(null)
  }

  return (
    <div className={`min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      {/* Per explicit request, one "Buying Price" card replaces the old
          separate Dry/Wet cards - the underlying row still stores both
          fields (see BuyingPriceModal.jsx), but they're always written
          as the same value now, so either one is the single real price. */}
      <button
        type="button"
        onClick={() => setEditingPrice((v) => !v)}
        className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left transition-all hover:border-brand-neon/50 active:scale-[0.98]"
      >
        <div className="text-[10px] font-bold uppercase text-neutral-500">Buying Price</div>
        <p className="mt-1.5 text-xl font-bold text-app-text">{currentPriceRow ? `₱${currentPriceRow.dryPrice.toFixed(2)}` : '—'}<span className="text-xs font-semibold text-neutral-500">/kg</span></p>
      </button>

      <div className="mt-4 rounded-2xl border border-brand-neon/40 bg-brand-neon/5 p-4 transition-all">
        <p className="text-[10px] font-bold uppercase text-brand-neon">Cash on Hand</p>
        <p className="mt-1 text-2xl font-bold text-app-text">₱{cashOnHand.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        {/* Denomination count and full cash history moved to Settings -
            SDO Home stays focused on today's actions (Replenish/
            Liquidate), the review/correction tools live where the rest
            of an SDO's account-level settings already do. */}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setCashModal('replenish')} className="flex-1 rounded-lg bg-brand-neon px-3 py-2 text-xs font-bold text-brand-contrast transition-all active:scale-95">+ Replenish</button>
          <button type="button" onClick={() => setCashModal('liquidate')} className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-bold text-app-text transition-all active:scale-95">Liquidate</button>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <div className="relative flex flex-1 gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
          <div
            className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
            style={{ transform: listTab === 'payment' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
          />
          <button type="button" onClick={() => setListTab('payment')} className={`relative z-10 flex-1 rounded-lg py-2 text-xs transition-colors ${listTab === 'payment' ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400'}`}>
            For Payment
          </button>
          <button type="button" onClick={() => setListTab('completed')} className={`relative z-10 flex-1 rounded-lg py-2 text-xs transition-colors ${listTab === 'completed' ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400'}`}>
            Completed
          </button>
        </div>
        <button type="button" onClick={() => setShowAbstractExport(true)} aria-label="Export Abstract of Cereal Purchases" className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-bold text-neutral-400 transition-all active:scale-95">
          Export
        </button>
      </div>

      {/* Search+sort stay their own row at every width; the warehouse
          filter drops to its own full-width row below them on small
          screens (three controls competing for one narrow row was
          cramped) and rejoins the same row once there's room, sm+. */}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        {/* flex-1 here (not just on the search box inside it) is what
            makes this whole cluster actually grow to fill the row on
            wide screens - without it, this wrapper only ever took its
            own content width, leaving the rest of the row (and the
            warehouse filter/sort next to it) stranded on the left with
            empty space filling the remaining width. */}
        <div className="flex flex-1 gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 transition-colors focus-within:border-brand-neon">
            <Search size={14} className="text-neutral-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search farmer, WSR, PR no."
              className="w-full bg-transparent text-xs text-app-text outline-none placeholder:text-neutral-500" />
          </div>
          <button type="button" onClick={() => setSortDesc((v) => !v)} aria-label="Toggle sort order" className="shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-neutral-400 transition-all active:scale-95 sm:hidden">
            <ArrowUpDown size={14} />
          </button>
        </div>
        {(accessibleWarehouses ?? []).length > 1 && (
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            aria-label="Filter by warehouse"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs text-neutral-300 outline-none transition-colors focus:border-brand-neon sm:w-auto sm:py-0"
          >
            <option value="">All warehouses</option>
            {/* Deduped defensively by warehouseId - this list is already
                scoped to exactly this SDO's own assignedWarehouses via
                useWarehouse()'s shared accessibleWarehouses (the same
                source every other page's warehouse picker uses), so a
                warehouse this SDO isn't assigned to can't appear here;
                if one seems to, the fix is that user's Assigned
                Warehouses in Admin > Structure > Users, not this list. */}
            {[...new Map((accessibleWarehouses ?? []).map((w) => [w.warehouseId, w])).values()]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>
              ))}
          </select>
        )}
        <button type="button" onClick={() => setSortDesc((v) => !v)} aria-label="Toggle sort order" className="hidden shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-neutral-400 transition-all active:scale-95 sm:block">
          <ArrowUpDown size={14} />
        </button>
      </div>

      <div key={listTab} className="mt-3 animate-flow-down space-y-2">
        {visibleList.length === 0 && <p className="py-6 text-center text-xs text-neutral-500">Nothing here.</p>}
        {visibleList.map((t) => {
          const pr = activePrByWsrId.get(t.id)
          const warehouse = warehouseMap.get(t.warehouseId)
          return (
            <div key={t.id} onClick={() => setActiveWsr(t)} className="cursor-pointer rounded-xl border border-neutral-800 bg-neutral-900 p-3.5 transition-all hover:border-brand-neon/50 active:scale-[0.99]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-lg font-bold text-app-text">WSR {t.serialNo}</span>
                {pr ? (
                  <span className="rounded-full bg-brand-neon/10 px-2.5 py-1 text-sm font-bold uppercase text-brand-neon">PR {pr.prNo}</span>
                ) : (
                  <span className="rounded-full bg-brand-amber/10 px-2.5 py-1 text-xs font-bold uppercase text-brand-amber">Unpaid</span>
                )}
              </div>
              {duplicatePrWsrIds.has(t.id) && (
                <p className="mt-1.5 rounded-lg bg-brand-crimson/10 px-2 py-1 text-xs font-semibold text-brand-crimson">
                  More than one active PR exists for this WSR — open it and cancel the extra one.
                </p>
              )}
              <p className="mt-1 text-base font-semibold text-app-text">{t.customerName}</p>
              {warehouse && <p className="text-sm text-neutral-500">{warehouse.code} — {warehouse.name}</p>}
              <div className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-2 text-sm">
                <span className="text-neutral-400">{fmtBags(t.numberOfBags)} bags · {fmtKilos(t.netKilos)} kg net</span>
                {pr && <span className="text-base font-bold text-brand-neon">₱{(pr.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>}
              </div>
            </div>
          )
        })}
        {fullList.length > visibleList.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((v) => v + LIST_PAGE_SIZE)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 py-2.5 text-xs font-semibold text-neutral-400 transition-all hover:border-brand-neon/50 hover:text-app-text active:scale-[0.99]"
          >
            Load more ({fullList.length - visibleList.length} more)
          </button>
        )}
      </div>

      {/* Cancelled PRs have no WSR to attach to (a pre-registered "never
          issued" number has none at all) so they get their own section
          here instead of living in the WSR-driven list above - per
          explicit request, only reachable/visible on the Completed tab,
          each with a genuinely permanent Delete. */}
      {listTab === 'completed' && sortedCancelledPrs.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">Cancelled PRs</p>
          <div className="space-y-2">
            {sortedCancelledPrs.map((pr) => (
              <div key={pr.prId} className="flex items-center justify-between gap-2 rounded-xl border border-brand-crimson/30 bg-brand-crimson/5 p-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-app-text">PR {pr.prNo}</p>
                  <p className="text-xs text-neutral-500">
                    {pr.date}{pr.payeeName ? ` · ${pr.payeeName}` : ' · never issued'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeletePrTarget(pr)}
                  aria-label={`Delete PR ${pr.prNo}`}
                  className="shrink-0 rounded-lg bg-brand-crimson/10 p-2 text-brand-crimson transition-all active:scale-90"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletePrTarget)}
        title={`Delete PR ${deletePrTarget?.prNo ?? ''}?`}
        description="This permanently removes it - it will no longer appear anywhere, including the exported Abstract. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Back"
        onConfirm={handleDeleteCancelledPr}
        onCancel={() => setDeletePrTarget(null)}
      />

      {activeWsr && <PurchaseReceiptModal wsr={activeWsr} cashOnHand={cashOnHand} onClose={() => setActiveWsr(null)} />}
      {(cashModal === 'replenish' || cashModal === 'liquidate') && (
        <CashActionModal mode={cashModal} currentCashOnHand={cashOnHand} onClose={() => setCashModal(null)} />
      )}
      {showAbstractExport && <AbstractExportModal onClose={() => setShowAbstractExport(false)} />}
      {editingPrice && <BuyingPriceModal currentPriceRow={currentPriceRow} onClose={() => setEditingPrice(false)} />}
    </div>
  )
}

export default SdoHome
