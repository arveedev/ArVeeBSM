// AI / SIA Allocations — these are issued centrally via a master Google
// Sheet and retrieved per warehouse (src/services/googleSheetsBridge.js),
// NOT entered manually here. AI (Authority to Issue) covers stock docs
// (WSR/WSI/WTS) and is referenced by its own `aiNumber`. SIA (Sack
// Issuance Authority) covers sack docs (ESR/ESI) and is referenced by its
// own, separate `siaNumber` — these are two distinct reference numbers,
// never shared between record types. An allocation can be defined in
// bags, net kilos, or both — issuance against it tracks whichever unit(s)
// were actually defined.
//
// The retrieval URL/sheet names are configured in the Admin Dashboard's
// "Sheet Sources" tab.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { listItemClass } from './shared.js'
import { calculateAuthorityStatus, isAuthorityComplete, authorityExtraDetails } from '../../../utils/calculations.js'
import { syncAuthoritiesFromSheets } from '../../../services/googleSheetsBridge.js'

function AuthoritiesInfoPanel() {
  const [isSyncing, setIsSyncing] = useState(false)

  const authorities = useLiveQuery(() => db.authorities.toArray(), [])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [])
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const sheetSources = useLiveQuery(() => db.sheetSources.toArray(), []) ?? []
  const warehouseMap = new Map((warehouses ?? []).map((w) => [w.warehouseId, w]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

  // Palay is green, Rice is blue - applied to the AI/SIA type+number line
  // specifically, for quick visual distinction now that this list can
  // get crowded. AI's category comes from its variety; SIA's from its
  // sack type (SIA has no variety of its own).
  const categoryColor = (a) => {
    const category = a.type === 'AI'
      ? varietyMap.get(a.varietyId)?.category
      : sackTypeMap.get(a.sackLines?.[0]?.sackTypeId)?.category
    if (category === 'Rice') return 'text-blue-400'
    if (category === 'Palay') return 'text-brand-neon'
    return 'text-app-text'
  }

  const handleOpen = (authority) => {
    if (typeof window.openTransactionForm !== 'function') return

    if (authority.type === 'AI') {
      window.openTransactionForm('WSI', {
        aiNumber: authority.aiNumber,
        authorityDate: authority.date ?? null,
        customerName: authority.customerName,
        varietyId: authority.varietyId,
        transactionTypeName: authority.transactionTypeName,
        numberOfBags: authority.totalAllocationBags,
        grossKilos: authority.totalAllocationKilos,
      })
    } else {
      const remainingLines = (authority.sackLines ?? [])
        .map((l) => ({
          sackTypeId: l.sackTypeId,
          condition: l.condition,
          pieces: Math.max(0, (l.totalAllocationBags ?? 0) - (l.totalIssuedBags ?? 0)),
        }))
        .filter((l) => l.pieces > 0)

      window.openTransactionForm('ESI', {
        linkedDocNo: authority.siaNumber,
        customerName: authority.customerName,
        transactionTypeName: authority.transactionTypeName,
        sackLines: remainingLines,
      })
    }
  }

  const handleRefresh = async () => {
    if (sheetSources.length === 0) {
      toast.error('Add at least one Sheet Source in the admin Sheet Sources tab first')
      return
    }

    setIsSyncing(true)
    const result = await syncAuthoritiesFromSheets()
    setIsSyncing(false)

    if (result.ok) {
      toast.success(`Synced ${result.aiCount} AI and ${result.siaCount} SIA record(s)`)
    } else if (result.reason === 'offline') {
      toast.error('No connection — try again once online')
    } else if (result.reason === 'already_syncing') {
      toast.error('A sync is already in progress — try again in a moment')
    } else {
      toast.error('Sync failed — check the Sheet Sources tab')
    }
  }

  const lastSyncedLabel = (() => {
    const timestamps = sheetSources.map((s) => s.lastSyncedAt).filter(Boolean)
    if (timestamps.length === 0) return 'Never'
    const mostRecent = timestamps.sort().at(-1)
    return new Date(mostRecent).toLocaleString()
  })()

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-app-text">AI / SIA Allocations</h2>
          <p className="mt-2 text-sm text-neutral-400">
            AI (stocks: WSR/WSI/WTS) and SIA (sacks: ESR/ESI) allocations are
            issued centrally via a master Google Sheet and retrieved per
            warehouse — they are not entered manually here. An allocation
            can be defined in bags, net kilos, or both. Tap a row to jump
            straight into the matching WSI/ESI form with its details
            pre-filled.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isSyncing}
          aria-label="Sync Now from Google Sheets"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-90 disabled:opacity-50"
        >
          <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
          Sync Now
        </button>
      </div>

      <p className="mt-2 text-xs text-neutral-500">Last synced: {lastSyncedLabel}</p>

      {authorities?.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {authorities.map((a) => {
            const warehouse = warehouseMap.get(a.assignedWarehouse)
            const isSia = a.type === 'SIA'

            // SIA aggregates across every sack line for the summary
            // figure; AI stays exactly as before (single value).
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
            const complete = isAuthorityComplete(a)
            const progressColor =
              status === 'Over-Issued'
                ? 'text-brand-crimson'
                : status === 'Complete'
                  ? 'text-brand-neon'
                  : 'text-app-text'

            return (
              <li key={a.authId}>
                <button
                  type="button"
                  onClick={() => handleOpen(a)}
                  className={`${listItemClass} w-full text-left transition-all hover:border-brand-neon/50 hover:bg-neutral-900 active:scale-[0.99]`}
                >
                  <div className="min-w-0">
                    <p className={`font-medium ${categoryColor(a)}`}>
                      {a.type} · {a.type === 'AI' ? a.aiNumber : a.siaNumber}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {warehouse ? `${warehouse.code} — ${warehouse.name}` : a.assignedWarehouse}
                    </p>
                    <p className="text-xs text-neutral-400 break-words">
                      {a.customerName}
                      {a.transactionTypeName ? ` — ${a.transactionTypeName}` : ''}
                    </p>
                    {isSia && (a.sackLines ?? []).length > 0 && (
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {a.sackLines.map((l) => {
                          const code = sackTypeMap.get(l.sackTypeId)?.code ?? '?'
                          return `${code} ${l.condition ?? ''} ${(l.totalIssuedBags ?? 0).toLocaleString()}/${(l.totalAllocationBags ?? 0).toLocaleString()}`
                        }).join(', ')}
                      </p>
                    )}
                    {a.date && (
                      <p className="text-xs text-neutral-500">{String(a.date).slice(0, 10)}</p>
                    )}
                    {authorityExtraDetails(a).length > 0 && (
                      <p className="mt-0.5 break-words text-xs text-neutral-600">
                        {authorityExtraDetails(a).map((d) => `${d.label}: ${d.value}`).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {complete ? (
                      <span className="text-sm font-semibold text-brand-neon">Completed</span>
                    ) : (
                      <>
                        {typeof a.totalAllocationKilos === 'number' && (
                          <p className={`text-sm font-semibold leading-tight ${progressColor}`}>
                            {Number(a.totalIssuedKilos ?? 0).toFixed(2)}
                            <span className="text-neutral-500"> / {a.totalAllocationKilos.toFixed(2)} kg</span>
                          </p>
                        )}
                        {totalAllocBags != null && (
                          <p className={`text-sm font-semibold leading-tight ${progressColor}`}>
                            {(totalIssuedBags ?? 0).toLocaleString()}
                            <span className="text-neutral-500"> / {totalAllocBags.toLocaleString()} {unitLabel}</span>
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
      ) : (
        <p className="mt-4 text-xs text-neutral-500">No allocations synced yet.</p>
      )}
    </section>
  )
}

export default AuthoritiesInfoPanel
