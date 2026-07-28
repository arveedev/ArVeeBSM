// Transaction Types — the admin-configurable "Nature of Transaction" list
// shown on every WSR/WSI/WTS/ESR/ESI form (e.g. Milling, Procurement,
// Transfer, Sales). Independent of the WSR/WSI/WTS/ESI/ESR document type —
// any document can carry any of these.

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

function TransactionTypesPanel() {
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const types = useLiveQuery(() => db.transactionTypes.toArray(), [])
  const sortedTypes = [...(types ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const resetForm = () => {
    setName('')
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Transaction type name is required')
      return
    }

    const normalizedName = name.trim()

    const existing = await db.transactionTypes.where('name').equals(normalizedName).first()
    if (existing && existing.transactionTypeId !== editingId) {
      toast.error('That transaction type already exists')
      return
    }

    if (editingId) {
      await db.transactionTypes.update(editingId, { name: normalizedName })
      toast.success('Transaction type updated')
    } else {
      await db.transactionTypes.add({
        transactionTypeId: crypto.randomUUID(),
        name: normalizedName,
      })
      toast.success('Transaction type saved')
    }

    resetForm()
  }

  const handleEdit = (t) => {
    setEditingId(t.transactionTypeId)
    setName(t.name)
  }

  const confirmDelete = async () => {
    const transactionTypeId = pendingDelete
    setPendingDelete(null)
    await db.transactionTypes.delete(transactionTypeId)
    if (editingId === transactionTypeId) resetForm()
    toast.success('Transaction type deleted')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Transaction Types</h2>
      <p className="mt-1 text-xs text-neutral-400">
        The "Nature of Transaction" options shown on every WSR/WSI/WTS/ESR/ESI
        form — e.g. Milling, Procurement, Transfer, Sales.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="Milling"
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

      {sortedTypes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sortedTypes.map((t) => (
            <li key={t.transactionTypeId} className={listItemClass}>
              <p className="font-medium text-app-text">{t.name}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleEdit(t)}
                  aria-label="Edit"
                  className={editIconClass}
                >
                  <Pencil size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(t.transactionTypeId)}
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
        title="Delete this transaction type?"
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default TransactionTypesPanel
