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
import { Search, X, Check } from 'lucide-react'
import { db } from '../db/dexie.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { calculateAuthorityStatus, isAuthorityComplete, authorityExtraDetails, dedupeAuthoritiesByRef, fmtBags, fmtWeight } from '../utils/calculations.js'
import ShrinkFilterRow from '../components/common/ShrinkFilterRow.jsx'
import { authorityMatchesQuery } from '../utils/monitoringSearch.js'
import AuthorityReconciliationPanel from '../components/common/AuthorityReconciliationPanel.jsx'
import CompletedAuthorityModal from '../components/common/CompletedAuthorityModal.jsx'
import MillingMonitor from '../components/common/MillingMonitor.jsx'
import NfaMillingMonitor from '../components/common/NfaMillingMonitor.jsx'

const TABS = ['AI', 'SIA', 'MILLING', 'NFA']

function AdminMonitoring() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin'
  const { weightUnit } = useSettings() ?? {}
  const { setPageHeader } = usePageHeader() ?? {}
  const [activeTab, setActiveTab] = useState('AI')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAuthority, setSelectedAuthority] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [regionalAuthFilter, setRegionalAuthFilter] = useState('')
  // authId currently playing its "marked complete" glow+collapse exit
  // animation - admin-only, mirrors AuthorityMonitor.jsx's exact
  // pattern (the DB write is deliberately delayed until the animation
  // finishes, and completingId is cleared only once the live query
  // confirms the authority has actually left this list, not on a fixed
  // timer, to avoid a flicker/reappear race against Dexie's async
  // re-query).
  const [completingId, setCompletingId] = useState(null)

  useEffect(() => {
    setPageHeader?.({ title: 'Monitoring', subtitle: 'Cross-warehouse AI / SIA oversight.' })
  }, [])

  // Reported: switching tabs left the previous tab's search text AND
  // its regional-authority dropdown selection sitting there - a number
  // picked on the AI tab (say) almost never exists under SIA too, so
  // switching to SIA silently kept filtering to that leftover AI-only
  // number, showing "no pending records" even though SIA genuinely had
  // some - reading as a blank/broken tab rather than what it actually
  // was, a stale filter from the tab the user just left. Also resets
  // the open reconciliation panel for the same reason - it's keyed to
  // one specific authority record, which has no meaning once the tab
  // (and thus the list it came from) has changed.
  useEffect(() => {
    setSearchQuery('')
    setRegionalAuthFilter('')
    setSelectedAuthority(null)
  }, [activeTab])

  // Reported: searching while scrolled down never brought the matching
  // results into view - the list re-filtered in place, off-screen, with
  // no indication anything happened. A first version of this only
  // scrolled once (empty -> non-empty), on the theory that scrolling on
  // every keystroke while refining an already-visible search would feel
  // like it was yanking the view around - reported back that this
  // wasn't enough: continuing to type after that first jump needs to
  // keep bringing the (changing) results into view too. Scrolls to top
  // on every real change to the search text now, not just the first
  // character.
  useEffect(() => {
    if (searchQuery.trim()) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [searchQuery])

  const authorities = useLiveQuery(() => db.authorities.toArray(), []) ?? []

  useEffect(() => {
    if (!completingId) return
    const stillPending = authorities.some((a) => a.authId === completingId && !isAuthorityComplete(a))
    if (!stillPending) setCompletingId(null)
  }, [authorities, completingId])

  // Must match .animate-row-complete-out's duration in index.css.
  const ROW_EXIT_MS = 700

  const toggleManualComplete = (authority, e) => {
    e.stopPropagation()
    setCompletingId(authority.authId)
    setTimeout(() => {
      db.authorities.update(authority.authId, { manuallyCompleted: true })
    }, ROW_EXIT_MS)
  }
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
    if (category === 'By Products') return 'text-brand-byproduct'
    return 'text-app-text'
  }

  const query = searchQuery.trim().toLowerCase()

  const typeAuthorities = authorities.filter((a) => a.type === activeTab)
  // Scoped to PENDING authorities only - this picker sits alongside the
  // pending list, so it should never offer a regional authority number
  // that has no pending records under it (previously built from every
  // authority of this type regardless of status, so picking one could
  // silently land on "No pending records" even though that number is
  // real, just fully completed already).
  const availableRegionalAuthNumbers = [...new Set(
    typeAuthorities.filter((a) => !isAuthorityComplete(a)).map((a) => a.regionalAuthorityNumber).filter(Boolean)
  )].sort()

  // matchesQuery is kept separate from the list itself (rather than
  // .filter()ing the search term out before rendering) so every row can
  // stay mounted and animate away/back in as the user types (see
  // ShrinkFilterRow) instead of just disappearing/reappearing instantly.
  // Broad match (customer, authority/AI/SIA number, warehouse, O.R.
  // number, remarks/notes - not just the ref number) per explicit
  // request - see monitoringSearch.js for the exact field list.
  const matchesQuery = (a) => authorityMatchesQuery(a, searchQuery, warehouseMap)
  const preSearchFiltered = dedupeAuthoritiesByRef(typeAuthorities.filter((a) => !isAuthorityComplete(a)))
    .filter((a) => !regionalAuthFilter.trim() || a.regionalAuthorityNumber === regionalAuthFilter.trim())
    .sort((a, b) => {
      const aRef = a.type === 'AI' ? a.aiNumber : a.siaNumber
      const bRef = b.type === 'AI' ? b.aiNumber : b.siaNumber
      return (aRef ?? '').localeCompare(bRef ?? '')
    })
  const filtered = preSearchFiltered.filter(matchesQuery)
  const completedList = dedupeAuthoritiesByRef(typeAuthorities.filter(isAuthorityComplete))

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
      {/* Tabs, search, and the regional-authority selector all stick
          together as one cohesive block - keeping them in a single
          sticky container (rather than each computing its own top
          offset) is what keeps the spacing between them consistent and
          keeps the authority selector from scrolling out of reach. */}
      <div className="sticky top-16 z-40 -mx-4 mt-4 space-y-2 border-b border-neutral-800 bg-neutral-950 px-4 pb-3 pt-2">
        <div className="relative flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
          <div
            className="absolute inset-y-1 rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
            style={{
              width: `calc(${100 / TABS.length}% - ${(TABS.length - 1) / TABS.length * 0.5}rem)`,
              transform: `translateX(calc(${TABS.indexOf(activeTab) * 100}% + ${TABS.indexOf(activeTab) * 0.5}rem))`,
            }}
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

        {activeTab !== 'MILLING' && activeTab !== 'NFA' && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search"
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900 py-2 pl-9 pr-9 text-sm text-app-text outline-none focus:border-brand-neon"
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
              <button
                type="button"
                onClick={() => setShowCompleted(true)}
                className="shrink-0 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-brand-neon hover:border-brand-neon/50"
              >
                Completed
              </button>
            </div>

            {availableRegionalAuthNumbers.length > 0 && (
              <select
                value={regionalAuthFilter}
                onChange={(e) => setRegionalAuthFilter(e.target.value)}
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-app-text"
              >
                <option value="">All Authority Numbers</option>
                {availableRegionalAuthNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {/* MillingMonitor/NfaMillingMonitor both call useLiveQuery
          internally, so switching tabs via if/else (a different
          component type each branch, which always remounts regardless
          of any key) restarted their queries from undefined and
          flashed an empty/loading state before real data replaced it -
          same bug already fixed in Settings.jsx/BeginningBalancesPanel.jsx
          etc. Both stay mounted, toggled via hidden instead. The AI/SIA
          branch has no useLiveQuery of its own (authorities is fetched
          once at the top of this component), so it's flash-safe either
          way, but kept in the same always-mounted shape for consistency. */}
      <div className={`mt-4 ${activeTab === 'MILLING' ? '' : 'hidden'}`}>
        <MillingMonitor isAdmin={isAdmin} active={activeTab === 'MILLING'} />
      </div>
      <div className={activeTab === 'NFA' ? '' : 'hidden'}>
        <NfaMillingMonitor active={activeTab === 'NFA'} />
      </div>
      <div className={activeTab === 'MILLING' || activeTab === 'NFA' ? 'hidden' : ''}>
      {/* Reported, real gap: this box only ever appeared when the admin
          picked a regional authority number from the dropdown - typing
          into the search box instead left it invisible, even when it
          plainly narrowed the list to something summarizable. Two
          sources now feed the exact same box: the dropdown (unchanged -
          every authority under that number, regardless of pending/
          completed status, for the full overall picture) or, whenever
          the dropdown itself isn't set, the search's own current
          matches - summarizing whatever's actually shown in the pending
          list below. If every matched row happens to share one regional
          authority number, that number becomes the label just like the
          dropdown case; otherwise it's labeled by how many distinct
          authorities matched, since there's no single number left to
          name it after. */}
      {(() => {
        const hasDropdown = Boolean(regionalAuthFilter.trim())
        const hasSearch = Boolean(searchQuery.trim())
        if (!hasDropdown && !hasSearch) return null

        let sourceAuthorities
        let label
        if (hasDropdown) {
          sourceAuthorities = typeAuthorities.filter((a) => a.regionalAuthorityNumber === regionalAuthFilter.trim())
          label = regionalAuthFilter.trim()
        } else {
          sourceAuthorities = filtered
          const nums = new Set(filtered.map((a) => a.regionalAuthorityNumber).filter(Boolean))
          label = nums.size === 1
            ? [...nums][0]
            : `${filtered.length} matching ${filtered.length === 1 ? 'authority' : 'authorities'}`
        }
        if (sourceAuthorities.length === 0) return null

        const totalIssuedBags = sourceAuthorities.reduce((s, a) => s + (a.totalIssuedBags ?? 0), 0)
        const totalIssuedKilos = sourceAuthorities.reduce((s, a) => s + (a.totalIssuedKilos ?? 0), 0)
        // Per explicit request - the remaining (authorized minus issued)
        // figure alongside what's already issued, so this box shows the
        // full picture rather than only the "used so far" half of it.
        const totalAllocatedBags = sourceAuthorities.reduce((s, a) => s + (a.totalAllocationBags ?? 0), 0)
        const totalAllocatedKilos = sourceAuthorities.reduce((s, a) => s + (a.totalAllocationKilos ?? 0), 0)
        const remainingBags = Math.max(0, totalAllocatedBags - totalIssuedBags)
        const remainingKilos = Math.max(0, totalAllocatedKilos - totalIssuedKilos)
        const byWarehouse = new Map()
        for (const a of sourceAuthorities) {
          const key = a.assignedWarehouse ?? 'Unassigned'
          const current = byWarehouse.get(key) ?? { bags: 0, kilos: 0 }
          current.bags += a.totalIssuedBags ?? 0
          current.kilos += a.totalIssuedKilos ?? 0
          byWarehouse.set(key, current)
        }

        return (
          <div className="mx-4 mt-2 rounded-xl border border-brand-neon/30 bg-brand-neon/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">
              {label}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <p className="text-[10px] uppercase text-neutral-500">Issued</p>
                <p className="mt-0.5 text-base font-bold tabular-nums text-app-text">{fmtBags(totalIssuedBags)} bags</p>
                <p className="text-xs tabular-nums text-neutral-500">{fmtWeight(totalIssuedKilos, weightUnit)}</p>
              </div>
              <div className="rounded-lg border border-brand-amber/30 bg-brand-amber/5 p-2">
                <p className="text-[10px] uppercase text-brand-amber/80">Remaining</p>
                <p className="mt-0.5 text-base font-bold tabular-nums text-brand-amber">{fmtBags(remainingBags)} bags</p>
                <p className="text-xs tabular-nums text-brand-amber/70">{fmtWeight(remainingKilos, weightUnit)}</p>
              </div>
            </div>
            <div className="mt-2 space-y-1 border-t border-neutral-800 pt-2">
              {[...byWarehouse.entries()].map(([warehouseId, totals]) => {
                const warehouse = warehouseMap.get(warehouseId)
                return (
                  <div key={warehouseId} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-400">{warehouse ? `${warehouse.code} — ${warehouse.name}` : warehouseId}</span>
                    <span className="font-semibold tabular-nums text-app-text">
                      {fmtBags(totals.bags)} bags · {fmtWeight(totals.kilos, weightUnit)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      <ul className="mt-4 animate-flow-down" key={`${activeTab}-${regionalAuthFilter}`}>
        {filtered.length === 0 && (
          <p className="mt-4 text-center text-xs text-neutral-500">
            No pending {activeTab} records {query ? 'match that search.' : 'yet.'}
          </p>
        )}

        {preSearchFiltered.map((a) => {
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

          // Shows checked immediately on tap, independent of the
          // (deliberately delayed) DB write - same as
          // AuthorityMonitor.jsx's own pending list.
          const isCompleting = completingId === a.authId
          const showsChecked = a.manuallyCompleted || isCompleting

          return (
            <ShrinkFilterRow key={a.authId} as="li" matches={matchesQuery(a)}>
            <div
              className={`flex items-stretch gap-2 rounded-xl border border-neutral-800 bg-neutral-900 transition-all hover:border-brand-neon/50 ${isCompleting ? 'animate-row-complete-out pointer-events-none' : ''}`}
            >
              {isAdmin && (
                <button
                  type="button"
                  onClick={(e) => toggleManualComplete(a, e)}
                  aria-label={showsChecked ? 'Mark as pending' : 'Mark as completed'}
                  className={`flex w-10 shrink-0 items-center justify-center rounded-l-xl border-r border-neutral-800 transition-colors ${
                    showsChecked
                      ? 'bg-brand-neon/10 text-brand-neon'
                      : 'text-neutral-600 hover:text-neutral-400'
                  }`}
                >
                  <span
                    className={`relative flex h-5 w-5 items-center justify-center rounded-md border ${
                      showsChecked ? 'border-brand-neon bg-brand-neon/20' : 'border-neutral-700'
                    }`}
                  >
                    {isCompleting && (
                      <span className="absolute inset-0 rounded-full border border-brand-neon animate-stamp-ring" />
                    )}
                    {showsChecked && <Check size={14} className={isCompleting ? 'animate-stamp-drop' : ''} />}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedAuthority(a)}
                className="flex-1 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.99]"
              >
                {/* Per explicit request - restyled to match the
                    Unwithdrawn drill-down's own redesign: details get
                    the full row width (nothing squeezed into a narrow
                    side column any more), with a compact issued/
                    remaining strip - big bold issued figure, a smaller
                    amber remaining figure, a thin progress bar between
                    them, then the kg equivalent underneath - instead of
                    two plain "X of Y" lines stacked on the right. Bags
                    (or SIA pieces) drives the primary line/bar
                    whenever it exists, since it's always present for
                    both AI and SIA; a record with only a kilos
                    allocation (no bags) falls back to kilos as the
                    primary line instead. */}
                <div className="min-w-0">
                  <p className={`text-base font-medium ${categoryColor(a)}`}>
                    {a.type} · {a.type === 'AI' ? a.aiNumber : a.siaNumber}
                  </p>
                  <p className="truncate text-sm text-neutral-400">
                    {warehouse ? `${warehouse.code} — ${warehouse.name}` : a.assignedWarehouse}
                  </p>
                  <p className="break-words text-sm text-neutral-400">
                    {a.customerName}
                    {a.transactionTypeName ? ` — ${a.transactionTypeName}` : ''}
                  </p>
                  <p className="break-words text-sm text-neutral-500">
                    {a.type === 'AI' && variety ? `${variety.name} (${variety.category})` : ''}
                    {isSia && (a.sackLines ?? []).length > 0
                      ? a.sackLines.map((l) => `${sackTypeMap.get(l.sackTypeId)?.code ?? '?'} ${l.condition ?? ''}`).join(', ')
                      : ''}
                  </p>
                  {a.date && (
                    <p className="truncate text-sm text-neutral-600">{String(a.date).slice(0, 10)}</p>
                  )}
                  {authorityExtraDetails(a).length > 0 && (
                    <p className="break-words text-sm text-neutral-600">
                      {authorityExtraDetails(a).map((d) => `${d.label}: ${d.value}`).join(' · ')}
                    </p>
                  )}
                </div>

                {(() => {
                  const hasBags = totalAllocBags != null
                  const hasKilos = a.totalAllocationKilos != null
                  if (!hasBags && !hasKilos) return null
                  const primaryAllocation = hasBags ? totalAllocBags : a.totalAllocationKilos
                  const primaryIssued = hasBags ? (totalIssuedBags ?? 0) : (a.totalIssuedKilos ?? 0)
                  const primaryRemaining = hasBags ? bags.balanceRemaining : kilos.balanceRemaining
                  const percent = primaryAllocation > 0 ? Math.min(100, Math.max(0, (primaryIssued / primaryAllocation) * 100)) : 0
                  const fmtPrimary = (v) => hasBags ? `${fmtBags(v)} ${unitLabel}` : fmtWeight(v, weightUnit)
                  return (
                    <div className="mt-2.5 border-t border-neutral-800 pt-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`text-xl font-bold tabular-nums ${progressColor}`}>
                          {fmtPrimary(primaryIssued)} <span className="text-sm font-normal text-neutral-500">issued</span>
                        </span>
                        {primaryRemaining != null && (
                          <span className="whitespace-nowrap text-lg font-semibold tabular-nums text-brand-amber">
                            {fmtPrimary(Math.max(0, primaryRemaining))} <span className="text-sm font-normal text-brand-amber/70">left</span>
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                        <div
                          className={`h-full rounded-full ${status === 'Over-Issued' ? 'bg-brand-crimson' : status === 'Complete' ? 'bg-brand-neon' : 'bg-blue-400'}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      {hasBags && hasKilos && (
                        <div className="mt-1 flex items-center justify-between text-base tabular-nums text-neutral-500">
                          <span>{fmtWeight(a.totalIssuedKilos ?? 0, weightUnit)}</span>
                          <span>{fmtWeight(Math.max(0, kilos.balanceRemaining ?? 0), weightUnit)}</span>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </button>
            </div>
            </ShrinkFilterRow>
          )
        })}
      </ul>
      </div>

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
          // Admin/Visitor's "accessible" warehouses is every warehouse -
          // unlike the regular warehouse-supervisor side, there's no
          // narrower per-user scope to respect here.
          accessibleWarehouses={warehouses}
          canManuallyToggle={isAdmin}
          onClose={() => setShowCompleted(false)}
        />
      )}
    </div>
  )
}

export default AdminMonitoring
