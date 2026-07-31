// Google Sheets bridge — live integration with the user's existing Apps
// Script Web App (this app does not deploy or own that script).
//
// ─── One-way flows only (confirmed, no conflict resolution needed) ────
//   AI/SIA authorities:  Sheets -> App only (this app never writes them)
//   Transactions:        App -> Sheets only, as a backup log, not a
//                         live source of truth for anything the app reads
//
// ─── Multi-year sheet sources ──────────────────────────────────────
// The user creates a fresh spreadsheet copy every year rather than
// letting one sheet grow unbounded (see db.sheetSources, managed from
// the admin "Sheet Sources" tab). Authorities are synced from EVERY
// configured source, not just whichever one covers today - an AI/SIA
// from December still has real remaining balance to issue against in
// January, so year-boundary authorities must never be silently dropped
// just because the calendar rolled over. Transaction backups, by
// contrast, are written to whichever ONE source's date range covers
// today (see getActiveSheetSource).
//
// ─── Write allowlist (structural, not just convention) ────────────
// This app must NEVER be able to write to the AI/SIA sheets, or any
// sheet outside an explicit, named list - WRITE_ALLOWLIST_KEYS below is
// that list, and pushTransactionBackup() checks against it before every
// single write. Adding a new writable sheet means deliberately adding
// its key here; nothing is writable by default.
//
// ─── Warehouse matching ────────────────────────────────────────────
// The AI/SIA sheets use short nicknames for warehouses that don't
// always match this app's own warehouse codes, and the same real
// warehouse sometimes has multiple typo'd spellings in the sheet.
// db.warehouseAliases (admin-configured in Warehouses) maps every
// sheet-side nickname to the correct canonical warehouseId - this is
// looked up instead of matching against warehouse.code directly.
//
// ─── SIA multi-row convention (confirmed, not the old compact format) ──
// Each row is ONE sack type + ONE condition + its own piece count. An
// SIA needing multiple sack types/conditions is multiple rows sharing
// the same SIA number - NOT a single row with a compound
// "PPMG50/PPRE50" + "65 bn/17 sh" string (that format was found to be
// genuinely ambiguous and to spill into overflow columns with no fixed
// meaning - see docs/activity-log.md for the specific examples that
// ruled it out). Each row becomes its OWN authority record, so an SIA's
// different sack-type/condition portions can be issued against and
// completed independently, matching how completion already works
// per-record elsewhere in this app.
//
// ─── Delta sync via Last Modified ──────────────────────────────────
// Both AI and SIA sheets have a Last Modified column (N), auto-stamped
// by an onEdit trigger already deployed on the user's script. Each
// sheetSource tracks its own lastSyncedAt; sync requests only rows
// modified since then, rather than re-fetching and diffing the entire
// sheet on every check.
//
// ─── Contract this app expects from the existing GAS Web App ──────────
//
// GET  {webAppUrl}?action=fetchAuthorities&sheet={sheetName}&type=AI&modifiedSince={isoString|omitted}
//   -> { status: "SUCCESS", rows: [ { ...raw sheet columns as JSON... } ] }
//   (modifiedSince omitted on a source's first-ever sync — fetch everything)
//
// POST {webAppUrl}  body: { action: "appendTransaction", sheet: sheetName,
//        row: { ...see buildBackupRow() per document type... } }
//   -> { status: "SUCCESS" }
//
// If the existing script uses different action/parameter names or
// response shapes, adjust the request-building/response-parsing here —
// don't change the script to match this file.
//
// All functions degrade gracefully (return a typed failure, never throw)
// since network access is never guaranteed in this offline-first app —
// callers are expected to check `.ok` before using `.data`.

import { db } from '../db/dexie.js'
import { normalizeWarehouseAlias } from '../utils/warehouseMatching.js'
import { todayLocalISO } from '../utils/calculations.js'

/**
 * Converts a raw sheet cell to a real number or null - critically,
 * treats an empty string the same as null/undefined. A bare `?? null`
 * does NOT catch empty strings (only null/undefined), and Number('')
 * silently coerces to 0 rather than throwing - meaning a genuinely
 * blank BAG or NET KG cell (very common on TRANSFER/MILLING-type rows
 * that only fill in one of the two) was being stored as an allocation
 * of literal 0, which then read as "0 allocated, 0 issued = Complete"
 * and got the authority wrongly marked done with no real data at all.
 */
const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

// The ONLY sheet-name keys this app is ever allowed to write to. AI/SIA
// are deliberately absent - there is no code path that can add them
// without editing this list directly, which is the point.
const WRITE_ALLOWLIST_KEYS = [
  'receiptsSheetName',
  'issuesSheetName',
  'sacksReceiptsSheetName',
  'sacksIssuesSheetName',
]

/** Every configured sheet source, oldest first. */
const getAllSheetSources = async () => db.sheetSources.orderBy('dateFrom').toArray()

/** The single source whose date range covers today, or null if none does
 * (e.g. no source configured yet for the current year). Used only for
 * WRITING new transaction backups - authority sync always uses every
 * source, never just this one. */
