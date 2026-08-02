// Beginning Balances - a genuinely separate management area from both
// the Create/Edit Pile card (pile metadata + new pile creation) and
// the live Piles/Home views. This is the ONLY place an existing
// pile's or sack's beginning balance figures get corrected, so a
// correction here can never be confused with (or accidentally
// overwrite) live, transaction-accumulated stock.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useWarehouse } from '../../../context/WarehouseContext.jsx'
import { useSettings } from '../../../context/SettingsContext.jsx'
import {
  fmtBags, fmtWeight, liveFormatNumber, parseFormattedNumber,
  normalizeAgeToDays, todayLocalISO,
} from '../../../utils/calculations.js'
import { recalculatePileCurrentState } from '../../../utils/pileLedger.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import {
  inputClass, labelClass, primaryButtonClass, secondaryButtonClass,
  listItemClass, editIconClass, deleteIconClass, byAlpha, SACK_CONDITIONS,
} from './shared.js'

const AGE_UNITS = ['Days', 'Months']

function PilesBeginningBalances({ warehouseId }) {
  const { weightUnit } = useSettings() ?? {}
  const [editingPileId, setEditingPileId] = useState(null)
  const [bags, setBags] = useState('')
  const [kilos, setKilos] = useState('')
  const [age, setAge] = useState('')
  const [ageUnit, setAgeUnit] = useState('Days')
  const [asOfDate, setAsOfDate] = useState(todayLocalISO())
  const [isSaving, setIsSaving] = useState(false)

  const piles = useLiveQuery(
    () => (warehouseId ? db.piles.where('warehouseId').equals(warehouseId).toArray() : []),
    [warehouseId]
  ) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sortedPiles = [...piles].sort((a, b) => byAlpha(a.pileName, b.pileName))

  const resetForm = () => {
    setEditingPileId(null)
    setBags('')
    setKilos('')
    setAge('')
    setAgeUnit('Days')
    setAsOfDate(todayLocalISO())
  }

  const handleEdit = async (pile) => {
    const seed = await db.transactions
      .where('pileId').equals(pile.pileId)
      .and((t) => t.isInitialBalance)
      .first()
    setEditingPileId(pile.pileId)
    setBags(liveFormatNumber(String(seed?.numberOfBags ?? 0)))
    setKilos(liveFormatNumber(String(seed?.netKilos ?? 0), 3))
    setAge(liveFormatNumber(String(pile.initialAgeValue ?? 0)))
    setAgeUnit('Days')
    setAsOfDate(seed?.date ?? pile.dateOfReceipt ?? todayLocalISO())
  }

  const handleSave = async () => {
    if (!editingPileId) return
    setIsSaving(true)
    const newBags = bags === '' ? 0 : parseFormattedNumber(bags)
    const newKilos = kilos === '' ? 0 : parseFormattedNumber(kilos)
    const newAgeDays = age === '' ? 0 : normalizeAgeToDays(parseFormattedNumber(age), ageUnit)

    await db.piles.update(editingPileId, { initialAgeValue: newAgeDays, dateOfReceipt: asOfDate })

    const seed = await db.transactions
      .where('pileId').equals(editingPileId)
      .and((t) => t.isInitialBalance)
      .first()

    if (seed) {
      await db.transactions.update(seed.id, { date: asOfDate, numberOfBags: newBags, grossKilos: newKilos, netKilos: newKilos })
    } else if (newBags > 0 || newKilos > 0) {
      const pile = piles.find((p) => p.pileId === editingPileId)
      await db.transactions.add({
        id: crypto.randomUUID(), type: 'WSR', serialNo: `INIT-${editingPileId.slice(0, 8)}`,
        status: 'Active', date: asOfDate, warehouseId,
        pileId: editingPileId, varietyId: pile?.varietyId ?? null,
        numberOfBags: newBags, grossKilos: newKilos, netKilos: newKilos,
        moistureContent: null, customerName: 'Beginning Balance',
        isInitialBalance: true, isSynced: false,
      })
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

  return (
    <div>
      {editingPileId && (
        <div className="mb-3 space-y-2 rounded-xl border border-brand-amber/40 bg-brand-amber/5 p-3">
          <p className="text-xs font-semibold text-brand-amber">
            Editing beginning balance: {piles.find((p) => p.pileId === editingPileId)?.pileName}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Bags</label>
              <input type="text" inputMode="numeric" value={bags} onChange={(e) => setBags(liveFormatNumber(e.target.value))} className={inputClass} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Net Kilos</label>
              <input type="text" inputMode="decimal" value={kilos} onChange={(e) => setKilos(liveFormatNumber(e.target.value, 3))} className={inputClass} placeholder="0.000" />
            </div>
          </div>
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
          <div>
            <label className={labelClass}>As of</label>
            <CalendarDatePicker value={asOfDate} onChange={setAsOfDate} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={isSaving} className={`flex-1 ${primaryButtonClass}`}>Save</button>
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="space-y-1.5">
        {sortedPiles.length === 0 && <p className="py-3 text-center text-xs text-neutral-500">No piles in this warehouse yet.</p>}
        {sortedPiles.map((p) => (
          <li key={p.pileId} className={listItemClass}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-app-text">
                {p.pileName} <span className="text-xs text-neutral-500">{varietyMap.get(p.varietyId)?.name ?? ''}</span>
              </p>
              <p className="text-xs text-neutral-500">{fmtBags(p.currentBags)} bags · {fmtWeight(p.currentKilos ?? 0, weightUnit, 'Net')} (live)</p>
            </div>
            <button type="button" onClick={() => handleEdit(p)} aria-label="Edit beginning balance" className={editIconClass}>
              <Pencil size={20} />
            </button>
          </li>
        ))}
      </ul>
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
      <div className="mb-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
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

function BeginningBalancesPanel() {
  const { accessibleWarehouses, currentWarehouseId, setCurrentWarehouseId } = useWarehouse() ?? {}
  const [tab, setTab] = useState('piles')
  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Beginning Balances</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Corrects a pile's or sack's starting figures directly - separate from creating new
        piles/sacks and from the live Piles/Home views, so a correction here never gets
        confused with live, transaction-accumulated stock.
      </p>

      {sortedWarehouses.length > 1 && (
        <select
          value={currentWarehouseId ?? ''}
          onChange={(e) => setCurrentWarehouseId?.(e.target.value)}
          className={`mt-3 ${inputClass}`}
        >
          {sortedWarehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
        </select>
      )}

      <div className="mt-3 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-1">
        <button type="button" onClick={() => setTab('piles')} className={`flex-1 rounded-lg py-2 text-sm font-medium ${tab === 'piles' ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}>Piles</button>
        <button type="button" onClick={() => setTab('sacks')} className={`flex-1 rounded-lg py-2 text-sm font-medium ${tab === 'sacks' ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}>Sacks</button>
      </div>

      <div className="mt-3">
        {tab === 'piles'
          ? <PilesBeginningBalances warehouseId={currentWarehouseId} />
          : <SacksBeginningBalances warehouseId={currentWarehouseId} />}
      </div>
    </section>
  )
}

export default BeginningBalancesPanel
