// Buying Price — was an inline expanding panel under the price cards;
// turned into its own modal (same portaled/centered pattern as every
// other sdo/* modal) with larger text, per explicit request.
//
// Each save is a NEW row (buyingPrices is append-only, keyed by
// effectiveFrom) - never an update to the current one - so an older,
// already-issued Purchase Receipt keeps using the price that was
// actually in effect on its own date (see sdoCalculations.
// resolveBuyingPrice).

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'

function BuyingPriceModal({ currentPriceRow, onClose }) {
  const { user } = useAuth()
  const [dryPrice, setDryPrice] = useState(currentPriceRow ? String(currentPriceRow.dryPrice) : '')
  const [wetPrice, setWetPrice] = useState(currentPriceRow ? String(currentPriceRow.wetPrice) : '')
  const [saving, setSaving] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const dryNum = parseFormattedNumber(dryPrice)
  const wetNum = parseFormattedNumber(wetPrice)
  const canSave = dryNum > 0 && wetNum > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await db.buyingPrices.add({
        id: crypto.randomUUID(),
        dryPrice: dryNum,
        wetPrice: wetNum,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        setByUid: user.uid,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // Portaled to document.body - see PurchaseReceiptModal.jsx's own comment.
  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-lg font-semibold text-app-text">Buying Price</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400 transition-all active:scale-90">✕</button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="text-sm font-semibold uppercase text-neutral-500">Dry Palay (₱/kg)</label>
            <input
              type="text"
              inputMode="decimal"
              value={dryPrice}
              onChange={(e) => setDryPrice(liveFormatNumber(e.target.value, 2))}
              placeholder="0.00"
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3 text-xl font-bold text-app-text outline-none transition-colors focus:border-brand-neon"
            />
          </div>
          <div>
            <label className="text-sm font-semibold uppercase text-neutral-500">Wet Palay (₱/kg)</label>
            <input
              type="text"
              inputMode="decimal"
              value={wetPrice}
              onChange={(e) => setWetPrice(liveFormatNumber(e.target.value, 2))}
              placeholder="0.00"
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3 text-xl font-bold text-app-text outline-none transition-colors focus:border-brand-neon"
            />
          </div>
          {currentPriceRow && (
            <p className="text-sm text-neutral-500">
              Current: ₱{currentPriceRow.dryPrice.toFixed(2)} dry · ₱{currentPriceRow.wetPrice.toFixed(2)} wet, as of {currentPriceRow.effectiveFrom}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-base font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Save New Price
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default BuyingPriceModal
