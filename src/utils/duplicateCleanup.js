// Duplicate Cleanup - Admin tool for serials held twice (or more) in the
// same warehouse, left behind by older Sheet imports. Built to be unable
// to lose real data:
//
//  - The scan is read-only. Nothing is changed until Apply.
//  - A group is AUTO-eligible only when every copy except the one kept is
//    a bare Sheet placeholder (no pile, MTS, gross weight, group link, and
//    not referenced by a Purchase Receipt), the date is on/before the
//    warehouse's effective cutoff (or the copy kept is one the app itself
//    created, so the others are just old Sheet echoes), nothing is
//    waiting to sync, and no field holds a different value from the kept
//    copy. Anything else is listed as MANUAL and never touched here.
//  - Before any delete, the full removed records (and the kept copies as
//    they were) are downloaded as a snapshot file. "Restore" puts them back.
//  - Only the local database is changed; the Google Sheet is never touched.
//    Deletes go in small batches to stay inside Dexie Cloud push limits.

import { db } from '../db/dexie.js'
import { effectiveCutoffDate } from './calculations.js'
import { logError } from './errorLog.js'

const IGNORED_FIELDS = new Set([
  'id', 'isSynced', 'hasBeenBackedUp', 'syncFailureLogged', 'staleCleanupLogged',
  'fromSheetImport', 'needsCompletion', 'changeLog', 'createdAt', 'updatedAt',
  'firstSeenAt', 'lastSeenAt', 'missingFromSheetAt', 'staleSheetSerials', 'autoComputeNet',
])
const AUTO_TYPES = new Set(['WSR', 'WSI', 'WTS', 'ESR', 'ESI'])
const BATCH = 200
const BATCH_PAUSE_MS = 1500

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
const completeness = (t) => Object.values(t).filter((v) => !isEmpty(v)).length
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const isPlaceholder = (t, referencedIds) =>
  (t.fromSheetImport === true || t.needsCompletion === true) &&
  !t.pileId && !t.receivedPileId && !t.issuedPileId &&
  isEmpty(t.grossKilos) && isEmpty(t.mtsSackTypeId) && isEmpty(t.groupSerialNo) &&
  !referencedIds.has(t.id)

// A Sheet copy carrying no figures or names at all (e.g. a cancelled row).
const isBare = (t) =>
  isEmpty(t.numberOfBags) && isEmpty(t.grossKilos) && isEmpty(t.netKilos) && isEmpty(t.aiNumber) && isEmpty(t.customerName)

const conflictingFields = (keeper, other) => {
  const out = []
  for (const [field, value] of Object.entries(other)) {
    if (IGNORED_FIELDS.has(field) || isEmpty(value)) continue
    if (!isEmpty(keeper[field]) && !sameValue(keeper[field], value)) out.push(field)
  }
  return out
}

