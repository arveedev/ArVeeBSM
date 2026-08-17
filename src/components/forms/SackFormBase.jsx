// Sack Form Base — shared by ESR and ESI.
//
// Field order:
//  1. Serial No. — manual, suggested starting value scoped to THIS
//     warehouse's own document series, "<"/"+" navigation (see below).
//  2. Date (opens picker on tap anywhere in the field)
//  3. Linked document number, right under Date:
//       ESR -> "ESI No." (informational)
//       ESI -> "SIA No." (deducts pieces from db.authorities on save)
//  4. Customer Name — autocomplete, address auto-fill
//  5. Address (optional, auto-filled from customer directory)
//  6. Nature of Transaction (sorted alphabetically)
//  7. Repeatable Sack Lines — Sack Code, Condition, Pieces; "Add line".
//     If a sack code has only one condition, it auto-selects. For ESI,
//     pieces is a hard cap per warehouse/sackType/condition combo,
//     mirroring how Net Kilos hard-caps a WSI - available pieces are
//     shown live per line, and exceeding them blocks save entirely.
//
// SERIES NAVIGATION: identical pattern to StockFormBase — every warehouse
// keeps its own serial pool per document type. Stepping back ("<") onto a
// serial that already has Active data for this (type, warehouse) loads it
// for review, switching the footer to Update/Delete. Typing a serial
// directly that matches existing data does the same.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Plus, X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { SaveButtonLabel, UpdateButtonContent, DeleteButtonLabel } from '../common/AnimatedButtonBits.jsx'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { db } from '../../db/dexie.js'
import {
  suggestNextSerial,
  isSerialTaken,
  getMatchingTransaction,
  stepSerial,
  findTransactionBySerial,
  recordSerialUsed,
  recalculateSerialCounter,
} from '../../utils/serialNumber.js'
import { rememberCustomer } from '../../utils/customerDirectory.js'
import { fetchTransactionBySerial, mapSheetRowToTransaction, fetchSerialFloorFromSheet, markMillingOrderDone } from '../../services/googleSheetsBridge.js'
import { isPreloadComplete } from '../../services/transactionPreload.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { queueTransactionDeletion, pauseTransactionSync, resumeTransactionSync } from '../../services/syncWorker.js'
import { liveFormatNumber, parseFormattedNumber, fmtBags, todayLocalISO, isMillingTypeName, isTestMillingTypeName, isAuthorityComplete } from '../../utils/calculations.js'
import CustomerNameAutocomplete from './CustomerNameAutocomplete.jsx'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
import AnimatedBanner from '../common/AnimatedBanner.jsx'
import SerialCrossfadeOverlay from '../common/SerialCrossfadeOverlay.jsx'
import CalendarDatePicker from '../common/CalendarDatePicker.jsx'
import AuthorityPickerModal from './AuthorityPickerModal.jsx'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  smallButtonClass,
  removeButtonClass,
} from './shared.js'

const SACK_CONDITION_CODES = ['BN', 'SH', 'US']
const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

// Display-only, mirrors StockFormBase.jsx exactly - see that file for
// the full explanation. Never alters the underlying stored value.
const stripMoTmoPrefix = (value) => (value ?? '').replace(/^(MO|TMO)\s*No\.?\s*/i, '').trim() || value
const emptySackLine = () => ({ sackTypeId: '', condition: '', pieces: '' })

