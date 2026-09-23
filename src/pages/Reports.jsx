// Reports — Phase 8.
//
// Two separate period controls:
//   - Summary period: drives the DailySummaryCard
//   - Statement period: drives the stock/sack transaction list + PDF export
//
// Main tabs: Stocks | Sacks
//   Stocks sub-tabs: Receipts (WSR/WTS) | Issues (WSI/WTS)
//   Sacks sub-tabs: Receipts (ESR) | Issues (ESI)
//
// Tapping a transaction row opens the correct form with that serial number
// pre-loaded into Update/Delete mode — no toast hint, direct navigation.
//
// Export PDF requires both statement dates to be set. Generates the full
// NFA report set for stocks and sacks separately.

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileDown, Loader, CheckCircle2, Camera } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { db } from '../db/dexie.js'
import { generateNfaReport } from '../utils/pdfGenerator.js'
import { fmtBags, fmtWeight, fmtDateForFilename, sanitizeForFilename, todayLocalISO, customerNameWithMillingRef, effectiveCutoffDate } from '../utils/calculations.js'
import { splitStockTransactions } from '../utils/wtsAdapter.js'
import { computeWarehouseStockBalanceAsOf } from '../utils/pileLedger.js'
import DailySummaryCard from '../components/cards/DailySummaryCard.jsx'
import PeriodPresetPicker from '../components/common/PeriodPresetPicker.jsx'
import CalendarDatePicker from '../components/common/CalendarDatePicker.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'

// The Stock/Sack + Receipts/Issues merged segmented control (see its
// render site below) - one entry per combination, in reading order so a
// 2-column mobile grid naturally stacks Stock Receipts/Issues above Sack
// Receipts/Issues.
const REPORT_SEGMENTS = [
  { key: 'stock-receipts', label: 'Stock Receipts', mainTab: 'stocks', subTab: 'receipts' },
  { key: 'stock-issues', label: 'Stock Issues', mainTab: 'stocks', subTab: 'issues' },
  { key: 'sack-receipts', label: 'Sack Receipts', mainTab: 'sacks', subTab: 'receipts' },
  { key: 'sack-issues', label: 'Sack Issues', mainTab: 'sacks', subTab: 'issues' },
]

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })
const bySerial = (a, b) => {
  const n = (x) => parseInt(String(x.serialNo ?? '').replace(/\D/g, ''), 10) || 0
  return n(a) - n(b)
}

// Multi-pile issuances save each additional pile as its own separate,
// linked transaction record (same groupSerialNo, base serial + letter
// suffix - see StockFormBase.jsx's performSave). pdfGenerator.js
// already combines these into one row for the exported PDF; this
// on-screen list never did, so a multi-pile issuance's extra piles
// showed up as their own separately-tappable rows here (each looking
// like an independent, single-pile transaction) - per explicit
// request the -A/-B rows must not show on this page either. Mirrors
// pdfGenerator.js's own grouping exactly, so the two views never
// disagree on what one issuance's real total is. An ordinary
// transaction has no groupSerialNo, so it falls back to its own
// unique id as the key and passes through unaffected, as its own
// single-item group.
// Defensive safeguard against duplicate transaction records - same
// type+warehouseId+serialNo+cerealCategory key already proven correct
// in pdfGenerator.js's addStockStatementPage (that dedup is exactly why
// the exported PDF shows a duplicated record once, while this on-screen
// list, lacking the same guard, showed it twice). A genuine data-level
// duplicate (e.g. a leftover Sheet-import placeholder that never got
// self-healed by findTransactionBySerial - that self-heal only runs
// when a form actually navigates to that exact serial) must never
// render as two separate rows here - the on-screen list and the
// exported PDF must always agree on what exists.
const dedupeTransactions = (transactions) => {
  const seenIds = new Set()
  const dedupedById = transactions.filter((t) => {
    if (seenIds.has(t.id)) return false
    seenIds.add(t.id)
    return true
  })
  const seenByKey = new Map()
  for (const t of dedupedById) {
    // A Cancelled record has nothing left to legitimately distinguish it
    // by category - buildCancelledPayload wipes every content field, and
    // cerealCategory itself may or may not have been preserved depending
    // on when it was voided - so two Cancelled records sharing the same
    // type+warehouse+serial are always the same real document, never a
    // genuine same-number collision between two different series. Only
    // an Active record's category is part of the key, since e.g. Rice
    // #50 and Palay #50 ARE legitimately different real documents that
    // must never be merged.
    const key = t.status === 'Cancelled'
      ? `${t.type}::${t.warehouseId}::${t.serialNo}`
      : `${t.type}::${t.warehouseId}::${t.serialNo}::${t.cerealCategory ?? ''}`
    const existing = seenByKey.get(key)
    // Prefer whichever copy still has a real stored category, so a
    // duplicate pair (one with cerealCategory preserved, one without)
    // doesn't discard the recoverable one by coin-flip array order.
    if (!existing || (!existing.cerealCategory && t.cerealCategory)) {
      seenByKey.set(key, t)
    }
  }
  return [...seenByKey.values()]
}