const getActiveSheetSource = async () => {
  const today = todayLocalISO()
  const sources = await getAllSheetSources()
  return sources.find((s) => s.dateFrom <= today && (!s.dateTo || today <= s.dateTo)) ?? null
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

/**
 * Fetches AI or SIA rows from one sheet source, using its own
 * lastSyncedAt for a delta request when available (first sync for a
 * source fetches everything).
 */
const fetchAuthorityRows = async (source, type) => {
  const sheetName = type === 'AI' ? source.aiSheetName : source.siaSheetName

  const url = new URL(source.webAppUrl)
  url.searchParams.set('action', 'fetchAuthorities')
  url.searchParams.set('sheet', sheetName)
  url.searchParams.set('type', type)
  if (source.lastSyncedAt) {
    url.searchParams.set('modifiedSince', source.lastSyncedAt)
  }

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Sheet request failed (${response.status})`)
  }

  const payload = await response.json()
  if (payload.status !== 'SUCCESS' || !Array.isArray(payload.rows)) {
    throw new Error('Unexpected response shape from Apps Script')
  }

  return payload.rows
}

/**
 * Upserts a single AI authority row, matched by aiNumber. Preserves any
 * existing totalIssued* values rather than resetting them, since
 * issuance is tracked locally as forms are saved, never overwritten
 * from the Sheet. SIA authorities use upsertSiaAuthority instead - see
 * its own comment for why they need different merge logic (an array of
 * sack lines, not a single value).
 */
const upsertAuthority = async (incoming) => {
  const existing = await db.authorities.where('aiNumber').equals(incoming.aiNumber).and((a) => a.type === 'AI').first()

  if (existing) {
    await db.authorities.update(existing.authId, {
      ...incoming,
      totalIssuedBags: existing.totalIssuedBags ?? 0,
      totalIssuedKilos: existing.totalIssuedKilos ?? 0,
      manuallyCompleted: existing.manuallyCompleted ?? false,
    })
  } else {
    await db.authorities.add({
      authId: crypto.randomUUID(),
      ...incoming,
      totalIssuedBags: 0,
      totalIssuedKilos: 0,
      status: 'Pending',
      manuallyCompleted: false,
    })
  }
}

/**
 * Upserts a SIA authority, matched by siaNumber alone - one authority
 * record per SIA number now (per explicit correction: a SIA spanning
 * multiple sack types/conditions is ONE authority with a sackLines
 * array, not separate records per line). Merges the incoming sackLines
 * with any existing ones by (sackTypeId, condition), preserving each
 * line's own totalIssuedBags progress rather than resetting it -
 * issuance is tracked locally as ESI forms are saved, never overwritten
 * from the Sheet. A sack line that no longer appears in the incoming
 * data (e.g. removed from the sheet) is dropped; a genuinely new line
 * starts at 0 issued.
 */
const upsertSiaAuthority = async (incoming) => {
  // Every record sharing this SIA number - under the previous
  // architecture (one record per sack-type+condition combination) there
  // could be several. Only one becomes the canonical record below; any
  // others are leftover duplicates from that old design and are deleted
  // entirely, since they predate the sackLines field and would
  // otherwise sit forever showing no sack type and 0 pieces.
  const allMatching = await db.authorities.where('siaNumber').equals(incoming.siaNumber).and((a) => a.type === 'SIA').toArray()

  // Prefer an existing record that already has a sackLines array (i.e.
  // one already migrated to the new shape) as the canonical one to
  // update, so its issued-progress history is preserved; otherwise fall
  // back to whichever came first.
  const existing = allMatching.find((a) => Array.isArray(a.sackLines)) ?? allMatching[0]

  const existingLineFor = (sackTypeId, condition) =>
    existing?.sackLines?.find((l) => l.sackTypeId === sackTypeId && l.condition === condition)

  const mergedLines = incoming.sackLines.map((line) => {
    const match = existingLineFor(line.sackTypeId, line.condition)
    return { ...line, totalIssuedBags: match?.totalIssuedBags ?? 0 }
  })

  const staleDuplicateIds = allMatching.filter((a) => a.authId !== existing?.authId).map((a) => a.authId)
  if (staleDuplicateIds.length > 0) {
    await db.authorities.bulkDelete(staleDuplicateIds)
  }

  if (existing) {
    await db.authorities.update(existing.authId, {
      date: incoming.date,
      assignedWarehouse: incoming.assignedWarehouse,
      customerName: incoming.customerName,
      transactionTypeName: incoming.transactionTypeName,
      remarks: incoming.remarks,
      sackLines: mergedLines,
      sourceId: incoming.sourceId,
    })
  } else {
    await db.authorities.add({
      authId: crypto.randomUUID(),
      type: 'SIA',
      siaNumber: incoming.siaNumber,
      aiNumber: null,
      date: incoming.date,
      assignedWarehouse: incoming.assignedWarehouse,
      customerName: incoming.customerName,
      transactionTypeName: incoming.transactionTypeName,
      remarks: incoming.remarks,
      sackLines: mergedLines,
      sourceId: incoming.sourceId,
      manuallyCompleted: false,
    })
  }
}

let syncInProgress = false

/**
 * Pulls AI and SIA rows from every configured sheet source and upserts
 * them into db.authorities. Never throws - returns { ok, aiCount,
 * siaCount } on success or { ok: false, reason } on any failure, since
 * this may run unattended on a background timer.
 *
 * Guarded against overlapping runs: the background worker fires this
 * every 5 minutes and again on reconnect, and a manual "Sync Now" tap
 * could easily land while one of those is still in flight (a full sync
 * can take several seconds fetching and processing many rows) - two
 * concurrent runs reading db.authorities before either has written its
 * result is a genuine way to end up with duplicate SIA records, since
 * both would conclude "no canonical record exists yet" independently.
 */
export const syncAuthoritiesFromSheets = async () => {
  if (syncInProgress) return { ok: false, reason: 'already_syncing' }
  if (!isOnline()) return { ok: false, reason: 'offline' }

  const sources = await getAllSheetSources()
  if (sources.length === 0) return { ok: false, reason: 'not_configured' }

  syncInProgress = true
  try {
    const [warehouses, aliases, varieties, sackTypes] = await Promise.all([
      db.warehouses.toArray(),
      db.warehouseAliases.toArray(),
      db.varietyTypes.toArray(),
      db.sackTypes.toArray(),
    ])
    const warehouseByAlias = new Map(aliases.map((a) => [a.alias, a.warehouseId]))
    const varietyByCode = new Map(varieties.map((v) => [v.name, v.varietyId]))
    const sackTypeByCode = new Map(sackTypes.map((s) => [s.code, s.sackTypeId]))

    let aiCount = 0
    let siaCount = 0

    for (const source of sources) {
      const [aiRows, siaRows] = await Promise.all([
        fetchAuthorityRows(source, 'AI'),
        fetchAuthorityRows(source, 'SIA'),
      ])

      for (const row of aiRows) {
        // Skip reserved-but-unused authority numbers - only the number
        // itself is present, no actual allocation data yet.
        const aiNum = String(row['AI #'] ?? '').trim()
        if (!aiNum || !row['NAME OF CUSTOMER']) continue

        // Skip anything dated before this source's Date From - this is
        // the actual mechanism behind "ignore old experiments in the
        // sheet" (checking row['DATE'] first since the admin was asked
        // to rename the AI sheet's date column away from the year-
        // specific "DATE (2026)", but falling back to the old name in
        // case that rename hasn't happened yet).
        const aiDateRaw = row['DATE'] ?? row['DATE (2026)']
        const aiDate = aiDateRaw ? String(aiDateRaw).slice(0, 10) : null
        if (aiDate && aiDate < source.dateFrom) continue

        await upsertAuthority({
          type: 'AI',
          aiNumber: aiNum,
          siaNumber: null,
          sackTypeId: null,
          condition: null,
          date: aiDate,
          assignedWarehouse: warehouseByAlias.get(normalizeWarehouseAlias(row['ISSUING WHSE'])) ?? null,
          customerName: String(row['NAME OF CUSTOMER'] ?? '').trim(),
          varietyId: varietyByCode.get(String(row['VARIETY CODE'] ?? '').trim()) ?? null,
          transactionTypeName: String(row['TRANSACTION'] ?? '').trim(),
          totalAllocationBags: toNumberOrNull(row['BAG']),
          totalAllocationKilos: toNumberOrNull(row['NET KG']),
          remarks: row['REMARKS'] ?? null,
          orNumber: row['OR No.'] ?? null,
          ageGroup: row['Note3'] ?? null, // sheet column repurposed for age group, AI only
          note1: row['Note1'] ?? null,
          note2: row['Note2'] ?? null,
          sourceId: source.id,
        })
        aiCount += 1
      }

      // Parse each SIA row individually first (same validation/skip
      // rules as before), then group by SIA number below - one SIA can
      // span multiple rows (one per sack type + condition), and per the
      // user's explicit correction, these must become ONE authority
      // record with all of them together, not separate records.
      const parsedSiaRows = []
      for (const row of siaRows) {
        const siaNum = String(row['SIA'] ?? '').trim()
        if (!siaNum || !row['CUSTOMER']) continue

        // Same Date From filter as AI, above.
        const siaDateRaw = row['DATE']
        const siaDate = siaDateRaw ? String(siaDateRaw).slice(0, 10) : null
        if (siaDate && siaDate < source.dateFrom) continue

        // Multi-row convention: this row is exactly one sack type + one
        // condition + its own piece count. The condition sometimes
        // still arrives embedded in # OF BAGS itself (e.g. "487 bn")
        // rather than in the separate CONDITION column - safe to parse
        // directly here since each row now names exactly one sack type,
        // unlike the old multi-value compact format ("65 bn / 17 sh")
        // which remains genuinely ambiguous and is still skipped below.
        const sackCode = String(row['TYPE/CAPACITY'] ?? '').trim()
        const rawBags = row['# OF BAGS']
        const embeddedMatch = typeof rawBags === 'string' ? rawBags.trim().match(/^(\d+)\s*(bn|sh|us)$/i) : null

        let pieces = typeof rawBags === 'number' ? rawBags : null
        let condition = String(row['CONDITION'] ?? '').trim().toUpperCase() || null
        if (embeddedMatch) {
          pieces = Number(embeddedMatch[1])
          condition = embeddedMatch[2].toUpperCase()
        }

        // A row using the old compact/compound format (a slash in the
        // sack type, or a non-numeric piece count) doesn't match the
        // multi-row convention this parser expects - skip it rather
        // than guess at an ambiguous split, matching the earlier
        // decision to require manual review for that format instead of
        // parsing it automatically.
        if (sackCode.includes('/') || pieces == null) continue

        parsedSiaRows.push({
          siaNumber: siaNum,
          sackTypeId: sackTypeByCode.get(sackCode) ?? null,
          condition,
          pieces,
          date: siaDate,
          assignedWarehouse: warehouseByAlias.get(normalizeWarehouseAlias(row['ISSUED FROM'])) ?? null,
          customerName: String(row['CUSTOMER'] ?? '').trim(),
          transactionTypeName: String(row['TRANSACTION'] ?? '').trim(),
          remarks: row['REMARKS'] ?? null,
        })
      }

      // Group the parsed rows by SIA number - each group becomes one
      // authority record with a sackLines array. Shared metadata
      // (customer, warehouse, date, transaction type, remarks) comes
      // from the group's first row, since these describe the SIA as a
      // whole, not any one sack-type line within it.
      const siaGroups = new Map()
      for (const parsed of parsedSiaRows) {
        if (!siaGroups.has(parsed.siaNumber)) siaGroups.set(parsed.siaNumber, [])
        siaGroups.get(parsed.siaNumber).push(parsed)
      }

      for (const [siaNum, group] of siaGroups) {
        const first = group[0]
        await upsertSiaAuthority({
          siaNumber: siaNum,
          date: first.date,
          assignedWarehouse: first.assignedWarehouse,
          customerName: first.customerName,
          transactionTypeName: first.transactionTypeName,
          remarks: first.remarks,
          sackLines: group.map((g) => ({
            sackTypeId: g.sackTypeId,
            condition: g.condition,
            totalAllocationBags: g.pieces,
          })),
          sourceId: source.id,
        })
        siaCount += 1
      }

      await db.sheetSources.update(source.id, { lastSyncedAt: new Date().toISOString() })
    }

    return { ok: true, aiCount, siaCount }
  } catch (error) {
    return { ok: false, reason: 'request_failed', error: error.message }
  } finally {
    syncInProgress = false
  }
}

/**
 * Builds the backup row payload for a given transaction, in the exact
 * column shape its target sheet expects. See the per-type comments
 * inline - WSR/WSI share a shape (a "Batch No" vs "AI #" column), ESR/
 * ESI share a different, pieces-based shape.
 */
/**
 * Formats "now" as M/D/YYYY H:MM:SS in the LOCAL timezone - e.g.
 * "7/22/2026 23:29:28" - for the Timestamp column in backup rows.
 * Deliberately not new Date().toISOString() (always UTC, and a
 * machine-readable format, not the human-readable one requested) -
 * same reasoning as todayLocalISO() elsewhere in this codebase.
 */
const formatLocalTimestamp = () => {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const year = now.getFullYear()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`
}

// Strips a leading province/warehouse-code-style prefix (e.g. "ALB-",
// "CAM-") from a warehouse name before it's sent to Google Sheets - the
// app's own warehouse.name field has these baked in from an earlier
// naming convention, but the Sheet should only ever show the plain
// name (e.g. "ALB-ABACORP A" -> "ABACORP A").
export const stripWarehouseCodePrefix = (name) =>
  (name ?? '').replace(/^[A-Z]{2,5}-/, '')

const buildBackupRow = (transaction, context) => {
  const { warehouseCode, provinceCode, varietyName, transactionTypeName } = context
  const warehouseName = stripWarehouseCodePrefix(context.warehouseName)
  const ageInMonths = transaction.ageUnit === 'Months' ? transaction.ageValue : null

  if (transaction.type === 'WSR') {
    return {
      Timestamp: formatLocalTimestamp(),
      Date: transaction.date,
      Transaction: transactionTypeName ?? '',
      Variety: varietyName ?? '',
      Bags: transaction.numberOfBags ?? null,
      'Net Kilos': transaction.netKilos ?? null,
      'Warehouse Name': warehouseName ?? '',
      'Customer Name': transaction.status === 'Cancelled' ? 'CANCELLED' : transaction.customerName,
      Province: provinceCode ?? '',
      'Net Bags': transaction.numberOfBags != null ? transaction.netKilos / 50 : null,
      'WH Code': warehouseCode ?? null,
      'WSR #': transaction.serialNo,
      'WSI #': transaction.linkedDocNo ?? null,
      'Batch No': transaction.batchNo ?? null,
      AGE: ageInMonths,
    }
  }

  if (transaction.type === 'WSI') {
    return {
      Timestamp: formatLocalTimestamp(),
      Date: transaction.date,
      Transaction: transactionTypeName ?? '',
      Variety: varietyName ?? '',
      Bags: transaction.numberOfBags ?? null,
      'Net Kilos': transaction.netKilos ?? null,
      'Warehouse Name': warehouseName ?? '',
      'Customer Name': transaction.status === 'Cancelled' ? 'CANCELLED' : transaction.customerName,
      Province: provinceCode ?? '',
      'Net Bags': transaction.numberOfBags != null ? transaction.netKilos / 50 : null,
      'WH Code': warehouseCode ?? null,
      'AI #': transaction.aiNumber ?? null,
      'WSI #': transaction.serialNo,
      AGE: ageInMonths,
    }
  }

  // ESR / ESI — sacks: pieces-based, no kilos/bags concept.
  const totalPieces = transaction.sackLines?.reduce((sum, l) => sum + (l.pieces ?? 0), 0) ?? null

  return {
    Timestamp: formatLocalTimestamp(),
    Date: transaction.date,
    Transaction: transactionTypeName ?? '',
    'Warehouse Name': warehouseName ?? '',
    'Customer Name': transaction.status === 'Cancelled' ? 'CANCELLED' : transaction.customerName,
    Province: provinceCode ?? '',
    'WH Code': warehouseCode ?? null,
    Pieces: totalPieces,
    [transaction.type === 'ESR' ? 'ESI #' : 'SIA #']: transaction.linkedDocNo ?? null,
    [transaction.type === 'ESR' ? 'ESR#' : 'ESI#']: transaction.serialNo,
  }
}

/**
 * WTS (Warehouse Transfer Slip) is an in-warehouse transfer, not a
 * receipt or issuance from an outside party - but per explicit request,
 * it still needs to be recorded on both the receipts and issues Sheets
 * (using the WTS serial number as the identifying value in both, not a
 * separate WSR/WSI serial), since those are the two sheets the app
 * already syncs to and searches for historical lookups. Returns two
 * separate row objects - receivedRow shaped like a WSR row (goes to
 * the receipts sheet), issuedRow shaped like a WSI row (goes to the
 * issues sheet) - rather than one row like buildBackupRow, since WTS
 * genuinely needs both.
 */
const buildWtsBackupRows = (transaction, context) => {
  const { warehouseCode, provinceCode, transactionTypeName } = context
  const warehouseName = stripWarehouseCodePrefix(context.warehouseName)
  const isCancelled = transaction.status === 'Cancelled'

  const receivedRow = {
    Timestamp: formatLocalTimestamp(),
    Date: transaction.date,
    Transaction: transactionTypeName ?? '',
    Variety: context.receivedVarietyName ?? '',
    Bags: transaction.receivedBags ?? null,
    'Net Kilos': transaction.receivedNetKilos ?? null,
    'Warehouse Name': warehouseName ?? '',
    'Customer Name': isCancelled ? 'CANCELLED' : null,
    Province: provinceCode ?? '',
    'Net Bags': transaction.receivedBags != null ? transaction.receivedNetKilos / 50 : null,
    'WH Code': warehouseCode ?? null,
    'WSR #': transaction.serialNo,
    'WSI #': null,
    'Batch No': null,
    AGE: null,
  }

  const issuedRow = {
    Timestamp: formatLocalTimestamp(),
    Date: transaction.date,
    Transaction: transactionTypeName ?? '',
    Variety: context.issuedVarietyName ?? '',
    Bags: transaction.issuedBags ?? null,
    'Net Kilos': transaction.issuedNetKilos ?? null,
    'Warehouse Name': warehouseName ?? '',
    'Customer Name': isCancelled ? 'CANCELLED' : null,
    Province: provinceCode ?? '',
    'Net Bags': transaction.issuedBags != null ? transaction.issuedNetKilos / 50 : null,
    'WH Code': warehouseCode ?? null,
    'AI #': transaction.aiNumber ?? null,
    'WSI #': transaction.serialNo,
    AGE: null,
  }

  return { receivedRow, issuedRow }
}

const SHEET_NAME_KEY_BY_TYPE = {
  WSR: 'receiptsSheetName',
  WSI: 'issuesSheetName',
  ESR: 'sacksReceiptsSheetName',
  ESI: 'sacksIssuesSheetName',
}

// Each sheet's own serial number column, matching buildBackupRow's
// column names exactly - used as the match key for update/delete.
const SERIAL_COLUMN_BY_TYPE = {
  WSR: 'WSR #',
  WSI: 'WSI #',
  ESR: 'ESR#',
  ESI: 'ESI#',
}

/**
 * POSTs a JSON body to the Sheets Web App with a few retry attempts on
 * transient failure (network blips, Apps Script cold-start latency, or
 * any other momentary issue) before giving up. Apps Script Web Apps are
 * known for variable reliability under load - a short, immediate retry
 * resolves most of these without ever surfacing as a visible failure,
 * rather than making every transient hiccup wait for the next full
 * sync cycle (5 minutes, or the next save) to self-heal.
 */
const postToSheetsWithRetry = async (url, body, maxAttempts = 3) => {
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        // Content-Type is deliberately text/plain, NOT application/json -
        // Google Apps Script Web Apps don't handle CORS preflight (OPTIONS)
        // requests, and application/json triggers one from the browser
        // (it's not a CORS-safelisted content type; text/plain is). Apps
        // Script's doPost still reads e.postData.contents as the raw JSON
        // string regardless of the declared Content-Type, so this changes
        // nothing server-side. Do not change this back to application/json.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        lastError = { ok: false, reason: 'request_failed', httpStatus: response.status }
      } else {
        const payload = await response.json()
        if (payload.status === 'SUCCESS') return { ok: true }
        lastError = { ok: false, reason: 'bad_response', message: payload.message ?? null }
      }
    } catch (error) {
      lastError = { ok: false, reason: 'request_failed', error: error.message }
    }

    if (attempt < maxAttempts) {
      // Short, increasing delay between attempts (300ms, 600ms) - long
      // enough to ride out a momentary blip, short enough not to make
      // the user wait noticeably if it does eventually succeed.
      await new Promise((resolve) => setTimeout(resolve, attempt * 300))
    }
  }

  return lastError
}

