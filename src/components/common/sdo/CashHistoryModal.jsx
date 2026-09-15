// Cash History — lists every Replenish/Liquidate entry this SDO has
// ever saved, newest first within a chosen year, with per-entry Edit
// and Void actions for correcting a mistake (wrong amount, wrong OR/
// check no., wrong date). There was no way to see or fix a cash ledger
// entry anywhere in the app before this - Purchase Receipts already had
// a Cancel flow, the cash ledger had nothing.
//
// Editing changes the row in place (amount/refNo/date) - unlike a PR,
// where Cancel + re-issue is the correction path, a ledger entry has no
// downstream document referencing it, so a direct edit is safe and
// simpler. Voiding, separately, never deletes the row - it flips
// `voided: true` so the mistake and its correction both stay on record,
// and computeCashOnHand simply skips voided entries when summing.
//
// Year filter: entries are grouped by the year of their own `date`
// (not the browser's current year), and the selector only ever offers
// years that actually have at least one entry - no empty "2029" sitting
// in the list just because it's a future year. Pagination (Load more,
// LIST_PAGE_SIZE at a time) applies within whichever year is selected.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, Pencil } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'

const LIST_PAGE_SIZE = 50

function EditEntryForm({ entry, onSave, onCancel }) {
  const [amount, setAmount] = useState(() => liveFormatNumber(String(entry.amount ?? ''), 2))
  const [refNo, setRefNo] = useState(entry.refNo === 'Opening balance' ? '' : (entry.refNo ?? ''))
  const [date, setDate] = useState(entry.date)
  const [saving, setSaving] = useState(false)

  const amountNum = parseFormattedNumber(amount)
  const isOpeningBalance = entry.refNo === 'Opening balance'
  const canSave = amountNum > 0 && date && (isOpeningBalance || refNo.trim()) && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onSave({ amount: amountNum, refNo: isOpeningBalance ? 'Opening balance' : refNo.trim(), date })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-brand-neon/40 bg-neutral-950 p-2.5" onClick={(e) => e.stopPropagation()}>
      <div>
        <label className="text-[10px] font-semibold uppercase text-neutral-500">Amount</label>
        <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(liveFormatNumber(e.target.value, 2))}
          className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon" />
      </div>
      {!isOpeningBalance && (
        <div>
          <label className="text-[10px] font-semibold uppercase text-neutral-500">{entry.type === 'replenish' ? 'Check No.' : 'OR No.'}</label>
          <input type="text" value={refNo} onChange={(e) => setRefNo(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon" />
        </div>
      )}
      <div>
        <label className="text-[10px] font-semibold uppercase text-neutral-500">Date</label>
        <div className="mt-1"><CalendarDatePicker value={date} onChange={setDate} /></div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 py-2 text-xs font-semibold text-neutral-300 transition-all active:scale-95">
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={!canSave} className="flex-1 rounded-lg bg-brand-neon py-2 text-xs font-bold text-brand-contrast transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none">
          Save
        </button>
      </div>
    </div>
  )
}

