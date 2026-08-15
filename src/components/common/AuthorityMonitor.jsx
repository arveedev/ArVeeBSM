// AI / SIA Monitor — shown on Home, above the Piles list, for warehouse
// supervisors/assistants (not just buried in the Admin Dashboard). Scoped
// to ONLY the AI/SIA records assigned to warehouses this user can access.
//
// Two top-level tabs (AI / SIA), each with two sub-tabs (Pending /
// Completed). A checkbox on the left of each row lets the user manually
// mark an allocation complete even if it isn't fully issued against (some
// AI/SIA don't need to be fully documented to be considered done) —
// unchecking it from the Completed tab moves it back to Pending.
//
// Tapping a row (not the checkbox):
//  - Switches WarehouseContext's currentWarehouseId to the authority's
//    assigned warehouse first, if it isn't already selected.
//  - Opens WSI (for AI) or ESI (for SIA) pre-filled with customer name,
//    variety/sack, and allocation amounts. For AI, the opened WSI form's
//    Pile ID list is filtered to only that AI's variety.
//
// SIA quantities are PIECES, not bags — sacks are counted as pieces.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { calculateAuthorityStatus, isAuthorityComplete, authorityExtraDetails, fmtBags, fmtWeight } from '../../utils/calculations.js'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import CompletedAuthorityModal from './CompletedAuthorityModal.jsx'
import AuthorityReconciliationPanel from './AuthorityReconciliationPanel.jsx'

const TOP_TABS = ['AI', 'SIA']

