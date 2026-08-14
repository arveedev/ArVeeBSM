// Beginning Balances - a genuinely separate management area from both
// the Create/Edit Pile card (pile metadata + new pile creation) and
// the live Piles/Home views. This is the ONLY place an existing
// pile's or sack's beginning balance figures get corrected, so a
// correction here can never be confused with (or accidentally
// overwrite) live, transaction-accumulated stock.

import { useState, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2, MoreVertical, Plus, X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useWarehouse } from '../../../context/WarehouseContext.jsx'
import { useSettings } from '../../../context/SettingsContext.jsx'
import {
  fmtBags, fmtWeight, liveFormatNumber, parseFormattedNumber,
  normalizeAgeToDays, todayLocalISO,
} from '../../../utils/calculations.js'
import { recalculatePileCurrentState, closePile, reopenPile } from '../../../utils/pileLedger.js'
import { generatePileBinCard } from '../../../utils/pileBinCardGenerator.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import {
  inputClass, labelClass, primaryButtonClass, secondaryButtonClass,
  listItemClass, editIconClass, deleteIconClass, byAlpha, SACK_CONDITIONS,
} from './shared.js'
import { CONDITION_FLAGS } from '../../forms/shared.js'

const AGE_UNITS = ['Days', 'Months']

// One beginning-balance line = one seed (isInitialBalance) transaction. A
// pile groups by variety, not by sack weight - it can legitimately have had
// two different real sack weights in its beginning-balance history at once,
// so this must be a repeatable list rather than one flat value per pile.
const emptyLine = () => ({
  txId: null, bags: '', kilos: '', condition: 'GQ', dateReceived: todayLocalISO(),
  purity: '', moistureContent: '', mtsSackTypeId: '', mtsCondition: '',
})

