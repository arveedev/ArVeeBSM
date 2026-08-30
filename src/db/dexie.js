// Local Dexie (IndexedDB) workspace — see PRDD Section 3.2 for field
// definitions. Implements Step 2.1.

import Dexie from 'dexie'
import dexieCloud from 'dexie-cloud-addon'
import { hashPin } from '../utils/pinHash.js'

export const db = new Dexie('BSMDatabase', { addons: [dexieCloud] })

// Exposed for read-only diagnostics from the browser console (F12 ->
// Console) - lets a user or developer run a direct query against their
// own local data to help pin down a reported discrepancy, without
// needing a purpose-built admin screen for every one-off question.
// Doesn't add any new access - a browser's own DevTools Application tab
// can already inspect this same IndexedDB database directly regardless.
if (typeof window !== 'undefined') {
  window.__DEBUG_DB__ = db
}

db.version(1).stores({
  users: 'uid, accessCode, role, assignedWarehouse',
  piles: 'pileId, warehouseId, pileName, cerealType',
  transactions: 'id, type, serialNo, status, date, pileId, isSynced',
  authorities: 'authId, type, referenceNumber, assignedWarehouse, status',
})

// v2 — Admin configuration model (provinces, warehouses, varieties, sack
// types) and renames authorities.referenceNumber -> aiNumber, since AI/SIA
// records are identified by "AI Number" in the centralized Google Sheet
// they're synced from (Phase 6), not entered manually.
//
// `users.assignedWarehouse` and `piles.warehouseId` now reference
// `warehouses.warehouseId` (a generated UUID) rather than a free-text code.
db.version(2).stores({
  users: 'uid, accessCode, role, assignedWarehouse',
  piles: 'pileId, warehouseId, pileName, cerealType',
  transactions: 'id, type, serialNo, status, date, pileId, isSynced',
  authorities: 'authId, type, aiNumber, assignedWarehouse, status',

  // code: human-readable province code, e.g. "ALB"
  provinces: 'provinceId, code, name',

  // code: facility code, e.g. "050501"; name e.g. "ALB-TABACO GID"
  warehouses: 'warehouseId, code, name, provinceId',

  // category: 'Rice' | 'Palay'
  varietyTypes: 'varietyId, category, name',

  // category: 'Rice' | 'Palay'; weights: [{ condition, weight }, ...]
  // (non-indexed array field, configured per sack type)
  sackTypes: 'sackTypeId, category, code',
})

// v3 — Multi-warehouse user assignment, Title Case roles, fixed-condition
// sack weights, and per-warehouse report signatories.
//
// - `users.assignedWarehouse` (single warehouseId) -> `assignedWarehouses`
//   (array of warehouseId, multi-entry indexed). Admin role implies access
//   to ALL warehouses regardless of this list (enforced in app logic).
// - `role` values are now Title Case: 'Admin' | 'Warehouse Supervisor' |
//   'Warehouse Assistant'.
// - `sackTypes.weights` is now a fixed-shape object `{ BN, SH, US }` (Brand
//   New / Second Hand / Unserviceable) rather than a free-form array —
//   every sack code has exactly these three conditions.
// - New `signatories` table, one record per warehouse, for the report
//   sign-off block (Certified Correct / Verified Correct / Audited By /
//   Noted By, plus an optional Prepared By line).
// v4 — Revised signatory model. Only "Certified Correct" varies per
// warehouse (its name is derived from the assigned Warehouse Supervisor;
// only its `position` is admin-configurable). Verified Correct (supports
// multiple signatories), Audited By, and Noted By apply globally to every
// report — configured once in `reportConfig`. "Prepared By" is removed.
//
// - `signatories` (per warehouse) now only stores `certifiedCorrectPosition`.
// - New `reportConfig` table — a single global record (id: 'global') with
//   `verifiedCorrect: [{ name, position }, ...]`, `auditedByName`,
//   `auditedByPosition`, `notedByName`, `notedByPosition`.
// v5 — Major Phase 5 redesign based on real NFA document samples
// (Empty Sacks Issue, Empty Sack Receipt, Warehouse Stock Issue/Receipt).
//
// Key changes:
//  - `transactions` is split conceptually into STOCK docs (WSR, WSI, WTS —
//    kilos/bags, tied to a pile) and SACK docs (ESR, ESI — pieces only, no
//    pile, no kilos). Both still live in one table since they share id/
//    type/serialNo/status/date/isSynced, but stock-only fields
//    (pileId, grossKilos, mtsSackTypeId, mtsCondition, netKilos, bags,
//    avgWeightPerBag, varietyId, age, ageUnit, condition, autoComputeNet,
//    aiNumber, farmerCoop) and sack-only fields (sackLines, linkedDocNo,
//    siaNumber) are simply left undefined on docs of the other kind.
//  - `serialNo` is now fully user-controlled (with a system-suggested
//    starting value) rather than purely auto-generated. Uniqueness is
//    enforced per `type` (Section 3.1 spirit, relaxed per latest
//    clarification: dup-check scoped to document type only, not warehouse).
//  - `farmerCoop` becomes `farmerCoops` (array) — WSR/Procurement now
//    supports multiple members.
//  - New `transactionTypes` table — admin-configurable nature-of-transaction
//    list (Milling, Procurement, Transfer, Sales, etc.), since the sample
//    documents show this as a free-standing field independent of WSR/WSI/
//    WTS/ESI/ESR.
//  - `authorities` gains `totalIssuedBags` alongside the existing
//    `totalIssued` (kilos), since AI/SIA allocations can be defined in
//    bags-only, kilos-only, or both, and issuance against them needs to
//    track whichever unit(s) were defined.
db.version(5).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType',
  transactions: 'id, type, serialNo, status, date, pileId, isSynced, aiNumber, siaNumber',
  authorities: 'authId, type, aiNumber, assignedWarehouse, status',
  provinces: 'provinceId, code, name',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',

  // Admin-configurable "Nature of Transaction" list — Milling, Procurement,
  // Transfer, Sales, etc. { transactionTypeId, name }
  transactionTypes: 'transactionTypeId, name',
})

