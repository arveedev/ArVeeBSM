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
import { SaveButtonLabel, UpdateButtonContent, DeleteButtonLabel } from '../common/AnimatedButtonBits.jsx'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../db/dexie.js'
import { formatRolePrefixedName } from '../../utils/customerDirectory.js'
import { deriveZeroedDateUpdate } from '../../utils/pileLedger.js'
import AnimatedBanner from '../common/AnimatedBanner.jsx'
import CalendarDatePicker from '../common/CalendarDatePicker.jsx'
import SerialCrossfadeOverlay from '../common/SerialCrossfadeOverlay.jsx'
import AuthorityPickerModal from './AuthorityPickerModal.jsx'
import { queueTransactionDeletion, pauseTransactionSync, resumeTransactionSync } from '../../services/syncWorker.js'
import { suggestNextSerial, isSerialTaken, stepSerial, findTransactionBySerial, recordSerialUsed, recalculateSerialCounter, findAdjacentTransaction } from '../../utils/serialNumber.js'
import {
  liveFormatNumber,
  parseFormattedNumber,
  calculateMtsFromSackWeight,
  calculateNetKilos,
  fmtWeight,
  todayLocalISO,
  round3,
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
                // A By Products pile accepts any mix of By Products
                // varieties over its lifetime - showing one variety name
                // in parentheses wrongly implied the pile was locked to
                // it. Rice/Palay piles genuinely are locked to a single
                // variety, so they keep the parenthetical.
                return (
                  <option key={p.pileId} value={p.pileId}>
                    {p.cerealType === 'By Products' ? p.pileName : `${p.pileName} (${v?.name ?? p.cerealType})`}
                  </option>
                )
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

function WTSForm({ onClose, prefill, isOpen = true }) {
  // Same reasoning as StockFormBase.jsx's identical fix.
  useEffect(() => {
    pauseTransactionSync()
    return () => resumeTransactionSync()
  }, [])

  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}
  const { user } = useAuth()

  const [serialNo, setSerialNo] = useState('')
  const [date, setDate] = useState(todayLocalISO())
  const [aiNumber, setAiNumber] = useState('')
  const [showAuthorityPicker, setShowAuthorityPicker] = useState(false)
  const [transactionTypeId, setTransactionTypeId] = useState('')
  const [moistureContent, setMoistureContent] = useState('')
  const [issuedSide, setIssuedSide] = useState(emptySide())
  const [receivedSide, setReceivedSide] = useState(emptySide())
  const [loadedTransaction, setLoadedTransaction] = useState(null)
  // Same as StockFormBase.jsx - locks serial/warehouse only when
  // opened from Reports, since WTS transactions are tappable there
  // too (confirmed in Reports.jsx's stock statement query).
  const [openedFromReports, setOpenedFromReports] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleteAnimKey, setDeleteAnimKey] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const [pendingVoidAction, setPendingVoidAction] = useState(null) // 'void' | 'unvoid' | null
  const [hasEntered, setHasEntered] = useState(false)

  useEffect(() => {
    let raf2
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setHasEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [])
  const [navFlash, setNavFlash] = useState(null)
  const [showSaveHint, setShowSaveHint] = useState(false)

  const scrollContainerRef = useRef(null)
  const serialFieldRef = useRef(null)
  const dateRef = useRef(null)
  const [isSerialFieldVisible, setIsSerialFieldVisible] = useState(true)

  // Scrolls the form back to the very top (so WTS No., the first
  // field, is back in view) and moves focus to Date, per explicit
  // request - called after every Save/Update/Delete.
  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    dateRef.current?.focus({ preventScroll: true })
  }

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

  // WTS is an internal warehouse document, signed off by whoever
  // actually supervises that warehouse - NOT necessarily whoever is
  // logged in and doing the encoding (an assistant, another supervisor
  // covering, etc). Same lookup Piles.jsx's own BIN Card export already
  // uses to find the real assigned supervisor for a warehouse, falling
  // back to an MPO III/Acting MPO III assignment (per explicit request
  // - some warehouses' "supervisor" role is really an MPO position).
  // Name is prefixed "WS "/"Acting WS "/"MPO III "/"Acting MPO III " -
  // same convention as every other place that credits one of these
  // users (see customerDirectory.js's formatRolePrefixedName) - per
  // explicit request this must always show, not just inside the
  // Customer Name autocomplete's own suggestion list. Falls back to the
  // logged-in user's own (unprefixed) name only if no supervisor or MPO
  // is assigned yet, so this never shows blank.
  const supervisorName = useLiveQuery(async () => {
    if (!currentWarehouseId) return null
    const supervisors = await db.users
      .where('role').anyOf(['Warehouse Supervisor', 'Acting Warehouse Supervisor', 'MPO III', 'Acting MPO III'])
      .and((u) => (u.assignedWarehouses ?? []).includes(currentWarehouseId))
      .toArray()
    const supervisor = supervisors.find((u) => u.role.includes('Warehouse Supervisor')) ?? supervisors[0]
    return supervisor ? formatRolePrefixedName(supervisor) : null
  }, [currentWarehouseId])

  // A pile that's already closed/zeroed stays out of the picker for a
  // transfer dated on or after that point - a backdated entry against
  // its still-active period remains selectable.
  const sortedPiles = [...(piles ?? [])]
    .filter((p) => {
      const effectiveCutoff = p.closedDate ?? p.zeroedDate
      return !effectiveCutoff || !date || date <= effectiveCutoff
    })
    .sort((a, b) => byAlpha(a.pileName, b.pileName))
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
      if (cancelled) return
      setSerialNo(s)
      // See StockFormBase.jsx's matching comment - a suggested serial
      // that turns out to already have real data would otherwise show
      // as a silent, wrongly-blank new entry until the user happened to
      // navigate away and back.
      checkAndLoadSerial(s)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWarehouseId])

  useEffect(() => {
    if (!prefill?.serialNo) return
    setSerialNo(prefill.serialNo)
    setOpenedFromReports(true)
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
    setOpenedFromReports(false)
    setIsCancelled(false)
    setSerialNo(nextSerial)
    // Deliberately does NOT reset date back to today - per explicit
    // request, keeps whatever date the user picked across saves/
    // navigation within one encoding session (same fix as
    // StockFormBase.jsx). Only goes back to today when the form is
    // actually closed and reopened (fresh mount).
    setAiNumber('')
    setTransactionTypeId('')
    setMoistureContent('')
    setIssuedSide(emptySide())
    setReceivedSide(emptySide())
  }

  const latestRequestedSerial = useRef(null)

  const checkAndLoadSerial = async (serial) => {
    if (!currentWarehouseId) return false
    latestRequestedSerial.current = serial
    const existing = await findTransactionBySerial('WTS', currentWarehouseId, serial)
    if (latestRequestedSerial.current !== serial) return false
    if (existing) {
      loadTransactionIntoForm(existing)
      return true
    }
    if (latestRequestedSerial.current !== serial) return false
    if (loadedTransaction) setLoadedTransaction(null)
    return false
  }

  const handleSerialChange = async (value) => {
    setSerialNo(value)
    const loaded = await checkAndLoadSerial(value)
    if (!loaded && value.trim() && latestRequestedSerial.current === value) resetForm(value)
  }

  // Walking real document history (findAdjacentTransaction) only makes
  // sense while an actual existing document is loaded - a blank
  // in-progress serial has no "adjacent" record to walk from, so plain
  // ±1 nudging (unchanged) is still the right behavior there. See
  // StockFormBase.jsx's matching handlers for the full reasoning.
  const handleStepBack = async () => {
    let prev
    if (loadedTransaction) {
      const adjacent = await findAdjacentTransaction('WTS', currentWarehouseId, serialNo.trim(), null, -1)
      prev = adjacent ? adjacent.serialNo : stepSerial(serialNo.trim(), -1)
    } else {
      prev = stepSerial(serialNo.trim(), -1)
    }
    setSerialNo(prev)
    setNavFlash('back')
    setTimeout(() => setNavFlash(null), 750)
    await checkAndLoadSerial(prev)
  }

  const handleStepForward = async () => {
    // findAdjacentTransaction only knows about transactions already
    // synced to THIS device - falling back straight to
    // suggestNextSerial when it finds nothing skips the Sheet lookup
    // checkAndLoadSerial below still does for real historical/imported
    // data this device hasn't preloaded, dead-ending forward
    // navigation on data that genuinely exists, just not locally yet.
    // See StockFormBase.jsx's matching handler for the full reasoning.
    const wasLoaded = Boolean(loadedTransaction)
    let next
    if (wasLoaded) {
      const adjacent = await findAdjacentTransaction('WTS', currentWarehouseId, serialNo.trim(), null, 1)
      next = adjacent ? adjacent.serialNo : stepSerial(serialNo.trim(), 1)
    } else {
      next = stepSerial(serialNo.trim(), 1)
    }
    setSerialNo(next)
    setNavFlash('forward')
    setTimeout(() => setNavFlash(null), 750)
    const loaded = await checkAndLoadSerial(next)
    if (loaded || latestRequestedSerial.current !== next) return
    if (wasLoaded) {
      const suggested = await suggestNextSerial('WTS', currentWarehouseId)
      if (latestRequestedSerial.current !== next) return
      setSerialNo(suggested)
      resetForm(suggested)
    } else {
      resetForm(next)
    }
  }

  const handleSelectAuthority = (authority) => {
    setAiNumber(authority.aiNumber ?? '')
    setShowAuthorityPicker(false)
    if (authority.transactionTypeName) {
      const match = sortedTxTypes.find((t) => t.name === authority.transactionTypeName)
      if (match) setTransactionTypeId(match.transactionTypeId)
    }
  }

  const buildCancelledPayload = (overrides = {}) => ({
    type: 'WTS',
    serialNo: serialNo.trim(),
    status: 'Cancelled',
    date,
    warehouseId: currentWarehouseId,
    createdByName: supervisorName ?? user?.name ?? null,
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
      // WTS has no real "customer" - it's an internal transfer, so the
      // warehouse's actual assigned supervisor stands in for it on
      // reports (see wtsAdapter.js's normalizeWtsSide), same as who
      // really signs the paper form. Falls back to the logged-in user
      // only if this warehouse has no supervisor configured yet.
      createdByName: supervisorName ?? user?.name ?? null,
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
        const newBags = Math.max(0, (pile.currentBags ?? 0) - tx.issuedBags)
        const newKilos = Math.max(0, round3((pile.currentKilos ?? 0) - (tx.issuedNetKilos ?? 0)))
        await db.piles.update(pile.pileId, {
          currentBags: newBags,
          currentKilos: newKilos,
          ...deriveZeroedDateUpdate(pile, newBags, newKilos),
        })
      }
    }
    if (tx.receivedPileId && tx.receivedBags != null) {
      const pile = await db.piles.get(tx.receivedPileId)
      if (pile) {
        const newBags = (pile.currentBags ?? 0) + tx.receivedBags
        const newKilos = round3((pile.currentKilos ?? 0) + (tx.receivedNetKilos ?? 0))
        await db.piles.update(pile.pileId, {
          currentBags: newBags,
          currentKilos: newKilos,
          ...deriveZeroedDateUpdate(pile, newBags, newKilos),
        })
      }
    }
  }

  const reverseWtsFromPiles = async (tx) => {
    if (tx.issuedPileId && tx.issuedBags != null) {
      const pile = await db.piles.get(tx.issuedPileId)
      if (pile) {
        const newBags = (pile.currentBags ?? 0) + tx.issuedBags
        const newKilos = round3((pile.currentKilos ?? 0) + (tx.issuedNetKilos ?? 0))
        await db.piles.update(pile.pileId, {
          currentBags: newBags,
          currentKilos: newKilos,
          ...deriveZeroedDateUpdate(pile, newBags, newKilos),
        })
      }
    }
    if (tx.receivedPileId && tx.receivedBags != null) {
      const pile = await db.piles.get(tx.receivedPileId)
      if (pile) {
        const newBags = Math.max(0, (pile.currentBags ?? 0) - tx.receivedBags)
        const newKilos = Math.max(0, round3((pile.currentKilos ?? 0) - (tx.receivedNetKilos ?? 0)))
        await db.piles.update(pile.pileId, {
          currentBags: newBags,
          currentKilos: newKilos,
          ...deriveZeroedDateUpdate(pile, newBags, newKilos),
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
    // Locks IMMEDIATELY, before validate() even runs - not after. A
    // second rapid tap (a real, confirmed mobile pattern - see
    // StockFormBase.jsx's identical fix) could otherwise pass validate()
    // in parallel with the first tap, BOTH seeing the typed serial as
    // still free (isSerialTaken hasn't been written yet by either), and
    // create two real WTS records sharing the same serial number - the
    // exact "duplicate WTS" reported.
    if (isSaving) return
    setIsSaving(true)
    if (!(await validate())) { setIsSaving(false); return }
    // createdAt set ONLY here (create) - never touched by the update
    // path. See serialNumber.js's compareByRecency for why this
    // exists - `date` alone can't disambiguate two series used on the
    // same calendar day.
    const tx = { id: crypto.randomUUID(), ...buildPayload(), createdAt: Date.now() }
    await db.transactions.add(tx)
    await recordSerialUsed('WTS', currentWarehouseId, serialNo.trim(), null, { date: tx.date, createdAt: tx.createdAt })
    await applyWtsToPiles(tx)
    toast.success(`WTS saved — ${serialNo.trim()}`)
    // suggestNextSerial (date-aware, per the just-recorded save above)
    // instead of a blind ±1 - see StockFormBase.jsx's matching change
    // for the full reasoning.
    resetForm(await suggestNextSerial('WTS', currentWarehouseId))
    setIsSaving(false)
    scrollToTop()
  }

  const handleUpdate = async () => {
    // Same race-window fix as handleSave.
    if (isSaving) return
    setIsSaving(true)
    if (!(await validate(loadedTransaction.id))) { setIsSaving(false); return }
    await reverseWtsFromPiles(loadedTransaction)
    const updated = buildPayload({ id: loadedTransaction.id })
    await db.transactions.update(loadedTransaction.id, updated)
    await applyWtsToPiles(updated)
    toast.success(`WTS ${serialNo.trim()} updated`)
    setLoadedTransaction(updated)
    setIsSaving(false)
    scrollToTop()
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
    scrollToTop()
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
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 transition-all duration-[350ms] ${hasEntered && isOpen ? 'scale-100 opacity-100 ease-[cubic-bezier(0.34,1.56,0.64,1)]' : 'scale-95 opacity-0 ease-in'}`}>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">WTS</h1>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        {sortedWarehouses.length > 1 && !openedFromReports ? (
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
        <AnimatedBanner show={isEditMode} className="rounded-xl border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
          Reviewing WTS {loadedTransaction?.serialNo} — Update or Delete below.
        </AnimatedBanner>

        <div ref={serialFieldRef}>
          <label className={labelClass}>WTS No.</label>
          <div className="mt-1 flex items-center gap-2">
            {openedFromReports ? (
              <input
                type="text"
                value={serialNo}
                readOnly
                disabled
                className={`mt-0 w-full rounded-xl border bg-neutral-800 px-3 py-2 text-center font-mono text-neutral-400 outline-none ${!serialNo.trim() ? '!border-brand-amber' : 'border-neutral-800'}`}
              />
            ) : (
              <>
                <button type="button" onClick={handleStepBack} aria-label="Previous WTS"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 active:scale-90">
                  <ChevronLeft size={18} />
                </button>
                <div className="relative w-full">
                  <input type="text" value={serialNo} onChange={(e) => handleSerialChange(e.target.value)}
                    className={`mt-0 w-full rounded-xl border bg-neutral-950 px-3 py-2 text-center font-mono outline-none transition-colors focus:border-brand-neon ${!serialNo.trim() ? '!border-brand-amber' : 'border-neutral-800'} ${navFlash ? 'text-transparent' : 'text-app-text'}`} />
                  <SerialCrossfadeOverlay value={serialNo} navFlash={navFlash} />
                </div>
                <button type="button" onClick={handleStepForward} aria-label="Next WTS"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 active:scale-90">
                  <ChevronRight size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className={`space-y-3 rounded-xl transition-opacity ${isCancelled ? 'border-2 border-brand-crimson p-2 opacity-40' : ''} ${navFlash ? 'stagger-fields' : ''}`}>
        <div>
          <label className={labelClass}>Date</label>
          <CalendarDatePicker ref={dateRef} value={date} onChange={setDate} />
        </div>

        <div>
          <label className={labelClass}>AI No.</label>
          <div className="flex gap-2">
            <input type="text" value={aiNumber} onChange={(e) => setAiNumber(e.target.value)}
              className={`${inputClass} ${!aiNumber.trim() ? '!border-brand-amber' : ''}`} placeholder="26219637" />
            <button
              type="button"
              onClick={() => setShowAuthorityPicker(true)}
              className="shrink-0 rounded-xl border border-brand-neon/40 px-3 text-xs font-medium text-brand-neon"
            >
              Browse
            </button>
          </div>
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

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-900 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {isEditMode ? (
          <div className="flex gap-3">
            <button type="button" onClick={handleUpdate} disabled={isSaving}
              className="relative flex-1 rounded-xl bg-brand-neon py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50">
              <UpdateButtonContent isSaving={isSaving} />
            </button>
            <button type="button" onClick={() => { setDeleteAnimKey((k) => k + 1); setPendingDelete(true) }} disabled={isSaving}
              className="flex-1 rounded-xl bg-brand-crimson py-3 text-sm font-semibold text-app-text transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50">
              <DeleteButtonLabel incrementKey={deleteAnimKey} />
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
              <SaveButtonLabel isSaving={isSaving} />
            </button>
            {showSaveHint && !canSave && (
              <p className="mt-1 text-center text-xs text-brand-amber">Please complete all required fields.</p>
            )}
          </div>
        )}
      </div>

      {showAuthorityPicker && currentWarehouseId && (
        <AuthorityPickerModal
          type="AI"
          warehouseId={currentWarehouseId}
          onSelect={handleSelectAuthority}
          onClose={() => setShowAuthorityPicker(false)}
        />
      )}

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
