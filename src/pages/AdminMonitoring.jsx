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
//
// Search finds a specific AI/SIA number; tapping a matched row opens the
// reconciliation panel showing every WSI/ESI document that used it.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search } from 'lucide-react'
import { db } from '../db/dexie.js'
import { useSettings } from '../context/SettingsContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { calculateAuthorityStatus, isAuthorityComplete, authorityExtraDetails, fmtBags, fmtWeight } from '../utils/calculations.js'
import AuthorityReconciliationPanel from '../components/common/AuthorityReconciliationPanel.jsx'
import CompletedAuthorityModal from '../components/common/CompletedAuthorityModal.jsx'

const TABS = ['AI', 'SIA']

function AdminMonitoring() {
  const { weightUnit } = useSettings() ?? {}
  const { setPageHeader } = usePageHeader() ?? {}
  const [activeTab, setActiveTab] = useState('AI')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAuthority, setSelectedAuthority] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    setPageHeader?.({ title: 'Monitoring', subtitle: 'Cross-warehouse AI / SIA oversight.' })
  }, [])

  const authorities = useLiveQuery(() => db.authorities.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

  // Palay is green, Rice is blue - matches the same convention used on
  // the user-side monitor, for consistency and quick distinction now
  // that this list can get crowded.
  const categoryColor = (a) => {
    const category = a.type === 'AI' ? varietyMap.get(a.varietyId)?.category : sackTypeMap.get(a.sackLines?.[0]?.sackTypeId)?.category
    if (category === 'Rice') return 'text-blue-400'
    if (category === 'Palay') return 'text-brand-neon'
    return 'text-app-text'
  }

  const query = searchQuery.trim().toLowerCase()

  const typeAuthorities = authorities.filter((a) => a.type === activeTab)
  const filtered = typeAuthorities
    .filter((a) => !isAuthorityComplete(a))
    .filter((a) => {
      if (!query) return true
      const ref = a.type === 'AI' ? a.aiNumber : a.siaNumber
      return (ref ?? '').toLowerCase().includes(query)
    })
    .sort((a, b) => {
      const aRef = a.type === 'AI' ? a.aiNumber : a.siaNumber
      const bRef = b.type === 'AI' ? b.aiNumber : b.siaNumber
      return (aRef ?? '').localeCompare(bRef ?? '')
    })
  const completedList = typeAuthorities.filter(isAuthorityComplete)

  return (
    <div className="min-h-screen px-4 pb-24 pt-6">
      <div className="relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: activeTab === TABS[0] ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium transition-colors active:scale-95 ${
              activeTab === tab
                ? 'text-brand-contrast'
                : 'text-neutral-400 hover:text-app-text'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeTab} number for reconciliation…`}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 py-2 pl-9 pr-3 text-sm text-app-text outline-none focus:border-brand-neon"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCompleted(true)}
          className="shrink-0 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-brand-neon hover:border-brand-neon/50"
        >
          Completed
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {filtered.length === 0 && (
          <p className="mt-4 text-center text-xs text-neutral-500">
            No pending {activeTab} records {query ? 'match that search.' : 'yet.'}
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
          const warehouse = warehouseMap.get(a.assignedWarehouse)
          const variety = a.type === 'AI' ? varietyMap.get(a.varietyId) : null

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
                onClick={() => setSelectedAuthority(a)}
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-left transition-all hover:border-brand-neon/50 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${categoryColor(a)}`}>
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
                      <p className={`text-base font-semibold leading-tight ${progressColor}`}>
                        {fmtWeight(a.totalIssuedKilos ?? 0, weightUnit)}
                        <span className="text-neutral-500"> / {fmtWeight(a.totalAllocationKilos, weightUnit)}</span>
                      </p>
                    )}
                    {totalAllocBags != null && (
                      <p className={`text-base font-semibold leading-tight ${progressColor}`}>
                        {fmtBags(totalIssuedBags ?? 0)}
                        <span className="text-neutral-500"> / {fmtBags(totalAllocBags)} {unitLabel}</span>
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {selectedAuthority && (
        <AuthorityReconciliationPanel
          authority={selectedAuthority}
          onClose={() => setSelectedAuthority(null)}
        />
      )}

      {showCompleted && (
        <CompletedAuthorityModal
          authorities={completedList}
          type={activeTab}
          varietyMap={varietyMap}
          sackTypeMap={sackTypeMap}
          warehouseMap={warehouseMap}
          onClose={() => setShowCompleted(false)}
        />
      )}
    </div>
  )
}

export default AdminMonitoring
