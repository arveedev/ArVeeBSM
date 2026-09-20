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
import { liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01]
const BUNDLE_SIZE = 100

// A denomination's saved entry is either the current { bundles, pcs }
// shape, a bare number left over from before bundles existed (treated
// as loose pieces, bundles 0), or missing entirely. Returned bundles/
// pcs are always display strings (comma-formatted, matching what's in
// each input) - parseFormattedNumber turns them back into real numbers
// wherever the actual value is needed (rowTotal, saving).
const normalizeEntry = (raw) => {
  if (raw == null) return { bundles: '', pcs: '' }
  if (typeof raw === 'number') return { bundles: '', pcs: liveFormatNumber(String(raw), 0) }
  return {
    bundles: raw.bundles === '' || raw.bundles == null ? '' : liveFormatNumber(String(raw.bundles), 0),
    pcs: raw.pcs === '' || raw.pcs == null ? '' : liveFormatNumber(String(raw.pcs), 0),
  }
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

  const setField = (d, field, rawValue) =>
    setCounts((c) => ({ ...c, [d]: { ...normalizeEntry(c[d]), [field]: liveFormatNumber(rawValue, 0) } }))

  const rowTotal = (d) => {
    const { bundles, pcs } = normalizeEntry(counts[d])
    return (parseFormattedNumber(bundles) * BUNDLE_SIZE + parseFormattedNumber(pcs)) * d
  }

  const total = DENOMINATIONS.reduce((s, d) => s + rowTotal(d), 0)
  const diff = total - currentCashOnHand

  const handleSave = async () => {
    // Saved as plain numbers, not the comma-formatted display strings
    // the inputs hold - the stored shape stays exactly what it always
    // was, only how it's edited on screen changed.
    const cleanCounts = Object.fromEntries(
      DENOMINATIONS.map((d) => {
        const { bundles, pcs } = normalizeEntry(counts[d])
        return [d, { bundles: bundles === '' ? '' : parseFormattedNumber(bundles), pcs: pcs === '' ? '' : parseFormattedNumber(pcs) }]
      })
    )
    await db.cashDenominationCounts.put({
      sdoUid: user.uid,
      counts: cleanCounts,
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
        {/* Compact rows + sticky summary (chosen from three redesign demos) -
            the list is the ONLY scrollable region now; the totals/diff/Save
            button live in their own shrink-0 footer below it instead of
            inside the scroll, so they're always visible without scrolling
            past all 13 denominations first. Zero-subtotal rows dim instead
            of being hidden, so the grid stays a consistent shape. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
          {/* Bundles/Pcs never need more than 3 digits in practice, so those
              columns are fixed-narrow instead of flexible - the previous
              pass had the reverse (fixed-narrow subtotal, flexible inputs),
              which let a wide subtotal like ₱111,000.00 overflow the row.
              This pass hit a second, classic Grid bug: a bare <input> has a
              browser-default intrinsic minimum width (as if sized ~20
              characters) that a Grid item honors UNLESS min-width:0 is set
              on it - so even with an explicit 44px track, the input itself
              was forcing the column (and the whole row/modal) wider,
              which is what caused the overlap with the label and the
              sideways scrollbar. `min-w-0` on every grid child is the fix -
              it lets each item actually shrink to its assigned track
              width instead of demanding its own default minimum. */}
          <div className="grid grid-cols-[42px_44px_44px_minmax(0,1fr)] gap-1.5 px-1 pb-1.5 text-[10px] font-semibold uppercase text-neutral-500">
            <span className="min-w-0" />
            <span className="min-w-0 text-center">Bdl</span>
            <span className="min-w-0 text-center">Pcs</span>
            <span className="min-w-0 text-right">Subtotal</span>
          </div>
          {DENOMINATIONS.map((d) => {
            const { bundles, pcs } = normalizeEntry(counts[d])
            const isZero = rowTotal(d) === 0
            return (
              <div
                key={d}
                className={`grid grid-cols-[42px_44px_44px_minmax(0,1fr)] items-center gap-1.5 border-b border-neutral-900 py-1.5 text-sm transition-opacity ${isZero ? 'opacity-45' : ''}`}
              >
                <span className="min-w-0 whitespace-nowrap font-semibold text-app-text">₱{d}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  value={bundles}
                  onChange={(e) => setField(d, 'bundles', e.target.value)}
                  placeholder="0"
                  className="min-w-0 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-1 py-1 text-center tabular-nums text-app-text outline-none focus:border-brand-neon"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  value={pcs}
                  onChange={(e) => setField(d, 'pcs', e.target.value)}
                  placeholder="0"
                  className="min-w-0 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-1 py-1 text-center tabular-nums text-app-text outline-none focus:border-brand-neon"
                />
                <span className="min-w-0 truncate text-right tabular-nums text-neutral-400">₱{rowTotal(d).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )
          })}
        </div>

        <div className="shrink-0 space-y-1.5 border-t border-neutral-800 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5">
          <div className="flex justify-between text-sm font-semibold text-app-text">
            <span>Counted total</span><span className="tabular-nums">₱{total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-brand-neon">
            <span>System Cash on Hand</span><span className="tabular-nums">₱{currentCashOnHand.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {Math.abs(diff) > 0.001 && (
            <p className="rounded-lg bg-neutral-900 px-2.5 py-2 text-xs text-neutral-400">
              Off by ₱{Math.abs(diff).toFixed(2)} ({diff > 0 ? 'counted is higher' : 'counted is lower'}) — recheck before saving.
            </p>
          )}
          <button type="button" onClick={handleSave}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95">
            Save Count
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default DenominationModal
