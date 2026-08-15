# Project Handoff — BSM App

## Last Updated
Complete rewrite. This file had gone severely stale (still said Dexie
v13, said Home.jsx split was never done, said the pile layout grid was
12x10) - user caught this directly and flagged it as a serious process
failure. Everything below reflects verified actual current state, not
an accumulated/appended log (that's docs/activity-log.md's job).

2026-08-14 addendum: added a new top-of-section entry under "In Progress
/ Not Yet Done" for the sack-weight (MTS) reporting fix currently
mid-implementation - read that section first, it is the most current
open work. Rest of this file not otherwise re-verified this pass.

2026-08-14 addendum #2: this file and docs/activity-log.md are no longer
purely convention-based. A `Stop` hook in `.claude/settings.json` now
blocks a Claude session from ending its turn if it changed files but
neither doc was touched - see the matching activity-log.md entry for the
exact mechanism and its limits (it can force an update attempt, not
guarantee a good one).

2026-08-15 addendum: new top-of-section entries under "In Progress / Not
Yet Done" for this session's work (MillingMonitor cleanup, Expected
Recovery fix, AdminHomeStocks toggles, save-freeze/delete-sync bugs,
first responsive-scaling pass) and the one still-open item (BottomNav
glow-stutter fix, awaiting the user's choice of approach) - read those
first, they are the most current state. Rest of this file not otherwise
re-verified this pass.

2026-08-15 addendum #2 (continuation session): another new top-of-section
entry for Piles popup edge-clamping, the form pop-animation/timing fix
(now also applied to Admin Dashboard), the BottomNav pill edge-clipping
fix, a horizontal-scrollbar-overflow fix, OR# autofill, and the Reports
Summary/Stock Statement tab split - all done and pushed. Two items
confirmed by the user via interactive demos but NOT YET BUILT: the full
Home page declutter (Overview/Activity tabs + 3 collapsing changes) and
a "FAB dodges the nav pill" micro-interaction - both are the most
current open work, read that entry first.

## Tech Stack
- Vite + React, Tailwind CSS
- Full dark/light theme system: brute-force CSS class overrides scoped
  under a `.light` class on `<html>` (see index.css) - NOT a CSS-
  variable-in-Tailwind-config approach, which was tried twice and both
  times failed to render correctly for reasons never conclusively
  diagnosed at the time. CORRECTION: `npm run build` DOES actually work
  in this environment (verified before packaging) - a real Vite
  production build now succeeds cleanly.
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

### OPEN (2026-08-15 session, continuation) - Home page declutter + FAB dodge, both demoed and approved, not yet built

Two follow-up requests handled via interactive HTML demos (Artifact
tool) before touching real code - both now confirmed by the user but
**not yet implemented**:

- **Home page declutter**: user reported Home.jsx felt crowded (too
  many always-expanded sections stacked at once). Recommended and
  demoed 4 changes; user approved all 4 together:
  1. Split Home into "Overview" (warehouse selector + Stocks/Sacks
     inventory card + alerts) and "Activity" (Milling Operations +
     AI/SIA Monitor) top-level tabs, same pill-tab pattern as the
     Reports Summary/Stock Statement split.
  2. HomeStocks.jsx's age-bucket breakdown (0-3 months / >3 months /
     Total row) collapses behind a "Show age breakdown" disclosure -
     only the headline bag count + net kilos show by default.
  3. ProcurementBagsNotification.jsx + PalayDryingStatus.jsx (which is
     itself 3 sub-components: DryerStatusCard, WetPalayNotification,
     DriedStockReceivedNotification) merge into one collapsible
     "Alerts" strip with a count badge, instead of each rendering its
     own always-visible full-width banner.
  4. AuthorityMonitor.jsx (the AI/SIA Monitor) becomes collapsible by
     default with a "N pending" count chip, matching how Milling
     Operations already behaves in Home.jsx - currently it's the one
     section that's always fully expanded with its own tab bar.
  - Implementation note worked out but not yet coded: for the Alerts
    count badge without duplicating each sub-notification's own
    useLiveQuery logic, the plan is to always mount the notification
    stack (so their queries stay warm) inside an accordion body, and
    use a `MutationObserver` on that body to track how many children
    actually rendered (each sub-component still returns `null` when
    inactive) - gives an accurate live count for the badge and the
    "hide the whole strip when nothing's active" behavior, without
    lifting any query logic up into the parent.
