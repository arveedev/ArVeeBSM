# BSM App - Updated PRD

Reflects actual implementation as of this session. See docs/activity-log.md
for the change-by-change history and handoff.md for current file locations.

## 1. Objective and Core Strategy

Unchanged from the original PRD: an offline-first warehouse stock
management app for NFA, tracking stocks and sacks, AI/SIA authority
balances, and generating NFA-format reports. Dexie.js (IndexedDB) for local
storage; Firebase Firestore wired but not the primary sync path yet (see
section 9).

One material addition not in the original PRD: WTS (Weigher's Tally Sheet)
is now a first-class, dual-sided transaction type for in-warehouse transfers
between piles - the original PRD listed WTS as a transaction type but did
not specify its actual paper-form structure (issued side + received side,
each with their own variety/sack type/condition/bags/gross kilos).

## 2. Global UI/UX and Design System

Visual specs (colors, dark theme) unchanged from the original PRD.

New rule not in the original: color convention for issue vs receipt is
fixed app-wide - green/neon = issuances, amber/orange = receipts. Applies
anywhere the UI distinguishes an issuing action from a receiving one (WTS's
two sides, pile action menu, transaction type badges).

Navigation: the original PRD specified a static four-tab bottom nav (Home,
Piles, Reports, Settings). Actual implementation is role-aware - Admins see
Home, Monitor, Reports, Settings (no Piles tab, since an admin has no
warehouse of their own); everyone else sees Home, Piles, Reports, Settings.
The FAB and its five-button sheet (WSR/WSI/WTS/ESI/ESR) match the original
PRD.

## 3. Data Schema and Models

This is the area with the most drift from the original PRD. Current schema
is Dexie v13; the original PRD specified a single flat v1 schema. Major
differences:

### Tables not in the original PRD
- **branches**: name, region, address - appears in the NFA report header.
  A branch covers one or more provinces (via province.branchId); a
  warehouse's branch is always derived through its province, never stored
  directly on the warehouse.
- **signatories**: keyed by supervisor uid (not warehouseId). Stores
  certifiedCorrectPosition (free text, for PDF signatory blocks) and
  capacity (Warehouse Supervisor / Acting Warehouse Supervisor dropdown,
  used only for customer-name-suggestion auto-detection).
- **reportConfig**: single global record for Verified Correct (one or
  more), Audited By, Noted By - these are the same on every report
  regardless of warehouse.
- **transactionTypes**: admin-configurable "Nature of Transaction" values
  (Procurement, Transfer, etc), not hardcoded.
- **customers**: autocomplete directory built automatically as forms are
  saved - name, RSBSA, gender, address, farmer-org status.
- **sackInventory**: id, warehouseId, sackTypeId, condition, pieces. A
  snapshot (one record per warehouse+sackType+condition, upserted), not a
  transaction log - represents state before any ESR/ESI transaction
  existed. Not in the original PRD, which had no sack-specific initial
  balance concept.
- **settings**: persisted client preferences (autoAgeMonitoring toggle).
- **googleSheetsConfig**: Apps Script webhook URL and sync state.

### Changed from the original PRD
- **transactions**: the original PRD specified one flat shape for every
  type. Actual: WSR/WSI share a flat shape (varietyId, numberOfBags,
  grossKilos, netKilos, condition, moistureContent - MC% was not in the
  original schema at all, added because every real NFA statement requires
  it). WTS is NOT flat - it stores issued*/received* prefixed fields for
  both sides of the transfer (issuedPileId, issuedVarietyId, issuedBags,
  issuedGrossKilos, issuedNetKilos, issuedCondition, issuedStockCondition,
  and the same for received*). ESR/ESI store a sackLines array
  ([{sackTypeId, condition, pieces}]) rather than a single sack figure,
  since one document can cover multiple sack types/conditions. All
  transactions also gained isInitialBalance (boolean) - flags a pile's
  beginning-balance seed, excluded from visible statement/recap rows but
  included in beginning-balance calculations.
- **authorities** (AI/SIA): gained manuallyCompleted (checkbox override,
  independent of the balance-derived status) and confirmed as always
  belonging to exactly one warehouse (not multiple, as an earlier draft
  assumed).
- **piles**: varietyId is now permanent once set - a pile can never change
  variety after creation. Age (initialAgeValue + dateOfReceipt) is
  independently editable via a dedicated dialog, never derived from a
  transaction form's age field.
- **warehouses**: gained address; branchId was tried and reverted in favor
  of deriving branch through province (see section 3 tables above).

### Serial number scheme (unchanged concept, clarified in practice)
Confirmed: [Warehouse Code]-[Document Type]-[Device Supervisor Initials]-
[Counter] is the eventual paper-serial format, but the app enforces
uniqueness per (type, warehouseId) via a compound index, and a brand-new
warehouse's series always starts at 1 (not an arbitrary placeholder number).
WTS keeps its own independent series, separate from WSR/WSI.

## 4. System Mathematical Logic

Net Kilos = Gross Kilos - MTS, Net Bags = Net Kilos / 50 - unchanged from
the original PRD for WSR/WSI.

New for WTS (not in the original PRD, which only listed WTS as a
transaction type without formulas): each side's net kilos is computed the
same way - gross kilos minus (sack type's tare weight for the selected
condition, times bags) - and it is that computed net kilos, never raw
gross, that actually moves the pile's running total. The paper form itself
only shows gross kilos per side; net kilos is computed and applied
automatically.

Authority balance calculation (Section 4.3 of the original PRD) is
unchanged in formula, but the UI now displays actual-issued/total-
authorized as the headline figure (large, color-coded: white while
pending, neon at exactly Complete, crimson if Over-Issued) rather than a
remaining/total figure, since remaining/total made a freshly-issued
authority look identical in shape to a fully complete one.

## 5. Technical Configuration

Unchanged scaffolding commands and Tailwind palette from the original PRD.

## 6. Phased Roadmap - Actual Status

The original PRD's 8 phases are complete in spirit, but several phases
absorbed significant scope not in the original plan:

- **Phase 1-4** (scaffolding, offline DB, auth, navigation): complete,
  matches the original PRD closely.
- **Phase 5** (transaction forms): complete for WSR/WSI/ESR/ESI. WTS was
  originally planned as a StockFormBase variant; actual implementation is
  a fully separate dual-sided form, since WTS's real paper structure does
  not fit the single-variety/single-quantity shape every other form uses.
- **Phase 6** (authority panel, Sheets integration): complete, plus an
  admin-only search-and-reconcile view not in the original PRD (search an
  AI/SIA number, see every WSI/ESI document that used it, with totals).
- **Phase 7** (spatial pile map): the original PRD's visual grid-based
  pile map was not built. Pile management instead happens through cards on
  Home.jsx (tap to act, tap age to edit) - functionally equivalent for a
  single-warehouse view, but without the spatial layout visualization.
- **Phase 8** (reporting): complete, and substantially larger than the
  original PRD's single "stock statement" concept. Actual reports:
  Summary, Statement of Receipts, Recapitulation of Receipts, Statement of
  Issues, Recapitulation of Issues (each per cereal type with any activity
  in the period) for stocks; Warehouse MTS Report, Statement of MTS
  Issues/Receipts, Weekly Recapitulation of Empty Sack Issues/Receipts for
  sacks - matching the real NFA paper documents exactly, including the
  REGION/PROVINCE/CODE/WHSE header block and the five-signatory sign-off
  layout.

## 7. Features Not in the Original PRD

- Branch/Region admin configuration, feeding the report header.
- Sack beginning balance and pile beginning balance, both reachable from
  Settings (for both regular users and admins) - for onboarding a
  warehouse's already-existing stock into the app without a receipt
  transaction distorting reports.
- Home.jsx and AdminHome.jsx inventory now split into Stocks/Sacks tabs,
  each with sack-specific breakdowns the original PRD never specified.
- WS/Acting WS customer-name auto-detection: typing "WS" or a supervisor's
  name suggests that person as the customer, auto-filling their warehouse
  address; the "Acting" prefix is derived from that supervisor's actual
  capacity (Signatories tab), not from what was typed.
- AI/SIA reconciliation search on the Admin Monitoring page.
- Live comma-formatted number inputs across every bags/kilos/pieces field.

## 8. Deferred

Dexie Cloud as the primary sync layer (replacing or supplementing
Firebase) - explicitly deferred until Google Sheets data retrieval is
further along. Google Sheets remains the backup/export destination
regardless of which cloud sync backend is chosen; that decision is
independent of the primary sync layer.
