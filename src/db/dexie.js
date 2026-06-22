// Local Dexie (IndexedDB) workspace — see PRDD Section 3.2 for field
// definitions. Implements Step 2.1.

import Dexie from 'dexie'

export const db = new Dexie('BSMDatabase')

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
