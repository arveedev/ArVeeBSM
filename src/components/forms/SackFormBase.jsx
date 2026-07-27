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
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { db } from '../../db/dexie.js'
import {
  suggestNextSerial,
  isSerialTaken,
  stepSerial,
  findTransactionBySerial,
} from '../../utils/serialNumber.js'
import { rememberCustomer } from '../../utils/customerDirectory.js'
import { queueTransactionDeletion } from '../../services/syncWorker.js'
import { liveFormatNumber, parseFormattedNumber, fmtBags, todayLocalISO } from '../../utils/calculations.js'
import CustomerNameAutocomplete from './CustomerNameAutocomplete.jsx'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
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
const emptySackLine = () => ({ sackTypeId: '', condition: '', pieces: '' })

const SackFormBase = forwardRef(function SackFormBase(
  { type, title, linkedDocLabel, onClose, prefill },
  ref
) {
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}

  const [serialNo, setSerialNo] = useState('')
  const [date, setDate] = useState(todayLocalISO())
  const [linkedDocNo, setLinkedDocNo] = useState('')
  const [showAuthorityPicker, setShowAuthorityPicker] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [transactionTypeId, setTransactionTypeId] = useState('')
  const [sackLines, setSackLines] = useState([emptySackLine()])
  const [unresolvedSiaHint, setUnresolvedSiaHint] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showSaveHint, setShowSaveHint] = useState(false)

  const [loadedTransaction, setLoadedTransaction] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(false)

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

  useImperativeHandle(ref, () => ({
    focus: () => customerNameRef.current?.focus(),
  }))

  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), [])
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), [])

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
  for (const rec of sackInventory) addAvailable(rec.sackTypeId, rec.condition, rec.pieces ?? 0)
  for (const t of allSackTx) {
    if (loadedTransaction && t.id === loadedTransaction.id) continue
    const sign = t.type === 'ESR' ? 1 : -1
    for (const line of t.sackLines ?? []) {
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

  useEffect(() => {
    if (!prefill) return
    if (prefill.customerName) setCustomerName(prefill.customerName)
    if (prefill.linkedDocNo) setLinkedDocNo(prefill.linkedDocNo)
    if (prefill.serialNo) {
      setSerialNo(prefill.serialNo)
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
    if (customer.address) setCustomerAddress(customer.address)
  }

  const handleSelectAuthority = (authority) => {
    setLinkedDocNo(authority.siaNumber ?? '')
    setLinkedAuthorityDate(authority.date ?? null)
    setCustomerName(authority.customerName ?? '')
    if (authority.transactionTypeName) {
      const match = (transactionTypes ?? []).find((t) => t.name === authority.transactionTypeName)
      if (match) setTransactionTypeId(match.transactionTypeId)
    }

    const remainingLines = (authority.sackLines ?? [])
      .map((l) => ({
        sackTypeId: l.sackTypeId,
        condition: l.condition,
        pieces: Math.max(0, (l.totalAllocationBags ?? 0) - (l.totalIssuedBags ?? 0)),
      }))
      .filter((l) => l.pieces > 0)

    if (remainingLines.length > 0) {
      setSackLines(remainingLines.map((l) => ({
        sackTypeId: l.sackTypeId,
        condition: l.condition,
        pieces: liveFormatNumber(String(l.pieces)),
      })))
    }

    setShowAuthorityPicker(false)
  }

  const scrollToCustomerName = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    customerNameRef.current?.focus()
  }

  const loadTransactionIntoForm = (tx) => {
    setLoadedTransaction(tx)
    setDate(tx.date ?? todayLocalISO())
    setLinkedDocNo(tx.linkedDocNo ?? tx.siaNumber ?? '')
    setCustomerName(tx.customerName ?? '')
    setCustomerAddress(tx.customerAddress ?? '')
    setTransactionTypeId(tx.transactionTypeId ?? '')
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
    setSerialNo(nextSerial)
    setDate(todayLocalISO())
    setLinkedDocNo('')
    setCustomerName('')
    setCustomerAddress('')
    setSackLines([emptySackLine()])
  }

  const checkAndLoadSerial = async (serial) => {
    if (!currentWarehouseId) return false
    const existing = await findTransactionBySerial(type, currentWarehouseId, serial)
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
    customerName: customerName.trim(),
    customerAddress: customerAddress.trim() || null,
    transactionTypeId: transactionTypeId || null,
    sackLines: sackLines
      .filter((l) => l.sackTypeId && l.condition && l.pieces !== '')
      .map((l) => ({ sackTypeId: l.sackTypeId, condition: l.condition, pieces: parseFormattedNumber(l.pieces) })),
    linkedDocNo: linkedDocNo.trim() || null,
    siaNumber: type === 'ESI' ? linkedDocNo.trim() || null : null,
    aiNumber: null,
    isSynced: false,
    ...overrides,
  })

  const validateForm = async ({ excludeId = null } = {}) => {
    if (!currentWarehouseId) { toast.error('No warehouse selected'); return false }
    if (!serialNo.trim()) { toast.error('Serial No. is required'); return false }
    if (await isSerialTaken(type, currentWarehouseId, serialNo.trim(), excludeId)) {
      toast.error(`Serial ${serialNo.trim()} is already used for a ${type} document at this warehouse`)
      return false
    }
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
          toast.error(`Cannot issue ${fmtBags(requested)} ${code} (${line.condition}) - only ${fmtBags(available)} available`)
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

  const handleSave = async () => {
    const ok = await validateForm()
    if (!ok) return

    setIsSaving(true)

    const transaction = { id: crypto.randomUUID(), ...buildTransactionPayload() }
    await db.transactions.add(transaction)
    await rememberCustomer({
      name: customerName.trim(),
      address: customerAddress.trim() || null,
      warehouseId: currentWarehouseId,
    })

    if (type === 'ESI' && linkedDocNo.trim()) {
      await adjustSiaBalance(linkedDocNo.trim(), buildLineDeltas(sackLines, 1))
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
  }

  const handleDeleteConfirmed = async () => {
    setPendingDelete(false)
    setIsSaving(true)

    if (loadedTransaction.siaNumber) {
      await adjustSiaBalance(loadedTransaction.siaNumber, buildLineDeltas(loadedTransaction.sackLines, -1))
    }

    await db.transactions.delete(loadedTransaction.id)
    queueTransactionDeletion(loadedTransaction.serialNo, loadedTransaction.type, currentWarehouse?.code) // fire-and-forget - local delete is already done, don't make the UI wait on the network
    toast.success(`${type} ${serialNo.trim()} deleted`)

    const freedSerial = serialNo.trim()
    resetToBlankEntry(freedSerial)
    setIsSaving(false)
  }

  const isEditMode = Boolean(loadedTransaction)

  // Gates the Save button - mirrors validateForm's synchronous checks
  // (serial-uniqueness and the ESI over-issuance check are both
  // save-time-only safety nets, not part of this live gate).
  const canSave = Boolean(currentWarehouseId)
    && Boolean(serialNo.trim())
    && Boolean(customerName.trim())
    && sackLines.some((l) => l.sackTypeId && l.condition && l.pieces !== '')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
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

        {sortedWarehouses.length > 1 ? (
          <div className="mt-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-neon">Warehouse</label>
            <select
              value={currentWarehouseId ?? ''}
              onChange={(e) => {
                setCurrentWarehouseId(e.target.value)
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
                        {availableConditions.map((c) => (
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
                    {type === 'ESI' && line.sackTypeId && line.condition && (
                      <p className="mt-1 text-xs text-neutral-500">
                        Available: {fmtBags(getAvailablePieces(line.sackTypeId, line.condition))} pcs
                      </p>
                    )}
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

      <ConfirmDialog
        open={pendingDelete}
        title={`Delete ${type} ${loadedTransaction?.serialNo ?? ''}?`}
        description="This reverses any linked SIA balance and frees this serial number. This cannot be undone."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(false)}
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
