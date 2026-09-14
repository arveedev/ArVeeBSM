// Abstract of Cereal Purchases export — free period (no preset range),
// same idea as the existing Stock Statement export on Reports.jsx.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { generateSdoAbstract } from '../../../utils/sdoAbstractPdfGenerator.js'
import { computeCashOnHand } from '../../../utils/sdoCalculations.js'

function AbstractExportModal({ onClose }) {
  const { user } = useAuth()
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [generating, setGenerating] = useState(false)

  const handleExport = async () => {
    setGenerating(true)
    try {
      const [allPrs, warehouses, provinces, branches, config, ledgerEntries, activePrsAll] = await Promise.all([
        db.purchaseReceipts.where('sdoUid').equals(user.uid).and((pr) => pr.status === 'Active' && pr.date >= dateFrom && pr.date <= dateTo).toArray(),
        db.warehouses.toArray(),
        db.provinces.toArray(),
        db.branches.toArray(),
        db.reportConfig.get('global'),
        db.cashLedger.where('sdoUid').equals(user.uid).toArray(),
        db.purchaseReceipts.where('[sdoUid+status]').equals([user.uid, 'Active']).toArray(),
      ])

      if (allPrs.length === 0) {
        toast.error('No Purchase Receipts in this period')
        return
      }

      const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
      const provinceMap = new Map(provinces.map((p) => [p.provinceId, p]))
      const branchMap = new Map(branches.map((b) => [b.branchId, b]))
      const firstWarehouse = warehouseMap.get(allPrs[0]?.warehouseId)
      const branch = branchMap.get(provinceMap.get(firstWarehouse?.provinceId)?.branchId)
      const branchLabel = branch ? `${branch.name}${branch.address ? ' · ' + branch.address : ''}` : ''
      const wsrIds = allPrs.map((pr) => pr.wsrTransactionId)
      const wsrs = await db.transactions.where('id').anyOf(wsrIds).toArray()
      const wsrById = new Map(wsrs.map((w) => [w.id, w]))

      const enriched = allPrs.map((pr) => ({
        ...pr,
        warehouseCode: warehouseMap.get(pr.warehouseId)?.code ?? '',
        wsrSerialNo: wsrById.get(pr.wsrTransactionId)?.serialNo ?? '',
      }))

      const eligibility = await db.pricerEligibility.get(user.uid)
      const pricerEnabled = eligibility?.enabled ?? false

      const fundBalance = computeCashOnHand(
        ledgerEntries.filter((e) => e.date < dateFrom),
        activePrsAll.filter((pr) => pr.date < dateFrom).map((pr) => pr.totalAmount ?? 0)
      )
      const periodTotal = enriched.reduce((s, pr) => s + (pr.totalAmount ?? 0), 0)

      const doc = generateSdoAbstract({
        branchLabel,
        periodLabel: dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`,
        purchaseReceipts: enriched,
        purityDisplayFormat: config?.purityDisplayFormat ?? 'range',
        pricerEnabled,
        reconciliation: {
          fundBalance,
          addLabel: 'Fund available',
          addAmount: 0,
          lessEntries: [{ label: 'This period’s disbursements', amount: periodTotal }],
        },
        signatories: {
          preparedBy: config?.disbursementPreparedBy,
          verifiedBy: config?.disbursementVerifiedBy,
          notedBy: config?.disbursementNotedBy,
        },
      })

      doc.save(`Abstract-${dateFrom}-to-${dateTo}.pdf`)
      onClose()
    } catch (err) {
      toast.error('Failed to generate export')
      console.error(err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl border border-neutral-800 bg-neutral-950 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Export Abstract of Cereal Purchases</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase text-neutral-500">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon" />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-neutral-500">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon" />
            </div>
          </div>
          <button type="button" onClick={handleExport} disabled={generating}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40">
            {generating ? 'Generating…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AbstractExportModal
