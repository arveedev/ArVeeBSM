// Cash History — lists every Replenish/Liquidate entry this SDO has
// ever saved, newest first, with a Void action for correcting a mistake
// (wrong amount, wrong OR/check no., duplicate entry). There was no way
// to see or fix a cash ledger entry anywhere in the app before this -
// Purchase Receipts already had a Cancel flow, the cash ledger had
// nothing.
//
// Voiding never deletes the row - it flips `voided: true` so the
// mistake and its correction both stay on record (matches how a PR
// Cancel keeps the original row, just with a reason attached), and
// computeCashOnHand simply skips voided entries when summing.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'

function CashHistoryModal({ onClose }) {
  const { user } = useAuth()
  const [voidTargetId, setVoidTargetId] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const entries = useLiveQuery(
    () => user ? db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray() : [],
    [user?.uid]
  ) ?? []
  const sorted = [...entries].sort((a, b) => (b.date === a.date ? b.createdAt - a.createdAt : b.date < a.date ? -1 : 1))
  const voidTarget = sorted.find((e) => e.id === voidTargetId) ?? null

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
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {sorted.length === 0 && <p className="py-6 text-center text-xs text-neutral-500">No cash entries yet.</p>}
          {sorted.map((e) => {
            const isReplenish = e.type === 'replenish'
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
                <p className="mt-1 text-xs text-neutral-500">{e.date} · {e.refNo || '—'}</p>
                {e.voided ? (
                  <p className="mt-1.5 rounded-lg bg-neutral-950 px-2 py-1 text-xs text-neutral-500">Voided — {e.voidReason}</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVoidTargetId(e.id)}
                    className="mt-1.5 text-xs font-semibold text-brand-crimson underline"
                  >
                    Void this entry
                  </button>
                )}
              </div>
            )
          })}
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
