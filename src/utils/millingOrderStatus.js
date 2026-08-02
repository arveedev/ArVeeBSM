// Shared Milling/Test Milling fulfillment logic - used by both
// StockFormBase/SackFormBase (for the picker) and the monitor page,
// so there is exactly one definition of "fulfilled" rather than
// duplicated copies that could drift apart.
//
// Milling: fulfilled when received (net kilos for stock, pieces for
// sacks) meets or exceeds issued x the MO's recovery percent - summed
// across BOTH stock and sacks together, and across every warehouse,
// since a batch's issue and receipt can happen at different
// warehouses.
//
// Test Milling: fulfilled only when all 3 trials have SOME recovery
// (any amount > 0, no percentage) AND the explicit trial3Confirmed
// flag is true - never inferred just from 3 trial records existing.

import { db } from '../db/dexie.js'

const sumStockKilos = (tx) => tx.reduce((s, t) => s + (t.netKilos ?? 0), 0)
const sumSackPieces = (tx) => tx.reduce((s, t) => s + (t.sackLines ?? []).reduce((ls, l) => ls + (l.pieces ?? 0), 0), 0)

/**
 * Computes fulfillment + full detail for every MO/TMO in the synced
 * reference data, combining stock (WSR/WSI) and sack (ESR/ESI)
 * transactions together. Returns one entry per order with everything
 * the monitor's detail view needs: per-transaction issue/receipt
 * rows, totals, and the fulfilled flag.
 */
export const computeMillingOrderStatuses = async (orderType) => {
  const orders = await db.millingOrders.where('type').equals(orderType).toArray()
  const numberField = orderType === 'MO' ? 'moNumber' : 'tmoNumber'

  const numbers = orders.map((o) => o.number)
  if (numbers.length === 0) return []

  const allTx = await db.transactions
    .where(numberField).anyOf(numbers)
    .and((t) => t.status === 'Active')
    .toArray()

  return orders.map((order) => {
    const forThisOrder = allTx.filter((t) => t[numberField] === order.number)
    const issueTx = forThisOrder.filter((t) => t.type === 'WSI' || t.type === 'ESI')
    const receiptTx = forThisOrder.filter((t) => t.type === 'WSR' || t.type === 'ESR')

    const issuedKilos = sumStockKilos(issueTx.filter((t) => t.type === 'WSI'))
    const issuedPieces = sumSackPieces(issueTx.filter((t) => t.type === 'ESI'))
    const receivedKilos = sumStockKilos(receiptTx.filter((t) => t.type === 'WSR'))
    const receivedPieces = sumSackPieces(receiptTx.filter((t) => t.type === 'ESR'))

    let fulfilled
    let recoveredTrials = null

    if (orderType === 'MO') {
      const expectedKilos = order.recoveryPercent != null ? issuedKilos * (order.recoveryPercent / 100) : null
      const expectedPieces = order.recoveryPercent != null ? issuedPieces * (order.recoveryPercent / 100) : null
      const kilosOk = expectedKilos == null || expectedKilos === 0 || receivedKilos >= expectedKilos
      const piecesOk = expectedPieces == null || expectedPieces === 0 || receivedPieces >= expectedPieces
      const hasExpectation = (expectedKilos != null && expectedKilos > 0) || (expectedPieces != null && expectedPieces > 0)
      fulfilled = hasExpectation && kilosOk && piecesOk
    } else {
      const recovered = new Set(
        receiptTx
          .filter((t) => (t.type === 'WSR' ? (t.netKilos ?? 0) > 0 : sumSackPieces([t]) > 0))
          .map((t) => t.trialNumber)
      )
      recoveredTrials = [...recovered]
      fulfilled = ['1', '2', '3'].every((n) => recovered.has(n)) && order.trial3Confirmed === true
    }

    return {
      ...order,
      issueTx,
      receiptTx,
      issuedKilos,
      issuedPieces,
      receivedKilos,
      receivedPieces,
      recoveredTrials,
      fulfilled,
    }
  })
}
