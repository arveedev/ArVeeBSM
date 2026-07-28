// Sack Types — each is used for a category (Rice, Palay, or By Products)
// (e.g. "PPRE50"). Every sack type has exactly three fixed conditions —
// Brand New (BN), Second Hand (SH), Unserviceable (US) — each with its own
// configurable weight in kg.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'
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
  SACK_CONDITIONS,
} from './shared.js'

const CATEGORIES = ['Rice', 'Palay', 'By Products']

const emptyWeights = () => ({ BN: '', SH: '', US: '' })

function SackTypesPanel() {
  const [category, setCategory] = useState('Rice')
  const [code, setCode] = useState('')
  const [weights, setWeights] = useState(emptyWeights())
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), [])
  const sortedSackTypes = [...(sackTypes ?? [])].sort((a, b) => byAlpha(a.code, b.code))

  const resetForm = () => {
    setCategory('Rice')
    setCode('')
    setWeights(emptyWeights())
    setEditingId(null)
  }

  const updateWeight = (conditionCode, value) => {
    setWeights((w) => ({ ...w, [conditionCode]: liveFormatNumber(value, 3) }))
  }

  const handleSave = async () => {
    if (!code.trim()) {
      toast.error('Sack code is required')
      return
    }

    const cleanedWeights = {}
    for (const { code: conditionCode, label } of SACK_CONDITIONS) {
      const raw = weights[conditionCode]

      if (raw === '' || raw === null || raw === undefined) {
        cleanedWeights[conditionCode] = null
        continue
      }

      const num = parseFormattedNumber(raw)
      if (Number.isNaN(num) || num < 0) {
        toast.error(`Weight for ${label} (${conditionCode}) must be a valid number`)
        return
      }
      cleanedWeights[conditionCode] = num
    }

    const normalizedCode = code.trim().toUpperCase()

    if (editingId) {
      await db.sackTypes.update(editingId, {
        category,
        code: normalizedCode,
        weights: cleanedWeights,
      })
      toast.success('Sack type updated')
    } else {
      await db.sackTypes.add({
        sackTypeId: crypto.randomUUID(),
        category,
        code: normalizedCode,
        weights: cleanedWeights,
      })
      toast.success('Sack type saved')
    }

    resetForm()
  }

  const handleEdit = (sackType) => {
    setEditingId(sackType.sackTypeId)
    setCategory(sackType.category)
    setCode(sackType.code)
    setWeights({
      BN: sackType.weights?.BN != null ? liveFormatNumber(String(sackType.weights.BN), 3) : '',
      SH: sackType.weights?.SH != null ? liveFormatNumber(String(sackType.weights.SH), 3) : '',
      US: sackType.weights?.US != null ? liveFormatNumber(String(sackType.weights.US), 3) : '',
    })
  }

  const confirmDelete = async () => {
    const sackTypeId = pendingDelete
    setPendingDelete(null)
    await db.sackTypes.delete(sackTypeId)
    if (editingId === sackTypeId) resetForm()
    toast.success('Sack type deleted')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Sack Types</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Every sack code has three conditions — Brand New (BN), Second Hand
        (SH), and Unserviceable (US). Weights (kg) are optional and can be
        filled in later — leave blank if not yet known.
      </p>

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
          <label className={labelClass}>Sack Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
            placeholder="PPRE50"
          />
        </div>

        <div>
          <label className={labelClass}>Weights by Condition (kg)</label>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {SACK_CONDITIONS.map(({ code: conditionCode, label }) => (
              <div key={conditionCode}>
                <span className="block text-center text-xs text-neutral-500">
                  {label} ({conditionCode})
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={weights[conditionCode]}
                  onChange={(e) => updateWeight(conditionCode, e.target.value)}
                  className={`${inputClass} text-center`}
                  placeholder="0.000"
                />
              </div>
            ))}
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

      {sortedSackTypes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sortedSackTypes.map((s) => (
            <li key={s.sackTypeId} className={`${listItemClass} items-start`}>
              <div>
                <p className="font-medium text-app-text">
                  {s.code} · {s.category}
                </p>
                <p className="text-xs text-neutral-400">
                  {SACK_CONDITIONS.map(
                    ({ code: cc }) => `${cc}: ${s.weights?.[cc] ?? '—'}kg`
                  ).join(' · ')}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleEdit(s)}
                  aria-label="Edit"
                  className={editIconClass}
                >
                  <Pencil size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(s.sackTypeId)}
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
        title="Delete this sack type?"
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default SackTypesPanel