- **FAB dodge**: a nav-bar micro-interaction where the BottomNav FAB
  hops out of the way when the elastic pill's travel crosses its grid
  column (e.g. Home→Reports), demoed as a standalone HTML mockup and
  refined once per user feedback (FAB now sits low enough at rest to
  visually intersect the pill's path, with a much bigger escape jump).
  Not yet ported into the real BottomNav.jsx - needs the real crossing
  check to reuse `REGULAR_NAV_COLUMN`/`VISITOR_NAV_COLUMN` (FAB's grid
  column is index 2 in the 5-column regular nav; the 2-column Visitor
  nav has no FAB at all, so this is regular-nav-only) rather than the
  demo's hardcoded column indices.

Full detail (including the diagnostic approach used for two of the
same-session bugfixes - extracting/tiling video frames via Python+opencv
since no ffmpeg was available) in docs/activity-log.md's "2026-08-15
(continued)" entry.

### DONE (2026-08-15 session, continuation) - Piles popup edge-clamp, form pop animation + Admin Dashboard match, nav pill clipping, scrollbar overflow, OR# autofill, Reports tab animation

All pushed (commits 3ec48b7, de36ee4, b50ae05, 28bedca). Summary:
- Piles.jsx hover/tap popup: clamped the fullscreen center-anchor point
  away from viewport edges (was still overflowing near edge boxes like
  PILE 4 even after the earlier center-anchor fix).
- Transaction forms (StockFormBase/SackFormBase/WTSForm): entrance/exit
  changed from fade+slide-up to a scale+fade pop; closing now fires
  `onClose` immediately (un-hiding the header/nav bars right away)
  instead of after a 380ms local timeout, fixing a reported ~730ms
  "bars take a while to come back" delay. Admin Dashboard converted to
  the exact same fixed-overlay/pop treatment, with the same
  immediate-signal/deferred-navigate decoupling for its close button.
- BottomNav: fixed the elastic pill getting clipped flat (showing a
  black cut edge) at the Home/Settings columns - the squash keyframe's
  scale-up and the position transition's back-out overshoot both
  extend past the row's own edge there, with no neighboring column to
  absorb it like interior columns have.
- index.css: `overflow-x: hidden` on html/body (a horizontal scrollbar
  was intermittently appearing/disappearing, even on the login screen)
  plus `scrollbar-gutter: stable` for the vertical one.
- StockFormBase.jsx: OR # now actually autofills from the AI/SIA
  Monitor list for SALES transactions - `prefill.orNumber` was
  previously only consumed by the Milling/Test-Milling pile-lookup
  effect, nothing wrote it into the real OR # field for any other type.
- Reports.jsx: Summary and Stock Statement split into their own tabs,
  then given an actual entrance animation on switch (initial cut had
  none - `hidden`-class toggling with no animation class just snaps).
- AdminHomeStocks.jsx: Rice/Palay values enlarged in the Province &
  Category table per report they were too small.

Full root-cause detail in docs/activity-log.md's "2026-08-15
(continued)" entry.

### DONE (2026-08-15 session, follow-up) - BottomNav persistent elastic pill + Total Branch simplification

User chose the persistent-pill approach (from an interactive demo, see
below) and asked for it to feel "more elastic, more playful, more
smooth" - iterated on a second demo (squash-and-stretch + back-out
overshoot easing) before implementing for real in BottomNav.jsx.

- Replaced the old transient "liquid glow" (existed only for a 400ms
  window per navigation, fully unmounted/remounted each time, and
  stuttered on rapid successive taps because its "start position" ref
  only updated at the end of that window) with an always-mounted pill
  positioned via a plain CSS `transition: transform` - a continuous
  element always animates from its true current position, so there is
  no stale "from" value left to go wrong.
- `transition-nav-elastic` (index.css) uses a back-out cubic-bezier for
  a slight overshoot-then-settle bounce; a nested inner element replays
  a squash-and-stretch keyframe on every column change
  (`animate-nav-pill-squash`, retriggered via a force-reflow hook since
  CSS animations don't restart just from re-adding an already-present
  class).
- Active tab text changed from `text-brand-neon` to `text-brand-contrast`
  (dark-on-green), since the icon now sits on the pill's solid green
  fill - matches how PillToggle/tab switchers already indicate their
  active segment elsewhere in the app.
- Caught and fixed a real alignment bug along the way (seen in the demo
  screenshot too): shrinking the pill's own box to make room for a
  gutter broke its `translateX(N * 100%)` math, since percentage
  translate is relative to the element's OWN width, not the grid
  column's - the error compounded per column, worst at the rightmost
  tab. Fixed by keeping the outer box exactly one grid column wide and
  moving the gutter to a nested inner element instead.

