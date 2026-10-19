// Re-assign ONE document (a WSR, a WSI, or one side of a WTS) to a different pile of the same warehouse and variety.
//
// Used by the Stock Desk Data check "Documents dated after their pile was closed": an Admin moves such a document to the pile
// that is open. Only the document's pile changes (nothing else on it); both piles' balances are then rebuilt from their
// own history. Refuses anything that would make the ledger wrong: another warehouse, another variety, a closed pile.

import { db } from '../db/dexie.js'
import { recalculatePileCurrentState } from './pileLedger.js'

export const reassignDocumentToPile = async (txId, oldPileId, newPileId) => {
  const tx = await db.transactions.get(txId)
  if (!tx || tx.status !== 'Active') throw new Error('That document is not active any more.')
  const [oldPile, newPile] = await Promise.all([db.piles.get(oldPileId), db.piles.get(newPileId)])
  if (!oldPile || !newPile) throw new Error('A pile could not be found.')
  if (newPile.pileId === oldPile.pileId) throw new Error('That is the same pile.')
  if (newPile.warehouseId !== oldPile.warehouseId) throw new Error('The piles are in different warehouses. Use Move Records for that.')
  if (newPile.closedDate && newPile.closedDate < tx.date) throw new Error('That pile was closed before the document date.')
  if (newPile.varietyId !== oldPile.varietyId) throw new Error('The piles hold different varieties.')

  let patch
  if (tx.type === 'WTS') {
    if (tx.issuedPileId === oldPileId) patch = { issuedPileId: newPileId }
    else if (tx.receivedPileId === oldPileId) patch = { receivedPileId: newPileId }
  } else if (tx.pileId === oldPileId) {
    patch = { pileId: newPileId }
  }
  if (!patch) throw new Error('That document is not on the old pile.')

  await db.transactions.update(txId, patch)
  await recalculatePileCurrentState(oldPileId)
  await recalculatePileCurrentState(newPileId)
  return { type: tx.type, serial: tx.serialNo, from: oldPile.pileName, to: newPile.pileName }
}
