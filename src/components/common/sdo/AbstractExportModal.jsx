// Abstract of Cereal Purchases export — free period (no preset range),
// same idea as the existing Stock Statement export on Reports.jsx.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { generateSdoAbstract } from '../../../utils/sdoAbstractPdfGenerator.js'
import { computeCashOnHand } from '../../../utils/sdoCalculations.js'

function AbstractExportModal({ onClose }) {
  const { user } = useAuth()
  // Read live, not from the AuthContext snapshot - `user` is only set
  // once at login, so a Position edited in Settings just now wouldn't
  // show up here until next login if this read it from `user` instead.
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
      const [allPrs, warehouses, provinces, branches, config, ledgerEntries, activePrsAll] = await Promise.all([
        db.purchaseReceipts.where('sdoUid').equals(user.uid).and((pr) => pr.status === 'Active' && pr.date >= dateFrom && pr.date <= dateTo).toArray(),
        db.warehouses.toArray(),
        db.provinces.toArray(),
        db.branches.toArray(),
        db.reportConfig.get('global'),
        db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray(),
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

      // The Whse column shows the province code plus the warehouse's own
      // short name (e.g. "ALB-BSI B", "CTD-ABACORP A") - per explicit
      // request, built fresh from the warehouse's real provinceId ->
      // province.code relationship (stripping any prefix the name
      // already carries first, so a warehouse.name that happens to
      // already start with one never doubles up into "ALB-ALB-BSI B"),
      // not the opaque numeric warehouse.code ("050501").
      const enriched = allPrs.map((pr) => {
        const warehouse = warehouseMap.get(pr.warehouseId)
        const province = provinceMap.get(warehouse?.provinceId)
        const shortName = (warehouse?.name ?? '').replace(/^[A-Z]{2,5}-/, '')
        return {
          ...pr,
          warehouseCode: province?.code ? `${province.code}-${shortName}` : shortName,
          wsrSerialNo: wsrById.get(pr.wsrTransactionId)?.serialNo ?? '',
        }
      })
      // Per explicit request: rows print sorted ascending by PR Number.
      // prNo is a free-typed string field (serialNumber.js's
      // suggestNextPrSerial only suggests a numeric default - it isn't
      // enforced), so a numeric comparison is tried first when both
      // sides parse cleanly as numbers, falling back to a plain string
      // compare for anything that doesn't (never throws, never drops a
      // row for having an unusual PR Number).
      enriched.sort((a, b) => {
        const na = Number(a.prNo)
        const nb = Number(b.prNo)
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
        return (a.prNo ?? '').localeCompare(b.prNo ?? '', undefined, { numeric: true })
      })

      // Opening balance: everything that happened strictly BEFORE this
      // period started.
      const openingBalance = computeCashOnHand(
        ledgerEntries.filter((e) => e.date < dateFrom),
        activePrsAll.filter((pr) => pr.date < dateFrom).map((pr) => pr.totalAmount ?? 0)
      )
      // Reported real bug (first pass): "Fund available" always printed
      // 0.00 - hardcoded, never derived from anything. Second report:
      // showing every replenishment folded into one COH — Fund Balance
      // figure meant a real, check-numbered replenishment never appeared
      // anywhere on the page - per explicit correction, a period
      // replenishment WITH a real check number (CashActionModal.jsx's
      // `refNo` field) now prints as its own line item. The one-time
      // "Opening balance" seed entry (refNo literally set to that
      // string, not a real check) has no check to reference, so it stays
      // folded into the fundBalance figure itself, same as before -
      // "only replenishment with check number should appear" per
      // explicit request.
      const periodLedgerEntries = ledgerEntries.filter((e) => !e.voided && e.date >= dateFrom && e.date <= dateTo)
      const periodReplenishEntries = periodLedgerEntries.filter((e) => e.type === 'replenish')
      const checkedReplenishEntries = periodReplenishEntries.filter((e) => e.refNo && e.refNo !== 'Opening balance')
      const uncheckedReplenished = periodReplenishEntries
        .filter((e) => !(e.refNo && e.refNo !== 'Opening balance'))
        .reduce((s, e) => s + e.amount, 0)
      const periodLiquidated = periodLedgerEntries.filter((e) => e.type === 'liquidate').reduce((s, e) => s + e.amount, 0)
      const fundBalance = openingBalance + uncheckedReplenished - periodLiquidated
      const addEntries = checkedReplenishEntries.map((e) => ({
        label: `Replenish — Check No. ${e.refNo}`,
        amount: e.amount,
      }))
      const periodTotal = enriched.reduce((s, pr) => s + (pr.totalAmount ?? 0), 0)

      const doc = generateSdoAbstract({
        branchLabel,
        dateFrom,
        dateTo,
        purchaseReceipts: enriched,
        purityDisplayFormat: config?.purityDisplayFormat ?? 'range',
        reconciliation: {
          fundBalance,
          addEntries,
          lessEntries: [{ label: 'This period’s disbursements', amount: periodTotal }],
        },
        signatories: {
          // Always the SDO who actually generated this export, not an
          // admin-set fixed name - "the prepared by should always be
          // the disbursing officer", confirmed directly.
          preparedBy: { name: user.name, position: userRecord?.position?.trim() || 'Disbursing Officer' },
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

  // Portaled to document.body - see PurchaseReceiptModal.jsx's own comment.
  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Export Abstract of Cereal Purchases</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>
        <div className="space-y-3 px-4 py-4">
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
          <button type="button" onClick={handleExport} disabled={generating}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40">
            {generating ? 'Generating…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default AbstractExportModal
