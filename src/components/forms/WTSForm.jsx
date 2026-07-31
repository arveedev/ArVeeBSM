// WTS — Weigher's Tally Sheet. A dual-sided in-warehouse document: one
// side records stocks taken FROM a pile (issued), the other records
// stocks WEIGHED (received into a pile). Both sides carry their own
// variety, sack type, condition, bags, and gross kilos — the form itself
// shows gross only (matching the real paper form), but net kilos is
// computed automatically (gross minus the sack type's tare weight for
// that condition, same MTS calculation every other stock form uses) so
// the correct net figure is what actually reflects onto each pile.
//
// WTS keeps its own serial series per warehouse, separate from WSR/WSI.
// Both sides are required — a WTS with only one side filled is not a
// valid document.
//
// Color convention (fixed app-wide rule): green/neon = issuances,
// amber/orange = receipts. The issued side is neon, the received side
// is amber.
//
// SidePanel is defined OUTSIDE this component, at module scope. Defining
// it inside the render body would make React treat it as a brand new
// component type on every keystroke (since the parent re-renders on every
// controlled-input change), remounting its inputs and stealing focus
// after each character — exactly the bug this caused before the fix.

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, X, AlertTriangle } from 'lucide-react'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import { db } from '../../db/dexie.js'
import { queueTransactionDeletion } from '../../services/syncWorker.js'
import { suggestNextSerial, isSerialTaken, stepSerial, findTransactionBySerial, recordSerialUsed, recalculateSerialCounter } from '../../utils/serialNumber.js'
import {
  liveFormatNumber,
  parseFormattedNumber,
  calculateMtsFromSackWeight,
  calculateNetKilos,
  fmtWeight,
  todayLocalISO,
} from '../../utils/calculations.js'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
import { inputClass, labelClass, primaryButtonClass } from './shared.js'

const STOCK_CONDITIONS = ['Good', 'Part Damaged', 'Damaged']
const SACK_CONDITIONS = ['BN', 'SH', 'US']
const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

const emptySide = () => ({
  pileId: '', varietyId: '', sackTypeId: '', condition: '', bags: '', grossKilos: '', stockCondition: 'Good',
})

// Net kilos = gross minus the sack type's tare weight for the selected
// condition, times bags — same MTS deduction every other stock form uses.
const computeSideNetKilos = (side, sackTypeMap) => {
  const bags = parseFormattedNumber(side.bags)
  const gross = parseFormattedNumber(side.grossKilos)
  const sackType = sackTypeMap.get(side.sackTypeId)
  const weightPerBag = sackType?.weights?.[side.condition] ?? 0
  const mts = calculateMtsFromSackWeight(weightPerBag, bags)
  return calculateNetKilos(gross, mts)
}

const ACCENTS = {
  neon: { border: 'border-brand-neon/30', activeBorder: 'border-brand-neon', activeBg: 'bg-brand-neon/10', text: 'text-brand-neon' },
  amber: { border: 'border-brand-amber/30', activeBorder: 'border-brand-amber', activeBg: 'bg-brand-amber/10', text: 'text-brand-amber' },
}

