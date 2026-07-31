// Preloads a user's assigned warehouse(s) worth of transaction history
// from the Sheets backup into the local database, so that day-to-day
// navigation (stepping through serials, checking the floor) never
// needs a network round-trip - it's all local data by the time the
// user actually starts working.
//
// Design (confirmed with the user before building):
//  1. Never overwrites an app-created record. Preload only fills gaps
//     - historical rows the app itself never created. Existing local
//     transactions are the source of truth and are left untouched.
//  2. Full pull only the FIRST time a (warehouseId, type) combination
//     is preloaded (no preloadState record, or complete: false).
//     Every login after that does a lightweight "anything new since
//     last check" pull instead (mirrors the existing pattern already
//     used for authorities), not a full re-pull.
//  3. Resumable by construction: preloadState is written per
//     (warehouseId, type) combination as each one finishes, not all at
//     once at the end - so an interruption (closed mid-preload, lost
//     connection) just leaves whichever combinations hadn't finished
//     yet to pick up normally on the next login, without needing any
//     separate checkpoint/resume logic.
//  4. WTS is intentionally excluded (no Sheet backup exists for it).
//  5. Admin/Visitor users are skipped entirely - they aren't scoped to
//     specific warehouses, and preloading potentially every warehouse
//     in the branch would be far too expensive. The existing on-demand
//     Sheet lookup (fetchTransactionBySerial, already built) remains
//     the safety net for them if they navigate into unpreloaded
//     territory.
//
// Batching: per type, ALL of a user's warehouses needing a full pull
// are fetched in ONE request (fetchTransactionsBulk already accepts a
// list of warehouse names), and all warehouses needing only an
// incremental check are fetched in a SEPARATE single request - instead
// of one request per warehouse. A user with several assigned
// warehouses previously multiplied the network call count by however
// many warehouses they had; this reduces it to at most 2 calls per
// type (each of which is itself parallelized across every configured
// sheet source - see fetchTransactionsBulk), regardless of warehouse
// count. This was the primary cause of a very slow first preload.

import { db } from '../db/dexie.js'
import { fetchTransactionsBulk, mapSheetRowToTransaction } from './googleSheetsBridge.js'
import { recordSerialUsed } from '../utils/serialNumber.js'

const PRELOAD_TYPES = ['WSR', 'WSI', 'ESR', 'ESI']
const SERIAL_COLUMN_BY_TYPE = { WSR: 'WSR #', WSI: 'WSI #', ESR: 'ESR#', ESI: 'ESI#' }

/**
 * Preloads transaction history for every warehouse the given user is
 * assigned to. Safe to call on every login - already-complete
 * (warehouseId, type) combinations just do a quick incremental check
 * instead of a full re-pull. onProgress(status) is called before each
 * type's batch, e.g. for a UI progress indicator.
 */
export const preloadTransactionsForUser = async (user, { onProgress } = {}) => {
  if (!user || user.role === 'Admin' || user.role === 'Visitor') return
  const warehouseIds = user.assignedWarehouses ?? []
  if (warehouseIds.length === 0) return

  const warehouses = await db.warehouses.bulkGet(warehouseIds)
  const validWarehouses = warehouses.filter(Boolean)
  if (validWarehouses.length === 0) return

  const warehouseIdByName = new Map(validWarehouses.map((w) => [w.name, w.warehouseId]))

  for (const type of PRELOAD_TYPES) {
    onProgress?.({ type, warehouseCount: validWarehouses.length })
    await preloadOneType(type, validWarehouses, warehouseIdByName)
  }
}