/** Read-only. Returns { auto, manual, totals }. */
export const scanDuplicates = async () => {
  const [all, warehouses, config, prs] = await Promise.all([
    db.transactions.toArray(),
    db.warehouses.toArray(),
    db.reportConfig.get('global'),
    db.purchaseReceipts.toArray(),
  ])
  const referencedIds = new Set(prs.map((p) => p.wsrTransactionId).filter(Boolean))
  const cutoffByWh = new Map(warehouses.map((w) => [w.warehouseId, effectiveCutoffDate(w.reportingCutoffDate, config?.dataStartDate)]))
  const nameByWh = new Map(warehouses.map((w) => [w.warehouseId, w.name]))

  const groups = new Map()
  for (const t of all) {
    if (t.isInitialBalance) continue
    const key = `${t.type}::${t.warehouseId}::${String(t.serialNo ?? '').trim()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }

  const auto = []
  const manual = []
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue
    const first = rows[0]
    const label = { key, type: first.type, serialNo: first.serialNo, warehouseId: first.warehouseId, warehouse: nameByWh.get(first.warehouseId) ?? first.warehouseId, count: rows.length }

    const placeholders = rows.filter((t) => isPlaceholder(t, referencedIds))
    const nonPlaceholders = rows.filter((t) => !placeholders.includes(t))
    const pool = nonPlaceholders.length > 0 ? nonPlaceholders : rows
    const keeper = [...pool].sort((a, b) => (a.fromSheetImport === true) - (b.fromSheetImport === true) || completeness(b) - completeness(a))[0]
    const others = rows.filter((t) => t.id !== keeper.id)

    const cutoff = cutoffByWh.get(first.warehouseId)
    const keeperIsAppMade = keeper.fromSheetImport !== true && keeper.needsCompletion !== true
    const beforeCutoff = cutoff && rows.every((t) => t.date && t.date <= cutoff)
    const reasons = []
    if (!AUTO_TYPES.has(first.type)) reasons.push('record type not covered')
    if (nonPlaceholders.length > 1) reasons.push(`${nonPlaceholders.length} copies hold real data (pile / weights / links)`)
    // Live-period copies are allowed only in the safest shape: one copy the
    // app itself created (not from the Sheet, nothing left to complete) and
    // the rest bare placeholders - i.e. an old Sheet echo of a real entry.
    if (!beforeCutoff && !(keeperIsAppMade && nonPlaceholders.length === 1)) reasons.push('live period and no app-made copy to keep')
    if (rows.some((t) => t.isSynced === false)) reasons.push('a copy is still waiting to sync')
    for (const o of others) {
      // Bare Sheet echo of an app-made entry (same serial, e.g. the Sheet's
      // old cancelled row for a serial the app later reused): nothing in it
      // to lose, so a different date/status does not block.
      if (keeperIsAppMade && placeholders.includes(o) && isBare(o)) continue
      const bad = conflictingFields(keeper, o)
      if (bad.length) reasons.push(`values differ: ${bad.join(', ')}`)
    }
    const uniqueReasons = [...new Set(reasons)]

    // History merge (owner-approved): the app only uses data after the cutoff,
    // so for copies wholly on/before it, differing descriptive values (names,
    // age units...) don't block. The most complete copy stays and fills its
    // blanks from the others. Still never removes a copy that is linked to a
    // Purchase Receipt, holds a pile/group link the kept copy lacks, or is
    // waiting to sync.
    const linkDiffers = (o) =>
      ['pileId', 'receivedPileId', 'issuedPileId', 'groupSerialNo'].some((f) => !isEmpty(o[f]) && !sameValue(o[f], keeper[f]))
    const historyMergeOk =
      beforeCutoff && AUTO_TYPES.has(first.type) && rows.every((t) => t.isSynced !== false) &&
      others.every((o) => !referencedIds.has(o.id) && (!linkDiffers(o) || (keeperIsAppMade && o.fromSheetImport === true)))

    if (uniqueReasons.length === 0) auto.push({ ...label, keeper, remove: others })
    else if (historyMergeOk) auto.push({ ...label, keeper, remove: others, historyMerge: true })
    else manual.push({ ...label, reasons: uniqueReasons, keeperId: keeper.id, rows })
  }

  const byKey = (a, b) => a.warehouse.localeCompare(b.warehouse) || String(a.serialNo).localeCompare(String(b.serialNo), undefined, { numeric: true })
  auto.sort(byKey)
  manual.sort(byKey)
  return { auto, manual, totals: { auto: auto.length, autoRemove: auto.reduce((n, g) => n + g.remove.length, 0), manual: manual.length } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const downloadJson = (obj, filename) => {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/**
 * Applies the given auto groups. The snapshot file is downloaded BEFORE the
 * first change. Kept copies receive any value the removed copies had and
 * the kept copy lacked (none expected - conflict-free by construction).
 */
export const applyDuplicateCleanup = async (groups, onProgress = () => {}) => {
  if (groups.length === 0) return { removed: 0 }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  downloadJson(
    {
      kind: 'bsm-duplicate-cleanup-snapshot',
      createdAt: new Date().toISOString(),
      removed: groups.flatMap((g) => g.remove),
      keepersBefore: groups.map((g) => g.keeper),
    },
    `bsm-duplicate-cleanup-snapshot-${stamp}.json`
  )
  await sleep(800)

  let removed = 0
  let removedWsi = false
  for (let i = 0; i < groups.length; i += BATCH) {
    const chunk = groups.slice(i, i + BATCH)
    const keepers = chunk.map((g) => {
      const merged = { ...g.keeper }
      for (const o of g.remove) {
        for (const [f, v] of Object.entries(o)) {
          if (f !== 'id' && isEmpty(merged[f]) && !isEmpty(v)) merged[f] = v
        }
      }
      return merged
    })
    const ids = chunk.flatMap((g) => g.remove.map((r) => r.id))
    if (chunk.some((g) => g.type === 'WSI')) removedWsi = true
    await db.transactions.bulkPut(keepers)
    await db.transactions.bulkDelete(ids)
    removed += ids.length
    onProgress(removed)
    if (i + BATCH < groups.length) await sleep(BATCH_PAUSE_MS)
  }

  if (removedWsi) {
    try {
      const { recalculateAuthorityIssuedTotals } = await import('../services/googleSheetsBridge.js')
      await recalculateAuthorityIssuedTotals()
    } catch (err) {
      console.error('Authority totals recalculation after duplicate cleanup failed:', err)
    }
  }
  const pileIds = [...new Set(groups.flatMap((g) => g.remove.flatMap((r) => [r.pileId, r.receivedPileId, r.issuedPileId])).filter(Boolean))]
  if (pileIds.length > 0) {
    try {
      const { recalculatePileCurrentState } = await import('./pileLedger.js')
      for (const id of pileIds) await recalculatePileCurrentState(id)
    } catch (err) {
      console.error('Pile recalculation after duplicate cleanup failed:', err)
    }
  }
  logError(
    'Duplicate cleanup',
    new Error(`Removed ${removed} duplicate placeholder record(s) across ${groups.length} serial(s). Snapshot file bsm-duplicate-cleanup-snapshot-${stamp}.json holds them.`),
    { nickname: 'Admin', role: 'Admin' }
  )
  return { removed }
}

/** Puts a snapshot file's records back (removed copies and kept copies as they were). */
export const restoreSnapshot = async (file) => {
  const data = JSON.parse(await file.text())
  if (data?.kind !== 'bsm-duplicate-cleanup-snapshot') throw new Error('This is not a duplicate-cleanup snapshot file.')
  const rows = [...(data.removed ?? []), ...(data.keepersBefore ?? [])]
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.transactions.bulkPut(rows.slice(i, i + BATCH))
    if (i + BATCH < rows.length) await sleep(BATCH_PAUSE_MS)
  }
  return rows.length
}
