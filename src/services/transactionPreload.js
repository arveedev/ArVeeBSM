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
import { fetchTransactionsBulk, mapSheetRowToTransaction, stripWarehouseCodePrefix, markRowsSeen, isWtsBackupSerial } from './googleSheetsBridge.js'
import { recordSerialUsed } from '../utils/serialNumber.js'

const PRELOAD_TYPES = ['WSR', 'WSI', 'ESR', 'ESI']
const SERIAL_COLUMN_BY_TYPE = { WSR: 'WSR #', WSI: 'WSI #', ESR: 'ESR#', ESI: 'ESI#' }

const FIELDS_TO_COMPARE = [
  'type', 'warehouseId', 'date', 'status', 'customerName', 'needsCompletion', 'transactionTypeId',
  'serialNo', 'linkedDocNo', 'aiNumber', 'varietyId', 'cerealCategory', 'numberOfBags', 'netKilos',
  'grossKilos', 'autoComputeNet', 'pileId', 'mtsSackTypeId', 'mtsCondition', 'moistureContent',
  'condition', 'ageValue', 'ageUnit', 'initialAgeValue', 'moNumber', 'tmoNumber', 'batchNumber',
  'trialNumber', 'totalPiecesRaw',
]

// Single-flight guard: startTransactionSyncWorker fires this on a 30s
// interval AND on every 'online' event, on top of the one-off call at
// login - a run that takes longer than 30s (a large multi-warehouse
// admin pull on a slow connection, entirely plausible) or an 'online'
// event landing mid-run would otherwise start a SECOND, fully
// overlapping pass. Since preloadOneType's own-row dedup only checks
// against a snapshot taken at the start of ITS run, two overlapping
// passes each see the same Sheet row as "not yet imported" and both
// add() it with a fresh random id - a confirmed, reproduced cause of
// the duplicate local transactions the consolidated-fix migrations
// above were mopping up after the fact. A concurrent caller now just
// awaits whichever pass is already in flight instead of starting its
// own.
let inFlightPreload = null

/**
 * Preloads transaction history for every warehouse the given user is
 * assigned to. Safe to call on every login - already-complete
 * (warehouseId, type) combinations just do a quick incremental check
 * instead of a full re-pull. onProgress(status) is called before each
 * type's batch, e.g. for a UI progress indicator.
 */
export const preloadTransactionsForUser = async (user, { onProgress } = {}) => {
  if (inFlightPreload) return inFlightPreload
  inFlightPreload = runPreloadTransactionsForUser(user, { onProgress })
  try {
    await inFlightPreload
  } finally {
    inFlightPreload = null
  }
}

