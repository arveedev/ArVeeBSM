// Net Equivalent Net Weight (ENW) Factor Table — Admin only.
//
// One row per (Purity letter, D&D bracket, MC bracket) -> factor. A
// Palay variety's own fixed Purity letter / D&D bracket (see
// VarietyTypesPanel.jsx) already picks which rows apply to it; a
// Purchase Receipt's WSR's own Moisture Content picks the MC bracket
// among those. See src/utils/sdoCalculations.js's lookupEnwFactor for
// the actual runtime lookup this table drives.

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
} from './shared.js'

const emptyForm = { purityLetter: '', ddMin: '', ddMax: '', mcMin: '', mcMax: '', factor: '' }

function EnwFactorTablePanel() {
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const rows = useLiveQuery(() => db.enwFactors.toArray(), []) ?? []
  const sorted = [...rows].sort((a, b) =>
    (a.purityLetter ?? '').localeCompare(b.purityLetter ?? '') || (a.mcMin ?? 0) - (b.mcMin ?? 0)
  )

  const updateField = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
  }

  const handleSave = async () => {
    const { purityLetter, ddMin, ddMax, mcMin, mcMax, factor } = form
    if (!purityLetter.trim() || ddMin === '' || ddMax === '' || mcMin === '' || mcMax === '' || factor === '') {
      toast.error('All fields are required')
      return
    }
    const record = {
      purityLetter: purityLetter.trim().toUpperCase(),
      ddMin: parseFloat(ddMin),
      ddMax: parseFloat(ddMax),
      mcMin: parseFloat(mcMin),
      mcMax: parseFloat(mcMax),
      factor: parseFloat(factor),
    }
    if (editingId) {
      await db.enwFactors.update(editingId, record)
      toast.success('ENW row updated')
    } else {
      await db.enwFactors.add({ id: crypto.randomUUID(), ...record })
      toast.success('ENW row saved')
    }
    resetForm()
  }

  const handleEdit = (row) => {
    setEditingId(row.id)
    setForm({
      purityLetter: row.purityLetter ?? '',
      ddMin: String(row.ddMin ?? ''),
      ddMax: String(row.ddMax ?? ''),
      mcMin: String(row.mcMin ?? ''),
      mcMax: String(row.mcMax ?? ''),
      factor: String(row.factor ?? ''),
    })
  }

  const confirmDelete = async () => {
    const id = pendingDelete
    setPendingDelete(null)
    await db.enwFactors.delete(id)
    if (editingId === id) resetForm()
    toast.success('ENW row deleted')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">ENW Factor Table</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Admin only — MC bracket × Purity letter × D&D bracket → factor.
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex gap-2">
          <div className="w-20">
            <label className={labelClass}>Letter</label>
            <input type="text" maxLength={1} value={form.purityLetter} onChange={(e) => updateField('purityLetter', e.target.value)} className={inputClass} placeholder="A" />
          </div>
          <div className="flex-1">
            <label className={labelClass}>D&D min (%)</label>
            <input type="number" value={form.ddMin} onChange={(e) => updateField('ddMin', e.target.value)} className={inputClass} placeholder="0" />
          </div>
          <div className="flex-1">
            <label className={labelClass}>D&D max (%)</label>
            <input type="number" value={form.ddMax} onChange={(e) => updateField('ddMax', e.target.value)} className={inputClass} placeholder="3" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelClass}>MC min (%)</label>
            <input type="number" value={form.mcMin} onChange={(e) => updateField('mcMin', e.target.value)} className={inputClass} placeholder="11" />
          </div>
          <div className="flex-1">
            <label className={labelClass}>MC max (%)</label>
            <input type="number" value={form.mcMax} onChange={(e) => updateField('mcMax', e.target.value)} className={inputClass} placeholder="14" />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Factor</label>
            <input type="number" step="0.0001" value={form.factor} onChange={(e) => updateField('factor', e.target.value)} className={inputClass} placeholder="1.0000" />
          </div>
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

      {sorted.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sorted.map((row) => (
            <li key={row.id} className={listItemClass}>
              <p className="text-sm text-app-text">
                <span className="font-semibold text-brand-neon">{row.purityLetter}</span>
                {' '}· D&D {row.ddMin}–{row.ddMax}% · MC {row.mcMin}–{row.mcMax}% ={' '}
                <span className="font-mono font-semibold">{row.factor}</span>
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={() => handleEdit(row)} aria-label="Edit" className={editIconClass}>
                  <Pencil size={20} />
                </button>
                <button type="button" onClick={() => setPendingDelete(row.id)} aria-label="Delete" className={deleteIconClass}>
                  <Trash2 size={20} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this ENW row?"
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default EnwFactorTablePanel
