// Wet Palay Drying Notification - per explicit requirement: if a
// (regular) warehouse has received wet palay (identified by variety
// code, per getPalayMoistureState) that hasn't yet been issued out
// (presumably to a dryer) in matching quantity, show a RED reminder
// with how long the OLDEST still-outstanding batch has been waiting,
// and who received it.
//
// FIFO matching: wet palay bags are consumed oldest-first as
// issuances happen, so the "how long has this been sitting" figure
// reflects the longest-waiting batch specifically, not just the most
// recent receipt - the batch that's been waiting longest is the one
// most at risk and the one worth surfacing first.

import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Droplets } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { getPalayMoistureState, fmtBags } from '../../utils/calculations.js'

const formatElapsed = (fromDate) => {
  const ms = Date.now() - new Date(fromDate + 'T00:00:00').getTime()
  const totalHours = Math.floor(ms / (1000 * 60 * 60))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days === 0) return `${hours}h`
  return `${days}d ${hours}h`
}

function DryerStatusCard() {
  const { currentWarehouseId, currentWarehouse } = useWarehouse() ?? {}
  const isDryer = currentWarehouse?.facilityType === 'Mechanical Dryer'

  const status = useLiveQuery(async () => {
    if (!isDryer || !currentWarehouseId) return null

    const varieties = await db.varietyTypes.toArray()
    const moistureByVarietyId = new Map(
      varieties.map((v) => [v.varietyId, getPalayMoistureState(v.code, v.category)])
    )

    const tx = await db.transactions
      .where('warehouseId').equals(currentWarehouseId)
      .and((t) => (t.type === 'WSR' || t.type === 'WSI') && t.status === 'Active')
      .toArray()

    const wetReceived = tx
      .filter((t) => t.type === 'WSR' && moistureByVarietyId.get(t.varietyId) === 'wet')
      .reduce((s, t) => s + (t.numberOfBags ?? 0), 0)
    const dryIssued = tx
      .filter((t) => t.type === 'WSI' && moistureByVarietyId.get(t.varietyId) === 'dry')
      .reduce((s, t) => s + (t.numberOfBags ?? 0), 0)

    if (wetReceived === 0 && dryIssued === 0) return null
    return { wetReceived, dryIssued }
  }, [isDryer, currentWarehouseId]) ?? null

  if (!status) return null

  return (
    <div className="mt-3 rounded-xl border border-blue-400/40 bg-blue-400/10 px-3 py-2.5">
      <p className="text-sm font-semibold text-blue-300">Drying Facility Status</p>
      <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-blue-300/70">Wet Palay Received</p>
          <p className="font-semibold text-blue-200">{fmtBags(status.wetReceived)} bags</p>
        </div>
        <div>
          <p className="text-blue-300/70">Dry Palay Issued Out</p>
          <p className="font-semibold text-blue-200">{fmtBags(status.dryIssued)} bags</p>
        </div>
      </div>
    </div>
  )
}