const runPreloadTransactionsForUser = async (user, { onProgress } = {}) => {
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

  // CONSOLIDATED: the three migrations below (hasBeenBackedUp fix,
  // condition default, and dedup merge) each used to read the ENTIRE
  // transactions table separately - on a device where they hadn't all
  // completed yet, a single login could trigger three full-table
  // reads and three separate bulkPut/bulkDelete rounds in sequence,
  // directly competing with the same table any save operation needs
  // to write to. Confirmed as the cause of a severe reported slowdown
  // (multi-minute UI freezes on save). Now a single pass: one read,
  // all three fixes applied in memory, one write - only for records
  // that actually changed by any of the three fixes, not the whole
  // table indiscriminately. Sets every old flag too, so this never
  // re-does work a device already completed individually.
  const HAS_BEEN_BACKED_UP_FIX_FLAG = 'sheet-import-has-been-backed-up-fix-v2'
  const STOCK_CONDITION_DEFAULT_FIX_FLAG = 'stock-condition-null-to-gq-fix-v1'
  // Bumped v6 -> v7: checkAndLoadSerial's Sheet-import fallback
  // (StockFormBase.jsx) had no protection at all against a local
  // record already existing under a MISMATCHED cerealCategory value -
  // its own local lookup was category-scoped with no fallback, so a
  // record like that was invisible to it and got duplicated fresh from
  // the Sheet on every visit (the Sheet has no Pile ID/MC/MTS columns
  // at all, so every such duplicate arrived stripped of exactly those
  // fields - the confirmed, reproduced cause of "my pile info
  // disappeared and there's a duplicate"). That gap is now closed
  // (checkAndLoadSerial and findAdjacentTransaction both fall back to
  // an uncategorized lookup before ever creating a new record), but
  // devices that already got hit by it still have the duplicates
  // sitting in local storage - v7 re-runs the same proven merge to
  // clean those up too.
  const DEDUP_MERGE_FLAG = 'transaction-dedup-merge-v7'
  const CONSOLIDATED_FIX_FLAG = 'transaction-consolidated-fix-v7'
  const stillNeedsAny = [HAS_BEEN_BACKED_UP_FIX_FLAG, STOCK_CONDITION_DEFAULT_FIX_FLAG, DEDUP_MERGE_FLAG, CONSOLIDATED_FIX_FLAG]
    .some((flag) => !localStorage.getItem(flag))
  if (stillNeedsAny) {
    try {
      const allTx = await db.transactions.toArray() // the one and only full-table read for all three fixes combined
      const modifiedById = new Map()
      const markModified = (tx) => modifiedById.set(tx.id, tx)

      // Fix 1: hasBeenBackedUp for sheet-imported records - without
      // this, editing an already-imported record would incorrectly
      // append a duplicate row on next sync instead of updating it.
      for (const tx of allTx) {
        if (tx.fromSheetImport === true && tx.hasBeenBackedUp !== true) {
          tx.hasBeenBackedUp = true
          markModified(tx)
        }
      }

      // Fix 2: default missing condition to GQ for stock types - the
      // Sheet never tracked a condition column, so every imported
      // stock row previously arrived with condition: null.
      for (const tx of allTx) {
        if (['WSR', 'WSI', 'WTS'].includes(tx.type) && tx.condition === null) {
          tx.condition = 'GQ'
          markModified(tx)
        }
      }

      // Fix 3: field-level merge dedup - combines every duplicate's
      // fields into one surviving record before removing the rest, so
      // no data anywhere in a duplicate group is lost. Survivor
      // prefers a record NOT from a Sheet import when one exists.
      const groups = new Map()
      for (const tx of allTx) {
        const key = `${tx.type}::${tx.warehouseId}::${tx.serialNo}::${tx.cerealCategory ?? ''}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(tx)
      }
      const completeness = (tx) => Object.values(tx).filter((v) => v != null && v !== '').length
      const toDeleteIds = []
      let mergeCount = 0
      for (const group of groups.values()) {
        if (group.length <= 1) continue
        mergeCount++
        const nonImported = group.filter((tx) => tx.fromSheetImport !== true)
        const survivorPool = nonImported.length > 0 ? nonImported : group
        const survivor = [...survivorPool].sort((a, b) => completeness(b) - completeness(a))[0]
        const others = group.filter((tx) => tx.id !== survivor.id)
        for (const other of others) {
          for (const [field, value] of Object.entries(other)) {
            if (field === 'id') continue
            if ((survivor[field] == null || survivor[field] === '') && value != null && value !== '') survivor[field] = value
          }
        }
        markModified(survivor)
        for (const other of others) toDeleteIds.push(other.id)
      }

      const toDeleteIdSet = new Set(toDeleteIds)
      const toUpdate = [...modifiedById.values()].filter((tx) => !toDeleteIdSet.has(tx.id))
      if (toUpdate.length > 0) await db.transactions.bulkPut(toUpdate)
      if (toDeleteIds.length > 0) await db.transactions.bulkDelete(toDeleteIds)

      console.log(`transaction-consolidated-fix-v7: updated ${toUpdate.length} record(s), merged/removed ${toDeleteIds.length} duplicate(s) across ${mergeCount} group(s), out of ${allTx.length} total local transactions`)
      localStorage.setItem(HAS_BEEN_BACKED_UP_FIX_FLAG, 'done')
      localStorage.setItem(STOCK_CONDITION_DEFAULT_FIX_FLAG, 'done')
      localStorage.setItem(DEDUP_MERGE_FLAG, 'done')
      localStorage.setItem(CONSOLIDATED_FIX_FLAG, 'done')
    } catch (error) {
      console.error('transaction-consolidated-fix-v7 failed, will retry next load:', error)
    }
  }

  // Re-runs the same proven duplicate merge as transaction-consolidated-
  // fix-v7 above, one more time - v7 already fired and permanently
  // marked itself done on most devices well before this specific
  // duplicate-causing gap (see checkAndLoadSerial's uncategorized-lookup
  // fallback) was closed, so any duplicate created between those two
  // events is invisible to v7's one-time flag forever and sits there
  // causing exactly the reported false "serial already in use" on
  // update (isSerialTaken's excludeId can only ever exclude the one
  // record actually being edited, not a sibling duplicate sharing its
  // serial) and the "pulled from historical Sheet data" banner
  // reappearing on a record that really was already fully encoded
  // in-app, just under its duplicate's stale copy.
  const DEDUP_MERGE_V8_FLAG = 'transaction-dedup-merge-v8'
  if (!localStorage.getItem(DEDUP_MERGE_V8_FLAG)) {
    try {
      const allTx = await db.transactions.toArray()
      const groups = new Map()
      for (const tx of allTx) {
        const key = `${tx.type}::${tx.warehouseId}::${tx.serialNo}::${tx.cerealCategory ?? ''}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(tx)
      }
      const completeness = (tx) => Object.values(tx).filter((v) => v != null && v !== '').length
      const toDeleteIds = []
      let mergeCount = 0
      const toUpdate = []
      for (const group of groups.values()) {
        if (group.length <= 1) continue
        mergeCount++
        const nonImported = group.filter((tx) => tx.fromSheetImport !== true)
        const survivorPool = nonImported.length > 0 ? nonImported : group
        const survivor = [...survivorPool].sort((a, b) => completeness(b) - completeness(a))[0]
        const others = group.filter((tx) => tx.id !== survivor.id)
        for (const other of others) {
          for (const [field, value] of Object.entries(other)) {
            if (field === 'id') continue
            if ((survivor[field] == null || survivor[field] === '') && value != null && value !== '') survivor[field] = value
          }
        }
        toUpdate.push(survivor)
        for (const other of others) toDeleteIds.push(other.id)
      }
      if (toUpdate.length > 0) await db.transactions.bulkPut(toUpdate)
      if (toDeleteIds.length > 0) await db.transactions.bulkDelete(toDeleteIds)
      console.log(`transaction-dedup-merge-v8: merged/removed ${toDeleteIds.length} duplicate(s) across ${mergeCount} group(s), out of ${allTx.length} total`)
      localStorage.setItem(DEDUP_MERGE_V8_FLAG, 'done')
    } catch (error) {
      console.error('transaction-dedup-merge-v8 failed, will retry next load:', error)
    }
  }

  // One-time backfill: every record ever imported from the Sheet has
  // createdAt missing (the Sheet has no timestamp column - see
  // mapSheetRowToTransaction), which used to be silently tolerated by
  // compareByRecency's old per-pair fallback. That comparator is now
  // fixed (see serialNumber.js) to always use a consistent order, but a
  // record with NO createdAt still sorts purely by serial-number
  // magnitude among its same-day peers - fine within a single booklet,
  // wrong whenever two different-numbered booklets/series were both
  // used on the same calendar day (a confirmed, reported case: Next/
  // Previous stepping jumped across a real document instead of landing
  // on it, or landed back in the wrong series entirely). Backfills a
  // real ordinal from the Sheet's own row order - an append-only usage
  // log, so row order is a genuine proxy for the order two booklets were
  // actually used in - the same signal a fresh import now records
  // going forward (see the ordinal logic in processGroup above).
  const CREATED_AT_BACKFILL_FLAG = 'transaction-createdat-backfill-v1'
  if (!localStorage.getItem(CREATED_AT_BACKFILL_FLAG)) {
    try {
      const missing = await db.transactions.filter((tx) => tx.createdAt == null).toArray()
      if (missing.length === 0) {
        localStorage.setItem(CREATED_AT_BACKFILL_FLAG, 'done')
      } else {
        const allWarehouses = await db.warehouses.toArray()
        const nameByWarehouseId = new Map(allWarehouses.map((w) => [w.warehouseId, w.name]))
        let totalPatched = 0
        for (const type of PRELOAD_TYPES) {
          const missingForType = missing.filter((tx) => tx.type === type)
          if (missingForType.length === 0) continue
          const missingBySerial = new Map(
            missingForType.map((tx) => [`${tx.warehouseId}::${String(tx.serialNo)}`, tx])
          )
          const warehouseIdsNeeded = [...new Set(missingForType.map((tx) => tx.warehouseId))]
          const warehousesNeeded = warehouseIdsNeeded
            .map((warehouseId) => ({ warehouseId, name: nameByWarehouseId.get(warehouseId) }))
            .filter((w) => w.name)
          if (warehousesNeeded.length === 0) continue

          const result = await fetchTransactionsBulk(type, warehousesNeeded.map((w) => w.name))
          if (!result.ok) continue // network/offline - retried next login, flag stays unset
          const warehouseIdByName = new Map(warehousesNeeded.map((w) => [w.name.trim(), w.warehouseId]))

          const patches = []
          for (const sourceResult of result.bySource) {
            if (!sourceResult.ok) continue
            const sameDayOrdinal = new Map()
            for (const row of sourceResult.rows) {
              const serialNo = row[SERIAL_COLUMN_BY_TYPE[type]]
              if (!serialNo || isWtsBackupSerial(String(serialNo))) continue
              const rowWarehouseName = row['Warehouse Name']
              const rowWarehouseId = warehouseIdByName.get(String(rowWarehouseName ?? '').trim())
              if (!rowWarehouseId) continue

              const rawDate = row['Date']
              const date = typeof rawDate === 'string' && rawDate.includes('T') ? rawDate.slice(0, 10) : (rawDate ?? '')
              const dayKey = `${rowWarehouseId}::${date}`
              const ordinal = sameDayOrdinal.get(dayKey) ?? 0
              sameDayOrdinal.set(dayKey, ordinal + 1)

              const localTx = missingBySerial.get(`${rowWarehouseId}::${String(serialNo)}`)
              if (localTx) patches.push({ id: localTx.id, createdAt: ordinal })
            }
          }
          if (patches.length > 0) {
            await db.transactions.bulkUpdate(patches.map((p) => ({ key: p.id, changes: { createdAt: p.createdAt } })))
            totalPatched += patches.length
          }
        }
        console.log(`transaction-createdat-backfill-v1: patched createdAt on ${totalPatched} of ${missing.length} record(s) missing it`)
        localStorage.setItem(CREATED_AT_BACKFILL_FLAG, 'done')
      }
    } catch (error) {
      console.error('transaction-createdat-backfill-v1 failed, will retry next load:', error)
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

/**
 * Closes a race distinct from the WTS-backup-serial one above: this
 * function's own local-data snapshot (existingByWarehouse, taken once
 * up front) can miss a save that completes - and gets backed up to the
 * Sheet - in the moments between that snapshot and this same preload
 * cycle's own Sheet fetch. When that happens, the row it just fetched
 * looks like a genuinely new one, and gets imported as a second, blank
 * placeholder copy of the record someone just finished saving, all on
 * one device, no multi-device timing required (confirmed live: WSR #1
 * ended up duplicated seconds after being saved, on the same session).
 * Reuses the exact same "real record wins over a blank Sheet-import
 * placeholder" rule as findTransactionBySerial's own self-heal
 * (serialNumber.js), scoped to just the warehouses this cycle touched.
 */
const dedupeStaleSheetPlaceholders = async (type, warehouseIds) => {
  if (warehouseIds.length === 0) return
  const rows = await db.transactions
    .where('type').equals(type)
    .and((tx) => warehouseIds.includes(tx.warehouseId))
    .toArray()
  const groups = new Map()
  for (const tx of rows) {
    const key = `${tx.warehouseId}::${tx.serialNo}::${tx.cerealCategory ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(tx)
  }
  const isPlaceholder = (tx) => tx.fromSheetImport && tx.needsCompletion && !tx.pileId
  const idsToDelete = []
  for (const group of groups.values()) {
    if (group.length <= 1) continue
    const real = group.find((tx) => !isPlaceholder(tx)) ?? group[0]
    for (const tx of group) {
      if (tx.id !== real.id && isPlaceholder(tx)) idsToDelete.push(tx.id)
    }
  }
  if (idsToDelete.length > 0) {
    await db.transactions.bulkDelete(idsToDelete)
    console.log(`preloadOneType(${type}): self-healed ${idsToDelete.length} duplicate Sheet-import placeholder(s) left by a same-device save/preload race`)
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
  // Keyed by serial AND cerealCategory, not serial alone - WSR/WSI
  // deliberately keep separate Rice/Palay series per warehouse (see
  // serialNumber.js's own header comment: the same number can
  // legitimately exist in both), so a serial-only key here would let a
  // warehouse's Rice "WSR #50" and Palay "WSR #50" overwrite each other
  // in this map, and then have an incoming Sheet row for one silently
  // matched against - and merged into - the other's local record. ESR/
  // ESI/WTS have no cerealCategory dimension, so their rows all key on
  // `''`, unaffected.
  const existingByWarehouse = new Map(warehouseIds.map((id) => [id, new Map()]))
  for (const tx of localTx) {
    existingByWarehouse.get(tx.warehouseId)?.set(`${tx.serialNo}::${tx.cerealCategory ?? ''}`, tx)
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
    let skippedUnchanged = 0

    // Queried once for this entire batch, not once per row - the
    // previous per-row query was a real, avoidable performance cost
    // at the scale of a large Sheet.
    const varietyByName = type === 'WSR' || type === 'WSI'
      ? new Map((await db.varietyTypes.toArray()).map((v) => [v.name.trim().toLowerCase(), { varietyId: v.varietyId, category: v.category }]))
      : undefined
    const transactionTypesByName = new Map((await db.transactionTypes.toArray()).map((t) => [t.name.trim().toLowerCase(), t.transactionTypeId]))

    for (const sourceResult of result.bySource) {
      if (!sourceResult.ok) continue
      const seenSerialsForThisSource = []
      // The Sheet has no timestamp column, so a freshly-imported row has
      // no real createdAt - but its ROW ORDER in the Sheet (an append-only
      // usage log) is a real, meaningful proxy for the actual order two
      // different booklets/series were used in on the same calendar day.
      // Counted per (warehouse, date) so it only ever matters as a
      // same-day tiebreaker (compareByRecency checks date first) and
      // never collides with a live in-app save's real Date.now() value,
      // which is always far larger than this small ordinal.
      const sameDayOrdinal = new Map()
      for (const row of sourceResult.rows) {
        const serialNo = row[SERIAL_COLUMN_BY_TYPE[type]]
        if (!serialNo) continue
        // WTS writes its own two rows into these SAME receipts/issues
        // sheets, for a human reviewing the sheet directly - see
        // googleSheetsBridge.js's wtsBackupSerial. Those aren't real
        // WSR/WSI documents and must never be imported as one - a real
        // WTS produced two bogus local WSR + two bogus WSI transactions
        // this way before this guard existed (confirmed via live data).
        if (isWtsBackupSerial(String(serialNo))) continue

        const rowWarehouseName = row['Warehouse Name']
        const rowWarehouseId = warehouseIdByName.get(String(rowWarehouseName ?? '').trim())
        if (!rowWarehouseId) {
          skippedNoWarehouseMatch++
          continue // row belongs to a warehouse outside this batch, OR the name didn't match anything we're looking for - skip
        }

        seenSerialsForThisSource.push(String(serialNo))

        const imported = mapSheetRowToTransaction(type, row, { warehouseId: rowWarehouseId, varietyByName, transactionTypesByName })
        const existingRecords = existingByWarehouse.get(rowWarehouseId)
        const existing = existingRecords?.get(`${serialNo}::${imported.cerealCategory ?? ''}`)

        // Advances for every row seen (existing or new), not just fresh
        // imports, so the ordinal always reflects this row's true position
        // in the Sheet's own order relative to its same-day neighbors.
        const dayKey = `${rowWarehouseId}::${imported.date}`
        const ordinal = sameDayOrdinal.get(dayKey) ?? 0
        sameDayOrdinal.set(dayKey, ordinal + 1)

        if (existing) {
          // Only writes if that local record is already isSynced:
          // true (protecting a genuinely pending local edit, exactly
          // as before) AND the incoming data is actually different
          // from what's already stored. This second check is the
          // critical piece: the server can never fully guarantee
          // modifiedSince excludes every unchanged row (an un-stamped
          // historical row has no timestamp to filter on, so it's
          // always included rather than risk dropping a real change) -
          // without this, every one of those rows would be rewritten
          // every single cycle forever, which is the confirmed,
          // direct cause of the endless sync loop and the resulting
          // slowdown this was meant to prevent in the first place.
          if (existing.isSynced) {
            const changed = FIELDS_TO_COMPARE.some((field) => existing[field] !== imported[field])
            if (changed) {
              // CRITICAL: merge, never blanket-replace. Several fields
              // (pileId, mtsSackTypeId, mtsCondition, condition,
              // grossKilos) are permanently null in every
              // mapSheetRowToTransaction result, since the Sheet has
              // no columns for them at all - it's not that they
              // "became" null, the Sheet simply never tracked them.
              // A blanket update() here would silently destroy real,
              // locally-completed data the moment this sync ran,
              // replacing it with null - the confirmed, direct cause
              // of data loss reported after this exact code first
              // shipped. Only ever applies a field from imported when
              // it actually has a real value, or when the local field
              // was already empty - a genuine local value can never
              // be overwritten by a field the Sheet never had.
              const patch = {}
              for (const field of FIELDS_TO_COMPARE) {
                const incomingValue = imported[field]
                const hasIncomingValue = incomingValue != null && incomingValue !== ''
                const hasExistingValue = existing[field] != null && existing[field] !== ''
                if (hasIncomingValue || !hasExistingValue) patch[field] = incomingValue
              }
              await db.transactions.update(existing.id, patch)
              updatedCount++
            } else {
              skippedUnchanged++
            }
          } else {
            skippedUnsyncedConflict++
          }
          continue
        }

        imported.createdAt = ordinal
        await db.transactions.add(imported)
        existingRecords?.set(`${serialNo}::${imported.cerealCategory ?? ''}`, { id: imported.id, isSynced: true })
        importedCount++

        const num = parseInt(String(serialNo).replace(/\D/g, ''), 10)
        if (!Number.isNaN(num)) {
          const current = highestImportedByWarehouse.get(rowWarehouseId)
          if (!current || num > current.num) {
            highestImportedByWarehouse.set(rowWarehouseId, { num, serialNo: String(serialNo) })
          }
        }
      }

      // Fire-and-forget - never awaited, so this purely-optimizational
      // "mark as seen" call can never delay or block the actual
      // preload flow it's attached to. markRowsSeen is itself
      // best-effort and never throws.
      markRowsSeen(type, sourceResult.sourceId, seenSerialsForThisSource)
    }

    console.log(`preloadOneType(${type}): saw ${totalRowsSeen} row(s) from the Sheet, imported ${importedCount}, updated ${updatedCount}, skipped ${skippedUnchanged} unchanged, skipped ${skippedNoWarehouseMatch} for no warehouse-name match, skipped ${skippedUnsyncedConflict} for an unsynced local conflict (expected names: ${group.map((w) => w.name).join(', ')})`)

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

  await dedupeStaleSheetPlaceholders(type, warehouseIds)

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