/**
 * Appends one backup row to the appropriate sheet for a saved
 * transaction, using whichever configured source's date range covers
 * today. Checked against WRITE_ALLOWLIST_KEYS before every write - this
 * is the structural guarantee that this app can never write to AI/SIA
 * or any sheet outside the four backup logs, not just a convention.
 */
export const pushTransactionBackup = async (transaction, context = {}) => {
  if (transaction.type === 'WTS') {
    const source = await getActiveSheetSource()
    if (!source) return { ok: false, reason: 'no_active_source' }
    if (!isOnline()) return { ok: false, reason: 'offline' }

    const { receivedRow, issuedRow } = buildWtsBackupRows(transaction, context)
    const [receivedResult, issuedResult] = await Promise.all([
      postToSheetsWithRetry(source.webAppUrl, {
        action: 'appendTransaction', sheet: source.receiptsSheetName,
        serialColumn: 'WSR #', row: receivedRow,
      }),
      postToSheetsWithRetry(source.webAppUrl, {
        action: 'appendTransaction', sheet: source.issuesSheetName,
        serialColumn: 'WSI #', row: issuedRow,
      }),
    ])
    return (receivedResult.ok && issuedResult.ok)
      ? { ok: true }
      : { ok: false, reason: 'wts_partial_failure', receivedResult, issuedResult }
  }

  const sheetNameKey = SHEET_NAME_KEY_BY_TYPE[transaction.type]
  if (!sheetNameKey) return { ok: false, reason: 'unsupported_type' }
  if (!WRITE_ALLOWLIST_KEYS.includes(sheetNameKey)) return { ok: false, reason: 'not_allowlisted' }

  const source = await getActiveSheetSource()
  if (!source) return { ok: false, reason: 'no_active_source' }
  if (!isOnline()) return { ok: false, reason: 'offline' }

  const sheetName = source[sheetNameKey]
  const row = buildBackupRow(transaction, context)

  return postToSheetsWithRetry(source.webAppUrl, {
    action: 'appendTransaction',
    sheet: sheetName,
    serialColumn: SERIAL_COLUMN_BY_TYPE[transaction.type],
    row,
  })
}