function PilesBeginningBalances({ warehouseId }) {
  const { weightUnit } = useSettings() ?? {}
  const [editingPileId, setEditingPileId] = useState(null)
  const [lines, setLines] = useState([emptyLine()])
  const [originalSeedIds, setOriginalSeedIds] = useState([])
  const [age, setAge] = useState('')
  const [ageUnit, setAgeUnit] = useState('Days')
  const [isSaving, setIsSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [openMenuPileId, setOpenMenuPileId] = useState(null)
  const formRef = useRef(null)

  const piles = useLiveQuery(
    () => (warehouseId ? db.piles.where('warehouseId').equals(warehouseId).toArray() : []),
    [warehouseId]
  ) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sortedPiles = [...piles].sort((a, b) => byAlpha(a.pileName, b.pileName))

  // Sack types, used to resolve each pile's MTS (empty-sack tare) weight -
  // matched against the sack-weight bucket that Reports.jsx/pdfGenerator.js
  // fall back to for transactions with no MTS of their own.
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const editingPile = piles.find((p) => p.pileId === editingPileId)
  const editingCategory = varietyMap.get(editingPile?.varietyId)?.category
  const sackTypesForCategory = sackTypes
    .filter((s) => s.category === editingCategory)
    .sort((a, b) => byAlpha(a.code, b.code))

  const resetForm = () => {
    setEditingPileId(null)
    setLines([emptyLine()])
    setOriginalSeedIds([])
    setAge('')
    setAgeUnit('Days')
  }

  const handleEdit = async (pile) => {
    const seeds = await db.transactions
      .where('pileId').equals(pile.pileId)
      .and((t) => t.isInitialBalance)
      .toArray()
    setEditingPileId(pile.pileId)
    setOriginalSeedIds(seeds.map((s) => s.id))
    setLines(seeds.length
      ? seeds.map((s) => ({
          txId: s.id,
          bags: liveFormatNumber(String(s.numberOfBags ?? 0)),
          kilos: liveFormatNumber(String(s.netKilos ?? 0), 3),
          condition: s.condition ?? 'GQ',
          dateReceived: s.date ?? pile.dateOfReceipt ?? todayLocalISO(),
          purity: s.purity ?? '',
          moistureContent: s.moistureContent != null ? liveFormatNumber(String(s.moistureContent)) : '',
          mtsSackTypeId: s.mtsSackTypeId ?? '',
          mtsCondition: s.mtsCondition ?? '',
        }))
      : [emptyLine()])
    // The app only stores the normalized days value, not which unit it
    // was originally entered in - previously this always hardcoded
    // 'Days' regardless, meaning a pile entered in Months would show
    // back as a large Days number every time it was re-edited. This
    // heuristic guesses Months when the value divides evenly by 30
    // (the exact conversion ratio used elsewhere), which is by far the
    // most likely case for anything actually entered in Months.
    const storedDays = pile.initialAgeValue ?? 0
    setAgeUnit(storedDays > 0 && storedDays % 30 === 0 ? 'Months' : 'Days')
    setAge(liveFormatNumber(String(
      storedDays > 0 && storedDays % 30 === 0 ? storedDays / 30 : storedDays
    )))
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  const updateLine = (index, field, value) => {
    setLines((rows) => rows.map((row, i) => {
      if (i !== index) return row
      const next = { ...row, [field]: value }
      if (field === 'mtsSackTypeId') next.mtsCondition = ''
      return next
    }))
  }
  const addLine = () => setLines((rows) => [...rows, emptyLine()])
  const removeLine = (index) => setLines((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))

  const handleSave = async () => {
    if (!editingPileId) return
    setIsSaving(true)
    const newAgeDays = age === '' ? 0 : normalizeAgeToDays(parseFormattedNumber(age), ageUnit)
    const first = lines[0]

    // Pile-level condition/purity/moisture/MTS are read elsewhere purely as
    // display/prefill defaults (Piles.jsx, pileLayoutPdfGenerator.js,
    // StockFormBase.jsx) - no longer authoritative for beginning-balance
    // reporting now that a pile can have multiple lines, but they still need
    // *some* sane value, so source them from the first line.
    await db.piles.update(editingPileId, {
      initialAgeValue: newAgeDays,
      dateOfReceipt: first?.dateReceived || todayLocalISO(),
      condition: first?.condition || 'GQ',
      purity: first?.purity?.trim() || null,
      moistureContent: first?.moistureContent === '' || first?.moistureContent == null
        ? null : parseFloat(parseFormattedNumber(first.moistureContent).toFixed(2)),
      mtsSackTypeId: first?.mtsSackTypeId || null,
      mtsCondition: first?.mtsSackTypeId ? (first.mtsCondition || null) : null,
    })

    const pile = piles.find((p) => p.pileId === editingPileId)
    const survivingTxIds = new Set()

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const newBags = line.bags === '' ? 0 : parseFormattedNumber(line.bags)
      const newKilos = line.kilos === '' ? 0 : parseFormattedNumber(line.kilos)
      const seedFields = {
        condition: line.condition,
        purity: line.purity.trim() || null,
        moistureContent: line.moistureContent === '' ? null : parseFloat(parseFormattedNumber(line.moistureContent).toFixed(2)),
        mtsSackTypeId: line.mtsSackTypeId || null,
        mtsCondition: line.mtsSackTypeId ? (line.mtsCondition || null) : null,
      }

      if (line.txId) {
        survivingTxIds.add(line.txId)
        await db.transactions.update(line.txId, { date: line.dateReceived, numberOfBags: newBags, grossKilos: newKilos, netKilos: newKilos, ...seedFields })
      } else if (newBags > 0 || newKilos > 0) {
        await db.transactions.add({
          id: crypto.randomUUID(), type: 'WSR', serialNo: `INIT-${editingPileId.slice(0, 8)}-${i + 1}`,
          status: 'Active', date: line.dateReceived, warehouseId,
          pileId: editingPileId, varietyId: pile?.varietyId ?? null,
          numberOfBags: newBags, grossKilos: newKilos, netKilos: newKilos,
          customerName: 'Beginning Balance',
          isInitialBalance: true, isSynced: false,
          ...seedFields,
        })
      }
    }

    // Lines removed via the remove-line button never make it into
    // survivingTxIds - delete their now-orphaned seed transactions.
    for (const id of originalSeedIds) {
      if (!survivingTxIds.has(id)) await db.transactions.delete(id)
    }

    // Never set the live totals directly from the form - always
    // re-derive them fresh from the complete ledger (seed + every
    // transaction since), so correcting a beginning balance can never
    // silently discard real activity that happened after it.
    await recalculatePileCurrentState(editingPileId)

    toast.success('Beginning balance updated')
    resetForm()
    setIsSaving(false)
  }

  // Checks for real transactions beyond the pile's own seed, to warn
  // before deleting rather than silently orphaning transaction history.
  const confirmDelete = async (pile) => {
    const others = await db.transactions
      .where('pileId').equals(pile.pileId)
      .and((t) => !t.isInitialBalance)
      .count()
    setPendingDelete({ ...pile, hasHistory: others > 0 })
  }

  const handleDeleteConfirmed = async () => {
    const pile = pendingDelete
    setPendingDelete(null)
    const linked = await db.transactions.where('pileId').equals(pile.pileId).toArray()
    for (const t of linked) await db.transactions.delete(t.id)
    await db.piles.delete(pile.pileId)
    toast.success(`Pile "${pile.pileName}" deleted`)
    if (editingPileId === pile.pileId) resetForm()
  }

  const handleToggleClosePile = async (pile) => {
    setOpenMenuPileId(null)
    if (pile.closedDate) {
      await reopenPile(pile.pileId)
      toast.success(`Pile "${pile.pileName}" re-opened`)
    } else {
      await closePile(pile.pileId)
      toast.success(`Pile "${pile.pileName}" closed`)
    }
  }

  const handleExportBinCard = async (pile) => {
    setOpenMenuPileId(null)
    const warehouse = await db.warehouses.get(warehouseId)
    const branch = warehouse?.branchId ? await db.branches.get(warehouse.branchId) : null
    const variety = varietyMap.get(pile.varietyId)
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
    const doc = generatePileBinCard({
      warehouse, branch, pile, variety,
      transactions: [...allPileTransactions, ...wtsTransfers],
      transactionTypeMap,
    })
    doc.save(`${pile.pileName.replace(/[^a-z0-9]+/gi, '-')}-BIN-Card.pdf`)
  }

  return (
    <div>
      {editingPileId && (
        <div ref={formRef} className="mb-3 space-y-2 rounded-xl border border-brand-amber/40 bg-brand-amber/5 p-3">
          <p className="text-xs font-semibold text-brand-amber">
            Editing beginning balance: {piles.find((p) => p.pileId === editingPileId)?.pileName}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Age</label>
              <input type="text" inputMode="numeric" value={age} onChange={(e) => setAge(liveFormatNumber(e.target.value))} className={inputClass} placeholder="0" />
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
          {lines.map((line, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-neutral-400">Line {i + 1}</p>
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(i)} aria-label="Remove line" className="rounded-lg p-1 text-neutral-500 hover:text-red-400 active:scale-90">
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Bags</label>
                  <input type="text" inputMode="numeric" value={line.bags} onChange={(e) => updateLine(i, 'bags', liveFormatNumber(e.target.value))} className={inputClass} placeholder="0" />
                </div>
                <div>
                  <label className={labelClass}>Net Kilos</label>
                  <input type="text" inputMode="decimal" value={line.kilos} onChange={(e) => updateLine(i, 'kilos', liveFormatNumber(e.target.value, 3))} className={inputClass} placeholder="0.000" />
                </div>
              </div>
              <div>
                <label className={labelClass}>Date Received</label>
                <CalendarDatePicker value={line.dateReceived} onChange={(v) => updateLine(i, 'dateReceived', v)} />
              </div>
              <div>
                <label className={labelClass}>Condition</label>
                <div className="mt-1 grid grid-cols-5 gap-1">
                  {CONDITION_FLAGS.map((flag) => (
                    <button key={flag} type="button" onClick={() => updateLine(i, 'condition', flag)}
                      className={`rounded-lg border py-1.5 text-xs font-medium transition-all active:scale-95 ${
                        line.condition === flag ? 'border-brand-neon bg-brand-neon/10 text-brand-neon' : 'border-neutral-800 bg-neutral-900 text-neutral-400'
                      }`}>
                      {flag}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Sack Weight / MTS (optional)</label>
                  <select
                    value={line.mtsSackTypeId}
                    onChange={(e) => updateLine(i, 'mtsSackTypeId', e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Unset (use pile's own if any)</option>
                    {sackTypesForCategory.map((s) => (
                      <option key={s.sackTypeId} value={s.sackTypeId}>{s.code}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Sack Condition</label>
                  <select
                    value={line.mtsCondition}
                    onChange={(e) => updateLine(i, 'mtsCondition', e.target.value)}
                    disabled={!line.mtsSackTypeId}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    {SACK_CONDITIONS.map(({ code: cc, label }) => (
                      <option key={cc} value={cc}>{label} ({cc})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Purity (optional)</label>
                  <input type="text" value={line.purity} onChange={(e) => updateLine(i, 'purity', e.target.value)}
                    className={inputClass} placeholder="94%" />
                </div>
                <div>
                  <label className={labelClass}>MC (optional)</label>
                  <input type="text" value={line.moistureContent} onChange={(e) => updateLine(i, 'moistureContent', liveFormatNumber(e.target.value))}
                    className={inputClass} placeholder="11.1" />
                </div>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-neutral-500">
            Add a separate line for each distinct sack weight/condition this pile's
            beginning balance actually had - each becomes its own report row.
          </p>
          <button type="button" onClick={addLine} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-700 py-1.5 text-xs font-medium text-neutral-400 hover:border-brand-neon hover:text-brand-neon">
            <Plus size={14} /> Add line
          </button>

          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={isSaving} className={`flex-1 ${primaryButtonClass}`}>Save</button>
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="space-y-1.5">
        {sortedPiles.length === 0 && <p className="py-3 text-center text-xs text-neutral-500">No piles in this warehouse yet.</p>}
        {sortedPiles.map((p) => (
          <li key={p.pileId} className={`${listItemClass} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2`}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-app-text">
                {p.pileName} <span className="text-xs text-neutral-500">{varietyMap.get(p.varietyId)?.name ?? ''}</span>
                {p.closedDate && <span className="ml-1 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">CLOSED</span>}
              </p>
              <p className="text-xs text-neutral-500">{fmtBags(p.currentBags)} bags · {fmtWeight(p.currentKilos ?? 0, weightUnit, 'Net')} (live)</p>
            </div>
            <div className="relative flex items-center gap-1">
              <button type="button" onClick={() => handleEdit(p)} aria-label="Edit beginning balance" className={editIconClass}>
                <Pencil size={20} />
              </button>
              <button type="button" onClick={() => confirmDelete(p)} aria-label="Delete" className={deleteIconClass}>
                <Trash2 size={20} />
              </button>
              <button
                type="button"
                onClick={() => setOpenMenuPileId((current) => (current === p.pileId ? null : p.pileId))}
                aria-label="More options"
                className="rounded-lg p-2 text-neutral-400 transition-all hover:text-app-text active:scale-90"
              >
                <MoreVertical size={20} />
              </button>
              {openMenuPileId === p.pileId && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenMenuPileId(null)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-neutral-800 bg-neutral-900 py-1 shadow-xl">
                    <button type="button" onClick={() => handleExportBinCard(p)} className="block w-full px-3 py-2 text-left text-sm text-app-text hover:bg-neutral-800">
                      Export BIN Card
                    </button>
                    <button type="button" onClick={() => handleToggleClosePile(p)} className="block w-full px-3 py-2 text-left text-sm text-app-text hover:bg-neutral-800">
                      {p.closedDate ? 'Re-open Pile' : 'Close Pile'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete pile "${pendingDelete?.pileName}"?`}
        description={
          pendingDelete?.hasHistory
            ? 'This pile has real transactions beyond its beginning balance - deleting it will orphan those transactions in reports. This cannot be undone.'
            : 'This cannot be undone.'
        }
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function SacksBeginningBalances({ warehouseId }) {
  const [sackTypeId, setSackTypeId] = useState('')
  const [condition, setCondition] = useState('')
  const [pieces, setPieces] = useState('')
  const [asOfDate, setAsOfDate] = useState(todayLocalISO())
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const formRef = useRef(null)

  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const entries = useLiveQuery(
    () => (warehouseId ? db.sackInventory.where('warehouseId').equals(warehouseId).toArray() : []),
    [warehouseId]
  ) ?? []
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))
  const sortedEntries = [...entries].sort((a, b) =>
    byAlpha(sackTypeMap.get(a.sackTypeId)?.code, sackTypeMap.get(b.sackTypeId)?.code) || byAlpha(a.condition, b.condition)
  )

  const isCovered = (stId, cond) => entries.some((e) => e.sackTypeId === stId && e.condition === cond && e.id !== editingId)
  const selectableSackTypes = [...sackTypes].sort((a, b) => byAlpha(a.code, b.code))
    .filter((st) => SACK_CONDITIONS.some((c) => !isCovered(st.sackTypeId, c.code)))
  const selectableConditions = sackTypeId ? SACK_CONDITIONS.filter((c) => !isCovered(sackTypeId, c.code)) : SACK_CONDITIONS

  const resetForm = () => {
    setSackTypeId(''); setCondition(''); setPieces(''); setAsOfDate(todayLocalISO()); setEditingId(null)
  }

  const handleEdit = (entry) => {
    setEditingId(entry.id)
    setSackTypeId(entry.sackTypeId)
    setCondition(entry.condition)
    setPieces(liveFormatNumber(String(entry.pieces)))
    setAsOfDate(entry.asOfDate ?? todayLocalISO())
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  const handleSave = async () => {
    if (!sackTypeId || !condition || pieces === '') {
      toast.error('Sack type, condition, and pieces are all required')
      return
    }
    const existing = entries.find((e) => e.sackTypeId === sackTypeId && e.condition === condition && e.id !== editingId)
    if (existing) {
      toast.error('A beginning balance for that sack type and condition already exists')
      return
    }
    if (editingId) {
      await db.sackInventory.update(editingId, { sackTypeId, condition, pieces: parseFormattedNumber(pieces), asOfDate })
      toast.success('Beginning balance updated')
    } else {
      await db.sackInventory.add({ id: crypto.randomUUID(), warehouseId, sackTypeId, condition, pieces: parseFormattedNumber(pieces), asOfDate })
      toast.success('Beginning balance saved')
    }
    resetForm()
  }

  return (
    <div>
      <div ref={formRef} className="mb-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Sack Type</label>
            <select value={sackTypeId} onChange={(e) => { setSackTypeId(e.target.value); setCondition('') }} className={inputClass}>
              <option value="">Select…</option>
              {selectableSackTypes.map((st) => <option key={st.sackTypeId} value={st.sackTypeId}>{st.code}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Condition</label>
            <select value={condition} onChange={(e) => setCondition(e.target.value)} className={inputClass}>
              <option value="">Select…</option>
              {selectableConditions.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>Pieces</label>
          <input type="text" inputMode="numeric" value={pieces} onChange={(e) => setPieces(liveFormatNumber(e.target.value))} className={inputClass} placeholder="0" />
        </div>
        <div>
          <label className={labelClass}>As of</label>
          <CalendarDatePicker value={asOfDate} onChange={setAsOfDate} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>{editingId ? 'Update' : 'Save'}</button>
          {editingId && <button type="button" onClick={resetForm} className={secondaryButtonClass}>Cancel</button>}
        </div>
      </div>

      <ul className="space-y-1.5">
        {sortedEntries.length === 0 && <p className="py-3 text-center text-xs text-neutral-500">No sack beginning balances in this warehouse yet.</p>}
        {sortedEntries.map((e) => (
          <li key={e.id} className={listItemClass}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-app-text">{sackTypeMap.get(e.sackTypeId)?.code ?? '?'} · {e.condition}</p>
              <p className="text-xs text-neutral-500">{fmtBags(e.pieces)} pcs{e.asOfDate ? ` · as of ${e.asOfDate}` : ''}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => handleEdit(e)} aria-label="Edit" className={editIconClass}><Pencil size={20} /></button>
              <button type="button" onClick={() => setPendingDelete(e)} aria-label="Delete" className={deleteIconClass}><Trash2 size={20} /></button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this beginning balance?"
        description="This cannot be undone."
        onConfirm={async () => { await db.sackInventory.delete(pendingDelete.id); setPendingDelete(null); toast.success('Deleted') }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function BeginningBalancesPanel({ warehouseId: externalWarehouseId } = {}) {
  const { accessibleWarehouses, currentWarehouseId, setCurrentWarehouseId } = useWarehouse() ?? {}
  const [tab, setTab] = useState('piles')
  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  // When an external warehouseId is supplied (e.g. Settings.jsx already
  // has its own page-level warehouse selector), use it directly and
  // skip this panel's own internal selector entirely - showing two
  // warehouse pickers on the same page would be confusing.
  const effectiveWarehouseId = externalWarehouseId ?? currentWarehouseId

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-center text-base font-semibold text-app-text">Beginning Balances</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Corrects a pile's or sack's starting figures directly - separate from creating new
        piles/sacks and from the live Piles/Home views, so a correction here never gets
        confused with live, transaction-accumulated stock.
      </p>

      {!externalWarehouseId && sortedWarehouses.length > 1 && (
        <select
          value={currentWarehouseId ?? ''}
          onChange={(e) => setCurrentWarehouseId?.(e.target.value)}
          className={`mt-3 ${inputClass}`}
        >
          {sortedWarehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
        </select>
      )}

      <div>
      <div className="relative mt-3 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: tab === 'piles' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        <button type="button" onClick={() => setTab('piles')} className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium ${tab === 'piles' ? 'text-brand-contrast' : 'text-neutral-400'}`}>Piles</button>
        <button type="button" onClick={() => setTab('sacks')} className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium ${tab === 'sacks' ? 'text-brand-contrast' : 'text-neutral-400'}`}>Sacks</button>
      </div>

      <div className="mt-3 animate-flow-down" key={tab}>
        {tab === 'piles'
          ? <PilesBeginningBalances warehouseId={effectiveWarehouseId} />
          : <SacksBeginningBalances warehouseId={effectiveWarehouseId} />}
      </div>
      </div>
    </section>
  )
}

export default BeginningBalancesPanel
