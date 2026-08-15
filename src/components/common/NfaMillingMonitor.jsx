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
import { fmtWeight, fmtBags, isMillingTypeName, isTestMillingTypeName } from '../../utils/calculations.js'
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

  // Same "used" definition as RicemillAllocationsPanel.jsx: WSI issued
  // to a Ricemill-type warehouse under an AI tagged Milling/Remilling/
  // Test Milling/Test Remilling - the one step that actually draws
  // against the Regional Authority allocation.
  const usageByNumber = useLiveQuery(async () => {
    let ricemillIds
    if (warehouseId) {
      ricemillIds = [warehouseId]
    } else {
      const ricemillWarehouses = await db.warehouses.where('facilityType').equals('Ricemill').toArray()
      ricemillIds = ricemillWarehouses.map((w) => w.warehouseId)
    }
    if (ricemillIds.length === 0) return new Map()

    const authorities = await db.authorities.where('type').equals('AI').toArray()
    const millingAuthorities = authorities.filter((a) =>
      a.regionalAuthorityNumber && (isMillingTypeName(a.transactionTypeName) || isTestMillingTypeName(a.transactionTypeName))
    )
    if (millingAuthorities.length === 0) return new Map()
    const regionalNumByAiNumber = new Map(millingAuthorities.map((a) => [a.aiNumber, a.regionalAuthorityNumber]))

    const tx = await db.transactions
      .where('warehouseId').anyOf(ricemillIds)
      .and((t) => t.status === 'Active' && t.type === 'WSI' && regionalNumByAiNumber.has(t.aiNumber))
      .toArray()

    const usage = new Map()
    for (const t of tx) {
      const regionalNum = regionalNumByAiNumber.get(t.aiNumber)
      usage.set(regionalNum, (usage.get(regionalNum) ?? 0) + (t.netKilos ?? 0))
    }
    return usage
  }, [warehouseId]) ?? new Map()

  // Per-batch recovery detail - issued vs recovered kilos, per
  // Regional Authority Number.
  const millingDetailsByNumber = useLiveQuery(async () => {
    let ricemillWarehouses
    if (warehouseId) {
      const w = await db.warehouses.get(warehouseId)
      ricemillWarehouses = w ? [w] : []
    } else {
      ricemillWarehouses = await db.warehouses.where('facilityType').equals('Ricemill').toArray()
    }
    if (ricemillWarehouses.length === 0) return new Map()
    const ricemillIds = ricemillWarehouses.map((w) => w.warehouseId)

    const authorities = await db.authorities.where('type').equals('AI').toArray()
    const millingAuthorities = authorities.filter((a) =>
      a.regionalAuthorityNumber && (isMillingTypeName(a.transactionTypeName) || isTestMillingTypeName(a.transactionTypeName))
    )
    if (millingAuthorities.length === 0) return new Map()

    const warehouseTx = await db.transactions
      .where('warehouseId').anyOf(ricemillIds)
      .and((t) => t.status === 'Active')
      .toArray()
    const varietyList = await db.varietyTypes.toArray()
    const varietyMap = new Map(varietyList.map((v) => [v.varietyId, v]))
    const warehouseMap = new Map(ricemillWarehouses.map((w) => [w.warehouseId, w]))

    const details = new Map()
    for (const auth of millingAuthorities) {
      const millingTx = warehouseTx.filter((t) => t.type === 'WSI' && t.aiNumber === auth.aiNumber)
      for (const tx of millingTx) {
        const recoveryTx = warehouseTx.filter((t) => t.type === 'WSR' && t.linkedDocNo === auth.aiNumber)
        const recoveredKilos = recoveryTx.reduce((sum, r) => sum + (r.netKilos ?? 0), 0)
        const issuedKilos = tx.netKilos ?? 0
        const recoveryPct = issuedKilos > 0 ? (recoveredKilos / issuedKilos) * 100 : null

        const key = auth.regionalAuthorityNumber
        if (!details.has(key)) details.set(key, [])
        details.get(key).push({
          id: tx.id,
          date: tx.date,
          warehouseName: warehouseMap.get(tx.warehouseId)?.name ?? tx.warehouseId,
          varietyName: varietyMap.get(tx.varietyId)?.name ?? '',
          bags: tx.numberOfBags ?? 0,
          issuedKilos,
          recoveredKilos,
          recoveryPct,
        })
      }
    }
    return details
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
          const millingDetails = millingDetailsByNumber.get(a.regionalAuthorityNumber) ?? []
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
                  {millingDetails.length > 0 && ` · ${millingDetails.length} milling record(s)`}
                </p>
              </button>
              {isExpanded && (
                <div className="mt-2 space-y-1.5 border-t border-neutral-800 pt-2">
                  {millingDetails.length === 0 && (
                    <p className="text-xs text-neutral-500">No milling activity recorded yet for this Regional Authority Number.</p>
                  )}
                  {millingDetails.map((d) => (
                    <div key={d.id} className="rounded-lg bg-neutral-950 p-2 text-xs">
                      <div className="flex items-center justify-between text-neutral-400">
                        <span>{d.date} · {d.warehouseName}</span>
                        <span className="font-medium text-app-text">{d.varietyName}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-neutral-500">{fmtBags(d.bags)} bags · {fmtWeight(d.issuedKilos, weightUnit)} issued → {fmtWeight(d.recoveredKilos, weightUnit)} recovered</span>
                        <span className={`font-semibold ${d.recoveryPct == null ? 'text-neutral-500' : 'text-brand-neon'}`}>
                          {d.recoveryPct == null ? '—' : `${d.recoveryPct.toFixed(1)}%`}
                        </span>
                      </div>
                    </div>
                  ))}
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