Also, same follow-up round: AdminHomeStocks.jsx's Total Branch summary
(added earlier this session, see below) still looked cluttered per a
user screenshot - replaced its `<table>` with a plain flex stat strip
(age-bucket label above, value below, Total visually separated via
`ml-auto`) since it only ever holds one row of values and never actually
needed table layout (or the anchor-column workaround that layout had
required) in the first place.

Full detail in docs/activity-log.md's 2026-08-15 entry, items #8-9.

### DONE (2026-08-15 session) - MillingMonitor cleanup, Expected Recovery fix, AdminHomeStocks toggles, save-freeze and delete-sync bugs

Full detail in docs/activity-log.md's 2026-08-15 entry - read that first
for exact root causes and file/line references. Summary here:
- MillingMonitor.jsx: removed duplicate Issued/Received + miller-name
  text from cards (already shown once above), "Warehouse" label now
  contextual (Issuing/Receiving), removed duplicate WSI/WSR/ESI/ESR type
  text (moved serial number up beside the date instead), animated the
  Stocks/Sacks tab switch.
- Expected Recovery card was gated on `order.issuedKilos` (sum of actual
  posted WSI transactions - 0 or understated depending on progress)
  instead of the linked AI's own `authorityAllocationKilos` (fixed at
  AI-issuance time, transaction-independent) - fixed to use the latter,
  so the card is now always visible once an MO has a recovery % and a
  linked AI, regardless of transaction activity.
