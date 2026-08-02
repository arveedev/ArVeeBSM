// New Pile dialog — opened when the user selects "New Pile" from the Pile
// ID dropdown on a stock form. Lets them create a pile on the spot
// (category + variety + name), optionally seeded with a beginning balance
// for warehouses whose ongoing inventory is being entered into the app
// for the first time.
//
// A pile is permanently locked to one variety for its whole lifetime —
// there is no "change variety later" flow, by design.
//
// Beginning balance handling: if bags or kilos are entered, a synthetic
// WSR transaction is created with isInitialBalance: true. This keeps it
// out of visible statement/recap rows (excluded there) while still
// counting toward a report's beginning-balance figure (included in the
// prior-transactions sum, since that query does not filter the flag out).

import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { createPileWithBeginningBalance } from '../../utils/pileLedger.js'
import { liveFormatNumber, parseFormattedNumber } from '../../utils/calculations.js'
import { inputClass, labelClass, primaryButtonClass, CONDITION_FLAGS } from './shared.js'

const CATEGORIES = ['Rice', 'Palay', 'By Products']
const AGE_UNITS = ['Days', 'Months']

// By Products, unlike Rice/Palay, does not lock a pile to a single
// variety for its lifetime - a By Products pile can hold any mix of
// its cereal type's varieties (the variety picked here is just the
// pile's initial/seed variety for its optional beginning balance).
// See StockFormBase.jsx's variety field for where this is actually
// enforced during transactions - unlike Rice/Palay, a By Products
// pile keeps the variety selector editable rather than locking it to
// a read-only display of whatever variety the pile started with.
function NewPileDialog({ warehouseId, varieties, lockedCategory, onCreated, onClose }) {
  const [pileName, setPileName] = useState('')
  const [category, setCategory] = useState(lockedCategory ?? 'Rice')
  const [varietyId, setVarietyId] = useState('')
  const [beginBags, setBeginBags] = useState('')
  const [beginKilos, setBeginKilos] = useState('')
  const [beginAge, setBeginAge] = useState('')
  const [beginAgeUnit, setBeginAgeUnit] = useState('Days')
  const [beginCondition, setBeginCondition] = useState('GQ')
  const [isSaving, setIsSaving] = useState(false)

  const categoryVarieties = varieties
    .filter((v) => v.category === category)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const handleCreate = async () => {
    if (!pileName.trim()) {
      toast.error('Pile name is required')
      return
    }
    if (!varietyId) {
      toast.error('Select a variety for this pile')
      return
    }

    setIsSaving(true)

    const pile = await createPileWithBeginningBalance({
      warehouseId,
      pileName,
      category,
      varietyId,
      bags: beginBags === '' ? 0 : parseFormattedNumber(beginBags),
      kilos: beginKilos === '' ? 0 : parseFormattedNumber(beginKilos),
      age: beginAge === '' ? 0 : parseFormattedNumber(beginAge),
      ageUnit: beginAgeUnit,
      condition: beginCondition,
    })

    toast.success(`Pile "${pile.pileName}" created`)
    setIsSaving(false)
    onCreated(pile)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-app-text">New Pile</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-950 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className={labelClass}>Pile Name</label>
            <input
              type="text"
              value={pileName}
              onChange={(e) => setPileName(e.target.value)}
              className={inputClass}
              placeholder="Pile C-1"
            />
          </div>

          <div>
            <label className={labelClass}>Category</label>
            {lockedCategory ? (
              <p className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-base font-semibold text-app-text">
                {lockedCategory}
              </p>
            ) : (
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value)
                  setVarietyId('')
                }}
                className={inputClass}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className={labelClass}>Variety</label>
            <select
              value={varietyId}
              onChange={(e) => setVarietyId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select variety…</option>
              {categoryVarieties.map((v) => (
                <option key={v.varietyId} value={v.varietyId}>
                  {v.name}
                </option>
              ))}
            </select>
            {categoryVarieties.length === 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                No {category} varieties configured yet — add one in the
                Admin Dashboard's Varieties tab first.
              </p>
            )}
          </div>

          <p className="text-xs text-neutral-500">
            A pile's variety can never be changed once created — every bag
            stored in it is treated as this variety.
          </p>

          <div className="border-t border-neutral-800 pt-3">
            <p className="text-xs font-semibold uppercase text-neutral-500">
              Beginning Balance (optional)
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Use this to seed stock already on hand at this warehouse —
              not a receipt or issuance, just a starting point.
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Bags</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={beginBags}
                  onChange={(e) => setBeginBags(liveFormatNumber(e.target.value))}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={labelClass}>Net Kilos</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={beginKilos}
                  onChange={(e) => setBeginKilos(liveFormatNumber(e.target.value, 3))}
                  className={inputClass}
                  placeholder="0.000"
                />
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Age</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={beginAge}
                  onChange={(e) => setBeginAge(liveFormatNumber(e.target.value))}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={labelClass}>Unit</label>
                <select
                  value={beginAgeUnit}
                  onChange={(e) => setBeginAgeUnit(e.target.value)}
                  className={inputClass}
                >
                  {AGE_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-2">
              <label className={labelClass}>Condition</label>
              <div className="mt-1 grid grid-cols-5 gap-1">
                {CONDITION_FLAGS.map((flag) => (
                  <button
                    key={flag}
                    type="button"
                    onClick={() => setBeginCondition(flag)}
                    className={`rounded-lg border py-1.5 text-xs font-medium transition-all active:scale-95 ${
                      beginCondition === flag
                        ? 'border-brand-neon bg-brand-neon/10 text-brand-neon'
                        : 'border-neutral-800 bg-neutral-950 text-neutral-400'
                    }`}
                  >
                    {flag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={isSaving}
            className={`w-full ${primaryButtonClass}`}
          >
            Create Pile
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewPileDialog
