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

// The exact reference sheet already shared for this feature - 17 MC
// brackets x 2 Purity letters x 2 D&D brackets. Seeded in one tap
// instead of asking Admin to retype 68 values by hand. (One value
// corrected against the sheet's own decreasing trend: D&D 3.1-7%/
// Purity A's MC 24.1-25% cell read "0.07417" in the source - a 10x
// outlier next to 0.7533 and 0.73 either side of it - almost certainly
// a copy artifact for 0.7417, which fits the trend exactly and is used
// here; flagged so Admin can double check against the physical sheet.)
const MC_BRACKETS = [
  [11, 14], [14.1, 15], [15.1, 16], [16.1, 17], [17.1, 18], [18.1, 19], [19.1, 20],
  [20.1, 21], [21.1, 22], [22.1, 23], [23.1, 24], [24.1, 25], [25.1, 26], [26.1, 27],
  [27.1, 28], [28.1, 29], [29.1, 30],
]
const REFERENCE_ROWS = [
  { purityLetter: 'A', ddMin: 0, ddMax: 3, factors: [1, 0.9797, 0.9594, 0.939, 0.9187, 0.8984, 0.8781, 0.8577, 0.8374, 0.8171, 0.7968, 0.7851, 0.7735, 0.7619, 0.7503, 0.7386, 0.727] },
  { purityLetter: 'B', ddMin: 0, ddMax: 3, factors: [0.91, 0.8915, 0.873, 0.8545, 0.836, 0.8175, 0.799, 0.7805, 0.762, 0.7436, 0.7251, 0.7145, 0.7039, 0.6933, 0.6827, 0.6721, 0.6616] },
  { purityLetter: 'A', ddMin: 3.1, ddMax: 7, factors: [0.9565, 0.9362, 0.9159, 0.8956, 0.8752, 0.8549, 0.8346, 0.8143, 0.7939, 0.7736, 0.7533, 0.7417, 0.73, 0.7184, 0.7068, 0.6951, 0.6835] },
  { purityLetter: 'B', ddMin: 3.1, ddMax: 7, factors: [0.8665, 0.8481, 0.8297, 0.8113, 0.7929, 0.7745, 0.7561, 0.7376, 0.7192, 0.7008, 0.6824, 0.6619, 0.6613, 0.6508, 0.6403, 0.6297, 0.6192] },
]

function EnwFactorTablePanel() {
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [confirmingSeed, setConfirmingSeed] = useState(false)

  const rows = useLiveQuery(() => db.enwFactors.toArray(), []) ?? []

  const handleSeed = async () => {
    setConfirmingSeed(false)
    const seedRows = REFERENCE_ROWS.flatMap(({ purityLetter, ddMin, ddMax, factors }) =>
      factors.map((factor, i) => ({
        id: crypto.randomUUID(),
        purityLetter, ddMin, ddMax,
        mcMin: MC_BRACKETS[i][0], mcMax: MC_BRACKETS[i][1],
        factor,
      }))
    )
    await db.enwFactors.bulkAdd(seedRows)
    toast.success(`Loaded ${seedRows.length} reference rows`)
  }
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

      <button
        type="button"
        onClick={() => setConfirmingSeed(true)}
        className={`mt-3 w-full ${secondaryButtonClass}`}
      >
        Load Reference Table (17 MC brackets × 4 rows)
      </button>

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

      <ConfirmDialog
        open={confirmingSeed}
        title="Load the reference ENW table?"
        description="Adds 68 rows (17 MC brackets × Purity A/B × D&D 0-3%/3.1-7%) from the reference sheet already provided for this feature. One value (D&D 3.1-7%, Purity A, MC 24.1-25%) was corrected from 0.07417 to 0.7417 to match the sheet's own decreasing trend either side of it - worth a quick check against the physical sheet. Existing rows are kept, not replaced - re-running this adds duplicates, so use it once."
        confirmLabel="Load Table"
        onConfirm={handleSeed}
        onCancel={() => setConfirmingSeed(false)}
      />
    </section>
  )
}

export default EnwFactorTablePanel
