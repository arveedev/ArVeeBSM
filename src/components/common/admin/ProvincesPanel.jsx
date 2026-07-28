// Provinces — top of the location hierarchy. A province can contain
// multiple warehouses.

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

function ProvincesPanel() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const provinces = useLiveQuery(() => db.provinces.toArray(), [])
  const sortedProvinces = [...(provinces ?? [])].sort((a, b) => byAlpha(a.code, b.code))

  const resetForm = () => {
    setCode('')
    setName('')
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error('Province code and name are required')
      return
    }

    const normalizedCode = code.trim().toUpperCase()

    const existing = await db.provinces.where('code').equals(normalizedCode).first()
    if (existing && existing.provinceId !== editingId) {
      toast.error('That province code is already registered')
      return
    }

    if (editingId) {
      await db.provinces.update(editingId, { code: normalizedCode, name: name.trim() })
      toast.success('Province updated')
    } else {
      await db.provinces.add({
        provinceId: crypto.randomUUID(),
        code: normalizedCode,
        name: name.trim(),
      })
      toast.success('Province saved')
    }

    resetForm()
  }

  const handleEdit = (province) => {
    setEditingId(province.provinceId)
    setCode(province.code)
    setName(province.name)
  }

  const confirmDelete = async () => {
    const provinceId = pendingDelete
    setPendingDelete(null)

    const inUse = await db.warehouses.where('provinceId').equals(provinceId).first()
    if (inUse) {
      toast.error('Cannot delete — warehouses are assigned to this province')
      return
    }

    await db.provinces.delete(provinceId)
    if (editingId === provinceId) resetForm()
    toast.success('Province deleted')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Provinces</h2>
      <p className="mt-1 text-xs text-neutral-400">
        A province can have multiple warehouses.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Province Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
            placeholder="ALB"
          />
        </div>

        <div>
          <label className={labelClass}>Province Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="Albay"
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

      {sortedProvinces.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sortedProvinces.map((p) => (
            <li key={p.provinceId} className={listItemClass}>
              <div>
                <p className="font-medium text-app-text">{p.code}</p>
                <p className="text-xs text-neutral-400">{p.name}</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleEdit(p)}
                  aria-label="Edit"
                  className={editIconClass}
                >
                  <Pencil size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(p.provinceId)}
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
        title="Delete this province?"
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default ProvincesPanel
