// Admin Monitoring — replaces the "Piles" tab for Admins, since an admin
// has no warehouse of their own and a piles list is meaningless to them.
// This is the dedicated cross-warehouse oversight page: AI / SIA right
// now, with Milling / Remilling / Test Milling / Test Remilling
// monitoring planned as a later addition (explicitly deferred — not
// built here).
//
// Progress is shown as ACTUAL ISSUED / TOTAL AUTHORIZED, not remaining/
// total — "100 / 250" unambiguously means 100 used out of 250, whereas a
// "remaining/total" figure looks identical to a completed record once
// fully issued (e.g. "0/250" vs "250/250" both read as extremes). This is
// the headline figure (large, color-coded), not a small subtext line.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import { calculateAuthorityStatus } from '../utils/calculations.js'

const TABS = ['AI', 'SIA']

function AdminMonitoring() {
  const [activeTab, setActiveTab] = useState('AI')

  const authorities = useLiveQuery(() => db.authorities.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))

  const filtered = authorities
    .filter((a) => a.type === activeTab)
    .sort((a, b) => {
      const aRef = a.type === 'AI' ? a.aiNumber : a.siaNumber
      const bRef = b.type === 'AI' ? b.aiNumber : b.siaNumber
      return (aRef ?? '').localeCompare(bRef ?? '')
    })

  return (
    <div className="min-h-screen px-4 pb-24 pt-6">
      <h1 className="text-xl font-semibold text-white">Monitoring</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Cross-warehouse AI / SIA oversight.
      </p>

      <div className="mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all active:scale-95 ${
              activeTab === tab
                ? 'bg-brand-neon text-neutral-950'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <ul className="mt-4 space-y-2">
        {filtered.length === 0 && (
          <p className="mt-4 text-center text-xs text-neutral-500">
            No {activeTab} records yet.
          </p>
        )}

        {filtered.map((a) => {
          const kilos = calculateAuthorityStatus(a.totalAllocationKilos, a.totalIssuedKilos)
          const bags = calculateAuthorityStatus(a.totalAllocationBags, a.totalIssuedBags)
          const status = kilos.status ?? bags.status
          const unitLabel = a.type === 'SIA' ? 'pieces' : 'bags'
          const warehouse = warehouseMap.get(a.assignedWarehouse)
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
              className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {a.type} · {a.type === 'AI' ? a.aiNumber : a.siaNumber}
                  </p>
                  <p className="truncate text-xs text-neutral-400">
                    {warehouse ? `${warehouse.code} — ${warehouse.name}` : a.assignedWarehouse}
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
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default AdminMonitoring
