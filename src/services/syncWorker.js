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
import { pushTransactionBackup, updateTransactionBackup, deleteTransactionBackup, pushPrBackup, updatePrBackup, deletePrBackup, stripWarehouseCodePrefix, syncAuthoritiesFromSheets, syncMillingOrdersFromSheets } from './googleSheetsBridge.js'
import { preloadTransactionsForUser } from './transactionPreload.js'
import { pauseTransactionSync, resumeTransactionSync, isTransactionSyncPaused } from './syncPauseState.js'
import { logSyncFailure, resolveSyncFailure } from '../utils/errorLog.js'

// Re-exported so every existing form import (`from
// '../../services/syncWorker.js'`) keeps working unchanged - see
// syncPauseState.js for why the actual state now lives there instead.
export { pauseTransactionSync, resumeTransactionSync }

// Confirmed, reported real bug (traced through an extended Apps Script
// 404/502 saga - see docs/engineering-plan.md Phase 7): AUTHORITY_SYNC_
// INTERVAL_MS (60s, below) is an exact 2x multiple of TRANSACTION_SYNC_
// INTERVAL_MS (30s), and both workers fire their very first run
// immediately on login, in the same tick. A plain setInterval never
// drifts on its own, so from that moment on, every OTHER transaction
// cycle permanently coincides with an authority cycle - a deterministic,
// self-inflicted burst of every periodic sync request this device makes
// (transactions + authorities + milling orders, easily 10+ HTTP calls)
// landing on the same Apps Script project at the same instant, forever,
// for as long as the session stays open. Multiplied across however many
// staff devices are open in the field at once, this is a real
// contributor to hitting Apps Script's own concurrent-execution ceiling
// during those aligned spikes - not random flakiness, a structural
// thundering-herd pattern. scheduleJittered replaces a fixed setInterval
// with a self-rescheduling timer whose delay is randomized ±20% each
// cycle, so two workers that start in the same tick drift apart over
// time instead of staying phase-locked forever.
const scheduleJittered = (fn, baseIntervalMs, jitterRatio = 0.2) => {
  let timerId = null
  let cancelled = false
  const tick = async () => {
    if (cancelled) return
    await fn()
    if (cancelled) return
    const jitter = baseIntervalMs * jitterRatio * (Math.random() * 2 - 1)
    timerId = setTimeout(tick, Math.max(1000, baseIntervalMs + jitter))
  }
  const jitter = baseIntervalMs * jitterRatio * (Math.random() * 2 - 1)
  timerId = setTimeout(tick, Math.max(1000, baseIntervalMs + jitter))
  return () => {
    cancelled = true
    if (timerId) clearTimeout(timerId)
  }
}

let isSyncing = false

