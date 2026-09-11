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
import MorphButton from '../MorphButton.jsx'
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

// Per explicit request: without this, adding a transaction bombards the
// user with every configured type regardless of whether they're
// receiving or issuing stock. 'Both' (the default, and what any
// existing type with no appliesTo field yet is treated as - see
// StockFormBase.jsx/SackFormBase.jsx's own fallback) keeps a type
// showing everywhere until an admin deliberately narrows it.
const APPLIES_TO_OPTIONS = ['Receipt', 'Issuance', 'Both']

function TransactionTypesPanel() {
  const [name, setName] = useState('')
  const [appliesTo, setAppliesTo] = useState('Both')
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const types = useLiveQuery(() => db.transactionTypes.toArray(), [])
  const sortedTypes = [...(types ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const resetForm = () => {
    setName('')
    setAppliesTo('Both')
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Transaction type name is required')
      return false
    }

    const normalizedName = name.trim()

    const existing = await db.transactionTypes.where('name').equals(normalizedName).first()
    if (existing && existing.transactionTypeId !== editingId) {
      toast.error('That transaction type already exists')
      return false
    }

    if (editingId) {
      await db.transactionTypes.update(editingId, { name: normalizedName, appliesTo })
    } else {
      await db.transactionTypes.add({
        transactionTypeId: crypto.randomUUID(),
        name: normalizedName,
        appliesTo,
      })
    }
    // Concept F (picked) - Save button's own morph is the confirmation.

    resetForm()
  }

  const handleEdit = (t) => {
    setEditingId(t.transactionTypeId)
    setName(t.name)
    setAppliesTo(t.appliesTo ?? 'Both')
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

        <div>
          <label className={labelClass}>Applies To</label>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {APPLIES_TO_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setAppliesTo(opt)}
                className={`rounded-lg border py-1.5 text-xs font-medium transition-all active:scale-95 ${
                  appliesTo === opt ? 'border-brand-neon bg-brand-neon/10 text-brand-neon' : 'border-neutral-800 bg-neutral-900 text-neutral-400'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Which forms offer this type - Receipt (WSR/ESR), Issuance (WSI/ESI), or both.
          </p>
        </div>

        <div className="flex gap-2">
          <MorphButton label="Save" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`} />
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
              <p className="font-medium text-app-text">
                {t.name}
                {t.appliesTo && t.appliesTo !== 'Both' && (
                  <span className="ml-2 rounded-full bg-neutral-800 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase text-neutral-400">
                    {t.appliesTo}
                  </span>
                )}
              </p>
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
