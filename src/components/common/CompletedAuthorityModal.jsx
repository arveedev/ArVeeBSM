// Completed AI/SIA Modal — a separate popup (not an inline tab) for
// browsing completed allocations, since that list can grow very long
// over time and would hurt usability if shown inline. Sortable by month
// and year (month defaults to All, year defaults to the current year).
// Tapping an entry opens the same reconciliation panel the admin side
// already uses, showing every WSI/ESI document that used it.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Check, AlertTriangle, Search } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { isAuthorityNaturallyComplete, authorityExtraDetails, fmtBags, fmtWeight } from '../../utils/calculations.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import AuthorityReconciliationPanel from './AuthorityReconciliationPanel.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Must match the exit transition duration below.
const CLOSE_ANIMATION_MS = 300

function CompletedAuthorityModal({ authorities, type, varietyMap, sackTypeMap, warehouseMap, accessibleWarehouses, canManuallyToggle = true, onClose }) {
  // Delays the actual onClose call until the exit animation has time
  // to play, per the standing rule that every entrance needs a
  // matching exit rather than an instant, jarring unmount.
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, CLOSE_ANIMATION_MS)
  }

  const { weightUnit } = useSettings() ?? {}
  const currentYear = new Date().getFullYear()
  const [month, setMonth] = useState('All')
  const [year, setYear] = useState(String(currentYear))
  const [regionalAuthFilter, setRegionalAuthFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [reconciling, setReconciling] = useState(null)
  // Authority currently awaiting confirmation to be sent back to
  // Pending, or null when no confirmation is showing.
  const [pendingUncomplete, setPendingUncomplete] = useState(null)
  // authId currently playing its "sent back to pending" glow+collapse
  // exit animation, or null - the actual DB write is deliberately
  // delayed until the animation finishes, matching the same pattern
  // used for "mark complete" in the pending list (AuthorityMonitor.jsx),
  // just with a red glow instead of green.
  const [revertingId, setRevertingId] = useState(null)
  // Must match .animate-row-revert-out's duration in index.css.
  const ROW_EXIT_MS = 700

  // Clears revertingId only once `authorities` (derived from the
  // parent's live query) has actually caught up and no longer
  // contains this authority - clearing it on a fixed timer instead
  // raced against Dexie's async re-query, leaving one frame where the
  // row reverted to its normal appearance before the live query
  // removed it, which read as a flicker/reappear rather than one
  // continuous glow-then-collapse.
  useEffect(() => {
    if (!revertingId) return
    const stillHere = authorities.some((a) => a.authId === revertingId)
    if (!stillHere) setRevertingId(null)
  }, [authorities, revertingId])

  // Palay is green, Rice is blue - matches the same convention used in
  // the pending list, for consistency across the whole AI/SIA monitor.
  const categoryColor = (a) => {
    const category = type === 'AI' ? varietyMap.get(a.varietyId)?.category : sackTypeMap?.get(a.sackLines?.[0]?.sackTypeId)?.category
    if (category === 'Rice') return 'text-blue-400'
    if (category === 'Palay') return 'text-brand-neon'
    if (category === 'By Products') return 'text-brand-byproduct'
    return 'text-app-text'
  }

  // Only ever offered for authorities completed by the MANUAL checkbox
  // - one genuinely fulfilled via real issuances (isAuthorityNaturallyComplete)
  // isn't "done by mistake" in any sense a toggle could undo; the
  // numbers themselves say it's done. Confirmed before actually
  // applying, since this affects what the rest of the app treats as
  // outstanding/pending.
  const requestUncomplete = (authority, e) => {
    e.stopPropagation()
    setPendingUncomplete(authority)
  }
  const confirmUncomplete = () => {
    if (!pendingUncomplete) return
    const authId = pendingUncomplete.authId
    setPendingUncomplete(null)
    setRevertingId(authId)
    setTimeout(() => {
      db.authorities.update(authId, { manuallyCompleted: false })
      // revertingId is cleared by the effect above, once the live
      // query confirms the authority has actually left this list.
    }, ROW_EXIT_MS)
  }

  const refNumbers = authorities.map((a) => (type === 'AI' ? a.aiNumber : a.siaNumber)).filter(Boolean)

  // One bulk query for every completed authority's transactions, rather
  // than a separate query per row - each authority's "completed on" date
  // is derived from its own latest matching WSI/ESI transaction, since
  // authorities themselves have no dedicated completion-date field.
  const allTx = useLiveQuery(async () => {
    if (refNumbers.length === 0) return []
    const txType = type === 'AI' ? 'WSI' : 'ESI'
    return db.transactions.where('type').equals(txType).and((t) => t.status === 'Active').toArray()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, refNumbers.join(',')]) ?? []

  const lastDateFor = (refNumber) => {
    const matches = allTx.filter((t) => (type === 'AI' ? t.aiNumber : t.siaNumber) === refNumber)
    if (matches.length === 0) return null
    return matches.reduce((latest, t) => (t.date > latest ? t.date : latest), matches[0].date)
  }

  const availableYears = [...new Set(
    authorities
      .map((a) => lastDateFor(type === 'AI' ? a.aiNumber : a.siaNumber))
      .filter(Boolean)
      .map((d) => d.slice(0, 4))
  )].sort((a, b) => b.localeCompare(a))
  if (!availableYears.includes(String(currentYear))) availableYears.unshift(String(currentYear))

  const availableRegionalAuthNumbers = [...new Set(authorities.map((a) => a.regionalAuthorityNumber).filter(Boolean))].sort()
  // Every warehouse the user can see, not just ones with a completed
  // record right now - "shows all warehouses first" per explicit
  // request, so the picker doesn't shrink to nothing when a filter
  // (month/year/regional auth) has already narrowed the list down.
  // Scoped to the warehouses THIS USER can access, not every warehouse
  // in the app (warehouseMap is the full, unscoped set - only used for
  // per-row display lookups below, not for populating this picker).
  const availableWarehouses = [...(accessibleWarehouses ?? [])]
    .sort((x, y) => (x.code ?? '').localeCompare(y.code ?? ''))

  const filtered = authorities
    .map((a) => ({ a, completedDate: lastDateFor(type === 'AI' ? a.aiNumber : a.siaNumber) }))
    .filter(({ completedDate }) => {
      // No transaction date at all (manually completed, nothing to
      // reconcile against) - only show under the default view (All
      // months, current year), not for every arbitrary past year the
      // user might browse to, since there's no actual date to justify
      // showing it there.
      if (!completedDate) return month === 'All' && year === String(currentYear)
      const [y, m] = completedDate.split('-')
      if (y !== year) return false
      if (month !== 'All' && MONTHS.indexOf(month) + 1 !== Number(m)) return false
      return true
    })
    .filter(({ a }) => !regionalAuthFilter.trim() || a.regionalAuthorityNumber === regionalAuthFilter.trim())
    .filter(({ a }) => !warehouseFilter || a.assignedWarehouse === warehouseFilter)
    .filter(({ a }) => {
      const query = searchQuery.trim().toLowerCase()
      if (!query) return true
      const ref = type === 'AI' ? a.aiNumber : a.siaNumber
      return (ref ?? '').toLowerCase().includes(query)
    })
    .sort((x, y) => (y.completedDate ?? '').localeCompare(x.completedDate ?? ''))

  // Portaled straight to document.body - opened from AuthorityMonitor,
  // which on Home.jsx sits under a `.stagger-fields`/`.animate-flow-down`
  // ancestor. Those animations use `animation-fill-mode: both`, so even
  // after the animation finishes the element keeps a non-`none`
  // `transform` applied (e.g. `translateY(0px)`), and any non-`none`
  // transform on an ancestor becomes the containing block for
  // `position: fixed` descendants instead of the real viewport -
  // without the portal, this modal rendered "fixed" relative to that
  // ancestor's own box, trapping it inside the scrolling list instead
  // of covering the screen.
  return createPortal(
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-app-text">Completed {type}</h1>
            <p className="mt-0.5 text-xs text-neutral-500">
              Tap an entry to see the {type === 'AI' ? 'WSI' : 'ESI'} documents that used it.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative mt-3">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${type} number…`}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 py-1.5 pl-9 pr-9 text-sm text-app-text outline-none focus:border-brand-neon"
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

        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text"
          >
            <option value="All">All months</option>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text"
          >
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {availableWarehouses.length > 1 && (
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text"
          >
            <option value="">All Warehouses</option>
            {availableWarehouses.map((w) => (
              <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>
            ))}
          </select>
        )}

        {availableRegionalAuthNumbers.length > 0 && (
          <select
            value={regionalAuthFilter}
            onChange={(e) => setRegionalAuthFilter(e.target.value)}
            className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text"
          >
            <option value="">All Authority Numbers</option>
            {availableRegionalAuthNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}

        {regionalAuthFilter.trim() && (() => {
          const regionalTotals = authorities.filter((a) => a.regionalAuthorityNumber === regionalAuthFilter.trim())
          const totalBags = regionalTotals.reduce((s, a) => s + (a.totalIssuedBags ?? 0), 0)
          const totalKilos = regionalTotals.reduce((s, a) => s + (a.totalIssuedKilos ?? 0), 0)
          const byWarehouse = new Map()
          for (const a of regionalTotals) {
            const key = a.assignedWarehouse ?? 'Unassigned'
            const current = byWarehouse.get(key) ?? { bags: 0, kilos: 0 }
            current.bags += a.totalIssuedBags ?? 0
            current.kilos += a.totalIssuedKilos ?? 0
            byWarehouse.set(key, current)
          }

          return (
            <div className="mt-2 rounded-xl border border-brand-neon/30 bg-brand-neon/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">
                {regionalAuthFilter.trim()} — Total Issued
              </p>
              <p className="mt-1 text-lg font-bold text-app-text">
                {fmtBags(totalBags)} bags
                <span className="ml-2 text-sm font-normal text-neutral-400">{fmtWeight(totalKilos, weightUnit)}</span>
              </p>
              <div className="mt-2 space-y-1 border-t border-neutral-800 pt-2">
                {[...byWarehouse.entries()].map(([warehouseId, totals]) => {
                  const warehouse = warehouseMap.get(warehouseId)
                  return (
                    <div key={warehouseId} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400">{warehouse ? `${warehouse.code} — ${warehouse.name}` : warehouseId}</span>
                      <span className="font-semibold text-app-text">
                        {fmtBags(totals.bags)} bags · {fmtWeight(totals.kilos, weightUnit)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">
            No completed {type} records for this period.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map(({ a, completedDate }) => {
              const variety = type === 'AI' ? varietyMap.get(a.varietyId) : null
              const warehouse = warehouseMap.get(a.assignedWarehouse)
              const unitLabel = type === 'SIA' ? 'pieces' : 'bags'
              const canUncomplete = canManuallyToggle && !isAuthorityNaturallyComplete(a)
              // Shows unchecked immediately on confirm, before the
              // (deliberately delayed) DB write - without this the
              // checkmark just stayed put until the row vanished,
              // never visibly showing the "no longer marked done" state.
              const isReverting = revertingId === a.authId

              return (
                <li key={a.authId} className={`flex items-stretch gap-2 rounded-xl border border-neutral-800 bg-neutral-900 ${isReverting ? 'animate-row-revert-out pointer-events-none' : ''}`}>
                  {canUncomplete && (
                    <button
                      type="button"
                      onClick={(e) => requestUncomplete(a, e)}
                      aria-label="Mark as pending"
                      className={`flex w-10 shrink-0 items-center justify-center rounded-l-xl border-r border-neutral-800 transition-colors ${isReverting ? 'text-neutral-600' : 'bg-brand-neon/10 text-brand-neon'}`}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${isReverting ? 'border-neutral-700' : 'border-brand-neon bg-brand-neon/20'}`}>
                        {!isReverting && <Check size={14} />}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setReconciling(a)}
                    className="flex flex-1 items-center justify-between gap-3 py-2.5 pr-3 text-left transition-all hover:border-brand-neon/50 active:scale-[0.99]"
                  >
                    <div className="min-w-0 pl-3">
                      <p className={`truncate text-sm font-medium ${categoryColor(a)}`}>
                        {type} · {type === 'AI' ? a.aiNumber : a.siaNumber}
                      </p>
                      <p className="truncate text-xs text-neutral-400">
                        {warehouse ? `${warehouse.code} — ${warehouse.name}` : a.assignedWarehouse}
                      </p>
                      <p className="break-words text-xs text-neutral-500">
                        {a.customerName}
                        {type === 'AI' && variety ? ` — ${variety.name} (${variety.category})` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-600">
                        {completedDate ? `Completed ${completedDate}` : 'Manually marked complete'}
                      </p>
                      {authorityExtraDetails(a).length > 0 && (
                        <p className="break-words text-xs text-neutral-600">
                          {authorityExtraDetails(a).map((d) => `${d.label}: ${d.value}`).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {a.totalAllocationKilos != null && (
                        <p className="text-sm font-semibold text-brand-neon">
                          {fmtWeight(a.totalAllocationKilos, weightUnit)}
                        </p>
                      )}
                      {type === 'SIA' && (a.sackLines ?? []).length > 0 && (
                        <p className="text-sm font-semibold text-brand-neon">
                          {fmtBags((a.sackLines ?? []).reduce((s, l) => s + (l.totalAllocationBags ?? 0), 0))} {unitLabel}
                        </p>
                      )}
                      {type !== 'SIA' && a.totalAllocationBags != null && (
                        <p className="text-sm font-semibold text-brand-neon">
                          {fmtBags(a.totalAllocationBags)} {unitLabel}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {reconciling && (
        <AuthorityReconciliationPanel authority={reconciling} onClose={() => setReconciling(null)} />
      )}

      <ConfirmDialog
        open={Boolean(pendingUncomplete)}
        title="Mark this authority as pending again?"
        description={pendingUncomplete ? `${pendingUncomplete.type} · ${pendingUncomplete.type === 'AI' ? pendingUncomplete.aiNumber : pendingUncomplete.siaNumber} will move back to the Pending list.` : undefined}
        confirmLabel="Mark as Pending"
        icon={AlertTriangle}
        onConfirm={confirmUncomplete}
        onCancel={() => setPendingUncomplete(null)}
      />
    </div>,
    document.body
  )
}

export default CompletedAuthorityModal
