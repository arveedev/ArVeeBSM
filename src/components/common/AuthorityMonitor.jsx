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
import { calculateAuthorityStatus } from '../../utils/calculations.js'
import { resolveSiaSackLines } from '../../utils/siaParsing.js'
import { useWarehouse } from '../../context/WarehouseContext.jsx'

const TOP_TABS = ['AI', 'SIA']
const SUB_TABS = ['Pending', 'Completed']

function AuthorityMonitor() {
  const { accessibleWarehouses, currentWarehouseId, setCurrentWarehouseId } = useWarehouse() ?? {}
  const [topTab, setTopTab] = useState('AI')
  const [subTab, setSubTab] = useState('Pending')

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
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))

  if (!authorities || authorities.length === 0) return null

  const isComplete = (a) => {
    if (a.manuallyCompleted) return true
    const { status } = calculateAuthorityStatus(
      a.totalAllocationKilos ?? a.totalAllocationBags,
      a.totalIssuedKilos ?? a.totalIssuedBags
    )
    return status === 'Complete'
  }

  const filtered = authorities
    .filter((a) => a.type === topTab)
    .filter((a) => (subTab === 'Completed' ? isComplete(a) : !isComplete(a)))
    .sort((a, b) => {
      const aRef = a.type === 'AI' ? a.aiNumber : a.siaNumber
      const bRef = b.type === 'AI' ? b.aiNumber : b.siaNumber
      return (aRef ?? '').localeCompare(bRef ?? '')
    })

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
        customerName: authority.customerName,
        varietyId: authority.varietyId,
        numberOfBags: bagsRemaining != null && bagsRemaining > 0 ? bagsRemaining : null,
        netKilos: kilosRemaining != null && kilosRemaining > 0 ? kilosRemaining : null,
        autoComputeNet: false,
      })
    } else {
      const piecesRemaining = authority.totalAllocationBags != null
        ? Math.max(0, authority.totalAllocationBags - (authority.totalIssuedBags ?? 0))
        : null

      // Resolve sack lines from the allocation, then scale pieces down to
      // the remaining balance so the form reflects what's still owed, not
      // the original total that may already be partially fulfilled.
      const allSackLines = resolveSiaSackLines(authority, sackTypes)
      let sackLines = allSackLines

      if (allSackLines.length > 0 && piecesRemaining != null) {
        const totalResolved = allSackLines.reduce((s, l) => s + (l.pieces ?? 0), 0)
        const ratio = totalResolved > 0 ? piecesRemaining / totalResolved : 0
        sackLines = allSackLines.map((l) => ({
          ...l,
          pieces: Math.round(l.pieces * ratio),
        })).filter((l) => l.pieces > 0)
      }

      window.openTransactionForm('ESI', {
        linkedDocNo: authority.siaNumber,
        customerName: authority.customerName,
        sackLines,
        rawSiaAllocation: sackLines.length === 0 ? authority.rawSiaAllocation : null,
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
      <h2 className="text-sm font-semibold text-white">AI / SIA Monitor</h2>

      <div className="mt-2 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        {TOP_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setTopTab(tab)}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-all active:scale-95 ${
              topTab === tab ? 'bg-brand-neon text-neutral-950' : 'text-neutral-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-4 border-b border-neutral-800 px-1">
        {SUB_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            className={`-mb-px border-b-2 pb-1.5 text-xs font-medium transition-colors ${
              subTab === tab
                ? 'border-brand-neon text-white'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <ul className="mt-2 space-y-2">
        {filtered.length === 0 && (
          <p className="py-3 text-center text-xs text-neutral-500">
            No {subTab.toLowerCase()} {topTab} records.
          </p>
        )}

        {filtered.map((a) => {
          const kilos = calculateAuthorityStatus(a.totalAllocationKilos, a.totalIssuedKilos)
          const bags = calculateAuthorityStatus(a.totalAllocationBags, a.totalIssuedBags)
          const status = kilos.status ?? bags.status
          const unitLabel = a.type === 'SIA' ? 'pieces' : 'bags'
          const variety = a.type === 'AI' ? varietyMap.get(a.varietyId) : null

          const progressColor =
            status === 'Over-Issued'
              ? 'text-brand-crimson'
              : status === 'Complete'
                ? 'text-brand-neon'
                : 'text-white'

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
                onClick={() => handleOpen(a)}
                className="flex flex-1 items-center justify-between gap-3 py-2 pr-3 text-left active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {a.type} · {a.type === 'AI' ? a.aiNumber : a.siaNumber}
                  </p>
                  <p className="truncate text-xs text-neutral-400">
                    {a.customerName}
                    {a.transactionTypeName ? ` — ${a.transactionTypeName}` : ''}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {a.type === 'AI' && variety ? `${variety.name} (${variety.category})` : ''}
                    {a.type === 'SIA' && a.sackTypeRaw
                      ? `${a.sackTypeRaw}${a.rawSiaAllocation ? ` — ${a.rawSiaAllocation}` : ''}`
                      : ''}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {a.manuallyCompleted ? (
                    <span className="text-sm font-semibold text-brand-neon">Completed</span>
                  ) : (
                    <>
                      {a.totalAllocationKilos != null && (
                        <p className={`text-base font-semibold leading-tight ${progressColor}`}>
                          {(a.totalIssuedKilos ?? 0).toFixed(2)}
                          <span className="text-neutral-500"> / {a.totalAllocationKilos.toFixed(2)} kg</span>
                        </p>
                      )}
                      {a.totalAllocationBags != null && (
                        <p className={`text-base font-semibold leading-tight ${progressColor}`}>
                          {(a.totalIssuedBags ?? 0).toLocaleString()}
                          <span className="text-neutral-500"> / {a.totalAllocationBags.toLocaleString()} {unitLabel}</span>
                        </p>
                      )}
                    </>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default AuthorityMonitor
