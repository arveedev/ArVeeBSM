// Abstract of Cereal Purchases export — free period (no preset range),
// same idea as the existing Stock Statement export on Reports.jsx.
//
// Optional receipt checklist, per explicit request/correction: a
// checklist icon inside THIS same modal (not a separate button/modal,
// as a first pass wrongly built it) reveals every real Purchase
// Receipt in the CURRENT dateFrom/dateTo already set here - so the
// checklist's own basis is always this modal's own period, never an
// independent one. All checked by default (matches the plain export's
// own "everything in the period" behavior); unchecking narrows what
// actually prints. When the checklist has never been opened, export
// behaves exactly as it always did - the checklist is purely additive.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X, ListChecks, Check } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { generateSdoAbstract } from '../../../utils/sdoAbstractPdfGenerator.js'
import { computeCashOnHand } from '../../../utils/sdoCalculations.js'

// Shared numeric-then-string PR Number comparator - same rule the
// printed table itself uses (a free-typed string field, so a plain
// number compare is tried first, falling back to a numeric-aware
// string compare for anything that doesn't parse cleanly).
const byPrNo = (a, b) => {
  const na = Number(a.prNo)
  const nb = Number(b.prNo)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return (a.prNo ?? '').localeCompare(b.prNo ?? '', undefined, { numeric: true })
}

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
  const [showChecklist, setShowChecklist] = useState(false)
  const [checkedIds, setCheckedIds] = useState(() => new Set())

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Only queried for the checklist display - the export itself always
  // re-fetches its own copy inside handleExport, same as before the
  // checklist existed, so a stale live-query snapshot can never affect
  // what actually gets printed. Same PR scope as the export's own fetch
  // below - Active AND Cancelled (a void still explains a gap in the PR
  // Number sequence).
  const periodPrs = useLiveQuery(async () => {
    if (!showChecklist || !user?.uid || !dateFrom || !dateTo) return []
    const prs = await db.purchaseReceipts
      .where('sdoUid').equals(user.uid)
      .and((pr) => (pr.status === 'Active' || pr.status === 'Cancelled') && pr.date >= dateFrom && pr.date <= dateTo)
      .toArray()
    return [...prs].sort(byPrNo)
  }, [showChecklist, user?.uid, dateFrom, dateTo]) ?? []

  // Defaults every PR in the CURRENT period to checked whenever the
  // checklist is opened or the period actually changes while it's open
  // - re-keyed on the real set of ids rather than the array reference,
  // so an unrelated re-render (a live sync write touching some OTHER
  // field) doesn't reset a selection the SDO already made.
  const periodPrIdsKey = periodPrs.map((pr) => pr.prId).sort().join(',')
  useEffect(() => {
    if (showChecklist) setCheckedIds(new Set(periodPrs.map((pr) => pr.prId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChecklist, periodPrIdsKey])

  const toggleOne = (prId) => setCheckedIds((prev) => {
    const next = new Set(prev)
    if (next.has(prId)) next.delete(prId); else next.add(prId)
    return next
  })
  const allChecked = periodPrs.length > 0 && checkedIds.size === periodPrs.length
  const toggleAll = () => setCheckedIds(allChecked ? new Set() : new Set(periodPrs.map((pr) => pr.prId)))

  const handleExport = async () => {
    if (showChecklist && checkedIds.size === 0) {
      toast.error('Check at least one Purchase Receipt to export')
      return
    }
    setGenerating(true)
    try {
      const [allPrsRaw, warehouses, provinces, branches, config, ledgerEntries, activePrsAll] = await Promise.all([
        // Per explicit request, a Cancelled PR (voided after issuance, or
        // pre-registered as a skipped series number with no real WSR
        // behind it - see VoidPrModal.jsx) still appears on the export,
        // so a gap in the PR Number sequence is always explained rather
        // than silently missing.
        db.purchaseReceipts.where('sdoUid').equals(user.uid).and((pr) => (pr.status === 'Active' || pr.status === 'Cancelled') && pr.date >= dateFrom && pr.date <= dateTo).toArray(),
        db.warehouses.toArray(),
        db.provinces.toArray(),
        db.branches.toArray(),
        db.reportConfig.get('global'),
        db.cashLedgerV2.where('sdoUid').equals(user.uid).toArray(),
        db.purchaseReceipts.where('[sdoUid+status]').equals([user.uid, 'Active']).toArray(),
      ])

      // Narrowed to the checked subset only when the checklist was
      // actually engaged - untouched (every PR in the period) when it
      // never was, so plain export behaves exactly as it always did.
      const allPrs = showChecklist ? allPrsRaw.filter((pr) => checkedIds.has(pr.prId)) : allPrsRaw

      if (allPrs.length === 0) {
        toast.error(showChecklist ? 'No checked Purchase Receipts to export' : 'No Purchase Receipts in this period')
        return
      }

      const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
      const provinceMap = new Map(provinces.map((p) => [p.provinceId, p]))
      const branchMap = new Map(branches.map((b) => [b.branchId, b]))
      // Skips past a void-placeholder Cancelled PR (no real warehouseId)
      // that might happen to sort first, so the letterhead still resolves
      // from the first PR that actually has one.
      const firstWarehouse = warehouseMap.get(allPrs.find((pr) => pr.warehouseId)?.warehouseId)
      const branch = branchMap.get(provinceMap.get(firstWarehouse?.provinceId)?.branchId)
      const branchLabel = branch ? `${branch.name}${branch.address ? ' · ' + branch.address : ''}` : ''
      // A void-placeholder Cancelled PR (see VoidPrModal.jsx) has no real
      // WSR behind it - wsrTransactionId is null, which Dexie's .anyOf()
      // can't take as a key, so it's filtered out before the lookup.
      const wsrIds = allPrs.map((pr) => pr.wsrTransactionId).filter(Boolean)
      const wsrs = wsrIds.length > 0 ? await db.transactions.where('id').anyOf(wsrIds).toArray() : []
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
        // Confirmed, reported real bug: a PR issued before resolvedRsbsa
        // existed can have a stale/WRONG value already sitting in
        // pr.rsbsa (e.g. a single value typed in before FA's RSBSA field
        // was hidden) - falling back to it only when EMPTY isn't enough,
        // since a wrong-but-non-empty value would still win. Whenever
        // the underlying WSR is genuinely FA (has farmerCoops), this
        // always recomputes every member's own RSBSA fresh, "/"-joined,
        // overriding whatever pr.rsbsa happens to hold - only an
        // Individual transaction (no farmerCoops) ever falls back to
        // pr.rsbsa itself.
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
      // Per explicit request: rows print sorted ascending by PR Number.
      enriched.sort(byPrNo)

      // Opening balance stays the REAL, full pre-period balance,
      // untouched by which PRs are checked - it describes cash carried
      // in from before this document even starts.
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
      // Per explicit request: when the checklist narrowed the printed
      // rows, this total (and every reconciliation line built from it)
      // must reflect that SAME checked subset - not the real full-period
      // disbursement total - so the abstract stays internally
      // consistent with what it actually lists.
      const periodTotal = enriched.reduce((s, pr) => s + (pr.totalAmount ?? 0), 0)

      // Per explicit request: an SDO-personal toggle (Settings page,
      // showReplenishmentDetails on their own user record - defaults
      // true) for how the Cash Reconciliation box reads. ON keeps
      // today's shape (COH — Fund Balance, each checked replenishment
      // as its own line, a running TOTAL, then "This period's
      // disbursements" and a final TOTAL) exactly as-is. OFF collapses
      // the whole COH/replenishment breakdown into one combined "Fund
      // Balance" figure (same underlying math - openingBalance + EVERY
      // replenishment, checked or not, minus periodLiquidated - just
      // not broken out line by line) and relabels the deduction line to
      // "This Period's Replenishment". Both figures are identical
      // either way; only what's shown/labeled changes.
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
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Export Abstract of Cereal Purchases</h2>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Checklist toggle, per explicit request/correction - lives
                inside this same modal (not a separate button/modal), so
                its own PR list is always based on THIS modal's own
                dateFrom/dateTo, never an independent period. */}
            <button
              type="button"
              onClick={() => setShowChecklist((v) => !v)}
              aria-label="Choose specific receipts to export"
              aria-pressed={showChecklist}
              className={`rounded-lg p-1.5 transition-colors ${showChecklist ? 'bg-brand-neon/15 text-brand-neon' : 'bg-neutral-900 text-neutral-400 hover:text-app-text'}`}
            >
              <ListChecks size={18} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
          </div>
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

          {showChecklist && (
            <div className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
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
                <p className="py-4 text-center text-xs text-neutral-500">No Purchase Receipts in this period.</p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {periodPrs.map((pr) => {
                    const checked = checkedIds.has(pr.prId)
                    return (
                      <li key={pr.prId}>
                        <button
                          type="button"
                          onClick={() => toggleOne(pr.prId)}
                          className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition-all active:scale-[0.99] ${
                            checked ? 'border-brand-neon/40 bg-brand-neon/5' : 'border-neutral-800 bg-neutral-950'
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
          )}

          <button type="button" onClick={handleExport} disabled={generating || (showChecklist && checkedIds.size === 0)}
            className="w-full rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40">
            {generating ? 'Generating…' : showChecklist ? `Export ${checkedIds.size} Selected` : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default AbstractExportModal
