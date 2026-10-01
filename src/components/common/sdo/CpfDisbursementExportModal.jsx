// CPF Cash Disbursement Record export — free period (no preset range),
// same date-picker pattern as AbstractExportModal.jsx. Deliberately
// simpler than that modal: no receipt checklist or cut-off mechanism -
// this report is a plain running cash ledger for a period, not a
// per-PR reportable/locked document, so there's nothing here that needs
// to be checked off or frozen against double-reporting.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { generateCpfDisbursementRecord } from '../../../utils/sdoCpfDisbursementPdfGenerator.js'
import { computeCashOnHand } from '../../../utils/sdoCalculations.js'

function CpfDisbursementExportModal({ onClose }) {
  const { user } = useAuth()
  // Read live, not the AuthContext snapshot - same reasoning
  // AbstractExportModal.jsx's own userRecord has.
  const userRecord = useLiveQuery(() => user?.uid ? db.users.get(user.uid) : null, [user?.uid])
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [generating, setGenerating] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const handleExport = async () => {
    setGenerating(true)
    try {
      const [periodPrsRaw, priorPrsRaw, warehouses, provinces, branches, ledgerEntriesAll] = await Promise.all([
        // Active, CASH-paid PRs only - a Check-paid PR never drew from
        // the physical CPF cash this report tracks (see
        // computeCashOnHand's own comment), and a Cancelled PR never
        // actually disbursed anything, unlike the Abstract which keeps
        // Cancelled rows to explain a PR-number gap - a different,
        // procurement-sequence concern this cash ledger doesn't have.
        db.purchaseReceipts.where('sdoUid').equals(user.uid)
          .and((pr) => pr.status === 'Active' && pr.paymentMethod !== 'Check' && pr.date >= dateFrom && pr.date <= dateTo)
          .toArray(),
        db.purchaseReceipts.where('[sdoUid+status]').equals([user.uid, 'Active']).and((pr) => pr.date < dateFrom).toArray(),
        db.warehouses.toArray(),
        db.provinces.toArray(),
        db.branches.toArray(),
        db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray(),
      ])

      const periodLedgerEntries = ledgerEntriesAll.filter((e) => !e.voided && e.date >= dateFrom && e.date <= dateTo)
      const priorLedgerEntries = ledgerEntriesAll.filter((e) => e.date < dateFrom)

      if (periodPrsRaw.length === 0 && periodLedgerEntries.length === 0) {
        toast.error('No Cash disbursements or CPF cash events in this period')
        return
      }

      const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
      const provinceMap = new Map(provinces.map((p) => [p.provinceId, p]))
      const branchMap = new Map(branches.map((b) => [b.branchId, b]))
      const firstWarehouse = warehouseMap.get(periodPrsRaw.find((pr) => pr.warehouseId)?.warehouseId)
      const branch = branchMap.get(provinceMap.get(firstWarehouse?.provinceId)?.branchId)
      // Confirmed, reported real bug: branch.name already carries
      // "Branch" in it (e.g. "Albay Branch"), so unconditionally
      // appending " Branch Office" produced "Albay Branch Branch
      // Office". Only appends the word still missing.
      const branchLabel = branch?.name
        ? /\bbranch\b/i.test(branch.name) ? `${branch.name} Office` : `${branch.name} Branch Office`
        : ''
      const cityLabel = branch?.address ?? ''

      const wsrIds = periodPrsRaw.map((pr) => pr.wsrTransactionId).filter(Boolean)
      const wsrs = wsrIds.length > 0 ? await db.transactions.where('id').anyOf(wsrIds).toArray() : []
      const wsrById = new Map(wsrs.map((w) => [w.id, w]))

      // Same resolvedRsbsa fallback AbstractExportModal.jsx uses - see
      // its own comment for why a stale pr.rsbsa alone isn't enough for
      // a Farmer Org transaction.
      const enriched = periodPrsRaw.map((pr) => {
        const wsr = wsrById.get(pr.wsrTransactionId)
        const rsbsa = wsr?.farmerCoops?.length
          ? wsr.farmerCoops.map((m) => m.rsbsa).filter(Boolean).join(' / ') || null
          : (pr.rsbsa || null)
        return { ...pr, rsbsa, wsrSerialNo: wsr?.serialNo ?? '' }
      })

      const openingBalance = computeCashOnHand(priorLedgerEntries, priorPrsRaw)

      const doc = generateCpfDisbursementRecord({
        branchLabel,
        cityLabel,
        dateFrom,
        dateTo,
        purchaseReceipts: enriched,
        ledgerEntries: periodLedgerEntries,
        openingBalance,
        purityDisplayFormat: (await db.reportConfig.get('global'))?.purityDisplayFormat ?? 'range',
        officer: { name: user.name, position: userRecord?.position?.trim() || 'Accountable Officer' },
      })

      doc.save(`CPF-Cash-Disbursement-Record-${dateFrom}-to-${dateTo}.pdf`)
      onClose()
    } catch (err) {
      toast.error('Failed to generate export')
      console.error(err)
    } finally {
      setGenerating(false)
    }
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Export CPF Cash Disbursement Record</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase text-neutral-500">From</label>
              <div className="mt-1">
                <CalendarDatePicker value={dateFrom} onChange={setDateFrom} valueClassName="text-sm" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-neutral-500">To</label>
              <div className="mt-1">
                <CalendarDatePicker value={dateTo} onChange={setDateTo} valueClassName="text-sm" />
              </div>
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Lists every Cash-paid Purchase Receipt in this period, plus every CPF replenishment/liquidation, with a
            running Cash Advance/Fund Balance. Check-paid receipts never appear here.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={generating}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {generating ? 'Generating…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CpfDisbursementExportModal