// A Cancelled record can lose its own cerealCategory (buildCancelledPayload
// nulls it for anything voided before category-preservation existed) - but
// per NFA convention each document type (WSR/WSI/ESR/ESI/WTS) keeps a
// separate, contiguous series PER cereal type within a warehouse (see
// serialNumber.js), so the category is still knowable: whichever real
// category the immediately surrounding serials in this same list belong
// to. `list` must already be sorted by serial (bySerial) and scoped to one
// document type (stockReceipts or stockIssues, never both mixed), since
// that's the actual series boundary - mixing WSR neighbors into a WSI gap
// would infer a category from the wrong series entirely.
const resolveOrphanCategories = (list) => {
  const isKnown = (t) => t.cerealCategory && t.cerealCategory !== 'Unknown'
  return list.map((t, i) => {
    if (isKnown(t)) return t
    let prevCat = null
    for (let j = i - 1; j >= 0; j--) {
      if (isKnown(list[j])) { prevCat = list[j].cerealCategory; break }
    }
    let nextCat = null
    for (let j = i + 1; j < list.length; j++) {
      if (isKnown(list[j])) { nextCat = list[j].cerealCategory; break }
    }
    // Neighbors on both sides agreeing is the strongest signal; only one
    // side present is still far better than a blind guess; disagreeing
    // neighbors (the series genuinely changed category right at this
    // gap) fall through unresolved rather than picking one arbitrarily.
    const resolved = prevCat && nextCat
      ? (prevCat === nextCat ? prevCat : null)
      : (prevCat ?? nextCat)
    return resolved ? { ...t, cerealCategory: resolved } : t
  })
}

const combineMultiPileGroups = (transactions) => {
  const groups = new Map()
  for (const t of transactions) {
    const key = t.groupSerialNo ?? t.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]
    const primary = group.find((t) => t.serialNo === t.groupSerialNo) ?? group[0]
    return {
      ...primary,
      numberOfBags: group.reduce((sum, t) => sum + (t.numberOfBags ?? 0), 0),
      grossKilos: group.reduce((sum, t) => sum + (t.grossKilos ?? 0), 0),
      netKilos: group.reduce((sum, t) => sum + (t.netKilos ?? 0), 0),
    }
  })
}

