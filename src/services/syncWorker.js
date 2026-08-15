// Background synchronization engine.
//
// Scans the local Dexie `transactions` table for records that have not yet
// been backed up to the Google Sheet (isSynced === false - repurposed from
// an earlier Firestore-based design; Firestore was never actually
// configured with real credentials and has been removed entirely -
// Dexie Cloud is the device-to-device sync layer, this worker's only job
// now is the Sheets backup log), pushes each one, and flips the local
// isSynced flag to true once the Sheet confirms the write.

import toast from 'react-hot-toast'
import { db } from '../db/dexie.js'
import { pushTransactionBackup, updateTransactionBackup, deleteTransactionBackup, syncAuthoritiesFromSheets, syncMillingOrdersFromSheets } from './googleSheetsBridge.js'
import { preloadTransactionsForUser } from './transactionPreload.js'

let isSyncing = false

/**
 * Process the local backup queue: push every not-yet-backed-up
 * transaction to the Google Sheet (appending it the first time,
 * updating its existing row on any later re-sync after an edit), then
 * drains any queued offline deletions. Returns a summary of how many
 * records were synced / failed, so the UI can surface results via toast.
 */
export const processSyncQueue = async () => {
  // Cross-tab lock: if the app is open in more than one tab (a common,
  // easy-to-miss scenario - e.g. one tab running the app, another open
  // to watch the Google Sheet directly), each tab previously had its
  // own independent isSyncing flag with no way to see the other tab's
  // state. Two tabs could each read the same pending transaction as
  // unsynced and push it to the Sheet separately, both succeeding,
  // before either had a chance to mark it done - producing a genuine
  // duplicate row. The Web Locks API coordinates this correctly across
  // every tab/window of the same origin, not just within one JS
  // context. Falls back to the plain in-memory flag (same-tab
  // protection only) if this API isn't available in a given browser.
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('bsm-sync-queue-lock', { ifAvailable: true }, (lock) => {
      if (!lock) return { synced: 0, failed: 0, skipped: true }
      return runSyncQueue()
    })
  }
  if (isSyncing) {
    return { synced: 0, failed: 0, skipped: true }
  }
  isSyncing = true
  try {
    return await runSyncQueue()
  } finally {
    isSyncing = false
  }
}

const runSyncQueue = async () => {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0, offline: true }
  }

  let synced = 0
  let failed = 0

  try {
    // .filter() is used instead of .where('isSynced').equals(false) because
    // IndexedDB cannot reliably index boolean values across browsers —
    // filter() guarantees every record is checked regardless of index support.
    const pending = await db.transactions.filter((tx) => tx.isSynced === false && !tx.isInitialBalance).toArray()

    for (const tx of pending) {
      try {
        // warehouseId is a direct field on every transaction type - using
        // it directly (rather than deriving it via the pile) also
        // correctly handles Cancelled records, which have pileId: null
        // but still carry their own warehouseId; deriving via pile alone
        // would leave a cancelled record's Sheet row with blank
        // warehouse info.
        const warehouse = tx.warehouseId ? await db.warehouses.get(tx.warehouseId) : null
        const province = warehouse ? await db.provinces.get(warehouse.provinceId) : null
        const transactionType = tx.transactionTypeId
          ? await db.transactionTypes.get(tx.transactionTypeId)
          : null

        const context = {
          warehouseCode: warehouse?.code ?? null,
          warehouseName: warehouse?.name ?? null,
          provinceCode: province?.code ?? null,
          transactionTypeName: transactionType?.name ?? null,
        }

        if (tx.type === 'WTS') {
          const issuedVariety = tx.issuedVarietyId ? await db.varietyTypes.get(tx.issuedVarietyId) : null
          const receivedVariety = tx.receivedVarietyId ? await db.varietyTypes.get(tx.receivedVarietyId) : null
          context.issuedVarietyName = issuedVariety?.name ?? null
          context.receivedVarietyName = receivedVariety?.name ?? null
        } else {
          const variety = tx.varietyId ? await db.varietyTypes.get(tx.varietyId) : null
          context.varietyName = variety?.name ?? null
        }

        // hasBeenBackedUp persists even after isSynced is reset to false
        // by a later edit - it's what tells this apart from a genuinely
        // new, never-backed-up transaction, so an edit updates the
        // existing Sheet row instead of appending a stale duplicate.
        const result = tx.hasBeenBackedUp
          ? await updateTransactionBackup(tx, context)
          : await pushTransactionBackup(tx, context)

        if (result.ok) {
          await db.transactions.update(tx.id, { isSynced: true, hasBeenBackedUp: true })
          synced += 1
        } else {
          console.error(
            `Sheets backup ${tx.hasBeenBackedUp ? 'update' : 'append'} failed for ${tx.type} ${tx.serialNo}:`,
            result
          )
          failed += 1
        }
      } catch (err) {
        console.error(`Sheets backup failed for transaction ${tx.id} (${tx.type} ${tx.serialNo}):`, err)
        failed += 1
      }
    }

    // Drain queued offline deletions - by the time these can retry, the
    // local transaction record itself is already gone (a real hard
    // delete happens immediately, locally), so only serialNo/type
    // survive to replay the deletion against the Sheet.
    const queuedDeletions = await db.pendingSheetDeletions.toArray()
    for (const deletion of queuedDeletions) {
      try {
        const result = await deleteTransactionBackup(deletion.serialNo, deletion.type, deletion.warehouseCode)
        if (result.ok) {
          if (result.found === false) {
            toast.error(`${deletion.type} ${deletion.serialNo} deleted locally, but no matching row was found on the Sheet — please verify manually`, { duration: 10000 })
          }
          await db.pendingSheetDeletions.delete(deletion.id)
          synced += 1
        } else {
          console.error(`Sheets delete-backup failed for ${deletion.type} ${deletion.serialNo}:`, result)
          failed += 1
        }
      } catch (err) {
        console.error(`Sheets delete-backup failed for serial ${deletion.serialNo}:`, err)
        failed += 1
      }
    }
  } finally {
    isSyncing = false
  }

  return { synced, failed }
}

