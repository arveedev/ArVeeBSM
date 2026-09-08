# BSM App — Product Requirements Document

*Status: living document. Sections below are numbered for cross-reference
from the other five planning documents (technical-design-document.md,
app-flow.md, design-brief.md, backend-schema.md, engineering-plan.md).*

## 1. Objective and Core Strategy

BSM App is an offline-first warehouse stock management system built for
NFA (National Food Authority) branch operations. It tracks palay and rice
stock movements, empty-sack inventory, procurement/issuance authority
balances (AI/SIA), milling operations, and produces NFA-format paper
reports for signature.

The app must remain fully usable with no network connection — a warehouse
assistant recording a receipt or issuance never waits on a server. Dexie.js
(IndexedDB) is the local database and the only thing any screen actually
reads from or writes to. Dexie Cloud provides background sync between
devices; the production NFA spreadsheet (Google Sheets) is a companion
system this app reads authorization data from and writes a backup log to,
never a system it depends on to function.

Login is by PIN, not username/password or email — warehouse staff include
elderly and non-technical users, and a 4–6 digit PIN entered on an on-screen
keypad is the fastest, most reliable path into the app on a shared device.

## 2. Roles and Access

- **Admin** — cross-warehouse visibility and every configuration panel.
  Has no warehouse of their own, so sees the cross-warehouse Home/Monitor
  views instead of a single warehouse's transaction entry screens.
- **Warehouse Supervisor** / **Acting Warehouse Supervisor** — full
  transaction entry and pile management for their assigned warehouse(s).
- **Warehouse Assistant** / **Acting Warehouse Assistant** — same
  transaction entry access as a Supervisor, distinguished only for
  signatory/reporting purposes.
- **MPO III** / **Acting MPO III** — same access pattern, for staff whose
  formal title differs from the two roles above.
- **Visitor** — a single shared, admin-set 6-digit access code (not a real
  user account) grants a strictly read-only cross-warehouse view (Home and
  Monitor only). A Visitor session can never reach a transaction form, the
  Piles editor, Reports, or Settings, and no code path available to that
  session can write to the database.

Every "Acting" variant of a role carries identical permissions to its base
role everywhere the app checks role — the distinction exists for signatory
titles on printed reports, never for access control.

## 3. Global UI/UX and Design System

Dark theme by default with a full light-theme toggle, plus an independent
kilograms/metric-tons display toggle — both persisted per device and
exposed in the sticky app header alongside logout. The header also carries
each page's own title/subtitle and is hidden entirely while a transaction
form or the full-screen pile layout is open, so the input surface gets the
full screen.

Color is a fixed, app-wide convention: green/neon marks an issuance
(stock or sacks leaving a warehouse), amber/orange marks a receipt (stock
or sacks arriving) — this holds everywhere the UI distinguishes an issuing
action from a receiving one: WTS's two sides, the pile action menu,
transaction type badges, and the Issuance/Receipt breakdown on the NFA
Ricemill monitor.

Bottom navigation is role-aware: Admins and Visitors see Home / Monitor /
Reports / Settings (Visitors get only Home / Monitor, no FAB); everyone
with an assigned warehouse sees Home / Piles / Reports / Settings plus a
central floating action button opening a five-way sheet (WSR / WSI / WTS /
ESI / ESR). The active tab is marked by a continuously-animated pill that
slides and squash-stretches to its new position on every navigation,
rather than appearing and disappearing per tap.

Every numeric bags/kilos/pieces input live-formats with comma separators
as the user types. Every date field uses the app's own calendar picker,
never a native OS date input. Inline validation messages state what's
wrong, why, and how to fix it, kept to one or two lines.

## 4. Data Model

Dexie (IndexedDB), synced via Dexie Cloud.

**Organizational structure**
- `branches` (name, region, address) → `provinces` (branchId, code, name)
  → `warehouses` (provinceId, code, name, facilityType, address). A
  warehouse's branch is always derived through its province, never stored
  directly on the warehouse. `facilityType` distinguishes a plain
  warehouse from a Ricemill facility, which changes what its own Home page
  shows.
- `users` (accessCode as a PIN hash, role, one or more assignedWarehouses).

**Inventory**
- `piles` (warehouseId, varietyId — permanent once set, currentBags,
  currentKilos, dateOfReceipt, initialAgeValue, purity, moistureContent,
  condition, zeroedDate). Age is independently editable via its own
  dialog, never derived from a transaction form's own age field.
- `sackInventory` (warehouseId, sackTypeId, condition, pieces) — a
  snapshot, not a log, representing stock on hand before any ESR/ESI
  transaction existed for that warehouse.
- `pileLayoutBoxes` / `pileLayoutHistory` — the warehouse floor-plan grid
  (24 columns × 20 rows, fixed) mapping a drawn box to a pile, with
  historical occupancy so a past date can be reconstructed.