function WetPalayNotification() {
  const { currentWarehouseId, currentWarehouse } = useWarehouse() ?? {}

  const outstanding = useLiveQuery(async () => {
    if (!currentWarehouseId || currentWarehouse?.facilityType === 'Mechanical Dryer') return null

    const varieties = await db.varietyTypes.toArray()
    const wetVarietyIds = new Set(
      varieties.filter((v) => getPalayMoistureState(v.code, v.category) === 'wet').map((v) => v.varietyId)
    )
    if (wetVarietyIds.size === 0) return null

    const tx = await db.transactions
      .where('warehouseId').equals(currentWarehouseId)
      .and((t) => (t.type === 'WSR' || t.type === 'WSI') && t.status === 'Active' && wetVarietyIds.has(t.varietyId))
      .toArray()
    if (tx.length === 0) return null

    const sorted = [...tx].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    // FIFO queue of still-outstanding receipts
    const queue = []
    for (const t of sorted) {
      if (t.type === 'WSR') {
        queue.push({ date: t.date, remaining: t.numberOfBags ?? 0, recordedByName: t.recordedByName })
      } else {
        let toConsume = t.numberOfBags ?? 0
        while (toConsume > 0 && queue.length > 0) {
          const oldest = queue[0]
          const consumed = Math.min(oldest.remaining, toConsume)
          oldest.remaining -= consumed
          toConsume -= consumed
          if (oldest.remaining <= 0) queue.shift()
        }
      }
    }

    if (queue.length === 0) return null

    const totalOutstandingBags = queue.reduce((s, q) => s + q.remaining, 0)
    const oldest = queue[0]

    return { totalOutstandingBags, oldestDate: oldest.date, recordedByName: oldest.recordedByName }
  }, [currentWarehouseId, currentWarehouse?.facilityType]) ?? null

  if (!outstanding) return null

  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border-2 border-brand-crimson bg-brand-crimson/10 px-3 py-2.5">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-brand-crimson" />
      <div>
        <p className="text-sm font-semibold text-brand-crimson">
          {fmtBags(outstanding.totalOutstandingBags)} bags of wet palay still need drying
        </p>
        <p className="mt-0.5 text-xs text-brand-crimson/80">
          Oldest batch received{outstanding.recordedByName ? ` by ${outstanding.recordedByName}` : ''} — {formatElapsed(outstanding.oldestDate)} ago
        </p>
      </div>
    </div>
  )
}

function DriedStockReceivedNotification() {
  const { currentWarehouseId, currentWarehouse } = useWarehouse() ?? {}

  const received = useLiveQuery(async () => {
    if (!currentWarehouseId || currentWarehouse?.facilityType === 'Mechanical Dryer') return null

    const dryerWarehouses = await db.warehouses.where('facilityType').equals('Mechanical Dryer').toArray()
    if (dryerWarehouses.length === 0) return null
    const dryerIds = dryerWarehouses.map((w) => w.warehouseId)

    // Every WSI issued out of a dryer's own accountability - the
    // transfer-out step that hands dried stock off to a destination
    // warehouse. Used to confirm a receipt actually originated at a
    // dryer specifically, not just any warehouse-to-warehouse transfer.
    const dryerTransferOuts = await db.transactions
      .where('warehouseId').anyOf(dryerIds)
      .and((t) => t.status === 'Active' && t.type === 'WSI')
      .toArray()
    const dryerAiNumbers = new Set(dryerTransferOuts.map((t) => t.aiNumber).filter(Boolean))
    if (dryerAiNumbers.size === 0) return null

    const localReceipts = await db.transactions
      .where('warehouseId').equals(currentWarehouseId)
      .and((t) => t.status === 'Active' && t.type === 'WSR' && dryerAiNumbers.has(t.linkedDocNo))
      .toArray()
    if (localReceipts.length === 0) return null

    const mostRecent = [...localReceipts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0]
    return {
      date: mostRecent.date,
      warehouseName: currentWarehouse?.name,
      moistureContent: mostRecent.moistureContent,
      bags: mostRecent.numberOfBags ?? 0,
      netKilos: mostRecent.netKilos ?? 0,
    }
  }, [currentWarehouseId, currentWarehouse?.facilityType, currentWarehouse?.name]) ?? null

  if (!received) return null

  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border-2 border-brand-neon bg-brand-neon/10 px-3 py-2.5">
      <Droplets size={18} className="mt-0.5 shrink-0 text-brand-neon" />
      <div>
        <p className="text-sm font-semibold text-brand-neon">
          Dried stock received — {fmtBags(received.bags)} bags, {received.netKilos.toFixed(2)} net kgs
        </p>
        <p className="mt-0.5 text-xs text-brand-neon/80">
          {received.date} · {received.warehouseName}
          {received.moistureContent != null ? ` · MC ${received.moistureContent}%` : ''}
        </p>
      </div>
    </div>
  )
}

function PalayDryingStatus() {
  return (
    <>
      <DryerStatusCard />
      <WetPalayNotification />
      <DriedStockReceivedNotification />
    </>
  )
}

export default PalayDryingStatus