- AdminHomeStocks.jsx: added a shared PillToggle component, wired as two
  INDEPENDENT Actual/Potential toggles (top card + Breakdown tab, both
  default Actual) - top card's Potential mode shows a plain swapped
  number only, no badge/tag (that enriched treatment stays Breakdown-tab
  only). Age Grouping tab got a "Total Branch" summary at the top
  (aggregated across all provinces via a shared computeRows() helper,
  same source as the per-province rows so they can't drift) and
  per-province bordered-card separation; also fixed a wide-screen table
  layout bug (added a leading label column so numeric columns don't
  spread out with huge gaps - a table with no naturally-wide column gets
  its w-full leftover space spread almost equally across every column).
- Save freeze root-caused: validateForm() in StockFormBase.jsx/
  SackFormBase.jsx ran a blocking network round-trip
  (fetchTransactionBySerial, checking the Sheet for a duplicate serial)
  BEFORE the local save, on every new transaction - moved to run in the
  background, fire-and-forget, AFTER the local save succeeds. This is
  why only NEW saves felt frozen while Update/Delete already felt fine.
- Delete-not-reflecting-on-Sheet bug: Apps Script's deleteTransaction
  action always returned SUCCESS even when no matching row was found,
  so the app could never tell an actual delete apart from "nothing
  happened" - fixed to return found:true/false, propagated through the
  client, now shows a warning toast when a delete's target row wasn't
  actually located on the Sheet. REQUIRED the user to manually redeploy
  docs/apps-script-full-replacement.js in their Google Apps Script editor
  - confirmed done.
- AuthorityReconciliationPanel.jsx: fixed its bottom "Total" bar missing
  safe-area-inset-bottom padding (was sitting flush against the phone's
  home-indicator bar).
- First responsive-scaling pass: root html font-size now bumps at md/lg
  breakpoints (index.css) - since Tailwind's default sizing utilities are
  rem-based, this scales font size and spacing/padding together in
  lockstep across the whole app with one change, addressing "looks fine
  on mobile but small on desktop" without per-component edits. Known
  gap: components using fixed-pixel arbitrary values (e.g. PillToggle's
  text-[10px] labels) don't participate yet.
- All of the above, plus carried-over uncommitted work from the prior
  session (NfaMillingMonitor.jsx, Home.jsx facility-scoping,
  AdminMonitoring.jsx NFA tab, RicemillAllocationsPanel.jsx crash fix, SIA
  blank-pieces fixes), committed and pushed to origin/main (commit
  1bf0925) at the user's explicit request.

STILL OPEN, unrelated to the above and not re-investigated this session:
- The -355 bags PD1-A (0.095) persistent balance for warehouse CTD-GID 2.
- Only per-component pixel-based sizing (not yet touched by the
  responsive-scaling pass) as a follow-up if it reads too small on wide
  screens.

### DONE (2026-08-14 session) - sack weight (MTS) fix, plus a full pilot-feedback batch

Full detail in docs/activity-log.md's entries for this date - read those
first for exact file/line references. Summary here for quick orientation.

The sack-weight (MTS) reporting fix from the previous session's handoff
is now COMPLETE and built on top of: BeginningBalancesPanel.jsx's Piles
tab is now a repeatable list of lines per pile (each its own bags/kilos/
condition/sack-weight/date-received), fixing the original "a pile can
have two real sack weights" bug. Reports.jsx needed no changes, as
predicted.

Same session also worked through a large follow-up feedback batch:
- Zero-value cereal/variety rows now hidden from HomeStocks.jsx/
  AdminHomeStocks.jsx instead of lingering as empty cards.
- New "unwithdrawn stock" feature (src/utils/unwithdrawnStock.js): per
  warehouse per variety, shows how much AI-authorized stock hasn't
  actually been withdrawn yet (WSI/WTS), so live bags don't overstate
  what's really available. Shown as a small badge next to the bags total
  (HomeStocks + AdminHomeStocks); tapping it opens
  UnwithdrawnDetailModal.jsx, a modal breaking down every contributing
  AI and its WSI/WTS documents, all in net bags. Currently AI/WSI/WTS
  only - SIA/ESI tracks pieces, a different unit, deliberately out of
  scope for this figure.
- AdminMonitoring.jsx: tab bar + search + regional-authority selector
  merged into one sticky block (was two separately-offset sticky
  elements, cramped and dropping the authority selector off-screen).
- AdminHomeStocks.jsx: Stock Breakdown and Stock Age Grouping split into
  their own tabs instead of one long page.
- pileBinCardGenerator.js: BIN card "Transaction" column was reading a
  nonexistent `t.transactionTypeName` field (always fell back to literal
  "Receipt"/"Issuance") - now resolves the real transactionTypeId ->
  name (Procurement, Milling, Sales, etc) via a map threaded in from all
  three callers (BeginningBalancesPanel.jsx, Piles.jsx, Settings.jsx).
- customerDirectory.js: WS/MPO suggestion addresses now prefixed with
  the warehouse's own name/GID. Also found and fixed a real race in
  CustomerNameAutocomplete.jsx - selecting a WS/MPO suggestion could get
  its address immediately overwritten by a second `findCustomerByName`
  lookup matching a stale db.customers record saved under the same name;
  fixed by only running that lookup once WS/MPO suggestions are ruled
  out. The MPO_PREFIX_PATTERN regex also didn't strip "III" from its own
  generated label ("MPO III Name"), which silently broke this guard for
  MPO specifically even after the WS fix landed - both now fixed.
- MillingMonitor.jsx: detail modal recolored to the app's standard
  Palay/Rice/By-Products palette, split into Stocks/Sacks tabs (each
  grouped Issued/Received -> category), Sacks tab no longer shows a
  blank Variety field (sacks have no variety - shows sack type +
  condition instead).
- Root-caused the "save/delete freezes for up to 3 minutes" bug:
  googleSheetsBridge.js's fetch() calls to the Apps Script backend had
  no timeout and could hang indefinitely holding the connection open;
  postToSheetsWithRetry compounded this over 3 attempts. Added a shared
  fetchWithTimeout wrapper (8s cap) used by every fetch in that file, and
  made the "mark milling order done" side-effect calls in
  StockFormBase.jsx/SackFormBase.jsx fire-and-forget instead of blocking
  the success toast, matching the pattern already used for deletes.
  Dexie Cloud sync itself was already correctly local-first
  (requireAuth: false) - it was never the actual bottleneck.

STILL OPEN from the prior session, unrelated to the above and not
re-investigated this session:
- The -355 bags PD1-A (0.095) persistent balance for warehouse CTD-GID 2
  - user has not yet confirmed whether that warehouse's Settings >
    Warehouses > Reports Start Date field is actually populated.
- User is doing all testing themselves (explicit instruction this
  session) - none of the above has been manually verified in the running
  app beyond `npm run build` passing after every change.

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

1. MOSTLY DONE - the fallback's blind spot (deleted/renamed sack type,
   or removed weight config) is fixed - always reconstructs a
   displayable option now instead of going blank. NEEDS LIVE
   VERIFICATION to confirm this was the actual trigger for the
   originally reported case. See activity-log.md.

2. DONE - preload architecture pulls Sheet-only historical data into
   the local database automatically. See activity-log.md.

