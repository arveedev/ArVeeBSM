// Automatic backup of THIS PC's own data (office PCs only; phones never make backup files).
//
// Two independent copies of the same verified file (src/utils/deviceFile.js), so losing either one never loses the other:
//   1. a folder on this PC, chosen once with one click (works with no internet; lets this PC restore itself, Admin > Backup);
//   2. the Admin's Google Drive, uploaded automatically through /api/device-backup (no setup at the field office).
// Until a folder is chosen, the newest file is kept in the browser's own private file storage (OPFS) as a stop-gap.
//
// It must NEVER interrupt anyone: it only starts after the PC has been idle for a while, never while an entry form is open,
// reads the tables in small slices that hand control back to the screen, shows no pop-ups, and simply tries again later if
// the user starts working. A file is only treated as good after it was read back and its checksum matched.
// See docs/superpowers/specs/2026-10-19-system-health-and-pc-backup-design.md.

import { db } from '../db/dexie.js'
import { APP_VERSION } from '../version.js'
import { getDeviceId, getDeviceLabel, setDeviceId } from '../utils/errorLog.js'
import { buildDeviceFileText, verifyDeviceFile, deviceFileBaseName, filesToPrune, isOwnDeviceFileName } from '../utils/deviceFile.js'
import { deviceKind, setBackupStatusProvider, reportDeviceStatusNow } from './deviceStatusWorker.js'
import { isViewerRole } from '../utils/roles.js'

const CHECK_EVERY_MS = 5 * 60 * 1000
const IDLE_NEEDED_MS = 60 * 1000
const KEEP_DAYS = 45
const PAGE = 1000
const MARKER = 'bsm-device.json'

const yieldToScreen = () => new Promise((r) => setTimeout(r, 0))
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ---------------------------------------------------------------- stored facts (this browser only, never synced)
const getInfo = async (id) => (await db.deviceInfo.get(id)) ?? null
const setInfo = async (id, patch) => db.deviceInfo.put({ ...((await getInfo(id)) ?? {}), id, ...patch })

/** 'unsupported' | 'none' | 'needs-permission' | 'ok' */
export const getFolderState = async () => {
  if (!folderSupported()) return 'unsupported'
  const rec = await getInfo('folder')
  if (!rec?.handle) return 'none'
  try {
    const p = await rec.handle.queryPermission({ mode: 'readwrite' })
    return p === 'granted' ? 'ok' : 'needs-permission'
  } catch { return 'none' }
}

/** Needs a user click (browser rule). Returns { ok, message }. */
export const chooseBackupFolder = async ({ askAdopt = null } = {}) => {
  if (!folderSupported()) return { ok: false, message: 'This browser cannot save to a folder. Use Chrome or Edge.' }
  try {
    const existing = await getInfo('folder')
    if (existing?.handle) {
      // The folder was chosen before: only ask the browser for permission again (one click).
      const p = await existing.handle.requestPermission({ mode: 'readwrite' })
      if (p === 'granted') { await reportDeviceStatusNow(window.__bsmUser, { force: true }); return { ok: true, message: 'Backup folder allowed again.' } }
    }
    const handle = await window.showDirectoryPicker({ id: 'bsm-backup', mode: 'readwrite', startIn: 'documents' })
    // every PC uses the same folder name by convention; another name is accepted and the message says so
    const nameNote = handle.name !== 'BSM-Backup' ? ' Note: the agreed folder name is BSM-Backup (C:\\BSM-Backup).' : ''
    // A marker file remembers this PC's id, so a PC whose browser data was cleared is recognised again.
    let marker = null
    try { marker = JSON.parse(await (await (await handle.getFileHandle(MARKER)).getFile()).text()) } catch { /* no marker yet */ }
    if (marker?.deviceId && marker.deviceId !== getDeviceId()) {
      const adopt = askAdopt ? await askAdopt(marker.deviceName || 'another device') : false
      if (!adopt) return { ok: false, message: 'Pick a different folder for this PC.' }
      setDeviceId(marker.deviceId)
    }
    const fh = await handle.getFileHandle(MARKER, { create: true })
    const w = await fh.createWritable()
    await w.write(JSON.stringify({ deviceId: getDeviceId(), deviceName: getDeviceLabel(), chosenAt: new Date().toISOString() }, null, 1))
    await w.close()
    await setInfo('folder', { handle, name: handle.name, chosenAt: new Date().toISOString() })
    await reportDeviceStatusNow(window.__bsmUser, { force: true })
    window.dispatchEvent(new Event('bsm:device-backup-folder'))
    scheduleSoon()
    return { ok: true, message: `Backup folder set: ${handle.name}. This PC will save a backup here once a day by itself.${nameNote}` }
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, message: 'No folder chosen.' }
    return { ok: false, message: e?.message ?? 'Could not set the folder.' }
  }
}