// v6 — Phase 6: Google Sheets bridge for AI/SIA retrieval + transaction
// backup logging.
//
// One Google Apps Script Web App URL (admin-configurable, can change at
// any time) fronts a single spreadsheet containing multiple named sheets:
// one for AI allocations, one for SIA allocations, and one as a backup
// log of every Issue/Receipt transaction created in this app. The same
// URL handles both directions — GET to read AI/SIA rows, POST to append a
// transaction backup row — distinguished by an `action` query param/body
// field (see src/services/googleSheetsBridge.js for the exact contract).
//
// - New `googleSheetsConfig` table — a single global record (id: 'global')
//   storing `webAppUrl`, `aiSheetName`, `siaSheetName`,
//   `transactionsSheetName`, and `lastSyncedAt` (ISO timestamp of the most
//   recent successful AI/SIA pull, shown in the admin UI).
db.version(6).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType',
  transactions: 'id, type, serialNo, status, date, pileId, isSynced, aiNumber, siaNumber',
  authorities: 'authId, type, aiNumber, assignedWarehouse, status',
  provinces: 'provinceId, code, name',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',

  // Singleton record, id: 'global'. Non-indexed fields: webAppUrl,
  // aiSheetName, siaSheetName, transactionsSheetName, lastSyncedAt
  googleSheetsConfig: 'id',
})

// v7 — AI Number and SIA Number are distinct reference numbers, not the
// same field reused across two record types. The earlier schema had SIA
// records store their reference number in `authorities.aiNumber` (a
// shortcut taken when AI/SIA were first unified into one table) — this is
// now corrected: `authorities` indexes both `aiNumber` and `siaNumber`
// separately. An AI record populates `aiNumber` and leaves `siaNumber`
// null; an SIA record populates `siaNumber` and leaves `aiNumber` null.
// `transactions` already had both fields indexed since v5 (WSI writes to
// `aiNumber`, ESI writes to `siaNumber`) — no change needed there, only
// the lookup logic in googleSheetsBridge.js / StockFormBase / SackFormBase
// / AuthoritiesInfoPanel needed to stop conflating the two.
db.version(7).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType',
  transactions: 'id, type, serialNo, status, date, pileId, isSynced, aiNumber, siaNumber',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status',
  provinces: 'provinceId, code, name',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
})

// v8 — Live pile totals + variety-locked piles + customer directory.
//
// - `piles` gains `varietyId` (indexed) — every pile is locked to exactly
//   one variety for its whole lifetime (a pile can never mix varieties).
//   `cerealType` (Rice/Palay) is kept alongside it, not replaced, since
//   both the broad category and the specific variety matter independently
//   in different places (e.g. Admin Home's age-bucket tables group by
//   category; the pile itself is identified by variety).
// - `piles` gains `currentKilos` alongside the existing `currentBags` —
//   both are running totals, live-updated whenever a stock transaction
//   (WSR/WSI/WTS) saves against that pile, rather than being computed by
//   re-summing every transaction on every render. WSR adds to both
//   fields; WSI subtracts from both. WTS is a true in-warehouse
//   "combination" document (its own receipt+issue sides) that hasn't been
//   built yet — until then it does not move pile totals.
// - New `customers` table — a lightweight directory built up automatically
//   as WSR/WSI/WTS/ESR/ESI forms are saved, keyed by normalized customer
//   name, recording whether that name was last entered as an individual
//   (with RSBSA/Gender/Address) or a farmer cooperative (with a members
//   list) — powers the autocomplete + auto-fill behavior on every
//   Customer Name field across every form.
//   { customerId, name, normalizedName, rsbsa, gender, address,
//     isFarmerOrg, farmerCoopMembers }
db.version(8).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId',
  transactions: 'id, type, serialNo, status, date, pileId, isSynced, aiNumber, siaNumber',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status',
  provinces: 'provinceId, code, name',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
  customers: 'customerId, normalizedName',
})

// v9 — Warehouse-scoped serials, series back-navigation, warehouse
// addresses, manual AI/SIA completion tracking.
//
// - `transactions` gains `warehouseId` (indexed, plus a compound
//   `[type+warehouseId+serialNo]` index) — every document type (stock AND
//   sack) now records which warehouse it belongs to directly, rather than
//   only being reachable via `pileId` (which sack documents don't have at
//   all). This is required because every warehouse keeps its OWN document
//   series per type — WSR/WSI/WTS/ESR/ESI serial numbers are scoped to
//   (type, warehouse), not just type. The old `[type+serialNo]`-only
//   uniqueness check was wrong: it would (and did) block a warehouse from
//   reusing a serial another warehouse had already used, and conversely
//   suggested the wrong "next" serial when switching warehouses.
// - `warehouses` gains `address` — needed so a "WS <name>" customer
//   suggestion (see customerDirectory.js) can auto-fill the address of
//   whichever warehouse(s) that supervisor is assigned to.
// - `authorities` gains `manuallyCompleted` (boolean, default false) — AI
//   or SIA allocations that don't get fully issued against in this app
//   (e.g. partial fulfillment tracked elsewhere) can be checked off by
//   the user directly in the AI/SIA monitor, moving them to a "Completed"
//   tab without requiring `totalIssued >= totalAllocation`. Unchecking
//   moves it back to Pending.
db.version(9).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId',
  transactions:
    'id, type, serialNo, status, date, pileId, warehouseId, isSynced, aiNumber, siaNumber, [type+warehouseId+serialNo]',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status, manuallyCompleted',
  provinces: 'provinceId, code, name',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
  customers: 'customerId, normalizedName',
})

