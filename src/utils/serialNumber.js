// Serial number handling.
//
// Every warehouse keeps its OWN document series per type — WSR/WSI/WTS/
// ESR/ESI serials are scoped to (type, warehouseId), not type alone. Two
// different warehouses can both have a "WSR #11760001" and that's fine;
// what's NOT fine is the same warehouse having two.
//
// WSR and WSI additionally keep a SEPARATE series per cereal category
// (Rice vs Palay) within the same warehouse - a Rice tab and Palay tab
// can both have a "WSR #50" for the same warehouse, and that's correct,
// not a collision. Every function below takes an optional
// cerealCategory parameter for this: pass 'Rice' or 'Palay' from
// StockFormBase's tab selection, or omit it (the default, null) for
// every other type, which behaves exactly as before - no filtering.
//
// Rules:
//  - The serial is the FIRST field on every form, fully editable.
//  - On form load, the system suggests "one higher than the highest
//    known serial for this (type, warehouse[, category])" as a
//    starting point.
//  - Uniqueness is checked per (type, warehouseId[, category]) —
//    switching the warehouse or tab on a form changes which serial
//    pool applies.
//  - A -/+ stepper nudges the serial by 1. If stepping back (-) lands on
//    a serial that already has data for this (type, warehouse), the form
//    should load that document for Update/Delete instead of treating it
//    as a fresh entry — see findTransactionBySerial / StockFormBase's
//    series-navigation logic.
//  - Serials may contain a non-numeric prefix (e.g. "B11766626"); +/-
//    only operates on the trailing numeric run, prefix preserved.
//
// serialCounters (added for the "app doesn't remember the last serial"
// fix): an explicit, fast tracker of the last-used serial per
// (warehouseId, type, cerealCategory), kept up to date via
// recordSerialUsed - called by every form right after a successful
// save. This exists ON TOP OF (not instead of) scanning local
// transaction history, because that scan alone is only correct if this
// specific device's local database happens to already contain every
// prior transaction for that warehouse - which isn't guaranteed if a
// different device was used for the same warehouse, or if local
// storage was ever cleared/reset. suggestNextSerial takes whichever of
// the two sources is actually higher, so the tracker can never cause a
// regression even if it's ever missing or stale for some reason.
// cerealCategory defaults to the 'ALL' sentinel within this table's key
// specifically (compound keys need a concrete value), for types that
// aren't category-scoped.

import Dexie from 'dexie'
import { db } from '../db/dexie.js'

const SERIAL_PATTERN = /^(.*?)(\d+)$/
const counterKey = (warehouseId, type, cerealCategory) => [warehouseId, type, cerealCategory ?? 'ALL']

/**
 * Compares two transactions (or transaction-shaped objects with a
 * `date`, optional `createdAt`, and `serialNo`) by how recently they
 * were actually USED, not by serial magnitude. Returns positive if `a`
 * is more recent than `b`, negative if `b` is more recent, 0 if tied.
 *
 * Rules, in order:
 *   1. Later `date` (the document's own date, YYYY-MM-DD string) wins -
 *      this is what "which series is currently active" really means: a
 *      booklet started on a later date is the current one, regardless
 *      of whether its numbers happen to be lower than an older
 *      booklet's.
 *   2. Same `date`: later `createdAt` (real save-time, epoch ms) wins -
 *      resolves same-day series changes (a booklet running out and a
 *      new one starting later the same day) that `date` alone can't
 *      distinguish.
 *   3. `createdAt` missing on either side (pre-fix historical data):
 *      falls back to comparing the serial's own numeric value - this
 *      preserves today's existing (imperfect, but familiar) behavior
 *      for old data, rather than guessing at an order that was never
 *      recorded.
 */
export const compareByRecency = (a, b) => {
  if (a.date !== b.date) return a.date > b.date ? 1 : -1
  if (a.createdAt != null && b.createdAt != null && a.createdAt !== b.createdAt) {
    return a.createdAt > b.createdAt ? 1 : -1
  }
  const aParsed = parseSerial(a.serialNo)
  const bParsed = parseSerial(b.serialNo)
  const aNum = aParsed?.number ?? -Infinity
  const bNum = bParsed?.number ?? -Infinity
  return aNum - bNum
}