3. DONE - upsertAuthority (AI) had a real gap: only ever updated the
   FIRST matching record via .first(), silently leaving any other
   duplicate untouched forever. upsertSiaAuthority already had proper
   cleanup logic; AI now matches it - finds every record sharing the
   number, prefers the one with actual issued progress as canonical,
   deletes the rest. See activity-log.md.

4. DONE - Pending AI list restriction by variety removed; pile resets
   on AI selection if its variety differs. See activity-log.md.

5. DONE - Rice/Palay/By Products tabs built, each with its own
   independent serial series (serialCounters re-keyed). WSR's
   floor/EOF specifically left as a known, deferred issue per user's
   own explicit decision. See activity-log.md.

6. DONE - both StockFormBase and SackFormBase's hard-limit errors now
   explicitly state which constraint is binding. See activity-log.md.

7. CORRECTED and NOW ACTUALLY FIXED - my earlier "already done" claim
   was wrong; I had only checked that the code CALLED
   setLinkedAuthorityDate, not that the state was ever declared. It
   was not - linkedAuthorityDate was referenced via
   setLinkedAuthorityDate in two places in SackFormBase.jsx but never
   declared with useState anywhere in the file, causing a
   ReferenceError that crashed handleSelectAuthority immediately after
   setting the SIA number - meaning customerName, transactionType, and
   sackLines never ran at all. This exactly matches the original
   report (SIA number appears, nothing else fills in). Declared the
   missing state, added it to the reset flow, and also fixed a related
   gap: the home-page Authority Monitor tap flow (window.
   openTransactionForm prefill path) never passed authorityDate for
   SIA at all (unlike the AI branch), and SackFormBase's prefill
   consumer never read it even when present - both fixed. See
   activity-log.md.

8. DONE, BUT NEEDS CONFIRMATION - added a 0.01 overage tolerance to
   calculateAuthorityStatus. The original wording is genuinely
   ambiguous (see activity-log.md for the exact concern) - please
   confirm this interpretation is correct.

9. MOSTLY DONE - (a) client now sends both AGE (raw value) and a new
   'Age Unit' field on every WSR/WSI sync; (b) confirmed the Apps
   Script's row-writing is already fully generic (matches by whatever
   headers exist in the sheet) - NO script redeployment needed, just
   ACTION REQUIRED: add an "Age Unit" column header to the relevant
   Sheet(s) manually for this to actually take effect; (c) one-time
   backfill of already-recorded historical age data into existing
   Sheet rows NOT yet built - deferred, this fix only covers new/future
   syncs going forward. See activity-log.md.

**HIGH PRIORITY (real workflow/UX bugs, not silently corrupting data
but actively blocking or confusing real usage):**

10. DONE - optional OR# field added to StockFormBase for Sales-type
    transactions, saved on the record, and shown in reports (appended
    to the customer name cell rather than a new column, to avoid
    disrupting the report's existing fixed-column layout, which likely
    matches an official paper form). See activity-log.md.

11. DONE - orNumber was already being synced from the AI/SIA sheet
    (used elsewhere for the Sales OR# field), but nothing read it back
    for Milling/Test Milling pile assignment. Added pile auto-selection
    from the authority's own orNumber (matched by pile name,
    case-insensitive) in both entry points: the in-form Authority
    Picker (handleSelectAuthority) and the home-page monitor tap-to-add
    flow (prefill, async-safe against piles still loading). See
    activity-log.md.

12. DONE - all 4 new roles added to ROLES. Every existing exact-match
    role lookup that would have made an "Acting" user invisible to
    permission/signatory checks was found and updated to recognize
    both the base and Acting variant. See activity-log.md.

13. DONE - StockFormBase's in-form AI balance text now also shows net
    bags alongside kilos. AuthorityMonitor already showed both. See
    activity-log.md.

14. PARTIALLY DONE - reviewed handleConfirmAssign thoroughly; the
    save logic itself looks structurally correct on static review, and
    could not definitively reproduce the reported bug without live
    access. Added try/catch with visible error feedback (previously
    any failure here failed completely silently, matching the reported
    symptom) - if this still happens, the actual error should now be
    visible via a toast + console message. NEEDS LIVE VERIFICATION to
    confirm whether this was the trigger or whether further
    investigation is still needed.

15. FULLY DONE - found a third location on closer check: the exported
    Pile Layout PDF (pileLayoutPdfGenerator.js) also shows this field
    and has been fixed the same way. All three locations now correct.
    See activity-log.md.