// v10 — Settings persistence + Phase 8 reports.
//
// - New `settings` table (id: 'global') — persists SettingsContext toggles
//   (autoAgeMonitoring, and any future per-device preferences) to Dexie so
//   they survive page refreshes without requiring re-login. Previously
//   these were hardcoded defaults that reset on every mount.
db.version(10).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId',
  transactions:
    'id, type, serialNo, status, date, pileId, warehouseId, isSynced, aiNumber, siaNumber, [type+warehouseId+serialNo]',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status, manuallyCompleted',
  provinces: 'provinceId, code, name',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
  customers: 'customerId, normalizedName',
  settings: 'id',
})

// v11 — Branches + MC % on transactions.
//
// - New `branches` table — each branch has a name (e.g. "ALBAY BRANCH")
//   and an address (e.g. "PIER SITE, LEGAZPI CITY") that appear in the
//   NFA report header. Multiple warehouses belong to one branch; each
//   warehouse gains a `branchId` indexed field. The Admin Dashboard gets
//   a new Branches panel for managing this.
//
// - `transactions` gains `moistureContent` (a numeric field, max 2
//   decimal places, required on WSR/WSI/WTS) — this is the MC % column
//   seen on every NFA stock statement. It was missing from the app
//   entirely; reports cannot be generated correctly without it.
db.version(11).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId',
  transactions:
    'id, type, serialNo, status, date, pileId, warehouseId, isSynced, aiNumber, siaNumber, [type+warehouseId+serialNo]',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status, manuallyCompleted',
  provinces: 'provinceId, code, name',
  warehouses: 'warehouseId, code, name, provinceId, branchId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
  customers: 'customerId, normalizedName',
  settings: 'id',
  branches: 'branchId, name',
})

// v12 — Branch → Province → Warehouse hierarchy.
//
// The correct NFA structure is: a branch covers one or more provinces,
// and a warehouse belongs to a province, so branch membership is derived
// automatically (warehouse.provinceId → province.branchId → branch).
// This avoids the v11 mistake of assigning branchId directly on the
// warehouse — you'd have to keep two things in sync when moving warehouses.
//
// - `provinces` gains `branchId` (indexed) — the single field that
//   connects the whole chain.
// - `warehouses` drops `branchId` — it's now derived, never stored.
// - `branches` gains `provinceCode` display field (non-indexed, cosmetic).
db.version(12).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId',
  transactions:
    'id, type, serialNo, status, date, pileId, warehouseId, isSynced, aiNumber, siaNumber, [type+warehouseId+serialNo]',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status, manuallyCompleted',
  provinces: 'provinceId, code, name, branchId',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
  customers: 'customerId, normalizedName',
  settings: 'id',
  branches: 'branchId, name',
})

// v13 — Branch region, WTS dual-sided form support, initial balances.
//
// - `branches` gains `region` (non-indexed string, e.g. "V") — needed for
//   the NFA report header which shows REGION / PROVINCE / CODE / WHSE.
// - `transactions` gains `isInitialBalance` (boolean) — flags a synthetic
//   "beginning balance" entry created when a pile is initialized with
//   starting stock, so reports can compute correct beginning-balance
//   figures without these entries appearing as visible WSR/WSI rows in
//   the statement/recap pages.
// - New `sackInventory` table (id, warehouseId indexed) — stores
//   per-warehouse initial sack piece counts (sackTypeId + condition +
//   pieces), seeded once when a warehouse's ongoing inventory is entered
//   into the app for the first time. Used only for beginning-balance
//   calculations on the sack MTS report; never appears as an ESR/ESI row.
db.version(13).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId',
  transactions:
    'id, type, serialNo, status, date, pileId, warehouseId, isSynced, aiNumber, siaNumber, isInitialBalance, [type+warehouseId+serialNo]',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status, manuallyCompleted',
  provinces: 'provinceId, code, name, branchId',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
  customers: 'customerId, normalizedName',
  settings: 'id',
  branches: 'branchId, name',
  sackInventory: 'id, warehouseId',
})

// v14 - Pile Layout report.
// piles gain purity and dateProcured (optional, free text - real dates
// procured are ranges like "MAR 24 TO APR 4, 2025", not a strict date).
// warehouses gain classifierName - the Classifier is a signatory-only
// name, not a login user, so it lives as a plain field on the warehouse.
// New pileLayoutBoxes table stores the grid layout per warehouse: each
// box has a grid position/span and either a pileId (shows real pile
// data) or null (Vacant, shown with just its own label).
db.version(14).stores({
  users: 'uid, accessCode, role, *assignedWarehouses',
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId',
  transactions:
    'id, type, serialNo, status, date, pileId, warehouseId, isSynced, aiNumber, siaNumber, isInitialBalance, [type+warehouseId+serialNo]',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status, manuallyCompleted',
  provinces: 'provinceId, code, name, branchId',
  warehouses: 'warehouseId, code, name, provinceId',
  varietyTypes: 'varietyId, category, name',
  sackTypes: 'sackTypeId, category, code',
  signatories: 'warehouseId',
  reportConfig: 'id',
  transactionTypes: 'transactionTypeId, name',
  googleSheetsConfig: 'id',
  customers: 'customerId, normalizedName',
  settings: 'id',
  branches: 'branchId, name',
  sackInventory: 'id, warehouseId',
  pileLayoutBoxes: 'id, warehouseId',
})