function AuthorityMonitor() {
  const { accessibleWarehouses, currentWarehouseId, setCurrentWarehouseId } = useWarehouse() ?? {}
  const { weightUnit } = useSettings() ?? {}
  const [topTab, setTopTab] = useState('AI')
  const [showCompleted, setShowCompleted] = useState(false)
  const [choiceAuthority, setChoiceAuthority] = useState(null)
  const [viewingAuthority, setViewingAuthority] = useState(null)

  const accessibleIds = (accessibleWarehouses ?? []).map((w) => w.warehouseId)
  const accessibleIdsKey = accessibleIds.join(',')

  const authorities = useLiveQuery(async () => {
    if (accessibleIds.length === 0) return []
    return db.authorities.where('assignedWarehouse').anyOf(accessibleIds).toArray()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibleIdsKey])

  // These must be above the early return — React requires hooks to be
  // called unconditionally on every render, never after a conditional
  // return, even if the data isn't used in the null branch.
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))

  // Palay is green, Rice is blue - applied to the AI/SIA type+number
  // line for quick visual distinction now that this list can get
  // crowded. AI's category comes from its variety; SIA's from its sack
  // type (SIA has no variety of its own).
  const categoryColor = (a) => {
    const category = a.type === 'AI' ? varietyMap.get(a.varietyId)?.category : sackTypeMap.get(a.sackLines?.[0]?.sackTypeId)?.category
    if (category === 'Rice') return 'text-blue-400'
    if (category === 'Palay') return 'text-brand-neon'
    if (category === 'By Products') return 'text-brand-byproduct'
    return 'text-app-text'
  }

  if (!authorities || authorities.length === 0) return null

  const typeAuthorities = authorities.filter((a) => a.type === topTab)
  const filtered = (() => {
    const withoutCompleted = typeAuthorities.filter((a) => !isAuthorityComplete(a))
    // Same defensive dedup as AuthorityPickerModal.jsx - the monitor
    // should never show the same AI/SIA number twice regardless of
    // whether sync-level cleanup has caught up yet.
    const byRef = new Map()
    for (const a of withoutCompleted) {
      const ref = a.type === 'AI' ? a.aiNumber : a.siaNumber
      if (!ref) continue
      const existing = byRef.get(ref)
      if (!existing || (a.totalIssuedKilos ?? 0) > (existing.totalIssuedKilos ?? 0)) {
        byRef.set(ref, a)
      }
    }
    return [...byRef.values()].sort((a, b) => {
      const aRef = a.type === 'AI' ? a.aiNumber : a.siaNumber
      const bRef = b.type === 'AI' ? b.aiNumber : b.siaNumber
      return (aRef ?? '').localeCompare(bRef ?? '', undefined, { numeric: true })
    })
  })()
  const completedList = typeAuthorities.filter(isAuthorityComplete)

  const handleOpen = (authority) => {
    if (authority.assignedWarehouse && authority.assignedWarehouse !== currentWarehouseId) {
      setCurrentWarehouseId?.(authority.assignedWarehouse)
    }

    if (typeof window.openTransactionForm !== 'function') return

    if (authority.type === 'AI') {
      const kilosRemaining = authority.totalAllocationKilos != null
        ? parseFloat(((authority.totalAllocationKilos) - (authority.totalIssuedKilos ?? 0)).toFixed(2))
        : null
      const bagsRemaining = authority.totalAllocationBags != null
        ? parseFloat(((authority.totalAllocationBags) - (authority.totalIssuedBags ?? 0)).toFixed(2))
        : null

      window.openTransactionForm('WSI', {
        aiNumber: authority.aiNumber,
        authorityDate: authority.date ?? null,
        customerName: authority.customerName,
        varietyId: authority.varietyId,
        transactionTypeName: authority.transactionTypeName,
        orNumber: authority.orNumber ?? null,
        numberOfBags: bagsRemaining != null && bagsRemaining > 0 ? bagsRemaining : null,
        netKilos: kilosRemaining != null && kilosRemaining > 0 ? kilosRemaining : null,
        autoComputeNet: false,
      })
    } else {
      // A line with no allocation yet (blank Pieces cell on the sheet)
      // must still show up, with pieces left null so the ESI form
      // renders it blank for the user to fill in - only a line whose
      // real allocation is already fully used up should be dropped.
      const remainingLines = (authority.sackLines ?? [])
        .filter((l) => l.sackTypeId && l.condition)
        .map((l) => {
          const hasAllocation = l.totalAllocationBags != null && l.totalAllocationBags > 0
          const pieces = hasAllocation ? Math.max(0, l.totalAllocationBags - (l.totalIssuedBags ?? 0)) : null
          return { sackTypeId: l.sackTypeId, condition: l.condition, pieces, hasAllocation }
        })
        .filter((l) => !l.hasAllocation || l.pieces > 0)
        .map(({ sackTypeId, condition, pieces }) => ({ sackTypeId, condition, pieces }))

      window.openTransactionForm('ESI', {
        linkedDocNo: authority.siaNumber,
        authorityDate: authority.date ?? null,
        customerName: authority.customerName,
        transactionTypeName: authority.transactionTypeName,
        sackLines: remainingLines,
      })
    }
  }

  const toggleManualComplete = async (authority, e) => {
    e.stopPropagation()
    await db.authorities.update(authority.authId, {
      manuallyCompleted: !authority.manuallyCompleted,
    })
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-app-text">AI / SIA Monitor</h2>

      <div className="relative mt-2 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: topTab === TOP_TABS[0] ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {TOP_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setTopTab(tab)}
            className={`relative z-10 flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors active:scale-95 ${
              topTab === tab ? 'text-brand-contrast' : 'text-neutral-400 hover:text-app-text'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between border-b border-neutral-800 px-1 pb-1.5">
        <span className="text-xs font-medium text-app-text">Pending</span>
        <button
          type="button"
          onClick={() => setShowCompleted(true)}
          className="shrink-0 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-brand-neon hover:border-brand-neon/50"
        >
          View Completed
        </button>
      </div>

      <ul className="mt-2 space-y-2 animate-flow-down" key={topTab}>
        {filtered.length === 0 && (
          <p className="py-3 text-center text-xs text-neutral-500">
            No pending {topTab} records.
          </p>
        )}

        {filtered.map((a) => {
          const isSia = a.type === 'SIA'
          const totalAllocBags = isSia
            ? (a.sackLines ?? []).reduce((s, l) => s + (l.totalAllocationBags ?? 0), 0)
            : a.totalAllocationBags
          const totalIssuedBags = isSia
            ? (a.sackLines ?? []).reduce((s, l) => s + (l.totalIssuedBags ?? 0), 0)
            : a.totalIssuedBags

          const kilos = calculateAuthorityStatus(a.totalAllocationKilos, a.totalIssuedKilos)
          const bags = calculateAuthorityStatus(totalAllocBags, totalIssuedBags)
          const status = kilos.status ?? bags.status
          const unitLabel = isSia ? 'pieces' : 'bags'
          const variety = a.type === 'AI' ? varietyMap.get(a.varietyId) : null
          const warehouse = warehouseMap.get(a.assignedWarehouse)

          const progressColor =
            status === 'Over-Issued'
              ? 'text-brand-crimson'
              : status === 'Complete'
                ? 'text-brand-neon'
                : 'text-app-text'

          return (
            <li
              key={a.authId}
              className="flex items-stretch gap-2 rounded-xl border border-neutral-800 bg-neutral-900 transition-all hover:border-brand-neon/50"
            >
              <button
                type="button"
                onClick={(e) => toggleManualComplete(a, e)}
                aria-label={a.manuallyCompleted ? 'Mark as pending' : 'Mark as completed'}
                className={`flex w-10 shrink-0 items-center justify-center rounded-l-xl border-r border-neutral-800 transition-colors ${
                  a.manuallyCompleted
                    ? 'bg-brand-neon/10 text-brand-neon'
                    : 'text-neutral-600 hover:text-neutral-400'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                    a.manuallyCompleted ? 'border-brand-neon bg-brand-neon/20' : 'border-neutral-700'
                  }`}
                >
                  {a.manuallyCompleted && <Check size={14} />}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const hasPartialIssuance = (totalIssuedBags ?? 0) > 0 || (a.totalIssuedKilos ?? 0) > 0
                  if (hasPartialIssuance) {
                    setChoiceAuthority(a)
                  } else {
                    handleOpen(a)
                  }
                }}
                className="flex flex-1 items-center justify-between gap-3 py-2 pr-3 text-left active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${categoryColor(a)}`}>
                    {a.type} · {a.type === 'AI' ? a.aiNumber : a.siaNumber}
                  </p>
                  <p className="truncate text-xs text-neutral-400">
                    {warehouse ? `${warehouse.code} — ${warehouse.name}` : a.assignedWarehouse}
                  </p>
                  <p className="break-words text-xs text-neutral-400">
                    {a.customerName}
                    {a.transactionTypeName ? ` — ${a.transactionTypeName}` : ''}
                  </p>
                  <p className="break-words text-xs text-neutral-500">
                    {a.type === 'AI' && variety ? `${variety.name} (${variety.category})` : ''}
                    {isSia && (a.sackLines ?? []).length > 0
                      ? a.sackLines.map((l) => `${sackTypeMap.get(l.sackTypeId)?.code ?? '?'} ${l.condition ?? ''}`).join(', ')
                      : ''}
                  </p>
                  {a.date && (
                    <p className="truncate text-xs text-neutral-600">{String(a.date).slice(0, 10)}</p>
                  )}
                  {authorityExtraDetails(a).length > 0 && (
                    <p className="break-words text-xs text-neutral-600">
                      {authorityExtraDetails(a).map((d) => `${d.label}: ${d.value}`).join(' · ')}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  {a.totalAllocationKilos != null && (
                    <div className={`leading-tight ${progressColor}`}>
                      <p className="text-sm font-semibold">{fmtWeight(a.totalIssuedKilos ?? 0, weightUnit)}</p>
                      <p className="text-xs text-neutral-500">/ {fmtWeight(a.totalAllocationKilos, weightUnit)}</p>
                    </div>
                  )}
                  {totalAllocBags != null && (
                    <div className={`mt-1 leading-tight ${progressColor}`}>
                      <p className="text-sm font-semibold">{fmtBags(totalIssuedBags ?? 0)}</p>
                      <p className="text-xs text-neutral-500">/ {fmtBags(totalAllocBags)} {unitLabel}</p>
                    </div>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {showCompleted && (
        <CompletedAuthorityModal
          authorities={completedList}
          type={topTab}
          varietyMap={varietyMap}
          sackTypeMap={sackTypeMap}
          warehouseMap={warehouseMap}
          onClose={() => setShowCompleted(false)}
        />
      )}

      {choiceAuthority && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
          onClick={() => setChoiceAuthority(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2 py-1 text-center text-sm font-medium text-app-text">
              {choiceAuthority.type} · {choiceAuthority.type === 'AI' ? choiceAuthority.aiNumber : choiceAuthority.siaNumber}
            </p>
            <button
              type="button"
              onClick={() => { handleOpen(choiceAuthority); setChoiceAuthority(null) }}
              className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left text-sm font-medium text-app-text transition-all hover:border-brand-neon/50 active:scale-[0.99]"
            >
              Add New Transaction
            </button>
            <button
              type="button"
              onClick={() => { setViewingAuthority(choiceAuthority); setChoiceAuthority(null) }}
              className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left text-sm font-medium text-app-text transition-all hover:border-brand-neon/50 active:scale-[0.99]"
            >
              View Transactions
            </button>
            <button
              type="button"
              onClick={() => setChoiceAuthority(null)}
              className="mt-2 w-full rounded-xl px-4 py-3 text-center text-sm font-medium text-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {viewingAuthority && (
        <AuthorityReconciliationPanel
          authority={viewingAuthority}
          onClose={() => setViewingAuthority(null)}
        />
      )}
    </div>
  )
}

export default AuthorityMonitor
