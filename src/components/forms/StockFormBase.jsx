// Stock Form Base — shared by WSR, WSI, WTS.
//
// Field order:
//  1. Serial No. — manual, suggested starting value scoped to THIS
//     warehouse's own document series, "<"/"+" navigation (see below).
//  2. Date (native date picker — opens on tap anywhere in the field)
//  3. Linked document number, right under Date:
//       WSR -> "WSI No." (optional, no balance effect)
//       WSI, WTS -> "AI No." (deducts from db.authorities on save)
//  4. Customer Name — autocomplete; picking/matching a customer auto-fills
//     Address/RSBSA/Gender/Farmer Org status. If Nature of Transaction is
//     Procurement, RSBSA + Gender fields appear directly below (optional).
//  5. Nature of Transaction (sorted alphabetically)
//  6. Pile ID (sorted alphabetically; "+ New Pile" option) — selecting a
//     pile auto-selects + locks its Variety.
//  7. Variety Type — read-only once a Pile is selected.
//  8. MTS — Sack Code & Condition combo, scoped to variety category.
//  9. Number of Bags / Gross Kilos — with available-stock display + a
//     hard cap on Net Kilos for issuances (WSI), since net kilos is the
//     figure warehouses are accountable for. Bags alone gets a soft
//     warning, not a hard block, since some transaction types legitimately
//     exceed the bag count.
//  10. Auto-compute Net Kilos toggle + Net Kilos + average weight per bag
//  11. Age (value + Day/Month unit)
//  12. Condition — required, single choice, full-width buttons
//
// SERIES NAVIGATION: every warehouse keeps its own serial pool per
// document type. Serial suggestions, uniqueness, and the "<"/"+" stepper
// are all scoped to (type, current warehouse). Stepping back ("<") onto a
// serial that already has Active data for this (type, warehouse) loads
// that transaction into the form for review — the footer becomes
// **Update** (green) and **Delete** (red) instead of Save. Typing a
// serial directly that matches existing data does the same. Update
// reverses the OLD pile/authority effect and applies the NEW one; Delete
// reverses the effect, asks for confirmation, and frees the serial.
//
// Save-without-closing (new entries only): only date, Nature of
// Transaction, Pile, Variety, MTS selection, age+unit, and Condition are
// retained; everything else clears and focus returns to Customer Name.

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Plus, X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import AuthorityPickerModal from './AuthorityPickerModal.jsx'
import { db } from '../../db/dexie.js'
import {
  calculateNetKilos,
  calculateMtsFromSackWeight,
  calculateAverageWeightPerBag,
  calculateCurrentAge,
  bestAgeUnit,
  normalizeAgeToDays,
  liveFormatNumber,
  parseFormattedNumber,
  fmtWeight,
  fmtBags,
  todayLocalISO,
} from '../../utils/calculations.js'
import {
  suggestNextSerial,
  isSerialTaken,
  stepSerial,
  findTransactionBySerial,
  recordSerialUsed,
  recalculateSerialCounter,
} from '../../utils/serialNumber.js'
import { applyTransactionToPile, reverseTransactionFromPile } from '../../utils/pileLedger.js'
import { fetchTransactionBySerial, mapSheetRowToTransaction, fetchSerialFloorFromSheet, markMillingOrderDone } from '../../services/googleSheetsBridge.js'
import { isPreloadComplete } from '../../services/transactionPreload.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { rememberCustomer } from '../../utils/customerDirectory.js'
import { queueTransactionDeletion } from '../../services/syncWorker.js'
import SerialNumberField from './SerialNumberField.jsx'
import ValidatedField from './ValidatedField.jsx'
import CustomerNameAutocomplete from './CustomerNameAutocomplete.jsx'
import NewPileDialog from './NewPileDialog.jsx'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
import AnimatedBanner from '../common/AnimatedBanner.jsx'
import CalendarDatePicker from '../common/CalendarDatePicker.jsx'
import {
  inputClass,
  labelClass,
  readOnlyClass,
  primaryButtonClass,
  smallButtonClass,
  removeButtonClass,
  CONDITION_FLAGS,
} from './shared.js'

const AGE_UNITS = ['Days', 'Months', 'Months + Days']
const GENDERS = ['Male', 'Female']
const PROCUREMENT_TYPE_NAME = 'Procurement'
const SALES_TYPE_NAME = 'Sales'
const MILLING_TYPE_NAME = 'Milling'
const TEST_MILLING_TYPE_NAME = 'Test Milling'
const NEW_PILE_OPTION = '__new_pile__'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

const emptyMember = () => ({ name: '', rsbsa: '', gender: 'Male' })

const blankFormState = {
  date: todayLocalISO(),
  linkedDocNo: '',
  customerName: '',
  customerAddress: '',
  farmerRsbsa: '',
  farmerGender: '',
  transactionTypeId: '',
  pileId: '',
  varietyId: '',
  sackSelection: '',
  numberOfBags: '',
  grossKilos: '',
  autoComputeNet: true,
  manualNetKilos: '',
  ageValue: '',
  ageUnit: 'Days',
  condition: '',
  farmerOrgEnabled: false,
  members: [emptyMember()],
}