// v15 — live Google Sheets integration groundwork (schema only; the sync
// worker itself is a separate, later step).
//
// warehouseAliases: the AI/SIA sheet uses short nicknames for warehouses
// (e.g. "ABACORP A", "BSI B") that don't always match this app's own
// warehouse codes, and the same real warehouse sometimes appears under
// multiple typo'd spellings in the sheet ("BSI B" / "BSI-B", "CTD GID 2" /
// "CTD GID2" - confirmed the same warehouse, just data-entry
// inconsistency, vs "ABACORP" / "ABACORP A" - confirmed genuinely
// different warehouses). A dedicated alias table lets an admin map every
// sheet-side spelling to the correct canonical warehouseId, independent
// of the warehouse's own `code`/`name` fields.
//
// sheetSources: supports more than one Sheets URL/date-range at once (the
// user creates a fresh spreadsheet copy each year to avoid one sheet
// growing unbounded) - each source has its own webAppUrl, sheet names,
// and a [dateFrom, dateTo] range it's authoritative for. A sync or report
// spanning a year boundary queries every source whose range overlaps and
// merges the results, rather than assuming a single fixed URL.
db.version(15).stores({
  warehouseAliases: 'alias, warehouseId',
  sheetSources: 'id, dateFrom, dateTo',
}).upgrade(async (tx) => {
  // Seed the real-world transaction natures confirmed present in the
  // live AI/SIA sheet data, which go well beyond what this app's admin
  // table previously offered - added only if not already present by
  // name, so this is safe to run even if some already exist.
  const REAL_TRANSACTION_TYPES = [
    'SALES', 'SALES (BIDDING)', 'TRANSFER', 'MILLING', 'TEST MILLING',
    'REMILLING', 'TEST RE-MILLING', 'REPILING', 'DUMPING', 'PIK',
    'RECLASSIFICATION', 'REBAGGING', 'BAGGING', 'FILLERS',
    'SAMPLE WEIGHING', 'MECH DRYING',
  ]
  const existing = await tx.table('transactionTypes').toArray()
  const existingNames = new Set(existing.map((t) => t.name))
  for (const name of REAL_TRANSACTION_TYPES) {
    if (!existingNames.has(name)) {
      await tx.table('transactionTypes').add({
        transactionTypeId: crypto.randomUUID(),
        name,
      })
    }
  }
})

// v16 — CRITICAL fix: PIN hashing was introduced (accessCode and
// visitorAccessCode are now hashed, never plain text - see
// utils/pinHash.js) without migrating existing plain-text values
// already in the database. Without this migration, every existing user
// is locked out permanently: login hashes the entered PIN and compares
// it against a stored value that's still plain text, which can never
// match. A SHA-256 hash is always exactly 64 hex characters; a 6-digit
// PIN never is, so "already hashed vs. still plain text" is detected
// reliably by length alone - safe to run even if some records were
// already migrated (re-hashing an already-64-char value would produce
// a new, different 64-char string and break login just the same, so
// this only touches values that are NOT already 64 hex characters).
db.version(16).stores({}).upgrade(async (tx) => {
  const isAlreadyHashed = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)

  const users = await tx.table('users').toArray()
  for (const user of users) {
    if (user.accessCode && !isAlreadyHashed(user.accessCode)) {
      await tx.table('users').update(user.uid, { accessCode: await hashPin(user.accessCode) })
    }
  }

  const config = await tx.table('reportConfig').get('global')
  if (config?.visitorAccessCode && !isAlreadyHashed(config.visitorAccessCode)) {
    await tx.table('reportConfig').update('global', {
      visitorAccessCode: await hashPin(config.visitorAccessCode),
    })
  }
})

// v17 — CRITICAL: forces every sheet source's next authority sync to be
// a FULL re-fetch instead of a delta sync. The SIA architecture rework
// (one record per SIA number with a sackLines array, instead of one
// record per sack-type+condition) requires every existing SIA row to be
// reprocessed under the new schema - but the delta-sync optimization
// only ever fetches rows changed since lastSyncedAt, so any row that
// hasn't been re-edited in the sheet since it was first synced (the
// common case) would never be fetched again, and its old, pre-rework
// local record would sit forever with no sackLines field at all -
// confirmed directly from a live authorities dump showing exactly this:
// two old-shape records for the same SIA number, neither with sackLines.
// Clearing lastSyncedAt makes the very next sync fetch everything fresh,
// letting upsertSiaAuthority's own duplicate-cleanup logic finally run
// against these rows and consolidate them correctly.
db.version(17).stores({}).upgrade(async (tx) => {
  const sources = await tx.table('sheetSources').toArray()
  for (const source of sources) {
    await tx.table('sheetSources').update(source.id, { lastSyncedAt: null })
  }
})

