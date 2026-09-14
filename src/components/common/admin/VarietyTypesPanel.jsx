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

// Purity/D&D per Palay variety - confirmed these are fixed per
// classification code, not measured per farmer ("we can set it by the
// variety of the palay, example set PD1-A as 0-3 D&D and purity of
// 95-100, only for the palay cereal type"). Selecting the variety on a
// WSR already determines both, which is what lets a Purchase Receipt
// compute its ENW factor without asking anyone to re-enter them.
const emptyPalayClassification = { purityMin: '', purityMax: '', purityLetter: '', ddMin: '', ddMax: '' }

function VarietyTypesPanel() {
  const [category, setCategory] = useState('Rice')
  const [name, setName] = useState('')
  const [palay, setPalay] = useState(emptyPalayClassification)
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), [])

  const updatePalayField = (field, value) => setPalay((p) => ({ ...p, [field]: value }))

  const resetForm = () => {
    setCategory('Rice')
    setName('')
    setPalay(emptyPalayClassification)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Variety name is required')
      return
    }

    const palayFields = category === 'Palay'
      ? {
          purityMin: palay.purityMin === '' ? null : parseFloat(palay.purityMin),
          purityMax: palay.purityMax === '' ? null : parseFloat(palay.purityMax),
          purityLetter: palay.purityLetter.trim().toUpperCase() || null,
          ddMin: palay.ddMin === '' ? null : parseFloat(palay.ddMin),
          ddMax: palay.ddMax === '' ? null : parseFloat(palay.ddMax),
        }
      : { purityMin: null, purityMax: null, purityLetter: null, ddMin: null, ddMax: null }

    if (editingId) {
      const existing = varieties?.find((v) => v.varietyId === editingId)
      const categoryChanged = existing && existing.category !== category
      await db.varietyTypes.update(editingId, { category, name: name.trim(), ...palayFields })
      if (categoryChanged) {
        // Every transaction stores its OWN cerealCategory at save time
        // (deliberately - so this edit doesn't rewrite what a report
        // showed for a period that's already closed out) - but that
        // means reports, which group by each transaction's own
        // cerealCategory, would silently split this variety's activity
        // across two different cereal-type sections from this point
        // forward: older transactions still under the old category,
        // newer ones under the new one, with the same variety name
        // appearing to "vanish" from one section and inflate another.
        // Cascading the new category onto every EXISTING transaction
        // for this variety keeps its whole history consistent with
        // what the variety is now - a deliberate reclassification of
        // past records, not a data-entry change to what actually
        // happened (bags/kilos/dates are untouched).
        const affected = await db.transactions.where('varietyId').equals(editingId).toArray()
        if (affected.length > 0) {
          await db.transactions.bulkUpdate(
            affected.map((t) => ({ key: t.id, changes: { cerealCategory: category } }))
          )
        }
      }
      toast.success('Variety updated')
    } else {
      await db.varietyTypes.add({
        varietyId: crypto.randomUUID(),
        category,
        name: name.trim(),
        ...palayFields,
      })
      toast.success('Variety saved')
    }

    resetForm()
  }

  const handleEdit = (variety) => {
    setEditingId(variety.varietyId)
    setCategory(variety.category)
    setName(variety.name)
    setPalay({
      purityMin: variety.purityMin ?? '',
      purityMax: variety.purityMax ?? '',
      purityLetter: variety.purityLetter ?? '',
      ddMin: variety.ddMin ?? '',
      ddMax: variety.ddMax ?? '',
    })
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

        {category === 'Palay' && (
          <div className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <p className="text-xs font-semibold uppercase text-neutral-500">
              Classification — used to compute the ENW factor on a Purchase Receipt
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelClass}>Purity min (%)</label>
                <input type="number" value={palay.purityMin} onChange={(e) => updatePalayField('purityMin', e.target.value)} className={inputClass} placeholder="95" />
              </div>
              <div className="flex-1">
                <label className={labelClass}>Purity max (%)</label>
                <input type="number" value={palay.purityMax} onChange={(e) => updatePalayField('purityMax', e.target.value)} className={inputClass} placeholder="100" />
              </div>
              <div className="w-20">
                <label className={labelClass}>Letter</label>
                <input type="text" maxLength={1} value={palay.purityLetter} onChange={(e) => updatePalayField('purityLetter', e.target.value)} className={inputClass} placeholder="A" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelClass}>D&D min (%)</label>
                <input type="number" value={palay.ddMin} onChange={(e) => updatePalayField('ddMin', e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div className="flex-1">
                <label className={labelClass}>D&D max (%)</label>
                <input type="number" value={palay.ddMax} onChange={(e) => updatePalayField('ddMax', e.target.value)} className={inputClass} placeholder="3" />
              </div>
            </div>
          </div>
        )}

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
                    <div>
                      <p className="font-medium text-app-text">{v.name}</p>
                      {v.category === 'Palay' && v.purityLetter && (
                        <p className="text-xs text-neutral-500">
                          Purity {v.purityMin}–{v.purityMax}% ({v.purityLetter}) · D&D {v.ddMin}–{v.ddMax}%
                        </p>
                      )}
                    </div>
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