// Real bug found: a single transient failure (a dropped connection, an
// Apps Script cold-start timeout, a momentary quota hit) was reported as
// "failed to sync" on the very first attempt, even though the existing
// 30s safety-net retry (BACKUP_QUEUE_RETRY_INTERVAL_MS below) then
// succeeded moments later - confirmed live: the row was already on the
// Sheet by the time the user went to check, so the toast had already
// caused needless worry. Gives one immediate inline retry before a push
// counts as failed/toasts anything, so only a genuinely persistent
// failure (still failing after this retry) is ever surfaced.
const withOneRetry = async (attempt, delayMs = 1500) => {
  const first = await attempt()
  if (first.ok) return first
  await new Promise((resolve) => setTimeout(resolve, delayMs))
  return attempt()
}

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
        const result = await withOneRetry(() =>
          tx.hasBeenBackedUp ? updateTransactionBackup(tx, context) : pushTransactionBackup(tx, context)
        )

        if (result.ok) {
          await db.transactions.update(tx.id, { isSynced: true, hasBeenBackedUp: true, syncFailureLogged: false })
          synced += 1
          // This record had a logged failure from an earlier cycle -
          // it just synced, so that entry gets marked resolved instead
          // of sitting in the admin log looking permanently broken.
          if (tx.syncFailureLogged) await resolveSyncFailure(tx.id)
        } else {
          console.error(
            `Sheets backup ${tx.hasBeenBackedUp ? 'update' : 'append'} failed for ${tx.type} ${tx.serialNo}:`,
            result
          )
          failed += 1
          // Logged once per genuinely-persistent failure, not on every
          // 30s retry cycle - see syncFailureLogged's own comment above.
          if (!tx.syncFailureLogged) {
            await logSyncFailure('Sheet sync', `${tx.type} ${tx.serialNo} failed to push to the Sheet - will keep retrying automatically every 30s.`, tx.id)
            await db.transactions.update(tx.id, { syncFailureLogged: true })
          }
        }
      } catch (err) {
        console.error(`Sheets backup failed for transaction ${tx.id} (${tx.type} ${tx.serialNo}):`, err)
        failed += 1
        if (!tx.syncFailureLogged) {
          await logSyncFailure('Sheet sync', `${tx.type} ${tx.serialNo} failed to push to the Sheet (${err?.message ?? err}) - will keep retrying automatically every 30s.`, tx.id)
          await db.transactions.update(tx.id, { syncFailureLogged: true })
        }
      }
    }

    // Drain queued offline deletions - by the time these can retry, the
    // local transaction record itself is already gone (a real hard
    // delete happens immediately, locally), so only serialNo/type
    // survive to replay the deletion against the Sheet.
    const queuedDeletions = await db.pendingSheetDeletions.toArray()
    for (const deletion of queuedDeletions) {
      try {
        const result = await withOneRetry(() =>
          deleteTransactionBackup(deletion.serialNo, deletion.type, deletion.warehouseCode)
        )
        if (result.ok) {
          // Reported real bug: an already-Cancelled (voided) record was
          // never written to the Sheet in the first place - policy is to
          // never back up a cancelled document - so deleting one (e.g.
          // un-voiding, which hard-deletes the Cancelled record to free
          // its serial number again) will ALWAYS come back "not found"
          // here. That's the expected, correct outcome, not something
          // needing the user's attention - the alarming red toast was
          // firing on a guaranteed non-event. `expectMissing` (set by the
          // caller when it knows the record being deleted was Cancelled)
          // suppresses it for exactly that case, while a genuinely
          // unexpected missing row (deleting a record that WAS supposed
          // to be backed up) still warns as before.
          if (result.found === false && !deletion.expectMissing) {
            toast.error(`${deletion.type} ${deletion.serialNo} deleted locally, but no matching row was found on the Sheet — please verify manually`, { duration: 10000 })
          }
          await db.pendingSheetDeletions.delete(deletion.id)
          synced += 1
          if (deletion.syncFailureLogged) await resolveSyncFailure(deletion.id)
        } else {
          console.error(`Sheets delete-backup failed for ${deletion.type} ${deletion.serialNo}:`, result)
          failed += 1
          if (!deletion.syncFailureLogged) {
            await logSyncFailure('Sheet sync', `Delete of ${deletion.type} ${deletion.serialNo} failed to push to the Sheet - will keep retrying automatically every 30s.`, deletion.id)
            await db.pendingSheetDeletions.update(deletion.id, { syncFailureLogged: true })
          }
        }
      } catch (err) {
        console.error(`Sheets delete-backup failed for serial ${deletion.serialNo}:`, err)
        failed += 1
        if (!deletion.syncFailureLogged) {
          await logSyncFailure('Sheet sync', `Delete of ${deletion.type} ${deletion.serialNo} failed to push to the Sheet (${err?.message ?? err}) - will keep retrying automatically every 30s.`, deletion.id)
          await db.pendingSheetDeletions.update(deletion.id, { syncFailureLogged: true })
        }
      }
    }

    // Purchase Receipt "SUMMARY" Sheet backup - same isSynced/
    // hasBeenBackedUp pattern as db.transactions above, but a parallel
    // block (not a shared code path) since a PR is a structurally
    // different record, resolved against its own related WSR (for
    // WSR#/I-FA/Gender/Farmer Member) rather than being self-contained.
    // `!== true` (not `=== false`) so a Purchase Receipt issued BEFORE
    // this backup feature shipped - which has no isSynced field at all,
    // i.e. undefined, not false - still gets picked up and backed up.
    // db.transactions doesn't need this same care above since every
    // transaction has always had isSynced explicitly set since it was
    // first introduced; purchaseReceipts is newer and has real pre-
    // existing rows with the field entirely absent.
    const pendingPrs = await db.purchaseReceipts.filter((pr) => pr.isSynced !== true).toArray()
    for (const pr of pendingPrs) {
      try {
        const warehouse = pr.warehouseId ? await db.warehouses.get(pr.warehouseId) : null
        const sdoUser = pr.sdoUid ? await db.users.get(pr.sdoUid) : null
        const wsr = pr.wsrTransactionId ? await db.transactions.get(pr.wsrTransactionId) : null
        const context = {
          warehouseName: warehouse ? stripWarehouseCodePrefix(warehouse.name) : null,
          sdoName: sdoUser?.nickname ?? sdoUser?.name ?? null,
          wsrSerialNo: wsr?.serialNo ?? null,
          // The WSR's own date - per explicit correction, this (not
          // pr.date) is what both the row's DATE column and which
          // monthly Sheet source it belongs to are resolved from.
          wsrDate: wsr?.date ?? null,
          isFarmersAssociation: Boolean(wsr?.farmerCoops?.length),
          // Per explicit correction: FARMER MEMBER should hold just the
          // name(s), not "Name (RSBSA, Gender)" crammed into one cell -
          // the RSBSA NO./GENDER columns are where that data belongs.
          farmerMembersText: wsr?.farmerCoops?.length
            ? wsr.farmerCoops.map((m) => m.name).join('; ')
            : null,
          // A single-member FA has that one member's own RSBSA/gender
          // pulled directly into the RSBSA NO./GENDER columns (see
          // buildPrSummaryRow) rather than the WSR-level
          // farmerRsbsa/farmerGender fields, which are the Individual
          // farmer's own info and don't apply to an FA transaction. With
          // more than one member, no single cell can represent all of
          // them, so these fall back to the WSR-level fields exactly as
          // before (blank/whatever an Individual transaction would show).
          farmerRsbsa: wsr?.farmerCoops?.length === 1 ? (wsr.farmerCoops[0].rsbsa || null) : null,
          farmerGender: wsr?.farmerCoops?.length === 1 ? (wsr.farmerCoops[0].gender || null) : (wsr?.farmerGender ?? null),
        }

        // Per explicit decision, a Cancelled PR must never appear on the
        // SUMMARY sheet at all - not even as a blanked "CANCELLED"
        // placeholder row (same convention already used for every other
        // cancelled document's Sheet backup). If it was already backed
        // up while Active, remove that row outright instead of updating
        // it; if it never made it to the Sheet in the first place (e.g.
        // a pre-registered placeholder Cancelled PR that was never
        // issued), there's nothing to push at all.
        if (pr.status === 'Cancelled') {
          const sourceDate = context.wsrDate ?? pr.date
          const result = pr.hasBeenBackedUp
            ? await withOneRetry(() => deletePrBackup(pr.prNo, sourceDate))
            : { ok: true }

          if (result.ok) {
            await db.purchaseReceipts.update(pr.prId, { isSynced: true, hasBeenBackedUp: false, syncFailureLogged: false })
            synced += 1
            if (pr.syncFailureLogged) await resolveSyncFailure(pr.prId)
          } else {
            console.error(`Sheets backup removal failed for cancelled PR ${pr.prNo}:`, result)
            failed += 1
            if (!pr.syncFailureLogged) {
              await logSyncFailure('Sheet sync', `Cancelled PR ${pr.prNo} failed to be removed from the Sheet - will keep retrying automatically every 30s.`, pr.prId)
              await db.purchaseReceipts.update(pr.prId, { syncFailureLogged: true })
            }
          }
          continue
        }

        const result = await withOneRetry(() =>
          pr.hasBeenBackedUp ? updatePrBackup(pr, context) : pushPrBackup(pr, context)
        )

        if (result.ok) {
          await db.purchaseReceipts.update(pr.prId, { isSynced: true, hasBeenBackedUp: true, syncFailureLogged: false })
          synced += 1
          if (pr.syncFailureLogged) await resolveSyncFailure(pr.prId)
        } else {
          console.error(`Sheets backup ${pr.hasBeenBackedUp ? 'update' : 'append'} failed for PR ${pr.prNo}:`, result)
          failed += 1
          if (!pr.syncFailureLogged) {
            await logSyncFailure('Sheet sync', `PR ${pr.prNo} failed to push to the Sheet - will keep retrying automatically every 30s.`, pr.prId)
            await db.purchaseReceipts.update(pr.prId, { syncFailureLogged: true })
          }
        }
      } catch (err) {
        console.error(`Sheets backup failed for PR ${pr.prId} (${pr.prNo}):`, err)
        failed += 1
        if (!pr.syncFailureLogged) {
          await logSyncFailure('Sheet sync', `PR ${pr.prNo} failed to push to the Sheet (${err?.message ?? err}) - will keep retrying automatically every 30s.`, pr.prId)
          await db.purchaseReceipts.update(pr.prId, { syncFailureLogged: true })
        }
      }
    }

    // Drain queued offline PR deletions - mirrors pendingSheetDeletions
    // above; only prNo survives a hard delete, since the local record is
    // already gone by the time this runs.
    const queuedPrDeletions = await db.pendingPrSheetDeletions.toArray()
    for (const deletion of queuedPrDeletions) {
      try {
        const result = await withOneRetry(() => deletePrBackup(deletion.prNo, deletion.date))
        if (result.ok) {
          if (result.found === false && !deletion.expectMissing) {
            toast.error(`PR ${deletion.prNo} deleted locally, but no matching row was found on the Sheet — please verify manually`, { duration: 10000 })
          }
          await db.pendingPrSheetDeletions.delete(deletion.id)
          synced += 1
          if (deletion.syncFailureLogged) await resolveSyncFailure(deletion.id)
        } else {
          console.error(`Sheets delete-backup failed for PR ${deletion.prNo}:`, result)
          failed += 1
          if (!deletion.syncFailureLogged) {
            await logSyncFailure('Sheet sync', `Delete of PR ${deletion.prNo} failed to push to the Sheet - will keep retrying automatically every 30s.`, deletion.id)
            await db.pendingPrSheetDeletions.update(deletion.id, { syncFailureLogged: true })
          }
        }
      } catch (err) {
        console.error(`Sheets delete-backup failed for PR ${deletion.prNo}:`, err)
        failed += 1
        if (!deletion.syncFailureLogged) {
          await logSyncFailure('Sheet sync', `Delete of PR ${deletion.prNo} failed to push to the Sheet (${err?.message ?? err}) - will keep retrying automatically every 30s.`, deletion.id)
          await db.pendingPrSheetDeletions.update(deletion.id, { syncFailureLogged: true })
        }
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
 *
 * `expectMissing` - pass true when the caller already knows this record
 * was Cancelled (voided). A cancelled document is deliberately never
 * written to the Sheet backup at all (policy, not a bug), so a "no
 * matching row" result here is guaranteed and expected, not something
 * that should alarm the user - unlike deleting a genuinely Active
 * record, where a missing row IS a real, worth-surfacing discrepancy.
 */
export const queueTransactionDeletion = async (serialNo, type, warehouseCode, { expectMissing = false } = {}) => {
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
      if (result.found === false && !expectMissing) {
        toast.error(`${type} ${serialNo} deleted locally, but no matching row was found on the Sheet — please verify manually`, { duration: 10000 })
      }
      return
    }
  } catch {
    // fall through to queueing below
  }
  await db.pendingSheetDeletions.add({ id: crypto.randomUUID(), serialNo, type, warehouseCode, expectMissing })
}