/** The directory this PC writes to now: the chosen folder when allowed, else the browser's private storage. */
const getTargetDir = async () => {
  if ((await getFolderState()) === 'ok') return { dir: (await getInfo('folder')).handle, kind: 'folder' }
  if (navigator.storage?.getDirectory) return { dir: await navigator.storage.getDirectory(), kind: 'private' }
  return null
}

// ---------------------------------------------------------------- reading the data without freezing the screen
const readAllTables = async () => {
  const out = {}
  for (const t of db.tables) {
    if (t.name.startsWith('$')) continue
    const rows = []
    const total = await t.count()
    for (let off = 0; off < total; off += PAGE) {
      rows.push(...(await t.offset(off).limit(PAGE).toArray()))
      await yieldToScreen()
    }
    out[t.name] = rows
    await yieldToScreen()
  }
  return out
}

const pendingByTable = async () => {
  const out = {}
  for (const t of db.tables) {
    if (t.name.startsWith('$')) continue
    try { const n = await db.table(`$${t.name}_mutations`).count(); if (n > 0) out[t.name] = n } catch { /* no log for this table */ }
  }
  return out
}

const gzipBlob = async (text) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
const gunzipText = async (blobOrFile) => new Response(blobOrFile.stream().pipeThrough(new DecompressionStream('gzip'))).text()

const writeFile = async (dir, name, blobOrText) => {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable() // the browser writes to a hidden copy and swaps it in on close: a cut-short save never replaces a good file
  await w.write(blobOrText)
  await w.close()
  return fh
}

// ---------------------------------------------------------------- one backup run
let running = false

export const runDeviceBackup = async (user) => {
  if (running) return { skipped: 'already running' }
  running = true
  const state = { lastAttemptAt: new Date().toISOString() }
  try {
    const target = await getTargetDir()
    if (!target) { await setInfo('backupState', { ...state, ok: false, problem: 'nowhere to save' }); return { ok: false } }
    const tables = await readAllTables()
    const status = await db.deviceStatus.get(getDeviceId())
    const dbId = (() => { try { return new URL(db.cloud.options.databaseUrl).hostname.split('.')[0] } catch { return '' } })()
    const name = `${getDeviceLabel()}-${getDeviceId().slice(0, 6)}`
    const { text, sha256 } = await buildDeviceFileText({
      deviceId: getDeviceId(), deviceName: name, user: user?.nickname || user?.name || '', role: user?.role ?? '',
      appVersion: APP_VERSION, schemaVersion: db.verno, dbId, lastSyncAt: status?.lastSyncAt ?? null, pending: await pendingByTable(),
    }, tables, { databaseName: db.name })
    const gz = await gzipBlob(text)
    const base = deviceFileBaseName(name, localDate())
    const fh = await writeFile(target.dir, `${base}.json.gz`, gz)

    // read it back and check it, so "saved" means "saved and good"
    const back = await verifyDeviceFile(await gunzipText(await fh.getFile()))
    const good = back.ok && back.meta.tablesSha256 === sha256
    if (!good) { await setInfo('backupState', { ...state, ok: false, problem: back.problems.join('; ').slice(0, 300) }); return { ok: false } }
    const manifest = { ...back.meta, file: `${base}.json.gz`, bytes: gz.size, savedAt: new Date().toISOString(), savedTo: target.kind }
    await writeFile(target.dir, `${base}.manifest.json`, JSON.stringify(manifest, null, 1))

    // keep the newest KEEP_DAYS days; delete only files this feature wrote
    const names = []
    for await (const [n] of target.dir.entries()) names.push(n)
    for (const n of filesToPrune(names, KEEP_DAYS)) { try { await target.dir.removeEntry(n) } catch { /* in use: next time */ } }

    await setInfo('backupState', { ...state, ok: true, at: new Date().toISOString(), bytes: gz.size, savedTo: target.kind, problem: null })
    window.dispatchEvent(new Event('bsm:device-backup-done'))

    // second, independent copy: Drive (never blocks, never fails the local backup)
    uploadToDrive(gz, localDate()).catch(() => {})
    return { ok: true }
  } catch (e) {
    await setInfo('backupState', { ...state, ok: false, problem: String(e?.message ?? e).slice(0, 300) }).catch(() => {})
    return { ok: false }
  } finally {
    running = false
  }
}

