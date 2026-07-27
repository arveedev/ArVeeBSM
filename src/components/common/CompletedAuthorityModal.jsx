// Completed AI/SIA Modal — a separate popup (not an inline tab) for
// browsing completed allocations, since that list can grow very long
// over time and would hurt usability if shown inline. Sortable by month
// and year (month defaults to All, year defaults to the current year).
// Tapping an entry opens the same reconciliation panel the admin side
// already uses, showing every WSI/ESI document that used it.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Check } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { isAuthorityNaturallyComplete, authorityExtraDetails, fmtBags, fmtWeight } from '../../utils/calculations.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import AuthorityReconciliationPanel from './AuthorityReconciliationPanel.jsx'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function CompletedAuthorityModal({ authorities, type, varietyMap, sackTypeMap, warehouseMap, onClose }) {
  const { weightUnit } = useSettings() ?? {}
  const currentYear = new Date().getFullYear()
  const [month, setMonth] = useState('All')
  const [year, setYear] = useState(String(currentYear))
  const [reconciling, setReconciling] = useState(null)

  // Palay is green, Rice is blue - matches the same convention used in
  // the pending list, for consistency across the whole AI/SIA monitor.
  const categoryColor = (a) => {
    const category = type === 'AI' ? varietyMap.get(a.varietyId)?.category : sackTypeMap?.get(a.sackLines?.[0]?.sackTypeId)?.category
    if (category === 'Rice') return 'text-blue-400'
    if (category === 'Palay') return 'text-brand-neon'
    return 'text-app-text'
  }

  const handleUncomplete = async (authority, e) => {
    e.stopPropagation()
    await db.authorities.update(authority.authId, { manuallyCompleted: false })
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
    .sort((x, y) => (y.completedDate ?? '').localeCompare(x.completedDate ?? ''))

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
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
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
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
              const canUncomplete = a.manuallyCompleted && !isAuthorityNaturallyComplete(a)

              return (
                <li key={a.authId} className="flex items-stretch gap-2 rounded-xl border border-neutral-800 bg-neutral-900">
                  {canUncomplete && (
                    <button
                      type="button"
                      onClick={(e) => handleUncomplete(a, e)}
                      aria-label="Mark as pending"
                      className="flex w-10 shrink-0 items-center justify-center rounded-l-xl border-r border-neutral-800 bg-brand-neon/10 text-brand-neon"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-md border border-brand-neon bg-brand-neon/20">
                        <Check size={14} />
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
    </div>
  )
}

export default CompletedAuthorityModal
