// Home Sacks tab — pieces per sack type -> condition for this warehouse
// only. Live via useLiveQuery on ESR/ESI transactions plus the
// sackInventory initial-balance seed - receipts add, issues subtract,
// automatically.

import { useLiveQuery } from 'dexie-react-hooks'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { fmtBags } from '../utils/calculations.js'
import { SACK_CONDITIONS } from '../components/common/admin/shared.js'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

function HomeSacks({ warehouseId } = {}) {
  const { currentWarehouseId: contextWarehouseId } = useWarehouse() ?? {}
  const currentWarehouseId = warehouseId ?? contextWarehouseId

  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const sortedSackTypes = [...sackTypes].sort((a, b) => byAlpha(a.code, b.code))

  const sackTx = useLiveQuery(
    () => currentWarehouseId
      ? db.transactions.where('warehouseId').equals(currentWarehouseId)
          .and((t) => ['ESR', 'ESI'].includes(t.type) && t.status === 'Active').toArray()
      : [],
    [currentWarehouseId]
  ) ?? []
  const sackInventory = useLiveQuery(
    () => currentWarehouseId ? db.sackInventory.where('warehouseId').equals(currentWarehouseId).toArray() : [],
    [currentWarehouseId]
  ) ?? []

  // sackTypeId -> condition -> pieces
  const sackPieces = {}
  const addSackPieces = (sackTypeId, condition, delta) => {
    sackPieces[sackTypeId] ??= {}
    sackPieces[sackTypeId][condition] = (sackPieces[sackTypeId][condition] ?? 0) + delta
  }
  for (const rec of sackInventory) addSackPieces(rec.sackTypeId, rec.condition, rec.pieces ?? 0)
  for (const t of sackTx) {
    const sign = t.type === 'ESR' ? 1 : -1
    for (const line of t.sackLines ?? []) {
      addSackPieces(line.sackTypeId, line.condition, (line.pieces ?? 0) * sign)
    }
  }

  const hasSacks = sortedSackTypes.some((st) =>
    SACK_CONDITIONS.some((c) => (sackPieces[st.sackTypeId]?.[c.code] ?? 0) !== 0)
  )

  if (!hasSacks) {
    return <p className="mt-3 text-xs text-neutral-500">No sack inventory recorded for this warehouse yet.</p>
  }

  return (
    <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      {sortedSackTypes.map((st) => {
        const rows = SACK_CONDITIONS
          .map((c) => ({ condition: c, pieces: sackPieces[st.sackTypeId]?.[c.code] ?? 0 }))
          .filter((r) => r.pieces !== 0)
        if (rows.length === 0) return null
        return (
          <div key={st.sackTypeId} className="mt-3 first:mt-0">
            <p className="text-xs font-semibold uppercase text-neutral-400">{st.code}</p>
            <div className="mt-1 space-y-1">
              {rows.map((r) => (
                <div key={r.condition.code} className="flex items-center justify-between border-b border-neutral-800/50 py-1">
                  <span className="text-sm text-app-text">{r.condition.label}</span>
                  <span className="text-sm font-semibold text-brand-neon">{fmtBags(r.pieces)} pcs</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default HomeSacks