function CashHistoryModal({ onClose }) {
  const { user } = useAuth()
  const [voidTargetId, setVoidTargetId] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()))
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const entries = useLiveQuery(
    () => user ? db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray() : [],
    [user?.uid]
  ) ?? []

  const availableYears = useMemo(
    () => [...new Set(entries.map((e) => (e.date ?? '').slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [entries]
  )

  // If the year this modal opened with (today's year) turns out to have
  // no entries, fall back to the most recent year that does, rather
  // than showing an empty list the SDO has to manually work around.
  useEffect(() => {
    if (availableYears.length === 0) return
    if (!availableYears.includes(selectedYear)) setSelectedYear(availableYears[0])
  }, [availableYears])

  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE)
  }, [selectedYear])

  const sorted = [...entries]
    .filter((e) => (e.date ?? '').slice(0, 4) === selectedYear)
    .sort((a, b) => (b.date === a.date ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : b.date < a.date ? -1 : 1))
  const visible = sorted.slice(0, visibleCount)

  const voidTarget = entries.find((e) => e.id === voidTargetId) ?? null

  const handleVoid = async () => {
    if (!voidTarget) return
    if (!voidReason.trim()) {
      toast.error('A reason is required')
      return
    }
    await db.cashLedgerV2.update(voidTarget.id, {
      voided: true,
      voidReason: voidReason.trim(),
      voidedAt: Date.now(),
      voidedByUid: user.uid,
    })
    toast.success('Entry voided — Cash on Hand updated')
    setVoidTargetId(null)
    setVoidReason('')
  }

  const handleSaveEdit = async (id, changes) => {
    await db.cashLedgerV2.update(id, {
      ...changes,
      editedAt: Date.now(),
      editedByUid: user.uid,
    })
    toast.success('Entry updated')
    setEditingId(null)
  }

  // Portaled to document.body - see PurchaseReceiptModal.jsx's own comment.
  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Cash History</h2>
          <div className="flex items-center gap-2">
            {availableYears.length > 0 && (
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                aria-label="Filter by year"
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs font-semibold text-app-text outline-none focus:border-brand-neon"
              >
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {sorted.length === 0 && <p className="py-6 text-center text-xs text-neutral-500">No cash entries {availableYears.length > 0 ? `for ${selectedYear}` : 'yet'}.</p>}
          {visible.map((e) => {
            const isReplenish = e.type === 'replenish'
            const isEditing = editingId === e.id
            return (
              <div key={e.id} className={`rounded-xl border p-3 text-sm ${e.voided ? 'border-neutral-900 bg-neutral-900/40 opacity-60' : 'border-neutral-800 bg-neutral-900'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold uppercase ${isReplenish ? 'text-brand-neon' : 'text-brand-amber'}`}>
                    {isReplenish ? 'Replenish' : 'Liquidate'}
                  </span>
                  <span className={`font-bold tabular-nums ${e.voided ? 'text-neutral-500 line-through' : 'text-app-text'}`}>
                    {isReplenish ? '+' : '−'}₱{(e.amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">{e.date} · {e.refNo || '—'}{e.editedAt ? ' · edited' : ''}</p>
                {e.voided ? (
                  <p className="mt-1.5 rounded-lg bg-neutral-950 px-2 py-1 text-xs text-neutral-500">Voided — {e.voidReason}</p>
                ) : isEditing ? (
                  <EditEntryForm entry={e} onCancel={() => setEditingId(null)} onSave={(changes) => handleSaveEdit(e.id, changes)} />
                ) : (
                  <div className="mt-1.5 flex gap-3">
                    <button type="button" onClick={() => setEditingId(e.id)} className="flex items-center gap-1 text-xs font-semibold text-neutral-400 underline">
                      <Pencil size={12} /> Edit
                    </button>
                    <button type="button" onClick={() => setVoidTargetId(e.id)} className="text-xs font-semibold text-brand-crimson underline">
                      Void this entry
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {sorted.length > visible.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((v) => v + LIST_PAGE_SIZE)}
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900 py-2.5 text-xs font-semibold text-neutral-400 transition-all hover:border-brand-neon/50 hover:text-app-text active:scale-[0.99]"
            >
              Load more ({sorted.length - visible.length} more)
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Void this entry?"
        description={voidTarget ? `Removes ₱${(voidTarget.amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} from your Cash on Hand calculation. The entry stays on record, marked voided, with your reason attached.` : ''}
        confirmLabel="Void Entry"
        cancelLabel="Back"
        onConfirm={handleVoid}
        onCancel={() => { setVoidTargetId(null); setVoidReason('') }}
      >
        <textarea
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          placeholder="Reason (required)"
          rows={2}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon"
        />
      </ConfirmDialog>
    </div>,
    document.body
  )
}

export default CashHistoryModal
