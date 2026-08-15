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
// Setting a new age value back-dates dateOfReceipt to (today - the new
// age) and zeroes initialAgeValue, rather than resetting dateOfReceipt
// to today with the override held separately - so "Date Received" keeps
// reading as a real date the age genuinely counts forward from (e.g.
// correcting "1 month" to "2 months" moves the date back an extra
// month), and auto-age-monitoring's elapsed-days component continues
// growing from that corrected baseline exactly as it would have from a
// real receipt date.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { normalizeAgeToDays, fmtAge, localISODaysAgo, bestAgeUnit, liveFormatNumber, parseFormattedNumber } from '../../utils/calculations.js'
import { inputClass, labelClass, primaryButtonClass } from '../forms/shared.js'

const AGE_UNITS = ['Days', 'Months', 'Months + Days']

function EditPileAgeDialog({ pile, currentAge, onClose }) {
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, 180)
  }

  const initial = bestAgeUnit(currentAge)
  const [ageValue, setAgeValue] = useState(liveFormatNumber(String(initial.unit === 'Months + Days' ? currentAge : initial.value)))
  const [ageUnit, setAgeUnit] = useState(initial.unit)
  const [monthsValue, setMonthsValue] = useState(liveFormatNumber(String(initial.months)))
  const [daysValue, setDaysValue] = useState(liveFormatNumber(String(initial.days)))
  const [isSaving, setIsSaving] = useState(false)

  // The current age in days, regardless of which unit is currently
  // displayed - used to convert correctly when the user switches units,
  // rather than leaving the same raw number in place under a new unit
  // (e.g. switching from Days to Months should turn "30" into "1", not
  // leave "30" displayed as if it meant 30 months).
  const currentDays = () => {
    if (ageUnit === 'Months + Days') return Math.round((parseFormattedNumber(monthsValue) || 0) * 30 + (parseFormattedNumber(daysValue) || 0))
    return normalizeAgeToDays(parseFormattedNumber(ageValue) || 0, ageUnit)
  }

  const handleUnitChange = (newUnit) => {
    const days = currentDays()
    if (newUnit === 'Months + Days') {
      setMonthsValue(liveFormatNumber(String(Math.floor(days / 30))))
      setDaysValue(liveFormatNumber(String(days % 30)))
    } else if (newUnit === 'Months') {
      setAgeValue(liveFormatNumber(String(Math.round(days / 30))))
    } else {
      setAgeValue(liveFormatNumber(String(days)))
    }
    setAgeUnit(newUnit)
  }

  const handleSave = async () => {
    let days

    if (ageUnit === 'Months + Days') {
      const months = parseFormattedNumber(monthsValue) || 0
      const extraDays = parseFormattedNumber(daysValue) || 0
      if (months < 0 || extraDays < 0) {
        toast.error('Enter a valid age')
        return
      }
      days = Math.round(months * 30 + extraDays)
    } else {
      const parsed = parseFormattedNumber(ageValue)
      if (Number.isNaN(parsed) || parsed < 0) {
        toast.error('Enter a valid age')
        return
      }
      days = normalizeAgeToDays(parsed, ageUnit)
    }

    setIsSaving(true)
    // Back-date dateOfReceipt to (today - days) instead of resetting it
    // to today with the override held separately in initialAgeValue -
    // both approaches produce the same age today, but back-dating keeps
    // "Date Received" reading as a real date the age genuinely counts
    // from (e.g. correcting "1 month" to "2 months" moves the date back
    // an extra month), rather than always showing today's date after
    // every correction.
    await db.piles.update(pile.pileId, {
      initialAgeValue: 0,
      dateOfReceipt: localISODaysAgo(days),
    })
    toast.success(`${pile.pileName} age set to ${fmtAge(days)}`)
    setIsSaving(false)
    handleClose()
  }

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-4 ${isClosing ? 'animate-pop-out' : 'animate-pop-in'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-app-text">Edit Age</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-950 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-1 text-xs text-neutral-500">{pile.pileName}</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {ageUnit === 'Months + Days' ? (
            <>
              <div>
                <label className={labelClass}>Months</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={monthsValue}
                  onChange={(e) => setMonthsValue(liveFormatNumber(e.target.value))}
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelClass}>Days</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={daysValue}
                  onChange={(e) => setDaysValue(liveFormatNumber(e.target.value))}
                  className={inputClass}
                />
              </div>
            </>
          ) : (
            <div>
              <label className={labelClass}>Age</label>
              <input
                type="text"
                inputMode="numeric"
                value={ageValue}
                onChange={(e) => setAgeValue(liveFormatNumber(e.target.value))}
                className={inputClass}
                autoFocus
              />
            </div>
          )}
          <div className={ageUnit === 'Months + Days' ? 'col-span-2' : ''}>
            <label className={labelClass}>Unit</label>
            <select
              value={ageUnit}
              onChange={(e) => handleUnitChange(e.target.value)}
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
