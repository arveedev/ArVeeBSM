// New Pile dialog — opened when the user selects "New Pile" from the Pile
// ID dropdown on a stock form. Lets them create a pile on the spot
// (category + variety + name) without leaving the transaction they're
// filling out; the new pile is added to db.piles and auto-selected back
// on the parent form.
//
// A pile is permanently locked to one variety for its whole lifetime —
// there is no "change variety later" flow, by design.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { inputClass, labelClass, primaryButtonClass } from './shared.js'

const CATEGORIES = ['Rice', 'Palay', 'By Products']

function NewPileDialog({ warehouseId, varieties, onCreated, onClose }) {
  const [pileName, setPileName] = useState('')
  const [category, setCategory] = useState('Rice')
  const [varietyId, setVarietyId] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const categoryVarieties = varieties.filter((v) => v.category === category)

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

    const pile = {
      pileId: crypto.randomUUID(),
      warehouseId,
      pileName: pileName.trim(),
      cerealType: category,
      varietyId,
      currentBags: 0,
      currentKilos: 0,
      initialAgeValue: 0,
      dateOfReceipt: new Date().toISOString().slice(0, 10),
    }

    await db.piles.add(pile)
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
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">New Pile</h2>
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
