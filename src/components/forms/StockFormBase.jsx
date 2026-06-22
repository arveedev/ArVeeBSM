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
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { db } from '../../db/dexie.js'
import {
  calculateNetKilos,
  calculateMtsFromSackWeight,
  calculateAverageWeightPerBag,
  normalizeAgeToDays,
} from '../../utils/calculations.js'
import {
  suggestNextSerial,
  isSerialTaken,
  stepSerial,
  findTransactionBySerial,
} from '../../utils/serialNumber.js'
import { applyTransactionToPile, reverseTransactionFromPile } from '../../utils/pileLedger.js'
import { rememberCustomer } from '../../utils/customerDirectory.js'
import SerialNumberField from './SerialNumberField.jsx'
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
} from './shared.js'

const CONDITION_FLAGS = ['GQ', 'TRD', 'INF', 'PD', 'TD']
const AGE_UNITS = ['Days', 'Months']
const GENDERS = ['Male', 'Female']
const PROCUREMENT_TYPE_NAME = 'Procurement'
const NEW_PILE_OPTION = '__new_pile__'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

const emptyMember = () => ({ name: '', rsbsa: '', gender: 'Male' })

const blankFormState = {
  date: new Date().toISOString().slice(0, 10),
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

  const linkedDocLabel = type === 'WSR' ? 'WSI No.' : 'AI No.'
  const linkedDocDeductsFromAi = type !== 'WSR'

  const [serialNo, setSerialNo] = useState('')
  const [date, setDate] = useState(blankFormState.date)
  const [linkedDocNo, setLinkedDocNo] = useState('')
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
  const [ageUnit, setAgeUnit] = useState('Days')
  const [condition, setCondition] = useState('')
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

  const customerNameRef = useRef(null)
  const scrollContainerRef = useRef(null)

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

  useEffect(() => {
    if (selectedPile?.varietyId) {
      setVarietyId(selectedPile.varietyId)
      setSackSelection('')
    }
  }, [selectedPile])

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

  const selectedSack = sackOptions.find((o) => o.key === sackSelection)

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
  // existing series entry.
  useEffect(() => {
    if (loadedTransaction) return
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

  useEffect(() => {
    if (!prefill) return
    if (prefill.aiNumber) setLinkedDocNo(prefill.aiNumber)
    if (prefill.customerName) setCustomerName(prefill.customerName)
    if (prefill.pileId) setPileId(prefill.pileId)
    if (prefill.varietyId) {
      setVarietyId(prefill.varietyId)
      if (!prefill.pileId) setPileFilterVarietyId(prefill.varietyId)
    }
    if (prefill.numberOfBags != null) setNumberOfBags(String(prefill.numberOfBags))
    if (prefill.grossKilos != null) setGrossKilos(String(prefill.grossKilos))
    if (prefill.autoComputeNet === false) setAutoComputeNet(false)
    if (prefill.netKilos != null) setManualNetKilos(String(prefill.netKilos))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const bagsNum = Number(numberOfBags) || 0
  const grossNum = Number(grossKilos) || 0
  const mts = calculateMtsFromSackWeight(selectedSack?.weight ?? 0, bagsNum)
  const computedNetKilos = calculateNetKilos(grossNum, mts)
  const netKilos = autoComputeNet ? computedNetKilos : Number(manualNetKilos) || 0
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
  }

  const handlePileCreated = (pile) => {
    setPileId(pile.pileId)
    setVarietyId(pile.varietyId)
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

  const scrollToCustomerName = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    customerNameRef.current?.focus()
  }

  // Loads an existing transaction's full data into the form for review/
  // edit, switching the footer to Update/Delete.
  const loadTransactionIntoForm = (tx) => {
    setLoadedTransaction(tx)
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
    setNumberOfBags(tx.numberOfBags != null ? String(tx.numberOfBags) : '')
    setGrossKilos(tx.grossKilos != null ? String(tx.grossKilos) : '')
    setAutoComputeNet(tx.autoComputeNet ?? true)
    setManualNetKilos(tx.autoComputeNet ? '' : String(tx.netKilos ?? ''))
    setAgeValue(tx.ageValue != null ? String(tx.ageValue) : '')
    setAgeUnit(tx.ageUnit ?? 'Days')
    setCondition(tx.condition ?? '')
    setFarmerOrgEnabled(Boolean(tx.farmerCoops?.length))
    setMembers(tx.farmerCoops?.length ? tx.farmerCoops : [emptyMember()])
  }

  const resetToBlankEntry = (nextSerial) => {
    setLoadedTransaction(null)
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
    await checkAndLoadSerial(prevSerial)
  }

  const handleStepForward = async () => {
    const nextSerial = stepSerial(serialNo.trim(), 1)
    setSerialNo(nextSerial)
    const loaded = await checkAndLoadSerial(nextSerial)
    if (!loaded) resetToBlankEntry(nextSerial)
  }

  const buildTransactionPayload = (overrides = {}) => ({
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
    mtsSackTypeId: selectedSack ? selectedSack.sackTypeId : null,
    mtsCondition: selectedSack ? selectedSack.condition : null,
    numberOfBags: numberOfBags === '' ? null : bagsNum,
    grossKilos: grossKilos === '' ? null : grossNum,
    mts,
    autoComputeNet,
    netKilos,
    ageValue: ageValue === '' ? null : Number(ageValue),
    ageUnit,
    initialAgeValue: ageValue === '' ? 0 : normalizeAgeToDays(ageValue, ageUnit),
    condition,
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
    if (overKilos) {
      toast.error(
        `Net Kilos (${netKilos.toFixed(2)}) exceeds available stock (${availableKilos.toFixed(2)} kg) on this pile`
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
    await applyTransactionToPile(transaction)
    await rememberCustomer({
      name: customerName.trim(),
      address: customerAddress.trim() || null,
      rsbsa: isProcurement ? farmerRsbsa.trim() || null : null,
      gender: isProcurement ? farmerGender || null : null,
      isFarmerOrg: farmerOrgEnabled,
      farmerCoopMembers: farmerOrgEnabled ? members.map((m) => ({ ...m })) : null,
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

    toast.success(`${type} ${serialNo.trim()} deleted`)

    const freedSerial = serialNo.trim()
    resetToBlankEntry(freedSerial)
    setIsSaving(false)
  }

  const isEditMode = Boolean(loadedTransaction)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-white">{title}</h1>
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
          <select
            value={currentWarehouseId ?? ''}
            onChange={(e) => {
              setCurrentWarehouseId(e.target.value)
              setPileId('')
              setVarietyId('')
              setSackSelection('')
              setLoadedTransaction(null)
            }}
            className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300 outline-none focus:border-brand-neon"
          >
            {sortedWarehouses.map((w) => (
              <option key={w.warehouseId} value={w.warehouseId}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        ) : currentWarehouse ? (
          <p className="mt-1 text-xs text-neutral-500">
            {currentWarehouse.code} — {currentWarehouse.name}
          </p>
        ) : null}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="space-y-3">
          {isEditMode && (
            <div className="rounded-xl border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
              Reviewing existing {type} {loadedTransaction.serialNo} — Update or Delete below.
            </div>
          )}

          <div>
            <label className={labelClass}>Serial No.</label>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleStepBack}
                aria-label="Previous serial"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 hover:text-white active:scale-90"
              >
                <ChevronLeft size={18} />
              </button>
              <input
                type="text"
                value={serialNo}
                onChange={(e) => handleSerialChange(e.target.value)}
                className="mt-0 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-center font-mono text-white outline-none transition-colors focus:border-brand-neon"
                placeholder="0000000"
              />
              <button
                type="button"
                onClick={handleStepForward}
                aria-label="Next serial"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 transition-all hover:border-neutral-600 hover:text-white active:scale-90"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Type a serial directly to jump to it — existing data loads automatically.
            </p>
          </div>

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
            <input
              type="text"
              value={linkedDocNo}
              onChange={(e) => setLinkedDocNo(e.target.value)}
              className={inputClass}
              placeholder={type === 'WSR' ? 'Optional' : '26219637'}
            />
          </div>

          <CustomerNameAutocomplete
            ref={customerNameRef}
            value={customerName}
            onChange={setCustomerName}
            onMatch={handleCustomerMatch}
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

          <div>
            <label className={labelClass}>Pile ID</label>
            <select
              value={pileId}
              onChange={(e) => handlePileChange(e.target.value)}
              className={inputClass}
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
                className={inputClass}
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

          <div>
            <label className={labelClass}>MTS — Sack Code &amp; Condition</label>
            <select
              value={sackSelection}
              onChange={(e) => setSackSelection(e.target.value)}
              className={inputClass}
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

          {selectedPile && isIssuance && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
              Available on {selectedPile.pileName}: {availableBags?.toLocaleString()} bags ·{' '}
              {availableKilos?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Number of Bags</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={numberOfBags}
                onChange={(e) => setNumberOfBags(e.target.value)}
                className={`${inputClass} ${overBags ? 'border-brand-amber' : ''}`}
                placeholder="0"
              />
              {overBags && (
                <p className="mt-1 text-xs text-brand-amber">
                  Exceeds available bags — allowed for some transaction types.
                </p>
              )}
            </div>
            <div>
              <label className={labelClass}>Gross Kilos</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={grossKilos}
                onChange={(e) => setGrossKilos(e.target.value)}
                className={inputClass}
                placeholder="0.00"
              />
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
                {netKilos.toFixed(2)}
              </div>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={manualNetKilos}
                onChange={(e) => setManualNetKilos(e.target.value)}
                className={`${inputClass} ${overKilos ? 'border-brand-crimson' : ''}`}
                placeholder="0.00"
              />
            )}
            {overKilos && (
              <p className="mt-1 text-xs text-brand-crimson">
                Cannot exceed available Net Kilos ({availableKilos.toFixed(2)} kg) — this is a hard limit.
              </p>
            )}
            {bagsNum > 0 && !overKilos && (
              <p className="mt-1 text-xs text-neutral-500">
                Average weight per bag: {avgWeightPerBag.toFixed(2)} kg
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Age</label>
              <input
                type="number"
                inputMode="decimal"
                value={ageValue}
                onChange={(e) => setAgeValue(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div>
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

          {isProcurement && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-white">Farmers Organization</span>
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
              className="flex-1 rounded-xl bg-brand-neon py-3 text-sm font-semibold text-neutral-950 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              Update
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(true)}
              disabled={isSaving}
              className="flex-1 rounded-xl bg-brand-crimson py-3 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={`w-full ${primaryButtonClass}`}
          >
            Save
          </button>
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

      <ConfirmDialog
        open={pendingDelete}
        title={`Delete ${type} ${loadedTransaction?.serialNo ?? ''}?`}
        description="This reverses its effect on the pile and any linked AI/SIA balance, and frees this serial number. This cannot be undone."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  )
}

export default StockFormBase
