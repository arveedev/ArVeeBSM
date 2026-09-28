// Selective Abstract export - per explicit request, a separate, more
// deliberate export path alongside AbstractExportModal.jsx's own quick
// "export the whole period" flow: this one lists every real Purchase
// Receipt in the chosen period as a checkbox list first, so the SDO can
// uncheck specific ones (e.g. a PR that shouldn't print on THIS
// particular abstract copy) before generating - the printed table AND
// every reconciliation total below it reflect only the checked subset,
// so the document stays internally consistent with what it actually
// shows rather than printing totals for PRs the reader can't see listed.
//
// Deliberately a separate button/modal rather than folding a checklist
// into the existing quick-export flow, per explicit request ("a
// special button/icon that has a special function") - the common case
// (export everything in the period) stays exactly as fast as it always
// was.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, Check } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { generateSdoAbstract } from '../../../utils/sdoAbstractPdfGenerator.js'
import { computeCashOnHand } from '../../../utils/sdoCalculations.js'

function SelectivePrExportModal({ onClose }) {
  const { user } = useAuth()
  const userRecord = useLiveQuery(() => user?.uid ? db.users.get(user.uid) : null, [user?.uid])
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [generating, setGenerating] = useState(false)
  const [entered, setEntered] = useState(false)
  const [checkedIds, setCheckedIds] = useState(() => new Set())

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Same PR scope as AbstractExportModal.jsx's own quick export - Active
  // AND Cancelled (a void still explains a gap in the PR Number
  // sequence), sorted the same PR-Number-ascending way the printed
  // table itself uses, so the checklist's own order matches what
  // actually prints.
  const periodPrs = useLiveQuery(async () => {
    if (!user?.uid || !dateFrom || !dateTo) return []
    const prs = await db.purchaseReceipts
      .where('sdoUid').equals(user.uid)
      .and((pr) => (pr.status === 'Active' || pr.status === 'Cancelled') && pr.date >= dateFrom && pr.date <= dateTo)
      .toArray()
    return [...prs].sort((a, b) => {
      const na = Number(a.prNo)
      const nb = Number(b.prNo)
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
      return (a.prNo ?? '').localeCompare(b.prNo ?? '', undefined, { numeric: true })
    })
  }, [user?.uid, dateFrom, dateTo]) ?? []

  // Defaults every PR in the period to checked (matches the quick
  // export's own "everything in the period" behavior) whenever the
  // period actually changes - re-keyed on the real set of ids rather
  // than the array reference, so an unrelated re-render (a live sync
  // write touching some OTHER field) doesn't reset a selection the SDO
  // already made.
  const periodPrIdsKey = periodPrs.map((pr) => pr.prId).sort().join(',')
  useEffect(() => {
    setCheckedIds(new Set(periodPrs.map((pr) => pr.prId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodPrIdsKey])

  const toggleOne = (prId) => setCheckedIds((prev) => {
    const next = new Set(prev)
    if (next.has(prId)) next.delete(prId); else next.add(prId)
    return next
  })
  const allChecked = periodPrs.length > 0 && checkedIds.size === periodPrs.length
  const toggleAll = () => setCheckedIds(allChecked ? new Set() : new Set(periodPrs.map((pr) => pr.prId)))

  const handleExport = async () => {
    if (checkedIds.size === 0) {
      toast.error('Check at least one Purchase Receipt to export')
      return
    }
    setGenerating(true)
    try {
      const [warehouses, provinces, branches, config, ledgerEntries, activePrsAll] = await Promise.all([
        db.warehouses.toArray(),
        db.provinces.toArray(),
        db.branches.toArray(),
        db.reportConfig.get('global'),
        db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray(),
        db.purchaseReceipts.where('[sdoUid+status]').equals([user.uid, 'Active']).toArray(),
      ])

      // Only the CHECKED subset from here on - same shape as
      // AbstractExportModal.jsx's own `allPrs`, just pre-filtered.
      const allPrs = periodPrs.filter((pr) => checkedIds.has(pr.prId))

      const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
      const provinceMap = new Map(provinces.map((p) => [p.provinceId, p]))
      const branchMap = new Map(branches.map((b) => [b.branchId, b]))
      const firstWarehouse = warehouseMap.get(allPrs.find((pr) => pr.warehouseId)?.warehouseId)
      const branch = branchMap.get(provinceMap.get(firstWarehouse?.provinceId)?.branchId)
      const branchLabel = branch ? `${branch.name}${branch.address ? ' · ' + branch.address : ''}` : ''
      const wsrIds = allPrs.map((pr) => pr.wsrTransactionId).filter(Boolean)
      const wsrs = wsrIds.length > 0 ? await db.transactions.where('id').anyOf(wsrIds).toArray() : []
      const wsrById = new Map(wsrs.map((w) => [w.id, w]))

      const enriched = allPrs.map((pr) => {
        const warehouse = warehouseMap.get(pr.warehouseId)
        const province = provinceMap.get(warehouse?.provinceId)
        const shortName = (warehouse?.name ?? '').replace(/^[A-Z]{2,5}-/, '')
        const wsr = wsrById.get(pr.wsrTransactionId)
        const rsbsa = wsr?.farmerCoops?.length
          ? wsr.farmerCoops.map((m) => m.rsbsa).filter(Boolean).join(' / ') || null
          : (pr.rsbsa || null)
        return {
          ...pr,
          rsbsa,
          warehouseCode: province?.code ? `${province.code}-${shortName}` : shortName,
          wsrSerialNo: wsr?.serialNo ?? '',
        }
      })
      enriched.sort((a, b) => {
        const na = Number(a.prNo)
        const nb = Number(b.prNo)
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
        return (a.prNo ?? '').localeCompare(b.prNo ?? '', undefined, { numeric: true })
      })

      // Opening balance stays the REAL, full pre-period balance,
      // untouched by which PRs are checked - it describes cash carried
      // in from before this document even starts.
      const openingBalance = computeCashOnHand(
        ledgerEntries.filter((e) => e.date < dateFrom),
        activePrsAll.filter((pr) => pr.date < dateFrom).map((pr) => pr.totalAmount ?? 0)
      )
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
      // Per explicit request: the abstract must stay internally
      // consistent with what it actually lists - this total (and every
      // reconciliation line built from it) reflects only the CHECKED
      // PRs, same as the printed table itself, not the real full-period
      // disbursement total.
      const periodTotal = enriched.reduce((s, pr) => s + (pr.totalAmount ?? 0), 0)

      const showReplenishmentDetails = userRecord?.showReplenishmentDetails !== false
      const totalReplenished = uncheckedReplenished + checkedReplenishEntries.reduce((s, e) => s + (e.amount ?? 0), 0)
      const combinedFundBalance = openingBalance + totalReplenished - periodLiquidated

      const doc = generateSdoAbstract({
        branchLabel,
        dateFrom,
        dateTo,
        purchaseReceipts: enriched,
        purityDisplayFormat: config?.purityDisplayFormat ?? 'range',
        reconciliation: showReplenishmentDetails
          ? {
              fundBalanceLabel: 'COH — Fund Balance',
              fundBalance,
              addEntries,
              lessEntries: [{ label: 'This period’s disbursements', amount: periodTotal }],
            }
          : {
              fundBalanceLabel: 'Fund Balance',
              fundBalance: combinedFundBalance,
              addEntries: [],
              lessEntries: [{ label: "LESS: This Period's Replenishment", amount: periodTotal }],
            },
        signatories: {
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
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-app-text">Select Receipts to Export</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Only checked Purchase Receipts print on the abstract.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-4">
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

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {periodPrs.length} receipt{periodPrs.length === 1 ? '' : 's'} in period
            </p>
            {periodPrs.length > 0 && (
              <button type="button" onClick={toggleAll} className="text-xs font-medium text-brand-neon">
                {allChecked ? 'Uncheck all' : 'Check all'}
              </button>
            )}
          </div>

          {periodPrs.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">No Purchase Receipts in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {periodPrs.map((pr) => {
                const checked = checkedIds.has(pr.prId)
                return (
                  <li key={pr.prId}>
                    <button
                      type="button"
                      onClick={() => toggleOne(pr.prId)}
                      className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition-all active:scale-[0.99] ${
                        checked ? 'border-brand-neon/40 bg-brand-neon/5' : 'border-neutral-800 bg-neutral-900'
                      } ${pr.status === 'Cancelled' ? 'opacity-60' : ''}`}
                    >
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-brand-neon bg-brand-neon/20' : 'border-neutral-700'
                      }`}>
                        {checked && <Check size={12} className="text-brand-neon" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="break-words text-sm font-semibold text-app-text">PR {pr.prNo}</span>
                          {pr.status === 'Cancelled' ? (
                            <span className="shrink-0 text-xs font-bold uppercase text-red-400">Cancelled</span>
                          ) : (
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-neon">
                              ₱{(pr.totalAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          )}
                        </span>
                        <span className="block break-words text-xs text-neutral-500">{pr.payeeName || '—'} · {pr.date}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-neutral-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={handleExport} disabled={generating || checkedIds.size === 0}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40">
            {generating ? 'Generating…' : `Export ${checkedIds.size} Selected`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default SelectivePrExportModal
