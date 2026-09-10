// Automatic off-device database backup - runs silently in the
// background on any logged-in device, throttled to once every 24
// hours via a timestamp shared across every device (db.reportConfig's
// 'global' record, a synced table), so it fires once globally no
// matter how many devices happen to be open at once - the same
// "throttle via a shared field" pattern already used for the periodic
// pile-balance and authority-total self-healing sweeps.
//
// The backup itself is the exact same full-table dump the Admin >
// Backup panel's manual "Export All Data" button builds, POSTed to
// api/backup-to-github.js, which commits it to this repo's GitHub
// history - a copy that lives completely outside Dexie Cloud, so a
// serious incident there wouldn't be the only copy of the data.
//
// Deliberately client-triggered rather than a server-side cron: Dexie
// Cloud doesn't expose a simple way to pull an entire database from a
// server without effectively reimplementing its own sync internals,
// so "a browser that's already logged in and already holds a full
// local copy of everything" is the realistic place to build this from.

import { createElement } from 'react'
import toast from 'react-hot-toast'
import { db } from '../db/dexie.js'
import { logError } from '../utils/errorLog.js'
import { isTransactionSyncPaused } from './syncPauseState.js'
import { SyncProgressToast } from '../components/common/AnimatedToast.jsx'

const BACKUP_TOAST_ID = 'auto-backup-progress'

const BACKUP_CHECK_INTERVAL_MS = 5 * 60 * 1000 // cheap check; the real work below only runs once BACKUP_THROTTLE_MS has actually elapsed
const BACKUP_THROTTLE_MS = 24 * 60 * 60 * 1000

const buildFullDump = async () => {
  const allTables = db.tables.map((t) => t.name)
  const dump = {}
  for (const tableName of allTables) {
    dump[tableName] = await db.table(tableName).toArray()
  }
  return {
    exportedAt: new Date().toISOString(),
    databaseName: db.name,
    schemaVersion: db.verno,
    tables: dump,
  }
}

const runAutoBackupIfDue = async () => {
  if (!navigator.onLine) return
  // The dump below reads every table in full - real, if brief,
  // competition for the same IndexedDB connection a transaction form's
  // own serial lookups depend on. Forms already pause the 30-second
  // transaction sync worker for exactly this reason (see syncWorker.js);
  // this worker piggybacks on that same signal rather than adding its
  // own separate wiring through every form. Skipping this cycle costs
  // nothing - the 24h throttle means the next check (at most
  // BACKUP_CHECK_INTERVAL_MS later) just tries again.
  if (isTransactionSyncPaused()) return
  try {
    const config = await db.reportConfig.get('global')
    const lastAt = config?.lastAutoBackupAt ? new Date(config.lastAutoBackupAt).getTime() : 0
    if (Date.now() - lastAt < BACKUP_THROTTLE_MS) return

    // Toast #2 (picked) - visible ONLY for this once-a-day event, never
    // for the continuous 30s/5min polling cycles elsewhere in the app,
    // which stay silent by design (a toast on every one of those would
    // be spam). Rare and meaningful enough here to be worth showing.
    toast.loading(createElement(SyncProgressToast, { label: 'Backing up database…', phase: 'progress' }), { id: BACKUP_TOAST_ID })

    const payload = await buildFullDump()
    const response = await fetch('/api/backup-to-github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bsm-app-key': import.meta.env.VITE_APP_SHARED_KEY ?? '',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      throw new Error(`Backup upload failed: HTTP ${response.status}`)
    }

    // Written AFTER a confirmed success (not before) - if the upload
    // fails, the next check (at most BACKUP_CHECK_INTERVAL_MS later)
    // sees the same stale timestamp and simply tries again, rather
    // than silently skipping a whole day because of one failed attempt.
    await db.reportConfig.put({ ...config, id: 'global', lastAutoBackupAt: new Date().toISOString() })
    console.log('[backupWorker] Automatic backup committed to GitHub.')
    toast.success(createElement(SyncProgressToast, { doneLabel: 'Backup committed to GitHub', phase: 'done' }), { id: BACKUP_TOAST_ID })
  } catch (err) {
    console.error('[backupWorker] Automatic backup failed:', err)
    logError('Automatic backup', err, { nickname: 'Background sync', role: 'System' })
    toast.dismiss(BACKUP_TOAST_ID)
  }
}

export const startBackupWorker = () => {
  let cancelled = false
  const runCheck = () => { if (!cancelled) runAutoBackupIfDue() }

  runCheck()
  const intervalId = setInterval(runCheck, BACKUP_CHECK_INTERVAL_MS)
  window.addEventListener('online', runCheck)

  return () => {
    cancelled = true
    clearInterval(intervalId)
    window.removeEventListener('online', runCheck)
  }
}