const uploadToDrive = async (gz, date) => {
  let driveOk = null
  try {
    const r = await fetch('/api/device-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip', 'x-bsm-app-key': import.meta.env.VITE_APP_SHARED_KEY ?? '', 'x-device-id': getDeviceId(), 'x-file-date': date },
      body: gz,
    })
    driveOk = r.status === 503 ? null : r.ok // 503 = Drive copy not set up on the server: not a fault of this PC
  } catch { driveOk = false }
  await setInfo('backupState', { driveOk, ...(driveOk ? { driveAt: new Date().toISOString() } : {}) })
  window.dispatchEvent(new Event('bsm:device-backup-done'))
}

// ---------------------------------------------------------------- status for the System health record
export const getBackupStatus = async () => {
  const s = (await getInfo('backupState')) ?? {}
  return { at: s.at ?? null, ok: s.ok !== false, folder: await getFolderState(), driveAt: s.driveAt ?? null, driveOk: s.driveOk ?? null, savedTo: s.savedTo ?? null }
}

/** Names of this PC's own backup files (folder or private storage), newest first, for the restore screen. */
export const listLocalBackupFiles = async () => {
  const target = await getTargetDir()
  if (!target) return []
  const files = []
  for await (const [n, h] of target.dir.entries()) if (h.kind === 'file' && /\.json\.gz$/.test(n) && isOwnDeviceFileName(n)) files.push({ name: n, handle: h })
  return files.sort((a, b) => (a.name < b.name ? 1 : -1))
}

export const readLocalBackupText = async (handle) => gunzipText(await handle.getFile())

// ---------------------------------------------------------------- when to run
let lastInputAt = Date.now()
const markInput = () => { lastInputAt = Date.now() }

const isDue = async () => {
  const s = (await getInfo('backupState')) ?? {}
  if (s.at && localDate(new Date(s.at)) === localDate()) return false // already one today
  if (s.lastAttemptAt && Date.now() - Date.parse(s.lastAttemptAt) < 30 * 60 * 1000) return false // a failed try: not more often than every 30 minutes
  return true
}

const canRunNow = () => Date.now() - lastInputAt >= IDLE_NEEDED_MS && !window.__bsmFormOpen

let timer = null
let currentUser = null
const tick = async () => {
  try {
    if (!currentUser || !canRunNow() || !(await isDue())) return
    await runDeviceBackup(currentUser)
  } catch { /* never disturbs the user */ }
}
const scheduleSoon = () => { setTimeout(tick, 2000) }

/** Starts the automatic PC backup for the signed-in user; returns the cleanup. PCs only. */
export const startDeviceBackup = (user) => {
  if (!user || isViewerRole(user.role) || deviceKind() !== 'pc') return () => {}
  currentUser = user
  window.__bsmUser = user
  setBackupStatusProvider(getBackupStatus)
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart']
  events.forEach((e) => window.addEventListener(e, markInput, { passive: true }))
  timer = setInterval(tick, CHECK_EVERY_MS)
  const first = setTimeout(tick, IDLE_NEEDED_MS + 5000)
  return () => {
    events.forEach((e) => window.removeEventListener(e, markInput))
    clearInterval(timer)
    clearTimeout(first)
    currentUser = null
  }
}

// the status record can ask for this PC's backup state before the scheduler has started
if (typeof window !== 'undefined') setBackupStatusProvider(getBackupStatus)
