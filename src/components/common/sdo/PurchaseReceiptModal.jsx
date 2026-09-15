// Purchase Receipt — SDO reference screen. NOT an exported document (the
// real PR is hand-written NFA paper); this only auto-computes what the
// SDO copies onto it, and records the payment so the WSR shows as Paid.
//
// Mode is derived, not passed in: a WSR is "Paid" purely because an
// Active purchaseReceipts row with a matching wsrTransactionId exists -
// no flag is ever written onto the WSR/transaction itself, so cancelling
// or deleting a PR here can never touch that record, only this one.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { getPalayMoistureState } from '../../../utils/calculations.js'
import { suggestNextPrSerial, recordPrSerialUsed, isPrSerialTaken } from '../../../utils/serialNumber.js'
import {
  lookupEnwFactor, computeEquivalentNetWeight, computeBasicCost, computePricerAmount,
  resolveBuyingPrice, resolveUnitCost, amountInWords,
} from '../../../utils/sdoCalculations.js'
import ConfirmDialog from '../ConfirmDialog.jsx'

function PurchaseReceiptModal({ wsr, onClose }) {
  const { user } = useAuth()
  const [prNo, setPrNo] = useState('')
  const [pricerRate, setPricerRate] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [saving, setSaving] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const variety = useLiveQuery(() => wsr.varietyId ? db.varietyTypes.get(wsr.varietyId) : null, [wsr.varietyId])
  const sackType = useLiveQuery(() => wsr.mtsSackTypeId ? db.sackTypes.get(wsr.mtsSackTypeId) : null, [wsr.mtsSackTypeId])
  const buyingPrices = useLiveQuery(() => db.buyingPrices.toArray(), []) ?? []
  const enwFactors = useLiveQuery(() => db.enwFactors.toArray(), []) ?? []
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const eligibility = useLiveQuery(() => user ? db.pricerEligibility.get(user.uid) : null, [user?.uid])
  const pricerEnabled = eligibility?.enabled ?? false

  const existingPr = useLiveQuery(
    () => db.purchaseReceipts.where('wsrTransactionId').equals(wsr.id).and((pr) => pr.status === 'Active').first(),
    [wsr.id]
  )
  const isReadOnly = Boolean(existingPr)

  useEffect(() => {
    if (isReadOnly || !user) return
    suggestNextPrSerial(user.uid).then(setPrNo)
  }, [isReadOnly, user?.uid])

  const purityDisplayFormat = config?.purityDisplayFormat ?? 'range'
  const purityDisplay = variety
    ? (purityDisplayFormat === 'letter' ? variety.purityLetter : `${variety.purityMin}–${variety.purityMax}`)
    : '—'

  const moistureState = getPalayMoistureState(variety?.name, wsr.cerealCategory)
  const priceRow = resolveBuyingPrice(buyingPrices, wsr.date)
  const unitCost = resolveUnitCost(priceRow, moistureState)
  const factor = lookupEnwFactor(enwFactors, variety, wsr.moistureContent)
  const netKilos = wsr.netKilos ?? 0
  const enw = factor != null ? computeEquivalentNetWeight(netKilos, factor) : null
  const basicCost = enw != null && unitCost != null ? computeBasicCost(enw, unitCost) : null
  const rateNum = parseFloat(pricerRate) || 0
  const pricerAmount = pricerEnabled && enw != null ? computePricerAmount(enw, rateNum) : 0
  const totalAmount = basicCost != null ? basicCost + pricerAmount : null

  const displayed = existingPr
    ? { prNo: existingPr.prNo, unitCost: existingPr.unitCost, enw: existingPr.enw, basicCost: existingPr.basicCost, pricerRate: existingPr.pricerRate, pricerAmount: existingPr.pricerAmount, totalAmount: existingPr.totalAmount, factor: existingPr.enwFactor }
    : { prNo, unitCost, enw, basicCost, pricerRate: rateNum, pricerAmount, totalAmount, factor }

  const canIssue = !isReadOnly && factor != null && unitCost != null && displayed.prNo?.trim() && !saving

  const handleIssue = async () => {
    if (!canIssue) return
    setSaving(true)
    try {
      const taken = await isPrSerialTaken(user.uid, prNo.trim())
      if (taken) {
        toast.error('You already have a Purchase Receipt with this number')
        return
      }
      const prId = crypto.randomUUID()
      await db.purchaseReceipts.add({
        prId,
        prNo: prNo.trim(),
        sdoUid: user.uid,
        wsrTransactionId: wsr.id,
        warehouseId: wsr.warehouseId,
        status: 'Active',
        date: wsr.date,
        payeeName: wsr.customerName,
        payeeAddress: wsr.customerAddress,
        rsbsa: wsr.farmerRsbsa ?? null,
        varietyId: wsr.varietyId,
        classification: variety?.name ?? null,
        purityLetter: variety?.purityLetter ?? null,
        purityMin: variety?.purityMin ?? null,
        purityMax: variety?.purityMax ?? null,
        ddMin: variety?.ddMin ?? null,
        ddMax: variety?.ddMax ?? null,
        moistureContent: wsr.moistureContent,
        numberOfBags: wsr.numberOfBags,
        grossKilos: wsr.grossKilos,
        netKilos,
        sackKilos: (wsr.grossKilos ?? 0) - netKilos,
        mtsCondition: wsr.mtsCondition,
        sackTypeCode: sackType?.code ?? null,
        enwFactor: factor,
        enw,
        unitCost,
        basicCost,
        pricerRate: pricerEnabled ? rateNum : null,
        pricerAmount: pricerEnabled ? pricerAmount : null,
        totalAmount,
        createdAt: Date.now(),
        createdByUid: user.uid,
      })
      await recordPrSerialUsed(user.uid, prNo.trim())
      toast.success(`Purchase Receipt ${prNo.trim()} issued`)
      onClose()
    } catch (err) {
      toast.error('Failed to issue Purchase Receipt')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error('A reason is required')
      return
    }
    await db.purchaseReceipts.update(existingPr.prId, {
      status: 'Cancelled',
      cancelReason: cancelReason.trim(),
      cancelledAt: Date.now(),
      cancelledByUid: user.uid,
    })
    toast.success(`Purchase Receipt ${existingPr.prNo} cancelled — cash reverted`)
    setConfirmingCancel(false)
    onClose()
  }

  // Portaled straight to document.body - see ConfirmDialog.jsx's own
  // comment for why: a plain `fixed` element inside App.jsx's page
  // wrapper (which applies a CSS transform for the page-slide
  // animation) gets constrained to that ancestor's box instead of the
  // real viewport, which is exactly what made this render small and
  // off-center instead of a real centered/full-width overlay.
  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 transition-opacity duration-200 sm:items-center sm:p-4 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-950 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] sm:rounded-2xl"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-app-text">Purchase Receipt</h2>
            <p className="text-xs text-neutral-500">Reference for the hand-written PR — not a document</p>
          </div>
          <div className="flex gap-2">
            {isReadOnly && (
              <button type="button" onClick={() => setConfirmingCancel(true)} aria-label="Cancel receipt" className="rounded-lg bg-brand-crimson/10 p-1.5 text-brand-crimson">
                <Trash2 size={18} />
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400 inline-block">
            From WSR <span className="font-mono text-app-text">{wsr.serialNo}</span>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <label className="text-[10px] font-semibold uppercase text-neutral-500">Purchase Receipt No.</label>
            {isReadOnly ? (
              <p className="mt-1 font-mono text-base font-semibold text-app-text">{existingPr.prNo}</p>
            ) : (
              <input
                type="text"
                value={prNo}
                onChange={(e) => setPrNo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-base text-app-text outline-none focus:border-brand-neon"
              />
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
            <p className="text-[10px] font-semibold uppercase text-neutral-500">Payee</p>
            <p className="mt-1 font-medium text-app-text">{wsr.customerName}</p>
            {wsr.farmerRsbsa && <p className="text-xs text-neutral-400">RSBSA {wsr.farmerRsbsa}</p>}
            <p className="text-xs text-neutral-400">{wsr.customerAddress}</p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
            <p className="text-[10px] font-semibold uppercase text-neutral-500">Classification</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-base font-bold text-brand-neon">{variety?.name ?? '—'}</span>
              <span className="text-xs text-neutral-400">MC {wsr.moistureContent}% · Pur. {purityDisplay}</span>
            </div>
            {factor == null && (
              <p className="mt-1.5 text-xs text-brand-crimson">
                No ENW factor configured for this classification at this MC — set one in Admin → Disbursement → ENW Table.
              </p>
            )}
            {unitCost == null && (
              <p className="mt-1.5 text-xs text-brand-crimson">No Buying Price set yet — set one on Home.</p>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
            <p className="text-[10px] font-semibold uppercase text-neutral-500">
              Weight in Kilos {wsr.mtsCondition && <span className="ml-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] font-bold text-neutral-500">{wsr.mtsCondition}</span>}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
              <p>Bags <span className="font-semibold text-app-text">{wsr.numberOfBags}</span></p>
              <p>Gross <span className="font-semibold text-app-text">{wsr.grossKilos}</span></p>
              <p>Net <span className="font-semibold text-app-text">{netKilos}</span></p>
              <p>Equiv. Net Wt <span className="font-semibold text-brand-neon">{displayed.enw != null ? displayed.enw.toFixed(4) : '—'}</span></p>
            </div>
          </div>

          {pricerEnabled && (
            <div className="rounded-xl border border-brand-neon/40 bg-brand-neon/5 p-3 text-sm">
              <p className="text-[10px] font-semibold uppercase text-brand-neon">Pricer Incentive — enabled for you</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-neutral-500">Rate (₱/kg)</label>
                  {isReadOnly ? (
                    <p className="text-sm font-semibold text-app-text">{existingPr.pricerRate}</p>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      value={pricerRate}
                      onChange={(e) => setPricerRate(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-app-text outline-none focus:border-brand-neon"
                    />
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-neutral-500">Amount</label>
                  <p className="mt-0.5 text-sm font-semibold text-app-text">₱{(displayed.pricerAmount ?? 0).toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-brand-neon/40 bg-brand-neon/5 p-3">
            <p className="text-[10px] font-semibold uppercase text-brand-neon">Total Amount</p>
            <p className="mt-1 text-xl font-bold text-app-text">
              {displayed.totalAmount != null ? `₱${displayed.totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
            </p>
            {displayed.totalAmount != null && (
              <p className="mt-1 text-xs italic text-neutral-400">{amountInWords(displayed.totalAmount)}</p>
            )}
          </div>
        </div>

        {!isReadOnly && (
          <div className="border-t border-neutral-800 px-4 py-3">
            <button
              type="button"
              onClick={handleIssue}
              disabled={!canIssue}
              className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              Save &amp; Issue
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this Purchase Receipt?"
        description={existingPr ? `This reverts ₱${(existingPr.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} back to your Cash on Hand. WSR ${wsr.serialNo} returns to Unpaid — it is not touched or cancelled.` : ''}
        confirmLabel="Cancel Receipt"
        cancelLabel="Back"
        onConfirm={handleCancel}
        onCancel={() => setConfirmingCancel(false)}
      >
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Reason (required)"
          rows={2}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon"
        />
      </ConfirmDialog>
    </div>,
    document.body
  )
}

export default PurchaseReceiptModal
