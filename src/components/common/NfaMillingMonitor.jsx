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
import { fmtWeight, fmtBags, isTransferTypeName, isMillingTypeName, isTestMillingTypeName } from '../../utils/calculations.js'
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

  // Recovery detail, per Regional Authority Number - "palay in" is
  // every MILLING/REMILLING/TEST-MILLING-type AI record's own recorded
  // allocation; "rice out" is every TRANSFER-type AI record's own
  // recorded allocation where the variety is categorized as Rice (per
  // explicit confirmation: the milling transaction is the palay in, the
  // transfer transaction with the rice cereal variety is the rice out).
  // This is an AGGREGATE total per Regional Authority Number, not a
  // per-batch pairing - there's no field linking one specific milling
  // event to one specific transfer-out event, so pairing them
  // individually would be a guess this data doesn't actually support.
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

    const summary = new Map()
    const ensure = (key) => {
      if (!summary.has(key)) summary.set(key, { issuedKilos: 0, recoveredKilos: 0, millingEntries: [], transferEntries: [] })
      return summary.get(key)
    }

    for (const a of authorities) {
      if (!a.regionalAuthorityNumber || !ricemillIdSet.has(a.assignedWarehouse)) continue
      const kilos = a.totalAllocationKilos ?? 0
      const varietyName = varietyMap.get(a.varietyId)?.name ?? ''
      const entry = { authId: a.authId, date: a.date, varietyName, bags: a.totalAllocationBags ?? 0, kilos }

      if (isMillingTypeName(a.transactionTypeName) || isTestMillingTypeName(a.transactionTypeName)) {
        const s = ensure(a.regionalAuthorityNumber)
        s.issuedKilos += kilos
        s.millingEntries.push(entry)
      } else if (isTransferTypeName(a.transactionTypeName) && varietyMap.get(a.varietyId)?.category === 'Rice') {
        const s = ensure(a.regionalAuthorityNumber)
        s.recoveredKilos += kilos
        s.transferEntries.push(entry)
      }
    }

    for (const s of summary.values()) {
      s.recoveryPct = s.issuedKilos > 0 ? (s.recoveredKilos / s.issuedKilos) * 100 : null
    }
    return summary
  }, [warehouseId]) ?? new Map()

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
                <div className="mt-2 space-y-2 border-t border-neutral-800 pt-2">
                  {!recovery && (
                    <p className="text-xs text-neutral-500">No palay-in (milling) or rice-out (transfer) activity recorded yet for this Regional Authority Number.</p>
                  )}
                  {recovery && (
                    <div className="rounded-lg bg-neutral-950 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-500">{fmtWeight(recovery.issuedKilos, weightUnit)} palay in → {fmtWeight(recovery.recoveredKilos, weightUnit)} rice out</span>
                        <span className={`font-semibold ${recovery.recoveryPct == null ? 'text-neutral-500' : 'text-brand-neon'}`}>
                          {recovery.recoveryPct == null ? '—' : `${recovery.recoveryPct.toFixed(1)}%`}
                        </span>
                      </div>
                    </div>
                  )}
                  {recovery && recovery.millingEntries.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Palay in</p>
                      <div className="space-y-1">
                        {recovery.millingEntries.map((d) => (
                          <div key={d.authId} className="flex items-center justify-between rounded-lg bg-neutral-950 p-2 text-xs text-neutral-400">
                            <span>{d.date} · {d.varietyName}</span>
                            <span className="font-medium text-app-text">{fmtBags(d.bags)} bags · {fmtWeight(d.kilos, weightUnit)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {recovery && recovery.transferEntries.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Rice out</p>
                      <div className="space-y-1">
                        {recovery.transferEntries.map((d) => (
                          <div key={d.authId} className="flex items-center justify-between rounded-lg bg-neutral-950 p-2 text-xs text-neutral-400">
                            <span>{d.date} · {d.varietyName}</span>
                            <span className="font-medium text-app-text">{fmtBags(d.bags)} bags · {fmtWeight(d.kilos, weightUnit)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
