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

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie.js'
import { fmtWeight, isTransferTypeName } from '../../utils/calculations.js'
import RicemillRecoveryDetail from './RicemillRecoveryDetail.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import { byAlpha, listItemClass } from './admin/shared.js'

function NfaMillingMonitor({ warehouseId } = {}) {
  const { weightUnit } = useSettings() ?? {}
  const [expandedNumber, setExpandedNumber] = useState(null)

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

  // Same "used" definition as RicemillAllocationsPanel.jsx: the AI
  // record's OWN recorded allocation (its BAG/NET KG), for every
  // TRANSFER-type AI tagged with this Regional Authority Number - NOT a
  // linked WSI transaction. Confirmed directly: the entry form has no
  // field to attach a Regional Authority Number to a WSR/WSI
  // transaction at all, so a TRANSFER row on the AI sheet IS the real,
  // only-visible authorizing/usage event for an NFA-owned Ricemill.
  // SALES-type AI rows are explicitly excluded - not part of milling
  // operations usage.
  const usageByNumber = useLiveQuery(async () => {
    let ricemillIds
    if (warehouseId) {
      ricemillIds = [warehouseId]
    } else {
      const ricemillWarehouses = await db.warehouses.where('facilityType').equals('Ricemill').toArray()
      ricemillIds = ricemillWarehouses.map((w) => w.warehouseId)
    }
    if (ricemillIds.length === 0) return new Map()
    const ricemillIdSet = new Set(ricemillIds)

    const authorities = await db.authorities.where('type').equals('AI').toArray()
    const transferAuthorities = authorities.filter((a) =>
      a.regionalAuthorityNumber && isTransferTypeName(a.transactionTypeName) && ricemillIdSet.has(a.assignedWarehouse)
    )

    const usage = new Map()
    for (const a of transferAuthorities) {
      usage.set(a.regionalAuthorityNumber, (usage.get(a.regionalAuthorityNumber) ?? 0) + (a.totalAllocationKilos ?? 0))
    }
    return usage
  }, [warehouseId]) ?? new Map()

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

    const authorities = await db.authorities.where('type').equals('AI').toArray()
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
        bags: a.totalAllocationBags ?? 0, kilos: a.totalAllocationKilos ?? 0,
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
    <div className={warehouseId ? '' : 'mt-4'}>
      <p className="mb-2 text-xs text-neutral-500">
        {warehouseId
          ? 'NFA allocation vs. actual usage for this facility.'
          : 'NFA-owned Ricemill status - allocation vs. actual usage per Regional Authority Number. Set up allocations in Settings > Miller Allocations.'}
      </p>
      <ul className="space-y-1.5">
        {sortedAllocations.length === 0 && (
          <p className="py-6 text-center text-xs text-neutral-500">
            {warehouseId ? 'No NFA allocation assigned to this facility yet.' : 'No NFA ricemill allocations set up yet.'}
          </p>
        )}
        {sortedAllocations.map((a) => {
          const used = usageByNumber.get(a.regionalAuthorityNumber) ?? 0
          const remaining = a.totalNetKgs - used
          const recovery = recoverySummaryByNumber.get(a.regionalAuthorityNumber)
          const isExpanded = expandedNumber === a.regionalAuthorityNumber
          return (
            <li key={a.regionalAuthorityNumber} className={`${listItemClass} flex-col items-stretch`}>
              <button
                type="button"
                onClick={() => setExpandedNumber(isExpanded ? null : a.regionalAuthorityNumber)}
                className="w-full text-left"
              >
                <p className="truncate text-sm font-medium text-app-text">{a.regionalAuthorityNumber}</p>
                <p className="text-xs text-neutral-500">
                  {fmtWeight(used, weightUnit)} used of {fmtWeight(a.totalNetKgs, weightUnit)}
                  {' · '}
                  <span className={remaining < 0 ? 'text-brand-crimson' : 'text-brand-neon'}>
                    {fmtWeight(Math.abs(remaining), weightUnit)} {remaining < 0 ? 'over' : 'remaining'}
                  </span>
                </p>
              </button>
              {isExpanded && (
                <div className="mt-2 border-t border-neutral-800 pt-2">
                  <RicemillRecoveryDetail recovery={recovery} weightUnit={weightUnit} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default NfaMillingMonitor