/**
 * Updates an existing backup row in place, found by the transaction's
 * own serialNo (the 'Serial No' column every backup row now carries
 * consistently). Used when an already-saved WSR/WSI/ESR/ESI is edited,
 * so the Sheet stays in sync with what the app actually has rather than
 * accumulating a stale duplicate of the original values. WTS updates
 * both its receipts-side and issues-side rows together.
 */
export const updateTransactionBackup = async (transaction, context = {}) => {
  if (transaction.type === 'WTS') {
    const source = await getActiveSheetSource()
    if (!source) return { ok: false, reason: 'no_active_source' }
    if (!isOnline()) return { ok: false, reason: 'offline' }

    const { receivedRow, issuedRow } = buildWtsBackupRows(transaction, context)
    const [receivedResult, issuedResult] = await Promise.all([
      postToSheetsWithRetry(source.webAppUrl, {
        action: 'updateTransaction', sheet: source.receiptsSheetName,
        matchColumn: 'WSR #', matchValue: transaction.serialNo, row: receivedRow,
      }),
      postToSheetsWithRetry(source.webAppUrl, {
        action: 'updateTransaction', sheet: source.issuesSheetName,
        matchColumn: 'WSI #', matchValue: transaction.serialNo, row: issuedRow,
      }),
    ])
    return (receivedResult.ok && issuedResult.ok)
      ? { ok: true }
      : { ok: false, reason: 'wts_partial_failure', receivedResult, issuedResult }
  }

  const sheetNameKey = SHEET_NAME_KEY_BY_TYPE[transaction.type]
  if (!sheetNameKey) return { ok: false, reason: 'unsupported_type' }
  if (!WRITE_ALLOWLIST_KEYS.includes(sheetNameKey)) return { ok: false, reason: 'not_allowlisted' }

  const source = await getActiveSheetSource()
  if (!source) return { ok: false, reason: 'no_active_source' }
  if (!isOnline()) return { ok: false, reason: 'offline' }

  const sheetName = source[sheetNameKey]
  const row = buildBackupRow(transaction, context)

  return postToSheetsWithRetry(source.webAppUrl, {
    action: 'updateTransaction',
    sheet: sheetName,
    matchColumn: SERIAL_COLUMN_BY_TYPE[transaction.type],
    matchValue: transaction.serialNo,
    // NOTE: warehouseCode is sent here but api.gs currently does NOT
    // enforce it as a match requirement - an earlier attempt to require
    // it caused a serious regression (a mismatch for any reason made
    // findRowIndexByMatch report "not found" even when the row genuinely
    // existed, triggering the append-fallback and creating duplicate
    // rows) and was reverted server-side. This field is harmless to
    // keep sending (unused by the server for now), but do not assume
    // it's actually being checked - serial-number-only matching is
    // what's currently active. If cross-warehouse serial collisions
    // ever need addressing, do it via a verified, carefully-tested
    // approach, not by re-adding a hard requirement here without being
    // able to confirm it against real data first.
    warehouseCode: context.warehouseCode ?? null,
    row,
  })
}

