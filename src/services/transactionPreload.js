// Preloads a user's assigned warehouse(s) worth of transaction history
// from the Sheets backup into the local database, so that day-to-day
// navigation (stepping through serials, checking the floor) never
// needs a network round-trip - it's all local data by the time the
// user actually starts working.
//
// Design (confirmed with the user before building):
//  1. Fills in genuinely missing historical rows, and updates an
//     existing local record when the Sheet has a newer version of
//     it - but ONLY when that local record is already isSynced: true
//     (its own version has already reached the Sheet, so a fresh row
//     represents a real edit made directly on the Sheet, not a
//     conflict). A local record that is still pending its own push
//     is left completely untouched either way, protecting against
//     ever overwriting an in-progress, not-yet-synced local edit.
//     (Originally this only ever added missing rows and silently
//     ignored any existing one forever - revised per explicit
//     requirement that a manual Sheet edit should propagate back into
//     the app, not be permanently invisible to it.)
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
//  5. Admin and Visitor both have access to every warehouse (they
//     share the same all-warehouse AdminHome view), so both preload
//     ALL warehouses, not just an assigned subset - per explicit
//     request, since they need and have access to everything. A
//     regular user stays scoped to just their own assignedWarehouses.
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
import { fetchTransactionsBulk, mapSheetRowToTransaction, stripWarehouseCodePrefix } from './googleSheetsBridge.js'
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
  if (!user) return

  // One-time reset - see PRELOAD_RESET_FLAG below for the full
  // reasoning. Runs before anything else in this function so the
  // subsequent full-vs-incremental decision below is made against a
  // genuinely clean slate, not stale (and confirmed incorrect)
  // completion state.
  const PRELOAD_RESET_FLAG = 'preload-state-reset-v1'
  if (!localStorage.getItem(PRELOAD_RESET_FLAG)) {
    localStorage.setItem(PRELOAD_RESET_FLAG, 'done')
    // Confirmed root cause: the Sheet-side warehouse name matching
    // used exact string comparison against a name that includes a
    // code prefix (e.g. "ALB-ABACORP A") while the Sheet's own
    // Warehouse Name column does not have that prefix ("ABACORP A") -
    // every row for an affected warehouse was silently excluded from
    // every past fetch, yet the fetch itself still reported success,
    // so preloadState was marked complete despite having imported
    // nothing for that warehouse. Now fixed server-side, but every
    // device that already has complete: true recorded needs this
    // one-time reset to actually pick up what was missed - nothing
    // would otherwise ever trigger a fresh full pull again.
    await db.preloadState.clear()
  }

  // Second, separate one-time fix: records already imported by the
  // warehouse-matching bug above have their serialNo (and related
  // fields) stored as a NUMBER rather than a string - Google Sheets
  // returns a purely-numeric cell as a JS number, and the code that
  // read it was not coercing this before the bug above was fixed.
  // This is what caused both the "existing series shows no data" (a
  // number can never match a string typed by the user) and the
  // reported crash (.replace() does not exist on a number). This does
  // NOT require a slow full re-preload - it is a fast, local-only
  // pass over what already exists, fixing the type in place.
  //
  // Combined with a dedup pass in the same migration: the chaotic
  // sequence of fixes this session (Sheet-fallback import,
  // incremental sync import, and the field-type issue itself all
  // touching the same records around the same time) plausibly created
  // duplicate local records sharing the same (type, warehouseId,
  // serialNo, cerealCategory) - which directly explains a reported
  // false "already used" error on update, since isSerialTaken's
  // excludeId can only ever exclude the one specific record being
  // edited, not every duplicate sharing its serial.
  const FIELD_TYPE_FIX_FLAG = 'transaction-field-type-and-dedup-fix-v2'
  if (!localStorage.getItem(FIELD_TYPE_FIX_FLAG)) {
    try {
    const allLocalTx = await db.transactions.toArray()
    const STRING_FIELDS = ['serialNo', 'linkedDocNo', 'aiNumber', 'siaNumber', 'moNumber', 'tmoNumber', 'batchNumber', 'trialNumber']

    // Fix field types in memory first
    let typeFixCount = 0
    for (const tx of allLocalTx) {
      for (const field of STRING_FIELDS) {
        const value = tx[field]
        if (value != null && typeof value !== 'string') {
          tx[field] = String(value)
          typeFixCount++
        }
      }
    }

    // Group by the same key used for duplicate-serial checking
    // elsewhere in the app, then keep only the most complete record
    // per group - "most complete" meaning the most non-empty fields,
    // a reasonable proxy for "has actually been filled out" over a
    // bare, partially-imported stub.
    const groups = new Map()
    for (const tx of allLocalTx) {
      const key = `${tx.type}::${tx.warehouseId}::${tx.serialNo}::${tx.cerealCategory ?? ''}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(tx)
    }
    const completeness = (tx) => Object.values(tx).filter((v) => v != null && v !== '').length
    const toKeep = []
    const toDeleteIds = []
    for (const group of groups.values()) {
      if (group.length === 1) {
        toKeep.push(group[0])
        continue
      }
      const sorted = [...group].sort((a, b) => completeness(b) - completeness(a))
      toKeep.push(sorted[0])
      for (const dupe of sorted.slice(1)) toDeleteIds.push(dupe.id)
    }

    // bulkPut/bulkDelete - a single batched operation each, not one
    // await per record, which was the actual cause of the reported
    // slowdown when this ran against a large local dataset.
    await db.transactions.bulkPut(toKeep)
    if (toDeleteIds.length > 0) await db.transactions.bulkDelete(toDeleteIds)

    console.log(`transaction-field-type-and-dedup-fix-v2: corrected ${typeFixCount} field(s), removed ${toDeleteIds.length} duplicate record(s) out of ${allLocalTx.length} total`)
    localStorage.setItem(FIELD_TYPE_FIX_FLAG, 'done')
    } catch (error) {
      console.error('transaction-field-type-and-dedup-fix-v2 failed, will retry next load:', error)
    }
  }

  // Admin and Visitor both have access to every warehouse (they share
  // the same all-warehouse AdminHome view - see App.jsx), so both
  // preload everything rather than being skipped. A regular user stays
  // scoped to just their own assignedWarehouses - preloading every
  // warehouse in the branch for every regular user would be far more
  // than they'd ever need and needlessly expensive.
  const isBroadAccessRole = user.role === 'Admin' || user.role === 'Visitor'
  const warehouseIds = isBroadAccessRole
    ? (await db.warehouses.toArray()).map((w) => w.warehouseId)
    : (user.assignedWarehouses ?? [])
  if (warehouseIds.length === 0) return

  const warehouses = await db.warehouses.bulkGet(warehouseIds)
  const validWarehouses = warehouses.filter(Boolean)
  if (validWarehouses.length === 0) return

  const warehouseIdByName = new Map()
  for (const w of validWarehouses) {
    warehouseIdByName.set(w.name.trim(), w.warehouseId)
    const stripped = stripWarehouseCodePrefix(w.name).trim()
    if (stripped && stripped !== w.name.trim()) warehouseIdByName.set(stripped, w.warehouseId)
  }

  for (const type of PRELOAD_TYPES) {
    onProgress?.({ type, warehouseCount: validWarehouses.length })
    try {
      await preloadOneType(type, validWarehouses, warehouseIdByName)
    } catch (err) {
      // A failure in one type must not abort the others - without this,
      // an error partway through (e.g. WSR) would silently prevent
      // WSI/ESR/ESI from ever being attempted at all.
      console.error(`preloadTransactionsForUser: preload failed for ${type}:`, err)
    }
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

  // Existing local records for every one of these warehouses, fetched
  // once for the whole type rather than once per warehouse - avoids
  // one database query per fetched row later. Keyed by serial, storing
  // enough to decide add vs. update vs. protect for each row seen.
  const warehouseIds = warehouses.map((w) => w.warehouseId)
  const localTx = await db.transactions
    .where('type').equals(type)
    .and((tx) => warehouseIds.includes(tx.warehouseId))
    .toArray()
  const existingByWarehouse = new Map(warehouseIds.map((id) => [id, new Map()]))
  for (const tx of localTx) {
    existingByWarehouse.get(tx.warehouseId)?.set(String(tx.serialNo), { id: tx.id, isSynced: tx.isSynced })
  }

  const highestImportedByWarehouse = new Map()

  const processGroup = async (group, modifiedSince) => {
    if (group.length === 0) return
    const result = await fetchTransactionsBulk(type, group.map((w) => w.name), { modifiedSince })
    if (!result.ok) {
      console.error(`preloadOneType: fetchTransactionsBulk did not succeed for ${type}, warehouses:`, group.map((w) => w.name), result)
      return // network/offline - preloadState left as-is for this group, retried next login
    }

    const totalRowsSeen = result.bySource.reduce((sum, s) => sum + (s.ok ? s.rows.length : 0), 0)
    let importedCount = 0
    let updatedCount = 0
    let skippedNoWarehouseMatch = 0
    let skippedUnsyncedConflict = 0

    // Queried once for this entire batch, not once per row - the
    // previous per-row query was a real, avoidable performance cost
    // at the scale of a large Sheet.
    const varietyByName = type === 'WSR' || type === 'WSI'
      ? new Map((await db.varietyTypes.toArray()).map((v) => [v.name.trim().toLowerCase(), { varietyId: v.varietyId, category: v.category }]))
      : undefined
    const transactionTypesByName = new Map((await db.transactionTypes.toArray()).map((t) => [t.name.trim().toLowerCase(), t.transactionTypeId]))

    for (const sourceResult of result.bySource) {
      if (!sourceResult.ok) continue
      for (const row of sourceResult.rows) {
        const serialNo = row[SERIAL_COLUMN_BY_TYPE[type]]
        if (!serialNo) continue

        const rowWarehouseName = row['Warehouse Name']
        const rowWarehouseId = warehouseIdByName.get(String(rowWarehouseName ?? '').trim())
        if (!rowWarehouseId) {
          skippedNoWarehouseMatch++
          continue // row belongs to a warehouse outside this batch, OR the name didn't match anything we're looking for - skip
        }

        const existingRecords = existingByWarehouse.get(rowWarehouseId)
        const existing = existingRecords?.get(String(serialNo))

        const imported = mapSheetRowToTransaction(type, row, { warehouseId: rowWarehouseId, varietyByName, transactionTypesByName })

        if (existing) {
          // A record for this serial already exists locally. Only
          // updates it if that local record is already isSynced:
          // true - meaning its own version has already reached the
          // Sheet, so this fresh row (which modifiedSince filtering
          // already confirms genuinely changed) represents a real,
          // separate edit made directly on the Sheet, not a conflict
          // with any local, not-yet-pushed change. Preserves the
          // original protection for the narrower case where a local
          // edit is still pending - that case still defers entirely
          // to the local version, unchanged from before.
          if (existing.isSynced) {
            await db.transactions.update(existing.id, imported)
            updatedCount++
          } else {
            skippedUnsyncedConflict++
          }
          continue
        }

        await db.transactions.add(imported)
        existingRecords?.set(String(serialNo), { id: imported.id, isSynced: true })
        importedCount++

        const num = parseInt(String(serialNo).replace(/\D/g, ''), 10)
        if (!Number.isNaN(num)) {
          const current = highestImportedByWarehouse.get(rowWarehouseId)
          if (!current || num > current.num) {
            highestImportedByWarehouse.set(rowWarehouseId, { num, serialNo: String(serialNo) })
          }
        }
      }
    }

    console.log(`preloadOneType(${type}): saw ${totalRowsSeen} row(s) from the Sheet, imported ${importedCount}, updated ${updatedCount}, skipped ${skippedNoWarehouseMatch} for no warehouse-name match, skipped ${skippedUnsyncedConflict} for an unsynced local conflict (expected names: ${group.map((w) => w.name).join(', ')})`)

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

  const groupResults = await Promise.allSettled([
    processGroup(needsFull, undefined),
    processGroup(needsIncremental, oldestIncrementalCheck),
  ])
  groupResults.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`preloadOneType: ${i === 0 ? 'full-pull' : 'incremental'} group failed for ${type}:`, result.reason)
    }
  })

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
