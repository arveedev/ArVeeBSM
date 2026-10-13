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
//
// The app's decision rules, and the Sheet follows it: completion is manual-only, so the Sheet's STATUS column can
// never complete or reopen an order here (the cache's `sheetStatus` is the decision, DONE only for an order marked
// done in the app; the Sheet's own value is kept apart as `sheetStatusRaw`). Whenever the Sheet disagrees with the decision, pushCompletionsToSheet() writes the decision to the
// Sheet (DONE, or blank for a reverted order), retried every minute while online until it succeeds.

import { liveQuery } from 'dexie'
import { db } from '../db/dexie.js'
import { markMillingOrderDone } from './googleSheetsBridge.js'

export const setMillingOrderCompleted = async (order, completed, uid = null) => {
  await db.millingOrderCompletions.put({
    orderId: order.orderId,
    type: order.type,
    number: order.number,
    completed: Boolean(completed),
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  })
  await db.millingOrders.update(order.orderId, { manuallyCompleted: Boolean(completed), sheetStatus: completed ? 'DONE' : null })
  pushCompletionsToSheet().catch(() => {})
}

export const applyMillingCompletions = async () => {
  await db.transaction('rw', db.millingOrders, db.millingOrderCompletions, async () => {
    const rows = await db.millingOrderCompletions.toArray()
    // Completion is manual-only: an order with no decision is pending even if the cached Sheet value says DONE
    // (the Sheet's own value stays in sheetStatusRaw). Cleans the cache that was built before this rule.
    const decided = new Set(rows.map((c) => c.orderId))
    const stale = await db.millingOrders.filter((o) => o.sheetStatus === 'DONE' && !decided.has(o.orderId)).toArray()
    for (const o of stale) await db.millingOrders.update(o.orderId, { sheetStatusRaw: o.sheetStatusRaw ?? 'DONE', sheetStatus: null })
    for (const c of rows) {
      const order = await db.millingOrders.get(c.orderId)
      if (!order || Boolean(order.manuallyCompleted) === Boolean(c.completed)) continue
      await db.millingOrders.update(c.orderId, { manuallyCompleted: Boolean(c.completed), sheetStatus: c.completed ? 'DONE' : null })
    }
  })
  pushCompletionsToSheet().catch(() => {})
}

let pushing = false
/** Writes every decision the Sheet disagrees with back to the Sheet (best effort, safe to repeat from any device). */
export const pushCompletionsToSheet = async () => {
  if (pushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  pushing = true
  try {
    const [decisions, orders] = await Promise.all([db.millingOrderCompletions.toArray(), db.millingOrders.toArray()])
    const byId = new Map(orders.map((o) => [o.orderId, o]))
    for (const c of decisions) {
      const o = byId.get(c.orderId)
      if (!o) continue
      const raw = o.sheetStatusRaw !== undefined ? o.sheetStatusRaw : (o.sheetStatus ?? null)
      const sheetSaysDone = raw === 'DONE'
      if (Boolean(c.completed) === sheetSaysDone) continue
      const res = await markMillingOrderDone(c.type, c.number, c.completed ? 'DONE' : '')
      if (res?.ok) await db.millingOrders.update(c.orderId, { sheetStatusRaw: c.completed ? 'DONE' : null })
    }
  } finally {
    pushing = false
  }
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
  const timer = setInterval(() => { pushCompletionsToSheet().catch(() => {}) }, 60000)
  pushCompletionsToSheet().catch(() => {})
  return () => { stopped = true; sub.unsubscribe(); clearInterval(timer) }
}
