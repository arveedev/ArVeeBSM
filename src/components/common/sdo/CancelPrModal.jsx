// Cancel PR — lets an SDO cancel a PR by typing its number directly, no
// reason required. Per explicit request:
// - If that number already belongs to a real, issued PR (Active), it's
//   soft-cancelled in place (status: 'Cancelled') - same as cancelling
//   it from inside PurchaseReceiptModal, just reachable by number alone
//   instead of hunting down which WSR it's attached to.
// - If that number was never issued at all (a physical form spoiled
//   before it was ever filled out), a minimal placeholder row is
//   created straight at status: 'Cancelled' - no wsrTransactionId (no
//   real WSR is involved) and no warehouseId (a PR series belongs to
//   the SDO, not a warehouse - see serialNumber.js).
// Either way it then prints on the Abstract PDF as a CANCELLED row
// (sdoAbstractPdfGenerator.js), so a gap in the PR Number sequence is
// always explained. isPrSerialTaken's own duplicate check already scans
// every purchaseReceipts row regardless of status, so a cancelled
// number stays protected against reuse the same way an issued one is.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { todayLocalISO } from '../../../utils/calculations.js'
import { suggestNextPrSerial, recordPrSerialUsed } from '../../../utils/serialNumber.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'

function CancelPrModal({ onClose }) {
  const { user } = useAuth()
  const [prNo, setPrNo] = useState('')
  const [date, setDate] = useState(todayLocalISO())
  const [saving, setSaving] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    let cancelled = false
    suggestNextPrSerial(user?.uid).then((suggested) => {
      if (!cancelled) setPrNo(suggested)
    })
    return () => { cancelled = true }
  }, [user?.uid])

  const trimmedPrNo = prNo.trim()
  const canSave = trimmedPrNo && date && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const existing = await db.purchaseReceipts
        .where('sdoUid').equals(user.uid)
        .and((pr) => pr.prNo === trimmedPrNo)
        .first()

      if (existing) {
        if (existing.status === 'Cancelled') {
          toast.error(`PR ${trimmedPrNo} is already cancelled`)
          return
        }
        await db.purchaseReceipts.update(existing.prId, {
          status: 'Cancelled',
          cancelledAt: Date.now(),
          cancelledByUid: user.uid,
        })
        toast.success(`PR ${trimmedPrNo} cancelled — cash reverted`)
      } else {
        await db.purchaseReceipts.add({
          prId: crypto.randomUUID(),
          prNo: trimmedPrNo,
          sdoUid: user.uid,
          wsrTransactionId: null,
          warehouseId: null,
          status: 'Cancelled',
          date,
          payeeName: null,
          payeeAddress: null,
          rsbsa: null,
          varietyId: null,
          classification: null,
          purityLetter: null,
          purityMin: null,
          purityMax: null,
          ddMin: null,
          ddMax: null,
          moistureContent: null,
          numberOfBags: null,
          grossKilos: null,
          netKilos: null,
          sackKilos: null,
          mtsCondition: null,
          sackTypeCode: null,
          enwFactor: null,
          enw: null,
          unitCost: null,
          basicCost: null,
          pricerRate: null,
          pricerAmount: null,
          totalAmount: null,
          createdAt: Date.now(),
          createdByUid: user.uid,
          cancelledAt: Date.now(),
          cancelledByUid: user.uid,
        })
        await recordPrSerialUsed(user.uid, trimmedPrNo)
        toast.success(`PR ${trimmedPrNo} cancelled`)
      }
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Failed to cancel PR number')
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
          <h2 className="text-lg font-semibold text-app-text">Cancel PR</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400 transition-all active:scale-90">✕</button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <p className="text-sm text-neutral-500">
            Type any PR number to cancel it - an already-issued one is cancelled in place, a number never issued (a form spoiled before it was filled out) is reserved as cancelled directly. Either way it still prints on the Abstract as CANCELLED.
          </p>
          <div>
            <label className="text-sm font-semibold uppercase text-neutral-500">PR No.</label>
            <input
              type="text"
              value={prNo}
              onChange={(e) => setPrNo(e.target.value)}
              placeholder="PR number"
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3 text-xl font-bold text-app-text outline-none transition-colors focus:border-brand-neon"
            />
          </div>
          <div>
            <label className="text-sm font-semibold uppercase text-neutral-500">Date</label>
            <div className="mt-1.5">
              <CalendarDatePicker value={date} onChange={setDate} valueClassName="text-xl font-bold" />
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="w-full rounded-xl bg-brand-crimson px-3 py-3 text-base font-semibold text-app-text transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Cancel This PR Number
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CancelPrModal
