// Summary Card — at-a-glance summary grouped by cereal type → transaction
// type → variety. Uses the shared date range from the Reports page (the
// page itself owns the "Summary" heading and date pickers — this card
// only shows the period inline in its own header).
//
// For Procurement transactions, shows the count of individual farmers vs
// farmer associations (and their member counts) directly below the
// variety row, since procurement reporting cares about how many distinct
// suppliers were involved, not just the volume moved.
//
// "Save as image" exports the card as a JPEG via html2canvas for sharing.

import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Loader } from 'lucide-react'
import html2canvas from 'html2canvas'
import toast from 'react-hot-toast'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import { db } from '../../db/dexie.js'
import { fmtBags, fmtWeight, todayLocalISO } from '../../utils/calculations.js'
import { splitStockTransactions } from '../../utils/wtsAdapter.js'

const STOCK_TYPES = ['WSR', 'WSI', 'WTS']
const PROCUREMENT_TYPE_NAME = 'Procurement'

function DailySummaryCard({ dateFrom, dateTo }) {
  const { currentWarehouse } = useWarehouse() ?? {}
  const { weightUnit } = useSettings() ?? {}
  const cardRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  const today = todayLocalISO()
  const effectiveFrom = dateFrom || today
  const effectiveTo = dateTo || today

  const rawTx = useLiveQuery(async () => {
    if (!currentWarehouse) return []
    return db.transactions
      .where('warehouseId').equals(currentWarehouse.warehouseId)
      .and((t) =>
        STOCK_TYPES.includes(t.type) &&
        t.status === 'Active' &&
        !t.isInitialBalance &&
        t.date >= effectiveFrom &&
        t.date <= effectiveTo
      )
      .toArray()
  }, [currentWarehouse?.warehouseId, effectiveFrom, effectiveTo])

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const txTypes = useLiveQuery(() => db.transactionTypes.toArray(), []) ?? []

  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const txTypeMap = new Map(txTypes.map((t) => [t.transactionTypeId, t]))

  const { receipts: rawReceipts, issues: rawIssues } = splitStockTransactions(rawTx ?? [])

  const enrich = (t) => ({
    ...t,
    varietyName: varietyMap.get(t.varietyId)?.name ?? '—',
    cerealCategory: varietyMap.get(t.varietyId)?.category ?? 'Unknown',
    transactionTypeName: txTypeMap.get(t.transactionTypeId)?.name ?? t.type,
  })

  const txList = [...rawReceipts.map(enrich), ...rawIssues.map(enrich)]

  // Group by: cereal type → transaction type → variety → { bags, kilos,
  // individualFarmers (Set of names), coopCount, coopMemberCount }
  const groups = {}
  for (const t of txList) {
    if (!groups[t.cerealCategory]) groups[t.cerealCategory] = {}
    const txTypeName = t.transactionTypeName
    if (!groups[t.cerealCategory][txTypeName]) groups[t.cerealCategory][txTypeName] = {}
    if (!groups[t.cerealCategory][txTypeName][t.varietyName]) {
      groups[t.cerealCategory][txTypeName][t.varietyName] = {
        bags: 0, kilos: 0,
        individualFarmers: new Set(),
        coopCount: 0,
        coopMemberCount: 0,
      }
    }
    const entry = groups[t.cerealCategory][txTypeName][t.varietyName]
    entry.bags += t.numberOfBags ?? 0
    entry.kilos += t.netKilos ?? 0

    if (txTypeName === PROCUREMENT_TYPE_NAME) {
      if (t.farmerCoops?.length) {
        entry.coopCount += 1
        entry.coopMemberCount += t.farmerCoops.length
      } else if (t.customerName) {
        entry.individualFarmers.add(t.customerName)
      }
    }
  }

  const totalTx = txList.length
  const hasData = totalTx > 0

  const periodLabel = effectiveFrom === effectiveTo
    ? new Date(effectiveFrom + 'T00:00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })
    : `${new Date(effectiveFrom + 'T00:00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })} – ${new Date(effectiveTo + 'T00:00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}`

  const handleExport = async () => {
    if (!cardRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#0A0A0A',
        scale: 2,
        useCORS: true,
      })
      const link = document.createElement('a')
      link.download = `BSM-Summary-${currentWarehouse?.code ?? 'WH'}-${effectiveFrom}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.92)
      link.click()
      toast.success('Summary image saved')
    } catch (err) {
      console.error('Summary image export error:', err)
      toast.error('Export failed — try again')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95 disabled:opacity-40"
        >
          {exporting ? <Loader size={13} className="animate-spin" /> : <Camera size={13} />}
          {exporting ? 'Exporting…' : 'Save as image'}
        </button>
      </div>

      <div ref={cardRef} className="mt-2 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-neon">
            NFA — BSM Summary
          </p>
          <p className="mt-0.5 text-lg font-bold text-app-text">
            {currentWarehouse?.code ?? '—'} · {currentWarehouse?.name ?? '—'}
          </p>
          <p className="text-xs text-neutral-500">{periodLabel}</p>
        </div>

        <div className="mt-4 border-t border-neutral-800 pt-4 space-y-4">
          {!hasData && (
            <p className="text-center text-xs text-neutral-600">
              No transactions in this period.
            </p>
          )}

          {Object.entries(groups).sort().map(([cerealType, byTxType]) => (
            <div key={cerealType}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                {cerealType}
              </p>

              {Object.entries(byTxType).sort().map(([txTypeName, byVariety]) => (
                <div key={txTypeName} className="mb-3">
                  <p className="mb-1.5 text-xs font-medium text-neutral-400">{txTypeName}</p>
                  <div className="space-y-1">
                    {Object.entries(byVariety).sort().map(([varietyName, totals]) => {
                      const isProcurement = txTypeName === PROCUREMENT_TYPE_NAME
                      const individualCount = totals.individualFarmers?.size ?? 0
                      return (
                        <div key={varietyName} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-app-text">{varietyName}</span>
                            <div className="flex items-center gap-4 text-right">
                              <div>
                                <p className="text-xs text-neutral-500">Bags</p>
                                <p className="font-mono text-sm font-semibold text-app-text">{fmtBags(totals.bags)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-neutral-500">Net Kilos</p>
                                <p className="font-mono text-sm font-semibold text-brand-neon">{fmtWeight(totals.kilos, weightUnit)}</p>
                              </div>
                            </div>
                          </div>
                          {isProcurement && (individualCount > 0 || totals.coopCount > 0) && (
                            <p className="mt-1 text-[11px] text-neutral-500">
                              {individualCount > 0 && `${individualCount} individual farmer${individualCount !== 1 ? 's' : ''}`}
                              {individualCount > 0 && totals.coopCount > 0 && ' · '}
                              {totals.coopCount > 0 && (
                                `${totals.coopCount} farmer association${totals.coopCount !== 1 ? 's' : ''} (${totals.coopMemberCount} member${totals.coopMemberCount !== 1 ? 's' : ''})`
                              )}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-neutral-800 pt-2 text-right text-[10px] text-neutral-700">
          BSM by ArVee · {effectiveFrom}
        </p>
      </div>
    </div>
  )
}

export default DailySummaryCard
