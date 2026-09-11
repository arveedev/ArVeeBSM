// NFA Ricemill Monitor - read-only status view of NFA-owned Ricemill
// milling activity. Setting up (creating/editing/deleting) allocations
// stays admin-only in Settings > Miller Allocations
// (RicemillAllocationsPanel.jsx) - visitors/facility users must never
// get create/edit/delete controls anywhere, so this is deliberately
// display-only, reusing the exact same allocation/usage/recovery
// computations.
//
// Two usages:
// - No warehouseId (Admin/Visitor Monitoring page's NFA tab): every
//   Ricemill warehouse, every Regional Authority Number.
// - warehouseId passed (a Ricemill facility's own Home page, replacing
//   the generic Milling Operations/MO-TMO list that doesn't concern
//   them - NFA-owned Ricemills don't use MO/TMO numbers at all): scoped
//   to just that facility's own activity and only the Regional
//   Authority Number(s) actually assigned to it, not every ricemill's.

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { fmtWeight, isTransferTypeName, dedupeAuthoritiesByRef } from '../../utils/calculations.js'
import RicemillRecoveryDetail, { AllocationUsageSummary } from './RicemillRecoveryDetail.jsx'
import ShrinkFilterRow from './ShrinkFilterRow.jsx'
import { nfaAllocationMatchesQuery } from '../../utils/monitoringSearch.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { byAlpha, listItemClass } from './admin/shared.js'

