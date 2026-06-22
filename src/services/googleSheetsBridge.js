// Google Sheets bridge — Phase 6.
//
// This app does NOT own or deploy the Google Apps Script (GAS) behind the
// configured Web App URL — that's an existing script the user already has
// running on their spreadsheet, with its own functions for other purposes.
// This module only describes the contract this app NEEDS from it, so the
// user (or whoever maintains that script) can add matching endpoints
// without touching or replacing anything already there.
//
// One Web App URL (admin-configurable in the Admin Dashboard's "Google
// Sheets" tab, can be changed at any time) fronts a spreadsheet with
// multiple named sheets:
//   - an AI sheet    (Authority to Issue allocations — stock docs)
//   - a SIA sheet    (Sack Issuance Authority allocations — sack docs)
//   - a receipts backup sheet (WSR — matches the user's EXISTING sheet
//     schema, see below)
//   - an issues backup sheet (WSI — new, mirrors the receipts schema)
//   - a sacks-receipts backup sheet (ESR — new)
//   - a sacks-issues backup sheet (ESI — new)
//
// The exact sheet *names* are also admin-configurable, since the existing
// spreadsheet may already use its own naming convention.
//
// ─── Receipts (WSR) backup row shape — matches the user's EXISTING sheet ──
//
// The user already has a "DATA_ENTRY"-style receipts sheet with these
// columns (sample row, reformatted for clarity):
//   Timestamp, Date, Transaction, Variety, Bags, Net Kilos, Warehouse Name,
//   Customer Name, Province, Net Bags, WH Code, WSR #, Batch No, Col_15
// Col_15 is the age column: BLANK when age was entered in Days, and only
// populated (with a plain number, e.g. 8) when age was entered in Months.
// `Net Bags` = Net Kilos / 50 (matches calculateNetBags in calculations.js).
// `Timestamp` is when the row was actually written (server time); `Date`
// is the date typed into the form. This app's pushTransactionBackup()
// reproduces this exact column order/shape for WSR so it can append
// directly into that existing sheet without any restructuring on the
// user's end.
//
// ─── New sheets (Issues + Sacks) — same shape, new sheets ────────────────
//
// WSI backup rows use the SAME column shape as WSR above, but an "AI #"
// column replaces "WSR #" / "Batch No" is replaced with the AI Number
// reference, and the sheet itself is new (the user has no Issues sheet
// yet). ESR/ESI (sacks) use a related but pieces-based shape — see the
// `buildBackupRow` function below for the exact per-type column lists.
//
// AI Number and SIA Number are NOT the same field — an AI allocation has
// its own reference number (`aiNumber`), and a SIA allocation has a
// separate, independent reference number (`siaNumber`). Both are returned
// to this app under their own field name; nothing is shared or reused
// between the two record types.
//
// ─── Contract this app expects from the existing GAS Web App ──────────
//
// GET  {webAppUrl}?action=fetchAuthorities&sheet={sheetName}&type=AI
//   -> { status: "SUCCESS", rows: [ { aiNumber, assignedWarehouseCode,
//        customerName, varietyName, totalAllocationBags,
//        totalAllocationKilos }, ... ] }
//
// GET  {webAppUrl}?action=fetchAuthorities&sheet={sheetName}&type=SIA
//   -> { status: "SUCCESS", rows: [ { siaNumber, assignedWarehouseCode,
//        customerName, sackCode, condition, totalAllocationBags,
//        totalAllocationKilos }, ... ] }
//
// POST {webAppUrl}  body: { action: "appendTransaction", sheet: sheetName,
//        row: { ...see buildBackupRow() per document type... } }
//   -> { status: "SUCCESS" }
//
// If the existing script uses different action names, parameter names, or
// response shapes, adjust the request-building/response-parsing in this
// file to match — don't change the script to match this file.
//
// All functions degrade gracefully (return a typed failure, never throw)
// since network access is never guaranteed in this offline-first app —
// callers are expected to check `.ok` before using `.data`.

