// Edit Pile Age — lets the user directly override a pile's displayed age,
// in either Days or Months, disregarding the normal Base Initial Age +
// elapsed-days calculation. Per clarification: a separate department
// sometimes handles age computation for technical reasons, so the age
// needs to be a direct, unconditional override available from the pile
// card itself.
//
// Internally, age is always stored in DAYS on the pile (initialAgeValue),
// since that's what the age-bucket grouping on Admin Home operates in.
// Selecting "Months" here converts via normalizeAgeToDays before saving —
// entering "7" with Months selected stores 210 days, not 7 days, so it
// correctly lands in the right age bucket (e.g. Palay's 6.1–12 months).
//
// Setting a new age value also resets dateOfReceipt to today, so the
// auto-age-monitoring elapsed-days component starts fresh from this new
// baseline rather than continuing to add elapsed days on top of a
// now-stale receipt date.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { normalizeAgeToDays } from '../../utils/calculations.js'
import { inputClass, labelClass, primaryButtonClass } from '../forms/shared.js'

const AGE_UNITS = ['Days', 'Months']

function EditPileAgeDialog({ pile, currentAge, onClose }) {
  const [ageValue, setAgeValue] = useState(String(currentAge))
  const [ageUnit, setAgeUnit] = useState('Days')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    const parsed = Number(ageValue)
    if (Number.isNaN(parsed) || parsed < 0) {
      toast.error('Enter a valid age')
      return
    }

    const days = normalizeAgeToDays(parsed, ageUnit)

    setIsSaving(true)
    await db.piles.update(pile.pileId, {
      initialAgeValue: days,
      dateOfReceipt: new Date().toISOString().slice(0, 10),
    })
    toast.success(`${pile.pileName} age set to ${parsed} ${ageUnit.toLowerCase()}`)
    setIsSaving(false)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Edit Age</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-950 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-1 text-xs text-neutral-500">{pile.pileName}</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Age</label>
            <input
              type="number"
              inputMode="numeric"
              value={ageValue}
              onChange={(e) => setAgeValue(e.target.value)}
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className={labelClass}>Unit</label>
            <select
              value={ageUnit}
              onChange={(e) => setAgeUnit(e.target.value)}
              className={inputClass}
            >
              {AGE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="mt-2 text-xs text-neutral-500">
          Overrides the calculated age directly — use this if another
          department has already determined the correct age for this
          pile's stock.
        </p>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={`mt-4 w-full ${primaryButtonClass}`}
        >
          Save
        </button>
      </div>
    </div>
  )
}

export default EditPileAgeDialog
