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

import { db } from '../db/dexie.js'
import { fetchTransactionsBulk, mapSheetRowToTransaction } from './googleSheetsBridge.js'
import { recordSerialUsed } from '../utils/serialNumber.js'

const PRELOAD_TYPES = ['WSR', 'WSI', 'ESR', 'ESI']

/**
 * Preloads transaction history for every warehouse the given user is
 * assigned to. Safe to call on every login - already-complete
 * (warehouseId, type) combinations just do a quick incremental check
 * instead of a full re-pull. onProgress(status) is called before each
 * (warehouseId, type) step, e.g. for a UI progress indicator.
 */
export const preloadTransactionsForUser = async (user, { onProgress } = {}) => {
  if (!user || user.role === 'Admin' || user.role === 'Visitor') return
  const warehouseIds = user.assignedWarehouses ?? []
  if (warehouseIds.length === 0) return

  const warehouses = await db.warehouses.bulkGet(warehouseIds)
  const validWarehouses = warehouses.filter(Boolean)
  if (validWarehouses.length === 0) return

  const warehouseNames = validWarehouses.map((w) => w.name)
  const warehouseIdByName = new Map(validWarehouses.map((w) => [w.name, w.warehouseId]))

  for (const type of PRELOAD_TYPES) {
    for (const warehouse of validWarehouses) {
      onProgress?.({ warehouseName: warehouse.name, type })
      await preloadOne(warehouse, type, warehouseNames, warehouseIdByName)
    }
  }
}

const preloadOne = async (warehouse, type, allWarehouseNames, warehouseIdByName) => {
  const key = [warehouse.warehouseId, type]
  const state = await db.preloadState.get(key)
  const isFirstPull = !state || !state.complete

  // Every already-existing local serial for this (warehouse, type),
  // fetched once upfront into a Set for fast membership checks -
  // avoids one database query per fetched row, which would be far too
  // slow for a warehouse with any meaningful amount of history.
  const localTx = await db.transactions
    .where('type').equals(type)
    .and((tx) => tx.warehouseId === warehouse.warehouseId)
    .toArray()
  const existingSerials = new Set(localTx.map((tx) => tx.serialNo))

  const result = await fetchTransactionsBulk(type, [warehouse.name], {
    modifiedSince: isFirstPull ? undefined : state.lastCheckedAt,
  })
  if (!result.ok) return // network/offline - leave preloadState as-is, retried next login

  let highestImportedSerial = null

  for (const sourceResult of result.bySource) {
    if (!sourceResult.ok) continue
    for (const row of sourceResult.rows) {
      const serialColumn = type === 'WSR' ? 'WSR #' : type === 'WSI' ? 'WSI #' : type === 'ESR' ? 'ESR#' : 'ESI#'
      const serialNo = row[serialColumn]
      if (!serialNo) continue
      if (existingSerials.has(String(serialNo))) continue // app-created record already exists - never overwrite it

      const rowWarehouseName = row['Warehouse Name']
      const rowWarehouseId = warehouseIdByName.get(rowWarehouseName) ?? warehouse.warehouseId

      const varietyByName = type === 'WSR' || type === 'WSI'
        ? new Map((await db.varietyTypes.toArray()).map((v) => [v.name.trim().toLowerCase(), v.varietyId]))
        : undefined

      const imported = mapSheetRowToTransaction(type, row, { warehouseId: rowWarehouseId, varietyByName })
      await db.transactions.add(imported)
      existingSerials.add(String(serialNo))

      const num = parseInt(String(serialNo).replace(/\D/g, ''), 10)
      if (!Number.isNaN(num) && (highestImportedSerial === null || num > highestImportedSerial)) {
        highestImportedSerial = String(serialNo)
      }
    }
  }

  if (highestImportedSerial) {
    await recordSerialUsed(type, warehouse.warehouseId, highestImportedSerial)
  }

  await db.preloadState.put({
    warehouseId: warehouse.warehouseId,
    type,
    complete: true,
    lastCheckedAt: new Date().toISOString(),
  })
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
