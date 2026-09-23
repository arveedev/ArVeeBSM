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
// exclusively owned by Beginning Balances, exactly as before. Rather
// than hiding that split, an edit shows the pile's live current stock
// as a read-only summary with an "Edit balance ->" link that closes
// this modal and opens EditBeginningBalanceModal.jsx for that same
// pile - see Settings.jsx's balanceModalPile wiring.
//
// The kebab menu (Export BIN Card / Close-Reopen / Delete) is ported
// straight from the old always-visible Beginning Balances pile list on
// Settings.jsx - that list is gone now (it duplicated this page's own
// PileListSection), so these pile-lifecycle actions live here instead,
// the other place a specific pile is already in hand.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, Check, AlertTriangle, MoreVertical } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { fmtBags, fmtWeight, todayLocalISO, liveFormatNumber, parseFormattedNumber } from '../../utils/calculations.js'
import { createPileWithBeginningBalance, recalculatePileCurrentState, closePile, reopenPile } from '../../utils/pileLedger.js'
import { generatePileBinCard } from '../../utils/pileBinCardGenerator.js'
import { inputClass, primaryButtonClass, byAlpha } from './admin/shared.js'
import { CONDITION_FLAGS } from '../forms/shared.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

const CATEGORIES = ['Rice', 'Palay', 'By Products']
const AGE_UNITS = ['Days', 'Months']