16. DONE, PLUS a fullscreen landscape mode added per follow-up
    clarification - since the layout is inherently landscape-shaped,
    rather than only ever shrinking it to fit a portrait screen, a
    "Fullscreen View" button now rotates the grid 90 degrees to fill
    the screen at full size, like a video going fullscreen-landscape
    on a portrait phone. Read-only tap-for-details, with a back
    button. NEEDS LIVE VISUAL VERIFICATION - the CSS rotation technique
    used is a well-established pattern but could not be visually
    tested without live device access. See activity-log.md.

17. DONE - form title enlarged. See activity-log.md.

18. DONE (revised per user clarification) - tracked per (sack type,
    condition) combination via each Procurement WSR's own MTS Sack
    Type/Condition field, matched against Procurement-tagged ESI
    issuance of the same sack type/condition/piece count. See
    activity-log.md.

19. DONE - new CustomersPanel admin tab built (search, edit, delete),
    following the same pattern as VarietyTypesPanel. See
    activity-log.md.

20. DONE - Milling/Test Milling fully built across many sessions:
    schema, read-only MO/TMO sheet sync with a narrow DONE auto-write
    exception, picker UI (stock AND sacks), Trial 3 confirmation,
    Regional Authority Number tracking, NFA Ricemill + private miller
    allocations, wet/dry palay tracking. NEEDS LIVE VERIFICATION
    against the real Google Sheet before full trust - see
    activity-log.md for complete detail. Original text below for
    reference:

    Test Milling transactions need a Trial selector (Trial 1/2/3) that
    prevents duplicate trial entries - once Trial 1 has data, only
    Trial 2 and 3 should remain selectable, etc. Each Test Milling also
    has its own Test Milling Order (TMO) number, sourced from a sheet
    named "TMO" - can be clarified/refined later.

21. DONE - see item 20, this is part of the same built feature.

22. DONE - see item 20, this is part of the same built feature.
    NFA-owned Ricemills/Mechanical Dryers are represented via a
    separate mechanism (Regional Authority Number allocations, and
    wet/dry palay tracking respectively), not the same MO/TMO monitor,
    since they explicitly do not use MO/TMO numbers at all.

**LOWER PRIORITY / POLISH (can wait, but keep in the backlog):**

23. DONE - every remaining native date input replaced across the app,
    including SheetSourcesPanel. Also fixed a real overflow bug found
    in the process (CalendarDatePicker now rendered via portal). See
    activity-log.md.

24. DONE - all fixes applied, plus By Products added to the card
    (was entirely missing before). See activity-log.md.

25. DONE - branch total row added below the province table, Rice +
    Palay only. See activity-log.md.

26. DONE - found a real related gap while re-checking: the earlier
    safe-area fix made the bottom nav itself taller on devices with
    curved corners/home indicators, but every page's own bottom padding
    (pb-24) never accounted for that extra height, so the last bit of
    content could still get obscured on exactly those devices. Fixed
    across all 7 pages using this padding pattern. See activity-log.md.

27. DONE - full sweep completed. Found and fixed real gaps in 8 files
    where By Products silently fell back to Rice's blue instead of its
    own color, including the pile layout grid boxes themselves
    (AuthorityMonitor, CompletedAuthorityModal, AuthorityPickerModal,
    AdminMonitoring, AuthoritiesInfoPanel, AdminHomeStocks,
    HomeStocks, Piles.jsx). See activity-log.md.

28. DONE - broader sweep completed. Found and fixed one genuine
    small standalone button (Piles.jsx popup close, 24px), and bumped
    the shared removeButtonClass (used across multiple forms' remove-
    row buttons) for a modest improvement. Investigated several other
    candidates and confirmed they were false positives (already
    adequately sized via flex-stretch or wrapped in larger effective
    tap targets) rather than making unnecessary changes. See
    activity-log.md.
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
- DEV ENVIRONMENT: `npm run dev` (plain Vite) does NOT serve
  api/dexie-cloud-tokens.js (a Vercel serverless function) - causes a 404
  there and a Dexie Cloud login failure. Use `npx vercel dev` instead
  (project already linked via .vercel/). First run of vercel dev may also
  hit a CORS error from the Dexie Cloud sync endpoint if the dev port
  (vercel dev defaults to 3000, different from Vite's own 5173) isn't on
  the database's allowed-origins list - fix with
  `npx dexie-cloud whitelist http://localhost:3000` from the repo root.
  This project's Dexie Cloud database has no separate dev/staging
  instance - both `vercel dev` and `npm run dev` sync against the real
  production database, not a sandbox.
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