/**
 * Call this when a Purchase Receipt is genuinely (hard) DELETED locally,
 * so its SUMMARY row is removed too - never call this for a Cancel,
 * which updates the row in place instead (see updatePrBackup) and keeps
 * it visible, per explicit decision that a cancelled PR must still be
 * explained on the Sheet, unlike a deleted one, which must not exist
 * anywhere. Same immediate-attempt-then-queue shape as
 * queueTransactionDeletion above. `date` is the deleted PR's own date -
 * required (not optional) so the correct monthly source can be resolved
 * (see deletePrBackup), same as every other PR backup call.
 */
export const queuePrDeletion = async (prNo, date, { expectMissing = false } = {}) => {
  try {
    const result = await deletePrBackup(prNo, date)
    if (result.ok) {
      if (result.found === false && !expectMissing) {
        toast.error(`PR ${prNo} deleted locally, but no matching row was found on the Sheet — please verify manually`, { duration: 10000 })
      }
      return
    }
  } catch {
    // fall through to queueing below
  }
  await db.pendingPrSheetDeletions.add({ id: crypto.randomUUID(), prNo, date, expectMissing })
}

let immediateSyncRegistered = false

export const registerImmediateSyncOnSave = () => {
  if (immediateSyncRegistered) return
  immediateSyncRegistered = true
  db.transactions.hook('creating', () => {
    setTimeout(() => { processSyncQueue() }, 0)
  })
  db.purchaseReceipts.hook('creating', () => {
    setTimeout(() => { processSyncQueue() }, 0)
  })
  db.purchaseReceipts.hook('updating', () => {
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

// Backup-queue safety net: previously this worker had NO periodic retry
// at all - only "on initial load", "on reconnect", and (via
// registerImmediateSyncOnSave) "right after a create/update". A push that
// failed for any transient reason (a dropped connection, an Apps Script
// cold-start timeout, momentarily hitting Google's per-user quota) had
// nothing left to retry it until the user's next save or the browser's
// next online event - which, if they stayed continuously online and idle
// for a while, might not happen for a long time. This is the confirmed
// explanation for the reported sync lag (edits sitting unsynced for
// several minutes with no new activity to trigger a retry). 30s matches
// the existing TRANSACTION_SYNC_INTERVAL_MS pull-side cadence.
const BACKUP_QUEUE_RETRY_INTERVAL_MS = 30 * 1000

/**
 * Attach a listener so the sync queue is processed automatically whenever
 * connectivity is restored, once on initial load if already online, and
 * on a fixed interval as a safety net (see BACKUP_QUEUE_RETRY_INTERVAL_MS
 * above) so a failed push always gets retried within a bounded time even
 * with no other trigger.
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
  const intervalId = setInterval(runSync, BACKUP_QUEUE_RETRY_INTERVAL_MS)

  if (navigator.onLine) {
    runSync()
  }

  return () => {
    window.removeEventListener('online', runSync)
    clearInterval(intervalId)
  }
}

// Was 5 minutes - reported directly as too slow for a new AI/SIA
// authority (or any Sheet edit) to actually show up in the app. Both
// syncAuthoritiesFromSheets and syncMillingOrdersFromSheets are already
// full-table re-fetches designed to run forever on a fixed cadence (see
// their own comments - a cheap enough operation at this data's real
// scale), so there's no technical reason to hold this at 5 minutes; 1
// minute matches the app's other periodic pulls (BACKUP_QUEUE_RETRY_
// INTERVAL_MS, TRANSACTION_SYNC_INTERVAL_MS) far more closely while
// still well short of hammering the Apps Script backend.
const AUTHORITY_SYNC_INTERVAL_MS = 60 * 1000

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

  // Staggered a few seconds behind the transaction worker's own
  // immediate first call (App.jsx mounts both effects in the same
  // render) - see scheduleJittered's comment: without this, this
  // worker's very first run always landed in the same tick as the
  // transaction worker's, at every single login, before either had a
  // chance to drift apart.
  const initialDelayMs = 5000 + Math.random() * 5000
  const initialTimer = setTimeout(runSync, initialDelayMs)

  // scheduleJittered instead of a fixed setInterval - this worker's 60s
  // cadence is an exact 2x multiple of the transaction worker's 30s one,
  // which would otherwise stay permanently phase-locked.
  const stopSchedule = scheduleJittered(runSync, AUTHORITY_SYNC_INTERVAL_MS)
  window.addEventListener('online', runSync)

  return () => {
    cancelled = true
    clearTimeout(initialTimer)
    stopSchedule()
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
// pauseTransactionSync/resumeTransactionSync - exported above (see
// syncPauseState.js). Forms call these to pause this worker while
// they're open - the periodic background sync competes for the same
// IndexedDB connection as the form's own local lookups, which is the
// confirmed, direct explanation for why even a purely local, already-
// loaded record could feel slow to redisplay while a sync cycle
// happens to be mid-flight at the same moment.

export const startTransactionSyncWorker = (user) => {
  let cancelled = false

  const runSync = async () => {
    if (cancelled || !user || isTransactionSyncPaused()) return
    await preloadTransactionsForUser(user)
  }

  runSync()

  // scheduleJittered instead of a fixed setInterval - see that helper's
  // own comment for why: this worker's 30s cadence is an exact 2x
  // divisor of the authority worker's 60s one, and both fire their first
  // run in the same tick at login, so a plain setInterval would keep
  // them permanently phase-locked into synchronized request bursts.
  const stopSchedule = scheduleJittered(runSync, TRANSACTION_SYNC_INTERVAL_MS)
  window.addEventListener('online', runSync)

  return () => {
    cancelled = true
    stopSchedule()
    window.removeEventListener('online', runSync)
  }
}