/**
 * Split a serial into its non-numeric prefix and trailing numeric run.
 * "B11766626" -> { prefix: "B", number: 11766626, digits: 8 }
 * "1729564"   -> { prefix: "", number: 1729564, digits: 7 }
 * Returns null if the serial has no trailing digits at all.
 */
export const parseSerial = (serial = '') => {
  const match = SERIAL_PATTERN.exec(serial.trim())
  if (!match) return null

  const [, prefix, digits] = match
  return { prefix, number: parseInt(digits, 10), digits: digits.length }
}

/** Reassembles a serial from parseSerial's parts, zero-padding to match the original width. */
const formatSerial = ({ prefix, number, digits }) => {
  const numStr = String(Math.max(number, 0)).padStart(digits, '0')
  return `${prefix}${numStr}`
}

/**
 * Step a serial up or down by 1, preserving any non-numeric prefix and
 * zero-padding width. Returns the original string unchanged if it has no
 * trailing numeric run to step.
 */
export const stepSerial = (serial, delta) => {
  const parsed = parseSerial(serial)
  if (!parsed) return serial
  return formatSerial({ ...parsed, number: parsed.number + delta })
}

/**
 * Records that a serial was just used for this (type, warehouse[,
 * category]) - called right after a transaction is successfully saved.
 * Always overwrites the tracker with THIS serial, regardless of
 * whether its number is higher or lower than what was previously
 * tracked - the just-saved transaction is, by definition, the most
 * recently used one for this pool. (Previously this only updated the
 * tracker when the new number was numerically higher, which is exactly
 * why re-opening the app kept suggesting an old, higher-numbered
 * booklet's next serial instead of the lower-numbered booklet actually
 * in current use.)
 *
 * `date`/`createdAt` (from the saved transaction itself, when the
 * caller has them - both optional) are stored alongside so
 * suggestNextSerial can compare this tracked entry against a live scan
 * using the same chronological-recency rule (compareByRecency) instead
 * of blindly trusting whichever call happened most recently, which
 * matters for cross-device correctness (a different device's more
 * recent save, synced in later via Dexie Cloud, should still win).
 */
