// Keeps the stored totals that are DERIVED from transactions (an authority's issued bags / kilos, a pile's balance) the
// same on every device.
//
// Those totals are stored on synced rows and moved by each form save with a read-modify-write, so two devices saving
// against the same authority or pile before they had synced each other lost one side's change - one device then showed an
// authority as used and another as still available. The transactions themselves are the one thing every device
// shares, so each device recomputes the totals from them, deterministically, and writes only a value that differs:
// every device computes the same number from the same transactions, so they converge.
//
// It only recomputes when this device has pulled everything (isCloudSyncFullyCaughtUp); a device that is still pulling
// holds fewer transactions and would write a LOWER number that then syncs to all the others.
import { liveQuery } from 'dexie'
import { db, isCloudSyncFullyCaughtUp } from '../db/dexie.js'
import { isTransactionSyncPaused } from './syncPauseState.js'
import { recalculateAuthorityIssuedTotals } from './googleSheetsBridge.js'
import { recalculatePileStatesForWarehouses } from '../utils/pileLedger.js'

let running = false

export const reconcileDerivedTotals = async () => {
  if (running || !isCloudSyncFullyCaughtUp() || isTransactionSyncPaused()) return false
  running = true
  try {
    await recalculateAuthorityIssuedTotals()
    const warehouses = await db.warehouses.toArray()
    await recalculatePileStatesForWarehouses(warehouses.map((w) => w.warehouseId))
    return true
  } finally {
    running = false
  }
}

/** Starts the watcher: after the transactions change, when the device catches up with the cloud, and every 5 minutes. */
export const startDerivedTotalsSync = () => {
  let timer = null
  const schedule = (delay = 2500) => {
    clearTimeout(timer)
    timer = setTimeout(() => { reconcileDerivedTotals().catch((e) => console.error('[derivedTotalsSync]', e)) }, delay)
  }
  // a change to any issue / receipt (added, voided, edited, deleted) shows up in this signature
  const txSub = liveQuery(async () => {
    const rows = await db.transactions.filter((t) => t.status === 'Active').toArray()
    let kilos = 0
    for (const t of rows) kilos += (t.netKilos ?? 0) + (t.numberOfBags ?? 0)
    return `${rows.length}:${Math.round(kilos * 1000)}`
  }).subscribe({ next: () => schedule(), error: () => {} })
  const syncSub = db.cloud.syncState.subscribe((state) => { if (state?.phase === 'in-sync') schedule(1500) })
  const interval = setInterval(() => schedule(100), 5 * 60 * 1000)
  return () => { clearTimeout(timer); clearInterval(interval); txSub.unsubscribe(); syncSub.unsubscribe() }
}
