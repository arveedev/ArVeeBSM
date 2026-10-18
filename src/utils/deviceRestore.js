// Restore THIS PC from a backup file (Admin > Backup > "Restore this PC from a backup file"). Works with no internet.
//
// Insert-only, by design: it adds records this PC is missing and never deletes or overwrites anything. Records that exist
// here but differ from the file are counted and left alone (the normal sync and the Data Repair tools own those).
// Takes the database as a parameter (anything with table(name).toArray()/schema.primKey.keyPath/bulkAdd) so the logic is
// tested without a browser. The file checks themselves live in deviceFile.js.

import { verifyDeviceFile, diffAgainstLocal, stableStringify, RESTORE_EXCLUDED_TABLES, DEVICE_FILE_FORMAT } from './deviceFile.js'

const SLICE = 400
const yieldToScreen = () => new Promise((r) => setTimeout(r, 0))

/** Reads either kind of file: a device file (checksummed) or a plain "Export All Data" JSON (no checksum). Never throws. */
export const checkAnyBackup = async (text) => {
  const firstLine = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : 0)
  if (firstLine.includes(DEVICE_FILE_FORMAT)) {
    const v = await verifyDeviceFile(text)
    return { kind: 'device', ok: v.ok, problems: v.problems, meta: v.meta, data: v.ok ? v.data : null }
  }
  try {
    const data = JSON.parse(text)
    if (!data?.tables || typeof data.tables !== 'object') return { kind: 'export', ok: false, problems: ['not a BSM backup file (no tables)'], meta: null, data: null }
    return { kind: 'export', ok: true, problems: [], meta: { exportedAt: data.exportedAt ?? null, dbId: null, deviceName: 'Export All Data file', counts: Object.fromEntries(Object.entries(data.tables).map(([t, r]) => [t, r.length])) }, data }
  } catch {
    return { kind: 'device', ok: false, problems: ['the file cannot be read (damaged or not a BSM backup)'], meta: null, data: null }
  }
}

/** The database id this device is tied to (first label of its Dexie Cloud address), or '' when unknown. */
export const databaseIdOf = (databaseUrl) => { try { return new URL(databaseUrl).hostname.split('.')[0] } catch { return '' } }

const keyPathOf = (db, table) => {
  try {
    const kp = db.table(table).schema.primKey.keyPath
    return typeof kp === 'string' ? kp : null
  } catch { return null } // a table this app version does not have
}

/** Works out what a restore would do. `fileDbId`/`thisDbId` differing makes `blocked` true with a plain reason. */
export const planRestore = async (db, parsed, thisDbId) => {
  const { meta, data } = parsed
  let blocked = null
  if (meta?.dbId && thisDbId && meta.dbId !== thisDbId) blocked = `This file belongs to database ${meta.dbId}, but this PC is tied to ${thisDbId}. Restoring it here would mix two databases.`
  const localIndex = {}
  for (const table of Object.keys(data.tables)) {
    if (table.startsWith('$') || RESTORE_EXCLUDED_TABLES.has(table)) continue
    const key = keyPathOf(db, table)
    if (!key) continue
    const idx = new Map()
    for (const rec of await db.table(table).toArray()) { if (rec?.[key] != null) idx.set(String(rec[key]), stableStringify(rec)) }
    localIndex[table] = idx
    await yieldToScreen()
  }
  const diff = diffAgainstLocal(data, localIndex, (t) => keyPathOf(db, t))
  const unknownTables = Object.keys(data.tables).filter((t) => !t.startsWith('$') && !RESTORE_EXCLUDED_TABLES.has(t) && !keyPathOf(db, t))
  return { blocked, diff, unknownTables, pending: meta?.pending ?? {} }
}

export const restorePhrase = (n) => `RESTORE ${n} RECORDS INTO THIS PC`

/** Adds the missing records in small slices. Returns { added, failed } and never deletes or overwrites. */
export const applyRestore = async (db, missing, onProgress = () => {}) => {
  let added = 0
  let failed = 0
  const total = Object.values(missing).reduce((n, r) => n + r.length, 0)
  for (const [table, rows] of Object.entries(missing)) {
    for (let i = 0; i < rows.length; i += SLICE) {
      const slice = rows.slice(i, i + SLICE)
      try {
        await db.table(table).bulkAdd(slice)
        added += slice.length
      } catch (e) {
        // a record that appeared meanwhile (sync) fails to add; the others in the slice are still added by Dexie
        const bad = e?.failures?.length ?? slice.length
        failed += bad
        added += slice.length - bad
      }
      onProgress(added + failed, total)
      await yieldToScreen()
    }
  }
  return { added, failed }
}
