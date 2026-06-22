// Pile ledger — keeps `piles.currentBags`/`currentKilos` as live running
// totals rather than values re-derived by summing every transaction on
// every render. WSR (receipt) adds to a pile; WSI (issuance) subtracts.
// WTS (Warehouse Transfer Stock) is a true in-warehouse document with its
// own receipt+issue sides that hasn't been built yet — until that exists,
// WTS does not move pile totals (see StockFormBase.jsx for the current
// placeholder behavior).

import { db } from '../db/dexie.js'

const DIRECTION_BY_TYPE = {
  WSR: 1,
  WSI: -1,
  WTS: 0,
}

/**
 * Applies a stock transaction's effect to its target pile's running
 * totals. Call this once, right after the transaction itself is saved.
 * No-ops safely if the pile no longer exists or the type has no defined
 * direction (e.g. WTS, until it's built out).
 */
export const applyTransactionToPile = async (transaction) => {
  const direction = DIRECTION_BY_TYPE[transaction.type]
  if (!direction || !transaction.pileId) return

  const pile = await db.piles.get(transaction.pileId)
  if (!pile) return

  const bagsDelta = (transaction.numberOfBags ?? 0) * direction
  const kilosDelta = (transaction.netKilos ?? 0) * direction

  await db.piles.update(pile.pileId, {
    currentBags: Math.max(0, (pile.currentBags ?? 0) + bagsDelta),
    currentKilos: Math.max(0, (pile.currentKilos ?? 0) + kilosDelta),
  })
}

/**
 * Reverses a stock transaction's effect on its target pile — the inverse
 * of applyTransactionToPile. Used when a transaction is updated (reverse
 * the OLD values, then re-apply the NEW ones) or deleted (reverse only).
 */
export const reverseTransactionFromPile = async (transaction) => {
  const direction = DIRECTION_BY_TYPE[transaction.type]
  if (!direction || !transaction.pileId) return

  const pile = await db.piles.get(transaction.pileId)
  if (!pile) return

  const bagsDelta = (transaction.numberOfBags ?? 0) * direction
  const kilosDelta = (transaction.netKilos ?? 0) * direction

  await db.piles.update(pile.pileId, {
    currentBags: Math.max(0, (pile.currentBags ?? 0) - bagsDelta),
    currentKilos: Math.max(0, (pile.currentKilos ?? 0) - kilosDelta),
  })
}
