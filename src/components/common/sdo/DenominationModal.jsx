// Denomination count — a physical reconciliation snapshot, not a ledger
// entry. Never changes Cash on Hand; only checks the SDO's actual
// counted cash against what the ledger already computes.
//
// Each denomination counts both loose pieces AND bundles (a standard
// 100-piece bank bundle, per the reference sheet's own "7 Bundle 1000"
// style entries) - a bundle of ₱1,000 bills is worth ₱100,000, not one
// more piece, so bundles are tracked separately and multiplied by
// BUNDLE_SIZE rather than folded into the piece count.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01]
const BUNDLE_SIZE = 100

// A denomination's saved entry is either the current { bundles, pcs }
// shape, a bare number left over from before bundles existed (treated
// as loose pieces, bundles 0), or missing entirely.
const normalizeEntry = (raw) => {
  if (raw == null) return { bundles: '', pcs: '' }
  if (typeof raw === 'number') return { bundles: '', pcs: raw }
  return { bundles: raw.bundles ?? '', pcs: raw.pcs ?? '' }
}

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
    if (!saved?.counts) return
    setCounts(Object.fromEntries(DENOMINATIONS.map((d) => [d, normalizeEntry(saved.counts[d])])))
  }, [saved])

  const setField = (d, field, v) =>
    setCounts((c) => ({ ...c, [d]: { ...normalizeEntry(c[d]), [field]: v === '' ? '' : Number(v) } }))

  const rowTotal = (d) => {
    const { bundles, pcs } = normalizeEntry(counts[d])
    return ((Number(bundles) || 0) * BUNDLE_SIZE + (Number(pcs) || 0)) * d
  }

  const total = DENOMINATIONS.reduce((s, d) => s + rowTotal(d), 0)
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
          <div>
            <h2 className="text-base font-semibold text-app-text">Denomination Count</h2>
            <p className="text-xs text-neutral-500">A bundle is {BUNDLE_SIZE} pieces</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-[52px_1fr_1fr_1fr] gap-2 px-1 text-[10px] font-semibold uppercase text-neutral-500">
            <span />
            <span className="text-center">Bundles</span>
            <span className="text-center">Pcs</span>
            <span className="text-right">Subtotal</span>
          </div>
          {DENOMINATIONS.map((d) => {
            const { bundles, pcs } = normalizeEntry(counts[d])
            return (
              <div key={d} className="grid grid-cols-[52px_1fr_1fr_1fr] items-center gap-2 border-b border-neutral-900 pb-2 text-sm">
                <span className="font-semibold text-app-text">₱{d}</span>
                <input
                  type="number"
                  min="0"
                  value={bundles}
                  onChange={(e) => setField(d, 'bundles', e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-center text-app-text outline-none focus:border-brand-neon"
                />
                <input
                  type="number"
                  min="0"
                  value={pcs}
                  onChange={(e) => setField(d, 'pcs', e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-center text-app-text outline-none focus:border-brand-neon"
                />
                <span className="text-right text-neutral-400">₱{rowTotal(d).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )
          })}
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
    </div>,
    document.body
  )
}

export default DenominationModal
