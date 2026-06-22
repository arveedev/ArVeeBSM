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
//     If a sack code has only one condition, it auto-selects. Each line
//     shows available pieces remaining on the linked SIA (for ESI) as a
//     soft reference — sacks/pieces don't have the same hard-kilos-cap
//     concept stock docs do, since there's no kilos figure here at all.
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
import CustomerNameAutocomplete from './CustomerNameAutocomplete.jsx'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [linkedDocNo, setLinkedDocNo] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [transactionTypeId, setTransactionTypeId] = useState('')
  const [sackLines, setSackLines] = useState([emptySackLine()])
  const [unresolvedSiaHint, setUnresolvedSiaHint] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  const [loadedTransaction, setLoadedTransaction] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(false)

  const customerNameRef = useRef(null)
  const scrollContainerRef = useRef(null)

  useImperativeHandle(ref, () => ({
    focus: () => customerNameRef.current?.focus(),
  }))

  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), [])
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), [])

  const sortedSackTypes = [...(sackTypes ?? [])].sort((a, b) => byAlpha(a.code, b.code))
  const sortedTransactionTypes = [...(transactionTypes ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  useEffect(() => {
    if (loadedTransaction) return
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
    if (prefill.rawSiaAllocation) setUnresolvedSiaHint(prefill.rawSiaAllocation)

    if (prefill.sackLines?.length) {
      setSackLines(
        prefill.sackLines.map((l) => ({
          sackTypeId: l.sackTypeId,
          condition: l.condition,
          pieces: l.pieces != null ? String(l.pieces) : '',
        }))
      )
    } else if (prefill.sackTypeId && prefill.condition) {
      setSackLines([{
        sackTypeId: prefill.sackTypeId,
        condition: prefill.condition,
        pieces: prefill.pieces != null ? String(prefill.pieces) : '',
      }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

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

  const totalPieces = sackLines.reduce((sum, l) => sum + (Number(l.pieces) || 0), 0)

  const handleCustomerMatch = (customer) => {
    if (customer.address) setCustomerAddress(customer.address)
  }

  const scrollToCustomerName = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    customerNameRef.current?.focus()
  }

  const loadTransactionIntoForm = (tx) => {
    setLoadedTransaction(tx)
    setDate(tx.date ?? new Date().toISOString().slice(0, 10))
    setLinkedDocNo(tx.linkedDocNo ?? tx.siaNumber ?? '')
    setCustomerName(tx.customerName ?? '')
    setCustomerAddress(tx.customerAddress ?? '')
    setTransactionTypeId(tx.transactionTypeId ?? '')
    setSackLines(
      tx.sackLines?.length
        ? tx.sackLines.map((l) => ({
            sackTypeId: l.sackTypeId,
            condition: l.condition,
            pieces: String(l.pieces),
          }))
        : [emptySackLine()]
    )
  }

  const resetToBlankEntry = (nextSerial) => {
    setLoadedTransaction(null)
    setSerialNo(nextSerial)
    setDate(new Date().toISOString().slice(0, 10))
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
      .map((l) => ({ sackTypeId: l.sackTypeId, condition: l.condition, pieces: Number(l.pieces) })),
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
    return true
  }

  const adjustSiaBalance = async (siaNo, piecesDelta) => {
    if (type !== 'ESI' || !siaNo) return
    const authority = await db.authorities.where('siaNumber').equals(siaNo).first()
    if (!authority || authority.totalAllocationBags == null) return
    await db.authorities.update(authority.authId, {
      totalIssuedBags: (authority.totalIssuedBags ?? 0) + piecesDelta,
    })
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
    })

    if (type === 'ESI' && linkedDocNo.trim()) {
      await adjustSiaBalance(linkedDocNo.trim(), totalPieces)
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

    const oldPieces = loadedTransaction.sackLines?.reduce((sum, l) => sum + (l.pieces ?? 0), 0) ?? 0
    if (loadedTransaction.siaNumber) {
      await adjustSiaBalance(loadedTransaction.siaNumber, -oldPieces)
    }

    const updated = buildTransactionPayload({ id: loadedTransaction.id })
    await db.transactions.update(loadedTransaction.id, updated)
    await rememberCustomer({
      name: customerName.trim(),
      address: customerAddress.trim() || null,
    })

    if (type === 'ESI' && linkedDocNo.trim()) {
      await adjustSiaBalance(linkedDocNo.trim(), totalPieces)
    }

    toast.success(`${type} ${serialNo.trim()} updated`)
    setLoadedTransaction(updated)
    setIsSaving(false)
  }

  const handleDeleteConfirmed = async () => {
    setPendingDelete(false)
    setIsSaving(true)

    const oldPieces = loadedTransaction.sackLines?.reduce((sum, l) => sum + (l.pieces ?? 0), 0) ?? 0
    if (loadedTransaction.siaNumber) {
      await adjustSiaBalance(loadedTransaction.siaNumber, -oldPieces)
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
              placeholder="0111965"
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
                        className={`${inputClass} mt-0`}
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
                        className={`${inputClass} mt-0`}
                        disabled={!line.sackTypeId}
                      >
                        <option value="">Cond…</option>
                        {availableConditions.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={line.pieces}
                        onChange={(e) => updateLine(i, 'pieces', e.target.value)}
                        className={`${inputClass} mt-0`}
                        placeholder="Pcs"
                      />
                    </div>
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
                Total pieces: {totalPieces.toLocaleString()}
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

      <ConfirmDialog
        open={pendingDelete}
        title={`Delete ${type} ${loadedTransaction?.serialNo ?? ''}?`}
        description="This reverses any linked SIA balance and frees this serial number. This cannot be undone."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  )
})

export default SackFormBase