// v18 — Firestore removed entirely (dead code from before the Dexie
// Cloud decision - never actually configured with real credentials).
// Google Sheets backup is now the only cloud write path, and it needs
// to mirror not just new saves but edits and deletions too, matched by
// each transaction's own serialNo. Deletion is an immediate hard local
// delete (unchanged) - by the time an offline delete could retry, the
// local record is already gone, so pendingSheetDeletions remembers just
// enough (serialNo, type) to replay the deletion once back online,
// independent of the transactions table itself.
db.version(18).stores({
  pendingSheetDeletions: 'id, serialNo, type',
})

// v19 — marks existing transactions that were already isSynced: true
// (under the old, now-removed Firestore-based sync) as hasBeenBackedUp
// too. The old code pushed a Sheets backup row alongside every
// Firestore upload, so these transactions already have a corresponding
// row in the Sheet - without this migration, editing one of them later
// would incorrectly append a duplicate row instead of updating the
// existing one, since hasBeenBackedUp would default to falsy.
db.version(19).stores({}).upgrade(async (tx) => {
  const alreadySynced = await tx.table('transactions').filter((t) => t.isSynced === true).toArray()
  for (const t of alreadySynced) {
    await tx.table('transactions').update(t.id, { hasBeenBackedUp: true })
  }
})

db.version(20).stores({}).upgrade(async (tx) => {
  const allTableNames = [
    'authorities', 'branches', 'customers', 'googleSheetsConfig',
    'pendingSheetDeletions', 'pileLayoutBoxes', 'piles', 'provinces',
    'reportConfig', 'sackInventory', 'sackTypes', 'settings',
    'sheetSources', 'signatories', 'transactionTypes', 'transactions',
    'users', 'varietyTypes', 'warehouseAliases', 'warehouses',
  ]
  for (const name of allTableNames) {
    await tx.table(name).toCollection().modify((record) => {
      if (!record.realmId) record.realmId = 'rlm-public'
    })
  }
})

// v21 — reverses v20's realmId assignment. rlm-public turned out to be
// the wrong approach: writes to it are only permitted for the database
// OWNER, not an arbitrary logged-in user, so an anonymous/service
// account could never actually push data there (confirmed via a
// cloud-side data export showing none of our tables had ever
// synced). Switching instead to a real, authenticated shared service
// account (see fetchTokens below) - every Dexie Cloud user
// automatically has full read/write access to their OWN private
// realm, so clearing realmId back to unset lets records default to
// that realm instead, with no special permission setup needed at all.
db.version(21).stores({}).upgrade(async (tx) => {
  const allTableNames = [
    'authorities', 'branches', 'customers', 'googleSheetsConfig',
    'pendingSheetDeletions', 'pileLayoutBoxes', 'piles', 'provinces',
    'reportConfig', 'sackInventory', 'sackTypes', 'settings',
    'sheetSources', 'signatories', 'transactionTypes', 'transactions',
    'users', 'varietyTypes', 'warehouseAliases', 'warehouses',
  ]
  for (const name of allTableNames) {
    await tx.table(name).toCollection().modify((record) => {
      if (record.realmId === 'rlm-public') delete record.realmId
    })
  }
})

// v22 - adds serialCounters, an explicit last-used-serial tracker per
// (warehouseId, type), and backfills it from whatever transaction
// history already exists locally on this device. See serialNumber.js
// for the full explanation of why this is needed on top of (not
// instead of) the existing scan-all-transactions approach.
db.version(22).stores({
  serialCounters: '[warehouseId+type], warehouseId, type',
}).upgrade(async (tx) => {
  const allTx = await tx.table('transactions').toArray()
  const best = new Map() // key: `${warehouseId}::${type}` -> parsed serial info

  const SERIAL_PATTERN = /^(.*?)(\d+)$/
  for (const t of allTx) {
    if (!t.warehouseId || !t.type || !t.serialNo) continue
    const match = SERIAL_PATTERN.exec(String(t.serialNo).trim())
    if (!match) continue
    const [, prefix, digits] = match
    const number = parseInt(digits, 10)
    const key = `${t.warehouseId}::${t.type}`
    const current = best.get(key)
    if (!current || number > current.number) {
      best.set(key, { warehouseId: t.warehouseId, type: t.type, prefix, digits: digits.length, number })
    }
  }

  for (const record of best.values()) {
    await tx.table('serialCounters').put({ ...record, updatedAt: new Date().toISOString() })
  }
})

// v23 - preloadState tracks whether a (warehouseId, type) combination
// has had its full transaction history preloaded from the Sheet yet,
// and when it was last checked - see transactionPreload.js. This is
// what lets the app do a full pull only once per warehouse/type (the
// first time it's actually used), and a lightweight "anything new
// since last time" check on every login after that, instead of
// re-pulling everything from scratch every time.
db.version(23).stores({
  preloadState: '[warehouseId+type], warehouseId, type',
})

