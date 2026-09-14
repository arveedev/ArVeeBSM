// Denomination count — a physical reconciliation snapshot, not a ledger
// entry. Never changes Cash on Hand; only checks the SDO's actual
// counted cash against what the ledger already computes.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01]

function DenominationModal({ currentCashOnHand, onClose }) {
  const { user } = useAuth()
  const saved = useLiveQuery(() => user ? db.cashDenominationCounts.get(user.uid) : null, [user?.uid])
  const [counts, setCounts] = useState({})
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (saved?.counts) setCounts(saved.counts)
  }, [saved])

  const setCount = (d, v) => setCounts((c) => ({ ...c, [d]: v === '' ? '' : Number(v) }))

  const total = DENOMINATIONS.reduce((s, d) => s + (Number(counts[d]) || 0) * d, 0)
  const diff = total - currentCashOnHand

  const handleSave = async () => {
    await db.cashDenominationCounts.put({
      sdoUid: user.uid,
      counts,
      countedTotal: total,
      updatedAt: new Date().toISOString(),
    })
    toast.success('Denomination count saved')
    onClose()
  }

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-end justify-center bg-black/60 transition-opacity duration-200 sm:items-center ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-950 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] sm:rounded-2xl"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Denomination Count</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>
        <div className="space-y-2 px-4 py-4">
          {DENOMINATIONS.map((d) => (
            <div key={d} className="grid grid-cols-[1fr_80px_1fr] items-center gap-2 border-b border-neutral-900 pb-2 text-sm">
              <span className="font-semibold text-app-text">₱{d}</span>
              <input
                type="number"
                min="0"
                value={counts[d] ?? ''}
                onChange={(e) => setCount(d, e.target.value)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-center text-app-text outline-none focus:border-brand-neon"
              />
              <span className="text-right text-neutral-400">₱{((Number(counts[d]) || 0) * d).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          ))}
          <div className="flex justify-between pt-1 text-sm font-semibold text-app-text">
            <span>Counted total</span><span>₱{total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between border-t border-neutral-800 pt-2 text-sm font-bold text-brand-neon">
            <span>System Cash on Hand</span><span>₱{currentCashOnHand.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {Math.abs(diff) > 0.001 && (
            <p className="rounded-lg bg-neutral-900 px-2.5 py-2 text-xs text-neutral-400">
              Off by ₱{Math.abs(diff).toFixed(2)} ({diff > 0 ? 'counted is higher' : 'counted is lower'}) — recheck before saving.
            </p>
          )}
          <button type="button" onClick={handleSave}
            className="mt-2 w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95">
            Save Count
          </button>
        </div>
      </div>
    </div>
  )
}

export default DenominationModal
