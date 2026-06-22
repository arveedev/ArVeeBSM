// Serial number handling.
//
// Every warehouse keeps its OWN document series per type — WSR/WSI/WTS/
// ESR/ESI serials are scoped to (type, warehouseId), not type alone. Two
// different warehouses can both have a "WSR #11760001" and that's fine;
// what's NOT fine is the same warehouse having two.
//
// Rules:
//  - The serial is the FIRST field on every form, fully editable.
//  - On form load, the system suggests "one higher than the highest
//    existing serial for this (type, warehouse)" as a starting point.
//  - Uniqueness is checked per (type, warehouseId) — switching the
//    warehouse on a form changes which serial pool applies.
//  - A -/+ stepper nudges the serial by 1. If stepping back (-) lands on
//    a serial that already has data for this (type, warehouse), the form
//    should load that document for Update/Delete instead of treating it
//    as a fresh entry — see findTransactionBySerial / StockFormBase's
//    series-navigation logic.
//  - Serials may contain a non-numeric prefix (e.g. "B11766626"); +/-
//    only operates on the trailing numeric run, prefix preserved.

import { db } from '../db/dexie.js'

const SERIAL_PATTERN = /^(.*?)(\d+)$/

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
 * Suggests a starting serial for a new document of this (type, warehouse):
 * one higher than the highest existing serial in that pool. Falls back to
 * `fallback` (default "1") if no prior documents exist for this
 * warehouse — every warehouse's series starts fresh from 1, since each
 * warehouse keeps its own independent series per document type rather
 * than sharing a single running count across warehouses.
 */
export const suggestNextSerial = async (type, warehouseId, fallback = '1') => {
  if (!warehouseId) return fallback

  const existing = await db.transactions
    .where('type')
    .equals(type)
    .and((tx) => tx.warehouseId === warehouseId)
    .toArray()

  let best = null
  for (const tx of existing) {
    const parsed = parseSerial(tx.serialNo)
    if (!parsed) continue
    if (!best || parsed.number > best.number) best = parsed
  }

  if (!best) return fallback
  return formatSerial({ ...best, number: best.number + 1 })
}

/**
 * Checks whether a serial is already used by another document of the same
 * (type, warehouse). `excludeId` lets an in-progress edit ignore its own
 * prior value.
 */
export const isSerialTaken = async (type, warehouseId, serialNo, excludeId = null) => {
  if (!serialNo || !warehouseId) return false
  const match = await db.transactions
    .where('type')
    .equals(type)
    .and((tx) => tx.warehouseId === warehouseId && tx.serialNo === serialNo && tx.id !== excludeId)
    .first()
  return Boolean(match)
}

/**
 * Looks up the existing transaction (if any) for a given (type, warehouse,
 * serial) — used for series back-navigation: stepping to a serial that
 * already has data should load it for Update/Delete instead of treating
 * it as a blank new entry.
 */
export const findTransactionBySerial = async (type, warehouseId, serialNo) => {
  if (!serialNo || !warehouseId) return null
  return db.transactions
    .where('type')
    .equals(type)
    .and((tx) => tx.warehouseId === warehouseId && tx.serialNo === serialNo && tx.status === 'Active')
    .first()
}
