// Cash in Bank — per explicit request, edited the same way Buying Price
// is (BuyingPriceModal.jsx): its own modal, not an inline pencil-edit
// row, with the same large comma-formatted input and "Current: ..."
// info line. Unlike Buying Price, this is a single current figure, not
// an append-only history - db.reportConfig's 'global' row is updated in
// place, but it's still the same shared, branch-wide value any SDO can
// change (see Settings.jsx's SdoCashSection / SdoCashOverviewPanel.jsx).

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'
import { roundPeso2 } from '../../../utils/sdoCalculations.js'

function CashOnBankModal({ current, onClose }) {
  const { user } = useAuth()
  const [amount, setAmount] = useState(current?.cashOnBank ? liveFormatNumber(String(current.cashOnBank), 2) : '')
  const [saving, setSaving] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const amountNum = parseFormattedNumber(amount)
  const canSave = amountNum >= 0 && amount.trim() !== '' && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const patch = {
        cashOnBank: roundPeso2(amountNum),
        cashOnBankUpdatedAt: new Date().toISOString(),
        cashOnBankUpdatedBy: user?.name || 'Unknown',
      }
      const existing = await db.reportConfig.get('global')
      if (existing) await db.reportConfig.update('global', patch)
      else await db.reportConfig.put({ id: 'global', ...patch })
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
          <h2 className="text-lg font-semibold text-app-text">Cash in Bank</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400 transition-all active:scale-90">✕</button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <p className="text-sm text-neutral-500">Shared across the whole branch - any SDO can update it.</p>
          <div>
            <label className="text-sm font-semibold uppercase text-neutral-500">Cash in Bank (₱)</label>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(liveFormatNumber(e.target.value, 2))}
              placeholder="0.00"
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3 text-xl font-bold text-app-text outline-none transition-colors focus:border-brand-neon"
            />
          </div>
          {current?.cashOnBankUpdatedAt && (
            <p className="text-sm text-neutral-500">
              Current: ₱{(current.cashOnBank ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })},
              {' '}updated by {current.cashOnBankUpdatedBy || 'Unknown'} on {new Date(current.cashOnBankUpdatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-base font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Save Cash in Bank
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CashOnBankModal
