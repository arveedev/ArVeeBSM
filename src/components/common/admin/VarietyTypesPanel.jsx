// Variety Types — grouped by category: Rice, Palay, and By Products.

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

const CATEGORIES = ['Rice', 'Palay', 'By Products']

const PLACEHOLDER_BY_CATEGORY = {
  Rice: 'WD1',
  Palay: 'PD',
  'By Products': 'DKA',
}

function VarietyTypesPanel() {
  const [category, setCategory] = useState('Rice')
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), [])

  const resetForm = () => {
    setCategory('Rice')
    setName('')
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Variety name is required')
      return
    }

    if (editingId) {
      await db.varietyTypes.update(editingId, { category, name: name.trim() })
      toast.success('Variety updated')
    } else {
      await db.varietyTypes.add({
        varietyId: crypto.randomUUID(),
        category,
        name: name.trim(),
      })
      toast.success('Variety saved')
    }

    resetForm()
  }

  const handleEdit = (variety) => {
    setEditingId(variety.varietyId)
    setCategory(variety.category)
    setName(variety.name)
  }

  const confirmDelete = async () => {
    const varietyId = pendingDelete
    setPendingDelete(null)
    await db.varietyTypes.delete(varietyId)
    if (editingId === varietyId) resetForm()
    toast.success('Variety deleted')
  }

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    items: (varieties ?? [])
      .filter((v) => v.category === cat)
      .sort((a, b) => byAlpha(a.name, b.name)),
  }))

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Variety Types</h2>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Variety Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder={PLACEHOLDER_BY_CATEGORY[category]}
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

      {grouped.map(
        (group) =>
          group.items.length > 0 && (
            <div key={group.category} className="mt-4">
              <p className="text-xs font-semibold uppercase text-neutral-500">
                {group.category}
              </p>
              <ul className="mt-2 space-y-2">
                {group.items.map((v) => (
                  <li key={v.varietyId} className={listItemClass}>
                    <p className="font-medium text-app-text">{v.name}</p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => handleEdit(v)}
                        aria-label="Edit"
                        className={editIconClass}
                      >
                        <Pencil size={20} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(v.varietyId)}
                        aria-label="Delete"
                        className={deleteIconClass}
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this variety?"
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default VarietyTypesPanel
