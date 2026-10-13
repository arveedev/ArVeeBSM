// MO/TMO completion shared between devices.
//
// db.millingOrders is a local cache rebuilt from the Google Sheet on every sync and is NOT synced between
// devices, so a "mark done" stored only there stayed on the device that made it (the Sheet's own STATUS write is
// best-effort and fails offline). The decision itself now lives in a small synced table, db.millingOrderCompletions
// (one row per order: completed true / false), and this module keeps every device's local `manuallyCompleted`
// flag in line with it:
//   - setMillingOrderCompleted() writes the synced row and the local flag together;
//   - applyMillingCompletions() copies the synced rows onto the local cache (run whenever the synced rows change,
//     and by the Sheet sync's rebuild of the cache);
//   - startMillingCompletionSync() uploads completions this device made before the table existed (one time) and
//     watches for changes arriving from other devices.

import { liveQuery } from 'dexie'
import { db } from '../db/dexie.js'

export const setMillingOrderCompleted = async (order, completed, uid = null) => {
  await db.millingOrderCompletions.put({
    orderId: order.orderId,
    type: order.type,
    number: order.number,
    completed: Boolean(completed),
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  })
  await db.millingOrders.update(order.orderId, completed ? { manuallyCompleted: true } : { manuallyCompleted: false, sheetStatus: null })
}

export const applyMillingCompletions = async () => {
  await db.transaction('rw', db.millingOrders, db.millingOrderCompletions, async () => {
    const rows = await db.millingOrderCompletions.toArray()
    for (const c of rows) {
      const order = await db.millingOrders.get(c.orderId)
      if (!order || Boolean(order.manuallyCompleted) === Boolean(c.completed)) continue
      await db.millingOrders.update(c.orderId, c.completed ? { manuallyCompleted: true } : { manuallyCompleted: false, sheetStatus: null })
    }
  })
}

// One time per device: completions marked here before the synced table existed are uploaded, so the device that
// has "a lot of finished milling" shares it with the others.
const uploadLegacyCompletions = async () => {
  const [orders, existing] = await Promise.all([
    db.millingOrders.filter((o) => Boolean(o.manuallyCompleted)).toArray(),
    db.millingOrderCompletions.toArray(),
  ])
  const have = new Set(existing.map((c) => c.orderId))
  const now = new Date().toISOString()
  const missing = orders.filter((o) => !have.has(o.orderId)).map((o) => ({
    orderId: o.orderId, type: o.type, number: o.number, completed: true, updatedAt: now, updatedBy: 'migrated',
  }))
  if (missing.length) await db.millingOrderCompletions.bulkPut(missing)
}

export const startMillingCompletionSync = () => {
  let stopped = false
  uploadLegacyCompletions().catch((e) => console.error('[millingCompletion] upload failed', e))
  const sub = liveQuery(() => db.millingOrderCompletions.toArray()).subscribe({
    next: () => { if (!stopped) applyMillingCompletions().catch((e) => console.error('[millingCompletion] apply failed', e)) },
    error: (e) => console.error('[millingCompletion] watch failed', e),
  })
  return () => { stopped = true; sub.unsubscribe() }
}
