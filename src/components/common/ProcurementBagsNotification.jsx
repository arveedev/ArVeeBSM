// Procurement Bags Notification - reminds the user that sacks used
// during a Procurement-type WSR (via its MTS Sack Type/Condition
// field) haven't yet been matched by a corresponding Procurement-type
// ESI issuing the same sack type, condition, and piece count. Shown
// between the stock overview and monitor overview sections on the
// home page, styled in amber.
//
// The scenario (per explicit clarification): a warehouse procures
// palay from farmers using its own sacks - e.g. 103 bags procured
// means 103 of a specific sack type/condition were physically handed
// out. That usage needs to be covered by an SIA of the same sack
// type/condition/piece count, issued as a Procurement-type ESI. This
// tracks that per (sackTypeId, condition) combination - NOT a single
// aggregate number - since different Procurement receipts can use
// different sack types/conditions, each needing its own SIA coverage.
// The counter for a given combination clears to zero once matching
// ESI issuance covers it, and reactivates the next time a new
// Procurement WSR uses that same combination again.

import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { fmtBags, isProcurementTypeName } from '../../utils/calculations.js'

function ProcurementBagsNotification() {
  const { currentWarehouseId } = useWarehouse() ?? {}

  const outstanding = useLiveQuery(async () => {
    if (!currentWarehouseId) return []

    const transactionTypes = await db.transactionTypes.toArray()
    const procurementTypeId = transactionTypes.find((t) => isProcurementTypeName(t.name))?.transactionTypeId
    if (!procurementTypeId) return []

    const sackTypes = await db.sackTypes.toArray()
    const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

    // key = "sackTypeId::condition" -> net outstanding pieces
    const byKey = new Map()

    const procurementWsr = await db.transactions
      .where('warehouseId').equals(currentWarehouseId)
      .and((t) => t.type === 'WSR' && t.status === 'Active' && t.transactionTypeId === procurementTypeId)
      .toArray()
    for (const t of procurementWsr) {
      if (!t.mtsSackTypeId || !t.mtsCondition) continue // no sack type/condition recorded on this receipt - nothing to track
      const key = `${t.mtsSackTypeId}::${t.mtsCondition}`
      byKey.set(key, (byKey.get(key) ?? 0) + (t.numberOfBags ?? 0))
    }

    const procurementEsi = await db.transactions
      .where('warehouseId').equals(currentWarehouseId)
      .and((t) => t.type === 'ESI' && t.status === 'Active' && t.transactionTypeId === procurementTypeId)
      .toArray()
    for (const t of procurementEsi) {
      for (const line of t.sackLines ?? []) {
        const key = `${line.sackTypeId}::${line.condition}`
        byKey.set(key, (byKey.get(key) ?? 0) - (line.pieces ?? 0))
      }
    }

    return [...byKey.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([key, amount]) => {
        const [sackTypeId, condition] = key.split('::')
        return { code: sackTypeMap.get(sackTypeId)?.code ?? sackTypeId, condition, amount }
      })
  }, [currentWarehouseId]) ?? []

  if (outstanding.length === 0) return null

  return (
    <div className="mt-3 rounded-xl border-2 border-brand-amber bg-brand-amber/10 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-brand-amber" />
        <p className="text-sm font-semibold text-brand-amber">
          Procurement sacks still need matching SIA issuance
        </p>
      </div>
      <ul className="ml-6 mt-1 space-y-0.5">
        {outstanding.map(({ code, condition, amount }) => (
          <li key={`${code}::${condition}`} className="text-xs text-brand-amber">
            {code} ({condition}): {amount > 0
              ? `${fmtBags(amount)} bag${amount === 1 ? '' : 's'} still needs a matching SIA`
              : `SIA-backed issuance exceeds Procurement by ${fmtBags(Math.abs(amount))} - check for an over-issuance`}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ProcurementBagsNotification