// `active` - true by default (the facility Home page usage, warehouseId
// passed, is the only view in that context so it's always active).
// AdminMonitoring's NFA tab passes its own activeTab === 'NFA' - this
// component stays mounted even while that tab is hidden (see
// AdminMonitoring.jsx's own comment on why), so it can't rely on
// unmounting to reset its search when the user switches away.
function NfaMillingMonitor({ warehouseId, active = true } = {}) {
  const { weightUnit } = useSettings() ?? {}
  const [expandedNumber, setExpandedNumber] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    if (!active) setSearchQuery('')
  }, [active])

  // Reported: searching while scrolled down never brought the matching
  // rows into view. Scrolls this card back into view the moment a
  // search actually STARTS (empty -> non-empty), not on every further
  // keystroke.
  const wasSearchEmptyRef = useRef(true)
  useEffect(() => {
    const isEmpty = !searchQuery.trim()
    if (!isEmpty && wasSearchEmptyRef.current) {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    wasSearchEmptyRef.current = isEmpty
  }, [searchQuery])

  const allocations = useLiveQuery(() => db.ricemillAllocations.toArray(), []) ?? []

  // Regional Authority Numbers actually assigned to THIS facility (via
  // its own AI authorities) - a Regional Authority Number maps to
  // exactly one ricemill in practice, so this is what scopes the list
  // down to "this facility's own", not every ricemill's.
  const relevantNumbersForWarehouse = useLiveQuery(async () => {
    if (!warehouseId) return null
    const authorities = await db.authorities
      .where('assignedWarehouse').equals(warehouseId)
      .and((a) => a.type === 'AI' && Boolean(a.regionalAuthorityNumber))
      .toArray()
    return new Set(authorities.map((a) => a.regionalAuthorityNumber))
  }, [warehouseId]) ?? null

  const sortedAllocations = [...allocations]
    .filter((a) => !warehouseId || relevantNumbersForWarehouse == null || relevantNumbersForWarehouse.has(a.regionalAuthorityNumber))
    .sort((a, b) => byAlpha(a.regionalAuthorityNumber, b.regionalAuthorityNumber))


  // Recovery detail, per Regional Authority Number - "rice out" is every
  // TRANSFER-type AI record's own recorded allocation where the variety
  // is categorized as Rice. "Palay in" is DERIVED, not read from an
  // actual AI record: per explicit confirmation, the mill's own
  // configured daily input capacity (Net Bags/day, set in Settings >
  // Miller Allocations) is what went in for milling on every distinct
  // date that has real rice-out activity - a real Milling-type AI
  // record in practice is one lump-sum authorization, not a day-by-day
  // log, so it can't answer "how much went in on this specific day" on
  // its own.
  const recoverySummaryByNumber = useLiveQuery(async () => {
    let ricemillIds
    if (warehouseId) {
      ricemillIds = [warehouseId]
    } else {
      const ricemillWarehouses = await db.warehouses.where('facilityType').equals('Ricemill').toArray()
      ricemillIds = ricemillWarehouses.map((w) => w.warehouseId)
    }
    if (ricemillIds.length === 0) return new Map()
    const ricemillIdSet = new Set(ricemillIds)

    // Deduped by AI # before building any per-day entries below - a
    // sync-race duplicate authId for the same real aiNumber (see
    // dedupeAuthoritiesByRef's own doc comment) otherwise shows up here
    // as the exact same date/Net Bags/Net Kgs row appearing twice.
    const authorities = dedupeAuthoritiesByRef(await db.authorities.where('type').equals('AI').toArray())
    const varietyList = await db.varietyTypes.toArray()
    const varietyMap = new Map(varietyList.map((v) => [v.varietyId, v]))
    const capacityByNumber = new Map(allocations.map((a) => [a.regionalAuthorityNumber, a.millingInputCapacityBags ?? 0]))

    const transferEntriesByNumber = new Map()
    for (const a of authorities) {
      if (!a.regionalAuthorityNumber || !ricemillIdSet.has(a.assignedWarehouse)) continue
      if (!isTransferTypeName(a.transactionTypeName)) continue
      if (varietyMap.get(a.varietyId)?.category !== 'Rice') continue
      if (!transferEntriesByNumber.has(a.regionalAuthorityNumber)) transferEntriesByNumber.set(a.regionalAuthorityNumber, [])
      transferEntriesByNumber.get(a.regionalAuthorityNumber).push({
        authId: a.authId, date: a.date, aiNumber: a.aiNumber,
        varietyName: varietyMap.get(a.varietyId)?.name ?? '',
        // Net Bags is always kilos / 50 here, NOT the sheet's own raw
        // BAG column - that's a manually counted physical bag tally
        // that can legitimately drift from the weight-derived figure
        // (e.g. 3,203.200 kg was recorded as "64" bags on the sheet,
        // not the mathematically exact 64.064) - this display is
        // specifically the derived Net Bags unit, so it must actually
        // equal kilos / 50, confirmed directly.
        bags: (a.totalAllocationKilos ?? 0) / 50, kilos: a.totalAllocationKilos ?? 0,
      })
    }

    const summary = new Map()
    for (const [regionalNum, transferEntries] of transferEntriesByNumber) {
      transferEntries.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      const capacityBags = capacityByNumber.get(regionalNum) ?? 0
      const capacityKilos = capacityBags * 50 // same 50 kg/bag conversion used app-wide (AdminHome, HomeStocks)

      const distinctDates = [...new Set(transferEntries.map((e) => e.date))].sort()
      const millingEntries = distinctDates.map((date) => ({
        authId: `derived-${regionalNum}-${date}`, date, aiNumber: null,
        varietyName: 'Mill capacity', bags: capacityBags, kilos: capacityKilos,
      }))

      const recoveredKilos = transferEntries.reduce((sum, e) => sum + e.kilos, 0)
      const recoveredBags = transferEntries.reduce((sum, e) => sum + e.bags, 0)
      const issuedKilos = capacityKilos * distinctDates.length
      const issuedBags = capacityBags * distinctDates.length

      summary.set(regionalNum, {
        issuedKilos, issuedBags, recoveredKilos, recoveredBags,
        recoveryPct: issuedKilos > 0 ? (recoveredKilos / issuedKilos) * 100 : null,
        millingEntries, transferEntries,
      })
    }
    return summary
  }, [warehouseId, allocations]) ?? new Map()

  return (
    <div ref={containerRef} className={warehouseId ? '' : 'mt-4'}>
      <p className="mb-2 text-sm text-neutral-500 md:text-base">
        {warehouseId
          ? 'NFA allocation vs. actual usage for this facility.'
          : 'NFA-owned Ricemill status - allocation vs. actual usage per Regional Authority Number. Set up allocations in Settings > Miller Allocations.'}
      </p>
      {sortedAllocations.length > 0 && (
        <div className="relative mb-2">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 py-2 pl-9 pr-9 text-sm text-app-text outline-none focus:border-brand-neon"
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
      )}
      <ul>
        {sortedAllocations.length === 0 && (
          <p className="py-6 text-center text-sm text-neutral-500 md:text-base">
            {warehouseId ? 'No NFA allocation assigned to this facility yet.' : 'No NFA ricemill allocations set up yet.'}
          </p>
        )}
        {sortedAllocations.length > 0 && sortedAllocations.every((a) =>
          !nfaAllocationMatchesQuery(a.regionalAuthorityNumber, recoverySummaryByNumber.get(a.regionalAuthorityNumber)?.transferEntries, searchQuery)
        ) && (
          <p className="py-6 text-center text-sm text-neutral-500 md:text-base">No Regional Authority Numbers match that search.</p>
        )}
        {sortedAllocations.map((a) => {
          const recovery = recoverySummaryByNumber.get(a.regionalAuthorityNumber)
          // The allocation is a PALAY quota, not a rice quota - what
          // draws it down is Issuance (palay in), not Receipt (rice
          // out). Confirmed directly after this showed the Receipt
          // total against the allocation, which was wrong.
          const used = recovery?.issuedKilos ?? 0
          const isExpanded = expandedNumber === a.regionalAuthorityNumber
          const matches = nfaAllocationMatchesQuery(a.regionalAuthorityNumber, recovery?.transferEntries, searchQuery)
          return (
            <ShrinkFilterRow key={a.regionalAuthorityNumber} as="li" matches={matches} gapClass="mt-1.5">
            <div className={`${listItemClass} flex-col items-stretch`}>
              <button
                type="button"
                onClick={() => setExpandedNumber(isExpanded ? null : a.regionalAuthorityNumber)}
                className="w-full text-left"
              >
                <p className="truncate text-base font-medium text-app-text md:text-lg">{a.regionalAuthorityNumber}</p>
                <AllocationUsageSummary used={used} total={a.totalNetKgs} weightUnit={weightUnit} />
              </button>
              {isExpanded && (
                <div className="mt-2 border-t border-neutral-800 pt-2">
                  <RicemillRecoveryDetail recovery={recovery} weightUnit={weightUnit} />
                </div>
              )}
            </div>
            </ShrinkFilterRow>
          )
        })}
      </ul>
    </div>
  )
}

export default NfaMillingMonitor
