// Reports — Phase 8. Two sections:
//
// 1. Daily Summary Card — an at-a-glance card showing today's transaction
//    counts and stock movement for the current warehouse. Has a "Save as
//    image" button that uses html2canvas to export it as a JPEG for quick
//    sharing via messaging apps (Facebook Messenger, etc.).
//
// 2. Stock Statement — filterable transaction history for the selected
//    warehouse. Filters: document type, date range. Exports to a formatted
//    PDF (jsPDF + jspdf-autotable) with the five NFA signatory lines:
//    Prepared By / Certified Correct / Verified Correct / Audited By /
//    Noted By — pulled from db.signatories + db.reportConfig, configured
//    in the Admin Dashboard's Signatories tab.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileDown, Loader } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { generateStockStatementPdf, enrichSackLines } from '../utils/pdfGenerator.js'
import DailySummaryCard from '../components/cards/DailySummaryCard.jsx'

const ALL_TYPES = ['WSR', 'WSI', 'WTS', 'ESR', 'ESI']
const TYPE_LABELS = {
  WSR: 'Receipts (WSR)',
  WSI: 'Issuances (WSI)',
  WTS: 'Transfers (WTS)',
  ESR: 'Sack Receipts (ESR)',
  ESI: 'Sack Issues (ESI)',
}

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

function Reports() {
  const { user } = useAuth()
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}

  const [selectedTypes, setSelectedTypes] = useState(new Set(ALL_TYPES))
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const transactions = useLiveQuery(async () => {
    if (!currentWarehouseId) return []
    let query = db.transactions.where('warehouseId').equals(currentWarehouseId)
    const all = await query.toArray()
    return all
      .filter((t) => t.status === 'Active')
      .filter((t) => selectedTypes.has(t.type))
      .filter((t) => !dateFrom || t.date >= dateFrom)
      .filter((t) => !dateTo || t.date <= dateTo)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [currentWarehouseId, selectedTypes, dateFrom, dateTo])

  const txList = transactions ?? []

  const toggleType = (type) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) { if (next.size > 1) next.delete(type) }
      else next.add(type)
      return next
    })
  }

  const handleExportPdf = async () => {
    if (txList.length === 0) {
      toast.error('No transactions match the current filters')
      return
    }

    setIsExporting(true)
    try {
      const province = currentWarehouse?.provinceId
        ? await db.provinces.get(currentWarehouse.provinceId)
        : null

      const enriched = await enrichSackLines(txList)

      const doc = await generateStockStatementPdf({
        warehouse: currentWarehouse,
        province,
        transactions: enriched,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        currentUser: user,
      })

      const filename = `BSM-StockStatement-${currentWarehouse?.code ?? 'WH'}-${
        new Date().toISOString().slice(0, 10)
      }.pdf`

      doc.save(filename)
      toast.success('PDF exported')
    } catch (err) {
      console.error(err)
      toast.error('PDF export failed — check the console for details')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="min-h-screen px-4 pb-24 pt-6">
      <h1 className="text-xl font-semibold text-white">Reports</h1>

      {sortedWarehouses.length > 1 && (
        <div className="mt-4">
          <select
            value={currentWarehouseId ?? ''}
            onChange={(e) => setCurrentWarehouseId(e.target.value)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-neon"
          >
            {sortedWarehouses.map((w) => (
              <option key={w.warehouseId} value={w.warehouseId}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Daily Summary Card */}
      <DailySummaryCard />

      {/* Stock Statement */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Stock Statement</h2>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExporting || txList.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-brand-neon transition-all hover:border-brand-neon/50 active:scale-95 disabled:opacity-40"
          >
            {isExporting
              ? <Loader size={13} className="animate-spin" />
              : <FileDown size={13} />}
            {isExporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>

        {/* Filters */}
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {ALL_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
                  selectedTypes.has(type)
                    ? 'border-brand-neon bg-brand-neon/10 text-brand-neon'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-500'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                onClick={(e) => e.currentTarget.showPicker?.()}
                className="w-full cursor-pointer rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-brand-neon"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                onClick={(e) => e.currentTarget.showPicker?.()}
                className="w-full cursor-pointer rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-brand-neon"
              />
            </div>
          </div>
        </div>

        {/* Transaction list */}
        <div className="mt-3">
          {txList.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-600">
              No transactions match the current filters.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-neutral-500">
                {txList.length} transaction{txList.length !== 1 ? 's' : ''} matched
              </p>
              <ul className="space-y-2">
                {txList.map((t) => (
                  <TransactionRow key={t.id} transaction={t} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TransactionRow({ transaction: t }) {
  const piles = useLiveQuery(() => db.piles.toArray(), [])
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), [])

  const pile = (piles ?? []).find((p) => p.pileId === t.pileId)
  const variety = (varieties ?? []).find((v) => v.varietyId === t.varietyId)

  const typeColor = {
    WSR: 'text-brand-neon',
    WSI: 'text-brand-amber',
    WTS: 'text-neutral-300',
    ESR: 'text-sky-400',
    ESI: 'text-purple-400',
  }

  return (
    <li className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${typeColor[t.type] ?? 'text-white'}`}>
            {t.type}
          </span>
          <span className="font-mono text-xs text-neutral-400">{t.serialNo}</span>
        </div>
        <span className="text-xs text-neutral-500">{t.date}</span>
      </div>
      <p className="mt-0.5 truncate text-sm text-white">{t.customerName}</p>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
        {pile && <span>{pile.pileName}</span>}
        {variety && <span>{variety.name}</span>}
        {t.numberOfBags != null && <span>{t.numberOfBags.toLocaleString()} bags</span>}
        {t.netKilos != null && <span>{t.netKilos.toFixed(2)} kg</span>}
        {t.condition && <span>{t.condition}</span>}
      </div>
    </li>
  )
}

export default Reports
