// The device backup file: how one PC's full copy of its data is written, checked and compared.
//
// Pure module (no database, no browser-only imports) so the exact same code runs in the app (saving, verifying,
// restoring this PC from a file) and in the node tools (tools/device-file/verify.mjs, tools/gap-recovery/gap.mjs).
//
// File format (after gunzip): two lines of JSON.
//   line 1  meta   { format, version, deviceId, deviceName, user, appVersion, schemaVersion, dbId, exportedAt,
//                    lastSyncAt, pending: { <table>: n }, counts: { <table>: n }, tablesSha256 }
//   line 2  data   { exportedAt, databaseName, tables: { <table>: [records] } }   (the Export All Data shape)
// tablesSha256 is the SHA-256 of line 2's UTF-8 bytes, so a file can be checked without trusting its own counts alone.

export const DEVICE_FILE_FORMAT = 'bsm-device-backup'
export const DEVICE_FILE_VERSION = 1

// Tables a restore never writes: per-device caches and the health/error bookkeeping the device rebuilds itself.
export const RESTORE_EXCLUDED_TABLES = new Set([
  'serialCounterCache', 'sdoSerialCounterCache', 'preloadState', 'millingOrders', 'privateMillerAllocations', 'cashLedger',
  'deviceStatus', 'systemStatus', 'deviceInfo', 'errorLogs',
])

const isInternal = (table) => table.startsWith('$')

export const sha256Hex = async (text) => {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const stableStringify = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x))

export const countTables = (tables) => Object.fromEntries(Object.entries(tables).filter(([t]) => !isInternal(t)).map(([t, rows]) => [t, rows.length]))

/** Builds the file text (not yet gzipped). `meta` carries the device and sync facts; counts and the hash are added here. */
export const buildDeviceFileText = async (meta, tables, { exportedAt = new Date().toISOString(), databaseName = '' } = {}) => {
  const dataLine = JSON.stringify({ exportedAt, databaseName, tables })
  const tablesSha256 = await sha256Hex(dataLine)
  const metaLine = JSON.stringify({
    ...meta,
    format: DEVICE_FILE_FORMAT,
    version: DEVICE_FILE_VERSION,
    exportedAt,
    counts: countTables(tables),
    tablesSha256,
  })
  return { text: `${metaLine}\n${dataLine}`, sha256: tablesSha256 }
}

/** Splits the two lines. Throws a plain-language Error when the text is not a device file at all. */
export const parseDeviceFileText = (text) => {
  const cut = text.indexOf('\n')
  if (cut < 0) throw new Error('not a BSM device backup file (no data line)')
  let meta
  try { meta = JSON.parse(text.slice(0, cut)) } catch { throw new Error('not a BSM device backup file (unreadable header)') }
  if (meta?.format !== DEVICE_FILE_FORMAT) throw new Error('not a BSM device backup file (wrong format)')
  const dataLine = text.slice(cut + 1)
  return { meta, dataLine }
}

/** Checks a file's text. Never throws: returns { ok, problems[], meta, data } and `data` only when it parsed. */
export const verifyDeviceFile = async (text) => {
  const problems = []
  let parsed
  try { parsed = parseDeviceFileText(text) } catch (e) { return { ok: false, problems: [e.message], meta: null, data: null } }
  const { meta, dataLine } = parsed
  if (meta.version !== DEVICE_FILE_VERSION) problems.push(`format version ${meta.version} is not supported (expected ${DEVICE_FILE_VERSION})`)
  const sha = await sha256Hex(dataLine)
  if (sha !== meta.tablesSha256) problems.push('the data does not match its checksum (the file was changed or damaged)')
  let data = null
  try { data = JSON.parse(dataLine) } catch { problems.push('the data section cannot be read (file cut short or damaged)') }
  if (data) {
    if (!data.tables || typeof data.tables !== 'object') problems.push('no tables in the file')
    else {
      const actual = countTables(data.tables)
      for (const t of new Set([...Object.keys(actual), ...Object.keys(meta.counts ?? {})])) {
        if ((actual[t] ?? 0) !== (meta.counts?.[t] ?? 0)) problems.push(`table ${t}: header says ${meta.counts?.[t] ?? 0} records, file holds ${actual[t] ?? 0}`)
      }
    }
  }
  if (!meta.dbId) problems.push('the header does not say which database this device was tied to')
  return { ok: problems.length === 0, problems, meta, data }
}

/**
 * What restoring `data` onto this device would do. `localIndex[table]` is a Map(id -> stableStringify(record)) of what the
 * device holds now; `keyOf(table)` returns the table's single primary key name (or null when it cannot be restored by id).
 * Insert-only: records absent locally are `missing`; present-but-different are `different` (listed, never overwritten).
 */
export const diffAgainstLocal = (data, localIndex, keyOf) => {
  const perTable = {}
  const missing = {}
  let totalMissing = 0
  let totalDifferent = 0
  for (const [table, rows] of Object.entries(data.tables ?? {})) {
    if (isInternal(table) || RESTORE_EXCLUDED_TABLES.has(table)) continue
    const key = keyOf(table)
    if (!key || typeof key !== 'string') { perTable[table] = { inFile: rows.length, missing: 0, same: 0, different: 0, skipped: true }; continue }
    const local = localIndex[table] ?? new Map()
    const row = { inFile: rows.length, missing: 0, same: 0, different: 0, skipped: false }
    for (const rec of rows) {
      const id = rec?.[key]
      if (id == null) continue
      const mine = local.get(String(id))
      if (mine === undefined) { (missing[table] ??= []).push(rec); row.missing += 1 } else if (mine === stableStringify(rec)) row.same += 1
      else row.different += 1
    }
    perTable[table] = row
    totalMissing += row.missing
    totalDifferent += row.different
  }
  return { perTable, missing, totalMissing, totalDifferent }
}

/** The one-line name used for the daily files: bsm-<device name>-<yyyy-mm-dd>. Only [a-z0-9-] so it is safe on any disk. */
export const deviceFileBaseName = (deviceName, dateIso) => {
  const safe = String(deviceName || 'pc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pc'
  return `bsm-${safe}-${dateIso}`
}

/** True for a file name this feature wrote itself (the only files retention may delete). */
export const isOwnDeviceFileName = (name) => /^bsm-[a-z0-9-]+-\d{4}-\d{2}-\d{2}(\.json\.gz|\.manifest\.json)$/.test(name)

/** From a list of own file names, the ones to delete so only the newest `keepDays` calendar days (distinct dates) remain. */
export const filesToPrune = (names, keepDays = 45) => {
  const own = names.filter(isOwnDeviceFileName)
  const dates = [...new Set(own.map((n) => n.match(/(\d{4}-\d{2}-\d{2})\.(?:json\.gz|manifest\.json)$/)[1]))].sort().reverse()
  const keep = new Set(dates.slice(0, Math.max(30, keepDays)))
  return own.filter((n) => !keep.has(n.match(/(\d{4}-\d{2}-\d{2})\.(?:json\.gz|manifest\.json)$/)[1]))
}
