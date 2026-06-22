// Background synchronization engine — Steps 2.3 & 2.4.
//
// Scans the local Dexie `transactions` table for records that have not yet
// been pushed to Firestore (isSynced === false), uploads each one, and
// flips the local isSynced flag to true once Firestore confirms the write.

import { collection, doc, setDoc } from 'firebase/firestore'
import { db } from '../db/dexie.js'
import { firestore } from './firebase.js'
import { pushTransactionBackup, syncAuthoritiesFromSheets } from './googleSheetsBridge.js'

let isSyncing = false

/**
 * Process the local sync queue: push every unsynced transaction to
 * Firestore and mark it as synced on success.
 *
 * Returns a summary of how many records were synced / failed, so the UI
 * can surface results via toast.
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
    const pending = await db.transactions.filter((tx) => tx.isSynced === false).toArray()

    for (const tx of pending) {
      try {
        // `isSynced` is Local Dexie Only (Section 3.2) — strip it before
        // uploading so the cloud copy doesn't carry a stale local-state field.
        const { isSynced, ...payload } = tx

        // Conflict-free multi-device upload: each transaction's deterministic
        // serialNo (Section 3.1) means two offline nodes never collide, so a
        // plain setDoc keyed by the local `id` is safe.
        await setDoc(doc(collection(firestore, 'transactions'), tx.id), payload)
        await db.transactions.update(tx.id, { isSynced: true })
        synced += 1

        // Best-effort backup row to the Google Sheet (Step 6.4) — failures
        // here are logged but never block the Firestore sync result, since
        // Firestore is the primary cloud store and the Sheet is a secondary
        // durable log.
        try {
          const pile = tx.pileId ? await db.piles.get(tx.pileId) : null
          const warehouse = pile ? await db.warehouses.get(pile.warehouseId) : null
          const province = warehouse ? await db.provinces.get(warehouse.provinceId) : null
          const variety = tx.varietyId ? await db.varietyTypes.get(tx.varietyId) : null
          const transactionType = tx.transactionTypeId
            ? await db.transactionTypes.get(tx.transactionTypeId)
            : null

          await pushTransactionBackup(tx, {
            warehouseCode: warehouse?.code ?? null,
            warehouseName: warehouse?.name ?? null,
            provinceCode: province?.code ?? null,
            varietyName: variety?.name ?? null,
            transactionTypeName: transactionType?.name ?? null,
          })
        } catch (backupErr) {
          console.error(`Sheets backup failed for transaction ${tx.id}:`, backupErr)
        }
      } catch (err) {
        console.error(`Sync failed for transaction ${tx.id}:`, err)
        failed += 1
      }
    }
  } finally {
    isSyncing = false
  }

  return { synced, failed }
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
