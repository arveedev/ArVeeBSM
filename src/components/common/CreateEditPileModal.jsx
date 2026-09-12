// Create/Edit Pile — extracted from Settings.jsx's old inline
// "Create Pile" tab into its own modal (per explicit request: a button
// that opens a modal, not a permanently-open form taking up a whole
// tab). Same fields/behavior as before, just reorganized into grouped
// sections (Identity / Quantity / Quality & Dates) under a hero header
// that live-previews the pile's own name + a variety pill tinted to
// its cereal type - the same tint convention as the Pile List's own
// accent bars (HomePiles.jsx's accentBarClass/varietyBadgeClass).
//
// Editing a pile here only ever touches its METADATA (name, category/
// variety, purity, dates, condition) - bags/kilos/age/as-of stay
// exclusively owned by the Beginning Balances panel, exactly as
// before. Rather than hiding that split, an edit shows the pile's
// live current stock as a read-only summary with an "Edit balance ->"
// link that closes this modal and jumps straight into Beginning
// Balances already scrolled to and editing that same pile - see
// Settings.jsx's focusBalancePileId wiring.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, Check, AlertTriangle } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { fmtBags, fmtWeight, todayLocalISO, liveFormatNumber, parseFormattedNumber } from '../../utils/calculations.js'
import { createPileWithBeginningBalance, recalculatePileCurrentState } from '../../utils/pileLedger.js'
import { inputClass, labelClass, primaryButtonClass, byAlpha } from './admin/shared.js'
import { CONDITION_FLAGS } from '../forms/shared.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'

const CATEGORIES = ['Rice', 'Palay', 'By Products']
const AGE_UNITS = ['Days', 'Months']

// Same mapping as HomePiles.jsx's accentBarClass/varietyBadgeClass -
// duplicated locally rather than imported/shared, matching this
// codebase's own established convention for this exact small lookup
// (see AuthorityPickerModal's own categoryColor, HomePiles.jsx's own
// comment about it).
const heroTint = (category) => {
  if (category === 'Rice') return { pill: 'bg-blue-500 text-white', wash: 'rgba(59,130,246,.28), rgba(59,130,246,.04)' }
  if (category === 'Palay') return { pill: 'bg-brand-neon text-brand-contrast', wash: 'rgba(0,255,163,.28), rgba(0,255,163,.04)' }
  if (category === 'By Products') return { pill: 'bg-brand-byproduct text-neutral-950', wash: 'rgba(242,185,73,.28), rgba(242,185,73,.04)' }
  return { pill: 'bg-neutral-700 text-neutral-300', wash: 'rgba(115,115,115,.2), rgba(115,115,115,.03)' }
}

