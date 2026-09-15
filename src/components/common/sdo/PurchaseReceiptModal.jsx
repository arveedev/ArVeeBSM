// Purchase Receipt — SDO reference screen. NOT an exported document (the
// real PR is hand-written NFA paper); this only auto-computes what the
// SDO copies onto it, and records the payment so the WSR shows as Paid.
//
// Mode is derived, not passed in: a WSR is "Paid" purely because an
// Active purchaseReceipts row with a matching wsrTransactionId exists -
// no flag is ever written onto the WSR/transaction itself, so cancelling
// or deleting a PR here can never touch that record, only this one.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { getPalayMoistureState, fmtBags, fmtKilos, liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'
import { suggestNextPrSerial, recordPrSerialUsed, isPrSerialTaken } from '../../../utils/serialNumber.js'
import {
  lookupEnwFactor, computeEquivalentNetWeight, computeBasicCost, computePricerAmount,
  resolveBuyingPrice, resolveUnitCost, amountInWords, enwDecimalsForFactor,
} from '../../../utils/sdoCalculations.js'
import ConfirmDialog from '../ConfirmDialog.jsx'

function PurchaseReceiptModal({ wsr, cashOnHand, onClose }) {
  const { user } = useAuth()
  const [prNo, setPrNo] = useState('')
  // Defaults to today, not the WSR's own (often earlier, backlogged)
  // date - this is genuinely when the SDO is paying, and it's what the
  // Buying Price lookup should use too, not the WSR's encoding date.
  const [datePaid, setDatePaid] = useState(() => new Date().toISOString().slice(0, 10))
  const [pricerRate, setPricerRate] = useState('')
  const [cancelTargetPrId, setCancelTargetPrId] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [entered, setEntered] = useState(false)
  // Belt-and-suspenders against a double "Save & Issue" tap: `saving`
  // (React state) only disables the button after a re-render, which
  // isn't synchronous enough to stop two clicks that land within the
  // same frame. This ref flips the instant handleIssue starts, before
  // any state update or await, so a second call in the same tick bails
  // out immediately regardless of render timing.
  const issuingRef = useRef(false)

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

  // Fetched as a list, not `.first()` - normally holds at most one row,
  // but if two ever got issued for the same WSR (a double-tap, or two
  // offline devices both issuing before syncing - see the duplicate-PR
  // banner on SdoHome.jsx), every one of them needs to be visible and
  // individually cancellable here, not silently collapsed to whichever
  // one `.first()` happened to return.
  const existingPrs = useLiveQuery(
    () => db.purchaseReceipts.where('wsrTransactionId').equals(wsr.id).and((pr) => pr.status === 'Active').toArray(),
    [wsr.id]
  )
  // undefined while the query hasn't resolved yet - kept distinct from
  // isReadOnly so the editable form/Issue button can't flash into view
  // for an already-paid WSR during that first-frame gap, and so a fast
  // tap can't slip through before we actually know the real state.
  const prsLoaded = existingPrs !== undefined
  const existingPr = existingPrs?.[0] ?? null
  const hasDuplicatePrs = (existingPrs?.length ?? 0) > 1
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
  const priceRow = resolveBuyingPrice(buyingPrices, isReadOnly ? existingPr.date : datePaid)
  const unitCost = resolveUnitCost(priceRow, moistureState)
  const factor = lookupEnwFactor(enwFactors, variety, wsr.moistureContent)
  const netKilos = wsr.netKilos ?? 0
  const enw = factor != null ? computeEquivalentNetWeight(netKilos, factor) : null
  const basicCost = enw != null && unitCost != null ? computeBasicCost(enw, unitCost) : null
  const rateNum = parseFormattedNumber(pricerRate) || 0
  const pricerAmount = pricerEnabled && enw != null ? computePricerAmount(enw, rateNum) : 0
  const totalAmount = basicCost != null ? basicCost + pricerAmount : null

  const displayed = existingPr
    ? { prNo: existingPr.prNo, unitCost: existingPr.unitCost, enw: existingPr.enw, basicCost: existingPr.basicCost, pricerRate: existingPr.pricerRate, pricerAmount: existingPr.pricerAmount, totalAmount: existingPr.totalAmount, factor: existingPr.enwFactor }
    : { prNo, unitCost, enw, basicCost, pricerRate: rateNum, pricerAmount, totalAmount, factor }

  // A re-opened PR shows its OWN pricer breakdown if it actually has one
  // (existingPr.pricerAmount != null), not whether Pricer happens to be
  // enabled for this SDO right now - Admin can toggle eligibility after
  // the fact, and an old PR that did include a pricer amount must keep
  // showing it, or its Total Amount stops reconciling with what's shown.
  const showPricerBlock = isReadOnly ? existingPr.pricerAmount != null : pricerEnabled

  const canIssue = prsLoaded && !isReadOnly && factor != null && unitCost != null && displayed.prNo?.trim() && !saving

  const handleIssue = async () => {
    if (!canIssue || issuingRef.current) return
    issuingRef.current = true
    setSaving(true)
    try {
      const trimmedPrNo = prNo.trim()
      const taken = await isPrSerialTaken(user.uid, trimmedPrNo)
      if (taken) {
        toast.error('You already have a Purchase Receipt with this number')
        return
      }
      const prId = crypto.randomUUID()
      // Check-then-write inside one Dexie transaction, re-reading fresh
      // from the table instead of trusting the `existingPrs` snapshot
      // this render started with - closes the same-device race where a
      // double tap (or two renders in flight) both pass `canIssue`
      // before either write lands. This can't close the cross-device
      // offline case (two devices, neither has synced the other's PR
      // yet) - that's caught after the fact instead, by the duplicate-PR
      // detection and banner on SdoHome.jsx.
      let blockedByDuplicate = false
      await db.transaction('rw', db.purchaseReceipts, async () => {
        const dup = await db.purchaseReceipts.where('wsrTransactionId').equals(wsr.id).and((pr) => pr.status === 'Active').first()
        if (dup) {
          blockedByDuplicate = true
          return
        }
        await db.purchaseReceipts.add({
          prId,
          prNo: trimmedPrNo,
          sdoUid: user.uid,
          wsrTransactionId: wsr.id,
          warehouseId: wsr.warehouseId,
          status: 'Active',
          date: datePaid,
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
      })
      if (blockedByDuplicate) {
        toast.error('This WSR was just paid — reopen it to see the existing Purchase Receipt')
        onClose()
        return
      }
      await recordPrSerialUsed(user.uid, trimmedPrNo)
      toast.success(`Purchase Receipt ${trimmedPrNo} issued`)
      onClose()
    } catch (err) {
      toast.error('Failed to issue Purchase Receipt')
      console.error(err)
    } finally {
      setSaving(false)
      issuingRef.current = false
    }
  }

  const cancelTarget = existingPrs?.find((pr) => pr.prId === cancelTargetPrId) ?? null

  const handleCancel = async () => {
    if (!cancelTarget) return
    if (!cancelReason.trim()) {
      toast.error('A reason is required')
      return
    }
    await db.purchaseReceipts.update(cancelTarget.prId, {
      status: 'Cancelled',
      cancelReason: cancelReason.trim(),
      cancelledAt: Date.now(),
      cancelledByUid: user.uid,
    })
    toast.success(`Purchase Receipt ${cancelTarget.prNo} cancelled — cash reverted`)
    setCancelTargetPrId(null)
    setCancelReason('')
    if (!hasDuplicatePrs) onClose()
  }

  // Portaled straight to document.body - see ConfirmDialog.jsx's own
  // comment for why: a plain `fixed` element inside App.jsx's page
  // wrapper (which applies a CSS transform for the page-slide
  // animation) gets constrained to that ancestor's box instead of the
  // real viewport, which is exactly what made this render small and
  // off-center instead of a real centered/full-width overlay.
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
          <h2 className="text-lg font-semibold text-app-text">Purchase Receipt</h2>
          <div className="flex gap-2">
            {isReadOnly && !hasDuplicatePrs && (
              <button type="button" onClick={() => setCancelTargetPrId(existingPr.prId)} aria-label="Cancel receipt" className="rounded-lg bg-brand-crimson/10 p-1.5 text-brand-crimson">
                <Trash2 size={18} />
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="inline-block rounded-full border border-neutral-800 bg-neutral-900 px-3.5 py-2 font-mono text-base font-bold text-app-text">
            WSR {wsr.serialNo}
          </div>

          {hasDuplicatePrs && (
            <div className="rounded-xl border border-brand-crimson/40 bg-brand-crimson/5 p-3">
              <p className="text-sm font-semibold text-brand-crimson">
                {existingPrs.length} active Purchase Receipts exist for this WSR — cancel every extra one below.
              </p>
              <div className="mt-2 space-y-2">
                {existingPrs.map((pr) => (
                  <div key={pr.prId} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2">
                    <div>
                      <p className="font-mono text-sm font-semibold text-app-text">PR {pr.prNo}</p>
                      <p className="text-xs text-neutral-500">{pr.date} · ₱{(pr.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCancelTargetPrId(pr.prId)}
                      className="shrink-0 rounded-lg bg-brand-crimson/10 px-2.5 py-1.5 text-xs font-bold text-brand-crimson transition-all active:scale-95"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Date sits above PR No. on small screens (DOM order) and
              rejoins it side by side once there's room, sm+. */}
          <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <label className="text-xs font-semibold uppercase text-neutral-500">Date</label>
              {isReadOnly ? (
                <p className="mt-1 text-base font-semibold text-app-text">{existingPr.date}</p>
              ) : (
                <div className="mt-1">
                  <CalendarDatePicker value={datePaid} onChange={setDatePaid} valueClassName="text-base" />
                </div>
              )}
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <label className="text-xs font-semibold uppercase text-neutral-500">Purchase Receipt No.</label>
              {isReadOnly ? (
                <p className="mt-1 font-mono text-lg font-semibold text-app-text">{existingPr.prNo}</p>
              ) : (
                <input
                  type="text"
                  value={prNo}
                  onChange={(e) => setPrNo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-lg text-app-text outline-none focus:border-brand-neon"
                />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-base">
            <p className="text-xs font-semibold uppercase text-neutral-500">Payee</p>
            <p className="mt-1 font-medium text-app-text">{wsr.customerName}</p>
            {wsr.farmerRsbsa && <p className="text-sm text-neutral-400">RSBSA {wsr.farmerRsbsa}</p>}
            <p className="text-sm text-neutral-400">{wsr.customerAddress}</p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-base">
            <p className="text-xs font-semibold uppercase text-neutral-500">Classification</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-lg font-bold text-brand-neon">{variety?.name ?? '—'}</span>
              <span className="text-sm text-neutral-400">MC {wsr.moistureContent}% · Pur. {purityDisplay}</span>
            </div>
            {factor == null && (
              <p className="mt-1.5 text-sm text-brand-crimson">
                No ENW factor configured for this classification at this MC — set one in Admin → Disbursement → ENW Table.
              </p>
            )}
            {unitCost == null && (
              <p className="mt-1.5 text-sm text-brand-crimson">No Buying Price set yet — set one on Home.</p>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-base">
            <p className="text-xs font-semibold uppercase text-neutral-500">
              Weight in Kilos {wsr.mtsCondition && <span className="ml-1 rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-bold text-neutral-500">{wsr.mtsCondition}</span>}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <p>Bags <span className="font-semibold tabular-nums text-app-text">{fmtBags(wsr.numberOfBags)}</span></p>
              <p>Gross <span className="font-semibold tabular-nums text-app-text">{fmtKilos(wsr.grossKilos)}</span></p>
              <p>Net <span className="font-semibold tabular-nums text-app-text">{fmtKilos(netKilos)}</span></p>
              <p>Equiv. Net Wt <span className="font-semibold tabular-nums text-brand-neon">{displayed.enw != null ? displayed.enw.toLocaleString('en-PH', { minimumFractionDigits: enwDecimalsForFactor(displayed.factor), maximumFractionDigits: enwDecimalsForFactor(displayed.factor) }) : '—'}</span></p>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-base">
            <p className="text-xs font-semibold uppercase text-neutral-500">ENW Factor</p>
            <p className="mt-1 font-mono text-lg font-bold text-app-text">{displayed.factor != null ? displayed.factor.toFixed(4) : '—'}</p>
          </div>

          {showPricerBlock && (
            <div className="rounded-xl border border-brand-neon/40 bg-brand-neon/5 p-3 text-base">
              <p className="text-xs font-semibold uppercase text-brand-neon">Pricer Incentive{!isReadOnly ? ' — enabled for you' : ''}</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-neutral-500">Rate (₱/kg)</label>
                  {isReadOnly ? (
                    <p className="text-base font-semibold tabular-nums text-app-text">{existingPr.pricerRate}</p>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pricerRate}
                      onChange={(e) => setPricerRate(liveFormatNumber(e.target.value, 2))}
                      placeholder="0.00"
                      className="mt-0.5 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-base text-app-text outline-none focus:border-brand-neon"
                    />
                  )}
                </div>
                <div>
                  <label className="text-xs text-neutral-500">Amount</label>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-app-text">₱{(displayed.pricerAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-brand-neon/40 bg-brand-neon/5 p-3">
            <p className="text-xs font-semibold uppercase text-brand-neon">Total Amount</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-app-text">
              {displayed.totalAmount != null ? `₱${displayed.totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
            </p>
            {displayed.totalAmount != null && (
              <p className="mt-1 text-sm italic text-neutral-400">{amountInWords(displayed.totalAmount)}</p>
            )}
            {!isReadOnly && displayed.totalAmount != null && cashOnHand != null && displayed.totalAmount > cashOnHand && (
              <p className="mt-1.5 text-sm text-brand-amber">
                Exceeds your current Cash on Hand (₱{cashOnHand.toLocaleString('en-PH', { minimumFractionDigits: 2 })}) — you can still issue this, but double-check before paying out.
              </p>
            )}
          </div>
        </div>

        {!isReadOnly && (
          <div className="shrink-0 border-t border-neutral-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={handleIssue}
              disabled={!canIssue}
              className="w-full rounded-xl bg-brand-neon px-3 py-3 text-base font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              Save &amp; Issue
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title={`Cancel Purchase Receipt ${cancelTarget?.prNo ?? ''}?`}
        description={cancelTarget ? `This reverts ₱${(cancelTarget.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} back to your Cash on Hand.${hasDuplicatePrs ? '' : ` WSR ${wsr.serialNo} returns to Unpaid — it is not touched or cancelled.`}` : ''}
        confirmLabel="Cancel Receipt"
        cancelLabel="Back"
        onConfirm={handleCancel}
        onCancel={() => { setCancelTargetPrId(null); setCancelReason('') }}
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
