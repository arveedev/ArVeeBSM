// Replenish / Liquidate — both write a single cashLedger row; Cash on
// Hand is never stored, it's always derived from these plus the SDO's
// own Active Purchase Receipts (see sdoCalculations.computeCashOnHand).
//
// Replenish doubles as how an SDO's very first Cash on Hand gets set -
// there's no separate "opening balance" field anywhere, since Cash on
// Hand is always a derived sum, never a stored starting number. The
// "This is an opening balance" toggle just skips requiring a real check
// number for that first entry, since an opening float often isn't tied
// to an actual check the way a later replenishment is.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'

function CashActionModal({ mode, currentCashOnHand, onClose }) {
  const { user } = useAuth()
  const isReplenish = mode === 'replenish'
  const [amount, setAmount] = useState('')
  const [refNo, setRefNo] = useState('')
  const [isOpeningBalance, setIsOpeningBalance] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const amountNum = parseFormattedNumber(amount)
  const preview = isReplenish ? currentCashOnHand + amountNum : currentCashOnHand - amountNum
  const canSave = amountNum > 0 && (isOpeningBalance || refNo.trim()) && date && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await db.cashLedgerV2.add({
        id: crypto.randomUUID(),
        sdoUid: user.uid,
        type: isReplenish ? 'replenish' : 'liquidate',
        amount: amountNum,
        refNo: isOpeningBalance ? 'Opening balance' : refNo.trim(),
        date,
        createdAt: Date.now(),
      })
      toast.success(isReplenish ? 'Replenishment saved' : 'Liquidation saved')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // Portaled to document.body - see PurchaseReceiptModal.jsx's own
  // comment (same reasoning as ConfirmDialog.jsx) for why: without
  // this, `fixed` gets constrained to App.jsx's transformed page
  // wrapper instead of the real viewport.
  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">{isReplenish ? 'Replenish Cash' : 'Liquidate Cash'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400 transition-all active:scale-90"><X size={18} /></button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div>
            <label className="text-[10px] font-semibold uppercase text-neutral-500">Amount</label>
            <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(liveFormatNumber(e.target.value, 2))}
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-base text-app-text outline-none transition-colors focus:border-brand-neon" placeholder="0.00" />
          </div>
          {isReplenish && (
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={isOpeningBalance} onChange={(e) => setIsOpeningBalance(e.target.checked)} className="accent-brand-neon" />
              This is an opening balance (no check no.)
            </label>
          )}
          {!isOpeningBalance && (
            <div>
              <label className="text-[10px] font-semibold uppercase text-neutral-500">{isReplenish ? 'Check No.' : 'OR No.'}</label>
              <input type="text" value={refNo} onChange={(e) => setRefNo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-app-text outline-none transition-colors focus:border-brand-neon" />
            </div>
          )}
          <div>
            <label className="text-[10px] font-semibold uppercase text-neutral-500">Date</label>
            <div className="mt-1">
              <CalendarDatePicker value={date} onChange={setDate} />
            </div>
          </div>
          <div className={`rounded-xl border p-3 text-sm transition-colors ${isReplenish ? 'border-brand-neon/40 bg-brand-neon/5' : 'border-brand-amber/40 bg-brand-amber/5'}`}>
            New Cash on Hand will be{' '}
            <span className="font-bold text-app-text">₱{preview.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <button type="button" onClick={handleSave} disabled={!canSave}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none">
            {isReplenish ? 'Save Replenishment' : 'Save Liquidation'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CashActionModal