/**
 * Deletes an existing backup row, found by serialNo + transaction type
 * (used both for a real-time delete attempt and for replaying a queued
 * offline deletion, where only these survive - the local transaction
 * record itself is already gone by the time this runs). warehouseCode
 * is passed along but NOT currently enforced server-side - an earlier
 * attempt to require it as a match condition caused a real regression
 * (false "not found" results triggering duplicate-row creation on
 * update) and was reverted. See updateTransactionBackup's comment for
 * the full explanation - do not re-add a hard warehouseCode
 * requirement without being able to verify it against real data first.
 * WTS deletes both its receipts-side and issues-side rows together.
 */
export const deleteTransactionBackup = async (serialNo, type, warehouseCode) => {
  if (type === 'WTS') {
    const source = await getActiveSheetSource()
    if (!source) return { ok: false, reason: 'no_active_source' }
    if (!isOnline()) return { ok: false, reason: 'offline' }

    const [receivedResult, issuedResult] = await Promise.all([
      postToSheetsWithRetry(source.webAppUrl, {
        action: 'deleteTransaction', sheet: source.receiptsSheetName,
        matchColumn: 'WSR #', matchValue: serialNo, warehouseCode: warehouseCode ?? null,
      }),
      postToSheetsWithRetry(source.webAppUrl, {
        action: 'deleteTransaction', sheet: source.issuesSheetName,
        matchColumn: 'WSI #', matchValue: serialNo, warehouseCode: warehouseCode ?? null,
      }),
    ])
    return (receivedResult.ok && issuedResult.ok)
      ? { ok: true }
      : { ok: false, reason: 'wts_partial_failure', receivedResult, issuedResult }
  }

  const sheetNameKey = SHEET_NAME_KEY_BY_TYPE[type]
  if (!sheetNameKey) return { ok: false, reason: 'unsupported_type' }
  if (!WRITE_ALLOWLIST_KEYS.includes(sheetNameKey)) return { ok: false, reason: 'not_allowlisted' }

  const source = await getActiveSheetSource()
  if (!source) return { ok: false, reason: 'no_active_source' }
  if (!isOnline()) return { ok: false, reason: 'offline' }

  const sheetName = source[sheetNameKey]

  return postToSheetsWithRetry(source.webAppUrl, {
    action: 'deleteTransaction',
    sheet: sheetName,
    matchColumn: SERIAL_COLUMN_BY_TYPE[type],
    matchValue: serialNo,
    warehouseCode: warehouseCode ?? null,
  })
}

