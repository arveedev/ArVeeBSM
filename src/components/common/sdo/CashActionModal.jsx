// Replenish / Liquidate — both write a single cashLedger row; Cash on
// Hand is never stored, it's always derived from these plus the SDO's
// own Active Purchase Receipts (see sdoCalculations.computeCashOnHand).

import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'

function CashActionModal({ mode, currentCashOnHand, onClose }) {
  const { user } = useAuth()
  const isReplenish = mode === 'replenish'
  const [amount, setAmount] = useState('')
  const [refNo, setRefNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const amountNum = parseFloat(amount) || 0
  const preview = isReplenish ? currentCashOnHand + amountNum : currentCashOnHand - amountNum
  const canSave = amountNum > 0 && refNo.trim() && date && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await db.cashLedger.add({
        id: crypto.randomUUID(),
        sdoUid: user.uid,
        type: isReplenish ? 'replenish' : 'liquidate',
        amount: amountNum,
        refNo: refNo.trim(),
        date,
        createdAt: Date.now(),
      })
      toast.success(isReplenish ? 'Replenishment saved' : 'Liquidation saved')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl border border-neutral-800 bg-neutral-950 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">{isReplenish ? 'Replenish Cash' : 'Liquidate Cash'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div>
            <label className="text-[10px] font-semibold uppercase text-neutral-500">Amount</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-base text-app-text outline-none focus:border-brand-neon" placeholder="0.00" />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase text-neutral-500">{isReplenish ? 'Check No.' : 'OR No.'}</label>
            <input type="text" value={refNo} onChange={(e) => setRefNo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon" />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase text-neutral-500">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon" />
          </div>
          <div className={`rounded-xl border p-3 text-sm ${isReplenish ? 'border-brand-neon/40 bg-brand-neon/5' : 'border-brand-amber/40 bg-brand-amber/5'}`}>
            New Cash on Hand will be{' '}
            <span className="font-bold text-app-text">₱{preview.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <button type="button" onClick={handleSave} disabled={!canSave}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none">
            {isReplenish ? 'Save Replenishment' : 'Save Liquidation'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CashActionModal
