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
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, Check, AlertTriangle } from 'lucide-react'
import { db } from '../../db/dexie.js'
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
  // Defaults to 1 day, per explicit request - incoming/newly-created
  // piles almost always genuinely start at age 0-1, so this saves the
  // vast majority of new piles a manual edit.
  const [beginAge, setBeginAge] = useState('1')
  const [beginAgeUnit, setBeginAgeUnit] = useState('Days')
  const [beginCondition, setBeginCondition] = useState('GQ')
  const [mtsSelection, setMtsSelection] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  // 'idle' | 'checking' | 'ok' | 'duplicate' - checked on blur, not on
  // every keystroke, so it only reflects the name as the user last
  // actually finished typing it, not a half-typed value mid-edit.
  const [nameCheckStatus, setNameCheckStatus] = useState('idle')

  const checkPileNameDuplicate = async () => {
    const trimmed = pileName.trim()
    if (!trimmed) { setNameCheckStatus('idle'); return }
    setNameCheckStatus('checking')
    const existing = await db.piles
      .where('warehouseId').equals(warehouseId)
      .and((p) => p.pileName.trim().toLowerCase() === trimmed.toLowerCase())
      .first()
    setNameCheckStatus(existing ? 'duplicate' : 'ok')
  }

  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const mtsOptions = [...sackTypes]
    .filter((s) => category === 'By Products' || s.category === category)
    .sort((a, b) => a.code.localeCompare(b.code))
    .flatMap((s) =>
      ['BN', 'SH', 'US']
        .filter((cond) => s.weights?.[cond] != null)
        .map((cond) => ({ key: `${s.sackTypeId}::${cond}`, label: `${s.code} - ${cond} (${s.weights[cond]} kg)` }))
    )

  const categoryVarieties = varieties
    .filter((v) => v.category === category)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const handleCreate = async () => {
    if (!pileName.trim()) {
      toast.error('Pile name is required')
      return
    }
    // Per explicit request: Pile Name, Age, and Condition are the only
    // fields this quick-add dialog actually requires - Condition
    // always has a value by construction (CONDITION_FLAGS buttons
    // default to 'GQ'), so only Age needs an explicit check here.
    if (beginAge === '') {
      toast.error('Age is required')
      return
    }
    // By Products piles accept any mix of By Products varieties over
    // their lifetime (see the file-level comment) - only Rice/Palay,
    // genuinely locked to one variety for life, require picking one
    // up front.
    if (category !== 'By Products' && !varietyId) {
      toast.error('Select a variety for this pile')
      return
    }

    // Re-checked fresh rather than trusting the last blur result, in
    // case the user ignored the inline warning or another pile with
    // the same name got created elsewhere in the meantime.
    const trimmed = pileName.trim()
    const duplicate = await db.piles
      .where('warehouseId').equals(warehouseId)
      .and((p) => p.pileName.trim().toLowerCase() === trimmed.toLowerCase())
      .first()
    if (duplicate) {
      toast.error(`A pile named "${trimmed}" already exists in this warehouse`)
      setNameCheckStatus('duplicate')
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
            <div className="relative">
              <input
                type="text"
                value={pileName}
                onChange={(e) => { setPileName(e.target.value); setNameCheckStatus('idle') }}
                onBlur={checkPileNameDuplicate}
                className={`${inputClass} ${nameCheckStatus === 'ok' ? '!border-brand-neon' : nameCheckStatus === 'duplicate' ? '!border-brand-amber' : ''} ${nameCheckStatus === 'ok' || nameCheckStatus === 'duplicate' ? 'pr-9' : ''}`}
                placeholder="Pile C-1"
              />
              {nameCheckStatus === 'ok' && (
                <Check size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-neon" />
              )}
              {nameCheckStatus === 'duplicate' && (
                <AlertTriangle size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-amber" />
              )}
            </div>
            {nameCheckStatus === 'duplicate' && (
              <p className="mt-1 text-xs text-brand-amber">This pile name is already used in this warehouse.</p>
            )}
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
            <label className={labelClass}>Variety{category === 'By Products' ? ' (optional)' : ''}</label>
            <select
              value={varietyId}
              onChange={(e) => setVarietyId(e.target.value)}
              className={`${inputClass} ${category !== 'By Products' && !varietyId ? '!border-brand-amber' : ''}`}
            >
              <option value="">{category === 'By Products' ? 'Optional — accepts any' : 'Select variety…'}</option>
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
            {category === 'By Products'
              ? 'A By Products pile accepts any mix of By Products varieties over its lifetime - picking one here only seeds its optional beginning balance below.'
              : "A pile's variety can never be changed once created — every bag stored in it is treated as this variety."}
          </p>

          <div className="border-t border-neutral-800 pt-3">
            <p className="text-xs font-semibold uppercase text-neutral-500">
              Beginning Balance
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Bags/Kilos are optional - use them to seed stock already on
              hand at this warehouse (not a receipt or issuance, just a
              starting point). Age and Condition apply to the pile
              either way, so Age is required even if left at zero.
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
                  className={`${inputClass} ${beginAge === '' ? '!border-brand-amber' : ''}`}
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
