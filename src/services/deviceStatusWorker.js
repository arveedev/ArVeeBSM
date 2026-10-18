// Every device tells the Admin how it is doing: one small record per device in the synced `deviceStatus` table, refreshed
// about every 10 minutes, when the app is opened or brought back to the screen, and right after this device's own backup
// finishes. The Admin's System health screen reads them all. See docs/superpowers/specs/2026-10-19-system-health-and-pc-backup-design.md.
//
// It must never get in the way: everything is wrapped so a failure is only a console line, it does nothing while no
// one is signed in, and it writes at most one small record per interval.

import { db } from '../db/dexie.js'
import { APP_VERSION } from '../version.js'
import { getDeviceId, getDeviceLabel } from '../utils/errorLog.js'

const REPORT_INTERVAL_MS = 10 * 60 * 1000
const MIN_GAP_MS = 2 * 60 * 1000          // coming back to the screen reports again only if this long since the last write
const COUNTED_TABLES = ['transactions', 'purchaseReceipts', 'piles', 'authorities', 'customers']

/** 'pc' or 'phone' (phones and tablets report status only; they never make backup files). */
export const deviceKind = () => {
  try {
    if (navigator.userAgentData?.mobile) return 'phone'
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? '') ? 'phone' : 'pc'
  } catch { return 'pc' }
}

let backupProvider = null
/** deviceBackup.js registers a function returning { at, ok, folder, driveAt, driveOk } for the status record. */
export const setBackupStatusProvider = (fn) => { backupProvider = fn }

let lastWriteAt = 0
let lastInSyncAt = null
let pendingSince = null
let stopSyncSub = null

const countPending = async () => {
  let total = 0
  for (const t of db.tables) {
    if (t.name.startsWith('$') || t.name === 'deviceInfo') continue
    try { total += await db.table(`$${t.name}_mutations`).count() } catch { /* a table with no mutation log */ }
  }
  return total
}

const buildRecord = async (user, existing) => {
  const now = new Date()
  const inSync = db.cloud?.syncState?.value?.phase === 'in-sync'
  if (inSync) lastInSyncAt = now.toISOString()
  const pending = await countPending()
  if (pending > 0 && !pendingSince) pendingSince = now.toISOString()
  if (pending === 0) pendingSince = null
  const counts = {}
  for (const t of COUNTED_TABLES) { try { counts[t] = await db.table(t).count() } catch { /* table missing on an old schema */ } }
  let warehouse = ''
  try {
    const ids = user?.assignedWarehouses ?? []
    const names = (await db.warehouses.bulkGet(ids.slice(0, 4))).filter(Boolean).map((w) => w.name)
    warehouse = names.join(', ')
  } catch { /* names are a nicety */ }
  const id = getDeviceId()
  const kind = deviceKind()
  return {
    id,
    // an Admin-chosen name sticks; otherwise the browser and system, e.g. "Chrome on Windows"
    name: existing?.nameSetByAdmin ? existing.name : getDeviceLabel(),
    nameSetByAdmin: existing?.nameSetByAdmin ?? false,
    kind,
    user: user?.nickname || user?.name || '',
    role: user?.role ?? '',
    warehouse,
    appVersion: APP_VERSION,
    firstSeen: existing?.firstSeen ?? now.toISOString(),
    lastSeen: now.toISOString(),
    lastSyncAt: lastInSyncAt ?? existing?.lastSyncAt ?? null,
    pending,
    pendingSince,
    counts,
    backup: kind === 'pc' ? ((await backupProvider?.()) ?? { folder: 'unknown' }) : null,
  }
}

export const reportDeviceStatusNow = async (user) => {
  try {
    if (!user || user.role === 'Visitor') return
    const existing = await db.deviceStatus.get(getDeviceId())
    await db.deviceStatus.put(await buildRecord(user, existing))
    lastWriteAt = Date.now()
  } catch (e) {
    console.warn('[deviceStatus] could not report:', e?.message ?? e)
  }
}

/** Starts reporting for the signed-in `user`; returns the cleanup. */
export const startDeviceStatusWorker = (user) => {
  if (!user || user.role === 'Visitor') return () => {}
  reportDeviceStatusNow(user)
  const timer = setInterval(() => reportDeviceStatusNow(user), REPORT_INTERVAL_MS)
  const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastWriteAt > MIN_GAP_MS) reportDeviceStatusNow(user) }
  document.addEventListener('visibilitychange', onVisible)
  const onBackupDone = () => reportDeviceStatusNow(user)
  window.addEventListener('bsm:device-backup-done', onBackupDone)
  stopSyncSub?.()
  const sub = db.cloud?.syncState?.subscribe?.((s) => { if (s?.phase === 'in-sync') lastInSyncAt = new Date().toISOString() })
  stopSyncSub = () => sub?.unsubscribe?.()
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('bsm:device-backup-done', onBackupDone)
    stopSyncSub?.()
  }
}