/**
 * Registers a hook that fires an immediate (best-effort) sync attempt
 * whenever ANY new transaction record is created, on top of the
 * existing on-load/on-reconnect triggers. Without this, a user who
 * stays continuously online and saves several transactions in a row
 * would have nothing upload until the next unrelated 'online' event or
 * app reload - which might never happen in a single long session.
 * Centralized on the Dexie table itself (rather than added to every
 * form's own save handler individually) so it can never be missed by a
 * future form that saves transactions a different way. Deferred to the
 * next tick so the Dexie transaction this hook runs inside fully
 * commits before processSyncQueue queries the table again; fire-and-
 * forget since processSyncQueue already guards against overlapping runs
 * and handles its own errors.
 */
/**
 * Call this when a transaction is deleted locally, so the deletion
 * also reflects in the Sheet backup. Tries immediately; if that fails
 * (offline, or any other error), queues it in pendingSheetDeletions so
 * the next successful sync retries it - the local transaction record
 * is already gone by then (a real hard delete happens immediately), so
 * only serialNo/type need to survive to replay the deletion later.
 */
export const queueTransactionDeletion = async (serialNo, type, warehouseCode) => {
  try {
    const result = await deleteTransactionBackup(serialNo, type, warehouseCode)
    if (result.ok) {
      // The Apps Script side reports SUCCESS even when it couldn't find
      // a matching row to delete (see deleteTransaction's own comment) -
      // that used to look identical to an actual delete, so a row on a
      // different date-ranged sheet source (or any other mismatch) was
      // silently left behind forever with no signal to the user. Not
      // re-queued here since retrying against the same source won't
      // find it any better the second time - surfacing it is the only
      // useful next step, so the user can go check the Sheet by hand.
      if (result.found === false) {
        toast.error(`${type} ${serialNo} deleted locally, but no matching row was found on the Sheet — please verify manually`, { duration: 10000 })
      }
      return
    }
  } catch {
    // fall through to queueing below
  }
  await db.pendingSheetDeletions.add({ id: crypto.randomUUID(), serialNo, type, warehouseCode })
}

let immediateSyncRegistered = false

export const registerImmediateSyncOnSave = () => {
  if (immediateSyncRegistered) return
  immediateSyncRegistered = true
  db.transactions.hook('creating', () => {
    setTimeout(() => { processSyncQueue() }, 0)
  })
  // Editing an existing transaction (db.transactions.update) is a
  // completely separate Dexie hook from creating a new one - without
  // this, an edit with no other new transaction happening to be saved
  // afterward would never sync until the 5-minute timer or a reload,
  // exactly the gap reported: "updates only sync when the user makes
  // another transaction".
  db.transactions.hook('updating', () => {
    setTimeout(() => { processSyncQueue() }, 0)
  })
}