/**
 * Converts a raw Sheet row (keyed by the Sheet's own human-readable
 * column headers) into a usable local transaction object. Recovers
 * everything the Sheet actually stores; genuinely cannot recover Pile
 * or MTS Sack Type/Condition, since the Sheet has no column for either
 * - those come back null, and needsCompletion is set to true so the
 * UI can clearly tell the user this record needs those fields filled
 * in before it can be saved further, rather than silently presenting
 * an incomplete record as if it were whole.
 *
 * varietyByName: a Map of variety name (lowercased, trimmed) -> varietyId,
 * built by the caller from its own already-loaded variety list - kept
 * as a plain parameter rather than a fresh query here, since the form
 * calling this already has that data in memory.
 */
export const mapSheetRowToTransaction = (type, row, { warehouseId, varietyByName }) => {
  const rawDate = row['Date']
  // Sheet dates come back as full ISO timestamps (e.g.
  // "2026-06-15T00:00:00.000Z") - take just the date part, in the
  // Sheet's local time, not UTC-shifted (which could land on the
  // wrong day depending on timezone).
  const date = typeof rawDate === 'string' && rawDate.includes('T')
    ? rawDate.slice(0, 10)
    : (rawDate ?? '')

  const isCancelled = String(row['Customer Name'] ?? '').trim().toUpperCase() === 'CANCELLED'
  const varietyName = row['Variety'] ?? null
  const matchedVarietyId = varietyName
    ? varietyByName?.get(String(varietyName).trim().toLowerCase()) ?? null
    : null

  const base = {
    id: crypto.randomUUID(),
    type,
    warehouseId,
    date,
    status: isCancelled ? 'Cancelled' : 'Active',
    customerName: isCancelled ? null : (row['Customer Name'] ?? null),
    isSynced: true, // it already exists in the Sheet - no need to push it back
    fromSheetImport: true,
    needsCompletion: !isCancelled, // Cancelled records have nothing left to complete
  }

  if (type === 'WSR' || type === 'WSI') {
    return {
      ...base,
      serialNo: row[type === 'WSR' ? 'WSR #' : 'WSI #'],
      linkedDocNo: type === 'WSR' ? (row['WSI #'] ?? null) : (row['AI #'] ?? null),
      aiNumber: type === 'WSI' ? (row['AI #'] ?? null) : null,
      varietyId: matchedVarietyId,
      varietyNameRaw: matchedVarietyId ? null : varietyName, // preserved for display only if we couldn't match it
      numberOfBags: row['Bags'] ?? null,
      netKilos: row['Net Kilos'] ?? null,
      grossKilos: null, // not stored in the Sheet - MTS/gross split is unrecoverable
      autoComputeNet: false,
      pileId: null,
      mtsSackTypeId: null,
      mtsCondition: null,
      moistureContent: null,
      condition: null,
      ageValue: row['AGE'] ?? null,
      ageUnit: row['AGE'] != null ? 'Months' : 'Days',
      initialAgeValue: row['AGE'] ?? null,
    }
  }

  // ESR / ESI - sacks
  return {
    ...base,
    serialNo: row[type === 'ESR' ? 'ESR#' : 'ESI#'],
    linkedDocNo: row[type === 'ESR' ? 'ESI #' : 'SIA #'] ?? null,
    sackLines: [], // per-sack-type/condition breakdown isn't stored in the Sheet, only the Pieces total
    totalPiecesRaw: row['Pieces'] ?? null,
  }
}

