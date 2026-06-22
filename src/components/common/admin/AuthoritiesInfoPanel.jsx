// AI / SIA Allocations — these are issued centrally via a master Google
// Sheet and retrieved per warehouse (Phase 6: src/services/googleSheetsBridge.js),
// NOT entered manually here. AI (Authority to Issue) covers stock docs
// (WSR/WSI/WTS) and is referenced by its own `aiNumber`. SIA (Sack
// Issuance Authority) covers sack docs (ESR/ESI) and is referenced by its
// own, separate `siaNumber` — these are two distinct reference numbers,
// never shared between record types. An allocation can be defined in
// bags, net kilos, or both — issuance against it tracks whichever unit(s)
// were actually defined.
//
// The retrieval URL/sheet names are configured in the Admin Dashboard's
// "Google Sheets" tab. Until that's configured, this panel stays empty —
// `seedMockAuthority()` (dev console helper) can create sample records so
// the WSI/ESI forms have something to link against in the meantime.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { listItemClass } from './shared.js'
import { calculateAuthorityStatus } from '../../../utils/calculations.js'
import { syncAuthoritiesFromSheets } from '../../../services/googleSheetsBridge.js'

function AuthoritiesInfoPanel() {
  const [isSyncing, setIsSyncing] = useState(false)

  const authorities = useLiveQuery(() => db.authorities.toArray(), [])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [])
  const sheetsConfig = useLiveQuery(() => db.googleSheetsConfig.get('global'), [])
  const warehouseMap = new Map((warehouses ?? []).map((w) => [w.warehouseId, w]))

  const handleOpen = (authority) => {
    if (typeof window.openTransactionForm !== 'function') return

    if (authority.type === 'AI') {
      window.openTransactionForm('WSI', {
        aiNumber: authority.aiNumber,
        customerName: authority.customerName,
        varietyId: authority.varietyId,
        numberOfBags: authority.totalAllocationBags,
        grossKilos: authority.totalAllocationKilos,
      })
    } else {
      window.openTransactionForm('ESI', {
        linkedDocNo: authority.siaNumber,
        customerName: authority.customerName,
        sackTypeId: authority.sackTypeId,
        condition: authority.condition,
        pieces: authority.totalAllocationBags,
      })
    }
  }

  const handleRefresh = async () => {
    if (!sheetsConfig?.webAppUrl?.trim()) {
      toast.error('Set a Web App URL in the Google Sheets tab first')
      return
    }

    setIsSyncing(true)
    const result = await syncAuthoritiesFromSheets()
    setIsSyncing(false)

    if (result.ok) {
      toast.success(`Synced ${result.aiCount} AI and ${result.siaCount} SIA record(s)`)
    } else if (result.reason === 'offline') {
      toast.error('No connection — try again once online')
    } else {
      toast.error('Sync failed — check the Google Sheets tab')
    }
  }

  const lastSyncedLabel = sheetsConfig?.lastSyncedAt
    ? new Date(sheetsConfig.lastSyncedAt).toLocaleString()
    : 'Never'

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">AI / SIA Allocations</h2>
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
          aria-label="Refresh from Google Sheets"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-300 transition-all hover:border-neutral-600 hover:text-white active:scale-90 disabled:opacity-50"
        >
          <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
        </button>
      </div>

      <p className="mt-2 text-xs text-neutral-500">Last synced: {lastSyncedLabel}</p>

      {authorities?.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {authorities.map((a) => {
            const warehouse = warehouseMap.get(a.assignedWarehouse)
            const kilos = calculateAuthorityStatus(a.totalAllocationKilos, a.totalIssuedKilos)
            const bags = calculateAuthorityStatus(a.totalAllocationBags, a.totalIssuedBags)
            const status = kilos.status ?? bags.status
            const unitLabel = a.type === 'SIA' ? 'pieces' : 'bags'
            const progressColor =
              status === 'Over-Issued'
                ? 'text-brand-crimson'
                : status === 'Complete'
                  ? 'text-brand-neon'
                  : 'text-white'

            return (
              <li key={a.authId}>
                <button
                  type="button"
                  onClick={() => handleOpen(a)}
                  className={`${listItemClass} w-full text-left transition-all hover:border-brand-neon/50 hover:bg-neutral-900 active:scale-[0.99]`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-white">
                      {a.type} · {a.type === 'AI' ? a.aiNumber : a.siaNumber}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {warehouse ? `${warehouse.code} — ${warehouse.name}` : a.assignedWarehouse}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {a.customerName}
                      {a.transactionTypeName ? ` — ${a.transactionTypeName}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {a.manuallyCompleted ? (
                      <span className="text-sm font-semibold text-brand-neon">Completed</span>
                    ) : (
                      <>
                        {a.totalAllocationKilos != null && (
                          <p className={`text-sm font-semibold leading-tight ${progressColor}`}>
                            {(a.totalIssuedKilos ?? 0).toFixed(2)}
                            <span className="text-neutral-500"> / {a.totalAllocationKilos.toFixed(2)} kg</span>
                          </p>
                        )}
                        {a.totalAllocationBags != null && (
                          <p className={`text-sm font-semibold leading-tight ${progressColor}`}>
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
      ) : (
        <p className="mt-4 text-xs text-neutral-500">No allocations synced yet.</p>
      )}
    </section>
  )
}

export default AuthoritiesInfoPanel