function StockFormBase({ type, title, onClose, prefill }) {
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}
  const { weightUnit, autoAgeMonitoring } = useSettings() ?? {}

  const linkedDocLabel = type === 'WSR' ? 'WSI No.' : 'AI No.'
  const linkedDocDeductsFromAi = type !== 'WSR'

  // WSR and WSI keep genuinely separate serial series per cereal
  // category (Rice vs Palay) within the same warehouse, per explicit
  // request - ESR/ESI don't have this distinction.
  const isCategoryScoped = type === 'WSR' || type === 'WSI'
  const [cerealCategory, setCerealCategory] = useState('Rice')
  const activeCategory = isCategoryScoped ? cerealCategory : null

  const [serialNo, setSerialNo] = useState('')
  const [date, setDate] = useState(blankFormState.date)
  const [linkedDocNo, setLinkedDocNo] = useState('')
  const [linkedAuthorityDate, setLinkedAuthorityDate] = useState(null)
  const [showAuthorityPicker, setShowAuthorityPicker] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [farmerRsbsa, setFarmerRsbsa] = useState('')
  const [farmerGender, setFarmerGender] = useState('')
  const [transactionTypeId, setTransactionTypeId] = useState('')
  const [pileId, setPileId] = useState('')
  const [varietyId, setVarietyId] = useState('')
  const [sackSelection, setSackSelection] = useState('')
  const [numberOfBags, setNumberOfBags] = useState('')
  const [grossKilos, setGrossKilos] = useState('')
  const [autoComputeNet, setAutoComputeNet] = useState(true)
  const [manualNetKilos, setManualNetKilos] = useState('')
  const [ageValue, setAgeValue] = useState('')
  const [monthsValue, setMonthsValue] = useState('0')
  const [daysValue, setDaysValue] = useState('0')
  const [ageUnit, setAgeUnit] = useState('Days')
  const [condition, setCondition] = useState('GQ')
  const [moistureContent, setMoistureContent] = useState('')
  const [farmerOrgEnabled, setFarmerOrgEnabled] = useState(false)
  const [orNumber, setOrNumber] = useState('')
  const [moNumber, setMoNumber] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [tmoNumber, setTmoNumber] = useState('')
  const [trialNumber, setTrialNumber] = useState('')
  const [members, setMembers] = useState([emptyMember()])
  const [showNewPileDialog, setShowNewPileDialog] = useState(false)
  const [pileFilterVarietyId, setPileFilterVarietyId] = useState(null)

  // Series navigation / edit-mode state. `loadedTransaction` is non-null
  // when the current serial already has Active data for this (type,
  // warehouse) — the form becomes a review/edit of that document.
  const [loadedTransaction, setLoadedTransaction] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [pendingTrial3Confirm, setPendingTrial3Confirm] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const [pendingVoidAction, setPendingVoidAction] = useState(null) // 'void' | 'unvoid' | null
  const [navFlash, setNavFlash] = useState(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin'
  const [floorSerialNumber, setFloorSerialNumber] = useState(null) // lowest known real serial number (local + Sheet combined) for this (type, warehouse)
  const [showFloorWarning, setShowFloorWarning] = useState(false)
  const [hasEntered, setHasEntered] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  // Two-effect pattern (same as elsewhere in this app): guarantees the
  // browser paints the initial off-screen state before animating in,
  // rather than the transition being skipped because both states
  // applied within the same render/paint cycle.
  // Double-RAF (not single) - reliably guarantees the browser has
  // actually painted the initial off-screen state before the
  // transition starts. A single RAF's callback can fire before that
  // paint has genuinely happened, which is what caused the animation
  // to look like an abrupt snap/shake instead of a smooth slide.
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
  const [showSaveHint, setShowSaveHint] = useState(false)

  // Live lookup of the linked AI authority, so its remaining balance can
  // be shown to the user while filling out an issuance - only relevant
  // for WSI, where linkedDocNo is genuinely an AI reference (WSR's
  // linkedDocNo means something else entirely, a linked WSI).
  const linkedAuthority = useLiveQuery(async () => {
    if (!linkedDocDeductsFromAi || !linkedDocNo.trim()) return null
    return db.authorities.where('aiNumber').equals(linkedDocNo.trim()).and((a) => a.type === 'AI').first()
  }, [linkedDocDeductsFromAi, linkedDocNo])

  // Per the correct operational flow: it always starts with the AI,
  // especially for issuance. When the selected AI is for a Milling or
  // Test Milling operation, the MO/TMO number, batch, and miller name
  // are DERIVED from that AI - not picked independently. Only applies
  // to the issue side (WSI), since that's the only side with an
  // existing AI link; the receipt side (WSR) has no AI of its own to
  // key off, so it keeps its own MO/TMO picker.
  const linkedMillingOrder = useLiveQuery(async () => {
    if (type === 'WSR' || !linkedAuthority?.aiNumber) return null
    if (!isMilling && !isTestMilling) return null
    return db.millingOrders
      .where('type').equals(isMilling ? 'MO' : 'TMO')
      .and((o) => o.aiNumber === linkedAuthority.aiNumber)
      .first()
  }, [type, linkedAuthority?.aiNumber, isMilling, isTestMilling])

  useEffect(() => {
    if (type === 'WSR' || (!isMilling && !isTestMilling)) return
    if (linkedMillingOrder) {
      if (isMilling) {
        setMoNumber(linkedMillingOrder.number)
        setBatchNumber(linkedMillingOrder.batchCurrent != null ? String(linkedMillingOrder.batchCurrent) : '')
      } else if (isTestMilling) {
        setTmoNumber(linkedMillingOrder.number)
      }
      if (linkedMillingOrder.ricemillName) setCustomerName(linkedMillingOrder.ricemillName)
    } else {
      // The AI changed (or was cleared) and no longer matches any MO/
      // TMO - clear whatever was previously derived rather than
      // leaving a stale, now-mismatched number sitting in the form.
      if (isMilling) { setMoNumber(''); setBatchNumber('') }
      else if (isTestMilling) setTmoNumber('')
    }
  }, [linkedMillingOrder, isMilling, isTestMilling, type])

  const authorityRemainingKilos = linkedAuthority?.totalAllocationKilos != null
    ? Math.max(0, linkedAuthority.totalAllocationKilos - (linkedAuthority.totalIssuedKilos ?? 0))
    : null
  const authorityRemainingBags = linkedAuthority?.totalAllocationBags != null

  // Which trial numbers (1/2/3) already exist for this TMO, across
  // EVERY warehouse - not just the current one, since the TMO itself
  // is the reference for fulfillment, and a trial recorded at any
  // warehouse counts toward it.
  // Available MO/TMO numbers from the synced (read-only) reference
  // sheet data, with fulfillment computed so the picker can exclude
  // anything already fulfilled - a Milling batch is fulfilled when its
  // received net kilos (summed across every warehouse, not just this
  // one) meet or exceed issued kilos x the sheet's recovery percent; a
  // Test Milling TMO is fulfilled only once all 3 trials have SOME
  // amount recovered AND the user has explicitly confirmed Trial 3 as
  // complete (never inferred just from 3 trials existing).
  const millingOrderOptions = useLiveQuery(async () => {
    if (!isMilling && !isTestMilling) return []
    const orderType = isMilling ? 'MO' : 'TMO'
    const orders = await db.millingOrders.where('type').equals(orderType).toArray()
    const numberField = isMilling ? 'moNumber' : 'tmoNumber'

    const allRelevantTx = await db.transactions
      .where(numberField).anyOf(orders.map((o) => o.number))
      .and((t) => t.status === 'Active')
      .toArray()

    return orders.map((order) => {
      const forThisOrder = allRelevantTx.filter((t) => t[numberField] === order.number)

      if (isMilling) {
        const issuedKg = forThisOrder.filter((t) => t.type === 'WSI').reduce((s, t) => s + (t.netKilos ?? 0), 0)
        const receivedKg = forThisOrder.filter((t) => t.type === 'WSR').reduce((s, t) => s + (t.netKilos ?? 0), 0)
        const expectedKg = order.recoveryPercent != null ? issuedKg * (order.recoveryPercent / 100) : null
        const fulfilled = expectedKg != null && expectedKg > 0 && receivedKg >= expectedKg
        return { ...order, issuedKg, receivedKg, expectedKg, fulfilled }
      }

      // Test Milling - fulfilled needs all 3 trials recovered (any
      // amount > 0 on the WSR side) AND the explicit Trial 3
      // confirmation flag.
      const recoveredTrials = new Set(
        forThisOrder.filter((t) => t.type === 'WSR' && (t.netKilos ?? 0) > 0).map((t) => t.trialNumber)
      )
      const allThreeRecovered = ['1', '2', '3'].every((n) => recoveredTrials.has(n))
      const fulfilled = allThreeRecovered && order.trial3Confirmed === true
      return { ...order, recoveredTrials: [...recoveredTrials], fulfilled }
    })
  }, [isMilling, isTestMilling]) ?? []

  const takenTrialNumbers = useLiveQuery(async () => {
    if (!isTestMilling || !tmoNumber.trim()) return []
    const existing = await db.transactions
      .where('tmoNumber').equals(tmoNumber.trim())
      .and((t) => t.status === 'Active' && t.type === type && (!loadedTransaction || t.id !== loadedTransaction.id))
      .toArray()
    return [...new Set(existing.map((t) => t.trialNumber).filter(Boolean))]
  }, [isTestMilling, tmoNumber, type, loadedTransaction]) ?? []
    ? Math.max(0, linkedAuthority.totalAllocationBags - (linkedAuthority.totalIssuedBags ?? 0))
    : null

  const customerNameRef = useRef(null)
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

  const piles = useLiveQuery(async () => {
    if (!currentWarehouse) return []
    return db.piles.where('warehouseId').equals(currentWarehouse.warehouseId).toArray()
  }, [currentWarehouse?.warehouseId])

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), [])
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), [])
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), [])

  const sortedVarieties = [...(varieties ?? [])]
    .filter((v) => !isCategoryScoped || v.category === activeCategory)
    .sort((a, b) => byAlpha(a.name, b.name))
  const sortedTransactionTypes = [...(transactionTypes ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const sortedPiles = [...(piles ?? [])]
    .filter((p) => !isCategoryScoped || p.cerealType === activeCategory)
    .filter((p) => !pileFilterVarietyId || p.varietyId === pileFilterVarietyId)
    .sort((a, b) => byAlpha(a.pileName, b.pileName))

  const selectedPile = (piles ?? []).find((p) => p.pileId === pileId)
  const selectedVariety = sortedVarieties.find((v) => v.varietyId === varietyId)
  const selectedTransactionType = sortedTransactionTypes.find(
    (t) => t.transactionTypeId === transactionTypeId
  )
  const isProcurement = selectedTransactionType?.name === PROCUREMENT_TYPE_NAME
  const isSales = selectedTransactionType?.name === SALES_TYPE_NAME
  const isMilling = selectedTransactionType?.name === MILLING_TYPE_NAME
  const isTestMilling = selectedTransactionType?.name === TEST_MILLING_TYPE_NAME

  useEffect(() => {
    if (!isProcurement && farmerOrgEnabled) {
      setFarmerOrgEnabled(false)
      setMembers([emptyMember()])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcurement])

  const sackOptions = [...(sackTypes ?? [])]
    .filter((s) => !selectedVariety || selectedVariety.category === 'By Products' || s.category === selectedVariety.category)
    .sort((a, b) => byAlpha(a.code, b.code))
    .flatMap((s) =>
      ['BN', 'SH', 'US']
        .filter((cond) => s.weights?.[cond] != null)
        .map((cond) => ({
          key: `${s.sackTypeId}::${cond}`,
          sackTypeId: s.sackTypeId,
          code: s.code,
          condition: cond,
          label: `${s.code} - ${cond}`,
          weight: s.weights[cond],
        }))
    )

  // The variety-category filter above can legitimately (or transiently,
  // e.g. right after an update where the variety momentarily doesn't
  // match) exclude the currently-selected sack type from the visible
  // list - leaving <select value={sackSelection}> with no matching
  // <option> to display, so it renders blank even though the underlying
  // value is completely correct. Always add the current selection back
  // in if it's missing, so what's already chosen never visually
  // disappears just because of the category filter.
  if (sackSelection && !sackOptions.some((o) => o.key === sackSelection)) {
    const [selectedSackTypeId, selectedCondition] = sackSelection.split('::')
    const rawSackType = (sackTypes ?? []).find((s) => s.sackTypeId === selectedSackTypeId)
    if (rawSackType && rawSackType.weights?.[selectedCondition] != null) {
      sackOptions.push({
        key: sackSelection,
        sackTypeId: selectedSackTypeId,
        code: rawSackType.code,
        condition: selectedCondition,
        label: `${rawSackType.code} - ${selectedCondition}`,
        weight: rawSackType.weights[selectedCondition],
      })
    } else {
      // The sack type record itself is gone (deleted/renamed since this
      // transaction was saved), or its weight configuration no longer
      // includes this condition - the ABOVE fallback can't reconstruct
      // a real option in either case, which previously left the
      // dropdown blank with zero indication of why, even though the
      // underlying saved value is completely correct. Show what was
      // actually saved anyway, clearly marked as no longer configured,
      // rather than making it look like the data is simply missing.
      sackOptions.push({
        key: sackSelection,
        sackTypeId: selectedSackTypeId,
        code: rawSackType?.code ?? selectedSackTypeId,
        condition: selectedCondition,
        label: `${rawSackType?.code ?? '?'} - ${selectedCondition} (no longer configured)`,
        weight: rawSackType?.weights?.[selectedCondition] ?? null,
        isStale: true,
      })
    }
  }

  const selectedSack = sackOptions.find((o) => o.key === sackSelection)

  // Suggested bags to exactly complete the linked AI's remaining
  // balance - optional to use (a tappable suggestion, not auto-filled).
  // Most AI records are kilos-only (totalAllocationBags is null), so
  // this is derived from the kilos balance using the app's standard
  // 50kg/bag conversion when a direct bags balance isn't available.
  // (The gross-kilos suggestion is computed further below, after
  // bagsNum is declared - it needs the user's ACTUAL entered bags
  // count, not this estimate, per explicit correction.)
  const suggestedBagsToComplete = linkedDocDeductsFromAi && authorityRemainingKilos != null
    ? (authorityRemainingBags ?? Math.round(authorityRemainingKilos / 50))
    : null

  useEffect(() => {
    if (sackSelection) return
    if (sackOptions.length === 0) return
    const codes = new Set(sackOptions.map((o) => o.code))
    if (codes.size !== 1) return
    const onlyCode = [...codes][0]
    const matches = sackOptions.filter((o) => o.code === onlyCode)
    if (matches.length === 1) setSackSelection(matches[0].key)
  }, [sackOptions, sackSelection])

  // Suggest a starting serial for THIS warehouse's series whenever the
  // warehouse changes (or on first mount) — only while not mid-edit of an
  // existing series entry, and not when opening from a report row tap
  // (which supplies its own serialNo via prefill and must not be
  // overwritten by this suggestion).
  useEffect(() => {
    if (loadedTransaction) return
    if (prefill?.serialNo) return
    if (!currentWarehouseId) return
    let cancelled = false
    suggestNextSerial(type, currentWarehouseId, '1', activeCategory).then((serial) => {
      if (!cancelled) setSerialNo(serial)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currentWarehouseId, activeCategory])

  // Determine the true floor (lowest known real serial number) for this
  // (type, warehouse), combining local transaction history with the
  // Sheet's own record - fetched once per warehouse/type change and
  // cached, not re-fetched on every navigation. null means "no floor
  // established yet" (still loading, or genuinely nothing on record
  // anywhere), in which case floor checks are skipped entirely rather
  // than risk blocking on incomplete information.
  // Reactive local floor: automatically recomputes whenever local
  // transaction data for this (type, warehouse) changes - crucially,
  // including when background preload inserts new historical rows.
  // The previous one-time-effect approach could get stuck showing a
  // stale floor if preload was still running (or finished later) when
  // the form first opened, since nothing would trigger a recompute
  // once new data silently arrived in the background.
  const localTxForFloor = useLiveQuery(
    () => currentWarehouseId
      ? db.transactions.where('type').equals(type)
          .and((tx) => tx.warehouseId === currentWarehouseId && (activeCategory == null || tx.cerealCategory === activeCategory))
          .toArray()
      : Promise.resolve([]),
    [type, currentWarehouseId, activeCategory]
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

  // Sheet fallback: only needed until this (warehouse, type) is fully
  // preloaded, at which point local data alone is already
  // comprehensive and this is skipped entirely, avoiding a slow
  // network round-trip for no benefit. Re-runs whenever the reactive
  // local floor changes, so it stays in sync with preload completing.
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
        // Without this catch, any failure here (e.g. isPreloadComplete
        // or fetchSerialFloorFromSheet throwing) would leave
        // floorSerialNumber stuck at its initial null forever, with no
        // trace anywhere - which looks exactly like "the floor/EOF
        // never blocks anything." Falls back to whatever the local
        // floor alone says, rather than leaving it undefined entirely.
        console.error(`Floor calculation failed for ${type} (warehouse ${currentWarehouseId}):`, err)
        if (!cancelled) setFloorSerialNumber(localFloorMin)
      }
    })()
    return () => { cancelled = true }
  }, [type, currentWarehouseId, currentWarehouse?.name, localFloorMin, activeCategory])

  const applyPileDefaults = (targetPileId) => {
    if (type !== 'WSI') return
    const pile = (piles ?? []).find((p) => p.pileId === targetPileId)
    if (!pile) return

    if (pile.initialAgeValue != null) {
      const currentAge = calculateCurrentAge(pile.initialAgeValue, pile.dateOfReceipt, autoAgeMonitoring)
      const best = bestAgeUnit(currentAge)
      setAgeUnit(best.unit)
      if (best.unit === 'Months + Days') {
        setMonthsValue(liveFormatNumber(String(best.months)))
        setDaysValue(liveFormatNumber(String(best.days)))
      } else {
        setAgeValue(liveFormatNumber(String(best.value)))
      }
    }

    if (pile.moistureContent != null) {
      setMoistureContent(liveFormatNumber(String(pile.moistureContent)))
    }
  }

  useEffect(() => {
    if (!prefill) return
    if (prefill.aiNumber) setLinkedDocNo(prefill.aiNumber)
    if (prefill.authorityDate) setLinkedAuthorityDate(prefill.authorityDate)
    if (prefill.customerName) setCustomerName(prefill.customerName)
    if (prefill.pileId) setPileId(prefill.pileId)
    if (prefill.varietyId) {
      setVarietyId(prefill.varietyId)
      if (!prefill.pileId) setPileFilterVarietyId(prefill.varietyId)
      // Switch to the tab matching this variety's category - without
      // this, the prefilled variety could be invisible in the dropdown
      // if the form happened to be sitting on a different tab (e.g.
      // Rice tab active, but the authority's variety is actually
      // Palay).
      if (isCategoryScoped) {
        const matchedVariety = (varieties ?? []).find((v) => v.varietyId === prefill.varietyId)
        if (matchedVariety?.category) setCerealCategory(matchedVariety.category)
      }
    }
    if (prefill.numberOfBags != null) setNumberOfBags(liveFormatNumber(String(prefill.numberOfBags)))
    if (prefill.grossKilos != null) setGrossKilos(liveFormatNumber(String(prefill.grossKilos), 3))
    if (prefill.autoComputeNet === false) setAutoComputeNet(false)
    if (prefill.netKilos != null) setManualNetKilos(liveFormatNumber(String(prefill.netKilos), 3))
    // serialNo from a report row tap — set it and trigger the existing-
    // transaction lookup so Update/Delete appears automatically.
    if (prefill.serialNo) {
      setSerialNo(prefill.serialNo)
      setTimeout(() => checkAndLoadSerial(prefill.serialNo), 150)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // Separate from the prefill effect above on purpose: piles loads
  // asynchronously (useLiveQuery), and the prefill effect only depends
  // on [prefill], so if piles hadn't resolved yet the moment that effect
  // first ran, pile-derived defaults (age, moisture content) would
  // silently find nothing and never retry - this is exactly the bug
  // reported (age not filling when opening WSI from the pile action
  // sheet). Watching piles here lets this retry correctly once the data
  // actually arrives, without risking the whole prefill effect re-firing
  // (and resetting fields the user may have already started editing) on
  // unrelated piles changes.
  const appliedPileDefaultsRef = useRef(null)

  useEffect(() => {
    if (!prefill?.pileId) return
    if (appliedPileDefaultsRef.current === prefill.pileId) return // already applied once for this prefill
    const pile = (piles ?? []).find((p) => p.pileId === prefill.pileId)
    if (!pile) return // piles still loading - effect re-runs once it arrives, ref not yet marked
    applyPileDefaults(prefill.pileId)
    appliedPileDefaultsRef.current = prefill.pileId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.pileId, piles])

  // For Milling/Test Milling authorities, the pile isn't passed
  // directly - it's derived from the authority's own orNumber field
  // (the Sheet's OR# column intentionally holds the pile name for
  // these transaction types). Same async-safe pattern as the pileId
  // effect above: piles loads asynchronously, so this retries once it
  // actually arrives.
  const appliedPileFromOrNumberRef = useRef(null)

  useEffect(() => {
    if (prefill?.pileId) return // an explicit pileId already takes priority
    if (
      !prefill?.orNumber?.trim()
      || (prefill?.transactionTypeName !== 'Milling' && prefill?.transactionTypeName !== 'Test Milling')
    ) return
    if (appliedPileFromOrNumberRef.current === prefill.orNumber) return
    const matchedPile = (piles ?? []).find(
      (p) => p.pileName.trim().toLowerCase() === prefill.orNumber.trim().toLowerCase()
    )
    if (!matchedPile) return // piles still loading - retries once it arrives
    setPileId(matchedPile.pileId)
    appliedPileFromOrNumberRef.current = prefill.orNumber
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.orNumber, prefill?.transactionTypeName, prefill?.pileId, piles])

  // Same reasoning as the pile-age effect above: transactionTypes loads
  // asynchronously, so this retries once it arrives rather than only
  // trying at the moment the prefill effect first runs.
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

  const bagsNum = parseFormattedNumber(numberOfBags)

  // Suggested gross kilos to complete the AI's remaining net-kilos
  // balance, using the ACTUAL number of bags the user has already
  // entered (bagsNum) - NOT suggestedBagsToComplete's balance-derived
  // estimate. If the user typed a different bags count than the
  // suggestion, the gross-kilos math must reflect what they actually
  // entered, since that's what determines the real tare weight being
  // added. Requires both an MTS sack type selected (for the tare
  // weight) and an actual bags count entered (> 0) - shows null
  // otherwise rather than a number that doesn't reflect the real input.
  // Two gates, both must pass, before showing the gross-kilos
  // suggestion - purpose: only suggest when this issuance is actually
  // COMPLETING the AI (not a smaller partial/initial issuance out of a
  // much larger remaining balance):
  //   1. The bags the user actually entered must match the suggested
  //      completion bags count - if they don't match, the user isn't
  //      trying to complete the balance with this entry, so showing a
  //      "complete the balance" suggestion doesn't make sense.
  //   2. The estimated net kilos from those bags (bagsNum * 50) must be
  //      within 1000kg of the actual authority balance - a looser,
  //      kilos-scale sanity check using the more precise
  //      authorityRemainingKilos value, since bagsNum*50 is only ever
  //      an estimate.
  const bagsMatchesSuggestion = suggestedBagsToComplete != null && bagsNum === suggestedBagsToComplete
  const estimatedKilosCloseToBalance = authorityRemainingKilos != null
    && Math.abs(bagsNum * 50 - authorityRemainingKilos) <= 1000

  const suggestedGrossKilosToComplete = linkedDocDeductsFromAi && authorityRemainingKilos != null && selectedSack && bagsNum > 0
    && bagsMatchesSuggestion && estimatedKilosCloseToBalance
    ? authorityRemainingKilos + bagsNum * selectedSack.weight
    : null

  const grossNum = parseFormattedNumber(grossKilos)
  const mts = calculateMtsFromSackWeight(selectedSack?.weight ?? 0, bagsNum)
  const computedNetKilos = calculateNetKilos(grossNum, mts)
  const netKilos = autoComputeNet ? computedNetKilos : parseFormattedNumber(manualNetKilos)
  const avgWeightPerBag = calculateAverageWeightPerBag(netKilos, bagsNum)

  // Available stock on the selected pile, for issuances. When editing an
  // existing WSI entry, the pile's current totals already reflect that
  // entry's prior deduction, so "available" for validation purposes adds
  // back what this entry already took out — otherwise editing the same
  // entry without changing the amount would falsely look over-limit.
  const alreadyDeductedBags = loadedTransaction?.type === 'WSI' ? loadedTransaction.numberOfBags ?? 0 : 0
  const alreadyDeductedKilos = loadedTransaction?.type === 'WSI' ? loadedTransaction.netKilos ?? 0 : 0
  const availableBags = selectedPile ? (selectedPile.currentBags ?? 0) + alreadyDeductedBags : null
  const availableKilos = selectedPile ? (selectedPile.currentKilos ?? 0) + alreadyDeductedKilos : null

  const isIssuance = type === 'WSI'
  const overKilos = isIssuance && availableKilos != null && netKilos > availableKilos
  const overBags = isIssuance && availableBags != null && bagsNum > availableBags

  // Gates the Save button - mirrors validateForm's synchronous checks
  // (serial-uniqueness is async and stays a save-time-only safety net,
  // not part of this live gate).
  const canSave = isCancelled
    ? Boolean(currentWarehouseId) && Boolean(serialNo.trim())
    : Boolean(currentWarehouseId)
      && Boolean(transactionTypeId)
      && Boolean(serialNo.trim())
      && Boolean(customerName.trim())
      && Boolean(pileId)
      && (Boolean(selectedPile) || Boolean(varietyId))
      && (Boolean(numberOfBags) || Boolean(grossKilos))
      && Boolean(sackSelection)
      && moistureContent !== '' && !isNaN(parseFormattedNumber(moistureContent))
      && (!linkedDocDeductsFromAi || Boolean(linkedDocNo.trim()))
      && (ageUnit === 'Months + Days' ? (monthsValue !== '' && daysValue !== '') : ageValue !== '')
      && !overKilos
      && (!farmerOrgEnabled || members.every((m) => m.name.trim()))

  const updateMember = (index, field, value) => {
    setMembers((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }
  const addMember = () => setMembers((rows) => [...rows, emptyMember()])
  const removeMember = (index) => {
    setMembers((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))
  }

  const handlePileChange = (value) => {
    if (value === NEW_PILE_OPTION) {
      setShowNewPileDialog(true)
      return
    }
    setPileId(value)
    const pile = (piles ?? []).find((p) => p.pileId === value)
    if (pile?.cerealType === 'By Products') {
      // A By Products pile can hold any mix of its cereal type's
      // varieties - don't assume this transaction is the same variety
      // the pile happened to be created with, leave it for the user to
      // choose explicitly each time.
      setVarietyId('')
      setSackSelection('')
    } else if (pile?.varietyId) {
      setVarietyId(pile.varietyId)
      setSackSelection('')
    }
    applyPileDefaults(value)
  }

  const handlePileCreated = (pile) => {
    setPileId(pile.pileId)
    setVarietyId(pile.cerealType === 'By Products' ? '' : pile.varietyId)
    setSackSelection('')
    setShowNewPileDialog(false)
  }

  const handleCustomerMatch = (customer) => {
    if (customer.address) setCustomerAddress(customer.address)
    if (customer.rsbsa) setFarmerRsbsa(customer.rsbsa)
    if (customer.gender) setFarmerGender(customer.gender)
    if (customer.isFarmerOrg) {
      setFarmerOrgEnabled(true)
      if (customer.farmerCoopMembers?.length) setMembers(customer.farmerCoopMembers)
    }
  }

  const handleSelectAuthority = (authority) => {
    setLinkedDocNo(authority.aiNumber ?? '')
    setLinkedAuthorityDate(authority.date ?? null)
    setCustomerName(authority.customerName ?? '')
    if (authority.varietyId) {
      // If a pile is already selected and belongs to a different
      // variety than this AI, it's no longer valid for this
      // transaction - the AI's variety is the one that must win here.
      const currentPile = (piles ?? []).find((p) => p.pileId === pileId)
      if (currentPile && currentPile.varietyId !== authority.varietyId) {
        setPileId('')
      }
      setVarietyId(authority.varietyId)
      setPileFilterVarietyId(authority.varietyId)
      // Switch to the matching tab here too, for the same reason as
      // the prefill path (opening the form from the home page monitor).
      if (isCategoryScoped) {
        const matchedVariety = (varieties ?? []).find((v) => v.varietyId === authority.varietyId)
        if (matchedVariety?.category) setCerealCategory(matchedVariety.category)
      }
    }
    if (authority.transactionTypeName) {
      const match = (transactionTypes ?? []).find((t) => t.name === authority.transactionTypeName)
      if (match) setTransactionTypeId(match.transactionTypeId)
    }

    // For Milling/Test Milling authorities specifically, the Sheet's
    // OR# column intentionally holds the pile name (e.g. "Pile 1",
    // "Pile 2B") rather than an actual OR number - this is where the
    // app should READ that pile assignment from and auto-select it,
    // not a misplaced field to relocate.
    if (
      (authority.transactionTypeName === 'Milling' || authority.transactionTypeName === 'Test Milling')
      && authority.orNumber?.trim()
    ) {
      const matchedPile = (piles ?? []).find(
        (p) => p.pileName.trim().toLowerCase() === authority.orNumber.trim().toLowerCase()
      )
      if (matchedPile) setPileId(matchedPile.pileId)
    }

    const kilosRemaining = authority.totalAllocationKilos != null
      ? parseFloat((authority.totalAllocationKilos - (authority.totalIssuedKilos ?? 0)).toFixed(2))
      : null
    const bagsRemaining = authority.totalAllocationBags != null
      ? parseFloat((authority.totalAllocationBags - (authority.totalIssuedBags ?? 0)).toFixed(2))
      : null

    if (bagsRemaining != null && bagsRemaining > 0) setNumberOfBags(liveFormatNumber(String(bagsRemaining)))
    if (kilosRemaining != null && kilosRemaining > 0) {
      setAutoComputeNet(false)
      setManualNetKilos(liveFormatNumber(String(kilosRemaining), 3))
    }

    setShowAuthorityPicker(false)
  }

  const scrollToCustomerName = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    customerNameRef.current?.focus()
  }

  // Loads an existing transaction's full data into the form for review/
  // edit, switching the footer to Update/Delete.
  const loadTransactionIntoForm = (tx) => {
    setLoadedTransaction(tx)
    if (isCategoryScoped && tx.cerealCategory) setCerealCategory(tx.cerealCategory)
    setIsCancelled(tx.status === 'Cancelled')
    setDate(tx.date ?? blankFormState.date)
    setLinkedDocNo(tx.linkedDocNo ?? tx.aiNumber ?? '')
    setCustomerName(tx.customerName ?? '')
    setCustomerAddress(tx.customerAddress ?? '')
    setFarmerRsbsa(tx.farmerRsbsa ?? '')
    setOrNumber(tx.orNumber ?? '')
    setMoNumber(tx.moNumber ?? '')
    setBatchNumber(tx.batchNumber ?? '')
    setTmoNumber(tx.tmoNumber ?? '')
    setTrialNumber(tx.trialNumber ?? '')
    setFarmerGender(tx.farmerGender ?? '')
    setTransactionTypeId(tx.transactionTypeId ?? '')
    setPileId(tx.pileId ?? '')
    setVarietyId(tx.varietyId ?? '')
    setSackSelection(
      tx.mtsSackTypeId && tx.mtsCondition ? `${tx.mtsSackTypeId}::${tx.mtsCondition}` : ''
    )
    setNumberOfBags(tx.numberOfBags != null ? liveFormatNumber(String(tx.numberOfBags)) : '')
    setGrossKilos(tx.grossKilos != null ? liveFormatNumber(String(tx.grossKilos), 3) : '')
    setAutoComputeNet(tx.autoComputeNet ?? true)
    setManualNetKilos(tx.autoComputeNet ? '' : liveFormatNumber(String(tx.netKilos ?? ''), 3))
    setAgeValue(tx.ageValue != null ? liveFormatNumber(String(tx.ageValue)) : '')
    setAgeUnit(tx.ageUnit ?? 'Days')
    if (tx.ageUnit === 'Months + Days' && tx.initialAgeValue != null) {
      setMonthsValue(liveFormatNumber(String(Math.floor(tx.initialAgeValue / 30))))
      setDaysValue(liveFormatNumber(String(tx.initialAgeValue % 30)))
    }
    setCondition(tx.condition ?? '')
    setMoistureContent(tx.moistureContent != null ? liveFormatNumber(String(tx.moistureContent)) : '')
    setFarmerOrgEnabled(Boolean(tx.farmerCoops?.length))
    setMembers(tx.farmerCoops?.length ? tx.farmerCoops : [emptyMember()])
  }

  const resetToBlankEntry = (nextSerial) => {
    setLoadedTransaction(null)
    setIsCancelled(false)
    setSerialNo(nextSerial)
    setDate(blankFormState.date)
    setLinkedDocNo('')
    setCustomerName('')
    setCustomerAddress('')
    setFarmerRsbsa('')
    setFarmerGender('')
    setNumberOfBags('')
    setGrossKilos('')
    setManualNetKilos('')
    setMoistureContent('')
    setFarmerOrgEnabled(false)
    setMembers([emptyMember()])
    setOrNumber('')
    setMoNumber('')
    setBatchNumber('')
    setTmoNumber('')
    setTrialNumber('')
  }

  // Checks whether a given serial has existing data for this (type,
  // warehouse) and, if so, loads it. Returns true if it loaded something.
  // Guards against a real race condition: if the user navigates
  // rapidly (multiple quick step/type actions before a slower lookup
  // - especially a Sheet lookup for a serial not found locally, which
  // can take noticeably longer for a large sheet - has resolved),
  // overlapping async calls can resolve out of order. Without this
  // guard, whichever call happens to finish LAST wins and overwrites
  // the form, even if the user has already moved on to a different
  // serial - this is what caused navigation to sometimes "jump" or
  // show a different serial's data than what's actually being viewed.
  const latestRequestedSerial = useRef(null)
  const [isLookingUp, setIsLookingUp] = useState(false)

  const checkAndLoadSerial = async (serial) => {
    if (!currentWarehouseId) return false
    latestRequestedSerial.current = serial
    setIsLookingUp(true)
    try {
      const existing = await findTransactionBySerial(type, currentWarehouseId, serial, activeCategory)
      if (latestRequestedSerial.current !== serial) return false // superseded by a newer request - discard this stale result
      if (existing) {
        loadTransactionIntoForm(existing)
        return true
      }

      // Not found locally - that alone doesn't mean it never existed,
      // UNLESS this (warehouse, type) has already been fully preloaded,
      // in which case local data is already comprehensive and "not
      // found" is a definitive answer - skip the slow Sheet lookup
      // entirely in that case.
      const preloaded = await isPreloadComplete(currentWarehouseId, type)
      const sheetResult = preloaded
        ? { ok: true, row: null }
        : await fetchTransactionBySerial(type, currentWarehouse?.name, serial)
      if (latestRequestedSerial.current !== serial) return false // superseded - discard
      if (sheetResult.ok && sheetResult.row) {
        const varietyByName = new Map(sortedVarieties.map((v) => [v.name.trim().toLowerCase(), { varietyId: v.varietyId, category: v.category }]))
        const imported = mapSheetRowToTransaction(type, sheetResult.row, {
          warehouseId: currentWarehouseId,
          varietyByName,
        })
        await db.transactions.add(imported)
        await recordSerialUsed(type, currentWarehouseId, serial, activeCategory)
        if (latestRequestedSerial.current !== serial) return false // superseded during the write - discard
        loadTransactionIntoForm(imported)
        if (imported.needsCompletion) {
          toast('Pulled from historical Sheet data - Pile and MTS Sack need to be filled in before saving further changes.', { icon: '📋', duration: 6000 })
        }
        return true
      }

      if (latestRequestedSerial.current !== serial) return false // superseded - discard
      if (loadedTransaction) {
        // Stepped/typed away from the loaded entry onto a blank serial —
        // return to normal new-entry mode.
        setLoadedTransaction(null)
      }
      return false
    } finally {
      if (latestRequestedSerial.current === serial) setIsLookingUp(false)
    }
  }

  const handleSerialChange = async (value) => {
    setSerialNo(value)
    const loaded = await checkAndLoadSerial(value)
    if (!loaded && value.trim() && latestRequestedSerial.current === value) resetToBlankEntry(value)
  }

  // Checked on blur (not on every keystroke, which would interrupt
  // typing) - if nothing was found for this serial anywhere (not
  // loaded, meaning checkAndLoadSerial's local+Sheet lookups both came
  // up empty) and it's below the known floor, a regular user gets a
  // clear warning instead of silently being allowed to create a
  // duplicate/out-of-sequence entry. Admins bypass this, since they
  // may be intentionally backfilling genuinely undocumented history.
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
    const latest = await suggestNextSerial(type, currentWarehouseId, '1', activeCategory)
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

  const initialAgeDays = ageUnit === 'Months + Days'
    ? Math.round((parseFormattedNumber(monthsValue) || 0) * 30 + (parseFormattedNumber(daysValue) || 0))
    : (ageValue === '' ? 0 : normalizeAgeToDays(parseFormattedNumber(ageValue), ageUnit))

  const buildCancelledPayload = (overrides = {}) => ({
    type,
    serialNo: serialNo.trim(),
    status: 'Cancelled',
    date,
    warehouseId: currentWarehouseId,
    // Deliberately preserved (unlike every other field below) so a
    // cancelled document still shows under its correct Rice/Palay
    // section in reports, instead of an "Unknown" catch-all - this is
    // an interim fix ahead of the planned per-cereal-type series tabs,
    // where the cereal category will be known unambiguously from
    // which tab is active rather than needing this fallback at all.
    cerealCategory: activeCategory ?? selectedVariety?.category ?? null,
    linkedDocNo: null,
    aiNumber: null,
    customerName: null,
    customerAddress: null,
    transactionTypeId: null,
    pileId: null,
    varietyId: null,
    mtsSackTypeId: null,
    mtsCondition: null,
    numberOfBags: null,
    grossKilos: null,
    mts: null,
    autoComputeNet: true,
    netKilos: null,
    ageValue: null,
    ageUnit: 'Days',
    initialAgeValue: null,
    condition: null,
    moistureContent: null,
    farmerRsbsa: null,
    farmerGender: null,
    farmerCoops: null,
    isSynced: false,
    ...overrides,
  })

  const buildTransactionPayload = (overrides = {}) => (isCancelled ? buildCancelledPayload(overrides) : {
    type,
    serialNo: serialNo.trim(),
    status: 'Active',
    cerealCategory: activeCategory,
    date,
    warehouseId: currentWarehouseId,
    linkedDocNo: linkedDocNo.trim() || null,
    aiNumber: linkedDocDeductsFromAi ? linkedDocNo.trim() || null : null,
    customerName: customerName.trim(),
    customerAddress: customerAddress.trim() || null,
    transactionTypeId: transactionTypeId || null,
    pileId,
    varietyId: varietyId || null,
    mtsSackTypeId: sackSelection ? sackSelection.split('::')[0] : null,
    mtsCondition: sackSelection ? sackSelection.split('::')[1] : null,
    numberOfBags: numberOfBags === '' ? null : bagsNum,
    grossKilos: grossKilos === '' ? null : grossNum,
    mts,
    autoComputeNet,
    netKilos,
    ageValue: ageUnit === 'Months + Days' ? initialAgeDays : (ageValue === '' ? null : parseFormattedNumber(ageValue)),
    ageUnit,
    initialAgeValue: initialAgeDays,
    condition,
    moistureContent: moistureContent === '' ? null : parseFloat(parseFormattedNumber(moistureContent).toFixed(2)),
    farmerRsbsa: isProcurement ? farmerRsbsa.trim() || null : null,
    farmerGender: isProcurement ? farmerGender || null : null,
    farmerCoops: farmerOrgEnabled ? members.map((m) => ({ ...m })) : null,
    orNumber: isSales ? orNumber.trim() || null : null,
    recordedByName: user?.name ?? user?.nickname ?? null,
    moNumber: isMilling ? moNumber.trim() || null : null,
    batchNumber: isMilling ? batchNumber.trim() || null : null,
    tmoNumber: isTestMilling ? tmoNumber.trim() || null : null,
    trialNumber: isTestMilling ? trialNumber || null : null,
    isSynced: false,
    ...overrides,
  })

  const validateForm = async ({ excludeId = null } = {}) => {
    if (!currentWarehouseId) {
      toast.error('No warehouse selected')
      return false
    }
    if (!serialNo.trim()) {
      toast.error('Serial No. is required')
      return false
    }
    if (await isSerialTaken(type, currentWarehouseId, serialNo.trim(), excludeId, activeCategory)) {
      toast.error(`Serial ${serialNo.trim()} is already used for a ${type} document at this warehouse`)
      return false
    }
    if (isCancelled) return true
    if (!customerName.trim()) {
      toast.error('Name is required')
      return false
    }
    if (!pileId) {
      toast.error('Select a Pile ID')
      return false
    }
    if (!numberOfBags && !grossKilos) {
      toast.error('Enter Number of Bags and/or Gross Kilos')
      return false
    }
    if (!condition) {
      toast.error('Select a Condition')
      return false
    }
    if (moistureContent === '' || isNaN(parseFormattedNumber(moistureContent))) {
      toast.error('Moisture Content (MC %) is required')
      return false
    }
    if (overKilos) {
      toast.error(
        `Net Kilos (${fmtWeight(netKilos, weightUnit)}) exceeds this pile's available stock (${fmtWeight(availableKilos, weightUnit)}) - a pile limit, not the AI balance`
      )
      return false
    }
    if (farmerOrgEnabled) {
      const incomplete = members.some((m) => !m.name.trim())
      if (incomplete) {
        toast.error('Each farmer organization member needs at least a Name')
        return false
      }
    }
    return true
  }

  const adjustAuthorityBalance = async (linkedNo, bagsDelta, kilosDelta) => {
    if (!linkedDocDeductsFromAi || !linkedNo) return
    const authority = await db.authorities.where('aiNumber').equals(linkedNo).first()
    if (!authority) return
    await db.authorities.update(authority.authId, {
      totalIssuedKilos:
        authority.totalAllocationKilos != null
          ? (authority.totalIssuedKilos ?? 0) + kilosDelta
          : authority.totalIssuedKilos,
      totalIssuedBags:
        authority.totalAllocationBags != null
          ? (authority.totalIssuedBags ?? 0) + bagsDelta
          : authority.totalIssuedBags,
    })
  }

  const performSave = async (trial3Confirmed) => {
    setIsSaving(true)

    const transaction = { id: crypto.randomUUID(), ...buildTransactionPayload() }

    await db.transactions.add(transaction)
    await recordSerialUsed(type, currentWarehouseId, serialNo.trim(), activeCategory)
    await applyTransactionToPile(transaction)
    await rememberCustomer({
      name: customerName.trim(),
      address: customerAddress.trim() || null,
      rsbsa: isProcurement ? farmerRsbsa.trim() || null : null,
      gender: isProcurement ? farmerGender || null : null,
      isFarmerOrg: farmerOrgEnabled,
      farmerCoopMembers: farmerOrgEnabled ? members.map((m) => ({ ...m })) : null,
      warehouseId: currentWarehouseId,
    })

    if (linkedDocDeductsFromAi && linkedDocNo.trim()) {
      await adjustAuthorityBalance(linkedDocNo.trim(), bagsNum, netKilos)
    }

    // The transaction saves regardless of the answer - it's a real
    // recorded event either way. Only an explicit "Yes" here marks
    // trial3Confirmed, which is what actually gates overall TMO
    // fulfillment - never inferred just from 3 trial records existing.
    if (trial3Confirmed) {
      await db.millingOrders.where('orderId').equals(`TMO::${tmoNumber.trim()}`).modify({ trial3Confirmed: true })

      // Fulfilled the moment all 3 trials have SOME recovery AND this
      // confirmation just landed - write DONE to the sheet. Queries
      // fresh rather than relying on the reactive list, which may not
      // yet reflect the transaction just saved above.
      const trialTx = await db.transactions
        .where('tmoNumber').equals(tmoNumber.trim())
        .and((t) => t.type === 'WSR' && t.status === 'Active' && (t.netKilos ?? 0) > 0)
        .toArray()
      const recoveredTrials = new Set(trialTx.map((t) => t.trialNumber))
      if (['1', '2', '3'].every((n) => recoveredTrials.has(n))) {
        await markMillingOrderDone('TMO', tmoNumber.trim())
      }
    }

    // Milling: check if this MO's recovery has now been fully met by
    // this save, and write DONE if so.
    if (type === 'WSR' && isMilling && moNumber.trim()) {
      const order = await db.millingOrders.where('orderId').equals(`MO::${moNumber.trim()}`).first()
      if (order?.recoveryPercent != null) {
        const moTx = await db.transactions
          .where('moNumber').equals(moNumber.trim())
          .and((t) => t.status === 'Active')
          .toArray()
        const issuedKg = moTx.filter((t) => t.type === 'WSI').reduce((s, t) => s + (t.netKilos ?? 0), 0)
        const receivedKg = moTx.filter((t) => t.type === 'WSR').reduce((s, t) => s + (t.netKilos ?? 0), 0)
        const expectedKg = issuedKg * (order.recoveryPercent / 100)
        if (expectedKg > 0 && receivedKg >= expectedKg) {
          await markMillingOrderDone('MO', moNumber.trim())
        }
      }
    }

    toast.success(`${type} saved — ${serialNo.trim()}`)

    const next = stepSerial(serialNo.trim(), 1)
    resetToBlankEntry(next)
    setIsSaving(false)
    scrollToCustomerName()
  }

  const handleSave = async () => {
    if (overBags && !overKilos) {
      // Bags-over is a soft warning the user already saw inline — allow
      // it through, since some transaction types legitimately exceed the
      // bag count (net kilos is the hard limit, per clarification).
    }

    const ok = await validateForm()
    if (!ok) return

    // A Test Milling receipt for Trial 3 specifically needs an explicit
    // confirmation before it can ever count toward TMO fulfillment -
    // per the requirement that this is asked, not inferred.
    if (type === 'WSR' && isTestMilling && trialNumber === '3' && netKilos > 0) {
      setPendingTrial3Confirm(true)
      return
    }

    await performSave(false)
  }

  const handleUpdate = async () => {
    const ok = await validateForm({ excludeId: loadedTransaction.id })
    if (!ok) return

    setIsSaving(true)

    // Reverse the OLD effect, then apply the NEW one — pile totals and
    // authority balances must reflect only the corrected values.
    await reverseTransactionFromPile(loadedTransaction)
    if (loadedTransaction.aiNumber) {
      await adjustAuthorityBalance(
        loadedTransaction.aiNumber,
        -(loadedTransaction.numberOfBags ?? 0),
        -(loadedTransaction.netKilos ?? 0)
      )
    }

    const updated = buildTransactionPayload({ id: loadedTransaction.id })
    await db.transactions.update(loadedTransaction.id, updated)
    await applyTransactionToPile(updated)
    await rememberCustomer({
      name: customerName.trim(),
      address: customerAddress.trim() || null,
      rsbsa: isProcurement ? farmerRsbsa.trim() || null : null,
      gender: isProcurement ? farmerGender || null : null,
      isFarmerOrg: farmerOrgEnabled,
      farmerCoopMembers: farmerOrgEnabled ? members.map((m) => ({ ...m })) : null,
      warehouseId: currentWarehouseId,
    })

    if (linkedDocDeductsFromAi && linkedDocNo.trim()) {
      await adjustAuthorityBalance(linkedDocNo.trim(), bagsNum, netKilos)
    }

    toast.success(`${type} ${serialNo.trim()} updated`)
    setLoadedTransaction(updated)
    setIsSaving(false)
  }

  const handleDeleteConfirmed = async () => {
    setPendingDelete(false)
    setIsSaving(true)

    await reverseTransactionFromPile(loadedTransaction)
    if (loadedTransaction.aiNumber) {
      await adjustAuthorityBalance(
        loadedTransaction.aiNumber,
        -(loadedTransaction.numberOfBags ?? 0),
        -(loadedTransaction.netKilos ?? 0)
      )
    }

    await db.transactions.delete(loadedTransaction.id)
    await recalculateSerialCounter(type, currentWarehouseId, activeCategory)
    queueTransactionDeletion(loadedTransaction.serialNo, loadedTransaction.type, currentWarehouse?.code) // fire-and-forget - local delete is already done, don't make the UI wait on the network

    toast.success(`${type} ${serialNo.trim()} deleted`)

    const freedSerial = serialNo.trim()
    resetToBlankEntry(freedSerial)
    setIsSaving(false)
  }

  // Voiding bypasses the normal Save button entirely - confirming
  // immediately writes the Cancelled record, since a void document
  // has no real data to validate (serial/date/warehouse are all that
  // matter). If an existing Active transaction is being voided, its
  // prior pile/authority effects are reversed first, since it no
  // longer represents a real movement.
  const handleConfirmVoid = async () => {
    setPendingVoidAction(null)
    setIsSaving(true)
    if (loadedTransaction && loadedTransaction.status !== 'Cancelled') {
      await reverseTransactionFromPile(loadedTransaction)
      if (loadedTransaction.aiNumber) {
        await adjustAuthorityBalance(
          loadedTransaction.aiNumber,
          -(loadedTransaction.numberOfBags ?? 0),
          -(loadedTransaction.netKilos ?? 0)
        )
      }
    }
    const cancelledRecord = loadedTransaction
      ? buildCancelledPayload({ id: loadedTransaction.id })
      : { id: crypto.randomUUID(), ...buildCancelledPayload() }
    if (loadedTransaction) {
      await db.transactions.update(loadedTransaction.id, cancelledRecord)
    } else {
      await db.transactions.add(cancelledRecord)
    }
    await recordSerialUsed(type, currentWarehouseId, serialNo.trim(), activeCategory)
    setIsCancelled(true)
    setLoadedTransaction(cancelledRecord)
    toast.success(`${type} ${serialNo.trim()} has been cancelled/voided`)
    setIsSaving(false)
  }

  // Un-voiding deletes the Cancelled record entirely (not just flips a
  // flag) - this is what actually makes the serial available again for
  // a fresh entry, rather than leaving behind an incomplete "Active"
  // record that would immediately fail the normal validation rules.
  const handleConfirmUnvoid = async () => {
    setPendingVoidAction(null)
    if (!loadedTransaction) { setIsCancelled(false); return }
    setIsSaving(true)
    await db.transactions.delete(loadedTransaction.id)
    await recalculateSerialCounter(type, currentWarehouseId, activeCategory)
    queueTransactionDeletion(loadedTransaction.serialNo, loadedTransaction.type, currentWarehouse?.code)
    toast.success(`${type} ${serialNo.trim()} is no longer cancelled — available again`)
    const freedSerial = serialNo.trim()
    resetToBlankEntry(freedSerial)
    setIsSaving(false)
  }

  const handleCategoryTabChange = (nextCategory) => {
    if (nextCategory === cerealCategory) return
    setCerealCategory(nextCategory)
    setLoadedTransaction(null)
    setPileId('')
    setVarietyId('')
    setSackSelection('')
  }

  const isEditMode = Boolean(loadedTransaction)

  const handleCloseWithAnimation = () => {
    setIsClosing(true)
    setTimeout(onClose, 380)
  }

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 transition-all duration-[380ms] ease-out ${hasEntered && !isClosing ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-app-text">{title}</h1>
          <button
            type="button"
            onClick={handleCloseWithAnimation}
            disabled={isSaving}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 hover:shadow-[0_0_12px_rgba(239,68,68,0.4)] active:scale-90 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {sortedWarehouses.length > 1 ? (
          <div className="mt-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-neon">Warehouse</label>
            <select
              value={currentWarehouseId ?? ''}
              onChange={(e) => {
                setCurrentWarehouseId(e.target.value)
                setPileId('')
                setVarietyId('')
                setSackSelection('')
                setLoadedTransaction(null)
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

        {isCategoryScoped && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { key: 'Rice', label: 'Rice', activeClasses: 'border-blue-400 bg-blue-400/10 text-blue-400' },
              { key: 'Palay', label: 'Palay', activeClasses: 'border-brand-neon bg-brand-neon/10 text-brand-neon' },
              { key: 'By Products', label: 'By Products', activeClasses: 'border-brand-byproduct bg-brand-byproduct/10 text-brand-byproduct' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleCategoryTabChange(tab.key)}
                className={`rounded-lg border-2 py-2.5 text-sm font-bold transition-all active:scale-95 ${
                  cerealCategory === tab.key ? tab.activeClasses : 'border-neutral-800 bg-neutral-900 text-neutral-500'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {!isSerialFieldVisible && serialNo && (
          <p className="mt-2 rounded-xl border-2 border-brand-neon bg-brand-neon/10 px-3 py-2.5 text-center font-mono text-lg font-bold text-brand-neon shadow-[0_0_16px_-4px_rgba(0,255,163,0.4)]">
            {type} # {serialNo}
          </p>
        )}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="space-y-3">
          <AnimatedBanner show={isEditMode} className="rounded-xl border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
            Reviewing existing {type} {loadedTransaction?.serialNo} — Update or Delete below.
          </AnimatedBanner>

          <AnimatedBanner show={Boolean(loadedTransaction?.needsCompletion)} className="rounded-xl border-2 border-brand-amber bg-brand-amber/10 px-3 py-2 text-sm font-medium text-brand-amber">
            This record was pulled from historical Sheet data. Pile and MTS Sack were not tracked there and need to be filled in below before further changes can be saved.
          </AnimatedBanner>

          <div ref={serialFieldRef}>
            <label className={labelClass}>Serial No.</label>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleStepBack}
                aria-label="Previous serial"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-90"
              >
                <ChevronLeft size={18} />
              </button>
              <input
                type="text"
                value={serialNo}
                onChange={(e) => handleSerialChange(e.target.value)}
                onBlur={handleSerialBlur}
                className={`mt-0 w-full rounded-xl border bg-neutral-950 px-3 py-2 text-center font-mono text-app-text outline-none transition-colors focus:border-brand-neon ${!serialNo.trim() ? '!border-brand-amber' : 'border-neutral-800'} ${navFlash === 'back' ? 'animate-nav-back' : navFlash === 'forward' ? 'animate-nav-forward' : ''}`}
                placeholder="0000000"
              />
              <button
                type="button"
                onClick={handleStepForward}
                aria-label="Next serial"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-90"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {isLookingUp ? (
                <span className="inline-flex items-center gap-1.5 text-brand-neon">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-neon border-t-transparent" />
                  Looking up serial…
                </span>
              ) : (
                'Type a serial directly to jump to it — existing data loads automatically.'
              )}
            </p>
          </div>

          <div className={`space-y-3 rounded-xl transition-opacity ${isCancelled ? 'border-2 border-brand-crimson p-2 opacity-40' : ''} ${navFlash ? 'stagger-fields' : ''}`}>
          <div>
            <label className={labelClass}>Date</label>
            <CalendarDatePicker value={date} onChange={setDate} />
          </div>

          <div>
            <label className={labelClass}>{linkedDocLabel}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={linkedDocNo}
                onChange={(e) => setLinkedDocNo(e.target.value)}
                className={`${inputClass} ${linkedDocDeductsFromAi && !linkedDocNo.trim() ? '!border-brand-amber' : ''}`}
                placeholder={type === 'WSR' ? 'Optional' : '26219637'}
              />
              {linkedDocDeductsFromAi && (
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

          <div>
            <label className={labelClass}>Nature of Transaction</label>
            <select
              value={transactionTypeId}
              onChange={(e) => setTransactionTypeId(e.target.value)}
              className={`${inputClass} ${!transactionTypeId ? '!border-brand-amber' : ''}`}
            >
              <option value="">Select…</option>
              {sortedTransactionTypes.map((t) => (
                <option key={t.transactionTypeId} value={t.transactionTypeId}>
                  {t.name}
                </option>
              ))}
            </select>
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

          {isSales && (
            <div>
              <label className={labelClass}>OR # (optional)</label>
              <input
                type="text"
                value={orNumber}
                onChange={(e) => setOrNumber(e.target.value)}
                className={inputClass}
                placeholder="Official Receipt number"
              />
            </div>
          )}

          {isMilling && (() => {
            const availableMoOrders = millingOrderOptions.filter((o) => !o.fulfilled || o.number === moNumber)
            const selectedOrder = millingOrderOptions.find((o) => o.number === moNumber)
            const isDerived = type !== 'WSR'

            return (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>MO Number</label>
                  {isDerived ? (
                    <input
                      type="text"
                      value={moNumber}
                      readOnly
                      disabled
                      className={`${inputClass} bg-neutral-800 text-neutral-400`}
                      placeholder="Select an AI above first"
                    />
                  ) : (
                    <select
                      value={moNumber}
                      onChange={(e) => {
                        const nextNumber = e.target.value
                        setMoNumber(nextNumber)
                        const order = millingOrderOptions.find((o) => o.number === nextNumber)
                        setBatchNumber(order?.batchCurrent != null ? String(order.batchCurrent) : '')
                        // Auto-fills the miller's name into Customer Name -
                        // this is what actually makes the miller flow into
                        // the customer directory (via rememberCustomer),
                        // so they show up in the same admin customer list
                        // rather than needing separate manual entry.
                        if (order?.ricemillName) setCustomerName(order.ricemillName)
                      }}
                      className={`${inputClass} ${!moNumber.trim() ? '!border-brand-amber' : ''}`}
                    >
                      <option value="">Select…</option>
                      {availableMoOrders.map((o) => (
                        <option key={o.number} value={o.number}>{o.number} - {o.ricemillName}</option>
                      ))}
                    </select>
                  )}
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
            )
          })()}

          {isTestMilling && (() => {
            const availableTmoNumbers = millingOrderOptions.filter((o) => !o.fulfilled || o.number === tmoNumber)
            const isDerived = type !== 'WSR'

            return (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>TMO Number</label>
                  {isDerived ? (
                    <input
                      type="text"
                      value={tmoNumber}
                      readOnly
                      disabled
                      className={`${inputClass} bg-neutral-800 text-neutral-400`}
                      placeholder="Select an AI above first"
                    />
                  ) : (
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
                        <option key={o.number} value={o.number}>{o.number} - {o.ricemillName}</option>
                      ))}
                    </select>
                  )}
                </div>
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
              </div>
            )
          })()}

          {isProcurement && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>RSBSA</label>
                <input
                  type="text"
                  value={farmerRsbsa}
                  onChange={(e) => setFarmerRsbsa(e.target.value)}
                  className={inputClass}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className={labelClass}>Gender</label>
                <select
                  value={farmerGender}
                  onChange={(e) => setFarmerGender(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Optional</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Pile ID</label>
              <select
                value={pileId}
                onChange={(e) => handlePileChange(e.target.value)}
                className={`${inputClass} ${!pileId ? '!border-brand-amber' : ''}`}
              >
                <option value="">Select pile…</option>
                {sortedPiles.map((p) => {
                  const variety = sortedVarieties.find((v) => v.varietyId === p.varietyId)
                  return (
                    <option key={p.pileId} value={p.pileId}>
                      {p.pileName} ({variety ? variety.name : p.cerealType})
                    </option>
                  )
                })}
                <option value={NEW_PILE_OPTION}>+ New Pile</option>
              </select>
              {pileFilterVarietyId && (
                <p className="mt-1 text-xs text-neutral-500">
                  Showing only piles matching the linked authority's variety.
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>Variety Type</label>
              {selectedPile && selectedPile.cerealType !== 'By Products' ? (
                <div className={readOnlyClass}>
                  {selectedVariety ? `${selectedVariety.name} (${selectedVariety.category})` : '—'}
                </div>
              ) : (
                <select
                  value={varietyId}
                  onChange={(e) => {
                    setVarietyId(e.target.value)
                    setSackSelection('')
                  }}
                  className={`${inputClass} ${!varietyId ? '!border-brand-amber' : ''}`}
                >
                  <option value="">Select variety…</option>
                  {sortedVarieties.map((v) => (
                    <option key={v.varietyId} value={v.varietyId}>
                      {v.name} ({v.category})
                    </option>
                  ))}
                </select>
              )}
              {selectedPile && (
                <p className="mt-1 text-xs text-neutral-500">
                  Locked to this pile's variety — piles never mix varieties.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>MC % (Moisture Content)</label>
              <input
                type="text"
                inputMode="decimal"
                value={moistureContent}
                onChange={(e) => setMoistureContent(liveFormatNumber(e.target.value))}
                className={`${inputClass} ${moistureContent === '' ? '!border-brand-amber' : ''}`}
                placeholder="13.90"
              />
            </div>

            <div>
              <label className={labelClass}>MTS — Sack Code &amp; Condition</label>
              <select
                value={sackSelection}
                onChange={(e) => setSackSelection(e.target.value)}
                className={`${inputClass} ${!sackSelection ? '!border-brand-amber' : ''}`}
              >
                <option value="">Select sack code…</option>
                {sackOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              {sackOptions.length === 0 && (
                <p className="mt-1 text-xs text-neutral-500">
                  {selectedVariety
                    ? `No ${selectedVariety.category} sack types configured with a weight yet.`
                    : 'Select a variety to see matching sack types.'}
                </p>
              )}
            </div>
          </div>

          {selectedPile && isIssuance && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
              Available on {selectedPile.pileName}: {fmtBags(availableBags)} bags ·{' '}
              {fmtWeight(availableKilos, weightUnit)}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Number of Bags</label>
              <input
                type="text"
                inputMode="decimal"
                value={numberOfBags}
                onChange={(e) => setNumberOfBags(liveFormatNumber(e.target.value))}
                className={`${inputClass} ${overBags ? 'border-brand-amber' : ''}`}
                placeholder="0"
              />
              {overBags && (
                <p className="mt-1 text-xs text-brand-amber">
                  Exceeds available bags — allowed for some transaction types.
                </p>
              )}
              {suggestedBagsToComplete != null && suggestedBagsToComplete > 0 && (
                <button
                  type="button"
                  onClick={() => setNumberOfBags(liveFormatNumber(String(suggestedBagsToComplete)))}
                  className="mt-1 rounded-lg border border-brand-neon/40 bg-brand-neon/10 px-2 py-1 text-xs text-brand-neon transition-all hover:bg-brand-neon/20 active:scale-95"
                >
                  Use {suggestedBagsToComplete.toLocaleString()} bags to complete AI balance
                </button>
              )}
            </div>
            <div>
              <label className={labelClass}>Gross Kilos</label>
              <ValidatedField
                inputMode="decimal"
                value={grossKilos}
                onChange={(e) => setGrossKilos(liveFormatNumber(e.target.value, 3))}
                placeholder="0.000"
                validate={(v) => {
                  if (v === '') return null // not yet entered - no opinion until the user actually leaves it blank on purpose
                  const num = parseFormattedNumber(v)
                  if (!(num > 0)) return { valid: false, message: 'Gross Kilos must be greater than 0' }
                  return { valid: true }
                }}
              />
              {suggestedGrossKilosToComplete != null && suggestedGrossKilosToComplete > 0 && (
                <button
                  type="button"
                  onClick={() => setGrossKilos(liveFormatNumber(suggestedGrossKilosToComplete.toFixed(3), 3))}
                  className="mt-1 rounded-lg border border-brand-neon/40 bg-brand-neon/10 px-2 py-1 text-xs text-brand-neon transition-all hover:bg-brand-neon/20 active:scale-95"
                >
                  Use {fmtWeight(suggestedGrossKilosToComplete, weightUnit, 'Gross')} to complete AI balance
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3">
            <span className="text-xs text-neutral-400">Auto-compute Net Kilos</span>
            <button
              type="button"
              onClick={() => setAutoComputeNet((v) => !v)}
              aria-pressed={autoComputeNet}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                autoComputeNet ? 'bg-brand-neon' : 'bg-neutral-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-neutral-950 shadow transition-transform ${
                  autoComputeNet ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className={labelClass}>Net Kilos</label>
            {autoComputeNet ? (
              <div className={`${readOnlyClass} ${overKilos ? 'border-brand-crimson text-brand-crimson' : ''}`}>
                {fmtWeight(netKilos, weightUnit)}
              </div>
            ) : (
              <input
                type="text"
                inputMode="decimal"
                value={manualNetKilos}
                onChange={(e) => setManualNetKilos(liveFormatNumber(e.target.value, 3))}
                className={`${inputClass} ${overKilos ? 'border-brand-crimson' : ''}`}
                placeholder="0.000"
              />
            )}
            {overKilos && (
              <p className="mt-1 text-xs text-brand-crimson">
                Cannot exceed available Net Kilos ({fmtWeight(availableKilos, weightUnit)}) — this is a hard limit.
              </p>
            )}
            {bagsNum > 0 && !overKilos && (
              <p className="mt-1 text-xs text-neutral-500">
                Average weight per bag: {avgWeightPerBag.toFixed(2)} kg
              </p>
            )}
            {linkedDocDeductsFromAi && authorityRemainingKilos != null && (
              <p className="mt-1 text-xs text-brand-neon">
                AI balance remaining: {fmtWeight(authorityRemainingKilos, weightUnit, 'Net')}
                {' '}({(authorityRemainingBags ?? Math.round(authorityRemainingKilos / 50)).toLocaleString()} bags)
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {ageUnit === 'Months + Days' ? (
              <>
                <div>
                  <label className={labelClass}>Months</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={monthsValue}
                    onChange={(e) => setMonthsValue(liveFormatNumber(e.target.value))}
                    className={`${inputClass} ${monthsValue === '' ? '!border-brand-amber' : ''}`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Days</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={daysValue}
                    onChange={(e) => setDaysValue(liveFormatNumber(e.target.value))}
                    className={`${inputClass} ${daysValue === '' ? '!border-brand-amber' : ''}`}
                  />
                </div>
              </>
            ) : (
              <div>
                <label className={labelClass}>Age</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={ageValue}
                  onChange={(e) => setAgeValue(liveFormatNumber(e.target.value))}
                  className={`${inputClass} ${ageValue === '' ? '!border-brand-amber' : ''}`}
                  placeholder="0"
                />
              </div>
            )}
            <div className={ageUnit === 'Months + Days' ? 'col-span-2' : ''}>
              <label className={labelClass}>Unit</label>
              <select
                value={ageUnit}
                onChange={(e) => setAgeUnit(e.target.value)}
                className={inputClass}
              >
                {AGE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Condition</label>
            <div className="mt-1 grid grid-cols-5 gap-2">
              {CONDITION_FLAGS.map((flag) => {
                const active = condition === flag
                return (
                  <button
                    key={flag}
                    type="button"
                    onClick={() => setCondition(flag)}
                    className={`rounded-lg border py-2.5 text-xs font-medium transition-all active:scale-95 ${
                      active
                        ? 'border-brand-neon bg-brand-neon/10 text-brand-neon'
                        : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-600'
                    }`}
                  >
                    {flag}
                  </button>
                )
              })}
            </div>
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

          {isProcurement && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-app-text">Farmers Organization</span>
                <button
                  type="button"
                  onClick={() => setFarmerOrgEnabled((v) => !v)}
                  aria-pressed={farmerOrgEnabled}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    farmerOrgEnabled ? 'bg-brand-neon' : 'bg-neutral-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-neutral-950 shadow transition-transform ${
                      farmerOrgEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Switch this on only if the procurement is from a cooperative
                rather than the individual named above.
              </p>

              {farmerOrgEnabled && (
                <div className="mt-3 space-y-3">
                  {members.map((m, i) => (
                    <div key={i} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-neutral-500">Member {i + 1}</span>
                        {members.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeMember(i)}
                            aria-label="Remove member"
                            className={removeButtonClass}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          value={m.name}
                          onChange={(e) => updateMember(i, 'name', e.target.value)}
                          className={inputClass}
                          placeholder="Member Full Name"
                        />
                        <input
                          type="text"
                          value={m.rsbsa}
                          onChange={(e) => updateMember(i, 'rsbsa', e.target.value)}
                          className={inputClass}
                          placeholder="RSBSA Reference Registration ID"
                        />
                        <select
                          value={m.gender}
                          onChange={(e) => updateMember(i, 'gender', e.target.value)}
                          className={inputClass}
                        >
                          {GENDERS.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={addMember} className={smallButtonClass}>
                    <span className="flex items-center gap-1">
                      <Plus size={14} /> Add member
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
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
              className="flex-1 rounded-xl bg-brand-neon py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              Update
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(true)}
              disabled={isSaving}
              className="flex-1 rounded-xl bg-brand-crimson py-3 text-sm font-semibold text-app-text transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
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

      {showNewPileDialog && currentWarehouse && (
        <NewPileDialog
          warehouseId={currentWarehouse.warehouseId}
          varieties={sortedVarieties}
          lockedCategory={activeCategory}
          onCreated={handlePileCreated}
          onClose={() => setShowNewPileDialog(false)}
        />
      )}

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
        title={`Delete ${type} ${loadedTransaction?.serialNo ?? ''}?`}
        description="This reverses its effect on the pile and any linked AI/SIA balance, and frees this serial number. This cannot be undone."
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
    </div>
  )
}

export default StockFormBase
