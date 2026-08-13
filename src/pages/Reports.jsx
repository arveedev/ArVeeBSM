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
import { FileDown, Loader } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { db } from '../db/dexie.js'
import { generateNfaReport } from '../utils/pdfGenerator.js'
import { fmtBags, fmtWeight, fmtDateForFilename, sanitizeForFilename, todayLocalISO } from '../utils/calculations.js'
import { splitStockTransactions } from '../utils/wtsAdapter.js'
import DailySummaryCard from '../components/cards/DailySummaryCard.jsx'
import PeriodPresetPicker from '../components/common/PeriodPresetPicker.jsx'
import CalendarDatePicker from '../components/common/CalendarDatePicker.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })
const bySerial = (a, b) => {
  const n = (x) => parseInt(String(x.serialNo ?? '').replace(/\D/g, ''), 10) || 0
  return n(a) - n(b)
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

  const { receipts: rawStockReceipts, issues: rawStockIssues } = splitStockTransactions(stockTxRaw ?? [])
  const stockReceipts = rawStockReceipts.map(enrichStock).sort(bySerial)
  const stockIssues = rawStockIssues.map(enrichStock).sort(bySerial)
  const sackReceipts = (sackTxRaw ?? []).filter((t) => t.type === 'ESR').map(enrichSack).sort(bySerial)
  const sackIssues = (sackTxRaw ?? []).filter((t) => t.type === 'ESI').map(enrichSack).sort(bySerial)

  const currentStockList = stockSubTab === 'receipts' ? stockReceipts : stockIssues
  const currentSackList = sackSubTab === 'receipts' ? sackReceipts : sackIssues
  const currentList = mainTab === 'stocks' ? currentStockList : currentSackList

  // Group by cereal type → variety (for stocks) or by transaction type → sack type (for sacks)
  const groupStock = (txList) => {
    const groups = {}
    for (const t of txList) {
      const cat = t.cerealCategory
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

      // Compute beginning balances for stocks. isInitialBalance seed
      // transactions always count toward beginning balance regardless of
      // date - they represent stock that existed before the app was used
      // for that pile, so date-gating them the same as real transactions
      // means a pile created on or after stmtFrom silently loses its seed
      // (excluded from the statement AND excluded from the beginning
      // balance - counted nowhere).
      //
      // Every other, non-seed transaction is only counted if it's dated
      // strictly AFTER ITS OWN PILE's beginning-balance date - CRITICAL
      // FIX: an earlier version used a single cutoff for the whole
      // warehouse (the latest dateOfReceipt across every pile), which
      // had a severe bug - creating even one new pile later would push
      // that cutoff forward for the entire warehouse, silently
      // excluding real, already-accumulated activity for every OTHER,
      // unrelated pile whose own beginning balance was established
      // much earlier. This is the confirmed direct cause of a
      // "beginning balance never rolls forward day to day" report -
      // the rolling balance appeared stuck because unrelated pile
      // creation elsewhere kept resetting the effective cutoff for
      // everything. Now compares each transaction against its own
      // specific pile's own dateOfReceipt instead, so one pile's
      // rolling balance is never affected by another pile's history.
      // A transaction whose pile cannot be resolved to a current one
      // is still excluded by default (not included) - there's no
      // beginning-balance date to compare it against at all, and this
      // is what originally fixed the separate, still-valid "PD"
      // orphaned phantom-data bug.
      const pilesInWarehouse = await db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
      const pileExistsById = new Set(pilesInWarehouse.map((p) => p.pileId))
      const pileDateOfReceiptById = new Map(pilesInWarehouse.map((p) => [p.pileId, p.dateOfReceipt]))
      const stockBeginningBals = new Map()
      const priorStockRaw = (await db.transactions
        .where('warehouseId').equals(currentWarehouseId)
        .and((t) => ['WSR', 'WSI', 'WTS'].includes(t.type) && t.status === 'Active' &&
          (t.isInitialBalance || t.date < stmtFrom))
        .toArray())
        .filter((t) => {
          if (t.isInitialBalance) return true // the seed itself always counts, regardless of date
          if (!pileExistsById.has(t.pileId)) return false // pile genuinely doesn't exist anymore - excluded, matching the original "PD" phantom-data fix
          const pileDate = pileDateOfReceiptById.get(t.pileId)
          if (!pileDate) return true // pile exists but has no beginning-balance date set at all - include, don't silently drop real activity for a real, current pile
          return t.date > pileDate
        })
      const { receipts: priorReceipts, issues: priorIssues } = splitStockTransactions(priorStockRaw)
      const addToBeginningBal = (t, sign) => {
        const variety = varietyMap.get(t.varietyId)
        if (!variety) return
        const cat = variety.category
        const mtsWeight = sackTypeMap.get(t.mtsSackTypeId)?.weights?.[t.mtsCondition] ?? null
        const key = `${t.varietyId}::${t.condition}::${mtsWeight ?? ''}`
        if (!stockBeginningBals.has(cat)) stockBeginningBals.set(cat, new Map())
        const catMap = stockBeginningBals.get(cat)
        const cur = catMap.get(key) ?? { bags: 0, kilos: 0 }
        catMap.set(key, {
          bags: cur.bags + (t.numberOfBags ?? 0) * sign,
          kilos: cur.kilos + (t.netKilos ?? 0) * sign,
        })
      }
      for (const t of priorReceipts) addToBeginningBal(t, 1)
      for (const t of priorIssues) addToBeginningBal(t, -1)

      // Compute beginning balances for sacks. Each sackInventory seed
      // now carries its own as-of date - only include a seed if its
      // date is on/before this report period's start (otherwise it
      // genuinely didn't exist yet as of this period).
      //
      // Every other, non-seed sack transaction is only counted if it's
      // dated strictly AFTER ITS OWN sackTypeId+condition's own
      // beginning-balance date - CRITICAL FIX: an earlier version used
      // a single cutoff for the whole warehouse (the latest asOfDate
      // across every sack seed), which had the identical severe bug as
      // the stock side above - creating a new beginning-balance seed
      // for one sack type/condition later would push that cutoff
      // forward for every OTHER sack type/condition's rolling balance
      // too, silently excluding real, already-accumulated activity
      // that had nothing to do with the newly-seeded one. Now tracks
      // each key's own as-of date independently. A transaction whose
      // key has no matching seed at all is still excluded by default
      // (not included) - this is what originally fixed the "included
      // regardless of how old it actually was" gap from the per-key
      // matching that predates this fix.
      const sackBeginningBals = new Map()
      const sackAsOfDateByKey = new Map()
      const sackInventorySeed = await db.sackInventory
        .where('warehouseId').equals(currentWarehouseId)
        .toArray()
      for (const rec of sackInventorySeed) {
        if (rec.asOfDate && rec.asOfDate > stmtFrom) continue
        const key = `${rec.sackTypeId}::${rec.condition}`
        sackBeginningBals.set(key, (sackBeginningBals.get(key) ?? 0) + (rec.pieces ?? 0))
        sackAsOfDateByKey.set(key, rec.asOfDate ?? null)
      }
      const priorSack = await db.transactions
        .where('warehouseId').equals(currentWarehouseId)
        .and((t) => ['ESR', 'ESI'].includes(t.type) && t.status === 'Active' && t.date < stmtFrom)
        .toArray()
      for (const t of priorSack) {
        for (const l of (t.sackLines ?? [])) {
          const sType = sackTypeMap.get(l.sackTypeId)
          if (!sType) continue
          const key = `${l.sackTypeId}::${l.condition}`
          if (!sackAsOfDateByKey.has(key)) continue // no matching seed for this key at all - excluded by default
          const cutoff = sackAsOfDateByKey.get(key)
          if (cutoff && t.date <= cutoff) continue
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
        sackBeginningBals,
        signatories,
        certifiedCorrect,
        varieties,
        sackTypes,
        sackTypeMap,
      })

      const filename = `${sanitizeForFilename(currentWarehouse?.name) || 'WH'}-StockReport-${fmtDateForFilename(stmtFrom)}-${fmtDateForFilename(stmtTo)}.pdf`
      doc.save(filename)
      toast.success('PDF exported')
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

      {/* ── Summary period ─────────────────────────────────────────────── */}
      <div className="mt-5">
        <h2 className="text-sm font-semibold text-app-text">Summary</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">From</label>
            <CalendarDatePicker
              value={summaryFrom}
              label="Start Date"
              onChange={(iso) => { setSummaryFrom(iso); summaryToPickerRef.current?.open() }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">To</label>
            <CalendarDatePicker ref={summaryToPickerRef} value={summaryTo} label="End Date" onChange={setSummaryTo} />
          </div>
        </div>
        <PeriodPresetPicker onSelectRange={(from, to) => { setSummaryFrom(from); setSummaryTo(to) }} currentFrom={summaryFrom} currentTo={summaryTo} />
        <div key={currentWarehouseId} className="animate-pop-in">
          <DailySummaryCard dateFrom={summaryFrom} dateTo={summaryTo} />
        </div>
      </div>

      {/* ── Stock Statement ─────────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-app-text">Stock Statement</h2>
          <button type="button" onClick={handleExportPdf}
            disabled={isExporting || needsDates}
            className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-brand-neon transition-all hover:border-brand-neon/50 active:scale-95 disabled:opacity-40">
            {isExporting ? <Loader size={13} className="animate-spin" /> : <FileDown size={13} />}
            {isExporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
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
        <PeriodPresetPicker onSelectRange={(from, to) => { setStmtFrom(from); setStmtTo(to) }} currentFrom={stmtFrom} currentTo={stmtTo} />
        {needsDates && (
          <p className="mt-1 text-xs text-brand-amber">
            Both dates required to view transactions and export PDF.
          </p>
        )}

        {/* Main Stocks / Sacks tabs */}
        <div className="relative mt-3 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
          <div
            className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
            style={{ transform: mainTab === 'stocks' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
          />
          {['stocks', 'sacks'].map((tab) => (
            <button key={tab} type="button" onClick={() => setMainTab(tab)}
              className={`relative z-10 flex-1 rounded-lg py-1.5 text-sm font-medium capitalize transition-all active:scale-95 ${
                mainTab === tab ? 'text-brand-contrast' : 'text-neutral-400 hover:text-app-text'
              }`}>
              {tab}
            </button>
          ))}
        </div>

        {/* Sub-tabs */}
        <div className="mt-2 flex gap-4 border-b border-neutral-800 px-1">
          {['receipts', 'issues'].map((tab) => {
            const active = mainTab === 'stocks' ? stockSubTab === tab : sackSubTab === tab
            return (
              <button key={tab} type="button"
                onClick={() => mainTab === 'stocks' ? setStockSubTab(tab) : setSackSubTab(tab)}
                className={`-mb-px border-b-2 pb-1.5 text-xs font-medium capitalize transition-colors ${
                  active ? 'border-brand-neon text-app-text' : 'border-transparent text-neutral-500 hover:text-neutral-300'
                }`}>
                {tab}
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
                      {rows.map((t) => (
                        <li key={t.id}>
                          <button type="button" onClick={() => handleStockRowTap(t)}
                            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-left transition-all hover:border-brand-neon/40 active:scale-[0.99]">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-bold text-app-text">{t.serialNo}</span>
                                  <span className="text-xs text-neutral-500">{t.date}</span>
                                  <span className="text-xs text-neutral-500">MC {t.moistureContent ?? '—'}%</span>
                                  {(t.type === 'WSI' || t.wtsSide === 'issued') && (t.aiNumber || t.linkedDocNo) && (
                                    <span className="rounded bg-brand-neon/10 px-2 py-0.5 text-xs font-semibold text-brand-neon">
                                      AI {t.aiNumber || t.linkedDocNo}
                                    </span>
                                  )}
                                  {t.type === 'WSR' && t.linkedDocNo && (
                                    <span className="rounded bg-brand-amber/10 px-2 py-0.5 text-xs font-semibold text-brand-amber">
                                      WSI {t.linkedDocNo}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 truncate text-sm font-medium text-app-text">{t.customerName}</p>
                                <p className="text-xs text-neutral-500">{t.transactionTypeName} · {t.condition}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-lg font-bold text-app-text">{fmtBags(t.numberOfBags)}</p>
                                <p className="text-xs text-neutral-400">Net {fmtWeight(t.netKilos, weightUnit)}</p>
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
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
                              <p className="mt-0.5 truncate text-sm font-medium text-app-text">{t.customerName}</p>
                              <div className="flex flex-wrap gap-1.5 mt-0.5">
                                {(t.enrichedSackLines ?? []).map((l, i) => (
                                  <span key={i} className="text-xs text-neutral-500">
                                    {l.code}/{l.condition}: {fmtBags(l.pieces ?? 0)}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-lg font-bold text-app-text">{fmtBags(totalPieces)}</p>
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