import { db } from '../db/dexie.js'

/** Reads the current bridge configuration, or null if never configured. */
export const getSheetsConfig = async () => {
  const config = await db.googleSheetsConfig.get('global')
  return config ?? null
}

/** Saves/updates the bridge configuration (admin UI calls this on Save). */
export const saveSheetsConfig = async (partial) => {
  const existing = await getSheetsConfig()
  await db.googleSheetsConfig.put({
    id: 'global',
    webAppUrl: '',
    aiSheetName: 'AI',
    siaSheetName: 'SIA',
    receiptsSheetName: 'DATA_ENTRY',
    issuesSheetName: 'Issues Backup',
    sacksReceiptsSheetName: 'Sacks Receipts Backup',
    sacksIssuesSheetName: 'Sacks Issues Backup',
    lastSyncedAt: null,
    ...existing,
    ...partial,
  })
}

const isConfigured = (config) => Boolean(config?.webAppUrl?.trim())

/**
 * Fetches AI or SIA allocation rows from the configured Sheet and returns
 * them mapped to the shape `db.authorities` expects. Does NOT write to
 * Dexie itself — see `syncAuthoritiesFromSheets` for the full pull+merge.
 */
const fetchAuthorityRows = async (config, type) => {
  const sheetName = type === 'AI' ? config.aiSheetName : config.siaSheetName

  const url = new URL(config.webAppUrl)
  url.searchParams.set('action', 'fetchAuthorities')
  url.searchParams.set('sheet', sheetName)
  url.searchParams.set('type', type)

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
 * Pulls AI and SIA rows from the configured Sheet and upserts them into
 * `db.authorities` — AI rows matched/keyed by `aiNumber`, SIA rows matched/
 * keyed by `siaNumber` (these are distinct reference numbers, never
 * shared). Existing `totalIssuedBags`/`totalIssuedKilos` are preserved
 * across re-syncs (only the allocation side is ever overwritten from the
 * Sheet — issuance is tracked locally as forms are saved).
 *
 * Returns { ok: true, aiCount, siaCount } on success, or
 * { ok: false, reason } on any failure (not configured, offline, bad
 * response, etc.) — never throws, since this may run unattended on a
 * background timer.
 */
export const syncAuthoritiesFromSheets = async () => {
  const config = await getSheetsConfig()

  if (!isConfigured(config)) {
    return { ok: false, reason: 'not_configured' }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline' }
  }

  try {
    const [warehouses, varieties] = await Promise.all([
      db.warehouses.toArray(),
      db.varietyTypes.toArray(),
    ])
    const warehouseByCode = new Map(warehouses.map((w) => [w.code, w.warehouseId]))
    const varietyByName = new Map(varieties.map((v) => [v.name, v.varietyId]))

    const [aiRows, siaRows] = await Promise.all([
      fetchAuthorityRows(config, 'AI'),
      fetchAuthorityRows(config, 'SIA'),
    ])

    let aiCount = 0
    let siaCount = 0

    for (const row of aiRows) {
      // Skip placeholder rows that only have the AI number but no actual
      // allocation data yet (e.g. pre-printed serials not yet issued).
      const aiNum = String(row['AI #'] ?? '').trim()
      if (!aiNum || !row['NAME OF CUSTOMER']) continue

      await upsertAuthority({
        type: 'AI',
        aiNumber: aiNum,
        siaNumber: null,
        assignedWarehouse: warehouseByCode.get(String(row['ISSUING WHSE'] ?? '').trim()) ?? null,
        customerName: String(row['NAME OF CUSTOMER'] ?? '').trim(),
        varietyId: varietyByName.get(String(row['VARIETY CODE'] ?? '').trim()) ?? null,
        transactionTypeName: String(row['TRANSACTION'] ?? '').trim(),
        totalAllocationBags: row['BAG'] ?? null,
        totalAllocationKilos: row['NET KG'] ?? null,
        remarks: row['REMARKS'] ?? null,
        note1: row['Note1'] ?? null,
        note2: row['Note2'] ?? null,
        note3: row['Note3'] ?? null,
      })
      aiCount += 1
    }

    for (const row of siaRows) {
      // Skip placeholder rows that only have the SIA number but no data.
      const siaNum = String(row['SIA'] ?? '').trim()
      if (!siaNum || !row['CUSTOMER']) continue

      // Parse "# OF BAGS" — the raw value from the sheet may be a plain
      // number (e.g. 2500) or a mixed string (e.g. "65 bn / 17 sh").
      // Parsing the mixed-sack-type format is deferred to a later phase;
      // for now we store the raw value and total if it's a plain number.
      const rawPieces = row['# OF BAGS']
      const totalPieces = typeof rawPieces === 'number'
        ? rawPieces
        : null // complex multi-sack string — stored as rawSiaAllocation

      await upsertAuthority({
        type: 'SIA',
        aiNumber: null,
        siaNumber: siaNum,
        assignedWarehouse: warehouseByCode.get(String(row['ISSUED FROM'] ?? '').trim()) ?? null,
        customerName: String(row['CUSTOMER'] ?? '').trim(),
        sackTypeRaw: String(row['TYPE/CAPACITY'] ?? '').trim(),
        transactionTypeName: String(row['TRANSACTION'] ?? '').trim(),
        totalAllocationBags: totalPieces,
        rawSiaAllocation: typeof rawPieces === 'string' ? rawPieces : null,
        totalAllocationKilos: null,
        remarks: row['REMARKS'] ?? null,
      })
      siaCount += 1
    }

    await saveSheetsConfig({ lastSyncedAt: new Date().toISOString() })

    return { ok: true, aiCount, siaCount }
  } catch (error) {
    return { ok: false, reason: 'request_failed', error: error.message }
  }
}

/** Upserts a single authority row, matched by its own type's reference
 * number (aiNumber for AI, siaNumber for SIA — never the other one), and
 * preserves any existing totalIssued* values rather than resetting them
 * to 0. New fields from the real sheet (remarks, notes, rawSiaAllocation,
 * transactionTypeName) are merged in on each sync. */
const upsertAuthority = async (incoming) => {
  const refField = incoming.type === 'AI' ? 'aiNumber' : 'siaNumber'
  const refValue = incoming[refField]

  const existing = await db.authorities
    .where(refField)
    .equals(refValue)
    .and((a) => a.type === incoming.type)
    .first()

  if (existing) {
    await db.authorities.update(existing.authId, {
      ...incoming,
      totalIssuedBags: existing.totalIssuedBags ?? 0,
      totalIssuedKilos: existing.totalIssuedKilos ?? 0,
    })
  } else {
    await db.authorities.add({
      authId: crypto.randomUUID(),
      ...incoming,
      totalIssuedBags: 0,
      totalIssuedKilos: 0,
      status: 'Pending',
    })
  }
}

const SHEET_NAME_BY_TYPE = {
  WSR: 'receiptsSheetName',
  WSI: 'issuesSheetName',
  ESR: 'sacksReceiptsSheetName',
  ESI: 'sacksIssuesSheetName',
}

/**
 * Builds the backup row payload for a given transaction, in the exact
 * column shape its target sheet expects.
 *
 * WSR matches the user's EXISTING receipts sheet column-for-column:
 *   Timestamp, Date, Transaction, Variety, Bags, Net Kilos, Warehouse Name,
 *   Customer Name, Province, Net Bags, WH Code, WSR #, Batch No, Col_15
 * `Col_15` (age) is left blank when ageUnit is 'Days' and only populated
 * with a plain number when ageUnit is 'Months' — matching the real sheet's
 * existing behavior exactly (8 in that column means "8 months old"; a
 * days-based age is not recorded in this column at all).
 *
 * WSI reuses the same shape, with "WSR #" replaced by "AI #" (no "Batch
 * No" equivalent — Batch No was specific to milling receipts).
 *
 * ESR/ESI (sacks) use a pieces-based shape since there's no kilos/bags
 * concept for sack documents — Pieces replaces Bags/Net Kilos/Net Bags,
 * and "WSR #"/"AI #" are replaced by "ESI #"/"SIA #" respectively.
 */
const buildBackupRow = (transaction, context) => {
  const { warehouseCode, warehouseName, provinceCode, varietyName, transactionTypeName } = context
  const ageInMonths = transaction.ageUnit === 'Months' ? transaction.ageValue : null

  if (transaction.type === 'WSR') {
    return {
      Timestamp: new Date().toISOString(),
      Date: transaction.date,
      Transaction: transactionTypeName ?? '',
      Variety: varietyName ?? '',
      Bags: transaction.numberOfBags ?? null,
      'Net Kilos': transaction.netKilos ?? null,
      'Warehouse Name': warehouseName ?? '',
      'Customer Name': transaction.customerName,
      Province: provinceCode ?? '',
      'Net Bags': transaction.numberOfBags != null ? transaction.netKilos / 50 : null,
      'WH Code': warehouseCode ?? null,
      'WSR #': transaction.serialNo,
      'Batch No': transaction.batchNo ?? null,
      Col_15: ageInMonths,
    }
  }

  if (transaction.type === 'WSI') {
    return {
      Timestamp: new Date().toISOString(),
      Date: transaction.date,
      Transaction: transactionTypeName ?? '',
      Variety: varietyName ?? '',
      Bags: transaction.numberOfBags ?? null,
      'Net Kilos': transaction.netKilos ?? null,
      'Warehouse Name': warehouseName ?? '',
      'Customer Name': transaction.customerName,
      Province: provinceCode ?? '',
      'Net Bags': transaction.numberOfBags != null ? transaction.netKilos / 50 : null,
      'WH Code': warehouseCode ?? null,
      'AI #': transaction.aiNumber ?? null,
      Col_15: ageInMonths,
    }
  }

  // ESR / ESI — sacks: pieces-based, no kilos/bags concept.
  const totalPieces = transaction.sackLines?.reduce((sum, l) => sum + (l.pieces ?? 0), 0) ?? null

  return {
    Timestamp: new Date().toISOString(),
    Date: transaction.date,
    Transaction: transactionTypeName ?? '',
    'Warehouse Name': warehouseName ?? '',
    'Customer Name': transaction.customerName,
    Province: provinceCode ?? '',
    'WH Code': warehouseCode ?? null,
    Pieces: totalPieces,
    [transaction.type === 'ESR' ? 'ESI #' : 'SIA #']: transaction.linkedDocNo ?? null,
  }
}

/**
 * Appends one backup row to the appropriate sheet for a saved transaction
 * (a separate sheet per document type — see SHEET_NAME_BY_TYPE). Called
 * from the sync worker once a transaction has synced to Firestore
 * (Step 6.4) — this is a secondary, best-effort backup, not the primary
 * store, so failures here are logged but never block anything else in
 * the app.
 */
export const pushTransactionBackup = async (transaction, context = {}) => {
  const config = await getSheetsConfig()
  if (!isConfigured(config)) return { ok: false, reason: 'not_configured' }

  const sheetNameKey = SHEET_NAME_BY_TYPE[transaction.type]
  if (!sheetNameKey) return { ok: false, reason: 'unsupported_type' }

  const sheetName = config[sheetNameKey]
  const row = buildBackupRow(transaction, context)

  try {
    const response = await fetch(config.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'appendTransaction',
        sheet: sheetName,
        row,
      }),
    })

    if (!response.ok) {
      return { ok: false, reason: 'request_failed' }
    }

    const payload = await response.json()
    return payload.status === 'SUCCESS' ? { ok: true } : { ok: false, reason: 'bad_response' }
  } catch (error) {
    return { ok: false, reason: 'request_failed', error: error.message }
  }
}
