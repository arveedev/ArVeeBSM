// SDO Home — thin container, same pattern as Home.jsx/AdminHome.jsx:
// Buying Price + Cash on Hand + the WSR payment list (aggregated across
// every warehouse this SDO is assigned to - no warehouse selector, same
// reasoning as Admin's own dashboards never needing one), delegating
// the heavy lifting to sdoCalculations.js and the sdo/* modals.

import { useMemo, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, ArrowUpDown } from 'lucide-react'
import { db } from '../db/dexie.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { fmtBags, fmtKilos, isProcurementTypeName, effectiveCutoffDate } from '../utils/calculations.js'
import { computeCashOnHand } from '../utils/sdoCalculations.js'
import PurchaseReceiptModal from '../components/common/sdo/PurchaseReceiptModal.jsx'
import CashActionModal from '../components/common/sdo/CashActionModal.jsx'
import DenominationModal from '../components/common/sdo/DenominationModal.jsx'
import AbstractExportModal from '../components/common/sdo/AbstractExportModal.jsx'

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
  const { setPageHeader } = usePageHeader() ?? {}

  const [listTab, setListTab] = useState('payment')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search)
  const [sortDesc, setSortDesc] = useState(true)
  const [activeWsr, setActiveWsr] = useState(null)
  const [cashModal, setCashModal] = useState(null) // 'replenish' | 'liquidate' | 'denomination' | null
  const [editingPrice, setEditingPrice] = useState(false)
  const [showAbstractExport, setShowAbstractExport] = useState(false)
  const [dryPrice, setDryPrice] = useState('')
  const [wetPrice, setWetPrice] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setPageHeader?.({ title: 'Disbursing Officer', subtitle: `Welcome back, ${user?.nickname ?? ''}.` })
  }, [user?.nickname])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

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

  const visibleWsrTransactions = wsrTransactions.filter((t) => {
    const cutoff = effectiveCutoffDate(warehouseMap.get(t.warehouseId)?.reportingCutoffDate, globalDataStartDate)
    return !cutoff || t.date > cutoff
  })

  const activePrs = useLiveQuery(() => db.purchaseReceipts.where('status').equals('Active').toArray(), []) ?? []
  const activePrByWsrId = new Map(activePrs.map((pr) => [pr.wsrTransactionId, pr]))

  const myActivePrs = useMemo(() => activePrs.filter((pr) => pr.sdoUid === user?.uid), [activePrs, user?.uid])
  const ledgerEntries = useLiveQuery(() => user ? db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray() : [], [user?.uid]) ?? []
  const cashOnHand = computeCashOnHand(ledgerEntries, myActivePrs.map((pr) => pr.totalAmount ?? 0))

  const buyingPrices = useLiveQuery(() => db.buyingPrices.toArray(), []) ?? []
  const currentPriceRow = [...buyingPrices].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null

  useEffect(() => {
    if (editingPrice && currentPriceRow) {
      setDryPrice(String(currentPriceRow.dryPrice))
      setWetPrice(String(currentPriceRow.wetPrice))
    }
  }, [editingPrice])

  const savePrice = async () => {
    const dry = parseFloat(dryPrice)
    const wet = parseFloat(wetPrice)
    if (!(dry > 0) || !(wet > 0)) return
    await db.buyingPrices.add({
      id: crypto.randomUUID(),
      dryPrice: dry,
      wetPrice: wet,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      setByUid: user.uid,
    })
    setEditingPrice(false)
    setDryPrice('')
    setWetPrice('')
  }

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
    [...list].sort((a, b) => (sortDesc ? 1 : -1) * ((a.date ?? '').localeCompare(b.date ?? '')) * -1)

  const visibleList = applySort(applySearch(listTab === 'payment' ? unpaid : paid))

  return (
    <div className={`min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setEditingPrice((v) => !v)}
          className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left transition-all hover:border-brand-neon/50 active:scale-[0.98]"
        >
          <div className="text-[10px] font-bold uppercase text-neutral-500">Dry Palay</div>
          <p className="mt-1.5 text-xl font-bold text-app-text">{currentPriceRow ? `₱${currentPriceRow.dryPrice.toFixed(2)}` : '—'}<span className="text-xs font-semibold text-neutral-500">/kg</span></p>
        </button>
        <button
          type="button"
          onClick={() => setEditingPrice((v) => !v)}
          className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left transition-all hover:border-brand-neon/50 active:scale-[0.98]"
        >
          <div className="text-[10px] font-bold uppercase text-neutral-500">Wet Palay</div>
          <p className="mt-1.5 text-xl font-bold text-app-text">{currentPriceRow ? `₱${currentPriceRow.wetPrice.toFixed(2)}` : '—'}<span className="text-xs font-semibold text-neutral-500">/kg</span></p>
        </button>
      </div>

      {editingPrice && (
        <div className="mt-2 animate-flow-down space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.01" value={dryPrice} onChange={(e) => setDryPrice(e.target.value)} placeholder="Dry ₱/kg"
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-sm text-app-text outline-none transition-colors focus:border-brand-neon" />
            <input type="number" step="0.01" value={wetPrice} onChange={(e) => setWetPrice(e.target.value)} placeholder="Wet ₱/kg"
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-sm text-app-text outline-none transition-colors focus:border-brand-neon" />
          </div>
          <button type="button" onClick={savePrice} className="w-full rounded-lg bg-brand-neon px-3 py-2 text-sm font-semibold text-brand-contrast transition-all active:scale-95">Save New Price</button>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-brand-neon/40 bg-brand-neon/5 p-4 transition-all">
        <p className="text-[10px] font-bold uppercase text-brand-neon">Cash on Hand</p>
        <p className="mt-1 text-2xl font-bold text-app-text">₱{cashOnHand.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        <button type="button" onClick={() => setCashModal('denomination')} className="mt-1 text-xs text-neutral-400 underline transition-colors hover:text-app-text">
          View / update denomination count
        </button>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setCashModal('replenish')} className="flex-1 rounded-lg bg-brand-neon px-3 py-2 text-xs font-bold text-brand-contrast transition-all active:scale-95">+ Replenish</button>
          <button type="button" onClick={() => setCashModal('liquidate')} className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-bold text-app-text transition-all active:scale-95">Liquidate</button>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={() => setListTab('payment')} className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all active:scale-95 ${listTab === 'payment' ? 'bg-brand-neon text-brand-contrast' : 'border border-neutral-800 bg-neutral-900 text-neutral-400'}`}>
          For Payment
        </button>
        <button type="button" onClick={() => setListTab('completed')} className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all active:scale-95 ${listTab === 'completed' ? 'bg-brand-neon text-brand-contrast' : 'border border-neutral-800 bg-neutral-900 text-neutral-400'}`}>
          Completed
        </button>
        <button type="button" onClick={() => setShowAbstractExport(true)} aria-label="Export Abstract of Cereal Purchases" className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-bold text-neutral-400 transition-all active:scale-95">
          Export
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 transition-colors focus-within:border-brand-neon">
          <Search size={14} className="text-neutral-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search farmer, WSR, PR no."
            className="w-full bg-transparent text-xs text-app-text outline-none placeholder:text-neutral-500" />
        </div>
        <button type="button" onClick={() => setSortDesc((v) => !v)} aria-label="Toggle sort order" className="rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-neutral-400 transition-all active:scale-95">
          <ArrowUpDown size={14} />
        </button>
      </div>

      <div key={listTab} className="mt-3 animate-flow-down space-y-2">
        {visibleList.length === 0 && <p className="py-6 text-center text-xs text-neutral-500">Nothing here.</p>}
        {visibleList.map((t) => {
          const pr = activePrByWsrId.get(t.id)
          const warehouse = warehouseMap.get(t.warehouseId)
          return (
            <div key={t.id} onClick={() => setActiveWsr(t)} className="cursor-pointer rounded-xl border border-neutral-800 bg-neutral-900 p-3 transition-all hover:border-brand-neon/50 active:scale-[0.99]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-app-text">WSR {t.serialNo}</span>
                {pr ? (
                  <span className="rounded-full bg-brand-neon/10 px-2 py-0.5 text-[9px] font-bold uppercase text-brand-neon">PR {pr.prNo}</span>
                ) : (
                  <span className="rounded-full bg-brand-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase text-brand-amber">Unpaid</span>
                )}
              </div>
              <p className="mt-1 text-sm font-semibold text-app-text">{t.customerName}</p>
              {warehouse && <p className="text-[11px] text-neutral-500">{warehouse.code} — {warehouse.name}</p>}
              <div className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-2 text-xs">
                <span className="text-neutral-400">{fmtBags(t.numberOfBags)} bags · {fmtKilos(t.netKilos)} kg net</span>
                {pr && <span className="font-bold text-brand-neon">₱{(pr.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {activeWsr && <PurchaseReceiptModal wsr={activeWsr} onClose={() => setActiveWsr(null)} />}
      {(cashModal === 'replenish' || cashModal === 'liquidate') && (
        <CashActionModal mode={cashModal} currentCashOnHand={cashOnHand} onClose={() => setCashModal(null)} />
      )}
      {cashModal === 'denomination' && <DenominationModal currentCashOnHand={cashOnHand} onClose={() => setCashModal(null)} />}
      {showAbstractExport && <AbstractExportModal onClose={() => setShowAbstractExport(false)} />}
    </div>
  )
}

export default SdoHome