export const recordSerialUsed = async (type, warehouseId, serialNo, cerealCategory = null, meta = {}) => {
  const parsed = parseSerial(serialNo)
  if (!parsed || !warehouseId) return

  const key = counterKey(warehouseId, type, cerealCategory)
  await db.serialCounterCache.put({
    warehouseId,
    type,
    cerealCategory: cerealCategory ?? 'ALL',
    prefix: parsed.prefix,
    digits: parsed.digits,
    number: parsed.number,
    date: meta.date ?? null,
    createdAt: meta.createdAt ?? null,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Recomputes the serialCounters tracker for this (type, warehouse[,
 * category]) from what's actually left in local transaction history -
 * call this after ANY deletion (a normal Delete, or an un-void that
 * removes a Cancelled record). Without this, deleting the highest-
 * numbered serial leaves the tracker stale, still pointing at a number
 * that no longer exists - suggestNextSerial would then skip straight
 * past a serial that's now genuinely available again (e.g. #506
 * un-voided and deleted, but the next new entry gets suggested as #507
 * instead of the now-free #506). Sets the tracker to the actual
 * remaining highest, or removes the tracker entry entirely if nothing
 * is left at all.
 */
export const recalculateSerialCounter = async (type, warehouseId, cerealCategory = null) => {
  if (!warehouseId) return

  const remaining = await db.transactions
    .where('type')
    .equals(type)
    .and((tx) => tx.warehouseId === warehouseId && (cerealCategory == null || tx.cerealCategory === cerealCategory))
    .toArray()

  // Keeps the most RECENT remaining transaction (by compareByRecency -
  // date, then createdAt, then numeric magnitude as the historical-data
  // fallback), not the numerically highest, so the tracker still points
  // at the actual current series after a deletion rather than jumping
  // back to whichever booklet happens to have the biggest numbers.
  let best = null
  for (const tx of remaining) {
    const parsed = parseSerial(tx.serialNo)
    if (!parsed) continue
    if (!best || compareByRecency(tx, best.tx) > 0) best = { ...parsed, tx }
  }

  const key = counterKey(warehouseId, type, cerealCategory)
  if (!best) {
    await db.serialCounterCache.delete(key)
    return
  }

  await db.serialCounterCache.put({
    warehouseId,
    type,
    cerealCategory: cerealCategory ?? 'ALL',
    prefix: best.prefix,
    digits: best.digits,
    number: best.number,
    date: best.tx.date ?? null,
    createdAt: best.tx.createdAt ?? null,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Suggests a starting serial for a new document of this (type,
 * warehouse[, category]): one higher than the serial of whichever
 * transaction in that pool was actually used most RECENTLY - by
 * compareByRecency (document date, then real save time, then numeric
 * magnitude only as the fallback for historical data predating this)
 * - not the numerically highest serial ever recorded. Falls back to
 * `fallback` (default "1") if no prior documents exist for this pool —
 * every warehouse's series (and, for WSR/WSI, every cereal category
 * within it) starts fresh from 1.
 *
 * This is what makes the suggestion follow whichever booklet is
 * actually in current use: a booklet that started on a later date (or
 * later the same day) always wins here, even if an older booklet's
 * numbers happen to be numerically higher - previously, an older but
 * numerically-higher booklet kept winning forever, forcing a manual
 * retype every session.
 *
 * Checks the fast serialCounters tracker first (an explicit record kept
 * up to date via recordSerialUsed on every save - see the file header
 * for why this exists on top of just scanning local transactions: a
 * device's local transaction history alone isn't a reliable source if
 * a different device was used for the same warehouse, or if local
 * storage was ever cleared). Still reconciles against a full scan of
 * local transaction history as a safety net, taking whichever of the
 * two is actually more recent by the same rule - so the tracker can
 * never cause the suggestion to regress even if it's ever missing or
 * stale.
 */
export const suggestNextSerial = async (type, warehouseId, fallback = '1', cerealCategory = null) => {
  if (!warehouseId) return fallback

  const tracked = await db.serialCounterCache.get(counterKey(warehouseId, type, cerealCategory))

  // Uses the existing [type+warehouseId+serialNo] compound index to
  // narrow to just this warehouse's records before any further work -
  // the previous version scanned every transaction of this type
  // across every warehouse in JavaScript, which is genuinely slow at
  // scale (especially for an admin with all warehouses preloaded),
  // and this function runs on every cereal tab switch.
  const existing = await db.transactions
    .where('[type+warehouseId+serialNo]')
    .between([type, warehouseId, Dexie.minKey], [type, warehouseId, Dexie.maxKey])
    .and((tx) => cerealCategory == null || tx.cerealCategory === cerealCategory)
    .toArray()

  let best = tracked
    ? { prefix: tracked.prefix, number: tracked.number, digits: tracked.digits, date: tracked.date, createdAt: tracked.createdAt, serialNo: formatSerial(tracked) }
    : null
  for (const tx of existing) {
    const parsed = parseSerial(tx.serialNo)
    if (!parsed) continue
    if (!best || compareByRecency(tx, best) > 0) best = { ...parsed, date: tx.date, createdAt: tx.createdAt, serialNo: tx.serialNo }
  }

  if (!best) return fallback
  return formatSerial({ ...best, number: best.number + 1 })
}

/**
 * Checks whether a serial is already used by another document of the same
 * (type, warehouse[, category]). `excludeId` lets an in-progress edit
 * ignore its own prior value.
 */
export const isSerialTaken = async (type, warehouseId, serialNo, excludeId = null, cerealCategory = null) => {
  if (!serialNo || !warehouseId) return false
  const match = await db.transactions
    .where('type')
    .equals(type)
    .and((tx) => tx.warehouseId === warehouseId && tx.serialNo === serialNo && tx.id !== excludeId
      && (cerealCategory == null || tx.cerealCategory === cerealCategory))
    .first()
  return Boolean(match)
}

/**
 * Same exact query as isSerialTaken, but returns the actual matched
 * record instead of a boolean - used to recover from a "serial
 * already taken" detection by loading the real record the check
 * found, rather than only being able to block with an error. This
 * matters specifically when the earlier lookup that should have
 * loaded this record for editing (checkAndLoadSerial, via
 * findTransactionBySerial) missed it for any reason - the user is
 * left thinking they're creating new when they're actually editing an
 * existing record, and validateForm's duplicate check is the last
 * point where that mismatch can still be caught and corrected.
 */
export const getMatchingTransaction = async (type, warehouseId, serialNo, excludeId = null, cerealCategory = null) => {
  if (!serialNo || !warehouseId) return null
  return db.transactions
    .where('type')
    .equals(type)
    .and((tx) => tx.warehouseId === warehouseId && tx.serialNo === serialNo && tx.id !== excludeId
      && (cerealCategory == null || tx.cerealCategory === cerealCategory))
    .first()
}

/**
 * Looks up the existing transaction (if any) for a given (type,
 * warehouse, serial[, category]) — used for series back-navigation:
 * stepping to a serial that already has data should load it for
 * Update/Delete instead of treating it as a blank new entry. For
 * WSR/WSI, cerealCategory MUST be passed and matched, since the same
 * number can legitimately exist in both Rice and Palay's separate
 * series for the same warehouse - without this filter, navigating to
 * "WSR #50" on the Rice tab could incorrectly load Palay's #50 instead.
 */
export const findTransactionBySerial = async (type, warehouseId, serialNo, cerealCategory = null) => {
  if (!serialNo || !warehouseId) return null
  return db.transactions
    .where('type')
    .equals(type)
    .and((tx) => tx.warehouseId === warehouseId && tx.serialNo === serialNo
      && (cerealCategory == null || tx.cerealCategory === cerealCategory))
    .first()
}

/**
 * Finds the real, actually-existing transaction immediately after
 * (`direction: 1`) or before (`direction: -1`) the given serial in this
 * pool's true chronological usage order (compareByRecency), for paging
 * through real document history with the Next/Previous steppers.
 *
 * This replaces guessing `serialNo ± 1` and looking for an exact match,
 * which dead-ends the instant a series boundary is crossed - e.g.
 * stepping past #2000 (the last document of an exhausted booklet)
 * previously guessed a nonexistent #2001 and gave up, instead of
 * landing on the real next document (#5751 in a booklet that started
 * later that same day). Walking the actual sorted sequence instead
 * means it doesn't matter whether the next real document's number is
 * higher, lower, or from a completely different range - only that it
 * comes right after this one in real usage order.
 *
 * Returns `null` if `serialNo` itself isn't found, or if it's already
 * at the true edge of history in the requested direction - callers
 * should fall back to their normal blank-new-entry / floor-warning
 * behavior in that case, exactly as they already do today.
 */
export const findAdjacentTransaction = async (type, warehouseId, serialNo, cerealCategory = null, direction = 1) => {
  const current = await findTransactionBySerial(type, warehouseId, serialNo, cerealCategory)
  if (!current) return null

  const pool = await db.transactions
    .where('[type+warehouseId+serialNo]')
    .between([type, warehouseId, Dexie.minKey], [type, warehouseId, Dexie.maxKey])
    .and((tx) => cerealCategory == null || tx.cerealCategory === cerealCategory)
    .toArray()

  const sorted = pool.slice().sort(compareByRecency)
  const index = sorted.findIndex((tx) => tx.id === current.id)
  if (index === -1) return null

  const adjacent = sorted[index + direction]
  return adjacent ?? null
}