/**
 * Looks up a single transaction by serial number directly from the
 * Sheet - used when a serial isn't found in the local database, since
 * that alone doesn't mean it never existed: it may have been recorded
 * before this app was ever used, or entered by some other means. This
 * is what lets the app recognize and correctly display/edit historical
 * data the app itself never created.
 *
 * Searches EVERY configured sheet source, not just today's active one
 * (getActiveSheetSource), since a historical record could sit in any
 * past source's date range - we don't know its date until we find it.
 * Matches on serial AND warehouse name together (via the new
 * fetchTransactionBySerial Apps Script action) - a single spreadsheet
 * can hold multiple warehouses' rows, so serial alone isn't a safe
 * enough match on its own.
 */
export const fetchTransactionBySerial = async (type, warehouseName, serialNo) => {
  const sheetNameKey = SHEET_NAME_KEY_BY_TYPE[type]
  if (!sheetNameKey) return { ok: false, reason: 'unsupported_type' }
  if (!isOnline()) return { ok: false, reason: 'offline' }

  const sources = await getAllSheetSources()
  for (const source of sources) {
    const sheetName = source[sheetNameKey]
    if (!sheetName) continue

    const url = new URL(source.webAppUrl)
    url.searchParams.set('action', 'fetchTransactionBySerial')
    url.searchParams.set('sheet', sheetName)
    url.searchParams.set('matchColumn', SERIAL_COLUMN_BY_TYPE[type])
    url.searchParams.set('matchValue', serialNo)
    url.searchParams.set('warehouseColumn', 'Warehouse Name')
    url.searchParams.set('warehouseValue', warehouseName ?? '')

    try {
      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`fetchTransactionBySerial: HTTP ${response.status} for ${type} #${serialNo} on sheet "${sheetName}"`)
        continue
      }
      const payload = await response.json()
      if (payload.status === 'SUCCESS' && payload.row) {
        return { ok: true, row: payload.row, sourceId: source.id }
      }
      if (payload.status !== 'SUCCESS') {
        console.error(`fetchTransactionBySerial: non-SUCCESS response for ${type} #${serialNo} on sheet "${sheetName}":`, payload)
      }
    } catch (err) {
      console.error(`fetchTransactionBySerial: request failed for ${type} #${serialNo} on sheet "${sheetName}":`, err)
      // This source failed (network blip, bad URL, etc.) - try the next one.
      continue
    }
  }
  return { ok: true, row: null }
}