const preloadOneType = async (type, warehouses, warehouseIdByName) => {
  // Split into two groups: warehouses that have never completed a
  // preload for this type (need everything), and warehouses that
  // already have (only need whatever's changed since). Each group gets
  // exactly one batched network request covering all warehouses in it.
  const states = await db.preloadState.bulkGet(warehouses.map((w) => [w.warehouseId, type]))
  const needsFull = []
  const needsIncremental = []
  let oldestIncrementalCheck = null

  warehouses.forEach((warehouse, i) => {
    const state = states[i]
    if (!state || !state.complete) {
      needsFull.push(warehouse)
    } else {
      needsIncremental.push(warehouse)
      if (!oldestIncrementalCheck || state.lastCheckedAt < oldestIncrementalCheck) {
        oldestIncrementalCheck = state.lastCheckedAt
      }
    }
  })

  // Existing local serials for every one of these warehouses, fetched
  // once for the whole type rather than once per warehouse - avoids
  // one database query per fetched row later.
  const warehouseIds = warehouses.map((w) => w.warehouseId)
  const localTx = await db.transactions
    .where('type').equals(type)
    .and((tx) => warehouseIds.includes(tx.warehouseId))
    .toArray()
  const existingSerialsByWarehouse = new Map(warehouseIds.map((id) => [id, new Set()]))
  for (const tx of localTx) {
    existingSerialsByWarehouse.get(tx.warehouseId)?.add(tx.serialNo)
  }

  const highestImportedByWarehouse = new Map()

  const processGroup = async (group, modifiedSince) => {
    if (group.length === 0) return
    const result = await fetchTransactionsBulk(type, group.map((w) => w.name), { modifiedSince })
    if (!result.ok) return // network/offline - preloadState left as-is for this group, retried next login

    for (const sourceResult of result.bySource) {
      if (!sourceResult.ok) continue
      for (const row of sourceResult.rows) {
        const serialNo = row[SERIAL_COLUMN_BY_TYPE[type]]
        if (!serialNo) continue

        const rowWarehouseName = row['Warehouse Name']
        const rowWarehouseId = warehouseIdByName.get(rowWarehouseName)
        if (!rowWarehouseId) continue // row belongs to a warehouse outside this batch - skip

        const existingSerials = existingSerialsByWarehouse.get(rowWarehouseId)
        if (existingSerials?.has(String(serialNo))) continue // app-created record already exists - never overwrite it

        const varietyByName = type === 'WSR' || type === 'WSI'
          ? new Map((await db.varietyTypes.toArray()).map((v) => [v.name.trim().toLowerCase(), v.varietyId]))
          : undefined

        const imported = mapSheetRowToTransaction(type, row, { warehouseId: rowWarehouseId, varietyByName })
        await db.transactions.add(imported)
        existingSerials?.add(String(serialNo))

        const num = parseInt(String(serialNo).replace(/\D/g, ''), 10)
        if (!Number.isNaN(num)) {
          const current = highestImportedByWarehouse.get(rowWarehouseId)
          if (!current || num > current.num) {
            highestImportedByWarehouse.set(rowWarehouseId, { num, serialNo: String(serialNo) })
          }
        }
      }
    }

    // Only mark this batch's warehouses complete after their fetch
    // genuinely succeeded - a network failure above already returned
    // early, leaving preloadState untouched for a clean retry next login.
    for (const warehouse of group) {
      await db.preloadState.put({
        warehouseId: warehouse.warehouseId,
        type,
        complete: true,
        lastCheckedAt: new Date().toISOString(),
      })
    }
  }

  await Promise.all([
    processGroup(needsFull, undefined),
    processGroup(needsIncremental, oldestIncrementalCheck),
  ])

  for (const [warehouseId, { serialNo }] of highestImportedByWarehouse) {
    await recordSerialUsed(type, warehouseId, serialNo)
  }
}

/**
 * Whether a (warehouseId, type) combination has completed at least one
 * full preload - used to decide whether checkAndLoadSerial/floor
 * calculations can safely skip the network entirely and trust local
 * data alone, versus still needing the on-demand Sheet fallback.
 */
export const isPreloadComplete = async (warehouseId, type) => {
  if (!warehouseId) return false
  const state = await db.preloadState.get([warehouseId, type])
  return Boolean(state?.complete)
}
