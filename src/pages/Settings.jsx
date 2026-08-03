// Settings — client configuration toggles, session profile, logout, and
// per-warehouse sack beginning balance entry.

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2, ShieldCheck, MoreVertical } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { db } from '../db/dexie.js'
import { fmtBags, fmtWeight, todayLocalISO, liveFormatNumber, parseFormattedNumber } from '../utils/calculations.js'
import { createPileWithBeginningBalance, recalculatePileCurrentState, closePile, reopenPile } from '../utils/pileLedger.js'
import { generatePileBinCard } from '../utils/pileBinCardGenerator.js'
import { inputClass, labelClass, primaryButtonClass, byAlpha } from '../components/common/admin/shared.js'
import { CONDITION_FLAGS } from '../components/forms/shared.js'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import CalendarDatePicker from '../components/common/CalendarDatePicker.jsx'
import BeginningBalancesPanel from '../components/common/admin/BeginningBalancesPanel.jsx'
import ValidatedField from '../components/forms/ValidatedField.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'

const CATEGORIES = ['Rice', 'Palay', 'By Products']
const AGE_UNITS = ['Days', 'Months']

function Toggle({ label, description, value, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-app-text">{label}</p>
        {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-brand-neon' : 'bg-neutral-700'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-neutral-950 shadow transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

// Classifier is a signatory-only name (not a login user) shown as
// "Prepared by" on the Pile Layout report. Any user with access to this
// warehouse can set it, not just admins.
function ClassifierSection({ warehouseId }) {
  const [name, setName] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const warehouse = useLiveQuery(() => db.warehouses.get(warehouseId), [warehouseId])
  const savedName = warehouse?.classifierName ?? ''

  useEffect(() => {
    setName(savedName)
    // A saved name displays as a read-only row (with Edit/Delete); an
    // empty one always shows the input directly, so there's no
    // reason to sit in "edit mode" once a name is actually present.
    setIsEditing(!savedName)
  }, [savedName])

  const handleSave = async () => {
    setIsSaving(true)
    await db.warehouses.update(warehouseId, { classifierName: name.trim() || null })
    toast.success(savedName ? 'Classifier updated' : 'Classifier saved')
    setIsSaving(false)
    setIsEditing(false)
  }

  const handleDeleteConfirmed = async () => {
    setConfirmingDelete(false)
    await db.warehouses.update(warehouseId, { classifierName: null })
    toast.success('Classifier removed')
  }

  const showInput = isEditing || !savedName

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-app-text">Classifier</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Shown as "Prepared by" on this warehouse's Pile Layout report.
      </p>

      {showInput ? (
        <>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`flex-1 ${inputClass} ${!name.trim() ? '!border-brand-amber' : ''}`}
              placeholder="Full name"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              className={`rounded-xl px-4 text-sm font-semibold transition-all ${
                name.trim() ? 'border border-brand-neon text-brand-neon' : 'border border-brand-neon/40 text-brand-neon/40'
              }`}
            >
              {savedName ? 'Update' : 'Save'}
            </button>
          </div>
          {!name.trim() && (
            <p className="mt-1 text-xs text-brand-amber">A classifier name is needed.</p>
          )}
        </>
      ) : (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
          <span className="text-sm text-app-text">{savedName}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIsEditing(true)} aria-label="Edit" className="rounded-lg p-2 text-neutral-400 transition-all hover:text-app-text active:scale-90">
              <Pencil size={20} />
            </button>
            <button type="button" onClick={() => setConfirmingDelete(true)} aria-label="Delete" className="rounded-lg p-2 text-neutral-400 transition-all hover:text-brand-crimson active:scale-90">
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title="Remove this classifier?"
        description="This cannot be undone."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  )
}

// Creates a pile with a beginning balance directly - for onboarding a
// warehouse that already has physical stock, without a WSR transaction
// that would incorrectly show up as a receipt in reports.
function PileBalanceSection({ warehouseId }) {
  const { headerHeight, stickyIndicatorHeight } = usePageHeader() ?? {}
  const { weightUnit } = useSettings() ?? {}
  const [pileName, setPileName] = useState('')
  const [category, setCategory] = useState('Rice')
  const [varietyId, setVarietyId] = useState('')
  const [bags, setBags] = useState('')
  const [kilos, setKilos] = useState('')
  const [age, setAge] = useState('')
  const [ageUnit, setAgeUnit] = useState('Days')
  const [condition, setCondition] = useState('GQ')
  const [purity, setPurity] = useState('')
  const [dateProcured, setDateProcured] = useState('')
  const [asOfDate, setAsOfDate] = useState(todayLocalISO())
  const [moistureContent, setMoistureContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [editingPileId, setEditingPileId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const formRef = useRef(null)
  const pileNameInputRef = useRef(null)
  const [showPileHint, setShowPileHint] = useState(false)

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const warehouse = useLiveQuery(() => db.warehouses.get(warehouseId), [warehouseId])
  const branch = useLiveQuery(
    async () => {
      const province = warehouse?.provinceId ? await db.provinces.get(warehouse.provinceId) : null
      return province?.branchId ? db.branches.get(province.branchId) : null
    },
    [warehouse?.provinceId]
  )
  const [openMenuPileId, setOpenMenuPileId] = useState(null)
  const piles = useLiveQuery(
    () => (warehouseId ? db.piles.where('warehouseId').equals(warehouseId).toArray() : []),
    [warehouseId]
  ) ?? []

  const categoryVarieties = varieties.filter((v) => v.category === category).sort((a, b) => byAlpha(a.name, b.name))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sortedPiles = [...piles].sort((a, b) => byAlpha(a.pileName, b.pileName))

  const resetForm = () => {
    setPileName('')
    setVarietyId('')
    setBags('')
    setKilos('')
    setAge('')
    setCondition('GQ')
    setPurity('')
    setDateProcured('')
    setMoistureContent('')
    setEditingPileId(null)
  }

  // Loads a pile plus its linked seed transaction (for condition, since
  // condition lives only on the transaction, not the pile).
  const handleEdit = async (pile) => {
    const variety = varietyMap.get(pile.varietyId)
    const seed = await db.transactions
      .where('pileId').equals(pile.pileId)
      .and((t) => t.isInitialBalance)
      .first()

    setEditingPileId(pile.pileId)
    setPileName(pile.pileName)
    setCategory(variety?.category ?? 'Rice')
    setVarietyId(pile.varietyId)
    // The beginning balance's OWN figures (from the seed transaction),
    // NOT the pile's live current totals - editing this must never be
    // confused with editing the live, transaction-accumulated state.
    setBags(liveFormatNumber(String(seed?.numberOfBags ?? 0)))
    setKilos(liveFormatNumber(String(seed?.netKilos ?? 0), 3))
    setAge(liveFormatNumber(String(pile.initialAgeValue ?? 0)))
    setAgeUnit('Days')
    setCondition(seed?.condition ?? 'GQ')
    setPurity(pile.purity ?? '')
    setDateProcured(pile.dateProcured ?? '')
    setMoistureContent(pile.moistureContent ?? '')
    setAsOfDate(seed?.date ?? pile.dateOfReceipt ?? todayLocalISO())
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        pileNameInputRef.current?.focus({ preventScroll: true })
      })
    })
  }

  // Gates the Create/Update Pile button - only enabled once the
  // required fields actually have valid values.
  const canSavePile = Boolean(pileName.trim()) && Boolean(varietyId) && bags !== '' && kilos !== '' && age !== ''

  // Cancel only shows once there's actually something to cancel -
  // editing an existing pile, or having started filling in a new one.
  const showCancelPile = Boolean(editingPileId) || Boolean(pileName.trim()) || Boolean(varietyId)
    || bags !== '' || kilos !== '' || age !== ''

  const handleCreate = async () => {
    if (!pileName.trim()) { toast.error('Pile name is required'); return }
    if (!varietyId) { toast.error('Select a variety'); return }

    setIsSaving(true)
    const pile = await createPileWithBeginningBalance({
      warehouseId, pileName, category, varietyId,
      bags: bags === '' ? 0 : parseFormattedNumber(bags),
      kilos: kilos === '' ? 0 : parseFormattedNumber(kilos),
      age: age === '' ? 0 : parseFormattedNumber(age),
      ageUnit, condition, purity, dateProcured, moistureContent,
      asOfDate,
    })
    toast.success(`Pile "${pile.pileName}" created`)
    resetForm()
    setIsSaving(false)
  }

  // Updates the pile's METADATA ONLY - name, category/variety,
  // purity, dates, condition. The beginning balance itself (bags,
  // kilos, age, as-of date) is exclusively managed by the separate
  // Beginning Balances panel now - this form no longer touches the
  // seed transaction, initialAgeValue, or dateOfReceipt at all, so
  // there is only ever one place a balance correction can happen.
  const handleUpdate = async () => {
    if (!pileName.trim()) { toast.error('Pile name is required'); return }

    setIsSaving(true)

    await db.piles.update(editingPileId, {
      pileName: pileName.trim(),
      varietyId,
      purity: purity.trim() || null,
      dateProcured: dateProcured.trim() || null,
      moistureContent: moistureContent.trim() || null,
      condition,
    })

    // Derive the live totals fresh from the complete ledger (seed +
    // every transaction since) - never set directly from the form.
    await recalculatePileCurrentState(editingPileId)

    toast.success('Pile updated')
    resetForm()
    setIsSaving(false)
  }

  const handleDeleteConfirmed = async () => {
    const pile = pendingDelete
    setPendingDelete(null)
    setIsSaving(true)

    const linked = await db.transactions.where('pileId').equals(pile.pileId).toArray()
    for (const t of linked) await db.transactions.delete(t.id)
    await db.piles.delete(pile.pileId)

    toast.success(`Pile "${pile.pileName}" deleted`)
    if (editingPileId === pile.pileId) resetForm()
    setIsSaving(false)
  }

  const handleExportBinCard = async (pile) => {
    setOpenMenuPileId(null)
    const variety = varietyMap.get(pile.varietyId)
    const allPileTransactions = await db.transactions
      .where('pileId').equals(pile.pileId)
      .toArray()
    // WTS transfers reference issuedPileId/receivedPileId directly, not
    // pileId - fetch those separately so a transfer in/out of this pile
    // isn't missing from its ledger.
    const wtsTransfers = await db.transactions
      .where('type').equals('WTS')
      .and((t) => t.issuedPileId === pile.pileId || t.receivedPileId === pile.pileId)
      .toArray()

    const doc = generatePileBinCard({
      warehouse, branch, pile, variety,
      transactions: [...allPileTransactions, ...wtsTransfers],
    })
    doc.save(`${pile.pileName.replace(/[^a-z0-9]+/gi, '-')}-BIN-Card.pdf`)
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

  // Checks for real transactions beyond the pile's own seed, to warn
  // before deleting rather than silently orphaning transaction history.
  const confirmDelete = async (pile) => {
    const others = await db.transactions
      .where('pileId').equals(pile.pileId)
      .and((t) => !t.isInitialBalance)
      .count()
    setPendingDelete({ ...pile, hasHistory: others > 0 })
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-app-text">Create Pile</h2>
      <p className="mt-1 text-xs text-neutral-500">
        For onboarding stock already on hand - creates a pile with a
        beginning balance, not a receipt transaction.
      </p>

      <div
        ref={formRef}
        style={{ scrollMarginTop: `${(headerHeight ?? 60) + (stickyIndicatorHeight ?? 0) + 24}px` }}
        className={`mt-3 space-y-2 rounded-xl border bg-neutral-900 p-3 ${editingPileId ? 'border-brand-amber' : 'border-neutral-800'}`}
      >
        <div>
          <label className={labelClass}>Pile Name</label>
          <ValidatedField
            ref={pileNameInputRef}
            value={pileName}
            onChange={(e) => setPileName(e.target.value)}
            placeholder="Pile C-1"
            validate={(v) => {
              if (!v.trim()) return { valid: false, message: 'Pile name is blank — every pile needs a name to be found later. Enter a name like "Pile C-1".' }
              return { valid: true }
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Category</label>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setVarietyId('') }} className={inputClass}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Variety</label>
            <select
              value={varietyId}
              onChange={(e) => setVarietyId(e.target.value)}
              className={`${inputClass} ${!varietyId ? '!border-brand-amber' : ''}`}
            >
              <option value="">Select…</option>
              {categoryVarieties.map((v) => <option key={v.varietyId} value={v.varietyId}>{v.name}</option>)}
            </select>
          </div>
        </div>
        {!editingPileId && (
          <>
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
          </>
        )}
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
            <input type="text" value={purity} onChange={(e) => setPurity(e.target.value)}
              className={inputClass} placeholder="94%" />
          </div>
          <div>
            <label className={labelClass}>MC (optional)</label>
            <input type="text" value={moistureContent} onChange={(e) => setMoistureContent(e.target.value)}
              className={inputClass} placeholder="11.1" />
          </div>
        </div>
        <div>
          <label className={labelClass}>{category === 'Palay' ? 'Date Procured' : 'Date Received'} (optional)</label>
          <input type="text" value={dateProcured} onChange={(e) => setDateProcured(e.target.value)}
            className={inputClass} placeholder="MAR 24 TO APR 4, 2025" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <button
              type="button"
              onClick={() => {
                if (!canSavePile) { setShowPileHint(true); return }
                editingPileId ? handleUpdate() : handleCreate()
              }}
              disabled={isSaving}
              className={`w-full rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                canSavePile
                  ? `${primaryButtonClass}`
                  : 'border border-brand-neon/40 text-brand-neon/40'
              }`}
            >
              {editingPileId ? 'Update Pile' : 'Create Pile'}
            </button>
          </div>
          <div
            className="overflow-hidden transition-all duration-300 ease-out"
            style={{ maxWidth: showCancelPile ? '96px' : '0px', opacity: showCancelPile ? 1 : 0 }}
          >
            <button
              type="button"
              onClick={resetForm}
              disabled={isSaving}
              className="whitespace-nowrap rounded-xl border border-neutral-800 px-4 py-2 text-sm text-neutral-400"
            >
              Cancel
            </button>
          </div>
        </div>
        {showPileHint && !canSavePile && (
          <p className="mt-1 text-center text-xs text-brand-amber">Please complete all required fields.</p>
        )}
      </div>

      {sortedPiles.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {sortedPiles.map((p) => (
            <li key={p.pileId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
              <span className="truncate text-sm text-app-text">
                {p.pileName} <span className="text-xs text-neutral-500">{varietyMap.get(p.varietyId)?.name ?? ''}</span>
                {p.closedDate && <span className="ml-1 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">CLOSED</span>}
              </span>
              <div className="text-right">
                <p className="whitespace-nowrap text-sm font-semibold text-brand-neon">{fmtBags(p.currentBags)} bags</p>
                <p className="whitespace-nowrap text-sm font-semibold text-brand-neon">{fmtWeight(p.currentKilos ?? 0, weightUnit, 'Net')}</p>
              </div>
              <div className="relative flex items-center gap-1">
                <button type="button" onClick={() => handleEdit(p)} aria-label="Edit" className="rounded-lg p-2 text-neutral-400 transition-all hover:text-app-text active:scale-90">
                  <Pencil size={20} />
                </button>
                <button type="button" onClick={() => confirmDelete(p)} aria-label="Delete" className="rounded-lg p-2 text-neutral-400 transition-all hover:text-brand-crimson active:scale-90">
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
                      <button
                        type="button"
                        onClick={() => handleExportBinCard(p)}
                        className="block w-full px-3 py-2 text-left text-sm text-app-text hover:bg-neutral-800"
                      >
                        Export BIN Card
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleClosePile(p)}
                        className="block w-full px-3 py-2 text-left text-sm text-app-text hover:bg-neutral-800"
                      >
                        {p.closedDate ? 'Re-open Pile' : 'Close Pile'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

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

function Settings() {
  const { user } = useAuth()
  const { autoAgeMonitoring, updateSetting } = useSettings() ?? {}
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } = useWarehouse() ?? {}
  const { setPageHeader } = usePageHeader() ?? {}
  const warehouseSectionRef = useRef(null)
  const [pileSection, setPileSection] = useState('create')
  useEffect(() => {
    setPageHeader?.({ title: 'Settings', subtitle: '' })
  }, [])

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
      {user && (
        <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-sm font-medium text-app-text">
            {user.nickname} · {user.role}
          </p>
          <p className="text-xs text-neutral-400">{user.name}</p>
        </div>
      )}

      {user?.role === 'Admin' && (
        <Link
          to="/admin"
          className="mt-4 flex items-center gap-3 rounded-2xl border-2 border-brand-neon bg-brand-neon/10 px-4 py-4 text-brand-neon shadow-[0_0_20px_-4px_rgba(0,255,163,0.4)] transition-transform active:scale-[0.98]"
        >
          <ShieldCheck size={28} className="shrink-0" />
          <div>
            <p className="text-base font-bold">Admin Dashboard</p>
            <p className="text-xs text-brand-neon/70">Warehouses, users, sheet sources, and more</p>
          </div>
        </Link>
      )}

      <div ref={warehouseSectionRef}>
        {sortedWarehouses.length > 1 ? (
          <div className="mt-4">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Active Warehouse</label>
            <select
              value={currentWarehouseId ?? ''}
              onChange={(e) => setCurrentWarehouseId(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-3 text-base font-semibold text-app-text outline-none focus:border-brand-neon"
            >
              {sortedWarehouses.map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>
        ) : currentWarehouse ? (
          <div className="mt-4 rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Active Warehouse</p>
            <p className="text-base font-bold text-app-text">{currentWarehouse.code} — {currentWarehouse.name}</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">No warehouse assigned</p>
        )}
      </div>
      <StickyWarehouseIndicator targetRef={warehouseSectionRef} warehouse={currentWarehouse} />

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold text-app-text">Preferences</h2>

        <Toggle
          label="Auto Age Monitoring"
          description="Automatically calculates pile age from the date of receipt. When off, the displayed age stays at the manually set value until you edit it directly on the pile."
          value={autoAgeMonitoring ?? true}
          onChange={(val) => updateSetting?.('autoAgeMonitoring', val)}
        />
      </div>

      {currentWarehouseId && <ClassifierSection warehouseId={currentWarehouseId} />}

      {currentWarehouseId && (
        <div className="mt-6">
          <div className="relative flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
            <div
              className="absolute inset-y-1 rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
              style={{
                width: `calc(${100 / 2}% - 0.25rem)`,
                transform: `translateX(calc(${(pileSection === 'create' ? 0 : 1) * 100}% + ${(pileSection === 'create' ? 0 : 1) * 0.5}rem))`,
              }}
            />
            <button
              type="button"
              onClick={() => setPileSection('create')}
              className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${pileSection === 'create' ? 'text-brand-contrast' : 'text-neutral-400'}`}
            >
              Create Pile
            </button>
            <button
              type="button"
              onClick={() => setPileSection('balances')}
              className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${pileSection === 'balances' ? 'text-brand-contrast' : 'text-neutral-400'}`}
            >
              Beginning Balances
            </button>
          </div>
          <div className="mt-3">
            {pileSection === 'create'
              ? <PileBalanceSection warehouseId={currentWarehouseId} />
              : <BeginningBalancesPanel warehouseId={currentWarehouseId} />}
          </div>
        </div>
      )}
    </div>
  )
}

export default Settings