// v24 - serialCounters' key gains cerealCategory, since WSR and WSI
// now maintain genuinely separate serial series per Rice vs Palay (see
// serialNumber.js for the full explanation). ESR/ESI/WTS aren't
// category-scoped and use a fixed 'ALL' placeholder to keep every
// record's key shape consistent. serialCounters is purely a
// performance cache layered over the real source of truth (actual
// transactions) - changing its key structure means old records under
// the previous 2-part key are no longer valid, so the safe migration
// is simply clearing the table. It self-heals correctly the next time
// a serial is suggested, via the existing scan-based fallback that
// already exists for exactly this kind of "tracker missing" case.
// v24 - CRITICAL FIX: this version previously tried to redefine
// serialCounters' primary key structure directly (2-part key to
// 3-part key) in a single .stores() call, which Dexie does NOT
// support ("UpgradeError: Not yet support for changing primary key")
// - this broke the database upgrade entirely for every user, blocking
// login completely. The correct, Dexie-supported pattern is to DELETE
// a table whose key needs to change in one version, then recreate it
// fresh with the new key structure in a LATER version - see v25 below.
// serialCounters is purely a performance cache (never the source of
// truth - see serialNumber.js), so deleting it entirely is completely
// safe; it self-heals via the existing scan-based fallback the next
// time a serial is suggested.
db.version(24).stores({
  serialCounters: null,
}).upgrade(async (tx) => {
  // Backfill cerealCategory on existing WSR/WSI transactions, derived
  // from their variety's category - without this, every transaction
  // created before this feature existed would have no cerealCategory
  // at all, making it invisible to both the Rice and Palay tabs' serial
  // calculations (suggestNextSerial, the floor, uniqueness checks) once
  // those start filtering by category. Unrelated to the serialCounters
  // key change above, so unaffected by that issue.
  const varieties = await tx.table('varietyTypes').toArray()
  const categoryByVarietyId = new Map(varieties.map((v) => [v.varietyId, v.category]))

  for (const docType of ['WSR', 'WSI']) {
    await tx.table('transactions')
      .where('type').equals(docType)
      .modify((record) => {
        if (record.cerealCategory) return // already set (e.g. a Cancelled record that already preserved it)
        const category = categoryByVarietyId.get(record.varietyId)
        if (category) record.cerealCategory = category
      })
  }
})

// v25 - recreates serialCounters fresh with the new 3-part key
// (warehouseId + type + cerealCategory), now that v24 has already
// deleted the old, incompatible version of this table. This is what
// actually lets WSR/WSI maintain separate serial series per cereal
// category (Rice/Palay/By Products).
db.version(25).stores({
  serialCounters: '[warehouseId+type+cerealCategory], warehouseId, type',
})

// v27 - THE ACTUAL ROOT CAUSE of the long-standing 422 sync errors
// that were blocking ALL cross-device sync (not just this table).
// Even though serialCounters was already in unsyncedTables (excluded
// from DATA sync), Dexie Cloud still validates every table's SCHEMA
// on every sync request regardless of that exclusion - and this
// table's primary key was changed (deleted in v24, recreated with a
// different key in v25) somewhere in this history. Dexie Cloud
// considers changing an already-registered table's primary key
// illegal and was rejecting the entire sync request over it every
// single time - which is why transactions (and everything else)
// never actually reached other devices, despite transactions itself
// never having a schema problem of its own. Renaming to a genuinely
// new table name (serialCounterCache) sidesteps this permanently -
// Dexie Cloud will see a brand new table it has never encountered
// before, not a "changed" existing one, so there is nothing left to
// conflict with.
db.version(27).stores({
  serialCounters: null,
  serialCounterCache: '[warehouseId+type+cerealCategory], warehouseId, type',
}).upgrade(async (tx) => {
  const old = await tx.table('serialCounters').toArray()
  if (old.length > 0) await tx.table('serialCounterCache').bulkAdd(old)
})

// v26 - Milling / Test Milling support.
//
// millingOrders: synced from a Sheet named "MO" (Milling) or "TMO"
// (Test Milling) - mirrors the existing authorities pattern (synced
// reference data the app looks up against, doesn't itself create).
// Each row is one control number with its expected recovery
// percentage - an MO can be split into multiple batches (one per
// participating miller), while a TMO's fulfillment is tracked by
// trial count (always 3) instead of a recovery-percentage comparison.
//
// transactions gains four new indexed fields, all optional and only
// ever populated when transactionTypeId is 'Milling' or 'Test
// Milling': moNumber, tmoNumber, batchNumber (Milling's per-miller
// sub-identifier under an MO), trialNumber (Test Milling's 1/2/3).
// Indexed so the upcoming cross-warehouse monitor can query "every
// transaction under this MO/TMO" efficiently regardless of which
// warehouse recorded it.
db.version(26).stores({
  millingOrders: 'orderId, type, number, status',
  transactions:
    'id, type, serialNo, status, date, pileId, warehouseId, isSynced, aiNumber, siaNumber, isInitialBalance, [type+warehouseId+serialNo], moNumber, tmoNumber, batchNumber, trialNumber',
  // facilityType distinguishes a regular Warehouse from an NFA-owned
  // Mechanical Dryer or Ricemill - these follow different rules
  // entirely (dryers/ricemills aren't part of normal stock movement,
  // they're milling/drying process stops). Indexed so the upcoming
  // monitor can query "every dryer" / "every ricemill" directly.
  warehouses: 'warehouseId, code, name, provinceId, facilityType',
  authorities: 'authId, type, aiNumber, siaNumber, assignedWarehouse, status, manuallyCompleted, regionalAuthorityNumber',
  // NFA-owned Ricemills follow a different rule entirely - no MO/TMO,
  // just the Regional Authority Number (from the AI/SIA sheet) as the
  // sole reference, with the admin manually setting how many net kg
  // the regional office authorized for it.
  ricemillAllocations: 'regionalAuthorityNumber',
  // Private millers (regular MO/TMO-tracked, not NFA-owned) share a
  // Regional Authority Number across several millers, but NOT equally
  // - each (regionalAuthorityNumber, ricemillName) pair needs its own
  // settable share, distinct from NFA-owned Ricemills where one
  // Regional Authority Number maps to exactly one ricemill.
  privateMillerAllocations: '[regionalAuthorityNumber+ricemillName], regionalAuthorityNumber',
}).upgrade(async (tx) => {
  await tx.table('warehouses').toCollection().modify((w) => {
    if (!w.facilityType) w.facilityType = 'Warehouse'
  })
})