const SackFormBase = forwardRef(function SackFormBase(
  { type, title, linkedDocLabel, onClose, prefill, isOpen = true },
  ref
) {
  // Same reasoning as StockFormBase.jsx's identical fix.
  useEffect(() => {
    pauseTransactionSync()
    return () => resumeTransactionSync()
  }, [])

  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}

  const [serialNo, setSerialNo] = useState('')
  const [date, setDate] = useState(todayLocalISO())
  const [linkedDocNo, setLinkedDocNo] = useState('')
  const [linkedAuthorityDate, setLinkedAuthorityDate] = useState(null)
  const [showAuthorityPicker, setShowAuthorityPicker] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [transactionTypeId, setTransactionTypeId] = useState('')
  const [sackLines, setSackLines] = useState([emptySackLine()])
  const [moNumber, setMoNumber] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [tmoNumber, setTmoNumber] = useState('')
  const [trialNumber, setTrialNumber] = useState('')
  const [pendingTrial3Confirm, setPendingTrial3Confirm] = useState(false)
  const [unresolvedSiaHint, setUnresolvedSiaHint] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin'
  const [floorSerialNumber, setFloorSerialNumber] = useState(null)
  const [showFloorWarning, setShowFloorWarning] = useState(false)
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
  const [pendingVoidAction, setPendingVoidAction] = useState(null) // 'void' | 'unvoid' | null
  const [navFlash, setNavFlash] = useState(null)
  const [warehouseChangeFlash, setWarehouseChangeFlash] = useState(false)
  const [showSaveHint, setShowSaveHint] = useState(false)

  const [loadedTransaction, setLoadedTransaction] = useState(null)
  // Same as StockFormBase.jsx - locks serial navigation only when
  // opened from Reports, not the normal create-new flow.
  const [openedFromReports, setOpenedFromReports] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleteAnimKey, setDeleteAnimKey] = useState(0)

  const customerNameRef = useRef(null)
  const dateRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const serialFieldRef = useRef(null)
  const [isSerialFieldVisible, setIsSerialFieldVisible] = useState(true)

  // Tracks whether the actual Serial No. field is currently scrolled
  // into view within the form's own scroll container - drives the
  // sticky "{type} # {serialNo}" indicator shown near the top when the
  // user has scrolled far enough down that they can no longer see
  // which document they're actually filling in.
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

  useImperativeHandle(ref, () => ({
    focus: () => customerNameRef.current?.focus(),
  }))

  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), [])

  // Needed here, ahead of takenTrialNumbers below (the earliest
  // consumer in this file) - a useLiveQuery callback runs IMMEDIATELY
  // on mount, so referencing isMilling/isTestMilling before their
  // declaration point would throw a temporal-dead-zone
  // ReferenceError on every single render. (An earlier fix moved this
  // ahead of linkedMillingOrder only, missing that takenTrialNumbers
  // sits even earlier in the file.)
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), [])
  const selectedTransactionType = (transactionTypes ?? []).find((t) => t.transactionTypeId === transactionTypeId)
  const isMilling = isMillingTypeName(selectedTransactionType?.name)
  const isTestMilling = isTestMillingTypeName(selectedTransactionType?.name)

  // Which trial numbers (1/2/3) already exist for this TMO, across
  // EVERY warehouse, tracked independently per document type (ESI vs
  // ESR each need their own complete set of 3) - same approach as the
  // stock side.
  const takenTrialNumbers = useLiveQuery(async () => {
    if (!isTestMilling || !tmoNumber.trim()) return []
    const existing = await db.transactions
      .where('tmoNumber').equals(tmoNumber.trim())
      .and((t) => t.status === 'Active' && t.type === type && (!loadedTransaction || t.id !== loadedTransaction.id))
      .toArray()
    return [...new Set(existing.map((t) => t.trialNumber).filter(Boolean))]
  }, [isTestMilling, tmoNumber, type, loadedTransaction]) ?? []

  // Available MO/TMO numbers from the synced reference data, with
  // fulfillment computed - same logic as the stock side, just matched
  // against sack pieces (summed across sackLines) instead of net kilos.
  const millingOrderOptions = useLiveQuery(async () => {
    if (!isMilling && !isTestMilling) return []
    const orderType = isMilling ? 'MO' : 'TMO'
    const orders = await db.millingOrders.where('type').equals(orderType).toArray()
    const numberField = isMilling ? 'moNumber' : 'tmoNumber'

    const allRelevantTx = await db.transactions
      .where(numberField).anyOf(orders.map((o) => o.number))
      .and((t) => t.status === 'Active')
      .toArray()

    const sumPieces = (t) => (t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0)

    return orders.map((order) => {
      const forThisOrder = allRelevantTx.filter((t) => t[numberField] === order.number)

      if (isMilling) {
        const issuedPieces = forThisOrder.filter((t) => t.type === 'ESI').reduce((s, t) => s + sumPieces(t), 0)
        const receivedPieces = forThisOrder.filter((t) => t.type === 'ESR').reduce((s, t) => s + sumPieces(t), 0)
        const expectedPieces = order.recoveryPercent != null ? issuedPieces * (order.recoveryPercent / 100) : null
        const fulfilled = expectedPieces != null && expectedPieces > 0 && receivedPieces >= expectedPieces
        return { ...order, issuedPieces, receivedPieces, expectedPieces, fulfilled }
      }

      const recoveredTrials = new Set(
        forThisOrder.filter((t) => t.type === 'ESR' && sumPieces(t) > 0).map((t) => t.trialNumber)
      )
      const allThreeRecovered = ['1', '2', '3'].every((n) => recoveredTrials.has(n))
      const fulfilled = allThreeRecovered && order.trial3Confirmed === true
      return { ...order, recoveredTrials: [...recoveredTrials], fulfilled }
    })
  }, [isMilling, isTestMilling]) ?? []

  // Available pieces per sackTypeId+condition for this warehouse - the
  // hard cap on ESI issuances, mirroring how Net Kilos hard-caps a WSI.
  // sackInventory is the beginning-balance seed (no date, always
  // counted); ESR/ESI transactions add/subtract from there. If editing
  // an existing ESI, its own prior effect is excluded so re-saving the
  // same document doesn't count itself as already deducted.
  const sackInventory = useLiveQuery(
    () => currentWarehouseId ? db.sackInventory.where('warehouseId').equals(currentWarehouseId).toArray() : [],
    [currentWarehouseId]
  ) ?? []
  const allSackTx = useLiveQuery(
    () => currentWarehouseId
      ? db.transactions.where('warehouseId').equals(currentWarehouseId)
          .and((t) => ['ESR', 'ESI'].includes(t.type) && t.status === 'Active').toArray()
      : [],
    [currentWarehouseId]
  ) ?? []

  const availablePieces = {}
  const addAvailable = (sackTypeId, condition, delta) => {
    const key = `${sackTypeId}::${condition}`
    availablePieces[key] = (availablePieces[key] ?? 0) + delta
  }
  const asOfDateByKey = {}
  for (const rec of sackInventory) {
    addAvailable(rec.sackTypeId, rec.condition, rec.pieces ?? 0)
    asOfDateByKey[`${rec.sackTypeId}::${rec.condition}`] = rec.asOfDate ?? null
  }
  for (const t of allSackTx) {
    if (loadedTransaction && t.id === loadedTransaction.id) continue
    const sign = t.type === 'ESR' ? 1 : -1
    for (const line of t.sackLines ?? []) {
      const key = `${line.sackTypeId}::${line.condition}`
      const cutoff = asOfDateByKey[key]
      // A transaction dated before the beginning balance's own as-of
      // date is pre-seed history, already accounted for in the seed
      // value itself - counting it again here would double-count it.
      if (cutoff && t.date < cutoff) continue
      addAvailable(line.sackTypeId, line.condition, (line.pieces ?? 0) * sign)
    }
  }
  const getAvailablePieces = (sackTypeId, condition) => availablePieces[`${sackTypeId}::${condition}`] ?? 0

  // Live lookup of the linked SIA authority, so each sack line's own
  // remaining balance can be shown while filling out an issuance -
  // only relevant for ESI, matched against the authority's own
  // sackLines array (one SIA covers every sack type/condition
  // together, per the confirmed architecture).
  const linkedSiaAuthority = useLiveQuery(async () => {
    if (type !== 'ESI' || !linkedDocNo.trim()) return null
    return db.authorities.where('siaNumber').equals(linkedDocNo.trim()).and((a) => a.type === 'SIA').first()
  }, [type, linkedDocNo])

  // Per the correct operational flow: it always starts with the SIA,
  // especially for issuance. When the selected SIA is for a Milling or
  // Test Milling operation, the MO/TMO number, batch, and miller name
  // are DERIVED from that SIA - not picked independently. Only applies
  // to the issue side (ESI); the receipt side (ESR) has no SIA of its
  // own to key off, so it keeps its own MO/TMO picker.
  const linkedMillingOrder = useLiveQuery(async () => {
    if (type === 'ESR' || !linkedSiaAuthority?.siaNumber) return null
    if (!isMilling && !isTestMilling) return null
    return db.millingOrders
      .where('type').equals(isMilling ? 'MO' : 'TMO')
      .and((o) => o.siaNumber === linkedSiaAuthority.siaNumber)
      .first()
  }, [type, linkedSiaAuthority?.siaNumber, isMilling, isTestMilling])

  useEffect(() => {
    if (type === 'ESR' || (!isMilling && !isTestMilling)) return
    if (linkedMillingOrder) {
      // A fresh match found - always applies, even during edit. See
      // StockFormBase.jsx's identical fix for the full explanation.
      if (isMilling) {
        setMoNumber(linkedMillingOrder.number)
        setBatchNumber(linkedMillingOrder.batchCurrent != null ? String(linkedMillingOrder.batchCurrent) : '')
      } else if (isTestMilling) {
        setTmoNumber(linkedMillingOrder.number)
      }
      if (linkedMillingOrder.ricemillName) setCustomerName(linkedMillingOrder.ricemillName)
    } else {
      // No fresh match - protects an existing historical value from
      // being wiped out, but only when one already exists.
      if (loadedTransaction && (isMilling ? loadedTransaction.moNumber : loadedTransaction.tmoNumber)) return
      // The SIA changed (or was cleared) and no longer matches any
      // MO/TMO - clear whatever was previously derived rather than
      // leaving a stale, now-mismatched number sitting in the form.
      if (isMilling) { setMoNumber(''); setBatchNumber('') }
      else if (isTestMilling) setTmoNumber('')
    }
  }, [linkedMillingOrder, isMilling, isTestMilling, type, loadedTransaction])

  const getSiaRemainingPieces = (sackTypeId, condition) => {
    const line = linkedSiaAuthority?.sackLines?.find((l) => l.sackTypeId === sackTypeId && l.condition === condition)
    if (!line || line.totalAllocationBags == null) return null
    return Math.max(0, line.totalAllocationBags - (line.totalIssuedBags ?? 0))
  }

  const sortedSackTypes = [...(sackTypes ?? [])].sort((a, b) => byAlpha(a.code, b.code))
  const sackTypeMap = new Map((sackTypes ?? []).map((s) => [s.sackTypeId, s]))
  const sortedTransactionTypes = [...(transactionTypes ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  useEffect(() => {
    if (loadedTransaction) return
    if (prefill?.serialNo) return
    if (!currentWarehouseId) return
    let cancelled = false
    suggestNextSerial(type, currentWarehouseId).then((serial) => {
      if (!cancelled) setSerialNo(serial)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currentWarehouseId])

  const localTxForFloor = useLiveQuery(
    () => currentWarehouseId
      ? db.transactions.where('type').equals(type).and((tx) => tx.warehouseId === currentWarehouseId).toArray()
      : Promise.resolve([]),
    [type, currentWarehouseId]
  )
  const localFloorMin = (() => {
    if (!localTxForFloor) return null
    let min = null
    for (const tx of localTxForFloor) {
      const num = parseInt(String(tx.serialNo ?? '').replace(/\D/g, ''), 10)
      if (Number.isNaN(num)) continue
      if (min === null || num < min) min = num
    }
    return min
  })()

  useEffect(() => {
    if (!currentWarehouseId) { setFloorSerialNumber(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const preloaded = await isPreloadComplete(currentWarehouseId, type)
        let sheetMin = null
        if (!preloaded) {
          const sheetResult = await fetchSerialFloorFromSheet(type, currentWarehouse?.name)
          sheetMin = sheetResult.ok ? sheetResult.min : null
        }
        const candidates = [localFloorMin, sheetMin].filter((n) => n != null)
        const floor = candidates.length > 0 ? Math.min(...candidates) : null
        if (!cancelled) setFloorSerialNumber(floor)
      } catch (err) {
        console.error(`Floor calculation failed for ${type} (warehouse ${currentWarehouseId}):`, err)
        if (!cancelled) setFloorSerialNumber(localFloorMin)
      }
    })()
    return () => { cancelled = true }
  }, [type, currentWarehouseId, currentWarehouse?.name, localFloorMin])

  useEffect(() => {
    if (!prefill) return
    if (prefill.customerName) setCustomerName(prefill.customerName)
    if (prefill.linkedDocNo) setLinkedDocNo(prefill.linkedDocNo)
    if (prefill.authorityDate) setLinkedAuthorityDate(prefill.authorityDate)
    if (prefill.serialNo) {
      setSerialNo(prefill.serialNo)
      setOpenedFromReports(true)
      setTimeout(() => checkAndLoadSerial(prefill.serialNo), 150)
    }
    if (prefill.sackLines?.length) {
      setSackLines(
        prefill.sackLines.map((l) => ({
          sackTypeId: l.sackTypeId,
          condition: l.condition,
          pieces: l.pieces != null ? liveFormatNumber(String(l.pieces)) : '',
        }))
      )
    } else if (prefill.sackTypeId && prefill.condition) {
      setSackLines([{
        sackTypeId: prefill.sackTypeId,
        condition: prefill.condition,
        pieces: prefill.pieces != null ? liveFormatNumber(String(prefill.pieces)) : '',
      }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // transactionTypes loads asynchronously - this retries once it
  // arrives, guarded so it only applies once per prefill instance
  // (same reasoning as StockFormBase's equivalent fix).
  const appliedTransactionTypeRef = useRef(null)

  useEffect(() => {
    if (!prefill?.transactionTypeName) return
    if (appliedTransactionTypeRef.current === prefill.transactionTypeName) return
    const match = (transactionTypes ?? []).find((t) => t.name === prefill.transactionTypeName)
    if (!match) return
    setTransactionTypeId(match.transactionTypeId)
    appliedTransactionTypeRef.current = prefill.transactionTypeName
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.transactionTypeName, transactionTypes])

  const conditionsFor = (sackTypeId) => {
    const sackType = sortedSackTypes.find((s) => s.sackTypeId === sackTypeId)
    if (!sackType) return []
    return SACK_CONDITION_CODES.filter((c) => sackType.weights?.[c] != null)
  }

  const updateLine = (index, field, value) => {
    setSackLines((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row
        const next = { ...row, [field]: value }
        if (field === 'sackTypeId') {
          const available = conditionsFor(value)
          next.condition = available.length === 1 ? available[0] : ''
        }
        return next
      })
    )
  }
  const addLine = () => setSackLines((rows) => [...rows, emptySackLine()])
  const removeLine = (index) => {
    setSackLines((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))
  }

  const totalPieces = sackLines.reduce((sum, l) => sum + parseFormattedNumber(l.pieces), 0)

  const handleCustomerMatch = (customer) => {
    const warehouseSpecificAddress = customer.addressesByWarehouse?.[currentWarehouseId]
    if (warehouseSpecificAddress) setCustomerAddress(warehouseSpecificAddress)
    else if (customer.address) setCustomerAddress(customer.address)
  }

  const handleSelectAuthority = (authority) => {
    setLinkedDocNo(authority.siaNumber ?? '')
    setLinkedAuthorityDate(authority.date ?? null)
    setCustomerName(authority.customerName ?? '')
    if (authority.transactionTypeName) {
      const match = (transactionTypes ?? []).find((t) => t.name === authority.transactionTypeName)
      if (match) setTransactionTypeId(match.transactionTypeId)
    }

    // A sack-type/condition line whose Pieces cell is still blank on the
    // sheet (totalAllocationBags null/0, never issued against) must
    // still show up here with an empty pieces field for the user to
    // fill in - only a line whose real allocation has been fully used
    // up should actually drop off the list.
    const remainingLines = (authority.sackLines ?? [])
      .filter((l) => l.sackTypeId && l.condition)
      .map((l) => {
        const hasAllocation = l.totalAllocationBags != null && l.totalAllocationBags > 0
        const remaining = hasAllocation ? Math.max(0, l.totalAllocationBags - (l.totalIssuedBags ?? 0)) : null
        return { sackTypeId: l.sackTypeId, condition: l.condition, hasAllocation, remaining }
      })
      .filter((l) => !l.hasAllocation || l.remaining > 0)

    if (remainingLines.length > 0) {
      setSackLines(remainingLines.map((l) => ({
        sackTypeId: l.sackTypeId,
        condition: l.condition,
        pieces: l.hasAllocation ? liveFormatNumber(String(l.remaining)) : '',
      })))
    }

    setShowAuthorityPicker(false)
  }

  // Scrolls the form back to the very top (so Serial No., the first
  // field, is back in view) and moves focus to Date, per explicit
  // request - called after every Save/Update/Delete. Distinct from
  // this component's externally-exposed imperative `focus()` (still
  // Customer Name, used when the form first opens).
  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    dateRef.current?.focus({ preventScroll: true })
  }

  const loadTransactionIntoForm = (tx) => {
    setLoadedTransaction(tx)
    setIsCancelled(tx.status === 'Cancelled')
    setDate(tx.date ?? todayLocalISO())
    setLinkedDocNo(tx.linkedDocNo ?? tx.siaNumber ?? '')
    setCustomerName(tx.customerName ?? '')
    setCustomerAddress(tx.customerAddress ?? '')
    setTransactionTypeId(tx.transactionTypeId ?? '')
    setMoNumber(tx.moNumber ?? '')
    setBatchNumber(tx.batchNumber ?? '')
    setTmoNumber(tx.tmoNumber ?? '')
    setTrialNumber(tx.trialNumber ?? '')
    setSackLines(
      tx.sackLines?.length
        ? tx.sackLines.map((l) => ({
            sackTypeId: l.sackTypeId,
            condition: l.condition,
            pieces: liveFormatNumber(String(l.pieces)),
          }))
        : [emptySackLine()]
    )
  }

  const resetToBlankEntry = (nextSerial) => {
    setLoadedTransaction(null)
    setOpenedFromReports(false)
    setIsCancelled(false)
    setSerialNo(nextSerial)
    setDate(todayLocalISO())
    setLinkedDocNo('')
    setLinkedAuthorityDate(null)
    setCustomerName('')
    setCustomerAddress('')
    setTransactionTypeId('')
    setMoNumber('')
    setBatchNumber('')
    setTmoNumber('')
    setTrialNumber('')
    setSackLines([emptySackLine()])
  }

  const latestRequestedSerial = useRef(null)
  const [isLookingUp, setIsLookingUp] = useState(false)

  const checkAndLoadSerial = async (serial) => {
    if (!currentWarehouseId) return false
    latestRequestedSerial.current = serial
    setIsLookingUp(true)
    try {
      const existing = await findTransactionBySerial(type, currentWarehouseId, serial)
      if (latestRequestedSerial.current !== serial) return false
      if (existing) {
        loadTransactionIntoForm(existing)

        // Sheet backfill runs as a genuine background task - never
        // awaited before returning, so the instant local-data display
        // above is never delayed by a network round-trip.
        const missingMillingFields = (existing.aiNumber || existing.linkedDocNo)
          && !existing.moNumber && !existing.tmoNumber
        if (missingMillingFields && navigator.onLine) {
          fetchTransactionBySerial(type, currentWarehouse?.name, serial).then(async (sheetResult) => {
            if (latestRequestedSerial.current !== serial) return // user has since moved on - discard
            if (!sheetResult.ok || !sheetResult.row) return
            const patch = {}
            if (sheetResult.row['MO Number']) patch.moNumber = sheetResult.row['MO Number']
            if (sheetResult.row['TMO Number']) patch.tmoNumber = sheetResult.row['TMO Number']
            if (sheetResult.row['Batch Number']) patch.batchNumber = sheetResult.row['Batch Number']
            if (sheetResult.row['Trial Number']) patch.trialNumber = sheetResult.row['Trial Number']
            if (Object.keys(patch).length === 0) return
            await db.transactions.update(existing.id, patch)
            if (latestRequestedSerial.current !== serial) return // moved on while this was saving - discard
            loadTransactionIntoForm({ ...existing, ...patch })
          }).catch(() => {}) // best-effort - local data is already showing regardless
        }
        return true
      }

      // Not found locally - trusts preload-completeness for speed,
      // consistent with StockFormBase.jsx's identical revert. Becomes
      // largely moot once serial-typing navigation is removed.
      const preloaded = await isPreloadComplete(currentWarehouseId, type)
      const sheetResult = preloaded
        ? { ok: true, row: null }
        : await fetchTransactionBySerial(type, currentWarehouse?.name, serial)
      if (latestRequestedSerial.current !== serial) return false
      if (sheetResult.ok && sheetResult.row) {
        const transactionTypesByName = new Map((transactionTypes ?? []).map((t) => [t.name.trim().toLowerCase(), t.transactionTypeId]))
        const imported = mapSheetRowToTransaction(type, sheetResult.row, { warehouseId: currentWarehouseId, transactionTypesByName })
        await db.transactions.add(imported)
        await recordSerialUsed(type, currentWarehouseId, serial)
        if (latestRequestedSerial.current !== serial) return false
        loadTransactionIntoForm(imported)
        if (imported.needsCompletion) {
          toast('Pulled from historical Sheet data - the sack breakdown by type/condition was not tracked there and needs to be entered before saving further changes.', { icon: '📋', duration: 6000 })
        }
        return true
      }

      if (latestRequestedSerial.current !== serial) return false
      if (loadedTransaction) setLoadedTransaction(null)
      return false
    } finally {
      if (latestRequestedSerial.current === serial) setIsLookingUp(false)
    }
  }

  const handleSerialChange = async (value) => {
    setSerialNo(value)
    resetToBlankEntry(value) // clear immediately - never leave stale data on screen while the lookup is in flight
    const loaded = await checkAndLoadSerial(value)
    if (!loaded && value.trim() && latestRequestedSerial.current === value) resetToBlankEntry(value)
  }

  const handleSerialBlur = () => {
    if (isAdmin || loadedTransaction || floorSerialNumber == null) return
    const typedNumber = parseInt(serialNo.trim().replace(/\D/g, ''), 10)
    if (Number.isNaN(typedNumber)) return
    if (typedNumber < floorSerialNumber) setShowFloorWarning(true)
  }

  const handleStepBack = async () => {
    const prevSerial = stepSerial(serialNo.trim(), -1)
    const prevNumber = parseInt(prevSerial.replace(/\D/g, ''), 10)
    if (!isAdmin && floorSerialNumber != null && !Number.isNaN(prevNumber) && prevNumber < floorSerialNumber) {
      toast.error(`No ${type} records exist before #${floorSerialNumber} for this warehouse`)
      return
    }
    setSerialNo(prevSerial)
    setNavFlash('back')
    setTimeout(() => setNavFlash(null), 750)
    await checkAndLoadSerial(prevSerial)
  }

  const handleFloorWarningAcknowledge = async () => {
    setShowFloorWarning(false)
    const latest = await suggestNextSerial(type, currentWarehouseId)
    setSerialNo(latest)
    await checkAndLoadSerial(latest)
  }

  const handleStepForward = async () => {
    const nextSerial = stepSerial(serialNo.trim(), 1)
    setSerialNo(nextSerial)
    setNavFlash('forward')
    setTimeout(() => setNavFlash(null), 750)
    const loaded = await checkAndLoadSerial(nextSerial)
    if (!loaded && latestRequestedSerial.current === nextSerial) resetToBlankEntry(nextSerial)
  }

  const buildCancelledPayload = (overrides = {}) => ({
    type,
    serialNo: serialNo.trim(),
    status: 'Cancelled',
    date,
    warehouseId: currentWarehouseId,
    customerName: null,
    customerAddress: null,
    transactionTypeId: null,
    sackLines: [],
    linkedDocNo: null,
    siaNumber: null,
    aiNumber: null,
    isSynced: false,
    ...overrides,
  })

  const buildTransactionPayload = (overrides = {}) => (isCancelled ? buildCancelledPayload(overrides) : {
    type,
    serialNo: serialNo.trim(),
    status: 'Active',
    date,
    warehouseId: currentWarehouseId,
    customerName: customerName.trim(),
    customerAddress: customerAddress.trim() || null,
    transactionTypeId: transactionTypeId || null,
    sackLines: sackLines
      .filter((l) => l.sackTypeId && l.condition && l.pieces !== '')
      .map((l) => ({ sackTypeId: l.sackTypeId, condition: l.condition, pieces: parseFormattedNumber(l.pieces) })),
    linkedDocNo: linkedDocNo.trim() || null,
    siaNumber: type === 'ESI' ? linkedDocNo.trim() || null : null,
    aiNumber: null,
    moNumber: isMilling ? moNumber.trim() || null : null,
    batchNumber: isMilling ? batchNumber.trim() || null : null,
    tmoNumber: isTestMilling ? tmoNumber.trim() || null : null,
    trialNumber: isTestMilling ? trialNumber || null : null,
    isSynced: false,
    ...overrides,
  })

  const validateForm = async ({ excludeId = null } = {}) => {
    if (!currentWarehouseId) { toast.error('No warehouse selected'); return false }
    if (!serialNo.trim()) { toast.error('Serial No. is required'); return false }
    if (await isSerialTaken(type, currentWarehouseId, serialNo.trim(), excludeId)) {
      if (!excludeId) {
        const match = await getMatchingTransaction(type, currentWarehouseId, serialNo.trim(), excludeId)
        if (match) {
          loadTransactionIntoForm(match)
          toast.error(`Serial ${serialNo.trim()} already exists - loaded it for you to update instead`)
          return false
        }
      }
      toast.error(`Serial ${serialNo.trim()} is already used for a ${type} document at this warehouse`)
      return false
    }
    if (isCancelled) return true
    if (!customerName.trim()) { toast.error('Name is required'); return false }

    const cleanedLines = sackLines.filter((l) => l.sackTypeId && l.condition && l.pieces !== '')
    if (cleanedLines.length === 0) {
      toast.error('Add at least one line with code, condition, and pieces')
      return false
    }

    if (type === 'ESI') {
      for (const line of cleanedLines) {
        const requested = parseFormattedNumber(line.pieces)
        const available = getAvailablePieces(line.sackTypeId, line.condition)
        if (requested > available) {
          const code = sackTypeMap.get(line.sackTypeId)?.code ?? line.sackTypeId
          toast.error(`Cannot issue ${fmtBags(requested)} ${code} (${line.condition}) - this warehouse only physically has ${fmtBags(available)} in stock (not an SIA balance limit)`)
          return false
        }
      }
    }

    return true
  }

  const buildLineDeltas = (lines, sign) =>
    (lines ?? [])
      .filter((l) => l.sackTypeId && l.condition)
      .map((l) => ({
        sackTypeId: l.sackTypeId,
        condition: l.condition,
        piecesDelta: sign * (typeof l.pieces === 'string' ? parseFormattedNumber(l.pieces) : (l.pieces ?? 0)),
      }))

  const adjustSiaBalance = async (siaNo, lineDeltas) => {
    if (type !== 'ESI' || !siaNo) return
    const authority = await db.authorities.where('siaNumber').equals(siaNo).and((a) => a.type === 'SIA').first()
    if (!authority || !Array.isArray(authority.sackLines)) return

    const updatedLines = authority.sackLines.map((line) => {
      const delta = lineDeltas.find((d) => d.sackTypeId === line.sackTypeId && d.condition === line.condition)
      if (!delta) return line
      return { ...line, totalIssuedBags: (line.totalIssuedBags ?? 0) + delta.piecesDelta }
    })

    await db.authorities.update(authority.authId, { sackLines: updatedLines })
  }

  const performSave = async (trial3Confirmed) => {
    setIsSaving(true)

    const transaction = { id: crypto.randomUUID(), ...buildTransactionPayload() }
    await db.transactions.add(transaction)

    // Sheet-side duplicate-serial check, moved out of the blocking
    // validateForm path (where it used to make every new save wait on
    // a full Apps Script round-trip before the record even hit local
    // IndexedDB) and run here instead, after the local save already
    // succeeded - a genuine cross-device collision is rare enough that
    // catching it a few seconds later with a warning toast is an
    // acceptable trade for not freezing the UI on every single save.
    if (navigator.onLine) {
      fetchTransactionBySerial(type, currentWarehouse?.name, transaction.serialNo).then((sheetCheck) => {
        if (sheetCheck.ok && sheetCheck.row) {
          toast.error(`Serial ${transaction.serialNo} may already exist on the Sheet — please verify before syncing`, { duration: 8000 })
        }
      })
    }

    await Promise.all([
      recordSerialUsed(type, currentWarehouseId, serialNo.trim()),
      rememberCustomer({
        name: customerName.trim(),
        address: customerAddress.trim() || null,
        warehouseId: currentWarehouseId,
      }),
    ])

    if (type === 'ESI' && linkedDocNo.trim()) {
      await adjustSiaBalance(linkedDocNo.trim(), buildLineDeltas(sackLines, 1))
    }

    if (trial3Confirmed) {
      await db.millingOrders.where('orderId').equals(`TMO::${tmoNumber.trim()}`).modify({ trial3Confirmed: true })

      const trialTx = await db.transactions
        .where('tmoNumber').equals(tmoNumber.trim())
        .and((t) => t.type === 'ESR' && t.status === 'Active')
        .toArray()
      const recoveredTrials = new Set(
        trialTx.filter((t) => (t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0) > 0).map((t) => t.trialNumber)
      )
      if (['1', '2', '3'].every((n) => recoveredTrials.has(n))) {
        // Fire-and-forget - the transaction itself is already saved
        // locally; marking the Sheet's TMO row DONE is a best-effort
        // side effect that shouldn't make the user wait on the network.
        markMillingOrderDone('TMO', tmoNumber.trim())
      }
    }

    if (type === 'ESR' && isMilling && moNumber.trim()) {
      const order = await db.millingOrders.where('orderId').equals(`MO::${moNumber.trim()}`).first()
      if (order?.recoveryPercent != null) {
        const moTx = await db.transactions
          .where('moNumber').equals(moNumber.trim())
          .and((t) => t.status === 'Active')
          .toArray()
        const sumPieces = (t) => (t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0)
        const issuedPieces = moTx.filter((t) => t.type === 'ESI').reduce((s, t) => s + sumPieces(t), 0)
        const receivedPieces = moTx.filter((t) => t.type === 'ESR').reduce((s, t) => s + sumPieces(t), 0)
        const expectedPieces = issuedPieces * (order.recoveryPercent / 100)
        if (expectedPieces > 0 && receivedPieces >= expectedPieces) {
          // Fire-and-forget - same reasoning as the TMO case above.
          markMillingOrderDone('MO', moNumber.trim())
        }
      }
    }

    toast.success(`${type} saved — ${serialNo.trim()}`)

    const next = stepSerial(serialNo.trim(), 1)
    resetToBlankEntry(next)
    setIsSaving(false)
    scrollToTop()
  }

  const handleSave = async () => {
    const ok = await validateForm()
    if (!ok) return

    if (type === 'ESR' && isTestMilling && trialNumber === '3') {
      const totalPieces = sackLines.reduce((s, l) => s + (parseFormattedNumber(l.pieces) || 0), 0)
      if (totalPieces > 0) {
        setPendingTrial3Confirm(true)
        return
      }
    }

    await performSave(false)
  }

  const handleUpdate = async () => {
    const ok = await validateForm({ excludeId: loadedTransaction.id })
    if (!ok) return

    setIsSaving(true)

    if (loadedTransaction.siaNumber) {
      await adjustSiaBalance(loadedTransaction.siaNumber, buildLineDeltas(loadedTransaction.sackLines, -1))
    }

    const updated = buildTransactionPayload({ id: loadedTransaction.id })
    await db.transactions.update(loadedTransaction.id, updated)
    await rememberCustomer({
      name: customerName.trim(),
      address: customerAddress.trim() || null,
      warehouseId: currentWarehouseId,
    })

    if (type === 'ESI' && linkedDocNo.trim()) {
      await adjustSiaBalance(linkedDocNo.trim(), buildLineDeltas(sackLines, 1))
    }

    toast.success(`${type} ${serialNo.trim()} updated`)
    setLoadedTransaction(updated)
    setIsSaving(false)
    scrollToTop()
  }

  const handleDeleteConfirmed = async () => {
    setPendingDelete(false)
    setIsSaving(true)

    if (loadedTransaction.siaNumber) {
      await adjustSiaBalance(loadedTransaction.siaNumber, buildLineDeltas(loadedTransaction.sackLines, -1))
    }

    await db.transactions.delete(loadedTransaction.id)
    await recalculateSerialCounter(type, currentWarehouseId)
    queueTransactionDeletion(loadedTransaction.serialNo, loadedTransaction.type, currentWarehouse?.code) // fire-and-forget - local delete is already done, don't make the UI wait on the network
    toast.success(`${type} ${serialNo.trim()} deleted`)

    const freedSerial = serialNo.trim()
    resetToBlankEntry(freedSerial)
    setIsSaving(false)
    scrollToTop()
  }

  // Voiding bypasses the normal Save button - confirming immediately
  // writes the Cancelled record, since a void document has no real
  // data to validate. If an existing Active transaction had an SIA
  // link, that balance is reversed first, since it no longer
  // represents a real issuance.
  const handleConfirmVoid = async () => {
    setPendingVoidAction(null)
    setIsSaving(true)
    if (loadedTransaction && loadedTransaction.status !== 'Cancelled' && loadedTransaction.siaNumber) {
      await adjustSiaBalance(loadedTransaction.siaNumber, buildLineDeltas(loadedTransaction.sackLines, -1))
    }
    const cancelledRecord = loadedTransaction
      ? buildCancelledPayload({ id: loadedTransaction.id })
      : { id: crypto.randomUUID(), ...buildCancelledPayload() }
    if (loadedTransaction) {
      await db.transactions.update(loadedTransaction.id, cancelledRecord)
    } else {
      await db.transactions.add(cancelledRecord)
    }
    await recordSerialUsed(type, currentWarehouseId, serialNo.trim())
    setIsCancelled(true)
    setLoadedTransaction(cancelledRecord)
    toast.success(`${type} ${serialNo.trim()} has been cancelled/voided`)
    setIsSaving(false)
  }

  // Un-voiding deletes the Cancelled record entirely, making the
  // serial genuinely available again rather than leaving behind an
  // incomplete "Active" record that would fail validation.
  const handleConfirmUnvoid = async () => {
    setPendingVoidAction(null)
    if (!loadedTransaction) { setIsCancelled(false); return }
    setIsSaving(true)
    await db.transactions.delete(loadedTransaction.id)
    await recalculateSerialCounter(type, currentWarehouseId)
    queueTransactionDeletion(loadedTransaction.serialNo, loadedTransaction.type, currentWarehouse?.code)
    toast.success(`${type} ${serialNo.trim()} is no longer cancelled — available again`)
    const freedSerial = serialNo.trim()
    resetToBlankEntry(freedSerial)
    setIsSaving(false)
  }

  const isEditMode = Boolean(loadedTransaction)

  // Gates the Save button - mirrors validateForm's synchronous checks
  // (serial-uniqueness and the ESI over-issuance check are both
  // save-time-only safety nets, not part of this live gate).
  const canSave = isCancelled
    ? Boolean(currentWarehouseId) && Boolean(serialNo.trim())
    : Boolean(currentWarehouseId)
      && Boolean(serialNo.trim())
      && Boolean(customerName.trim())
      && sackLines.some((l) => l.sackTypeId && l.condition && l.pieces !== '')

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 transition-all duration-[350ms] ${hasEntered && isOpen ? 'scale-100 opacity-100 ease-[cubic-bezier(0.34,1.56,0.64,1)]' : 'scale-95 opacity-0 ease-in'}`}>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">{title}</h1>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 hover:shadow-[0_0_12px_rgba(239,68,68,0.4)] active:scale-90 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {sortedWarehouses.length > 1 && !openedFromReports ? (
          <div className="mt-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-neon">Warehouse</label>
            <select
              value={currentWarehouseId ?? ''}
              onChange={(e) => {
                setCurrentWarehouseId(e.target.value)
                setLoadedTransaction(null)
                setWarehouseChangeFlash(true)
                setTimeout(() => setWarehouseChangeFlash(false), 750)
              }}
              className="mt-1 w-full rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-3 text-base font-semibold text-app-text outline-none focus:border-brand-neon"
            >
              {sortedWarehouses.map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : currentWarehouse ? (
          <div className="mt-2 rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</p>
            <p className="text-base font-bold text-app-text">
              {currentWarehouse.code} — {currentWarehouse.name}
            </p>
          </div>
        ) : null}

        {!isSerialFieldVisible && serialNo && (
          <p className="mt-2 rounded-xl border-2 border-brand-neon bg-brand-neon/10 px-3 py-2.5 text-center font-mono text-lg font-bold text-brand-neon shadow-[0_0_16px_-4px_rgba(0,255,163,0.4)]">
            {type} # {serialNo}
          </p>
        )}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="space-y-3">
          <AnimatedBanner show={isAdmin && Boolean(loadedTransaction?.needsCompletion)} className="rounded-xl border-2 border-brand-amber bg-brand-amber/10 px-3 py-2 text-sm font-medium text-brand-amber">
            This record was pulled from historical Sheet data. The sack breakdown by type/condition was not tracked there
            {loadedTransaction?.totalPiecesRaw != null && <> — the Sheet's recorded total was <strong>{loadedTransaction.totalPiecesRaw} pieces</strong></>}, and needs to be entered below before further changes can be saved.
          </AnimatedBanner>

          <div ref={serialFieldRef}>
            <label className={labelClass}>Serial No.</label>
            <div className="mt-1 flex items-center gap-2">
              {openedFromReports ? (
                <input
                  type="text"
                  value={serialNo}
                  readOnly
                  disabled
                  className={`mt-0 w-full rounded-xl border bg-neutral-800 px-3 py-2 text-center font-mono text-neutral-400 outline-none ${!serialNo.trim() ? '!border-brand-amber' : 'border-neutral-800'}`}
                  placeholder="0000000"
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleStepBack}
                    aria-label="Previous serial"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-90"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="relative w-full">
                    <input
                      type="text"
                      value={serialNo}
                      onChange={(e) => handleSerialChange(e.target.value)}
                      onBlur={handleSerialBlur}
                      className={`mt-0 w-full rounded-xl border bg-neutral-950 px-3 py-2 text-center font-mono outline-none transition-colors focus:border-brand-neon ${!serialNo.trim() ? '!border-brand-amber' : 'border-neutral-800'} ${navFlash ? 'text-transparent' : 'text-app-text'}`}
                      placeholder="0000000"
                    />
                    <SerialCrossfadeOverlay value={serialNo} navFlash={navFlash} />
                  </div>
                  <button
                    type="button"
                    onClick={handleStepForward}
                    aria-label="Next serial"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-90"
                  >
                    <ChevronRight size={18} />
                  </button>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {isLookingUp ? (
                <span className="inline-flex items-center gap-1.5 text-brand-neon">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-neon border-t-transparent" />
                  Looking up serial…
                </span>
              ) : isEditMode ? (
                <span className="text-brand-amber">Reviewing {type} {loadedTransaction?.serialNo}</span>
              ) : null}
            </p>
          </div>

          <div className={`space-y-3 rounded-xl transition-opacity ${isCancelled ? 'border-2 border-brand-crimson p-2 opacity-40' : ''} ${navFlash || warehouseChangeFlash ? 'stagger-fields' : ''}`}>
          <div>
            <label className={labelClass}>Date</label>
            <CalendarDatePicker ref={dateRef} value={date} onChange={setDate} />
          </div>

          <div>
            <label className={labelClass}>{linkedDocLabel}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={linkedDocNo}
                onChange={(e) => setLinkedDocNo(e.target.value)}
                className={inputClass}
                placeholder="0111965"
              />
              {type === 'ESI' && (
                <button
                  type="button"
                  onClick={() => setShowAuthorityPicker(true)}
                  className="shrink-0 rounded-xl border border-brand-neon/40 px-3 text-xs font-medium text-brand-neon"
                >
                  Browse
                </button>
              )}
            </div>
          </div>

          <CustomerNameAutocomplete
            ref={customerNameRef}
            value={customerName}
            onChange={setCustomerName}
            onMatch={handleCustomerMatch}
            warehouseId={currentWarehouseId}
          />

          <div>
            <label className={labelClass}>Address</label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              className={inputClass}
              placeholder="Optional"
            />
          </div>

          <div>
            <label className={labelClass}>Nature of Transaction</label>
            <select
              value={transactionTypeId}
              onChange={(e) => setTransactionTypeId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {sortedTransactionTypes.map((t) => (
                <option key={t.transactionTypeId} value={t.transactionTypeId}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {isMilling && (() => {
            const trimmedCustomerName = customerName.trim().toLowerCase()
            const availableMoOrders = millingOrderOptions
              .filter((o) => loadedTransaction || (!o.fulfilled && o.sheetStatus !== 'DONE') || o.number === moNumber)
              .filter((o) => !trimmedCustomerName || o.number === moNumber || o.ricemillName?.trim().toLowerCase() === trimmedCustomerName)
            const selectedOrder = millingOrderOptions.find((o) => o.number === moNumber)
            const isDerived = type !== 'ESR'
            const noneMatchedAtAll = isDerived && linkedSiaAuthority?.siaNumber && !linkedMillingOrder && !moNumber
            const likelyAlreadyCompleted = noneMatchedAtAll && isAuthorityComplete(linkedSiaAuthority)
            const noMatchFound = noneMatchedAtAll && !likelyAlreadyCompleted

            return (
              <div>
                {likelyAlreadyCompleted && (
                  <p className="mb-2 rounded-lg border border-brand-neon/40 bg-brand-neon/10 px-3 py-2 text-xs text-brand-neon">
                    This SIA's milling operation appears to already be completed (marked DONE) -
                    that's why no MO Number shows here. This is expected, not an error.
                  </p>
                )}
                {noMatchFound && (
                  <p className="mb-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
                    No MO found matching SIA "{linkedSiaAuthority.siaNumber}". Check that: (1) the
                    MO sheet sync has actually run (see the Milling Operations monitor on Home - if
                    it's not showing at all, the sync hasn't succeeded), and (2) this SIA's number
                    matches exactly what's in the MO sheet's Column I.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>MO Number</label>
                  <select
                    value={moNumber}
                    onChange={(e) => {
                      const nextNumber = e.target.value
                      setMoNumber(nextNumber)
                      const order = millingOrderOptions.find((o) => o.number === nextNumber)
                      setBatchNumber(order?.batchCurrent != null ? String(order.batchCurrent) : '')
                      if (order?.ricemillName) setCustomerName(order.ricemillName)
                    }}
                    className={`${inputClass} ${!moNumber.trim() ? '!border-brand-amber' : ''}`}
                  >
                    <option value="">Select…</option>
                    {availableMoOrders.map((o) => (
                      <option key={o.number} value={o.number}>
                        {stripMoTmoPrefix(o.number)}{o.batchCurrent != null ? ` - Batch ${o.batchCurrent}` : ''}
                      </option>
                    ))}
                    {moNumber.trim() && !availableMoOrders.some((o) => o.number === moNumber) && (
                      <option value={moNumber}>{stripMoTmoPrefix(moNumber)} (historical)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Batch</label>
                  <input
                    type="text"
                    value={selectedOrder ? `${selectedOrder.batchCurrent} of ${selectedOrder.batchTotal}` : ''}
                    readOnly
                    disabled
                    className={`${inputClass} bg-neutral-800 text-neutral-400`}
                    placeholder="Auto-filled from MO"
                  />
                </div>
                </div>
              </div>
            )
          })()}

          {isTestMilling && (() => {
            const trimmedCustomerName = customerName.trim().toLowerCase()
            const availableTmoNumbers = millingOrderOptions
              .filter((o) => loadedTransaction || (!o.fulfilled && o.sheetStatus !== 'DONE') || o.number === tmoNumber)
              .filter((o) => !trimmedCustomerName || o.number === tmoNumber || o.ricemillName?.trim().toLowerCase() === trimmedCustomerName)
            const isDerived = type !== 'ESR'
            const noneMatchedAtAll = isDerived && linkedSiaAuthority?.siaNumber && !linkedMillingOrder && !tmoNumber
            const likelyAlreadyCompleted = noneMatchedAtAll && isAuthorityComplete(linkedSiaAuthority)
            const noMatchFound = noneMatchedAtAll && !likelyAlreadyCompleted

            return (
              <div>
                {likelyAlreadyCompleted && (
                  <p className="mb-2 rounded-lg border border-brand-neon/40 bg-brand-neon/10 px-3 py-2 text-xs text-brand-neon">
                    This SIA's milling operation appears to already be completed (marked DONE) -
                    that's why no TMO Number shows here. This is expected, not an error.
                  </p>
                )}
                {noMatchFound && (
                  <p className="mb-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
                    No TMO found matching SIA "{linkedSiaAuthority.siaNumber}". Check that: (1) the
                    TMO sheet sync has actually run (see the Milling Operations monitor on Home - if
                    it's not showing at all, the sync hasn't succeeded), and (2) this SIA's number
                    matches exactly what's in the TMO sheet's Column I.
                  </p>
                )}
                {/* Trial only applies on the receipt (ESR) side, where
                    recovery is confirmed trial-by-trial (see
                    trial3Confirmed below) - sacks are ISSUED per Test
                    Milling Order as a whole, not per trial, so ESI has
                    no Trial concept at all and must not require one. */}
                <div className={type === 'ESR' ? 'grid grid-cols-2 gap-3' : ''}>
                <div>
                  <label className={labelClass}>TMO Number</label>
                  <select
                    value={tmoNumber}
                    onChange={(e) => {
                      const nextNumber = e.target.value
                      setTmoNumber(nextNumber)
                      setTrialNumber('')
                      const order = millingOrderOptions.find((o) => o.number === nextNumber)
                      if (order?.ricemillName) setCustomerName(order.ricemillName)
                    }}
                    className={`${inputClass} ${!tmoNumber.trim() ? '!border-brand-amber' : ''}`}
                  >
                    <option value="">Select…</option>
                    {availableTmoNumbers.map((o) => (
                      <option key={o.number} value={o.number}>{stripMoTmoPrefix(o.number)}</option>
                    ))}
                    {tmoNumber.trim() && !availableTmoNumbers.some((o) => o.number === tmoNumber) && (
                      <option value={tmoNumber}>{stripMoTmoPrefix(tmoNumber)} (historical)</option>
                    )}
                  </select>
                </div>
                {type === 'ESR' && (
                  <div>
                    <label className={labelClass}>Trial</label>
                    <select
                      value={trialNumber}
                      onChange={(e) => setTrialNumber(e.target.value)}
                      className={`${inputClass} ${!trialNumber ? '!border-brand-amber' : ''}`}
                    >
                      <option value="">Select…</option>
                      {['1', '2', '3'].map((n) => (
                        <option key={n} value={n} disabled={takenTrialNumbers.includes(n) && n !== trialNumber}>
                          Trial {n}{takenTrialNumbers.includes(n) && n !== trialNumber ? ' (used)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                </div>
              </div>
            )
          })()}

          {unresolvedSiaHint && (
            <div className="rounded-xl border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
              This SIA covers multiple sack types — enter lines manually using the
              authorized figure as reference: <span className="font-mono">{unresolvedSiaHint}</span>
            </div>
          )}

          <div>
            <label className={labelClass}>Sack Lines</label>
            <div className="mt-1 space-y-2">
              {sackLines.map((line, i) => {
                const availableConditions = conditionsFor(line.sackTypeId)
                // Always keep a pre-filled condition displayable, even
                // if it isn't currently in the computed list for this
                // sack type - otherwise the browser silently can't
                // show a <select> value with no matching <option>,
                // making a correctly-set value look like it never
                // auto-filled at all.
                const displayConditions = line.condition && !availableConditions.includes(line.condition)
                  ? [...availableConditions, line.condition]
                  : availableConditions
                return (
                  <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-500">Line {i + 1}</span>
                      {sackLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          aria-label="Remove line"
                          className={removeButtonClass}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <select
                        value={line.sackTypeId}
                        onChange={(e) => updateLine(i, 'sackTypeId', e.target.value)}
                        className={`${inputClass} mt-0 ${!line.sackTypeId ? '!border-brand-amber' : ''}`}
                      >
                        <option value="">Code…</option>
                        {sortedSackTypes.map((s) => (
                          <option key={s.sackTypeId} value={s.sackTypeId}>
                            {s.code}
                          </option>
                        ))}
                      </select>
                      <select
                        value={line.condition}
                        onChange={(e) => updateLine(i, 'condition', e.target.value)}
                        className={`${inputClass} mt-0 ${!line.condition ? '!border-brand-amber' : ''}`}
                        disabled={!line.sackTypeId}
                      >
                        <option value="">Cond…</option>
                        {displayConditions.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={line.pieces}
                        onChange={(e) => updateLine(i, 'pieces', liveFormatNumber(e.target.value))}
                        className={`${inputClass} mt-0 ${
                          type === 'ESI' && line.sackTypeId && line.condition &&
                          parseFormattedNumber(line.pieces) > getAvailablePieces(line.sackTypeId, line.condition)
                            ? '!border-brand-crimson'
                            : line.pieces === '' ? '!border-brand-amber' : ''
                        }`}
                        placeholder="Pcs"
                      />
                    </div>
                    {type === 'ESI' && line.sackTypeId && line.condition && getSiaRemainingPieces(line.sackTypeId, line.condition) != null && (
                      <p className="mt-1 text-xs text-brand-neon">
                        SIA balance remaining: {getSiaRemainingPieces(line.sackTypeId, line.condition).toLocaleString()} pcs
                      </p>
                    )}
                    {type === 'ESI' && line.sackTypeId && line.condition && (() => {
                      const available = getAvailablePieces(line.sackTypeId, line.condition)
                      // This is physical sack stock on hand at this warehouse -
                      // a separate check from the SIA balance above it, and the
                      // one actually behind the red border. Spelled out here so
                      // "red border but SIA balance looks fine" doesn't read as
                      // a contradiction - the SIA authorizes the amount, this
                      // checks whether the physical sacks to issue exist.
                      const exceedsAvailable = parseFormattedNumber(line.pieces) > available
                      return (
                        <p className={`mt-1 text-xs ${exceedsAvailable ? 'text-brand-crimson' : 'text-neutral-500'}`}>
                          Available (physical stock): {fmtBags(available)} pcs
                          {exceedsAvailable ? ' — exceeds what this warehouse has on hand, not an SIA limit' : ''}
                        </p>
                      )
                    })()}
                  </div>
                )
              })}
            </div>

            <button type="button" onClick={addLine} className={`mt-2 ${smallButtonClass}`}>
              <span className="flex items-center gap-1">
                <Plus size={14} /> Add line
              </span>
            </button>

            {totalPieces > 0 && (
              <p className="mt-2 text-xs text-neutral-500">
                Total pieces: {fmtBags(totalPieces)}
              </p>
            )}
          </div>
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
      </div>

      {pendingTrial3Confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <p className="text-base font-semibold text-app-text">Has Trial 3 been completed?</p>
            <p className="mt-1 text-sm text-neutral-400">
              This TMO can only be marked fulfilled once Trial 3 is confirmed complete. If not, this receipt still saves, but the TMO stays unfulfilled.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setPendingTrial3Confirm(false); performSave(false) }}
                className="flex-1 rounded-xl border border-neutral-700 py-2.5 text-sm font-medium text-neutral-300"
              >
                Not Yet
              </button>
              <button
                type="button"
                onClick={() => { setPendingTrial3Confirm(false); performSave(true) }}
                className="flex-1 rounded-xl bg-brand-neon py-2.5 text-sm font-semibold text-brand-contrast"
              >
                Yes, Complete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-900 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {isEditMode ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isSaving}
              className="relative flex-1 rounded-xl bg-brand-neon py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              <UpdateButtonContent isSaving={isSaving} />
            </button>
            <button
              type="button"
              onClick={() => { setDeleteAnimKey((k) => k + 1); setPendingDelete(true) }}
              disabled={isSaving}
              className="flex-1 rounded-xl bg-brand-crimson py-3 text-sm font-semibold text-app-text transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
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

      <ConfirmDialog
        open={pendingDelete}
        title={`Delete ${type} ${loadedTransaction?.serialNo ?? ''}?`}
        description="This reverses any linked SIA balance and frees this serial number. This cannot be undone."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(false)}
      />

      <ConfirmDialog
        open={pendingVoidAction === 'void'}
        icon={AlertTriangle}
        title={`Void ${type} #${serialNo.trim()}?`}
        description="This immediately marks the series as cancelled - no data required, and no need to press Save."
        confirmLabel="Void"
        onConfirm={handleConfirmVoid}
        onCancel={() => setPendingVoidAction(null)}
      />

      <ConfirmDialog
        open={pendingVoidAction === 'unvoid'}
        icon={AlertTriangle}
        title={`Make ${type} #${serialNo.trim()} available again?`}
        description="This removes the cancelled marker entirely, so the serial is free for a fresh entry."
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={handleConfirmUnvoid}
        onCancel={() => setPendingVoidAction(null)}
      />

      <ConfirmDialog
        open={showFloorWarning}
        icon={AlertTriangle}
        title={`Series #${serialNo.trim()} does not exist`}
        description={`No ${type} records exist before #${floorSerialNumber} for this warehouse. Tap OK to return to the latest available serial.`}
        confirmLabel="OK"
        cancelLabel="OK"
        onConfirm={handleFloorWarningAcknowledge}
        onCancel={handleFloorWarningAcknowledge}
      />

      {showAuthorityPicker && currentWarehouseId && (
        <AuthorityPickerModal
          type="SIA"
          warehouseId={currentWarehouseId}
          onSelect={handleSelectAuthority}
          onClose={() => setShowAuthorityPicker(false)}
        />
      )}
    </div>
  )
})

export default SackFormBase
