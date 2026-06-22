// Warehouses — each belongs to a province, has a facility code (e.g.
// "050501") and a name (e.g. "ALB-TABACO GID"). Warehouse codes may repeat
// across records, but names must be unique.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
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

function WarehousesPanel() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [provinceId, setProvinceId] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const provinces = useLiveQuery(() => db.provinces.toArray(), [])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [])

  const provinceMap = new Map((provinces ?? []).map((p) => [p.provinceId, p]))
  const sortedWarehouses = [...(warehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const resetForm = () => {
    setCode('')
    setName('')
    setAddress('')
    setProvinceId('')
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!code.trim() || !name.trim() || !provinceId) {
      toast.error('Warehouse code, name, and province are required')
      return
    }

    const normalizedCode = code.trim()
    const normalizedName = name.trim()

    // Warehouse codes may repeat (e.g. shared facility codes), but names
    // must be unique.
    const existing = await db.warehouses.where('name').equals(normalizedName).first()
    if (existing && existing.warehouseId !== editingId) {
      toast.error('That warehouse name is already registered')
      return
    }

    if (editingId) {
      await db.warehouses.update(editingId, {
        code: normalizedCode,
        name: normalizedName,
        address: address.trim() || null,
        provinceId,
      })
      toast.success('Warehouse updated')
    } else {
      await db.warehouses.add({
        warehouseId: crypto.randomUUID(),
        code: normalizedCode,
        name: normalizedName,
        address: address.trim() || null,
        provinceId,
      })
      toast.success('Warehouse saved')
    }

    resetForm()
  }

  const handleEdit = (warehouse) => {
    setEditingId(warehouse.warehouseId)
    setCode(warehouse.code)
    setName(warehouse.name)
    setAddress(warehouse.address ?? '')
    setProvinceId(warehouse.provinceId)
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
    if (editingId === warehouseId) resetForm()
    toast.success('Warehouse deleted')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-white">Warehouses</h2>

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
            {(provinces ?? []).map((p) => (
              <option key={p.provinceId} value={p.provinceId}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
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

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
            Save
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
                <p className="font-medium text-white">
                  {w.code} · {w.name}
                </p>
                <p className="text-xs text-neutral-400">
                  {provinceMap.get(w.provinceId)?.code ?? '—'}
                </p>
                {w.address && <p className="text-xs text-neutral-500">{w.address}</p>}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleEdit(w)}
                  aria-label="Edit"
                  className={editIconClass}
                >
                  <Pencil size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(w.warehouseId)}
                  aria-label="Delete"
                  className={deleteIconClass}
                >
                  <Trash2 size={18} />
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