// v28 - Pile lifecycle tracking.
//
// piles gains `zeroedDate` (indexed) - distinct from the existing
// manual `closedDate`. Silently set the moment an incremental or
// full-recompute write leaves a pile at exactly zero bags AND zero
// kilos; cleared the moment either goes back above zero. A box's pile
// becomes eligible to auto-vacate once zeroedDate is set AND strictly
// before today (one full calendar day's grace period).
//
// pileLayoutBoxes gains `pileId` (indexed, for vacateBoxForPile's
// reverse lookup) and `assignedDate` (when the box's CURRENT
// occupant/geometry stint began - stamped on every reassignment or
// move going forward; absent/undefined on existing boxes until they're
// next touched).
//
// New pileLayoutHistory table - one row per closed occupancy "stint"
// of a pileLayoutBoxes box. Captures the box's full prior geometry (not
// just which pile occupied it), snapshotted right before any
// reassignment, move, or vacate overwrites the live pileLayoutBoxes
// row - lets a past date's Piles layout be reconstructed exactly
// (position/size, not just totals), unlimited hops back. Synced like
// any other real data (not added to unsyncedTables below) since it's
// genuine historical record, not a per-device cache.
db.version(28).stores({
  piles: 'pileId, warehouseId, pileName, cerealType, varietyId, zeroedDate',
  pileLayoutBoxes: 'id, warehouseId, pileId',
  pileLayoutHistory: 'id, warehouseId, boxId, pileId, occupiedTo',
})

// v29 - Admin-only manual complete/uncomplete for Milling Orders
// (MO/TMO), mirroring authorities.manuallyCompleted. Unlike authorities
// (upserted per-record on sync), millingOrders is fully cleared and
// rebuilt on every sync (see syncMillingOrdersFromSheets in
// googleSheetsBridge.js) - that function now explicitly reads existing
// manuallyCompleted values before the clear and merges them back in,
// so a manual mark survives the next resync instead of silently
// reverting. Indexed for consistency with how authorities.manuallyCompleted
// is indexed.
db.version(29).stores({
  millingOrders: 'orderId, type, number, status, manuallyCompleted',
})

// customerAliases: same exact shape/purpose as warehouseAliases above,
// for Ricemill/miller customer names - the AI/SIA sheet sometimes uses
// a short nickname ("Dens RM") that isn't the customer's real/full
// name ("Dens Marketing Corp"). An admin-managed alias lets the app
// translate the nickname to the real name once, at the moment
// authority data syncs in from the sheet - every downstream use (input
// form auto-fill from that authority, displayed/exported reports, and
// what gets written back to the backup sheets) reads whatever ends up
// stored on the transaction, so translating at that one entry point is
// enough to keep everything consistent, exactly like warehouseAliases
// already does for warehouse names.
db.version(30).stores({
  customerAliases: 'alias, customerId',
})

// Directly confirms whether this exact browser session is actually
// running the schema version that includes the serialCounters ->
// serialCounterCache rename, rather than assuming it based on the
// deployed commit alone - a stale cached bundle (service worker, or a
// Vercel deployment still propagating) would still show the exact
// same 422 error afterward even though the source code has genuinely
// been fixed, since the OLD code would still be what's actually
// running in the browser.
console.log('[DEXIE-CLOUD-DIAGNOSTIC] *** Local schema version:', db.verno, '(expected 27 or higher) ***')
db.table('serialCounterCache').count()
  .then((n) => console.log('[DEXIE-CLOUD-DIAGNOSTIC] *** serialCounterCache table exists locally, count:', n, '***'))
  .catch((e) => console.log('[DEXIE-CLOUD-DIAGNOSTIC] *** serialCounterCache does NOT exist locally yet - still running pre-fix schema:', e.message, '***'))