function SidePanel({ label, side, setSide, accent, sortedPiles, varietyMap, sortedSackTypes, sackTypeMap, sortedVarieties }) {
  const { weightUnit } = useSettings() ?? {}
  const lockedVariety = side.pileId
    ? sortedPiles.find((p) => p.pileId === side.pileId)?.varietyId
    : null
  const variety = lockedVariety ? varietyMap.get(lockedVariety) : null
  const accentClasses = ACCENTS[accent]
  const netKilos = computeSideNetKilos(side, sackTypeMap)

  return (
    <div className={`rounded-xl border p-3 ${accentClasses.border}`}>
      <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${accentClasses.text}`}>
        {label}
      </p>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Pile</label>
            <select value={side.pileId} onChange={(e) => setSide((s) => ({ ...s, pileId: e.target.value }))} className={`${inputClass} ${!side.pileId ? '!border-brand-amber' : ''}`}>
              <option value="">Select pile…</option>
              {sortedPiles.map((p) => {
                const v = varietyMap.get(p.varietyId)
                return <option key={p.pileId} value={p.pileId}>{p.pileName} ({v?.name ?? p.cerealType})</option>
              })}
            </select>
          </div>
          <div>
            <label className={labelClass}>Variety</label>
            {lockedVariety ? (
              <div className={`${inputClass} opacity-60`}>
                {variety ? `${variety.name} (${variety.category})` : '—'}
              </div>
            ) : (
              <select value={side.varietyId} onChange={(e) => setSide((s) => ({ ...s, varietyId: e.target.value }))} className={`${inputClass} ${!side.varietyId ? '!border-brand-amber' : ''}`}>
                <option value="">Select variety…</option>
                {sortedVarieties.map((v) => <option key={v.varietyId} value={v.varietyId}>{v.name} ({v.category})</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Sack Type</label>
            <select value={side.sackTypeId} onChange={(e) => setSide((s) => ({ ...s, sackTypeId: e.target.value }))} className={`${inputClass} ${!side.sackTypeId ? '!border-brand-amber' : ''}`}>
              <option value="">Select…</option>
              {sortedSackTypes.map((s) => <option key={s.sackTypeId} value={s.sackTypeId}>{s.code}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Condition</label>
            <select value={side.condition} onChange={(e) => setSide((s) => ({ ...s, condition: e.target.value }))} className={`${inputClass} ${!side.condition ? '!border-brand-amber' : ''}`}>
              <option value="">Select…</option>
              {SACK_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Bags</label>
            <input type="text" inputMode="numeric" value={side.bags}
              onChange={(e) => setSide((s) => ({ ...s, bags: liveFormatNumber(e.target.value) }))}
              className={`${inputClass} ${side.bags === '' ? '!border-brand-amber' : ''}`} placeholder="0" />
          </div>
          <div>
            <label className={labelClass}>Gross Kilos</label>
            <input type="text" inputMode="decimal" value={side.grossKilos}
              onChange={(e) => setSide((s) => ({ ...s, grossKilos: liveFormatNumber(e.target.value, 3) }))}
              className={`${inputClass} ${side.grossKilos === '' ? '!border-brand-amber' : ''}`} placeholder="0.000" />
          </div>
        </div>
        {(side.bags !== '' || side.grossKilos !== '') && (
          <p className="text-xs text-neutral-500">
            Net Kilos (computed): <span className="font-medium text-app-text">{fmtWeight(netKilos, weightUnit)}</span>
          </p>
        )}
        <div>
          <label className={labelClass}>Stock Condition</label>
          <div className="mt-1 flex gap-2">
            {STOCK_CONDITIONS.map((c) => (
              <button key={c} type="button"
                onClick={() => setSide((s) => ({ ...s, stockCondition: c }))}
                className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all active:scale-95 ${
                  side.stockCondition === c
                    ? `${accentClasses.activeBorder} ${accentClasses.activeBg} ${accentClasses.text}`
                    : 'border-neutral-800 bg-neutral-950 text-neutral-400'
                }`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WTSForm({ onClose, prefill }) {
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}

  const [serialNo, setSerialNo] = useState('')
  const [date, setDate] = useState(todayLocalISO())
  const [aiNumber, setAiNumber] = useState('')
  const [transactionTypeId, setTransactionTypeId] = useState('')
  const [moistureContent, setMoistureContent] = useState('')
  const [issuedSide, setIssuedSide] = useState(emptySide())
  const [receivedSide, setReceivedSide] = useState(emptySide())
  const [loadedTransaction, setLoadedTransaction] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const [pendingVoidAction, setPendingVoidAction] = useState(null) // 'void' | 'unvoid' | null
  const [hasEntered, setHasEntered] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const [navFlash, setNavFlash] = useState(null)
  const [showSaveHint, setShowSaveHint] = useState(false)

  const scrollContainerRef = useRef(null)
  const serialFieldRef = useRef(null)
  const [isSerialFieldVisible, setIsSerialFieldVisible] = useState(true)

  // Tracks whether the actual WTS No. field is currently scrolled into
  // view within the form's own scroll container - drives the sticky
  // "WTS # {serialNo}" indicator shown near the top when scrolled past it.
  useEffect(() => {
    const target = serialFieldRef.current
    const root = scrollContainerRef.current
    if (!target || !root) return

    const observer = new IntersectionObserver(
      ([entry]) => setIsSerialFieldVisible(entry.isIntersecting),
      { root, threshold: 0 }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const piles = useLiveQuery(async () => {
    if (!currentWarehouseId) return []
    return db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
  }, [currentWarehouseId])

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), [])
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), [])
  const txTypes = useLiveQuery(() => db.transactionTypes.toArray(), [])

  const sortedPiles = [...(piles ?? [])].sort((a, b) => byAlpha(a.pileName, b.pileName))
  const sortedVarieties = [...(varieties ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const sortedSackTypes = [...(sackTypes ?? [])].sort((a, b) => byAlpha(a.code, b.code))
  const sortedTxTypes = [...(txTypes ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const varietyMap = new Map((varieties ?? []).map((v) => [v.varietyId, v]))
  const sackTypeMap = new Map((sackTypes ?? []).map((s) => [s.sackTypeId, s]))

  useEffect(() => {
    const pile = sortedPiles.find((p) => p.pileId === issuedSide.pileId)
    if (pile?.varietyId) setIssuedSide((s) => ({ ...s, varietyId: pile.varietyId }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuedSide.pileId])

  useEffect(() => {
    const pile = sortedPiles.find((p) => p.pileId === receivedSide.pileId)
    if (pile?.varietyId) setReceivedSide((s) => ({ ...s, varietyId: pile.varietyId }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivedSide.pileId])

  useEffect(() => {
    if (loadedTransaction) return
    if (prefill?.serialNo) return
    if (!currentWarehouseId) return
    let cancelled = false
    suggestNextSerial('WTS', currentWarehouseId).then((s) => {
      if (!cancelled) setSerialNo(s)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWarehouseId])

  useEffect(() => {
    if (!prefill?.serialNo) return
    setSerialNo(prefill.serialNo)
    const t = setTimeout(() => checkAndLoadSerial(prefill.serialNo), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const loadTransactionIntoForm = (tx) => {
    setLoadedTransaction(tx)
    setIsCancelled(tx.status === 'Cancelled')
    setDate(tx.date ?? todayLocalISO())
    setAiNumber(tx.aiNumber ?? '')
    setTransactionTypeId(tx.transactionTypeId ?? '')
    setMoistureContent(tx.moistureContent != null ? liveFormatNumber(String(tx.moistureContent)) : '')
    setIssuedSide({
      pileId: tx.issuedPileId ?? '',
      varietyId: tx.issuedVarietyId ?? '',
      sackTypeId: tx.issuedSackTypeId ?? '',
      condition: tx.issuedCondition ?? '',
      bags: tx.issuedBags != null ? liveFormatNumber(String(tx.issuedBags)) : '',
      grossKilos: tx.issuedGrossKilos != null ? liveFormatNumber(String(tx.issuedGrossKilos), 3) : '',
      stockCondition: tx.issuedStockCondition ?? 'Good',
    })
    setReceivedSide({
      pileId: tx.receivedPileId ?? '',
      varietyId: tx.receivedVarietyId ?? '',
      sackTypeId: tx.receivedSackTypeId ?? '',
      condition: tx.receivedCondition ?? '',
      bags: tx.receivedBags != null ? liveFormatNumber(String(tx.receivedBags)) : '',
      grossKilos: tx.receivedGrossKilos != null ? liveFormatNumber(String(tx.receivedGrossKilos), 3) : '',
      stockCondition: tx.receivedStockCondition ?? 'Good',
    })
  }

  const resetForm = (nextSerial) => {
    setLoadedTransaction(null)
    setIsCancelled(false)
    setSerialNo(nextSerial)
    setDate(todayLocalISO())
    setAiNumber('')
    setTransactionTypeId('')
    setMoistureContent('')
    setIssuedSide(emptySide())
    setReceivedSide(emptySide())
  }

  const checkAndLoadSerial = async (serial) => {
    if (!currentWarehouseId) return false
    const existing = await findTransactionBySerial('WTS', currentWarehouseId, serial)
    if (existing) {
      loadTransactionIntoForm(existing)
      return true
    }
    if (loadedTransaction) setLoadedTransaction(null)
    return false
  }

  const handleSerialChange = async (value) => {
    setSerialNo(value)
    await checkAndLoadSerial(value)
  }

  const handleStepBack = async () => {
    const prev = stepSerial(serialNo.trim(), -1)
    setSerialNo(prev)
    setNavFlash('back')
    setTimeout(() => setNavFlash(null), 550)
    await checkAndLoadSerial(prev)
  }

  const handleStepForward = async () => {
    const next = stepSerial(serialNo.trim(), 1)
    setSerialNo(next)
    setNavFlash('forward')
    setTimeout(() => setNavFlash(null), 550)
    const loaded = await checkAndLoadSerial(next)
    if (!loaded) resetForm(next)
  }

  const buildCancelledPayload = (overrides = {}) => ({
    type: 'WTS',
    serialNo: serialNo.trim(),
    status: 'Cancelled',
    date,
    warehouseId: currentWarehouseId,
    aiNumber: null,
    transactionTypeId: null,
    moistureContent: null,
    issuedPileId: null,
    issuedVarietyId: null,
    issuedSackTypeId: null,
    issuedCondition: null,
    issuedBags: null,
    issuedGrossKilos: null,
    issuedNetKilos: null,
    issuedStockCondition: null,
    receivedPileId: null,
    receivedVarietyId: null,
    receivedSackTypeId: null,
    receivedCondition: null,
    receivedBags: null,
    receivedGrossKilos: null,
    receivedNetKilos: null,
    receivedStockCondition: null,
    isSynced: false,
    ...overrides,
  })

  const buildPayload = (overrides = {}) => {
    if (isCancelled) {
      return buildCancelledPayload(overrides)
    }
    const issuedNetKilos = computeSideNetKilos(issuedSide, sackTypeMap)
    const receivedNetKilos = computeSideNetKilos(receivedSide, sackTypeMap)
    return {
      type: 'WTS',
      serialNo: serialNo.trim(),
      status: 'Active',
      date,
      warehouseId: currentWarehouseId,
      aiNumber: aiNumber.trim() || null,
      transactionTypeId: transactionTypeId || null,
      moistureContent: moistureContent === '' ? null : parseFloat(parseFormattedNumber(moistureContent).toFixed(2)),
      issuedPileId: issuedSide.pileId || null,
      issuedVarietyId: issuedSide.varietyId || null,
      issuedSackTypeId: issuedSide.sackTypeId || null,
      issuedCondition: issuedSide.condition || null,
      issuedBags: issuedSide.bags === '' ? null : parseFormattedNumber(issuedSide.bags),
      issuedGrossKilos: issuedSide.grossKilos === '' ? null : parseFormattedNumber(issuedSide.grossKilos),
      issuedNetKilos: issuedSide.grossKilos === '' ? null : issuedNetKilos,
      issuedStockCondition: issuedSide.stockCondition,
      receivedPileId: receivedSide.pileId || null,
      receivedVarietyId: receivedSide.varietyId || null,
      receivedSackTypeId: receivedSide.sackTypeId || null,
      receivedCondition: receivedSide.condition || null,
      receivedBags: receivedSide.bags === '' ? null : parseFormattedNumber(receivedSide.bags),
      receivedGrossKilos: receivedSide.grossKilos === '' ? null : parseFormattedNumber(receivedSide.grossKilos),
      receivedNetKilos: receivedSide.grossKilos === '' ? null : receivedNetKilos,
      receivedStockCondition: receivedSide.stockCondition,
      isSynced: false,
      ...overrides,
    }
  }

  // Pile totals move by NET kilos, not gross — gross is only what's
  // printed on the paper form, net is what the warehouse is actually
  // accountable for.
  const applyWtsToPiles = async (tx) => {
    if (tx.issuedPileId && tx.issuedBags != null) {
      const pile = await db.piles.get(tx.issuedPileId)
      if (pile) {
        await db.piles.update(pile.pileId, {
          currentBags: Math.max(0, (pile.currentBags ?? 0) - tx.issuedBags),
          currentKilos: Math.max(0, (pile.currentKilos ?? 0) - (tx.issuedNetKilos ?? 0)),
        })
      }
    }
    if (tx.receivedPileId && tx.receivedBags != null) {
      const pile = await db.piles.get(tx.receivedPileId)
      if (pile) {
        await db.piles.update(pile.pileId, {
          currentBags: (pile.currentBags ?? 0) + tx.receivedBags,
          currentKilos: (pile.currentKilos ?? 0) + (tx.receivedNetKilos ?? 0),
        })
      }
    }
  }

  const reverseWtsFromPiles = async (tx) => {
    if (tx.issuedPileId && tx.issuedBags != null) {
      const pile = await db.piles.get(tx.issuedPileId)
      if (pile) {
        await db.piles.update(pile.pileId, {
          currentBags: (pile.currentBags ?? 0) + tx.issuedBags,
          currentKilos: (pile.currentKilos ?? 0) + (tx.issuedNetKilos ?? 0),
        })
      }
    }
    if (tx.receivedPileId && tx.receivedBags != null) {
      const pile = await db.piles.get(tx.receivedPileId)
      if (pile) {
        await db.piles.update(pile.pileId, {
          currentBags: Math.max(0, (pile.currentBags ?? 0) - tx.receivedBags),
          currentKilos: Math.max(0, (pile.currentKilos ?? 0) - (tx.receivedNetKilos ?? 0)),
        })
      }
    }
  }

  // A WTS document with only one side filled is not valid — it must show
  // both an issue and a receipt, matching the real paper form.
  const sideIsComplete = (side) =>
    side.pileId && side.varietyId && side.sackTypeId && side.condition && side.bags !== '' && side.grossKilos !== ''

  // Gates the Save button - mirrors validate()'s synchronous checks
  // (serial-uniqueness is async and stays a save-time-only safety net).
  const canSave = isCancelled
    ? Boolean(currentWarehouseId) && Boolean(serialNo.trim())
    : Boolean(currentWarehouseId)
      && Boolean(serialNo.trim())
      && Boolean(aiNumber.trim())
      && Boolean(transactionTypeId)
      && sideIsComplete(issuedSide)
      && sideIsComplete(receivedSide)
      && moistureContent !== '' && !isNaN(parseFormattedNumber(moistureContent))

  const validate = async (excludeId = null) => {
    if (!currentWarehouseId) { toast.error('No warehouse selected'); return false }
    if (!serialNo.trim()) { toast.error('WTS No. is required'); return false }
    if (await isSerialTaken('WTS', currentWarehouseId, serialNo.trim(), excludeId)) {
      toast.error(`WTS ${serialNo.trim()} already exists in this warehouse`)
      return false
    }
    if (isCancelled) return true
    if (!aiNumber.trim()) { toast.error('AI No. is required'); return false }
    if (!transactionTypeId) { toast.error('Nature of Transaction is required'); return false }
    if (!sideIsComplete(issuedSide) || !sideIsComplete(receivedSide)) {
      toast.error('Both sides (issued and received) must be fully filled in — pile, variety, sack type, condition, bags, and gross kilos')
      return false
    }
    if (moistureContent === '' || isNaN(parseFormattedNumber(moistureContent))) {
      toast.error('Moisture Content (MC %) is required')
      return false
    }
    return true
  }

  const handleSave = async () => {
    if (!(await validate())) return
    setIsSaving(true)
    const tx = { id: crypto.randomUUID(), ...buildPayload() }
    await db.transactions.add(tx)
    await recordSerialUsed('WTS', currentWarehouseId, serialNo.trim())
    await applyWtsToPiles(tx)
    toast.success(`WTS saved — ${serialNo.trim()}`)
    resetForm(stepSerial(serialNo.trim(), 1))
    setIsSaving(false)
  }

  const handleUpdate = async () => {
    if (!(await validate(loadedTransaction.id))) return
    setIsSaving(true)
    await reverseWtsFromPiles(loadedTransaction)
    const updated = buildPayload({ id: loadedTransaction.id })
    await db.transactions.update(loadedTransaction.id, updated)
    await applyWtsToPiles(updated)
    toast.success(`WTS ${serialNo.trim()} updated`)
    setLoadedTransaction(updated)
    setIsSaving(false)
  }

  const handleDeleteConfirmed = async () => {
    setPendingDelete(false)
    setIsSaving(true)
    await reverseWtsFromPiles(loadedTransaction)
    await db.transactions.delete(loadedTransaction.id)
    await recalculateSerialCounter('WTS', currentWarehouseId)
    queueTransactionDeletion(loadedTransaction.serialNo, 'WTS', currentWarehouse?.code)
    toast.success(`WTS ${serialNo.trim()} deleted`)
    resetForm(serialNo.trim())
    setIsSaving(false)
  }

  // Voiding bypasses the normal Save button - confirming immediately
  // writes the Cancelled record. If an existing Active transaction is
  // being voided, both sides' prior pile effects are reversed first,
  // since it no longer represents a real transfer.
  const handleConfirmVoid = async () => {
    setPendingVoidAction(null)
    setIsSaving(true)
    if (loadedTransaction && loadedTransaction.status !== 'Cancelled') {
      await reverseWtsFromPiles(loadedTransaction)
    }
    const cancelledRecord = loadedTransaction
      ? buildCancelledPayload({ id: loadedTransaction.id })
      : { id: crypto.randomUUID(), ...buildCancelledPayload() }
    if (loadedTransaction) {
      await db.transactions.update(loadedTransaction.id, cancelledRecord)
    } else {
      await db.transactions.add(cancelledRecord)
    }
    await recordSerialUsed('WTS', currentWarehouseId, serialNo.trim())
    setIsCancelled(true)
    setLoadedTransaction(cancelledRecord)
    toast.success(`WTS ${serialNo.trim()} has been cancelled/voided`)
    setIsSaving(false)
  }

  // Un-voiding deletes the Cancelled record entirely, making the
  // serial genuinely available again.
  const handleConfirmUnvoid = async () => {
    setPendingVoidAction(null)
    if (!loadedTransaction) { setIsCancelled(false); return }
    setIsSaving(true)
    await db.transactions.delete(loadedTransaction.id)
    await recalculateSerialCounter('WTS', currentWarehouseId)
    queueTransactionDeletion(loadedTransaction.serialNo, 'WTS', currentWarehouse?.code)
    toast.success(`WTS ${serialNo.trim()} is no longer cancelled — available again`)
    resetForm(serialNo.trim())
    setIsSaving(false)
  }

  const isEditMode = Boolean(loadedTransaction)

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 transition-all duration-[220ms] ${hasEntered && !isClosing ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">WTS</h1>
          <button type="button" onClick={() => { setIsClosing(true); setTimeout(onClose, 220) }} disabled={isSaving} aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        {sortedWarehouses.length > 1 ? (
          <div className="mt-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</label>
            <select value={currentWarehouseId ?? ''} onChange={(e) => { setCurrentWarehouseId(e.target.value); setLoadedTransaction(null) }}
              className="mt-1 w-full rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-3 text-base font-semibold text-app-text outline-none focus:border-brand-neon">
              {sortedWarehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>)}
            </select>
          </div>
        ) : currentWarehouse && (
          <div className="mt-2 rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</p>
            <p className="text-base font-bold text-app-text">{currentWarehouse.code} — {currentWarehouse.name}</p>
          </div>
        )}

        {!isSerialFieldVisible && serialNo && (
          <p className="mt-2 rounded-xl border-2 border-brand-neon bg-brand-neon/10 px-3 py-2.5 text-center font-mono text-lg font-bold text-brand-neon shadow-[0_0_16px_-4px_rgba(0,255,163,0.4)]">
            WTS # {serialNo}
          </p>
        )}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-4 space-y-3">
        {isEditMode && (
          <div className="rounded-xl border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
            Reviewing WTS {loadedTransaction.serialNo} — Update or Delete below.
          </div>
        )}

        <div ref={serialFieldRef}>
          <label className={labelClass}>WTS No.</label>
          <div className="mt-1 flex items-center gap-2">
            <button type="button" onClick={handleStepBack} aria-label="Previous WTS"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 active:scale-90">
              <ChevronLeft size={18} />
            </button>
            <input type="text" value={serialNo} onChange={(e) => handleSerialChange(e.target.value)}
              className={`mt-0 w-full rounded-xl border bg-neutral-950 px-3 py-2 text-center font-mono text-app-text outline-none transition-colors focus:border-brand-neon ${!serialNo.trim() ? '!border-brand-amber' : 'border-neutral-800'} ${navFlash === 'back' ? 'animate-nav-back' : navFlash === 'forward' ? 'animate-nav-forward' : ''}`} />
            <button type="button" onClick={handleStepForward} aria-label="Next WTS"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 active:scale-90">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className={`space-y-3 rounded-xl transition-opacity ${isCancelled ? 'border-2 border-brand-crimson p-2 opacity-40' : ''} ${navFlash ? 'stagger-fields' : ''}`}>
        <div>
          <label className={labelClass}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className={`${inputClass} cursor-pointer`} />
        </div>

        <div>
          <label className={labelClass}>AI No.</label>
          <input type="text" value={aiNumber} onChange={(e) => setAiNumber(e.target.value)}
            className={`${inputClass} ${!aiNumber.trim() ? '!border-brand-amber' : ''}`} placeholder="26219637" />
        </div>

        <div>
          <label className={labelClass}>Nature of Transaction</label>
          <select value={transactionTypeId} onChange={(e) => setTransactionTypeId(e.target.value)} className={`${inputClass} ${!transactionTypeId ? '!border-brand-amber' : ''}`}>
            <option value="">Select…</option>
            {sortedTxTypes.map((t) => <option key={t.transactionTypeId} value={t.transactionTypeId}>{t.name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelClass}>MC % (Moisture Content)</label>
          <input type="text" inputMode="decimal"
            value={moistureContent} onChange={(e) => setMoistureContent(liveFormatNumber(e.target.value))}
            className={`${inputClass} ${moistureContent === '' ? '!border-brand-amber' : ''}`} placeholder="13.90" />
        </div>

        <SidePanel
          label="Stocks from Pile (Issued)"
          side={issuedSide}
          setSide={setIssuedSide}
          accent="neon"
          sortedPiles={sortedPiles}
          varietyMap={varietyMap}
          sortedSackTypes={sortedSackTypes}
          sackTypeMap={sackTypeMap}
          sortedVarieties={sortedVarieties}
        />
        <SidePanel
          label="Stocks Weighed (Received)"
          side={receivedSide}
          setSide={setReceivedSide}
          accent="amber"
          sortedPiles={sortedPiles}
          varietyMap={varietyMap}
          sortedSackTypes={sortedSackTypes}
          sackTypeMap={sackTypeMap}
          sortedVarieties={sortedVarieties}
        />
        </div>

        <label className="flex items-center justify-center gap-2 py-1 text-base font-semibold text-brand-crimson">
          <input
            type="checkbox"
            checked={isCancelled}
            onChange={(e) => setPendingVoidAction(e.target.checked ? 'void' : 'unvoid')}
            className="h-7 w-7 shrink-0 rounded border-neutral-700 bg-neutral-950 text-brand-crimson accent-brand-crimson"
          />
          Cancelled
        </label>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-900 p-4 pb-6">
        {isEditMode ? (
          <div className="flex gap-3">
            <button type="button" onClick={handleUpdate} disabled={isSaving}
              className="flex-1 rounded-xl bg-brand-neon py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50">
              Update
            </button>
            <button type="button" onClick={() => setPendingDelete(true)} disabled={isSaving}
              className="flex-1 rounded-xl bg-brand-crimson py-3 text-sm font-semibold text-app-text transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50">
              Delete
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => {
                if (!canSave) { setShowSaveHint(true); return }
                handleSave()
              }}
              disabled={isSaving}
              className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
                canSave ? `${primaryButtonClass}` : 'border border-brand-neon/40 text-brand-neon/40'
              }`}
            >
              Save
            </button>
            {showSaveHint && !canSave && (
              <p className="mt-1 text-center text-xs text-brand-amber">Please complete all required fields.</p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title={`Delete WTS ${loadedTransaction?.serialNo ?? ''}?`}
        description="This reverses its effect on both piles' totals. This cannot be undone."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(false)}
      />

      <ConfirmDialog
        open={pendingVoidAction === 'void'}
        icon={AlertTriangle}
        title={`Void WTS #${serialNo.trim()}?`}
        description="This immediately marks the series as cancelled - no data required, and no need to press Save."
        confirmLabel="Void"
        onConfirm={handleConfirmVoid}
        onCancel={() => setPendingVoidAction(null)}
      />

      <ConfirmDialog
        open={pendingVoidAction === 'unvoid'}
        icon={AlertTriangle}
        title={`Make WTS #${serialNo.trim()} available again?`}
        description="This removes the cancelled marker entirely, so the serial is free for a fresh entry."
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={handleConfirmUnvoid}
        onCancel={() => setPendingVoidAction(null)}
      />
    </div>
  )
}

export default WTSForm
