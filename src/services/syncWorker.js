// Background synchronization engine.
//
// Scans the local Dexie `transactions` table for records that have not yet
// been backed up to the Google Sheet (isSynced === false - repurposed from
// an earlier Firestore-based design; Firestore was never actually
// configured with real credentials and has been removed entirely -
// Dexie Cloud is the device-to-device sync layer, this worker's only job
// now is the Sheets backup log), pushes each one, and flips the local
// isSynced flag to true once the Sheet confirms the write.

import { db } from '../db/dexie.js'
import { pushTransactionBackup, updateTransactionBackup, deleteTransactionBackup, syncAuthoritiesFromSheets, syncMillingOrdersFromSheets } from './googleSheetsBridge.js'

let isSyncing = false

/**
 * Process the local backup queue: push every not-yet-backed-up
 * transaction to the Google Sheet (appending it the first time,
 * updating its existing row on any later re-sync after an edit), then
 * drains any queued offline deletions. Returns a summary of how many
 * records were synced / failed, so the UI can surface results via toast.
 */
export const processSyncQueue = async () => {
  if (isSyncing) {
    return { synced: 0, failed: 0, skipped: true }
  }

  if (!navigator.onLine) {
    return { synced: 0, failed: 0, offline: true }
  }

  isSyncing = true
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
    if (result.ok) return
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
