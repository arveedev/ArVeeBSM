// Denomination count — a physical reconciliation snapshot, not a ledger
// entry. Never changes Cash on Hand; only checks the SDO's actual
// counted cash against what the ledger already computes.
//
// Each denomination counts both loose pieces AND bundles (a standard
// 100-piece bank bundle, per the reference sheet's own "7 Bundle 1000"
// style entries) - a bundle of ₱1,000 bills is worth ₱100,000, not one
// more piece, so bundles are tracked separately and multiplied by
// BUNDLE_SIZE rather than folded into the piece count.

import { Fragment, useEffect, useState } from 'react'
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
          {/* Fixed pixel guesses kept failing on the real device even after
              measuring against the real Inter font locally - some
              combination of device font metrics / OS text-scaling this
              session can't fully reproduce kept making a "measured-safe"
              number still too narrow. Switched to a structurally different
              fix instead of guessing a fourth number: the label column is
              now `auto` - sized by the browser to whatever the label
              actually needs on THAT device, which makes truncation
              mathematically impossible regardless of font/zoom/scaling,
              no measuring required ever again. Bdl/Pcs stay equal to each
              other (50px) since they're fixed-size input boxes, not
              variable-width text; Subtotal stays flexible.
              This requires every row to share ONE grid (not each row its
              own separate 4-column grid) so `auto` computes from the
              WIDEST label across ALL rows and every row's columns stay
              aligned - each row is a Fragment (no box of its own) whose
              four children are direct items of this single outer grid;
              the border/opacity that used to live on a row wrapper now
              applies to each of the four cells individually instead. */}
          <div className="grid grid-cols-[auto_50px_50px_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1 text-sm">
            <span className="pb-1.5 text-[10px] font-semibold uppercase text-neutral-500" />
            <span className="pb-1.5 text-center text-[10px] font-semibold uppercase text-neutral-500">Bdl</span>
            <span className="pb-1.5 text-center text-[10px] font-semibold uppercase text-neutral-500">Pcs</span>
            <span className="pb-1.5 text-right text-[10px] font-semibold uppercase text-neutral-500">Subtotal</span>
            {DENOMINATIONS.map((d) => {
              const { bundles, pcs } = normalizeEntry(counts[d])
              const isZero = rowTotal(d) === 0
              const cellClass = `border-b border-neutral-900 py-1.5 transition-opacity ${isZero ? 'opacity-45' : ''}`
              return (
                <Fragment key={d}>
                  <span className={`${cellClass} whitespace-nowrap font-semibold text-app-text`}>₱{d}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    value={bundles}
                    onChange={(e) => setField(d, 'bundles', e.target.value)}
                    placeholder="0"
                    className={`${cellClass} min-w-0 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-1 text-center tabular-nums text-app-text outline-none focus:border-brand-neon`}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    value={pcs}
                    onChange={(e) => setField(d, 'pcs', e.target.value)}
                    placeholder="0"
                    className={`${cellClass} min-w-0 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-1 text-center tabular-nums text-app-text outline-none focus:border-brand-neon`}
                  />
                  <span className={`${cellClass} text-right tabular-nums text-neutral-400`}>₱{rowTotal(d).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </Fragment>
              )
            })}
          </div>
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