// Larger local sizing than the shared admin-panel default (labelClass/
// inputClass) - per explicit request to enlarge the font size inside
// this modal. inputClass itself sets no explicit font-size, so it
// renders at the ambient ~1rem (text-base-equivalent) default already -
// text-lg is the first size that's actually bigger than that.
const labelClassLg = 'text-sm text-neutral-400'
const inputClassLg = `${inputClass} text-lg`

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingCloseToggle, setPendingCloseToggle] = useState(null)
  const [closeDate, setCloseDate] = useState(todayLocalISO())
  const [isClosing, setIsClosing] = useState(false)
  // Must match animate-sheet-slide-down's own duration (index.css).
  const CLOSE_ANIMATION_MS = 300
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      onClose()
    }, CLOSE_ANIMATION_MS)
  }

  if (!open) return null

  const categoryVarieties = varieties.filter((v) => v.category === category).sort((a, b) => byAlpha(a.name, b.name))
  const tint = heroTint(category)
  const selectedVarietyName = category === 'By Products' ? null : varietyMap.get(varietyId)?.name

  // Checks for real transactions beyond the pile's own seed, purely to
  // inform the confirmation text below - never deleted, only mentioned.
  //
  // Confirmed, reported real bug: deleting a pile never removed or wrote
  // off its remaining stock - the pile RECORD went away, but every
  // report/balance that sums real transaction history had no way to know
  // that stock should stop counting, so it either got silently dropped
  // (the original bug) or, worse, kept counting forever as a permanent
  // phantom balance once that exclusion was removed (a real production
  // incident - a warehouse's reported stock jumped ~8-10x above its true
  // current total after exactly this). Close already does this correctly
  // - closePile() zeroes the balance and records closedDate ON THE STILL-
  // EXISTING pile record, which every balance calculation already knows
  // to respect - so a pile with real stock left must be Closed first,
  // never deleted outright. recalculatePileCurrentState (not the
  // possibly-stale pile.currentBags/currentKilos fields) is used here so
  // this check is never fooled by drift between saves.
  const confirmDelete = async () => {
    setMenuOpen(false)
    const { bags, kilos } = await recalculatePileCurrentState(pile.pileId)
    if (bags > 0 || kilos > 0.01) {
      toast.error('This pile still has stock on hand - Close it first (writes off the remaining balance correctly), then delete it.')
      return
    }
    const others = await db.transactions
      .where('pileId').equals(pile.pileId)
      .and((t) => !t.isInitialBalance)
      .count()
    setPendingDelete({ hasHistory: others > 0 })
  }

  // Deletes only the pile RECORD - never its transactions. Every WSR/
  // WSI/WTS ever recorded stays in the database forever, still linked
  // by pileId. Also clears any layout box still pointing at this pile.
  const handleDeleteConfirmed = async () => {
    setPendingDelete(null)
    const linkedBox = await db.pileLayoutBoxes.where('pileId').equals(pile.pileId).first()
    if (linkedBox) await db.pileLayoutBoxes.update(linkedBox.id, { pileId: null, label: null })
    await db.piles.delete(pile.pileId)
    toast.success(`Pile "${pile.pileName}" deleted - its transactions were kept`)
    handleClose()
  }

  const confirmCloseToggle = () => {
    setMenuOpen(false)
    setCloseDate(todayLocalISO())
    setPendingCloseToggle({ willClose: !pile.closedDate })
  }

  const handleCloseToggleConfirmed = async () => {
    const willClose = pendingCloseToggle?.willClose
    setPendingCloseToggle(null)
    if (!willClose) {
      await reopenPile(pile.pileId)
      toast.success(`Pile "${pile.pileName}" re-opened`)
    } else {
      await closePile(pile.pileId, closeDate)
      toast.success(`Pile "${pile.pileName}" closed`)
    }
    handleClose()
  }

  const handleExportBinCard = async () => {
    setMenuOpen(false)
    const warehouse = await db.warehouses.get(warehouseId)
    const branch = warehouse?.branchId ? await db.branches.get(warehouse.branchId) : null
    const variety = varietyMap.get(pile.varietyId)
    const sackTypes = await db.sackTypes.toArray()
    const allPileTransactions = await db.transactions.where('pileId').equals(pile.pileId).toArray()
    // WTS transfers reference issuedPileId/receivedPileId directly, not
    // pileId - fetch those separately so a transfer in/out of this pile
    // isn't missing from its ledger.
    const wtsTransfers = await db.transactions
      .where('type').equals('WTS')
      .and((t) => t.issuedPileId === pile.pileId || t.receivedPileId === pile.pileId)
      .toArray()
    const transactionTypes = await db.transactionTypes.toArray()
    const transactionTypeMap = new Map(transactionTypes.map((t) => [t.transactionTypeId, t.name]))
    const globalDataStartDate = (await db.reportConfig.get('global'))?.dataStartDate || null
    const doc = generatePileBinCard({
      warehouse, branch, pile, variety,
      transactions: [...allPileTransactions, ...wtsTransfers],
      transactionTypeMap,
      globalDataStartDate,
      varietyMap, sackTypeMap: new Map(sackTypes.map((s) => [s.sackTypeId, s])),
    })
    doc.save(`${pile.pileName.replace(/[^a-z0-9]+/gi, '-')}-BIN-Card.pdf`)
  }

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
      handleClose()
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
    handleClose()
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
    handleClose()
  }

  const handleSubmit = () => {
    if (!canSave) { setShowHint(true); return }
    isEditing ? handleUpdate() : handleCreate()
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[65] flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4 ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl border border-neutral-800 bg-neutral-900 sm:rounded-2xl ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero header - live display of the name being typed + a
            variety pill tinted to the cereal type, not itself an
            editable field (the real Pile Name/Category/Variety inputs
            stay normal boxed fields in the body below, matching the
            existing form exactly - only the header is new). Solid
            bg-neutral-900 base UNDER the tint (not just the modal
            card's own background showing through a bare gradient) -
            the backdrop behind the whole modal was reported as too
            visible through this header specifically, so it gets its
            own explicit opaque base same as the rest of the card. */}
        <div style={{ backgroundImage: `linear-gradient(135deg, ${tint.wash})` }} className="bg-neutral-900 px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-2xl font-extrabold text-app-text">{pileName.trim() || (isEditing ? pile.pileName : 'New Pile')}</p>
              <span className={`mt-1.5 inline-block rounded-full px-3 py-1 text-sm font-bold ${tint.pill}`}>
                {category === 'By Products' ? 'By Products' : selectedVarietyName ? `${category} · ${selectedVarietyName}` : `${category} · pick a variety`}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isEditing && (
                <div className="relative flex items-center">
                  <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="More options" className="flex items-center text-neutral-400 hover:text-app-text">
                    <MoreVertical size={18} />
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                      <div className="animate-popover-in absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-neutral-800 bg-neutral-900 py-1 text-left shadow-xl" style={{ transformOrigin: 'top right' }}>
                        <button type="button" onClick={handleExportBinCard} className="block w-full px-3 py-2 text-left text-base text-app-text hover:bg-neutral-800">
                          Export BIN Card
                        </button>
                        <button type="button" onClick={confirmCloseToggle} className="block w-full px-3 py-2 text-left text-base text-app-text hover:bg-neutral-800">
                          {pile.closedDate ? 'Re-open Pile' : 'Close Pile'}
                        </button>
                        <button type="button" onClick={confirmDelete} className="block w-full px-3 py-2 text-left text-base text-brand-crimson hover:bg-neutral-800">
                          Delete Pile
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Close/delete icons are always red, per house
                  convention - keeps the "this exits/removes" signal
                  consistent everywhere it appears. */}
              <button type="button" onClick={handleClose} aria-label="Close" className="flex items-center text-brand-crimson hover:brightness-125">
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isEditing && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Current Stock (live)</p>
              {/* Same stacked-tile card style as PileListSection's own
                  Bags/Net Kg pair, for visual consistency between the
                  two places a pile's live figures show up. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-neutral-950 py-2 text-center">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Bags</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtBags(pile.currentBags ?? 0)}</p>
                </div>
                <div className="rounded-lg bg-neutral-950 py-2 text-center">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Net Kg</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtWeight(pile.currentKilos ?? 0, weightUnit).replace(/\s*(kg|MT)$/, '')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { onGoToBalance?.(pile); onClose() }}
                className="mt-2 w-full rounded-lg bg-neutral-950 py-2 text-center text-base font-bold text-brand-neon transition-colors active:bg-neutral-800"
              >
                Edit balance
              </button>
            </div>
          )}

          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Identity</p>
          <div className="mb-4 space-y-2">
            <div>
              <label className={labelClassLg}>Pile Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={pileName}
                  onChange={(e) => { setPileName(e.target.value); setNameCheckStatus('idle') }}
                  onBlur={checkPileNameDuplicate}
                  className={`${inputClassLg} ${nameCheckStatus === 'ok' ? '!border-brand-neon' : nameCheckStatus === 'duplicate' ? '!border-brand-amber' : !pileName.trim() ? '!border-brand-amber' : ''} ${nameCheckStatus === 'ok' || nameCheckStatus === 'duplicate' ? 'pr-9' : ''}`}
                  placeholder="Pile C-1"
                  autoFocus
                />
                {nameCheckStatus === 'ok' && <Check size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-neon" />}
                {nameCheckStatus === 'duplicate' && <AlertTriangle size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-amber" />}
              </div>
              {nameCheckStatus === 'duplicate' && <p className="mt-1 text-sm text-brand-amber">This pile name is already used in this warehouse.</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClassLg}>Category</label>
                <select value={category} onChange={(e) => { setCategory(e.target.value); setVarietyId(''); setByProductBalances({}) }} className={inputClassLg}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClassLg}>Variety{category === 'By Products' ? ' (optional)' : ''}</label>
                <select
                  value={varietyId}
                  onChange={(e) => setVarietyId(e.target.value)}
                  className={`${inputClassLg} ${category !== 'By Products' && !varietyId ? '!border-brand-amber' : ''}`}
                >
                  <option value="">{category === 'By Products' ? 'Optional — accepts any' : 'Select…'}</option>
                  {categoryVarieties.map((v) => <option key={v.varietyId} value={v.varietyId}>{v.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {!isEditing && (
            <>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Quantity</p>
              <div className="mb-4 space-y-2">
                {category === 'By Products' ? (
                  <div className="space-y-2">
                    <p className="text-sm text-neutral-500">Beginning Balance by Variety (optional)</p>
                    {categoryVarieties.length === 0 && (
                      <p className="text-sm text-neutral-500">No By Products varieties configured yet — add one in the Admin Dashboard's Varieties tab first.</p>
                    )}
                    {categoryVarieties.map((v) => {
                      const line = byProductBalances[v.varietyId] ?? { bags: '', kilos: '' }
                      return (
                        <div key={v.varietyId} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5">
                          <p className="text-sm font-semibold text-neutral-400">{v.name}</p>
                          <div className="mt-1.5 grid grid-cols-2 gap-2">
                            <div>
                              <label className={labelClassLg}>Bags</label>
                              <input type="text" inputMode="numeric" value={line.bags}
                                onChange={(e) => updateByProductBalance(v.varietyId, 'bags', liveFormatNumber(e.target.value))}
                                className={inputClassLg} placeholder="0" />
                            </div>
                            <div>
                              <label className={labelClassLg}>Net Kilos</label>
                              <input type="text" inputMode="decimal" value={line.kilos}
                                onChange={(e) => updateByProductBalance(v.varietyId, 'kilos', liveFormatNumber(e.target.value, 3))}
                                className={inputClassLg} placeholder="0.000" />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelClassLg}>Bags</label>
                      <input type="text" inputMode="numeric" value={bags} onChange={(e) => setBags(liveFormatNumber(e.target.value))}
                        className={`${inputClassLg} ${bags === '' ? '!border-brand-amber' : ''}`} placeholder="0" />
                    </div>
                    <div>
                      <label className={labelClassLg}>Net Kilos</label>
                      <input type="text" inputMode="decimal" value={kilos} onChange={(e) => setKilos(liveFormatNumber(e.target.value, 3))}
                        className={`${inputClassLg} ${kilos === '' ? '!border-brand-amber' : ''}`} placeholder="0.000" />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassLg}>Age</label>
                    <input type="text" inputMode="numeric" value={age} onChange={(e) => setAge(liveFormatNumber(e.target.value))}
                      className={`${inputClassLg} ${age === '' ? '!border-brand-amber' : ''}`} placeholder="0" />
                  </div>
                  <div>
                    <label className={labelClassLg}>Unit</label>
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
                      className={inputClassLg}
                    >
                      {AGE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelClassLg}>As of</label>
                  <CalendarDatePicker value={asOfDate} onChange={setAsOfDate} />
                </div>
              </div>
            </>
          )}

          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Quality &amp; Dates</p>
          <div className="space-y-2">
            <div>
              <label className={labelClassLg}>Condition</label>
              <div className="mt-1 grid grid-cols-5 gap-1">
                {CONDITION_FLAGS.map((flag) => (
                  <button key={flag} type="button" onClick={() => setCondition(flag)}
                    className={`rounded-lg border py-1.5 text-sm font-medium transition-all active:scale-95 ${
                      condition === flag ? 'border-brand-neon bg-brand-neon/10 text-brand-neon' : 'border-neutral-800 bg-neutral-950 text-neutral-400'
                    }`}>
                    {flag}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClassLg}>Purity (optional)</label>
                <input type="text" value={purity} onChange={(e) => setPurity(e.target.value)} className={inputClassLg} placeholder="94%" />
              </div>
              <div>
                <label className={labelClassLg}>MC (optional)</label>
                <input type="text" value={moistureContent} onChange={(e) => setMoistureContent(e.target.value)} className={inputClassLg} placeholder="11.1" />
              </div>
            </div>
            <div>
              <label className={labelClassLg}>{category === 'Palay' ? 'Date Procured' : 'Date Received'} (optional)</label>
              <input type="text" value={dateProcured} onChange={(e) => setDateProcured(e.target.value)} className={inputClassLg} placeholder="MAR 24 TO APR 4, 2025" />
            </div>
          </div>

          {showHint && !canSave && <p className="mt-3 text-center text-sm text-brand-amber">Please complete all required fields.</p>}
        </div>

        {/* pb includes the device's own safe-area inset (home-indicator
            area on mobile) - without it the button sat flush against
            that zone on phones, uncomfortably close to the edge. */}
        <div className="border-t border-neutral-800 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={handleSubmit} disabled={isSaving} className={`w-full text-base ${primaryButtonClass}`}>
            {isEditing ? 'Update Pile' : 'Create Pile'}
          </button>
        </div>
      </div>

      {isEditing && (
        <>
          <ConfirmDialog
            open={Boolean(pendingDelete)}
            title={`Delete pile "${pile.pileName}"?`}
            description={
              pendingDelete?.hasHistory
                ? 'This pile has real transactions beyond its beginning balance - those transactions are NOT deleted and stay in the system permanently, still linked to this pile ID. Only the pile record itself (and its layout box, if any) is removed. This cannot be undone.'
                : 'This cannot be undone.'
            }
            onConfirm={handleDeleteConfirmed}
            onCancel={() => setPendingDelete(null)}
          />

          <ConfirmDialog
            open={Boolean(pendingCloseToggle)}
            title={pendingCloseToggle?.willClose ? `Close pile "${pile.pileName}"?` : `Re-open pile "${pile.pileName}"?`}
            description={
              pendingCloseToggle?.willClose
                ? 'This zeroes out its remaining balance and vacates its layout box (if any) immediately. Its full history stays exportable as a BIN Card.'
                : 'This restores its live balance from its full transaction history. Note: it does not automatically get a box back on the layout - it must be re-placed like a new pile if it needs one.'
            }
            confirmLabel={pendingCloseToggle?.willClose ? 'Close' : 'Re-open'}
            onConfirm={handleCloseToggleConfirmed}
            onCancel={() => setPendingCloseToggle(null)}
          >
            {pendingCloseToggle?.willClose && (
              <div className="text-left">
                <label className={labelClassLg}>Close Date</label>
                <CalendarDatePicker value={closeDate} label="Close Date" onChange={setCloseDate} />
              </div>
            )}
          </ConfirmDialog>
        </>
      )}
    </div>,
    document.body
  )
}

export default CreateEditPileModal
