// Admin Home Sacks tab.
// Pieces per province and per warehouse, per sack type, per condition.
// No age grouping - sacks do not age.
// Pieces = ESR adds - ESI subtracts + sackInventory initial balance.
//
// Card layout (sack type header, condition rows underneath) instead of
// a <table> - mirrors HomeSacks.jsx. The old 3-column table
// (Sack Type/Condition/Pieces, all `whitespace-nowrap`) overflowed the
// narrow mobile width with no visible scrollbar (Section's wrapper is
// `overflow-hidden`), so on a phone only a sliver of the table was ever
// actually in frame - reading as an endless list of bare "Condition"
// rows with no sack type or pieces value in sight.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight } from 'lucide-react'
import { db } from '../db/dexie.js'
import { fmtBags } from '../utils/calculations.js'
import { SACK_CONDITIONS } from '../components/common/admin/shared.js'
import { Section, Empty } from './AdminHomeShared.jsx'
import { stripWarehouseCodePrefix } from '../services/googleSheetsBridge.js'

const GROUP_TABS = ['Province', 'Warehouse']

function AdminHomeSacks({ onWarehouseSelect }) {
  const [groupTab, setGroupTab] = useState('Province')

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
  const warehouseCutoffById = new Map(warehouses.map((w) => [w.warehouseId, w.reportingCutoffDate || null]))

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
    const warehouseCutoff = warehouseCutoffById.get(t.warehouseId)
    if (warehouseCutoff && t.date <= warehouseCutoff) continue
    const sign = t.type === 'ESR' ? 1 : -1
    for (const line of t.sackLines ?? []) {
      const cutoff = sackAsOfDateByKey[`${t.warehouseId}::${line.sackTypeId}::${line.condition}`]
      if (cutoff && t.date < cutoff) continue
      addPieces(t.warehouseId, line.sackTypeId, line.condition, (line.pieces ?? 0) * sign)
    }
  }
  const piecesFor = (warehouseId, sackTypeId, condition) =>
    pieces[warehouseId]?.[sackTypeId]?.[condition] ?? 0

  // sackType -> [{condition, total}] for a given set of warehouseIds,
  // zero-value combinations dropped.
  const sackTypeRows = (warehouseIds) =>
    sortedSackTypes
      .map((st) => ({
        sackType: st,
        conditions: SACK_CONDITIONS
          .map((c) => ({ condition: c, total: warehouseIds.reduce((s, wid) => s + piecesFor(wid, st.sackTypeId, c.code), 0) }))
          .filter((r) => r.total !== 0),
      }))
      .filter((r) => r.conditions.length > 0)

  const SackTypeCard = ({ label, onSelect, warehouseIds }) => {
    const rows = sackTypeRows(warehouseIds)
    if (rows.length === 0) return null
    return (
      <div>
        {onSelect ? (
          <button
            type="button"
            onClick={onSelect}
            className="flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-xs font-semibold uppercase text-neutral-400 transition-all hover:border-brand-neon/50 hover:bg-brand-neon/10 hover:text-brand-neon active:scale-95"
          >
            {label}
            <ChevronRight size={12} />
          </button>
        ) : (
          <p className="text-xs font-semibold uppercase text-neutral-500">{label}</p>
        )}
        <div className="mt-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
          {rows.map(({ sackType, conditions }, i) => (
            <div key={sackType.sackTypeId} className={`${i > 0 ? 'mt-3 border-t border-neutral-800 pt-3' : ''}`}>
              <p className="text-xs font-semibold uppercase text-neutral-400">{sackType.code}</p>
              <div className="mt-1 space-y-1">
                {conditions.map((r) => (
                  <div key={r.condition.code} className="flex items-center justify-between">
                    <span className="text-sm text-app-text">{r.condition.label}</span>
                    <span className="text-sm font-semibold text-brand-neon">{fmtBags(r.total)} pcs</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: groupTab === GROUP_TABS[0] ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {GROUP_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setGroupTab(t)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium ${groupTab === t ? 'text-brand-contrast' : 'text-neutral-400'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {groupTab === 'Province' && (
        <Section title="Sack Pieces by Province">
          {sortedProvinces.length === 0 ? <Empty /> : (
            <div key="province" className="space-y-4 animate-flow-down">
              {sortedProvinces.map((province) => {
                const wIds = warehouses.filter((w) => w.provinceId === province.provinceId).map((w) => w.warehouseId)
                return (
                  <SackTypeCard
                    key={province.provinceId}
                    label={`${province.code} — ${province.name}`}
                    warehouseIds={wIds}
                  />
                )
              })}
            </div>
          )}
        </Section>
      )}

      {groupTab === 'Warehouse' && (
        <Section title="Sack Pieces by Warehouse">
          {sortedWarehouses.length === 0 ? <Empty /> : (
            <div key="warehouse" className="space-y-4 animate-flow-down">
              {sortedWarehouses.map((warehouse) => {
                const province = provinceMap.get(warehouse.provinceId)
                return (
                  <SackTypeCard
                    key={warehouse.warehouseId}
                    label={`${province?.code ?? ''} · ${stripWarehouseCodePrefix(warehouse.name)}`}
                    onSelect={() => onWarehouseSelect?.(warehouse)}
                    warehouseIds={[warehouse.warehouseId]}
                  />
                )
              })}
            </div>
          )}
        </Section>
      )}
    </>
  )
}

export default AdminHomeSacks
