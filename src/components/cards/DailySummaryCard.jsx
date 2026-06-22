// Daily Summary Card — a high-contrast overview of today's transaction
// activity for the selected warehouse. Can be exported to a JPEG image
// (via html2canvas) and shared directly to messaging apps like Facebook
// Messenger, per Phase 8 Step 8.4.
//
// The card is intentionally styled to look good as a standalone image
// when exported — dark background, high-contrast text, clear data
// hierarchy. The export button triggers html2canvas on the card element
// and downloads the result as a JPEG.

import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Loader } from 'lucide-react'
import html2canvas from 'html2canvas'
import toast from 'react-hot-toast'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { db } from '../../db/dexie.js'
import { calculateNetBags } from '../../utils/calculations.js'

const TYPE_LABELS = { WSR: 'Receipts', WSI: 'Issuances', WTS: 'Transfers', ESR: 'Sack Receipts', ESI: 'Sack Issues' }
const STOCK_TYPES = ['WSR', 'WSI', 'WTS']
const SACK_TYPES = ['ESR', 'ESI']

function DailySummaryCard() {
  const { currentWarehouse } = useWarehouse() ?? {}
  const cardRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const todayTx = useLiveQuery(async () => {
    if (!currentWarehouse) return []
    return db.transactions
      .where('warehouseId').equals(currentWarehouse.warehouseId)
      .and((t) => t.date === today && t.status === 'Active')
      .toArray()
  }, [currentWarehouse?.warehouseId, today])

  const txList = todayTx ?? []

  const countByType = (types) => types.reduce((acc, type) => {
    acc[type] = txList.filter((t) => t.type === type).length
    return acc
  }, {})

  const totalNetKilos = txList
    .filter((t) => STOCK_TYPES.includes(t.type))
    .reduce((s, t) => {
      const sign = t.type === 'WSI' ? -1 : 1
      return s + (t.netKilos ?? 0) * sign
    }, 0)

  const totalBags = txList
    .filter((t) => STOCK_TYPES.includes(t.type))
    .reduce((s, t) => {
      const sign = t.type === 'WSI' ? -1 : 1
      return s + (t.numberOfBags ?? 0) * sign
    }, 0)

  const stockCounts = countByType(STOCK_TYPES)
  const sackCounts = countByType(SACK_TYPES)
  const totalTx = txList.length

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
      link.download = `BSM-Summary-${currentWarehouse?.code ?? 'WH'}-${today}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.92)
      link.click()
      toast.success('Summary image saved')
    } catch {
      toast.error('Export failed — try again')
    } finally {
      setExporting(false)
    }
  }

  const dateLabel = new Date().toLocaleDateString('en-PH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Daily Summary</h2>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || totalTx === 0}
          className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-white active:scale-95 disabled:opacity-40"
        >
          {exporting
            ? <Loader size={13} className="animate-spin" />
            : <Camera size={13} />}
          {exporting ? 'Exporting…' : 'Save as image'}
        </button>
      </div>

      <div
        ref={cardRef}
        className="mt-2 rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
      >
        {/* Card header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-neon">
              NFA — BSM Daily Summary
            </p>
            <p className="mt-0.5 text-lg font-bold text-white">
              {currentWarehouse?.code ?? '—'} · {currentWarehouse?.name ?? '—'}
            </p>
            <p className="text-xs text-neutral-500">{dateLabel}</p>
          </div>
          <span className="rounded-xl border border-neutral-800 px-3 py-1 text-xs text-neutral-400">
            {totalTx} transactions
          </span>
        </div>

        <div className="mt-4 border-t border-neutral-800 pt-4">
          {/* Stock movement totals */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <p className="text-xs text-neutral-500">Net Bags Movement</p>
              <p className={`mt-1 text-2xl font-bold ${totalBags >= 0 ? 'text-brand-neon' : 'text-brand-crimson'}`}>
                {totalBags >= 0 ? '+' : ''}{totalBags.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <p className="text-xs text-neutral-500">Net Kilos Movement</p>
              <p className={`mt-1 text-2xl font-bold ${totalNetKilos >= 0 ? 'text-brand-neon' : 'text-brand-crimson'}`}>
                {totalNetKilos >= 0 ? '+' : ''}{totalNetKilos.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Per-type breakdown — Stock */}
          {Object.entries(stockCounts).some(([, v]) => v > 0) && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                Stock Documents
              </p>
              <div className="space-y-1.5">
                {STOCK_TYPES.filter((t) => stockCounts[t] > 0).map((type) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">{TYPE_LABELS[type]}</span>
                    <span className="font-mono text-sm font-semibold text-white">
                      {stockCounts[type]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-type breakdown — Sacks */}
          {Object.entries(sackCounts).some(([, v]) => v > 0) && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                Sack Documents
              </p>
              <div className="space-y-1.5">
                {SACK_TYPES.filter((t) => sackCounts[t] > 0).map((type) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">{TYPE_LABELS[type]}</span>
                    <span className="font-mono text-sm font-semibold text-white">
                      {sackCounts[type]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalTx === 0 && (
            <p className="mt-3 text-center text-xs text-neutral-600">
              No transactions recorded today.
            </p>
          )}
        </div>

        <p className="mt-4 border-t border-neutral-800 pt-2 text-right text-[10px] text-neutral-700">
          Generated by BSM App · {new Date().toLocaleTimeString('en-PH')}
        </p>
      </div>
    </div>
  )
}

export default DailySummaryCard