function CreateEditPileModal({ open, warehouseId, pile, onClose, onGoToBalance }) {
  const { weightUnit } = useSettings() ?? {}
  const isEditing = Boolean(pile)

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const editingVariety = pile ? varietyMap.get(pile.varietyId) : null

  const [pileName, setPileName] = useState(pile?.pileName ?? '')
  const [category, setCategory] = useState(editingVariety?.category ?? pile?.cerealType ?? 'Rice')
  const [varietyId, setVarietyId] = useState(pile?.varietyId ?? '')
  const [bags, setBags] = useState('')
  const [kilos, setKilos] = useState('')
  const [byProductBalances, setByProductBalances] = useState({})
  const updateByProductBalance = (vId, field, value) => {
    setByProductBalances((prev) => ({ ...prev, [vId]: { ...(prev[vId] ?? { bags: '', kilos: '' }), [field]: value } }))
  }
  // Defaults to 1 day, per explicit request - a newly created pile
  // almost always genuinely starts at age 0-1.
  const [age, setAge] = useState('1')
  const [ageUnit, setAgeUnit] = useState('Days')
  const [condition, setCondition] = useState(pile?.condition ?? 'GQ')
  const [purity, setPurity] = useState(pile?.purity ?? '')
  const [dateProcured, setDateProcured] = useState(pile?.dateProcured ?? '')
  const [asOfDate, setAsOfDate] = useState(todayLocalISO())
  const [moistureContent, setMoistureContent] = useState(pile?.moistureContent ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [nameCheckStatus, setNameCheckStatus] = useState('idle')
  const [showHint, setShowHint] = useState(false)

  if (!open) return null

  const categoryVarieties = varieties.filter((v) => v.category === category).sort((a, b) => byAlpha(a.name, b.name))
  const tint = heroTint(category)
  const selectedVarietyName = category === 'By Products' ? null : varietyMap.get(varietyId)?.name

  const checkPileNameDuplicate = async () => {
    const trimmed = pileName.trim()
    if (!trimmed) { setNameCheckStatus('idle'); return }
    setNameCheckStatus('checking')
    const existing = await db.piles
      .where('warehouseId').equals(warehouseId)
      .and((p) => p.pileId !== pile?.pileId && !p.closedDate && p.pileName.trim().toLowerCase() === trimmed.toLowerCase())
      .first()
    setNameCheckStatus(existing ? 'duplicate' : 'ok')
  }

  const canSave = Boolean(pileName.trim())
    && (category === 'By Products' || Boolean(varietyId))
    && (isEditing || category === 'By Products' || (bags !== '' && kilos !== ''))
    && (isEditing || age !== '')

  const handleCreate = async () => {
    const trimmedName = pileName.trim()
    const duplicate = await db.piles
      .where('warehouseId').equals(warehouseId)
      .and((p) => !p.closedDate && p.pileName.trim().toLowerCase() === trimmedName.toLowerCase())
      .first()
    if (duplicate) {
      toast.error(`A pile named "${trimmedName}" already exists in this warehouse`)
      setNameCheckStatus('duplicate')
      return
    }

    setIsSaving(true)

    if (category === 'By Products') {
      // Bare pile first, no single seed - the real beginning balance
      // comes from the per-variety lines below, each becoming its own
      // seed transaction under this same pileId, same pattern
      // BeginningBalancesPanel.jsx's own repeatable lines use.
      const newPile = await createPileWithBeginningBalance({
        warehouseId, pileName, category, varietyId: null,
        bags: 0, kilos: 0,
        age: age === '' ? 0 : parseFormattedNumber(age),
        ageUnit, condition, purity, dateProcured, moistureContent,
        asOfDate,
      })
      let lineIndex = 0
      for (const v of categoryVarieties) {
        const line = byProductBalances[v.varietyId]
        const lineBags = line?.bags ? parseFormattedNumber(line.bags) : 0
        const lineKilos = line?.kilos ? parseFormattedNumber(line.kilos) : 0
        if (lineBags <= 0 && lineKilos <= 0) continue
        lineIndex += 1
        await db.transactions.add({
          id: crypto.randomUUID(), type: 'WSR', serialNo: `INIT-${newPile.pileId.slice(0, 8)}-${lineIndex}`,
          status: 'Active', date: newPile.dateOfReceipt, warehouseId,
          pileId: newPile.pileId, varietyId: v.varietyId, condition,
          purity: purity?.trim() || null, numberOfBags: lineBags,
          grossKilos: lineKilos, netKilos: lineKilos,
          moistureContent: moistureContent?.trim() || null,
          customerName: 'Beginning Balance', isInitialBalance: true, isSynced: true,
        })
      }
      await recalculatePileCurrentState(newPile.pileId)
      toast.success(`Pile "${newPile.pileName}" created`)
      setIsSaving(false)
      onClose()
      return
    }

    const newPile = await createPileWithBeginningBalance({
      warehouseId, pileName, category, varietyId,
      bags: bags === '' ? 0 : parseFormattedNumber(bags),
      kilos: kilos === '' ? 0 : parseFormattedNumber(kilos),
      age: age === '' ? 0 : parseFormattedNumber(age),
      ageUnit, condition, purity, dateProcured, moistureContent,
      asOfDate,
    })
    toast.success(`Pile "${newPile.pileName}" created`)
    setIsSaving(false)
    onClose()
  }

  // Metadata only - name/category/variety/purity/dates/condition. The
  // beginning balance (bags/kilos/age/as-of) is exclusively managed by
  // the Beginning Balances panel - see this file's own top comment.
  const handleUpdate = async () => {
    const trimmedName = pileName.trim()
    const duplicate = await db.piles
      .where('warehouseId').equals(warehouseId)
      .and((p) => p.pileId !== pile.pileId && !p.closedDate && p.pileName.trim().toLowerCase() === trimmedName.toLowerCase())
      .first()
    if (duplicate) {
      toast.error(`A pile named "${trimmedName}" already exists in this warehouse`)
      setNameCheckStatus('duplicate')
      return
    }

    setIsSaving(true)
    await db.piles.update(pile.pileId, {
      pileName: trimmedName,
      varietyId,
      purity: purity.trim() || null,
      dateProcured: dateProcured.trim() || null,
      moistureContent: moistureContent.trim() || null,
      condition,
    })
    // Derive fresh from the ledger, never set directly from the form.
    await recalculatePileCurrentState(pile.pileId)
    toast.success('Pile updated')
    setIsSaving(false)
    onClose()
  }

  const handleSubmit = () => {
    if (!canSave) { setShowHint(true); return }
    isEditing ? handleUpdate() : handleCreate()
  }

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl border border-neutral-800 bg-neutral-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero header - live display of the name being typed + a
            variety pill tinted to the cereal type, not itself an
            editable field (the real Pile Name/Category/Variety inputs
            stay normal boxed fields in the body below, matching the
            existing form exactly - only the header is new). */}
        <div style={{ backgroundImage: `linear-gradient(135deg, ${tint.wash})` }} className="px-4 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-xl font-extrabold text-app-text">{pileName.trim() || (isEditing ? pile.pileName : 'New Pile')}</p>
              <span className={`mt-1.5 inline-block rounded-full px-3 py-1 text-xs font-bold ${tint.pill}`}>
                {category === 'By Products' ? 'By Products' : selectedVarietyName ? `${category} · ${selectedVarietyName}` : `${category} · pick a variety`}
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-neutral-400 hover:text-app-text">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isEditing && (
            <button
              type="button"
              onClick={() => { onGoToBalance?.(pile); onClose() }}
              className="mb-4 flex w-full items-center justify-between rounded-xl bg-neutral-950 px-3 py-2.5 text-left transition-colors active:bg-neutral-800"
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">Current stock (live)</p>
                <p className="mt-0.5 text-sm font-semibold text-app-text">{fmtBags(pile.currentBags ?? 0)} bags · {fmtWeight(pile.currentKilos ?? 0, weightUnit, 'Net')}</p>
              </div>
              <span className="text-xs font-bold text-brand-neon">Edit balance →</span>
            </button>
          )}

          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Identity</p>
          <div className="mb-4 space-y-2">
            <div>
              <label className={labelClass}>Pile Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={pileName}
                  onChange={(e) => { setPileName(e.target.value); setNameCheckStatus('idle') }}
                  onBlur={checkPileNameDuplicate}
                  className={`${inputClass} ${nameCheckStatus === 'ok' ? '!border-brand-neon' : nameCheckStatus === 'duplicate' ? '!border-brand-amber' : !pileName.trim() ? '!border-brand-amber' : ''} ${nameCheckStatus === 'ok' || nameCheckStatus === 'duplicate' ? 'pr-9' : ''}`}
                  placeholder="Pile C-1"
                  autoFocus
                />
                {nameCheckStatus === 'ok' && <Check size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-neon" />}
                {nameCheckStatus === 'duplicate' && <AlertTriangle size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-amber" />}
              </div>
              {nameCheckStatus === 'duplicate' && <p className="mt-1 text-xs text-brand-amber">This pile name is already used in this warehouse.</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Category</label>
                <select value={category} onChange={(e) => { setCategory(e.target.value); setVarietyId(''); setByProductBalances({}) }} className={inputClass}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Variety{category === 'By Products' ? ' (optional)' : ''}</label>
                <select
                  value={varietyId}
                  onChange={(e) => setVarietyId(e.target.value)}
                  className={`${inputClass} ${category !== 'By Products' && !varietyId ? '!border-brand-amber' : ''}`}
                >
                  <option value="">{category === 'By Products' ? 'Optional — accepts any' : 'Select…'}</option>
                  {categoryVarieties.map((v) => <option key={v.varietyId} value={v.varietyId}>{v.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {!isEditing && (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Quantity</p>
              <div className="mb-4 space-y-2">
                {category === 'By Products' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-neutral-500">Beginning Balance by Variety (optional)</p>
                    {categoryVarieties.length === 0 && (
                      <p className="text-xs text-neutral-500">No By Products varieties configured yet — add one in the Admin Dashboard's Varieties tab first.</p>
                    )}
                    {categoryVarieties.map((v) => {
                      const line = byProductBalances[v.varietyId] ?? { bags: '', kilos: '' }
                      return (
                        <div key={v.varietyId} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5">
                          <p className="text-xs font-semibold text-neutral-400">{v.name}</p>
                          <div className="mt-1.5 grid grid-cols-2 gap-2">
                            <div>
                              <label className={labelClass}>Bags</label>
                              <input type="text" inputMode="numeric" value={line.bags}
                                onChange={(e) => updateByProductBalance(v.varietyId, 'bags', liveFormatNumber(e.target.value))}
                                className={inputClass} placeholder="0" />
                            </div>
                            <div>
                              <label className={labelClass}>Net Kilos</label>
                              <input type="text" inputMode="decimal" value={line.kilos}
                                onChange={(e) => updateByProductBalance(v.varietyId, 'kilos', liveFormatNumber(e.target.value, 3))}
                                className={inputClass} placeholder="0.000" />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelClass}>Bags</label>
                      <input type="text" inputMode="numeric" value={bags} onChange={(e) => setBags(liveFormatNumber(e.target.value))}
                        className={`${inputClass} ${bags === '' ? '!border-brand-amber' : ''}`} placeholder="0" />
                    </div>
                    <div>
                      <label className={labelClass}>Net Kilos</label>
                      <input type="text" inputMode="decimal" value={kilos} onChange={(e) => setKilos(liveFormatNumber(e.target.value, 3))}
                        className={`${inputClass} ${kilos === '' ? '!border-brand-amber' : ''}`} placeholder="0.000" />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Age</label>
                    <input type="text" inputMode="numeric" value={age} onChange={(e) => setAge(liveFormatNumber(e.target.value))}
                      className={`${inputClass} ${age === '' ? '!border-brand-amber' : ''}`} placeholder="0" />
                  </div>
                  <div>
                    <label className={labelClass}>Unit</label>
                    <select
                      value={ageUnit}
                      onChange={(e) => {
                        const nextUnit = e.target.value
                        if (age !== '' && nextUnit !== ageUnit) {
                          const numericAge = parseFormattedNumber(age)
                          const converted = nextUnit === 'Months' ? numericAge / 30 : numericAge * 30
                          setAge(liveFormatNumber(String(Math.round(converted * 100) / 100)))
                        }
                        setAgeUnit(nextUnit)
                      }}
                      className={inputClass}
                    >
                      {AGE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>As of</label>
                  <CalendarDatePicker value={asOfDate} onChange={setAsOfDate} />
                </div>
              </div>
            </>
          )}

          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Quality &amp; Dates</p>
          <div className="space-y-2">
            <div>
              <label className={labelClass}>Condition</label>
              <div className="mt-1 grid grid-cols-5 gap-1">
                {CONDITION_FLAGS.map((flag) => (
                  <button key={flag} type="button" onClick={() => setCondition(flag)}
                    className={`rounded-lg border py-1.5 text-xs font-medium transition-all active:scale-95 ${
                      condition === flag ? 'border-brand-neon bg-brand-neon/10 text-brand-neon' : 'border-neutral-800 bg-neutral-950 text-neutral-400'
                    }`}>
                    {flag}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Purity (optional)</label>
                <input type="text" value={purity} onChange={(e) => setPurity(e.target.value)} className={inputClass} placeholder="94%" />
              </div>
              <div>
                <label className={labelClass}>MC (optional)</label>
                <input type="text" value={moistureContent} onChange={(e) => setMoistureContent(e.target.value)} className={inputClass} placeholder="11.1" />
              </div>
            </div>
            <div>
              <label className={labelClass}>{category === 'Palay' ? 'Date Procured' : 'Date Received'} (optional)</label>
              <input type="text" value={dateProcured} onChange={(e) => setDateProcured(e.target.value)} className={inputClass} placeholder="MAR 24 TO APR 4, 2025" />
            </div>
          </div>

          {showHint && !canSave && <p className="mt-3 text-center text-xs text-brand-amber">Please complete all required fields.</p>}
        </div>

        <div className="border-t border-neutral-800 p-4">
          <button type="button" onClick={handleSubmit} disabled={isSaving} className={`w-full ${primaryButtonClass}`}>
            {isEditing ? 'Update Pile' : 'Create Pile'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CreateEditPileModal
