# Project Handoff — BSM App

## Last Updated
Complete rewrite. This file had gone severely stale (still said Dexie
v13, said Home.jsx split was never done, said the pile layout grid was
12x10) - user caught this directly and flagged it as a serious process
failure. Everything below reflects verified actual current state, not
an accumulated/appended log (that's docs/activity-log.md's job).

## Tech Stack
- Vite + React, Tailwind CSS
- Full dark/light theme system: brute-force CSS class overrides scoped
  under a `.light` class on `<html>` (see index.css) - NOT a CSS-
  variable-in-Tailwind-config approach, which was tried twice and both
  times failed to render correctly for reasons never conclusively
  diagnosed (no way to run the actual Vite build in this environment).
  Theme toggle lives in AppHeader, defaults to dark, persisted via
  SettingsContext. brand.contrast (#0A0A0A) is a permanently-fixed
  color token for text sitting on the green accent or light pile-box
  fills - must never flip with the theme.
- Dexie.js (IndexedDB, currently v14), Firebase Firestore (partially
  wired, see Deferred section)
- react-hot-toast, react-router-dom, lucide-react
- jspdf + jspdf-autotable for PDF reports, html2canvas for image export

## Current Schema (v19)
- users (role: Admin/Warehouse Supervisor/Warehouse Assistant -
  Visitor is NOT a real users-table role, see below)
- piles (warehouseId, varietyId, currentBags, currentKilos,
  initialAgeValue, dateOfReceipt, purity, dateProcured,
  moistureContent, condition)
- transactions ([type+warehouseId+serialNo] compound index,
  isInitialBalance flag, WTS uses issued*/received* prefixed fields
  instead of flat fields - issuedPileId/receivedPileId, NOT a generic
  pileId, which WTS never sets)
- authorities (AI/SIA, manuallyCompleted, assignedWarehouse)
- provinces (branchId), warehouses, varietyTypes, sackTypes
- signatories (keyed by supervisor uid)
- reportConfig (id: 'global' - Verified Correct/Audited By/Noted By/
  BSQAO/visitorAccessCode - a single shared 6-digit PIN for the
  Visitor role, admin-set from the Signatories admin tab)
- transactionTypes, googleSheetsConfig, customers, settings
- branches (name, region, address)
- sackInventory (id, warehouseId, sackTypeId, condition, pieces -
  snapshot, not a log)
- pileLayoutBoxes (id, warehouseId, rowStart, rowSpan, colStart,
  colSpan, pileId|null, label|null) - grid is a fixed 24 columns x 20
  rows (GRID_COLS/GRID_ROWS in Piles.jsx), NOT user-configurable
- warehouseAliases (alias, warehouseId - v15, globally unique, maps
  every AI/SIA sheet nickname/typo to the correct canonical warehouse)
- sheetSources (id, dateFrom, dateTo - v15, supports multiple Sheets
  URLs for the user's year-end fresh-spreadsheet practice)
- v16: no new tables/fields, data-only migration - see PIN Security
  section below, this one is important to understand before touching
  auth-related code again

## Completed Features

### Core (stable, not touched recently)
- PIN login, AuthContext, WarehouseContext, SettingsContext (persisted:
  autoAgeMonitoring, theme, weightUnit)
- StockFormBase (WSR/WSI), SackFormBase (ESR/ESI), WTSForm - series
  navigation, comma-formatted inputs, available-stock hard caps
- AdminDashboard tabs: Provinces, Branches, Warehouses, Users, Varieties,
  Sack Types, Transaction Types, AI/SIA, Signatories, Google Sheets
- Reports.jsx, pdfGenerator.js - full NFA report set (stock/sack
  summary/statement/recap), REGION/PROVINCE/CODE/WHSE header uniform
  across all 6 report pages

### Pile Layout (large feature, multiple sessions)
- Piles.jsx: 24x20 grid editor. Tap-to-draw with live green/red preview,
  occupancy overlay shown as soon as drawing starts (not just the
  candidate selection), boundary/overlap/duplicate-pile validation using
  EFFECTIVE footprint (a pile's actual content-driven size, not just its
  drawn size - prevents placing a new box where a data-heavy neighbor
  will grow into once rendered)
- Move feature: reposition an existing pile without changing its size,
  ghosted old position + live green/red preview, same validation as
  adding new
- Hover/long-press detail popup: renders via a REACT PORTAL to
  document.body (not a child of the grid's own overflow:hidden
  container) - this is deliberate and important, not incidental. Two
  earlier approaches both failed: (1) CSS-scale zoom of the box itself
  was shrunk twice by the outer fit-to-screen transform, (2) a
  same-container popup with maxHeight+scroll still left content
  genuinely inaccessible once hover/long-press ended (no way to scroll
  a tooltip that's already gone). Portal + true viewport coordinates +
  no height cap is what actually guarantees every field is always shown.
  Positioning accounts for the sticky header (~64px) and fixed BottomNav
  (64px), which both visually cover part of the true viewport.
- Auto-crop to used bounds on-screen only (full 24x20 grid shown while
  actively drawing/moving, so users can reach unused areas)
- PDF export (pileLayoutPdfGenerator.js): full warehouse floor-plan
  proportions (NOT auto-cropped - a floor plan must show true
  proportions even if a warehouse only uses a small corner). Boxes grow
  to fit content, capped by whatever sits below in the same columns
  (computed fresh at export time, independent of the editor's own
  validation) - but if content still doesn't fit even at a legible font
  floor, the cap is LIFTED rather than dropping a field, since showing
  everything was confirmed as the higher priority in a direct tradeoff
  the user made explicitly. No truncation anywhere - doc.splitTextToSize
  wraps long values instead, with every wrapped line's height correctly
  reserved upfront.
- Filenames: {WarehouseName}-{ReportType}-{MMDDYY}-{MMDDYY}.pdf (name,
  not code - confirmed via the user's own worked example)
- Period filter now genuinely reconstructs historical pile state
  (computeHistoricalPileState in pileLedger.js) instead of always
  showing today's live totals - replays transactions up to periodTo,
  correctly handling WTS's two-sided issuedPileId/receivedPileId. This
  was a real, confirmed bug (the period inputs existed but only affected
  the PDF's header label text, not the actual data shown) - fixed for
  both on-screen and PDF export.

### Theme, units, header (this-session-ish work)
- Dark/light toggle (see Tech Stack) + KG/MT weight-unit toggle, both in
  AppHeader (upper right), both persisted, both default to the first
  option (dark, KG)
- fmtWeight(kilos, unit) in calculations.js - converts to MT when
  toggled, used everywhere kilos are DISPLAYED in the app EXCEPT the PDF
  generators, which stay kg-only always (explicit user instruction -
  exports are never affected by this toggle)
- AdminHome's "net bags" figures ALSO convert to MT when toggled (bags
  x 50 / 1000 = MT, confirmed formula) - a genuinely different unit
  (bag count vs weight), handled separately from fmtWeight
- AppHeader is sticky (always visible, never scrolls away), holds each
  page's title/subtitle via PageHeaderContext (each page sets its own on
  mount - avoids a route-to-title lookup table duplicating what's
  already in each page), the theme/unit toggles, and logout (now
  requires confirmation, "Are you sure you want to log out?" / OK -
  NOT "Delete", which is ConfirmDialog's default for actual deletions
  elsewhere - confirmLabel prop added rather than changing the global
  default). Hidden entirely while a transaction form is open. Fade
  gradients attached to the header's and BottomNav's own edges (not a
  guessed pixel offset) so scrolling content fades smoothly underneath
  instead of a hard cut.

### Visitor role
- Single shared 6-digit PIN (admin-set, currently on the Signatories
  admin tab - user has asked to MOVE this to its own dedicated panel,
  see In Progress below), matches the existing PIN login keypad exactly
- Synthetic session (role: 'Visitor', not a real users-table record) -
  AuthContext.login() falls back to checking the visitor code only if
  no real user's accessCode matches
- ProtectedRoute extended: requireRole accepts an array now (not just a
  string), new denyRoles prop - Visitor is explicitly allowed on
  /monitoring alongside Admin, explicitly denied /piles /reports
  /settings
- Sees AdminHome (cross-warehouse view) at /, not per-warehouse Home,
  since Visitor has no assigned warehouse
- BottomNav gives Visitor a separate minimal 2-tab nav (Home, Monitor),
  no FAB - App.jsx skips rendering TransactionModal/form machinery
  entirely for Visitor (defense in depth)
- Confirmed via direct inspection that both pages Visitor can reach
  (AdminHome, AdminMonitoring incl. the reconciliation panel) contain
  zero database-mutating code - genuinely view-only by construction

### Age display
- fmtAge(days) in calculations.js - shows "X days" at 30 or under, "X
  month(s), Y day(s)" above that (30-day months, matching the confirmed
  user example: 35 -> "1 month, 5 days"). Applied everywhere age is
  displayed (HomePiles, Piles.jsx's hover popup, the Pile Layout PDF
  export). Fixed a real bug found while doing this: the hover popup was
  showing the raw stored initialAgeValue directly, never accounting for
  auto-age-monitoring's elapsed-time calculation at all.
- EditPileAgeDialog now has a third "Months + Days" mode alongside the
  existing single-unit Days/Months, with two separate inputs pre-
  populated from the pile's actual current age (not a blank 0/0) -
  matches editing to the new combined display format.

### Admin config
- Visitor access PIN now lives on its own dedicated AdminDashboard tab
  (VisitorAccessPanel.jsx), not lumped with Signatories. reportConfig is
  a single global record saved via .put() (full replace, not merge) -
  every panel touching it now spreads the existing loaded config first
  before applying its own changes, to prevent one panel's save from
  silently destroying another panel's fields.


### AI/SIA Monitor (user side)
- CompletedAuthorityModal.jsx - separate popup for completed AI/SIA
  (was inline before, moved out since that list could grow very long).
  Month/year filters (month=All default, year=current year default).
  Reuses the existing AuthorityReconciliationPanel (already built for
  the admin side) for tap-to-view - no separate reconciliation logic.
  Completion date per authority is derived from its own latest matching
  WSI/ESI transaction (authorities have no dedicated completion-date
  field), computed via one bulk query rather than per-row. Scoped to
  the user-side AuthorityMonitor.jsx specifically, per explicit request -
  AdminMonitoring.jsx's own search-based approach was untouched.
- The "View Completed" button shows no count (a long-running warehouse
  could accumulate a genuinely large list, not worth computing just for
  a label).
- Uncheck-complete: only shown for authorities that are manually
  completed AND not actually fully served by real documents
  (isNaturallyComplete() checks the real allocation/issued numbers,
  independent of the manuallyCompleted flag). An authority that's
  genuinely fully served can never be unchecked back to pending, even
  if manuallyCompleted also happens to be true - no checkbox shown at
  all in that case, not just a disabled one. This was a real regression
  the user caught: moving Completed out to its own modal initially lost
  the uncheck path entirely, since the modal only had tap-to-reconcile.

### AI/SIA picker in WSI/ESI forms
- AuthorityPickerModal.jsx (src/components/forms/) - shared between
  StockFormBase (WSI, "Browse" button) and SackFormBase (ESI, "Browse"
  button) - lists pending AI/SIA for the current warehouse, caller
  decides how to apply a selection since the two forms have different
  field shapes. StockFormBase's handleSelectAuthority sets customer
  name, variety (filters the pile list to that variety), Nature of
  Transaction (matched against transactionTypes by name), and remaining
  bags/kilos. SackFormBase's handleSelectAuthority pulls directly from
  authority.sackLines (see the SIA architecture section below) and
  fills every sack line at once, each scaled to its own remaining
  balance - also sets Nature of Transaction.
- StockFormBase's Age field auto-fills from the selected pile's own
  live current age (via calculateCurrentAge, respecting auto-age-
  monitoring), scoped to WSI only (not WSR, where the incoming stock may
  genuinely have a different age than the existing pile). Matches
  whatever unit fmtAge would naturally display it in (Days/Months/
  Months + Days via the new bestAgeUnit() helper), rather than always
  forcing a raw day count into a Days field - StockFormBase's age unit
  selector gained the same "Months + Days" third option
  EditPileAgeDialog already has. Applied via a shared applyPileDefaults()
  function (renamed from applyPileAge - now also handles moisture
  content, same WSI-only restriction and same reasoning), called from
  both manual pile selection (handlePileChange) and the prefill path
  (opening WSI from the pile action sheet) - the prefill path originally
  bypassed this entirely since it sets pileId directly, not through
  handlePileChange. Also guarded against a real race condition (piles
  loads asynchronously; the fix retries once it arrives, but only
  applies once per prefill instance, so a later unrelated piles update
  can't silently overwrite a user's manual edit).

### SIA architecture - one record per SIA number (major rework, COMPLETE)
Per explicit user correction, SIA authorities are ONE record per SIA
number, not one per sack-type+condition combination (an earlier design
this session that turned out wrong once real multi-sack-type SIAs were
tested). A SIA record now has a `sackLines` array:
`[{ sackTypeId, condition, totalAllocationBags, totalIssuedBags }, ...]`
instead of those four fields living at the top level. AI is completely
unaffected - still single-valued, matched by aiNumber.

- googleSheetsBridge.js: SIA rows are parsed individually (same
  validation as before), then GROUPED by SIA number before upserting -
  one upsertSiaAuthority() call per group, building the sackLines array
  from every row in that group. Matches existing records by siaNumber
  alone (not sackTypeId/condition anymore) and merges lines by
  (sackTypeId, condition), preserving each line's own totalIssuedBags
  progress across re-syncs - a line no longer present in fresh sheet
  data is dropped, a genuinely new line starts at 0 issued.
- calculations.js gained isAuthorityNaturallyComplete() and
  isAuthorityComplete() - shared helpers now used by all five places
  that display authorities, replacing what used to be five separate
  local copies of the same logic (a real duplication risk - this is
  exactly the kind of thing that caused stale-field bugs earlier this
  session). For SIA, "naturally complete" means EVERY sack line is
  fully issued - one line still pending keeps the whole authorization
  pending, since it represents one real document.
- SackFormBase.jsx's adjustSiaBalance() reworked to update ONE specific
  (sackTypeId, condition) line within an authority's sackLines array per
  delta, rather than a single lump-sum value - added buildLineDeltas()
  to convert either the live form's sackLines (string pieces) or a
  loaded transaction's saved sackLines (numeric pieces) into deltas,
  with a sign multiplier for reversing old values on edit/delete.
- All five display locations (AuthoritiesInfoPanel.jsx,
  AuthorityMonitor.jsx, CompletedAuthorityModal.jsx,
  AuthorityPickerModal.jsx, AdminMonitoring.jsx) updated: aggregate
  progress across all sack lines for the summary figure, list every
  individual sack type + condition + its own issued/allocated count in
  the detail view.
- Picking/opening a SIA (from the picker, or tapping in a monitor) now
  fills ALL of its sack lines into the ESI form at once, each
  independently scaled to its own remaining balance - a fully-issued
  line is dropped entirely rather than shown as a zero-piece line.
- resolveSiaSackLines and siaParsing.js were deleted entirely (confirmed
  zero remaining references before deleting) - that parsing job now
  happens once during sync, sackLines arrives pre-resolved on every
  authority, so re-parsing at form-open time was both redundant and
  stale against the new data shape.
- AuthorityPickerModal.jsx is always centered and sized max-w-lg
  (previously bottom-anchored on small screens and smaller).

### Piles page (Piles.jsx)
- Now has two tabs: Pile List (reuses HomePiles.jsx directly) and Pile
  Layout (the existing grid editor, unchanged). Warehouse selector
  sits above both, always visible regardless of active tab. HomePiles
  was removed from Home.jsx entirely - the pile list no longer
  appears there, only here.

### Home stock overview (HomeStocks.jsx)
- KG/MT toggle now wired in (was completely absent before). Palay/Rice
  color-coded (green/blue, matching AdminHome's existing convention),
  bigger category labels, a visible divider between the two sections,
  and each row shows bags + net weight side by side with net bags as a
  subtext line below.

## Mock Data
- devTools.js has been removed entirely (was the only mock/dummy data
  anywhere in the app - confirmed via a full-codebase search after
  removal). It was dev-only (gated behind import.meta.env.DEV) so this
  wasn't a production risk, but it's gone now per explicit request ahead
  of live data testing.
- Important gap this leaves open: devTools.js was also the ONLY way to
  bootstrap the very first user account in a fresh, empty database -
  there is no signup flow anywhere in the actual app UI. A brand-new
  database currently has no way to create its first login at all. This
  needs to be resolved before live testing can actually begin (either
  the Google Sheets sync supplies real user records directly, or a
  proper admin-bootstrap mechanism needs to be designed) - not yet
  decided, flagged for discussion.

## Live Google Sheets Integration (in progress, large multi-part effort)

Context: the user has an existing, live Google Sheets + Apps Script
system already in production use, and we're connecting this app to it
for real testing. Full design conversation happened across many turns -
key decisions below are load-bearing, don't re-litigate them without
re-reading the actual discussion.

### Confirmed architecture decisions
- **One-way flows only, no conflict resolution needed:** authorities
  (AI/SIA) flow Sheets -> App only; transactions flow App -> Sheets only
  (as a backup log, not a live source). Neither direction can conflict
  with the other.
- **PIN login stays** (explicit user requirement - some users are
  elderly/forgetful, PIN is easier). Dexie Cloud (the user is setting
  one up, not yet configured) becomes the sync layer underneath the PIN
  login, not a replacement for it - PIN checks against a `users` table
  that itself syncs via Dexie Cloud.
- **Per-warehouse data scoping via Dexie Cloud realms** - a device
  should only ever receive data for the warehouses its user is actually
  assigned to, not a broader sync filtered client-side.
- **Write-allowlist required (explicit, not just convention):** the app
  must NEVER be able to write to the AI/SIA sheets, or any sheet at all
  except an explicit, named list. Not yet built - needs to be enforced
  in code (e.g. a hardcoded allowlist checked before any write call),
  not just "we don't call that function."
- **The existing code.gs uses `google.script.run`**, which ONLY works
  for HTML pages Apps Script itself serves - it is NOT reachable via
  fetch() from this standalone React PWA. A `doPost`/`doGet` JSON API
  layer needs to be added to code.gs before ANY of this works at all.
  Not yet built.
- **Multi-year sheet support:** the user creates a fresh spreadsheet
  copy each year rather than letting one sheet grow unbounded. sheetSources
  (Dexie v15) supports multiple sources with date ranges; a query
  spanning a year boundary merges results from every overlapping source.
- **Delta sync via a real Last Modified column:** user has added a
  LAST MODIFIED column (N) to both AI and SIA sheets with an onEdit
  Apps Script trigger (already deployed and working) that auto-stamps
  it. Sync should ask for only rows modified since last sync, not
  re-fetch and diff the entire sheet every time.
- **Polling interval:** ~30 seconds while the app is in the foreground
  for authority updates, should back off/pause when backgrounded
  (adaptive, not fixed, to respect Sheets API quota and battery) - not
  yet built. Transaction backup submission: immediate when online,
  batched-and-retried when offline, should drain automatically the
  moment connectivity returns rather than waiting on the next user action.

### Real live data findings (from actual AI/SIA JSON the user provided)
- 1071 AI records, 622 SIA records, dates through today (2026-07-22) -
  this is real, current, live data, not historical/dead.
- Warehouse nicknames in the sheet don't match this app's warehouse
  codes, and the same real warehouse sometimes has typo'd duplicate
  spellings. Confirmed: "BSI B"/"BSI-B" and "CTD GID 2"/"CTD GID2" are
  the same warehouse (data-entry typos); "ABACORP"/"ABACORP A" are
  genuinely different warehouses. Solved via warehouseAliases (v15) -
  admin maps every sheet-side nickname to the correct canonical
  warehouse, done in WarehousesPanel.jsx.
- ~60 AI and ~58 SIA records are reserved-but-unused authority numbers
  (only the reference number, nothing else) - confirmed by the user as
  not-yet-issued, the app should skip these on import.
- Real transaction natures go well beyond the app's previous admin list:
  REPILING, DUMPING, PIK, MILLING, TEST MILLING, RECLASSIFICATION,
  REBAGGING, SALES (BIDDING), SAMPLE WEIGHING, TRANSFER, REMILLING,
  BAGGING, FILLERS, TEST RE-MILLING, MECH DRYING - all seeded via the
  v15 migration.
- SIA sack-type/condition parsing: found the compact single-row format
  (e.g. "PPMG50/PPRE50" + "65 bn/17 sh/126 sh/36 us") becomes genuinely
  ambiguous and sometimes spills into overflow columns (Col_10/11/12)
  that have NO fixed meaning across rows (sack breakdown on some rows,
  unrelated pile/status notes on others - confirmed by inspecting real
  examples, not assumed). Resolved: going forward, the sheet uses one
  row per SIA number per sack-type+condition combination (confirmed
  correct by the user) - this is unambiguous and what the parser should
  expect; older compact-format rows should be flagged for manual review
  rather than guessed at.
- AI sheet's "age group" data lives in what was the Note3 column
  (user repurposed it) - AI only, not SIA.
- REMARKS/Note1/Note2/Note3(age group)/OR No. on AI, REMARKS on SIA are
  all real fields that must be read and displayed for monitoring/
  reconciliation purposes, even though the app doesn't act on them.

### Completed so far
- Dexie v15: warehouseAliases table, sheetSources table, transaction-
  types seed migration (see above).
- WarehousesPanel.jsx: Sheet Aliases field, globally-unique validation,
  cleanup on edit/delete.
- SheetSourcesPanel.jsx (new admin tab, replaced the old single-URL
  GoogleSheetsPanel entirely): manages db.sheetSources, date-range
  overlap validation, shows which source is active today.
- googleSheetsBridge.js fully rewritten: multi-source authority sync
  (every source, not just today's - solves the year-boundary problem
  directly), warehouse-alias-based lookup, SIA multi-row parsing (each
  sack-type+condition becomes its own authority record, matched by
  siaNumber+sackTypeId+condition - old compact/compound-format rows are
  explicitly skipped, not guessed at), delta sync via each source's own
  lastSyncedAt sent as modifiedSince, structural write-allowlist
  (WRITE_ALLOWLIST_KEYS - AI/SIA have no write code path at all, not
  just unconfigured), ageGroup capture from AI's repurposed Note3
  column. AuthoritiesInfoPanel.jsx updated to check sheetSources instead
  of the now-orphaned googleSheetsConfig table.
- Known minor cleanup for later: the old googleSheetsConfig Dexie table
  is fully unused now (confirmed, zero references) but left declared
  rather than doing another version bump just for removal.

- SheetSourcesPanel.jsx: Date To is optional (blank = current/ongoing
  source, active until superseded) - was wrongly required before,
  caught directly by the user as confusing UX. Label/URL field copy
  clarified per user confusion (Label is self-chosen, not looked up;
  URL is the Apps Script deployment, not the spreadsheet's own link).
- googleSheetsBridge.js: Date From now actually filters out rows dated
  before it (was designed for this but never implemented - the "skip my
  old experiments" mechanism is now real, not just planned).
- create-backup-sheets.gs delivered separately (not part of the React
  app) - one-time Apps Script utility creating/formatting all four
  backup sheets with headers verified field-by-field against what
  buildBackupRow() actually sends.

- api.gs written and delivered (not part of the React app) - the doPost/
  doGet JSON API layer, cross-checked field-by-field against the exact
  contract googleSheetsBridge.js expects. Write-allowlist enforced
  independently on the Apps Script side (WRITE_ALLOWLIST) as well as
  the React side (WRITE_ALLOWLIST_KEYS) - two separate checks, so a bug
  in one or a direct call to the deployed URL bypassing the app entirely
  still can't reach AI/SIA. Confirmed spreadsheet ID with the user
  directly (https://docs.google.com/spreadsheets/d/1R5MpAlcY7WnJnc5DZTNyg3RYu1VYN9G8FyQnWIYZ1EU) -
  this is the ONE spreadsheet with all AI/SIA/backup tabs, not multiple
  spreadsheets like the earlier unrelated legacy project used.

- **Confirmed working end-to-end** - user tested the deployed
  api.gs URL directly and got back real, live JSON matching the exact
  expected contract (status: SUCCESS, rows: [...] from the actual AI
  sheet). This is the first real confirmation the whole chain (React
  app's contract expectations <-> deployed Apps Script) actually works.
- Warehouse alias matching: confirmed exact normalization rule -
  whitespace and hyphens are ignored ("ABACORP"/"ABACORP "/"ABACORP-A"
  vs "ABACORP A" are the same warehouse), any other letter difference
  is a genuinely different warehouse ("ABACORP" vs "ABACORP A", "BSI"
  vs "BSI-B"/"BSI B"). Implemented in utils/warehouseMatching.js
  (normalizeWarehouseAlias) - this is the actual stored primary key for
  aliases now (not just applied at match time), with the original text
  kept separately as displayLabel for the UI. Verified against the real
  "ABACORP " trailing-space case found in the live sheet data - it now
  resolves automatically with no admin action needed.
- **Real bugs found from first actual live sync test:**
  - date was computed for the Date-From filter but never persisted onto
    the authority record itself, AND never displayed anywhere even
    after being stored - both fixed (storage, then later display) for
    AI and SIA, now shown in AuthoritiesInfoPanel and AuthorityMonitor
  - "Sync Now" was an icon-only button with no text label, hence not
    recognized - added a visible label
  - Palay=green/Rice=blue text coloring added to the AI/SIA type+number
    line in all four places authorities are shown (AuthoritiesInfoPanel,
    AuthorityMonitor, CompletedAuthorityModal, AuthorityPickerModal) -
    AI's category from its variety, SIA's from its sack type
- **A permanent "Clear All" button was added then removed** - user
  raised a valid safety concern (a lasting destructive control for a
  one-time cleanup is an ongoing risk) - replaced with a one-time
  browser console command instead, given only once.
- **PIN security overhaul**: utils/pinHash.js (SHA-256 via native Web
  Crypto API) - accessCode and visitorAccessCode are now stored/compared
  as hashes, never plain text. UsersPanel.jsx and VisitorAccessPanel.jsx
  never pre-fill the PIN field with a stored value; editing uses "blank
  = keep current unchanged" semantics. Also removed a real exposure
  found in the process: the Users list was showing each user's last 2
  PIN digits in plain sight.
- **CRITICAL follow-up bug, since fixed**: the PIN hashing change above
  initially shipped with NO migration for existing plain-text PINs
  already in the database - this locked out every single user,
  including admin, since login now hashes the entered PIN and compares
  it against a stored value that was still plain text (can never
  match). Fixed via a Dexie v16 migration that hashes any existing
  accessCode/visitorAccessCode that isn't already a 64-character hex
  string (a SHA-256 hash is always exactly 64 hex chars, a 6-digit PIN
  never is - reliable, safe detection, and safe to re-run since an
  already-hashed value is correctly left alone). Runs automatically on
  next app load, no manual action needed. IMPORTANT LESSON: any future
  change to how an existing, already-populated field is stored/compared
  needs a matching migration for data already in the database, not just
  updated code - this is the second time in this project a schema-
  adjacent change nearly needed this and the first time it was missed
  entirely until the user was completely locked out.
- **SIA sync - root cause found and fixed.** Was NOT a wrong field-name
  guess after all (CUSTOMER/ISSUED FROM were confirmed correct against
  real API output). The actual issue, found after the user restructured
  the sheet into one-sack-type-per-row: the condition was still
  embedded as text inside # OF BAGS ("487 bn", "2 sh") rather than in
  the separate CONDITION column, which was empty. Since each row now
  names exactly one sack type, a single "NUMBER CONDITION" string is
  completely unambiguous (unlike the old multi-value compact format,
  which remains correctly skipped) - added parsing for this case,
  verified against the real data before implementing (recovered 79 of
  ~138 rows from the user's configured Date From onward; the rest are
  genuinely blank # OF BAGS values from rows the user hasn't filled in
  yet, correctly still skipped). Permanent regression test added
  (test_sia_embedded_condition.mjs).
- Also fixed while touching these files: a stale reference to
  a.sackTypeRaw/a.rawSiaAllocation (fields from before the SIA schema
  rewrite, no longer set on new records) in AdminMonitoring.jsx's
  display - now shows the real sackTypeId/condition instead.
- Apps Script URL confusion resolved: user had the
  script.googleusercontent.com/macros/echo?... redirect URL configured
  instead of the stable script.google.com/macros/s/.../exec deployment
  URL - corrected.

## In Progress / Not Yet Done

### MASSIVE BACKLOG FROM PILOT TESTING FEEDBACK (2026-07-30) - work through in this priority order

This was a single very large feedback message after real pilot testing.
Two items were already fixed at the time of writing (see activity-log
for full detail): (1) the requireAuth: true bug that froze the entire
local database offline - now false, with a non-blocking background
db.cloud.login() call added; (2) the confirmed StockFormBase bug where
navigating back to an existing serial reformatted Gross Kilos (and the
manual Net Kilos override) to 2 decimals via a missing `, 3` argument to
liveFormatNumber, silently discarding real saved precision and
cascading into wrong Net Kilos/Net Bags on any subsequent edit.

**CRITICAL / DATA-INTEGRITY BUGS (fix first, actively corrupting or
risking real data):**

1. MTS Sack Code & Condition sometimes shows blank when navigating back
   to an existing serial via StockFormBase, even though the underlying
   saved value (mtsSackTypeId/mtsCondition) is correct and the field
   names match what's saved. Investigated: there's already a documented
   fallback in the sackOptions computation (re-adds the current
   selection if the category filter would otherwise exclude it), but
   couldn't confirm from static review why it might still fail live -
   needs live reproduction/debugging. Candidate causes to check: sackTypes
   loading asynchronously (useLiveQuery) and not yet resolved at the
   moment of first render with a loaded transaction; the referenced
   sackTypeId no longer existing if a sack type was renamed/deleted since
   the transaction was saved.

2. Serial numbers that exist in the Google Sheets backup but were never
   entered on the web app itself (e.g. entered by another means, or from
   before the app existed) show as blank / have no autofill data when
   navigated to - risk of accidental duplicate serial/transaction
   creation, since the app doesn't recognize the Sheet already has that
   serial's data. Needs a mechanism to recognize and surface
   Sheets-only historical data as real, loadable records (not just
   syncing new local writes outward) - likely needs a pull-based import
   path from the Sheet's existing schema.

3. Duplicate Authority numbers can occur: if the Sheet is used to update
   an authority, instead of it syncing as an update, it can add a
   second authority row with the same number and different data.
   Authority number must be the unique source of truth - needs a
   "last modified" timestamp-based conflict resolution so the app
   always ends up with one authoritative, most-recent record per
   authority number, never a duplicate.

4. Pending AI list, when selecting a pending AI, is currently
   (incorrectly) restricted by variety - it should show ALL pending AIs
   for the user's assigned warehouse(s), regardless of variety. If the
   selected AI has a different variety than whatever was previously
   selected, the pile selection should reset and the variety should
   update to match the AI's actual variety - not the other way around.

5. Cereal-type-specific serial series: apparently each warehouse keeps a
   genuinely SEPARATE serial series per cereal type (Rice, Palay,
   By-Products) - not one shared series per (warehouse, document type)
   as currently implemented. StockFormBase needs a tab/selector for
   Rice / Palay / By-Products, each maintaining its own independent
   series, so switching between them doesn't disrupt continuity for
   either. This is a significant change to the serial-number and
   possibly the schema/keying model (serialCounters is currently keyed
   [warehouseId+type] - would need to become
   [warehouseId+type+cerealCategory] or similar).

6. Hard-limit error clarity: when a transaction is blocked by a limit,
   the inline error currently doesn't make clear WHICH limit is actually
   binding - the authority's remaining balance, or the specific pile's
   available stock. Confirmed real confusion case: authority had
   10,000.000 net kgs remaining, pile only had 20.000 net kgs, and the
   shown error just said "20.000 net kg limit" with no indication it
   was the pile, not the authority, causing hours of user confusion.
   Must always explicitly state which of the two is the actual
   constraint.

7. SIA does not auto-fill the ESI form when selected from the pending
   list, unlike how StockFormBase's AI-picker auto-fills its form. The
   SIA number does end up correctly placed in the input box (and the
   balance is correctly recognized once the rest is filled manually),
   but none of the other fields populate automatically - needs to match
   StockFormBase's existing auto-fill behavior.

8. AI/authority "complete" status: if actual net kgs issued exceeds the
   authorized amount by 0.01 or more (small overage), it should still
   be marked Complete rather than left in a Pending/partial state.

9. Age is not currently synced to Google Sheets at all - suspected cause:
   the sheet has no way to represent a day-based vs month-based age (the
   local schema stores ageUnit + ageValue, but Sheets only sees a number
   with no unit context). Needs: (a) a new "Age Unit" column added to the
   relevant Sheet(s) alongside the existing age number column, (b) the
   Apps Script updated to write both, (c) a ONE-TIME backfill of the
   already-recorded age data from the app's own database into the
   existing Sheet rows, so the user does not have to re-encode anything
   manually to fix historical rows.

**HIGH PRIORITY (real workflow/UX bugs, not silently corrupting data
but actively blocking or confusing real usage):**

10. OR# (Official Receipt number) input needed for Sales transactions -
    optional field, but must be shown wherever relevant (reports, etc.)
    once entered.

11. For Milling / Test Milling AI transactions specifically, the pile
    number (e.g. "Pile 1", "Pile 2B") is currently being entered into
    the OR# column/field - needs its own proper, correctly-labeled
    field/column instead of being crammed into OR#.

12. New user roles needed: Acting Warehouse Supervisor, Acting Warehouse
    Assistant, MPO III (Mechanical Plant Operator III), Acting MPO III.

13. AI balance displays should also show the balance in net bags, not
    only net kgs.

14. Pile layout "Create Pile" card does not update everything correctly
    when the user edits/updates an existing pile via that card -
    some fields silently fail to refresh/save. Needs investigation.

15. "Date Procured" label should read "Date Received" specifically when
    the cereal type is Rice, and stay "Date Procured" for Palay - applies
    everywhere this label appears: pile details display, exported PDF,
    AND the create-pile-layout card.

16. Pile layout tab must always show the FULL layout in view on any
    screen size, including small phones - no panning/scrolling needed to
    see the whole grid (the existing tap/hover-for-details mechanism is
    specifically meant to substitute for needing to scroll around).
    Despite fitting everything on screen, pile name text within each box
    must still stay large enough to read clearly.

17. StockFormBase's form title (currently probably small/subtle) needs
    to be visually larger/more prominent, so the user has no doubt
    whether they're on a WSR, WSI, ESR, ESI, or WTS form.

18. StockFormBase "Confirmation of transaction is Procurement" case:
    store the number of bags used for every Procurement transaction, and
    show a running total on the user's home page (between the stock
    overview and monitor overview sections), styled in amber and clearly
    noticeable. This is meant to remind the user that Procurement bags
    don't yet have a corresponding SIA. Once an ESI transaction is made
    using an SIA whose issued bags match the recorded Procurement bag
    count, the notification should clear. If the SIA's piece count is
    either MORE or LESS than the actual Procurement bag count, warn the
    user clearly either way (over or under) - ask the user for
    clarification on exact wording/thresholds if this is ambiguous when
    building it.

19. Admin ability to edit (and delete) the customer list is needed -
    currently customers can apparently only be added, not edited/removed.

20. Test Milling transactions need a Trial selector (Trial 1/2/3) that
    prevents duplicate trial entries - once Trial 1 has data, only
    Trial 2 and 3 should remain selectable, etc. Each Test Milling also
    has its own Test Milling Order (TMO) number, sourced from a sheet
    named "TMO" - can be clarified/refined later.

21. Milling transactions need a Batch Number selector, sourced from a
    sheet named "MO" - can be clarified/refined later.

22. Test Milling and Milling need their own dedicated monitor, visible to
    ALL users (not scoped to assigned warehouse like everything else) -
    both on Admin/Visitor pages and regular user pages. Rationale: palay
    might be issued from Warehouse 1 but rice recovery received at
    Warehouse 2 (and sacks can be shuffled between warehouses by the
    miller too) - this monitor is meant to give every user visibility
    into the full picture regardless of which warehouse they're
    assigned to, so e.g. Warehouse 1 knows Warehouse 2 already received
    the recovery and can issue the next batch. NFA-owned Ricemills/
    Mechanical Dryers follow a different rule (no TMO/MO number) but
    still need to be represented in this same monitor somehow - explore
    later.

**LOWER PRIORITY / POLISH (can wait, but keep in the backlog):**

23. Use the custom CalendarDatePicker for every remaining native date
    input still in the app (sweep for any leftover <input type="date">).

24. Admin/visitor home, "Stock Breakdown - Warehouse & Category" card:
    larger warehouse name in clearer white; Rice/Palay labels+values
    should get the same blue/green color treatment used elsewhere;
    remove the duplicated "ALB-" - currently showing "ALB . ALB-ABACORP"
    (double prefix) - should read "ALB . ABACORP"; make the Rice/Palay
    values themselves bigger for readability, since this card's values
    specifically don't risk overflow.

25. Admin/Visitor home, "Net Bags by Province & Category" card: add a
    branch total below it (Rice + Palay only, explicitly excluding
    By-Products).

26. General layout adjustment needed - bottom nav or some part of the
    app is described as "almost falling out of the display" on the
    admin/visitor home page - needs investigation on the actual device.

27. By-Products needs its own consistent color treatment across the app:
    hex #F2B949, same treatment as the Rice (blue) / Palay (green)
    colors.

28. Icons/pages sizing sweep - continue checking for any remaining
    small touch targets not yet caught by the earlier mobile sizing
    sweep.

Given the sheer size of this list, work through it roughly in the
numbered order above within each priority tier, verifying and shipping
incrementally rather than attempting everything in one pass - this
mirrors how every fix in this project has been handled so far (small
verified batches, not large unverified ones).

1. CORRECTION to earlier tracking: startAuthoritySyncWorker()
   (src/services/syncWorker.js) already exists and is wired into
   App.jsx - runs on app load, every 5 minutes, and on reconnect. This
   IS the "auto-syncs on login" behavior the user wants kept exactly
   as-is - confirmed directly, not assumed. It is a fixed interval, not
   foreground/background-adaptive - that refinement (if ever wanted)
   is the only real remaining gap here, not the sync itself.
2. SECOND CORRECTION: the offline transaction batch queue was ALSO
   already built (processSyncQueue/startSyncWorker) - scans for unsynced
   WSR/WSI/ESR/ESI transactions, uploads to Firestore, best-effort
   backs up to the Sheet. This is the second time a feature I'd tracked
   as "not yet built" turned out to already exist - verify against
   actual code more carefully before reporting something as missing.
   ONE real gap WAS found and fixed here though: it only ran on app
   load or the 'online' event, so a continuously-online user saving
   several transactions in a row would have nothing upload until some
   unrelated event fired. Fixed with registerImmediateSyncOnSave() - a
   Dexie hook on the transactions table firing a sync attempt after any
   save, regardless of which form created it.
3. Dexie Cloud setup - CONFIRMED WORKING END-TO-END (local dev, via
   `vercel dev --listen 5173`). Database at
   https://z15dzktxq.dexie.cloud. Uses a custom-auth architecture, NOT
   Dexie Cloud's own email-OTP login: every device silently
   authenticates as one shared service account
   ("bsm-app-service@system.local") via fetchTokens calling
   api/dexie-cloud-tokens.js (a Vercel serverless function - the ONLY
   place the actual client_id/client_secret are used, read from Vercel
   env vars, never exposed to the browser). PIN login remains the
   app's real, user-facing authentication, completely unchanged.
   Records default to the service account's own private realm (v21
   migration cleared the earlier, incorrect rlm-public assignment from
   v20 - see activity-log for the full debugging journey). Verified via
   a full cloud-side data export showing all real tables (users, piles,
   authorities, transactions, etc.) actually present in the cloud, not
   just empty system tables.

   STILL NOT DONE:
   - Remove the temporary [DEXIE-CLOUD-DIAGNOSTIC] console logging in
     dexie.js and AuthContext.jsx once production is also confirmed
     working.
   - Deploy to Vercel for real, set the three DEXIE_CLOUD_* env vars
     there scoped to Production (currently only set for Development),
     and whitelist the production domain via `npx dexie-cloud
     whitelist <production-url>`.
   - Verify the same end-to-end flow (login -> sync -> cloud export)
     works on the live deployed site, not just local dev.
   - Per-warehouse realm-based data scoping (letting a user only sync
     their assigned warehouse's data, per the architecture decisions
     above) has NOT been designed or built yet - everything currently
     shares the single service account's one private realm. This
     remains a separate, later piece of work.
4. AdminMonitoring.jsx now has the same Pending/Completed split as the
   user-side monitor (reusing CompletedAuthorityModal) - done, but
   worth a UI pass check once live data volume is higher

## Fixed after real live testing
- A crash in AuthoritiesInfoPanel.jsx (`a.totalAllocationKilos.toFixed
  is not a function`, from a raw un-typed-checked .toFixed() call on a
  leftover non-numeric value) took down the ENTIRE component, which is
  why the Sync Now button appeared "missing" across two separate user
  reports - it was never a UI/stale-build issue, the whole component
  was throwing before rendering anything. Fixed with a proper
  `typeof x === 'number'` guard. Checked every other authority display
  file for the same raw-toFixed pattern - none were unsafe.
- Added scroll-to-top on every page navigation (App.jsx, useLocation +
  pathname-keyed useEffect).
## Deferred (explicit decisions, not forgotten)
- Dexie Cloud migration (replacing Firebase as the sync layer) -
  decided to finish current UI work first, revisit once Google Sheets
  data retrieval is also in progress
- Milling / test-milling transaction monitoring - user's own explicit
  "tackle this later"

## Standing Design Principle: Inline Error Message Format
When building out per-field validation error messages (ValidatedField
and similar), each message must concisely cover three things:
1. What happened (what's wrong)
2. Why it happened (the reason/rule)
3. What action to take (how to fix it)
Kept brief - not a wall of text, not more confusing than the problem
itself. Applies to every inline validation message going forward, not
just the ones already built.

## Known Issues
- FIXED but important context: the SIA architecture rework (one record
  per SIA number instead of per sack-type) needed every existing SIA
  row to be reprocessed, but the delta-sync optimization
  (modifiedSince, checked against the sheet's Last Modified column)
  only fetches rows changed since the last sync. A row stamped once
  (its first edit after the onEdit trigger was added) and never touched
  again in the sheet has a timestamp that becomes permanently older than
  the ever-increasing lastSyncedAt cutoff - it can NEVER be re-fetched
  again by a normal delta sync, regardless of any app-side schema
  change. This is why old, pre-rework SIA records (confirmed directly
  from a live db.authorities dump - zero sackLines field, exactly the
  old shape) never got migrated even after the cleanup logic was fixed.
  Fixed with a v17 migration clearing lastSyncedAt on every sheet
  source, forcing one full re-fetch on the next sync. IMPORTANT LESSON
  for any future schema/parsing change to synced data: delta sync means
  existing local records will NOT self-heal just because the parsing
  logic improved - a forced full re-sync (via a migration like this, or
  some other mechanism) is needed whenever the shape of what's being
  synced changes, not just when new sheet edits happen.
- Also added a concurrency guard (syncInProgress flag in
  googleSheetsBridge.js) since the background worker runs every 5
  minutes and on reconnect - a manual Sync Now tap overlapping an
  in-progress run was a real, previously-unguarded risk (though not
  confirmed as the actual cause of the SIA duplicates - the delta-sync
  issue above was the real one, found from actual live data rather than
  inferred).
- FIXED but important context: an app-wide "today's date" computation
  bug (new Date().toISOString().slice(0,10) - always returns UTC, wrong
  for the local calendar date in positive-UTC-offset timezones like the
  Philippines during early morning hours) affected every default date
  field across the app (receipts, issuances, transfers, summaries,
  report periods, sheet-source checks). Fixed with a shared
  todayLocalISO() helper in calculations.js, replacing the buggy pattern
  in 10 files. If you ever see `new Date().toISOString().slice(0, 10)`
  reappear anywhere (e.g. in a new file), that's this same bug
  resurfacing - use todayLocalISO() instead. Full timestamps (not
  date-only) like lastSyncedAt correctly stay UTC-based (new
  Date().toISOString() without the slice) - only the date-only pattern
  was ever wrong.
- None currently open that aren't listed in "In Progress" above
- IMPORTANT VERIFICATION LESSON: a real JSX syntax bug ("Adjacent JSX
  elements must be wrapped in an enclosing tag" - a missing closing
  </div> inside Piles.jsx's tab-conditional) shipped and broke the
  user's build entirely. The regex-based div tag counting used to
  "verify" JSX changes only counts totals, not whether the tree is
  actually valid - it completely missed this. Fixed by installing
  @babel/parser (available via `npm install --no-save @babel/parser` in
  a scratch directory) and actually parsing the file:
  `parser.parse(code, { sourceType: 'module', plugins: ['jsx'] })`.
  This is now the standard verification method for any JSX file change
  - use it instead of, or in addition to, tag counting.

## Key Design Decisions
- "Various Farmers" (customerDirectory.js) is a HARDCODED special case,
  not a general mechanism - only this exact customer name gets a
  different address per warehouse (Procurement transactions, where it's
  shorthand for "whichever farmers sold to this warehouse today").
  EVERY OTHER customer has exactly one address, overwritten on each
  save, regardless of warehouse - applying per-warehouse addresses more
  broadly was explicitly tried and then explicitly rejected by the user
  as bad UX. Do not generalize this again without being asked. IMPORTANT:
  for Various Farmers specifically, there is NO shared fallback address -
  a warehouse with no saved entry yet resolves to blank/null, never the
  generic top-level address field (a real bug was found and fixed here:
  it was initially falling back to whatever address a DIFFERENT
  warehouse had most recently saved, leaking data across warehouses).
- Green = issuances, Amber/Orange = receipts, fixed app-wide, no
  exceptions
- WTS is genuinely dual-sided (issued + received on one record with
  prefixed fields), never a StockFormBase variant, never sets a generic
  pileId (issuedPileId/receivedPileId only) - every place that groups
  or replays transactions by pile must account for this specifically
  (see wtsAdapter.js's normalizeWtsSide/splitStockTransactions, reused
  by computeHistoricalPileState)
- BSQAO signatory is distinct from the general "Verified Correct" list
- Branch -> Province -> Warehouse is the strict hierarchy
- "Net bags" (a count, kilos/50) and "net kilos" (a weight) are
  different units - only kilos-based figures respond to the general
  fmtWeight/KG-MT toggle; net-bags figures need their own explicit
  bags-to-MT conversion where shown (AdminHome specifically)

## File Locations
- src/pages/Piles.jsx - grid layout editor, portal-based hover popup
- src/utils/pileLayoutPdfGenerator.js - Pile Layout PDF export
- src/utils/pileLedger.js - createPileWithBeginningBalance,
  computeHistoricalPileState
- src/utils/wtsAdapter.js - normalizeWtsSide, splitStockTransactions
- src/components/layout/AppHeader.jsx - sticky header, theme/unit
  toggles, logout
- src/context/PageHeaderContext.jsx - per-page title/subtitle
- src/context/SettingsContext.jsx - theme, weightUnit, autoAgeMonitoring
- src/components/common/ConfirmDialog.jsx - confirmLabel prop (default
  "Delete", override per use case)
- src/utils/calculations.js - fmtWeight, fmtDateForFilename,
  sanitizeForFilename
- docs/activity-log.md - chronological session-by-session log (append-
  only, different purpose from this file - this file is a snapshot of
  CURRENT state only)
