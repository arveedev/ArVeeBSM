// Warehouses — each belongs to a province, has a facility code (e.g.
// "050501") and a name (e.g. "ALB-TABACO GID"). Warehouse codes may repeat
// across records, but names must be unique.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { normalizeWarehouseAlias } from '../../../utils/warehouseMatching.js'
import { recalculatePileCurrentState } from '../../../utils/pileLedger.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  listItemClass,
  editIconClass,
  deleteIconClass,
  byAlpha,
} from './shared.js'

const FACILITY_TYPES = ['Warehouse', 'Mechanical Dryer', 'Ricemill']

function WarehousesPanel() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [provinceId, setProvinceId] = useState('')
  const [aliases, setAliases] = useState('')
  const [facilityType, setFacilityType] = useState('Warehouse')
  const [reportingCutoffDate, setReportingCutoffDate] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const provinces = useLiveQuery(() => db.provinces.toArray(), [])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [])
  const branches = useLiveQuery(() => db.branches.toArray(), [])
  const allAliases = useLiveQuery(() => db.warehouseAliases.toArray(), []) ?? []

  const provinceMap = new Map((provinces ?? []).map((p) => [p.provinceId, p]))
  const branchMap = new Map((branches ?? []).map((b) => [b.branchId, b]))
  const sortedWarehouses = [...(warehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const aliasesByWarehouse = new Map()
  for (const a of allAliases) {
    if (!aliasesByWarehouse.has(a.warehouseId)) aliasesByWarehouse.set(a.warehouseId, [])
    aliasesByWarehouse.get(a.warehouseId).push(a.displayLabel)
  }

  const resetForm = () => {
    setCode('')
    setName('')
    setAddress('')
    setProvinceId('')
    setAliases('')
    setFacilityType('Warehouse')
    setReportingCutoffDate('')
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!code.trim() || !name.trim() || !provinceId) {
      toast.error('Warehouse code, name, and province are required')
      return
    }

    const normalizedCode = code.trim()
    const normalizedName = name.trim()

    const existing = await db.warehouses.where('name').equals(normalizedName).first()
    if (existing && existing.warehouseId !== editingId) {
      toast.error('That warehouse name is already registered')
      return
    }

    // Sheet aliases must be globally unique - the same nickname can't map
    // to two different warehouses, or a sync would have no way to know
    // which one a given sheet row actually means. Uniqueness (and later
    // matching) is checked on the NORMALIZED form (whitespace/hyphens
    // ignored) so visually-different-but-equivalent spellings like
    // "ABACORP" and "ABACORP-A" can never end up registered separately -
    // per the confirmed rule, those are the same warehouse, while
    // "ABACORP" vs "ABACORP A" genuinely are not (extra letter, not
    // just formatting).
    const rawAliases = aliases.split(',').map((a) => a.trim()).filter(Boolean)
    const seenNormalized = new Map() // normalized -> original, to de-dupe within this same input
    for (const raw of rawAliases) {
      seenNormalized.set(normalizeWarehouseAlias(raw), raw)
    }
    const cleanedAliases = [...seenNormalized.entries()].map(([normalized, displayLabel]) => ({ normalized, displayLabel }))

    for (const { normalized, displayLabel } of cleanedAliases) {
      const aliasOwner = await db.warehouseAliases.get(normalized)
      if (aliasOwner && aliasOwner.warehouseId !== editingId) {
        const ownerWarehouse = (warehouses ?? []).find((w) => w.warehouseId === aliasOwner.warehouseId)
        toast.error(`Alias "${displayLabel}" is already used by ${ownerWarehouse?.name ?? 'another warehouse'}`)
        return
      }
    }

    let warehouseId = editingId
    // Detected before the write so the comparison is against the
    // PREVIOUS saved value, not the one we're about to write.
    const cutoffChanged = editingId
      ? (warehouses ?? []).find((w) => w.warehouseId === editingId)?.reportingCutoffDate !== (reportingCutoffDate || null)
      : false
    if (editingId) {
      await db.warehouses.update(editingId, {
        code: normalizedCode,
        name: normalizedName,
        address: address.trim() || null,
        provinceId,
        facilityType,
        reportingCutoffDate: reportingCutoffDate || null,
      })
      toast.success('Warehouse updated')
    } else {
      warehouseId = crypto.randomUUID()
      await db.warehouses.add({
        warehouseId,
        code: normalizedCode,
        name: normalizedName,
        address: address.trim() || null,
        provinceId,
        facilityType,
        reportingCutoffDate: reportingCutoffDate || null,
      })
      toast.success('Warehouse saved')
    }

    // Replace this warehouse's aliases wholesale - simpler and safer than
    // diffing add/remove, and this list is short enough that it's cheap.
    const existingForThisWarehouse = await db.warehouseAliases.where('warehouseId').equals(warehouseId).toArray()
    await db.warehouseAliases.bulkDelete(existingForThisWarehouse.map((a) => a.alias))
    if (cleanedAliases.length > 0) {
      await db.warehouseAliases.bulkAdd(cleanedAliases.map(({ normalized, displayLabel }) => ({
        alias: normalized,
        displayLabel,
        warehouseId,
      })))
    }

    // The cutoff now governs live pile totals everywhere (not just
    // Reports), but those totals are a CACHED field
    // (pile.currentBags/currentKilos) rather than computed fresh on
    // every read - saving a new cutoff has zero visible effect until
    // this cache is refreshed. Only recompute when the value actually
    // changed, so an unrelated edit (renaming the warehouse) doesn't
    // redo every pile for nothing.
    if (cutoffChanged) {
      const affectedPiles = await db.piles.where('warehouseId').equals(warehouseId).toArray()
      await Promise.all(affectedPiles.map((p) => recalculatePileCurrentState(p.pileId)))
    }

    resetForm()
  }

  const handleEdit = (warehouse) => {
    setEditingId(warehouse.warehouseId)
    setCode(warehouse.code)
    setName(warehouse.name)
    setAddress(warehouse.address ?? '')
    setProvinceId(warehouse.provinceId)
    setAliases((aliasesByWarehouse.get(warehouse.warehouseId) ?? []).join(', '))
    setFacilityType(warehouse.facilityType ?? 'Warehouse')
    setReportingCutoffDate(warehouse.reportingCutoffDate ?? '')
  }

  const confirmDelete = async () => {
    const warehouseId = pendingDelete
    setPendingDelete(null)

    const inUse = await db.users.where('assignedWarehouses').equals(warehouseId).first()
    if (inUse) {
      toast.error('Cannot delete — users are assigned to this warehouse')
      return
    }

    await db.warehouses.delete(warehouseId)
    const orphanedAliases = await db.warehouseAliases.where('warehouseId').equals(warehouseId).toArray()
    await db.warehouseAliases.bulkDelete(orphanedAliases.map((a) => a.alias))
    if (editingId === warehouseId) resetForm()
    toast.success('Warehouse deleted')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Warehouses</h2>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Warehouse Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
            placeholder="050501"
          />
        </div>

        <div>
          <label className={labelClass}>Warehouse Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="ALB-TABACO GID"
          />
        </div>

        <div>
          <label className={labelClass}>Province</label>
          <select
            value={provinceId}
            onChange={(e) => setProvinceId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select province…</option>
            {[...(provinces ?? [])].sort((a, b) => byAlpha(a.name, b.name)).map((p) => (
              <option key={p.provinceId} value={p.provinceId}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Facility Type</label>
          <select
            value={facilityType}
            onChange={(e) => setFacilityType(e.target.value)}
            className={inputClass}
          >
            {FACILITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Reports Start Date</label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <CalendarDatePicker
                value={reportingCutoffDate}
                onChange={setReportingCutoffDate}
                required={false}
                placeholder="No cutoff set"
              />
            </div>
            {reportingCutoffDate && (
              <button
                type="button"
                onClick={() => setReportingCutoffDate('')}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-neutral-400 hover:text-app-text"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Any data dated on or before this is ignored everywhere in the app - live stock,
            sacks, BIN Cards, and reports (beginning balances still always count). Nothing is
            deleted, it just stops being counted. Leave blank to include all data regardless of date.
          </p>
        </div>

        <div>
          <label className={labelClass}>Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={inputClass}
            placeholder="Optional"
          />
        </div>

        <div>
          <label className={labelClass}>Sheet Aliases</label>
          <input
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            className={inputClass}
            placeholder="e.g. BSI B, BSI-B (comma-separated)"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Every nickname the AI/SIA sheet uses for this warehouse, so a
            sync knows they all mean this one - separate genuinely
            different warehouses instead (don't alias them together).
          </p>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
            {editingId ? 'Update' : 'Save'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {sortedWarehouses.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sortedWarehouses.map((w) => (
            <li key={w.warehouseId} className={listItemClass}>
              <div>
                <p className="font-medium text-app-text">
                  {w.code} · {w.name}
                  {w.facilityType && w.facilityType !== 'Warehouse' && (
                    <span className="ml-1.5 rounded-full bg-brand-amber/15 px-2 py-0.5 text-[10px] font-semibold text-brand-amber">
                      {w.facilityType}
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-400">
                  {provinceMap.get(w.provinceId)?.code ?? '—'}
                  {(() => {
                    const prov = provinceMap.get(w.provinceId)
                    const branch = prov?.branchId ? branchMap.get(prov.branchId) : null
                    return branch ? ` · ${branch.name}` : ''
                  })()}
                </p>
                {w.address && <p className="text-xs text-neutral-500">{w.address}</p>}
                {(aliasesByWarehouse.get(w.warehouseId) ?? []).length > 0 && (
                  <p className="mt-0.5 text-xs text-brand-neon">
                    Aliases: {aliasesByWarehouse.get(w.warehouseId).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleEdit(w)}
                  aria-label="Edit"
                  className={editIconClass}
                >
                  <Pencil size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(w.warehouseId)}
                  aria-label="Delete"
                  className={deleteIconClass}
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this warehouse?"
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default WarehousesPanel