db.cloud.configure({
  databaseUrl: 'https://zv432njdm.dexie.cloud',
  // serialCounters and preloadState are explicitly per-device
  // performance caches (see their own definitions above) - neither is
  // meant to be shared across devices, so excluding them from sync
  // entirely is correct regardless. This is also the likely fix for
  // "POST .../sync 422 (Unprocessable Content)" errors that appeared
  // after serialCounters' schema changed (deleted and recreated with a
  // new key structure in v24/v25) - Dexie Cloud's server-side schema
  // tracking may not handle that kind of structural change cleanly,
  // and excluding the table from sync sidesteps the problem entirely
  // rather than needing the cloud side to reconcile it.
  // millingOrders/ricemillAllocations/privateMillerAllocations were
  // added locally this session but never registered with Dexie
  // Cloud's schema - pushing changes for a table the cloud backend
  // doesn't recognize is rejected (422), which was blocking sync
  // entirely. millingOrders is a pure read-only cache re-fetched
  // fresh from the Sheet on every device anyway, so excluding it is
  // correct regardless.
  //
  // ricemillAllocations RE-ENABLED for sync: confirmed this admin-
  // entered data (there is no other source for it - unlike
  // millingOrders) was never visible across devices because of this
  // exclusion, which is a real functional gap, not a cautious default.
  // Its primary key ('regionalAuthorityNumber', a plain single-value
  // string) is exactly the shape Dexie Cloud sync supports.
  //
  // privateMillerAllocations STAYS excluded: its primary key is a
  // COMPOUND key ('[regionalAuthorityNumber+ricemillName]') - Dexie
  // Cloud sync does not support multi-part primary keys, which is very
  // likely the actual root cause of the original 422 rejection (not
  // simply "never registered"). Re-enabling this one would need a
  // schema migration to a single synthetic id first (with the compound
  // pair kept as a regular index instead), not just this one-line flip.
  unsyncedTables: ['serialCounterCache', 'preloadState', 'millingOrders', 'privateMillerAllocations'],
  // requireAuth MUST be false for an offline-first app. When true,
  // Dexie Cloud refuses to run ANY operation - including purely local
  // reads/writes that have nothing to do with syncing - until it has a
  // currently-valid auth token. Our service account's token expires
  // roughly hourly and can only be refreshed by calling our own
  // network-dependent endpoint, so requireAuth: true meant the entire
  // local database froze solid the moment connectivity dropped, and
  // stayed frozen until it came back - this is what caused serial
  // numbers (and everything else) to appear to "reset" while offline.
  requireAuth: false,
  nameSuffix: false,
  // Custom auth: rather than Dexie Cloud's own email-OTP login screen,
  // every device silently authenticates as the same shared service
  // account via our own Vercel serverless endpoint (see
  // /api/dexie-cloud-tokens.js), which holds the actual client
  // credentials server-side - they are never exposed to the browser.
  // PIN login remains the app's real, user-facing authentication;
  // this is invisible infrastructure underneath it.
  fetchTokens: (tokenParams) =>
    fetch('/api/dexie-cloud-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenParams),
    }).then((res) => res.json()),
})

// With requireAuth false, Dexie Cloud won't automatically try to
// authenticate on its own - this proactively kicks off the login
// (needed so writes can actually sync once a connection exists)
// whenever the app starts. Deliberately fire-and-forget: not awaited,
// and any failure (e.g. no network at all) is swallowed here rather
// than surfaced - the app must keep working fully offline regardless
// of whether this succeeds, fails, or is still in progress.
db.cloud.login().catch(() => {
  // Offline at startup, or the endpoint is temporarily unreachable -
  // this is expected and fine. Dexie Cloud will retry on its own once
  // connectivity returns; local reads/writes are never affected.
})

// TEMPORARY DIAGNOSTIC LOGGING - added specifically to investigate two
// prior failed connection attempts that broke PIN login. Logs every
// syncState/currentUser change to the browser console with a clearly
// tagged prefix, so if login fails again, we have direct visibility
// into what the sync connection was doing at that exact moment,
// instead of just "invalid PIN" with nothing further to go on.
// Remove once the connection is confirmed stable.
db.cloud.syncState.subscribe((state) => {
  console.log('[DEXIE-CLOUD-DIAGNOSTIC] syncState:', JSON.stringify(state))
})
db.cloud.currentUser.subscribe((user) => {
  console.log('[DEXIE-CLOUD-DIAGNOSTIC] currentUser:', JSON.stringify(user))
  // THE SINGLE MOST DIRECT CHECK for whether every device is sharing
  // one identity (required for transactions to sync between devices
  // at all) or each device has somehow ended up with its own separate
  // one: compare this exact userId value across two different
  // devices, side by side. If they differ, that IS the root cause of
  // transactions only ever appearing on the device that created them
  // - confirmed directly, without needing any server-side log access.
  console.log('[DEXIE-CLOUD-DIAGNOSTIC] *** userId on THIS device:', user?.userId, '***')
})

// syncState.error above has repeatedly shown up as an empty {} object
// with no actual detail - the real explanation for why Dexie Cloud's
// server rejected a sync request (which table, which field, what
// validation failed) lives in the raw HTTP response body itself,
// which nothing was capturing. This intercepts fetch() calls
// specifically to the Dexie Cloud sync endpoint and logs the full
// response body whenever the status isn't OK, so the actual server-
// side rejection reason becomes visible instead of an empty object.
// Exported so Settings.jsx can display the actual last sync error
// text directly on screen - console.error alone is useless on mobile
// devices where there's no practical way to access devtools at all.
export const lastSyncErrorDetail = { value: null }

let lastAuto401RecoveryAttempt = 0
const originalFetch = window.fetch
window.fetch = async (...args) => {
  const response = await originalFetch(...args)
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url
  if (url && url.includes('dexie.cloud') && !response.ok) {
    response
      .clone()
      .text()
      .then((body) => {
        console.error(`[DEXIE-CLOUD-DIAGNOSTIC] HTTP ${response.status} from ${url}:`, body)
        lastSyncErrorDetail.value = `HTTP ${response.status}: ${body}`
        // Auto-recovery for a 401 specifically - unlike logout(), a
        // plain login() call does not discard or reset anything; it
        // simply re-uses the existing session's keypair to request a
        // fresh token. Throttled to at most once every 30 seconds so
        // this can never become a retry loop if a 401 keeps recurring
        // for some other, unrelated reason.
        if (response.status === 401 && Date.now() - lastAuto401RecoveryAttempt > 30000) {
          lastAuto401RecoveryAttempt = Date.now()
          console.warn('[DEXIE-CLOUD-DIAGNOSTIC] 401 detected - attempting automatic re-login.')
          db.cloud.login().catch((err) => {
            console.error('[DEXIE-CLOUD-DIAGNOSTIC] Auto re-login attempt failed:', err)
          })
        }
      })
      .catch(() => {}) // body already consumed elsewhere - nothing more to log
  }
  return response
}