/**
 * Attach a listener so the sync queue is processed automatically whenever
 * connectivity is restored, and once on initial load if already online.
 *
 * @param {(result: {synced: number, failed: number}) => void} [onSyncComplete]
 *   Optional callback invoked with the result of each sync pass (e.g. to
 *   surface a toast notification).
 * @returns {() => void} cleanup function to remove the listener
 */
export const startSyncWorker = (onSyncComplete) => {
  const runSync = async () => {
    const result = await processSyncQueue()
    if (onSyncComplete) onSyncComplete(result)
  }

  window.addEventListener('online', runSync)

  if (navigator.onLine) {
    runSync()
  }

  return () => window.removeEventListener('online', runSync)
}

const AUTHORITY_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Periodically pulls fresh AI/SIA allocation data from the configured
 * Google Sheet (Phase 6) — runs once immediately (if online and
 * configured), then on a fixed interval, and again whenever connectivity
 * is restored. Silently no-ops if the Sheets bridge hasn't been configured
 * yet (see the Admin Dashboard's "Google Sheets" tab).
 *
 * @param {(result: object) => void} [onSyncComplete] optional callback,
 *   invoked only for sync attempts that actually ran (not skipped because
 *   offline/unconfigured) — useful for a subtle toast on manual triggers,
 *   but the periodic/background runs typically pass nothing so as not to
 *   spam the user with toasts they didn't ask for.
 * @returns {() => void} cleanup function
 */
export const startAuthoritySyncWorker = () => {
  let cancelled = false

  const runSync = async () => {
    if (cancelled) return
    await syncAuthoritiesFromSheets()
    await syncMillingOrdersFromSheets()
  }

  runSync()

  const intervalId = setInterval(runSync, AUTHORITY_SYNC_INTERVAL_MS)
  window.addEventListener('online', runSync)

  return () => {
    cancelled = true
    clearInterval(intervalId)
    window.removeEventListener('online', runSync)
  }
}

// 30 seconds, per explicit request - deliberately far more frequent
// than the 5-minute authority sync above, given the higher stakes of
// keeping transaction data (and therefore duplicate-series checking)
// genuinely current. Cheap to run this often: preloadOneType already
// only re-pulls in full for a (warehouse, type) combination that has
// never completed a first preload - everything after that is a
// lightweight, modifiedSince-filtered "what actually changed" check,
// not a full re-fetch every time.
const TRANSACTION_SYNC_INTERVAL_MS = 30 * 1000

/**
 * Periodically re-runs preloadTransactionsForUser - the missing half
 * of the incremental sync design already built into
 * transactionPreload.js, which previously only ever ran once at
 * login. Runs once immediately, then on a fixed 30-second interval,
 * and again whenever connectivity is restored (mirroring
 * startAuthoritySyncWorker's exact shape). Requires the logged-in
 * user, since preload is scoped to their assigned warehouse(s).
 *
 * @param {object} user - the current logged-in user (from useAuth())
 * @returns {() => void} cleanup function
 */
// A simple counter, not a boolean - if more than one thing needs to
// pause background sync at once (unlikely today, but safer), they
// won't clobber each other's intent to resume. Exported so form
// components can pause this worker specifically while they're open -
// the periodic background sync competes for the same IndexedDB
// connection as the form's own local lookups, which is the confirmed,
// direct explanation for why even a purely local, already-loaded
// record could feel slow to redisplay while a sync cycle happens to
// be mid-flight at the same moment.
let transactionSyncPauseCount = 0
export const pauseTransactionSync = () => { transactionSyncPauseCount++ }
export const resumeTransactionSync = () => { transactionSyncPauseCount = Math.max(0, transactionSyncPauseCount - 1) }

export const startTransactionSyncWorker = (user) => {
  let cancelled = false

  const runSync = async () => {
    if (cancelled || !user || transactionSyncPauseCount > 0) return
    await preloadTransactionsForUser(user)
  }

  runSync()

  const intervalId = setInterval(runSync, TRANSACTION_SYNC_INTERVAL_MS)
  window.addEventListener('online', runSync)

  return () => {
    cancelled = true
    clearInterval(intervalId)
    window.removeEventListener('online', runSync)
  }
}
