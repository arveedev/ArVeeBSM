// Admin Home Sacks tab.
// Pieces per province and per warehouse, per sack type, per condition.
// No age grouping - sacks do not age.
// Pieces = ESR adds - ESI subtracts + sackInventory initial balance.

import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight } from 'lucide-react'
import { db } from '../db/dexie.js'
import { fmtBags } from '../utils/calculations.js'
import { SACK_CONDITIONS } from '../components/common/admin/shared.js'
import { Section, Th, Td, Empty } from './AdminHomeShared.jsx'

function AdminHomeSacks({ onWarehouseSelect }) {
  const provinces = useLiveQuery(() => db.provinces.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const sackTx = useLiveQuery(
    () => db.transactions.where('type').anyOf(['ESR', 'ESI']).and((t) => t.status === 'Active').toArray(),
    []
  ) ?? []
  const sackInventory = useLiveQuery(() => db.sackInventory.toArray(), []) ?? []

  const provinceMap = new Map(provinces.map((p) => [p.provinceId, p]))
  const sortedProvinces = [...provinces].sort((a, b) => a.code.localeCompare(b.code))
  const sortedWarehouses = [...warehouses].sort((a, b) => a.name.localeCompare(b.name))
  const sortedSackTypes = [...sackTypes].sort((a, b) => a.code.localeCompare(b.code))

  // pieces[warehouseId][sackTypeId][condition] = net pieces on hand
  const pieces = {}
  const addPieces = (warehouseId, sackTypeId, condition, delta) => {
    pieces[warehouseId] ??= {}
    pieces[warehouseId][sackTypeId] ??= {}
    pieces[warehouseId][sackTypeId][condition] = (pieces[warehouseId][sackTypeId][condition] ?? 0) + delta
  }
  const sackAsOfDateByKey = {}
  for (const rec of sackInventory) {
    addPieces(rec.warehouseId, rec.sackTypeId, rec.condition, rec.pieces ?? 0)
    sackAsOfDateByKey[`${rec.warehouseId}::${rec.sackTypeId}::${rec.condition}`] = rec.asOfDate ?? null
  }
  for (const t of sackTx) {
    const sign = t.type === 'ESR' ? 1 : -1
    for (const line of t.sackLines ?? []) {
      const cutoff = sackAsOfDateByKey[`${t.warehouseId}::${line.sackTypeId}::${line.condition}`]
      if (cutoff && t.date < cutoff) continue
      addPieces(t.warehouseId, line.sackTypeId, line.condition, (line.pieces ?? 0) * sign)
    }
  }
  const piecesFor = (warehouseId, sackTypeId, condition) =>
    pieces[warehouseId]?.[sackTypeId]?.[condition] ?? 0

  return (
    <>
      <Section title="Sack Pieces by Province">
        {sortedProvinces.length === 0 ? <Empty /> : (
          <div className="space-y-4">
            {sortedProvinces.map((province) => {
              const wIds = warehouses.filter((w) => w.provinceId === province.provinceId).map((w) => w.warehouseId)
              const rows = sortedSackTypes.flatMap((st) =>
                SACK_CONDITIONS.map((c) => ({
                  sackType: st,
                  condition: c,
                  total: wIds.reduce((s, wid) => s + piecesFor(wid, st.sackTypeId, c.code), 0),
                })).filter((r) => r.total !== 0)
              )
              if (rows.length === 0) return null
              return (
                <div key={province.provinceId}>
                  <p className="text-xs font-semibold uppercase text-neutral-500">
                    {province.code} — {province.name}
                  </p>
                  <table className="mt-1 w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800">
                        <Th>Sack Type</Th>
                        <Th>Condition</Th>
                        <Th right>Pieces</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${r.sackType.sackTypeId}-${r.condition.code}`} className="border-b border-neutral-800/50">
                          <Td>{r.sackType.code}</Td>
                          <Td>{r.condition.label}</Td>
                          <Td right>{fmtBags(r.total)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Sack Pieces by Warehouse">
        {sortedWarehouses.length === 0 ? <Empty /> : (
          <div className="space-y-4">
            {sortedWarehouses.map((warehouse) => {
              const province = provinceMap.get(warehouse.provinceId)
              const rows = sortedSackTypes.flatMap((st) =>
                SACK_CONDITIONS.map((c) => ({
                  sackType: st,
                  condition: c,
                  total: piecesFor(warehouse.warehouseId, st.sackTypeId, c.code),
                })).filter((r) => r.total !== 0)
              )
              if (rows.length === 0) return null
              return (
                <div key={warehouse.warehouseId}>
                  <button
                    type="button"
                    onClick={() => onWarehouseSelect?.(warehouse)}
                    className="flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs font-semibold uppercase text-neutral-400 transition-all hover:border-brand-neon/50 hover:bg-brand-neon/10 hover:text-brand-neon active:scale-95"
                  >
                    {province?.code} · {warehouse.name}
                    <ChevronRight size={12} />
                  </button>
                  <table className="mt-1 w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800">
                        <Th>Sack Type</Th>
                        <Th>Condition</Th>
                        <Th right>Pieces</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${r.sackType.sackTypeId}-${r.condition.code}`} className="border-b border-neutral-800/50">
                          <Td>{r.sackType.code}</Td>
                          <Td>{r.condition.label}</Td>
                          <Td right>{fmtBags(r.total)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </>
  )
}

export default AdminHomeSacks
