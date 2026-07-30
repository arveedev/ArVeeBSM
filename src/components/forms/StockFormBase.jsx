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
} from '../../utils/serialNumber.js'
import { applyTransactionToPile, reverseTransactionFromPile } from '../../utils/pileLedger.js'
import { rememberCustomer } from '../../utils/customerDirectory.js'
import { queueTransactionDeletion } from '../../services/syncWorker.js'
import SerialNumberField from './SerialNumberField.jsx'
import ValidatedField from './ValidatedField.jsx'
import CustomerNameAutocomplete from './CustomerNameAutocomplete.jsx'
import NewPileDialog from './NewPileDialog.jsx'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
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
  const [members, setMembers] = useState([emptyMember()])
  const [showNewPileDialog, setShowNewPileDialog] = useState(false)
  const [pileFilterVarietyId, setPileFilterVarietyId] = useState(null)

  // Series navigation / edit-mode state. `loadedTransaction` is non-null
  // when the current serial already has Active data for this (type,
  // warehouse) — the form becomes a review/edit of that document.
  const [loadedTransaction, setLoadedTransaction] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const [pendingVoidAction, setPendingVoidAction] = useState(null) // 'void' | 'unvoid' | null
  const [navFlash, setNavFlash] = useState(null)
  const [showSaveHint, setShowSaveHint] = useState(false)

  // Live lookup of the linked AI authority, so its remaining balance can
  // be shown to the user while filling out an issuance - only relevant
  // for WSI, where linkedDocNo is genuinely an AI reference (WSR's
  // linkedDocNo means something else entirely, a linked WSI).
  const linkedAuthority = useLiveQuery(async () => {
    if (!linkedDocDeductsFromAi || !linkedDocNo.trim()) return null
    return db.authorities.where('aiNumber').equals(linkedDocNo.trim()).and((a) => a.type === 'AI').first()
  }, [linkedDocDeductsFromAi, linkedDocNo])

  const authorityRemainingKilos = linkedAuthority?.totalAllocationKilos != null
    ? Math.max(0, linkedAuthority.totalAllocationKilos - (linkedAuthority.totalIssuedKilos ?? 0))
    : null
  const authorityRemainingBags = linkedAuthority?.totalAllocationBags != null
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

  const sortedVarieties = [...(varieties ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const sortedTransactionTypes = [...(transactionTypes ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const sortedPiles = [...(piles ?? [])]
    .filter((p) => !pileFilterVarietyId || p.varietyId === pileFilterVarietyId)
    .sort((a, b) => byAlpha(a.pileName, b.pileName))

  const selectedPile = (piles ?? []).find((p) => p.pileId === pileId)
  const selectedVariety = sortedVarieties.find((v) => v.varietyId === varietyId)
  const selectedTransactionType = sortedTransactionTypes.find(
    (t) => t.transactionTypeId === transactionTypeId
  )
  const isProcurement = selectedTransactionType?.name === PROCUREMENT_TYPE_NAME

  useEffect(() => {
    if (!isProcurement && farmerOrgEnabled) {
      setFarmerOrgEnabled(false)
      setMembers([emptyMember()])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcurement])

  const sackOptions = [...(sackTypes ?? [])]
    .filter((s) => !selectedVariety || s.category === selectedVariety.category)
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
    suggestNextSerial(type, currentWarehouseId).then((serial) => {
      if (!cancelled) setSerialNo(serial)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currentWarehouseId])

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
    if (pile?.varietyId) {
      setVarietyId(pile.varietyId)
      setSackSelection('')
    }
    applyPileDefaults(value)
  }

  const handlePileCreated = (pile) => {
    setPileId(pile.pileId)
    setVarietyId(pile.varietyId)
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
      setVarietyId(authority.varietyId)
      setPileFilterVarietyId(authority.varietyId)
    }
    if (authority.transactionTypeName) {
      const match = (transactionTypes ?? []).find((t) => t.name === authority.transactionTypeName)
      if (match) setTransactionTypeId(match.transactionTypeId)
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
    setIsCancelled(tx.status === 'Cancelled')
    setDate(tx.date ?? blankFormState.date)
    setLinkedDocNo(tx.linkedDocNo ?? tx.aiNumber ?? '')
    setCustomerName(tx.customerName ?? '')
    setCustomerAddress(tx.customerAddress ?? '')
    setFarmerRsbsa(tx.farmerRsbsa ?? '')
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
  }

  // Checks whether a given serial has existing data for this (type,
  // warehouse) and, if so, loads it. Returns true if it loaded something.
  const checkAndLoadSerial = async (serial) => {
    if (!currentWarehouseId) return false
    const existing = await findTransactionBySerial(type, currentWarehouseId, serial)
    if (existing) {
      loadTransactionIntoForm(existing)
      return true
    }
    if (loadedTransaction) {
      // Stepped/typed away from the loaded entry onto a blank serial —
      // return to normal new-entry mode.
      setLoadedTransaction(null)
    }
    return false
  }

  const handleSerialChange = async (value) => {
    setSerialNo(value)
    await checkAndLoadSerial(value)
  }

  const handleStepBack = async () => {
    const prevSerial = stepSerial(serialNo.trim(), -1)
    setSerialNo(prevSerial)
    setNavFlash('back')
    setTimeout(() => setNavFlash(null), 250)
    await checkAndLoadSerial(prevSerial)
  }

  const handleStepForward = async () => {
    const nextSerial = stepSerial(serialNo.trim(), 1)
    setSerialNo(nextSerial)
    setNavFlash('forward')
    setTimeout(() => setNavFlash(null), 250)
    const loaded = await checkAndLoadSerial(nextSerial)
    if (!loaded) resetToBlankEntry(nextSerial)
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
    if (await isSerialTaken(type, currentWarehouseId, serialNo.trim(), excludeId)) {
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
        `Net Kilos (${fmtWeight(netKilos, weightUnit)}) exceeds available stock (${fmtWeight(availableKilos, weightUnit)}) on this pile`
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

  const handleSave = async () => {
    if (overBags && !overKilos) {
      // Bags-over is a soft warning the user already saw inline — allow
      // it through, since some transaction types legitimately exceed the
      // bag count (net kilos is the hard limit, per clarification).
    }

    const ok = await validateForm()
    if (!ok) return

    setIsSaving(true)

    const transaction = { id: crypto.randomUUID(), ...buildTransactionPayload() }

    await db.transactions.add(transaction)
    await recordSerialUsed(type, currentWarehouseId, serialNo.trim())
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

    toast.success(`${type} saved — ${serialNo.trim()}`)

    const next = stepSerial(serialNo.trim(), 1)
    resetToBlankEntry(next)
    setIsSaving(false)
    scrollToCustomerName()
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
    await recordSerialUsed(type, currentWarehouseId, serialNo.trim())
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
    queueTransactionDeletion(loadedTransaction.serialNo, loadedTransaction.type, currentWarehouse?.code)
    toast.success(`${type} ${serialNo.trim()} is no longer cancelled — available again`)
    const freedSerial = serialNo.trim()
    resetToBlankEntry(freedSerial)
    setIsSaving(false)
  }

  const isEditMode = Boolean(loadedTransaction)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-app-text">{title}</h1>
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

        {!isSerialFieldVisible && serialNo && (
          <p className="mt-2 rounded-xl border-2 border-brand-neon bg-brand-neon/10 px-3 py-2.5 text-center font-mono text-lg font-bold text-brand-neon shadow-[0_0_16px_-4px_rgba(0,255,163,0.4)]">
            {type} # {serialNo}
          </p>
        )}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="space-y-3">
          {isEditMode && (
            <div className="rounded-xl border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
              Reviewing existing {type} {loadedTransaction.serialNo} — Update or Delete below.
            </div>
          )}

          <div ref={serialFieldRef}>
            <label className={labelClass}>Serial No.</label>
            <div className={`mt-1 flex items-center gap-2 ${navFlash === 'back' ? 'animate-nav-back' : navFlash === 'forward' ? 'animate-nav-forward' : ''}`}>
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
                className={`mt-0 w-full rounded-xl border bg-neutral-950 px-3 py-2 text-center font-mono text-app-text outline-none transition-colors focus:border-brand-neon ${!serialNo.trim() ? '!border-brand-amber' : 'border-neutral-800'}`}
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
              Type a serial directly to jump to it — existing data loads automatically.
            </p>
          </div>

          <div className={`space-y-3 rounded-xl transition-opacity ${isCancelled ? 'border-2 border-brand-crimson p-2 opacity-40' : ''}`}>
          <div>
            <label className={labelClass}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className={`${inputClass} cursor-pointer`}
            />
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
              {selectedPile ? (
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

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-900 p-4 pb-6">
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
          onCreated={handlePileCreated}
          onClose={() => setShowNewPileDialog(false)}
        />
      )}

      {showAuthorityPicker && currentWarehouseId && (
        <AuthorityPickerModal
          type="AI"
          warehouseId={currentWarehouseId}
          filterVarietyId={varietyId || null}
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
    </div>
  )
}

export default StockFormBase