/**
 * Finds the lowest and highest serial number the Sheet actually has on
 * record for this (type, warehouse) - used for the "floor" check, so
 * regular users can't navigate below real, existing history. Searches
 * every configured source and combines the results, since the true
 * floor could be established by the oldest source while the true
 * ceiling comes from the newest.
 */
export const fetchSerialFloorFromSheet = async (type, warehouseName) => {
  const sheetNameKey = SHEET_NAME_KEY_BY_TYPE[type]
  if (!sheetNameKey) return { ok: false, reason: 'unsupported_type' }
  if (!isOnline()) return { ok: false, reason: 'offline' }

  const sources = await getAllSheetSources()
  let min = null, max = null

  for (const source of sources) {
    const sheetName = source[sheetNameKey]
    if (!sheetName) continue

    const url = new URL(source.webAppUrl)
    url.searchParams.set('action', 'fetchSerialFloor')
    url.searchParams.set('sheet', sheetName)
    url.searchParams.set('matchColumn', SERIAL_COLUMN_BY_TYPE[type])
    url.searchParams.set('warehouseColumn', 'Warehouse Name')
    url.searchParams.set('warehouseValue', warehouseName ?? '')

    try {
      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`fetchSerialFloorFromSheet: HTTP ${response.status} for ${type} on sheet "${sheetName}"`)
        continue
      }
      const payload = await response.json()
      if (payload.status === 'SUCCESS') {
        if (payload.min != null && (min === null || payload.min < min)) min = payload.min
        if (payload.max != null && (max === null || payload.max > max)) max = payload.max
      } else {
        console.error(`fetchSerialFloorFromSheet: non-SUCCESS response for ${type} on sheet "${sheetName}":`, payload)
      }
    } catch (err) {
      console.error(`fetchSerialFloorFromSheet: request failed for ${type} on sheet "${sheetName}":`, err)
      continue
    }
  }
  return { ok: true, min, max }
}

/**
 * Bulk-fetches every row for a (type, list of warehouse names) across
 * every configured sheet source, optionally only rows modified since a
 * given timestamp. This is the core of preloading - pulling a user's
 * assigned warehouse(s) worth of history in one pass at login, rather
 * than looking up one serial at a time during navigation. Returns
 * results per source so the caller can track per-source Last Modified
 * watermarks independently.
 */
export const fetchTransactionsBulk = async (type, warehouseNames, { modifiedSince } = {}) => {
  const sheetNameKey = SHEET_NAME_KEY_BY_TYPE[type]
  if (!sheetNameKey) return { ok: false, reason: 'unsupported_type' }
  if (!isOnline()) return { ok: false, reason: 'offline' }
  if (!warehouseNames || warehouseNames.length === 0) return { ok: true, bySource: [] }

  const sources = await getAllSheetSources()

  const fetchOneSource = async (source) => {
    const sheetName = source[sheetNameKey]
    if (!sheetName) return null

    const url = new URL(source.webAppUrl)
    url.searchParams.set('action', 'fetchTransactionsBulk')
    url.searchParams.set('sheet', sheetName)
    url.searchParams.set('warehouseColumn', 'Warehouse Name')
    url.searchParams.set('warehouseValues', warehouseNames.join(','))
    if (modifiedSince) url.searchParams.set('modifiedSince', modifiedSince)

    try {
      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`fetchTransactionsBulk: HTTP ${response.status} for ${type} on sheet "${sheetName}"`)
        return { sourceId: source.id, ok: false, rows: [] }
      }
      const payload = await response.json()
      if (payload.status === 'SUCCESS') {
        return { sourceId: source.id, ok: true, rows: payload.rows ?? [] }
      }
      console.error(`fetchTransactionsBulk: non-SUCCESS response for ${type} on sheet "${sheetName}":`, payload)
      return { sourceId: source.id, ok: false, rows: [] }
    } catch (err) {
      console.error(`fetchTransactionsBulk: request failed for ${type} on sheet "${sheetName}":`, err)
      return { sourceId: source.id, ok: false, rows: [] }
    }
  }

  const results = await Promise.all(sources.map(fetchOneSource))
  const bySource = results.filter(Boolean)

  return { ok: true, bySource }
}