function Reports() {
  const { user } = useAuth()
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}
  const { weightUnit } = useSettings() ?? {}
  const { setPageHeader } = usePageHeader() ?? {}

  useEffect(() => {
    setPageHeader?.({ title: 'Reports', subtitle: '' })
  }, [])

  const [pageTab, setPageTab] = useState('summary')
  const [mainTab, setMainTab] = useState('stocks')
  const [stockSubTab, setStockSubTab] = useState('receipts')
  const [sackSubTab, setSackSubTab] = useState('receipts')

  // Separate periods
  const today = todayLocalISO()
  const [summaryFrom, setSummaryFrom] = useState(today)
  const [summaryTo, setSummaryTo] = useState(today)
  const summaryToPickerRef = useRef(null)
  const warehouseSectionRef = useRef(null)
  const [stmtFrom, setStmtFrom] = useState('')
  const [stmtTo, setStmtTo] = useState('')
  const stmtToPickerRef = useRef(null)
  const [isExporting, setIsExporting] = useState(false)
  // Concept U (picked) - a brief "Ready" checkmark state after a
  // successful export, instead of snapping straight back to "Export
  // PDF" the instant the file is generated with no visible confirmation
  // on the button itself (only a separate toast).
  const [justExported, setJustExported] = useState(false)
  // Save as image (Summary tab): the actual export logic/canvas ref
  // lives inside DailySummaryCard, triggered imperatively from the
  // button here so it can sit in this page's own header row alongside
  // the period fields, matching the Statement tab's Export PDF button.
  const summaryCardRef = useRef(null)
  const [summaryExporting, setSummaryExporting] = useState(false)

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const txTypes = useLiveQuery(() => db.transactionTypes.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []

  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const txTypeMap = new Map(txTypes.map((t) => [t.transactionTypeId, t]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

  // Stock transactions for the statement period. isInitialBalance
  // transactions (pile beginning-balance seeds) are excluded here — they
  // count toward the beginning-balance figure (see priorStock query
  // below) but must never appear as a visible statement row.
  const stockTxRaw = useLiveQuery(async () => {
    if (!currentWarehouseId || !stmtFrom || !stmtTo) return []
    return db.transactions
      .where('warehouseId').equals(currentWarehouseId)
      .and((t) => ['WSR', 'WSI', 'WTS'].includes(t.type) && (t.status === 'Active' || t.status === 'Cancelled') && !t.isInitialBalance && t.date >= stmtFrom && t.date <= stmtTo)
      .toArray()
  }, [currentWarehouseId, stmtFrom, stmtTo])

  // Sack transactions for the statement period. Same isInitialBalance
  // exclusion as above.
  const sackTxRaw = useLiveQuery(async () => {
    if (!currentWarehouseId || !stmtFrom || !stmtTo) return []
    return db.transactions
      .where('warehouseId').equals(currentWarehouseId)
      .and((t) => ['ESR', 'ESI'].includes(t.type) && (t.status === 'Active' || t.status === 'Cancelled') && !t.isInitialBalance && t.date >= stmtFrom && t.date <= stmtTo)
      .toArray()
  }, [currentWarehouseId, stmtFrom, stmtTo])

  const enrichStock = (t) => ({
    ...t,
    varietyName: varietyMap.get(t.varietyId)?.name ?? '',
    cerealCategory: t.cerealCategory ?? varietyMap.get(t.varietyId)?.category ?? 'Unknown',
    transactionTypeName: txTypeMap.get(t.transactionTypeId)?.name ?? '',
  })

  const enrichSack = (t) => ({
    ...t,
    transactionTypeName: txTypeMap.get(t.transactionTypeId)?.name ?? '',
    enrichedSackLines: (t.sackLines ?? []).map((l) => ({
      ...l,
      code: sackTypeMap.get(l.sackTypeId)?.code ?? '?',
    })),
  })

  const { receipts: rawStockReceipts, issues: rawStockIssues } = splitStockTransactions(dedupeTransactions(stockTxRaw ?? []))
  // Both receipts and issues can be multi-pile (WSR "receive to another
  // pile" and WSI "issue from another pile" - both share the same
  // extraPileAllocations mechanism in StockFormBase.jsx, see
  // combineMultiPileGroups) - applying this to both here regardless is
  // also harmless for an ordinary single-pile transaction, since it has
  // no groupSerialNo and passes through as its own single-item group.
  // resolveOrphanCategories runs per document type (receipts vs issues
  // built and sorted separately above) since that's the real series
  // boundary - a WSR's series never informs a WSI's gap, and vice versa.
  const stockReceipts = resolveOrphanCategories(combineMultiPileGroups(rawStockReceipts).map(enrichStock).sort(bySerial))
  const stockIssues = resolveOrphanCategories(combineMultiPileGroups(rawStockIssues).map(enrichStock).sort(bySerial))
  const dedupedSackTx = dedupeTransactions(sackTxRaw ?? [])
  const sackReceipts = dedupedSackTx.filter((t) => t.type === 'ESR').map(enrichSack).sort(bySerial)
  const sackIssues = dedupedSackTx.filter((t) => t.type === 'ESI').map(enrichSack).sort(bySerial)

  const currentStockList = stockSubTab === 'receipts' ? stockReceipts : stockIssues
  const currentSackList = sackSubTab === 'receipts' ? sackReceipts : sackIssues
  const currentList = mainTab === 'stocks' ? currentStockList : currentSackList

  // Group by cereal type → variety (for stocks) or by transaction type → sack type (for sacks)
  //
  // Same fix as pdfGenerator.js's generateNfaReport - a series/serial
  // number belongs permanently to one cereal type, so a Cancelled
  // record's own stored cerealCategory (enrichStock above only coerces
  // it to the literal 'Unknown' string when nothing real was ever
  // stored) is always the correct group, even if this exact tab/period
  // has no OTHER Active activity of that same type - it must never be
  // reassigned to whichever real category happens to have the most
  // activity here. Only a genuinely orphaned record (no real category
  // ever stored - enriched down to 'Unknown') has no recoverable true
  // answer and still gets the closest-real-group guess below, visually
  // marked as cancelled (red border, dimmed) by the row itself so it's
  // never mistaken for a genuine, confirmed entry of that category.
  const groupStock = (txList) => {
    const counts = new Map()
    for (const t of txList) {
      if (t.cerealCategory !== 'Unknown') counts.set(t.cerealCategory, (counts.get(t.cerealCategory) ?? 0) + 1)
    }
    const fallbackCat = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const effectiveCat = (t) => (t.cerealCategory !== 'Unknown' ? t.cerealCategory : (fallbackCat ?? t.cerealCategory))

    const groups = {}
    for (const t of txList) {
      const cat = effectiveCat(t)
      const variety = t.varietyName || '—'
      if (!groups[cat]) groups[cat] = {}
      if (!groups[cat][variety]) groups[cat][variety] = []
      groups[cat][variety].push(t)
    }
    return groups
  }

  const groupSack = (txList) => {
    const groups = {}
    for (const t of txList) {
      const txType = t.transactionTypeName || '—'
      if (!groups[txType]) groups[txType] = []
      groups[txType].push(t)
    }
    return groups
  }

  const handleStockRowTap = (t) => {
    if (typeof window.openTransactionForm === 'function') {
      window.openTransactionForm(t.type, { serialNo: t.serialNo })
    }
  }

  const handleSackRowTap = (t) => {
    if (typeof window.openTransactionForm === 'function') {
      window.openTransactionForm(t.type, { serialNo: t.serialNo })
    }
  }

  const handleExportPdf = async () => {
    if (!stmtFrom || !stmtTo) {
      toast.error('Set the Statement period (From and To) before exporting')
      return
    }

    setIsExporting(true)
    try {
      const province = currentWarehouse?.provinceId
        ? await db.provinces.get(currentWarehouse.provinceId)
        : null
      const branch = province?.branchId ? await db.branches.get(province.branchId) : null
      const reportConfig = await db.reportConfig.get('global')
      const supervisorSignatory = user ? await db.signatories.get(user.uid) : null

      const certifiedCorrect = {
        name: user?.name ?? '',
        position: supervisorSignatory?.certifiedCorrectPosition ?? '',
      }
      const signatories = {
        verifiedCorrect: reportConfig?.verifiedCorrect ?? [],
        auditedByName: reportConfig?.auditedByName ?? '',
        auditedByPosition: reportConfig?.auditedByPosition ?? '',
        notedByName: reportConfig?.notedByName ?? '',
        notedByPosition: reportConfig?.notedByPosition ?? '',
      }

      // Compute beginning balances for stocks. Beginning balance for a
      // period is the sum of every WSR/WSI/WTS transaction (seed or
      // real) dated before the period starts, grouped by variety+
      // condition - simple addition/subtraction, no per-pile matching.
      //
      // reportingCutoffDate is an explicit, admin-set date on the
      // warehouse record (Settings > Warehouses) - not derived from
      // pile data at all, unlike three earlier attempts that all
      // failed because they depended on db.piles records reliably
      // matching real historical data, which real, years-old imported
      // data does not guarantee. Any non-seed transaction dated on or
      // before this explicit date is excluded from every report - the
      // seed itself always counts regardless, since it represents the
      // confirmed truth as of that date. This only affects what
      // reports display; serial-number checks and other form-level
      // lookups query transactions directly and are entirely
      // unaffected by this report-only filter.
      const globalDataStartDate = (await db.reportConfig.get('global'))?.dataStartDate || null
      const reportingCutoffDate = effectiveCutoffDate(currentWarehouse?.reportingCutoffDate, globalDataStartDate)
      const warehousePiles = await db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
      // Pile-based MTS fallback for display-grouping purposes only -
      // many transactions (especially older/imported ones) have their
      // own mtsSackTypeId/mtsCondition unset even though the pile they
      // belong to has a properly configured one. Without this, such a
      // transaction would incorrectly group as a separate, unlabeled
      // "no weight" bucket instead of correctly merging with the
      // pile's actual, real weight. This has no effect on the rolling-
      // balance cutoff logic above or anywhere else - purely used to
      // pick the correct weight label.
      const pileMtsById = new Map(
        warehousePiles.map((p) => [p.pileId, { mtsSackTypeId: p.mtsSackTypeId, mtsCondition: p.mtsCondition }])
      )
      // Beginning AND Ending Balance both come from ONE canonical function
      // now (computeWarehouseStockBalanceAsOf, pileLedger.js) - called
      // twice, once for the day before this period starts and once for
      // the period's own last day. Per confirmed root-cause investigation:
      // these two numbers used to come from separately hand-written code
      // (this file's own transaction sum for Beginning, vs "Beginning +
      // this period's receipts - issues" arithmetic for Ending), and
      // could silently disagree - a real, reported case where a whole
      // week's real issuance vanished from the very next period's
      // Beginning Balance because that hand-written sum checked whether
      // each transaction's pile still existed in db.piles today (to
      // avoid a deleted test pile's phantom seed inflating balances
      // forever) while nothing else in the report applied that same
      // check. computeWarehouseStockBalanceAsOf has no such check at all
      // - a deleted pile's real history still counts (deletion isn't a
      // statement that stock movement never happened), while a pile that
      // was deliberately CLOSED still correctly writes off its balance
      // from its own closedDate forward, because the function is built
      // entirely on computePileStockBreakdown, the same already-proven
      // per-pile logic Pile List/Home Stocks already use - not a second,
      // independent implementation that could drift from it.
      const dayBefore = (isoDate) => {
        const d = new Date(`${isoDate}T00:00:00`)
        d.setDate(d.getDate() - 1)
        return d.toISOString().slice(0, 10)
      }
      const groupStockBalanceByCategory = (flatGroups) => {
        const byCategory = new Map()
        for (const g of flatGroups) {
          const variety = varietyMap.get(g.varietyId)
          if (!variety) continue
          const key = `${g.varietyId}::${g.condition}::${g.weight ?? ''}`
          if (!byCategory.has(variety.category)) byCategory.set(variety.category, new Map())
          byCategory.get(variety.category).set(key, { bags: g.bags, kilos: g.kilos })
        }
        return byCategory
      }
      const [stockBeginningGroups, stockEndingGroups] = await Promise.all([
        computeWarehouseStockBalanceAsOf(currentWarehouseId, dayBefore(stmtFrom), { warehouse: currentWarehouse, sackTypes }),
        computeWarehouseStockBalanceAsOf(currentWarehouseId, stmtTo, { warehouse: currentWarehouse, sackTypes }),
      ])
      const stockBeginningBals = groupStockBalanceByCategory(stockBeginningGroups)
      const stockEndingBals = groupStockBalanceByCategory(stockEndingGroups)

      // Compute beginning balances for sacks - same model as stocks
      // above: everything (seed or real) dated before the period
      // starts, summed by sackTypeId+condition, with the same explicit
      // reportingCutoffDate excluding real (non-seed) activity dated
      // on/before it.
      const sackBeginningBals = new Map()
      const sackInventorySeed = await db.sackInventory
        .where('warehouseId').equals(currentWarehouseId)
        .toArray()
      for (const rec of sackInventorySeed) {
        if (rec.asOfDate && rec.asOfDate > stmtFrom) continue
        const key = `${rec.sackTypeId}::${rec.condition}`
        sackBeginningBals.set(key, (sackBeginningBals.get(key) ?? 0) + (rec.pieces ?? 0))
      }
      const priorSack = (await db.transactions
        .where('warehouseId').equals(currentWarehouseId)
        .and((t) => ['ESR', 'ESI'].includes(t.type) && t.status === 'Active' && t.date < stmtFrom)
        .toArray())
        .filter((t) => !reportingCutoffDate || t.date > reportingCutoffDate)
      for (const t of priorSack) {
        for (const l of (t.sackLines ?? [])) {
          const sType = sackTypeMap.get(l.sackTypeId)
          if (!sType) continue
          const key = `${l.sackTypeId}::${l.condition}`
          const sign = t.type === 'ESI' ? -1 : 1
          sackBeginningBals.set(key, (sackBeginningBals.get(key) ?? 0) + (l.pieces ?? 0) * sign)
        }
      }

      const doc = generateNfaReport({
        warehouse: currentWarehouse,
        province,
        branch,
        dateFrom: stmtFrom,
        dateTo: stmtTo,
        receipts: stockReceipts,
        issues: stockIssues,
        sackReceipts: sackReceipts.map(enrichSack),
        sackIssues: sackIssues.map(enrichSack),
        stockBeginningBals,
        stockEndingBals,
        sackBeginningBals,
        signatories,
        certifiedCorrect,
        varieties,
        sackTypes,
        sackTypeMap,
        pileMtsById,
      })

      const filename = `${sanitizeForFilename(currentWarehouse?.name) || 'WH'}-StockReport-${fmtDateForFilename(stmtFrom)}-${fmtDateForFilename(stmtTo)}.pdf`
      doc.save(filename)
      toast.success('PDF exported')
      setJustExported(true)
      setTimeout(() => setJustExported(false), 1600)
    } catch (err) {
      console.error('PDF export error:', err)
      toast.error('PDF export failed — check console')
    } finally {
      setIsExporting(false)
    }
  }

  const needsDates = !stmtFrom || !stmtTo
  const stockGroups = groupStock(currentStockList)
  const sackGroups = groupSack(currentSackList)

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
      <div ref={warehouseSectionRef}>
        {sortedWarehouses.length > 1 ? (
          <div className="mt-4">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</label>
            <select
              value={currentWarehouseId ?? ''}
              onChange={(e) => setCurrentWarehouseId(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-3 text-base font-semibold text-app-text outline-none focus:border-brand-neon"
            >
              {sortedWarehouses.map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : currentWarehouse ? (
          <div className="mt-4 rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</p>
            <p className="text-base font-bold text-app-text">
              {currentWarehouse.code} — {currentWarehouse.name}
            </p>
          </div>
        ) : null}
      </div>
      <StickyWarehouseIndicator targetRef={warehouseSectionRef} warehouse={currentWarehouse} />

      {/* Page-level Summary / Stock Statement tabs - kept as two fully
          separate views (not one long scroll) per explicit request, so
          each reads as its own report rather than one crowded page. */}
      <div className="relative mt-5 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: pageTab === 'summary' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {[{ id: 'summary', label: 'Summary' }, { id: 'statement', label: 'Stock Statement' }].map((t) => (
          <button key={t.id} type="button" onClick={() => setPageTab(t.id)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-base transition-all active:scale-95 ${
              pageTab === t.id ? 'font-extrabold text-brand-contrast' : 'font-semibold text-neutral-400 hover:text-app-text'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Summary period ─────────────────────────────────────────────── */}
      {/* Both tab panels stay mounted (visibility toggled via `hidden`,
          not conditional rendering) - switching tabs re-mounting
          DailySummaryCard's useLiveQuery would otherwise briefly flash
          an empty state, same fix applied elsewhere this session.
          animate-flow-down is unconditional (not retriggered via a key)
          - toggling `hidden` (display:none) already resets a CSS
          animation on its own, so it replays every time this panel
          becomes visible again without needing to remount anything. */}
      <div className={`mt-5 animate-flow-down ${pageTab === 'summary' ? '' : 'hidden'}`}>
        {/* True two-column 50/50 split from the lg breakpoint up, per
            explicit request - date fields in the first half, Save as
            image in the second - stacked on narrow screens. */}
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-end lg:gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">From</label>
              <CalendarDatePicker
                value={summaryFrom}
                label="Start Date"
                onChange={(iso) => { setSummaryFrom(iso); summaryToPickerRef.current?.open() }}
                valueClassName="text-base font-semibold"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">To</label>
              <CalendarDatePicker ref={summaryToPickerRef} value={summaryTo} label="End Date" onChange={setSummaryTo} valueClassName="text-base font-semibold" />
            </div>
          </div>
          {/* w-full (was a narrow button anchored right inside this
              column) - per explicit request, it fills the whole half
              instead of leaving empty space beside it. */}
          <button type="button" onClick={() => summaryCardRef.current?.exportImage()}
            disabled={summaryExporting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-neon px-5 py-2.5 text-sm font-bold text-neutral-950 shadow-lg shadow-brand-neon/20 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:shadow-none">
            {summaryExporting ? <Loader size={15} className="animate-spin" /> : <Camera size={15} />}
            {summaryExporting ? 'Exporting…' : 'Save as image'}
          </button>
        </div>
        <div className="mt-3">
          <PeriodPresetPicker onSelectRange={(from, to) => { setSummaryFrom(from); setSummaryTo(to) }} currentFrom={summaryFrom} currentTo={summaryTo} />
        </div>
        <div key={currentWarehouseId} className="animate-pop-in">
          <DailySummaryCard ref={summaryCardRef} dateFrom={summaryFrom} dateTo={summaryTo} onExportingChange={setSummaryExporting} />
        </div>
      </div>

      {/* ── Stock Statement ─────────────────────────────────────────────── */}
      <div className={`mt-5 animate-flow-down ${pageTab === 'statement' ? '' : 'hidden'}`}>
        {/* Same true 50/50 two-column split as the Summary tab above. */}
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-end lg:gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Period From *</label>
              <CalendarDatePicker
                value={stmtFrom}
                label="Start Date"
                onChange={(iso) => { setStmtFrom(iso); stmtToPickerRef.current?.open() }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Period To *</label>
              <CalendarDatePicker ref={stmtToPickerRef} value={stmtTo} label="End Date" onChange={setStmtTo} />
            </div>
          </div>
          <button type="button" onClick={handleExportPdf}
            disabled={isExporting || needsDates}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-neon px-5 py-2.5 text-sm font-bold text-neutral-950 shadow-lg shadow-brand-neon/20 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:shadow-none">
            {isExporting ? (
              <Loader size={15} className="animate-spin" />
            ) : justExported ? (
              <CheckCircle2 size={15} className="animate-toast-icon-check" />
            ) : (
              <FileDown size={15} />
            )}
            {isExporting ? 'Building…' : justExported ? 'Ready' : 'Export PDF'}
          </button>
        </div>

        <div className="mt-3">
          <PeriodPresetPicker onSelectRange={(from, to) => { setStmtFrom(from); setStmtTo(to) }} currentFrom={stmtFrom} currentTo={stmtTo} />
        </div>
        {needsDates && (
          <p className="mt-1 text-xs text-brand-amber">
            Both dates required to view transactions and export PDF.
          </p>
        )}

        {/* Stock/Sack type and Receipts/Issues direction used to be two
            separate stacked rows - really one choice ("which list am I
            looking at"), not two sequential decisions - so they're one
            merged 4-way segmented control. 2 columns on narrow screens
            (Stock Receipts/Issues on top, Sack Receipts/Issues below),
            4 across from the sm breakpoint up where there's room. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {REPORT_SEGMENTS.map((seg) => {
            const active = mainTab === seg.mainTab && (mainTab === 'stocks' ? stockSubTab : sackSubTab) === seg.subTab
            return (
              <button key={seg.key} type="button"
                onClick={() => {
                  setMainTab(seg.mainTab)
                  if (seg.mainTab === 'stocks') setStockSubTab(seg.subTab)
                  else setSackSubTab(seg.subTab)
                }}
                className={`rounded-xl border py-2.5 text-sm font-bold transition-all active:scale-95 ${
                  active
                    ? 'border-brand-neon bg-brand-neon/10 text-brand-neon'
                    : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-app-text'
                }`}>
                {seg.label}
              </button>
            )
          })}
        </div>

        {/* Transaction list */}
        <div className="mt-3 animate-flow-down" key={`${mainTab === 'stocks' ? stockSubTab : sackSubTab}-${stmtFrom}-${stmtTo}`}>
          {!stmtFrom || !stmtTo ? null : currentList.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-600">
              No {mainTab === 'stocks' ? stockSubTab : sackSubTab} in this period.
            </p>
          ) : mainTab === 'stocks' ? (
            Object.entries(stockGroups).sort().map(([cerealType, byVariety]) => (
              <div key={cerealType} className="mb-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-neutral-500">{cerealType}</p>
                {Object.entries(byVariety).sort().map(([varietyName, rows]) => (
                  <div key={varietyName} className="mb-3">
                    <p className="mb-1.5 text-xs font-medium text-neutral-400">{varietyName}</p>
                    <ul className="space-y-2">
                      {rows.map((t) => {
                        const isCancelled = t.status === 'Cancelled'
                        return (
                        <li key={t.id}>
                          <button type="button" onClick={() => handleStockRowTap(t)}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-all active:scale-[0.99] ${
                              isCancelled
                                ? 'border-red-400/40 bg-red-400/5 opacity-60 hover:border-red-400/60'
                                : 'border-neutral-800 bg-neutral-900 hover:border-brand-neon/40'
                            }`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-bold text-app-text">{t.serialNo}</span>
                                  <span className="text-xs text-neutral-500">{t.date}</span>
                                  {!isCancelled && (
                                    <span className="text-xs tabular-nums text-neutral-500">MC {t.moistureContent ?? '—'}%</span>
                                  )}
                                  {!isCancelled && (t.type === 'WSI' || t.wtsSide === 'issued') && (t.aiNumber || t.linkedDocNo) && (
                                    <span className="rounded bg-brand-neon/10 px-2 py-0.5 text-xs font-semibold text-brand-neon">
                                      AI {t.aiNumber || t.linkedDocNo}
                                    </span>
                                  )}
                                  {!isCancelled && t.type === 'WSR' && t.linkedDocNo && (
                                    <span className="rounded bg-brand-amber/10 px-2 py-0.5 text-xs font-semibold text-brand-amber">
                                      WSI {t.linkedDocNo}
                                    </span>
                                  )}
                                </div>
                                {/* A cancelled record's own detail fields
                                    (customer/AI/variety/etc.) are wiped at
                                    void time, on purpose - showing "CANCELLED"
                                    here instead of trying to fill in blanks
                                    matches the exported Statement's own
                                    treatment of the same row. */}
                                {isCancelled ? (
                                  <p className="mt-0.5 text-sm font-semibold text-red-400">CANCELLED</p>
                                ) : (
                                  <>
                                    <p className="mt-0.5 truncate text-sm font-medium text-app-text">
                                      {customerNameWithMillingRef(t.customerName, t.transactionTypeName, t.batchNumber, t.trialNumber)}
                                    </p>
                                    <p className="text-xs text-neutral-500">{t.transactionTypeName} · {t.condition}</p>
                                  </>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                {isCancelled ? (
                                  <p className="text-lg font-bold tabular-nums text-neutral-600">—</p>
                                ) : (
                                  <>
                                    <p className="text-lg font-bold tabular-nums text-app-text">{fmtBags(t.numberOfBags)}</p>
                                    <p className="text-xs tabular-nums text-neutral-400">Net {fmtWeight(t.netKilos, weightUnit)}</p>
                                  </>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            ))
          ) : (
            Object.entries(sackGroups).sort().map(([txTypeName, rows]) => (
              <div key={txTypeName} className="mb-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-neutral-500">{txTypeName}</p>
                <ul className="space-y-2">
                  {rows.map((t) => {
                    const totalPieces = (t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0)
                    return (
                      <li key={t.id}>
                        <button type="button" onClick={() => handleSackRowTap(t)}
                          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-left transition-all hover:border-brand-neon/40 active:scale-[0.99]">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm font-bold text-app-text">{t.serialNo}</span>
                                <span className="text-xs text-neutral-500">{t.date}</span>
                                {t.transactionTypeName && (
                                  <span className="text-xs text-neutral-400">{t.transactionTypeName}</span>
                                )}
                                {t.type === 'ESI' && (t.siaNumber || t.linkedDocNo) && (
                                  <span className="rounded bg-brand-neon/10 px-2 py-0.5 text-xs font-semibold text-brand-neon">
                                    SIA {t.siaNumber || t.linkedDocNo}
                                  </span>
                                )}
                                {t.type === 'ESR' && t.linkedDocNo && (
                                  <span className="rounded bg-brand-amber/10 px-2 py-0.5 text-xs font-semibold text-brand-amber">
                                    ESI {t.linkedDocNo}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-sm font-medium text-app-text">
                                {customerNameWithMillingRef(t.customerName, t.transactionTypeName, t.batchNumber, t.trialNumber)}
                              </p>
                              <div className="flex flex-wrap gap-1.5 mt-0.5">
                                {(t.enrichedSackLines ?? []).map((l, i) => (
                                  <span key={i} className="text-xs tabular-nums text-neutral-500">
                                    {l.code}/{l.condition}: {fmtBags(l.pieces ?? 0)}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-lg font-bold tabular-nums text-app-text">{fmtBags(totalPieces)}</p>
                              <p className="text-xs text-neutral-400">pieces</p>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default Reports