- `varietyTypes` (category: Rice / Palay / By Products, name),
  `sackTypes` (category, code, per-condition tare weight).

**Transactions** — one `transactions` table for every movement type,
distinguished by `type`:
- **WSR / WSI** (Warehouse Stock Receipt / Issuance) — flat shape:
  varietyId, numberOfBags, grossKilos, netKilos, condition,
  moistureContent (MC%), an optional linked AI number, batch/trial number
  for Milling-type transactions, and an `isInitialBalance` flag marking a
  pile's beginning-balance seed (excluded from statement/recap rows,
  included in beginning-balance math). WSI additionally supports drawing
  from more than one pile on a single issuance — one primary pile plus any
  number of additional pile allocations, each with its own full field set,
  reconciled together on save/edit/void.
- **WTS** (Weigher's Tally Sheet) — genuinely dual-sided, not a variant of
  WSR/WSI: one record carries an issued side and a received side
  (issued*/received* prefixed fields — pile, variety, sack condition,
  bags, gross kilos), each side's net kilos computed independently
  (gross − that condition's tare weight × bags) and it is that computed
  net kilos, never raw gross, that moves each side's pile total.
- **ESR / ESI** (Empty Sack Receipt / Issuance) — a `sackLines` array
  (`{ sackTypeId, condition, pieces }`), since one document can cover
  multiple sack types and conditions at once.

Every transaction carries `serialNo` (unique per warehouse+document type,
a fresh warehouse's series always starting at 1), `status` (Active /
Cancelled — never physically deleted, so a report can always be
reconstructed as of a past date), and `isSynced`.

**Authorities (AI/SIA)** — `authorities` (type, aiNumber or siaNumber,
assignedWarehouse, customerName, transactionTypeName, totalAllocationBags/
Kilos, manuallyCompleted override, regionalAuthorityNumber). An SIA
authority holds one `sackLines` array covering every sack-type+condition
combination it authorizes, matched by SIA number alone — never split into
multiple records. AI is single-valued, matched by AI number. Balance
status (Pending / Complete / Over-Issued) is always derived from actual
issued-vs-allocated figures, with `manuallyCompleted` only ever overriding
the display for an authority that will never be perfectly balanced on
paper — an authority that's genuinely fully served by real documents can
never be left in a stale "manually completed" state.

**Milling** — `millingOrders` (a read-only cache re-synced from the "MO"/
"TMO" sheet tabs — private millers' Milling/Test Milling orders, tracked
by MO/TMO number, not by AI/SIA), `privateMillerAllocations` (per
Regional-Authority-Number-and-ricemill-name pair, tracked separately from
the NFA-owned mechanism below), `ricemillAllocations` (regionalAuthorityNumber,
totalNetKgs authorized, millingInputCapacityBags — the mill's own daily
processing rate). NFA-owned Ricemills and Mechanical Dryers use ONLY the
Regional Authority Number mechanism, never MO/TMO numbers.

**Directories and aliasing** — `customers` (autocomplete directory built
as forms are saved), `customerAliases` (maps a short AI/SIA nickname to a
customer's real name), `warehouseAliases` (maps every spelling variant of
a warehouse's name, across every source system, to one canonical
warehouse — normalization ignores whitespace/hyphen differences
automatically; only a genuinely different abbreviation needs an explicit
alias row), `signatories` (per supervisor, their certified-correct
position and capacity), `reportConfig` (the single global Verified
Correct / Audited By / Noted By / BSQAO signatory set and the Visitor
access code), `transactionTypes` (admin-configurable Nature of Transaction
values), `sheetSources` (one or more production-spreadsheet URLs with
date ranges, supporting a fresh spreadsheet copy each year without losing
history — a query spanning a year boundary merges every overlapping
source).

## 5. System Mathematical Logic

- **Net Kilos** = Gross Kilos − (sack condition's tare weight × bags),
  computed automatically and used everywhere a pile or authority balance
  actually moves; the paper form's own Gross Kilos field is never itself
  the value applied to a running total.
- **Net Bags** = Net Kilos ÷ 50, always shown to 2 decimal places
  wherever it's a derived figure — distinct from an actual physical bag
  count, which is a whole number pulled from its own recorded field, not
  computed.
- **Authority balance** = actual issued kilos/bags against
  totalAllocationKilos/Bags, displayed as the actual-issued/total-
  authorized figure (large, color-coded: neutral while pending, green at
  exactly Complete, crimson if Over-Issued).
- **NFA Ricemill Regional Authority tracking**: the allocation is a palay
  quota. "Used" against it is the Issuance total, never the Receipt
  total. Issuance (palay in) has no per-day record on the authorizing
  sheet — it is the mill's own configured daily input capacity (Net
  Bags/day), applied once for every distinct date that has real Receipt
  (rice out, TRANSFER-type, Rice-category variety) activity that day.
  Recovery % = Receipt kilos ÷ Issuance kilos.
- **Age display**: "X days" at 30 days or under, "X month(s), Y day(s)"
  above that (30-day months).

## 6. Live Sheets Integration

**One-way flows only, by design — no conflict resolution needed anywhere:**
authorities (AI/SIA) and Milling Orders (MO/TMO) flow from the production
spreadsheet into the app; transactions flow from the app to a backup log
in the spreadsheet. Neither direction can ever conflict with the other.

A structural write-allowlist (enforced independently on both the client
and the Apps Script server) means the app can never write to the AI/SIA
source sheets or any sheet outside an explicit, named backup list — not a
convention, a hard-coded check before every write call on both sides.

Delta sync uses each row's own Last Modified timestamp, requesting only
rows changed since the last successful sync rather than re-fetching every
row every time. A concurrency guard prevents two overlapping sync passes
from both importing the same not-yet-local row. The backup write path is
idempotent (an existing row for a given serial is overwritten, never
re-appended) and lock-protected against two devices racing the same
not-yet-synced transaction.

Warehouse and customer name variants across every source system resolve
to one canonical identity via the alias tables in Section 4, so a
typo'd or abbreviated name never silently becomes a second, disconnected
record.

## 7. Cloud Sync Architecture

Dexie Cloud is the sync layer underneath PIN login, not a replacement for
it. Every device silently authenticates as one fixed shared service
account through a serverless token endpoint that holds the actual Dexie
Cloud client credentials — the browser never sees them, and the endpoint
is the only thing in the whole system that does. PIN login remains the
app's real, user-facing authentication.

The app works fully offline by design: local reads and writes never wait
on any network call, and a lost connection never blocks data entry — sync
resumes automatically the moment connectivity returns, with a periodic
background retry as a safety net rather than relying solely on a
reconnect event.

## 8. Pile Layout

A warehouse's floor plan is a fixed 24×20 grid. An admin/supervisor draws
a pile's footprint directly on the grid with a live green/red
valid/invalid preview as they draw, validated against the pile's actual
content-driven size (which can exceed its originally drawn footprint) so
a new box can never be placed where a data-heavy neighbor will grow into.
An existing pile can be moved to a new position without changing its
size, with the same live validation. A full-screen, rotated landscape
view is available for reviewing the whole layout at once on a portrait
phone. The exported floor-plan PDF always shows true warehouse
proportions (never auto-cropped to just the used area, unlike the
on-screen editor) since a floor plan must represent the whole space.

## 9. Milling Operations

Two structurally separate tracks, since NFA-owned facilities and private
millers are authorized completely differently:

- **Private millers**: Milling/Test Milling orders are read-only, synced
  from the production spreadsheet's MO/TMO tabs. A Test Milling order
  supports up to three trials; a trial number may legitimately span more
  than one transaction (one combined receipt, one per trial, or one
  transaction per variety/sack type under the same trial), so trial reuse
  is never restricted by the entry form. Batch/trial numbers display
  alongside the customer name on reports and exported statements.
- **NFA-owned Ricemills and Mechanical Dryers**: no MO/TMO numbers at
  all. An admin sets each Regional Authority Number's total palay
  allocation and the mill's own daily milling input capacity. The
  facility's own Home page (and the cross-warehouse admin Monitor)
  present palay-in (Issuance) and rice-out (Receipt) as two aligned
  tables per Regional Authority Number — same column layout in both, so
  Net Bags/Net Kgs land in the same position whether or not a row has a
  per-item AI number or variety to show — with a running Issuance vs.
  allocation total and a recovery percentage.

## 10. Reporting

Full NFA-format paper report set, matching the real forms exactly
(REGION/PROVINCE/CODE/WHSE header block, five-signatory sign-off layout):
Summary, Statement of Receipts, Recapitulation of Receipts, Statement of
Issues, and Recapitulation of Issues (each generated per cereal type with
any activity in the selected period) for stocks; Warehouse MTS Report,
Statement of MTS Issues/Receipts, and Weekly Recapitulation of Empty Sack
Issues/Receipts for sacks. A period filter genuinely reconstructs
historical pile state (replaying every transaction up to the selected
date) rather than always showing today's live totals, correctly handling
WTS's two-sided structure. PDF export never truncates a field — long
values wrap instead, with every wrapped line's height reserved correctly
in the layout.

## 11. Data Integrity Principles

- A transaction is never physically deleted — only marked Cancelled — so
  historical reconstruction (reports, pile state as of a date) is always
  possible.
- A pile's variety is permanent once set; correcting a genuine mistake
  means creating a new pile, never mutating an existing one's identity.
- Syncing a Sheet-sourced record into a local one that already has real,
  locally-completed data only ever fills in fields the Sheet actually
  has values for — a field the Sheet's schema doesn't track at all can
  never overwrite real local data with a blank.
- Every background sync pass is single-flight — an overlapping second
  pass can never import the same not-yet-local row twice.
- PINs are one-way hashed before storage or comparison; nothing in the
  app ever displays or pre-fills a stored PIN.

## 12. Technical Foundation

Vite + React, Tailwind CSS. Dexie.js (IndexedDB) as the only data layer
every screen reads from; Dexie Cloud for sync. jsPDF + jspdf-autotable for
report generation, html2canvas for image export. A Vite PWA plugin
(vite-plugin-pwa, Workbox under the hood) precaches the app shell — JS,
CSS, HTML, icons, and the self-hosted Inter font files — so the app itself
(not just its data) survives a fully offline cold start, with a client-side
router fallback to `index.html` for any deep route. Deployed on Vercel,
with a single serverless function holding the Dexie Cloud service
credentials server-side.

An admin-browsable Error Log (`errorLogs` table, synced) captures every
caught form save/update/delete/void failure and page-level crash
(via a `SectionErrorBoundary` around each route), recording who hit it and
on which device, so a field-reported bug can be diagnosed centrally without
needing physical access to the device it happened on.

## 13. Target Users

- **Warehouse Supervisor / Acting Warehouse Supervisor** — the primary
  daily user. Records WSR/WSI/WTS/ESR/ESI transactions for their assigned
  warehouse(s), manages the pile layout, and is the named signatory
  ("Certified Correct") on that warehouse's printed reports.
- **Warehouse Assistant / Acting Warehouse Assistant** — same functional
  access as a Supervisor; the distinction exists purely for the
  signatory title printed on a report, not for what the app lets them do.
- **MPO III / Acting MPO III** — same access pattern as the two roles
  above, for facilities whose staff carry this title instead.
- **Admin** — NFA branch/regional office staff who configure the system
  (warehouses, users, sack/variety types, signatories, Sheet integration)
  and need a cross-warehouse view of stock, authorities, and milling
  activity rather than a single warehouse's entry screens. Typically not
  the person physically present in a warehouse.
- **Visitor** — anyone an admin wants to give a read-only look at
  cross-warehouse Home/Monitor data (e.g. a regional office visitor, an
  auditor) without a real user account or any ability to write data.
- Every user in the field is expected to be operating on a personal
  Android phone or a shared warehouse tablet, frequently with poor or no
  signal — this shapes nearly every other decision in this document.

## 14. Out of Scope

The following are deliberately **not** part of this app, now or in any
currently planned phase:

- Payroll, HR, or any staff-management function beyond the PIN-login user
  directory needed for access control and report signatories.
- Financial accounting, procurement payment processing, or budgeting —
  the CPF (Cash Procurement Fund) balance and cereal-price tracking that
  feed the GSR report live in a separate companion Google Sheets system
  (see `docs/sheets-reports-setup.md`), not in this app.
- A native mobile app or app-store distribution — the PWA (installable,
  offline-capable web app) is the only distribution mechanism.
- Multi-tenant support for organizations other than NFA, or configurable
  branding/white-labeling.
- Conflict resolution UI for the Google Sheets integration — by design,
  every sync direction (AI/SIA and MO/TMO in, transactions out as a
  backup log) is one-way, so there is deliberately nothing to reconcile.
- General document management, e-signatures, or workflow/approval chains
  beyond a report's fixed five-signatory sign-off block.
- Direct printer integration — reports are exported as PDF/image files
  for the user to print or share through their device's own OS.

## 15. Success Criteria

- A warehouse Supervisor can record a full day's WSR/WSI/WTS/ESR/ESI
  activity, including printing/exporting that day's reports, with zero
  network connectivity from login to close of business.
- Every transaction entered on any device eventually appears, unduplicated,
  on every other device assigned to the same warehouse, and in the Google
  Sheets backup log, without any user-visible conflict-resolution step.
- A pile's or authority's running balance always matches what a full
  recompute from its actual transaction history would produce — no
  drift between the fast, incremental running total and the ground truth.
- Every NFA-format report the app produces (Summary, Statement of
  Receipts/Issues, Recapitulation of Receipts/Issues, Warehouse MTS
  Report, Statement of MTS Issues/Receipts, Weekly Recap of Empty Sack
  Issues/Receipts, Pile Layout) is visually and numerically consistent
  with the equivalent hand-prepared paper form, for any historical
  period selected — not just "today."
- A non-technical warehouse worker can log in and start recording a
  transaction in under 10 seconds on a shared device, with no password to
  remember or forget.
- A schema change never locks a user out of their own local data or
  silently loses a locally-entered, not-yet-synced transaction — every
  Dexie version bump in `src/db/dexie.js` carries a safe, tested
  `.upgrade()` migration where one is needed.
