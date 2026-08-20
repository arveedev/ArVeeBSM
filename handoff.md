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

### OPEN (2026-08-17 session, round 36) - CRITICAL: fixed the actual cause of reappearing duplicate transactions with blank Pile ID/MC/MTS - NOT YET COMMITTED/PUSHED

Root cause: `checkAndLoadSerial`'s local lookup is scoped by
`cerealCategory` for WSR/WSI - a record whose category was ever
mismatched or missing became permanently invisible to it, a false "not
found locally" that led into importing a SECOND copy from the Sheet.
The Sheet's backup schema has no Pile ID/MC/MTS columns at all, so
every such duplicate arrives missing exactly those fields - matching
what the user saw exactly (a duplicate WSR with blank Pile
ID/MC/MTS, edit form loading the blank copy). `findAdjacentTransaction`
had the same vulnerability on its own "current" lookup - plausibly why
navigation got stuck in the first place. Both now fall back to an
uncategorized lookup before concluding "not found," self-healing the
mismatch in place. Bumped `transactionPreload.js`'s dedup-merge
migration (v6 -> v7) to clean up duplicates already created by this on
affected devices. Not yet confirmed by the user - the migration runs
automatically on next load.

### OPEN (2026-08-17 session, round 35) - fixed round 34's own forward-navigation regression - PUSHED

User tested round 34 and found forward serial-stepping could get stuck
on data that genuinely existed (and, described differently, reported
August transactions appearing "missing" - same root cause, not actual
data loss - verified `resetToBlankEntry` is pure UI state with zero
delete calls). Root cause: `findAdjacentTransaction` only knows about
transactions already synced to THIS device; round 34's
`handleStepForward` jumped straight to `suggestNextSerial` (a blank
"create new" suggestion) when it found nothing locally, skipping the
Sheet lookup `checkAndLoadSerial` still does - dead-ending on real
historical data that just hadn't locally preloaded yet. Backward
stepping was unaffected (its fallback already preserved that Sheet
lookup). Fixed: forward now tries the plain numeric-guess fallback
first (restoring the Sheet lookup), only reaching `suggestNextSerial`
if nothing is found locally OR on the Sheet. User advised to check
Reports (unaffected by this bug) to confirm their data before doing
anything else - not yet confirmed.

### OPEN (2026-08-17 session, round 34) - date-aware serial number suggestion and navigation - PUSHED

Two real, reported bugs, both stemming from serial suggestion/
navigation being purely numeric-magnitude-based with no concept of
which document booklet was actually in current use: (1) a new booklet
starting at a LOWER number than an already-recorded older booklet
never got suggested as "next" - the older, numerically-higher booklet
kept winning every session, forcing a manual retype. (2) Stepping
forward past the last document of an exhausted booklet (new booklet
starting at a different number, same day) guessed `serial + 1`, found
nothing, and dead-ended instead of loading the real next document.

Fixed via a new `compareByRecency` rule in `serialNumber.js` (document
`date` first, then a new `createdAt` timestamp for same-day
disambiguation, falling back to numeric magnitude only for pre-fix
historical data with no `createdAt`) - rewired `suggestNextSerial`,
`recordSerialUsed` (now always overwrites its cache with the
just-saved serial, not only when numerically higher), and
`recalculateSerialCounter` to use it, and added
`findAdjacentTransaction` to walk the REAL sorted sequence for
Next/Previous navigation instead of guessing ±1. All three transaction
forms (`StockFormBase.jsx`, `SackFormBase.jsx`, `WTSForm.jsx`) now
stamp `createdAt: Date.now()` on new transactions and use the new
logic for stepping/post-save advance. Traced both reported scenarios
by hand against the new logic to confirm correctness (see the
session's plan file). Not exercised against live data this session.

### OPEN (2026-08-17 session, round 33) - CRITICAL: Google Sheets backup duplicate-row bug fixed - PUSHED, CONFIRMED REDEPLOYED BY USER

User reported a severe data-integrity regression: backup Sheets
accumulating 3-12+ duplicate rows per transaction, plus sync lag and
missing/delayed entries. Root cause: Apps Script's `appendTransaction`
(`doPost` in `docs/apps-script-full-replacement.js`) did a blind,
unconditional `appendRow` with no check for an existing row with that
serial, and no lock protected concurrent requests - so any retry (lost
response, WTS two-sided partial failure, two devices racing the same
not-yet-synced transaction) wrote another duplicate row forever.
Fixed: `appendTransaction` now overwrites an existing row for that
serial instead of re-appending (idempotent), and the whole `doPost` is
wrapped in `LockService.getScriptLock()` so concurrent requests can't
race each other. Also added a 30s periodic safety-net retry to the
client push queue (`syncWorker.js`'s `startSyncWorker`), which
previously had no periodic retry at all - only on save/reconnect -
explaining the reported lag.

**ACTION REQUIRED BEYOND THIS REPO**: `docs/apps-script-full-replacement.js`
is a reference copy - this fix does NOT take effect in production until
the user copies its updated content into the real Apps Script project
(Extensions > Apps Script in the spreadsheet) and redeploys the Web
App. Flag this prominently every time this file is touched until
confirmed redeployed.

### OPEN (2026-08-17 session, round 32) - needsCompletion never cleared on save, unchecked auto-advance after save, OR # not filling from the AI picker - PUSHED, not yet confirmed by user

Three real bugs from a live ESR editing session:
1. **needsCompletion never cleared.** A historical-Sheet-imported
   record's `needsCompletion: true` flag (drives the amber "pulled
   from historical Sheet data" banner) was never cleared by either
   input form's save/update path - stayed true forever even after the
   real data was filled in and saved, so the banner kept reappearing.
   Both `StockFormBase.jsx` and `SackFormBase.jsx` now clear it on
   every active save, and set it false on cancel too.
2. **Auto-advance after Save skipped the existing-record check.**
   `performSave`'s post-save jump to the next serial called
   `resetToBlankEntry` unconditionally, unlike `handleStepForward`
   which already checks first - landing on a serial that already had
   real data (local or historical Sheet) showed it as blank, inviting
   an accidental overwrite/duplicate. Both forms now check first.
3. **OR # not auto-filling from the in-form AI picker.**
   `handleSelectAuthority` had no `else` branch for non-Milling
   authorities (SALES in particular) - only the Monitor-page prefill
   path filled OR #, not picking an authority directly in the form.
   Added the missing branch.

`src/components/forms/StockFormBase.jsx`,
`src/components/forms/SackFormBase.jsx`, `src/version.js` (bumped to
`1.9-5`, also caught up a missed `1.9-4` entry). Build passes, not
yet confirmed live.

### OPEN (2026-08-17 session, round 31) - "by ArVee"/version still invisible on mobile after round 30's fix - was absolute, needed fixed - PUSHED, not yet confirmed by user

Round 30 combined the two lines into one block but kept
`position: absolute` - still not visible on a real phone, because
Login's outer `min-h-screen` container can genuinely be taller than
the visible viewport once real device content (safe-area insets,
browser chrome, 4-row keypad) is accounted for, and `absolute` pins
to the bottom of THAT container, not the screen. Switched to
`position: fixed`, which pins to the actual viewport regardless of
how tall the content above it grows. `src/pages/Login.jsx`. Build
passes, not yet confirmed live.

### OPEN (2026-08-17 session, round 30) - version label caught up + moved on Login, "Issue from another pile" repositioned - PUSHED, not yet confirmed by user

`APP_VERSION` (`src/version.js`) hadn't been bumped through rounds
27-29 (MO/TMO Monitor fixes, By Products pile creation/picker fixes,
always-enabled auto-compute, the whole multi-pile WSI feature and its
follow-ups) - caught the history up through all of it and bumped to
`1.9-3`. Login page's "by ArVee" and version text were two
independently-positioned lines (bottom-14/bottom-6) that couldn't
both fit on a short viewport - combined into one tight block at
bottom-8. Moved "Issue from another pile" (and the extra pile cards
it reveals) on the WSI form from right after Pile ID/Variety Type to
right after the primary pile's own Net Kilos field, before Age, per
explicit request. `src/version.js`, `src/pages/Login.jsx`,
`src/components/forms/StockFormBase.jsx`. Build passes, not yet
confirmed live.

### OPEN (2026-08-17 session, round 29) - additional-pile small-screen layout, Reports duplicate-serial root cause, age-load fallback - PUSHED, not yet confirmed by user

Four items reported together while live-testing PR #20/#21's
multi-pile work:

1. **Additional-pile card MC%/MTS row on small screens** - was
   `grid-cols-2`; the MTS label wraps to two lines in the nested
   card's narrower width, pushing the select out of alignment with
   the MC input. Stacked the row instead. `StockFormBase.jsx`.
2. **Duplicate rows on Reports** - confirmed (user checked) these are
   two genuinely separate DB records sharing the same serial, not a
   display bug. Root cause: `preloadTransactionsForUser` had no guard
   against overlapping runs - the 30s sync interval and the `online`
   event listener could both fire mid-run, and two overlapping passes
   each independently import the same not-yet-local Sheet row with a
   fresh id. Fixed with a single-flight guard
   (`inFlightPreload`) in `transactionPreload.js`, plus bumped the
   existing consolidated dedup migration to v6 to clean up whatever
   already accumulated. This is the SAME class of bug the v2/v4/v5
   migrations were already mopping up after the fact - v6 should be
   the last time it's needed, now that the actual race is closed.
3. **Age not auto-filling on an existing record** - `loadTransactionIntoForm`
   had no `else` when `tx.ageUnit === 'Months + Days'` but
   `tx.initialAgeValue` was null, leaving Months/Days at 0 (or worse,
   stale from a previously loaded record). Now falls back to
   `tx.ageValue` (same total-days figure) and always resets both
   fields on every load. `StockFormBase.jsx`.
4. **Auto-compute toggle off on an existing record - NOT a bug.**
   Verified every `autoComputeNet` write site - the only ways it
   becomes false are the user's own toggle, or loading a stored
   `false`. `googleSheetsBridge.js`'s Sheet-import mapper deliberately
   sets `autoComputeNet: false` on every backfilled historical record,
   on purpose, to preserve the net kilos actually on file rather than
   silently recomputing a different number. The flagged record (144
   bags / 7,210.8 gross / 7,200 net - not what gross-minus-tare would
   give) is almost certainly one of these imports. New entries created
   in-app still always default to enabled. No code change.

`npm run build` passes on all of the above. Needs the user to confirm
against the live deploy - especially #2, which won't visibly resolve
existing duplicates until the v6 migration runs once on each device
(automatic, on next login/sync).

### SELF-CAUGHT BUG (2026-08-17 session, round 28) - production crash on "Issue from another pile" (TDZ ReferenceError) - fixed, not yet confirmed by user

PR #20 (round 27's multi-pile void/unvoid + field-parity work) shipped
a `ReferenceError: Cannot access '_n' before initialization` crash on
the live WSI form: clicking "Issue from another pile" threw
immediately, caught by `[SectionErrorBoundary: WSI form]`. Root cause:
`computeAllocFields` was declared as a `const` AFTER
`extraAllocInfos`, which calls it - `const` isn't hoisted, so this
throws the moment `extraPileAllocations` first gets a row (exactly
the "Issue from another pile" repro). Invisible in `npm run build`,
which only catches syntax errors, not this kind of runtime ordering
bug. Fix: moved `computeAllocFields`'s definition up, directly before
`extraAllocInfos`. Pure reordering, no behavior change.
`src/components/forms/StockFormBase.jsx`. Build passes; PR opened and
merged this round - needs the user to re-test "Issue from another
pile" live.

**2026-08-17 status check (user-confirmed):** the user confirmed the
following, previously flagged as open/unverified below, are now
actually done - kept in place for historical reasoning but should be
read as CLOSED, not open: round 26's sack-weight/report fix (verified
against real data); the MO 151 "wrongly shows Completed" investigation
(round 11/12); every full-screen pile-layout mobile/device
verification across rounds 9-25 (confirmed working on an actual
phone); both `docs/apps-script-full-replacement.js` redeploys called
out in rounds 12 and 14 (STATUS write-back clear-on-revert, and the
Date of Milling sort field); the Mock Data section's "no signup/
bootstrap flow for a fresh database" gap; and the Live Google Sheets
Integration section's adaptive (foreground/background) polling
backoff. None of these needed a code change from this session - the
user verified them directly. Round 27 below (MO/TMO sort + missing
numbers) is the only genuinely open item as of this pass.

### OPEN (2026-08-17 session, round 27) - MO/TMO pending list sort fixed; MO/TMO numbers wrongly hidden from Monitor; uncheck-complete self-lockout fixed - PR #1 MERGED TO MAIN AND DEPLOYED, user has confirmed the missing-TMO fix works live; a second, different picker still needs a user check

User reported two MO/TMO monitor problems: not sorted by MO/TMO number,
and specific MO/TMO numbers that exist on the live Sheet never show up
in the app (checked both pending and Completed), surviving both a
Milling Operations re-sync and a Sheet Sources re-sync.

**IMPORTANT PROCESS NOTE**: the first two fixes below initially
appeared "not to work" when the user tested them - not because the
fixes were wrong, but because `main` was 2 commits behind this
session's branch and nothing had actually been merged/deployed yet.
Confirmed via `git log origin/main` vs the branch, opened PR #1, user
confirmed Vercel auto-deploys from `main`, merged it (squash). Lesson
for future rounds: a user reporting "still broken" right after a fix
should prompt checking whether the fix actually reached them before
re-investigating the same code again.

**Sort - fixed, merged, deployed.** `MillingMonitor.jsx`'s pending list
(`filtered`) was filtered but never actually sorted - order came from
whatever Dexie's IndexedDB cursor happened to return, not MO/TMO
number. Sorted via `order.number.localeCompare(...)`, `numeric: true`;
user explicitly wants descending, so `b.number.localeCompare(a.number,
...)` (Completed's own separate newest-activity-first sort from round
14 is correct as designed, untouched).

**Missing numbers - root cause found and fixed.** User confirmed the
missing number DID appear in the sync console log (ruling out both
candidates originally logged here - no merged cells either, user
confirmed every Sheet row is the same consistent format) - meaning it
reached `db.millingOrders` fine and something client-side was hiding
it. Found it: `passesSharedFilters` (gates BOTH the pending and
Completed arrays) excluded any order whose local transaction history
existed but was entirely dated before the earliest configured Sheet
Source's Date From - so a real, still-relevant order could vanish from
the Monitor completely, not just from some total. Same class of bug as
round 8's authority-cutoff work, but that one got it right (excludes
pre-cutoff data from the unwithdrawn/potential MATH only, never hides
the record from AuthorityMonitor's own lists) and this one didn't -
user called this out directly ("the pending list and completed is
there for a reason, why does the app hide data that is supposed to be
on that list?"), correctly. Fixed by deleting the
`earliestSourceDateFrom` computation and its check entirely (confirmed
via grep it had no other use - `passesSharedFilters` now only applies
the Regional Authority Number dropdown filter).

**Void/Unvoid multi-pile support (Option A), full field parity for
extra piles, plain-language over-limit message - fixed, not yet
confirmed by user.** Per explicit request: Option A for the flagged
void/unvoid gap (each extra pile becomes its own Cancelled record when
voiding, mirroring the primary - `handleConfirmVoid` now uses
`reverseGroupEffect` then loops `originalExtraAllocations` converting
each to its own Cancelled record; `handleConfirmUnvoid` deletes every
extra's Cancelled record alongside the primary's). Plus three more
gaps found while actually using the additional-pile UI:
1. **Missing fields** - an extra pile allocation was just `{ pileId,
   bags, kilos }`, with MC/MTS/autoComputeNet never asked for at all
   (silently `null` on every extra's saved record, only ever
   inheriting the PRIMARY's values via a spread the user never saw).
   `emptyExtraAllocation()` now matches a real transaction's actual
   field set. New shared `computeAllocFields(alloc)` - same MTS-tare
   math the primary's fields already use - used by both `performSave`
   and `handleUpdate` so they can't compute a saved record's fields
   differently. `loadTransactionIntoForm`'s sibling reconstruction
   populates all the new fields.
2. **No stock validation on extras at all** - new `extraAllocInfos`
   derived array (per-line `availableKilos`/`overKilos`/
   `avgWeightPerBag`, scoped to THAT line's own pile) - `canSave` now
   requires each started line to be genuinely complete and not exceed
   its own pile's stock, previously a real, separate gap (an extra
   pile's kilos had zero validation against real availability - could
   silently save over-limit with no warning).
3. **No labels** - full JSX rewrite of the additional-pile card, every
   field now labeled (Pile, MC %, MTS, Number of Bags, Gross Kilos,
   Net Kilos) matching the primary's own layout, plus an "Available on
   {pile}" hint and the Auto-compute toggle.

Also reworded the hard-limit message (both the primary pile's Net
Kilos field and every extra pile's) from "Cannot exceed available Net
Kilos (X) — this is a hard limit" to "{PileName} only has {X} - add
another pile to complete the transaction," per explicit wording
request.

**SELF-CAUGHT BUG: the multi-pile reload fix from two rounds ago never
actually worked - fixed, not yet confirmed by user.** User tested and
found the multi-pile view now missing entirely on the base serial -
this was a bug in an EARLIER fix this session, not something new.
`loadTransactionIntoForm` queried
`db.transactions.where('groupSerialNo').equals(...)`, but
`groupSerialNo` was never added as an indexed field anywhere in
`db/dexie.js` (confirmed via grep, zero matches in any version). Dexie
throws on `.where()` against a non-indexed keyPath, and that throw was
silently swallowed by an empty `.catch(() => {})` - so the sibling
lookup failed on every single call from the moment it shipped, with no
visible error anywhere. Same "log it, don't swallow it" lesson this
codebase already learned once before (Known Issues'
syncMillingOrdersFromSheets entry). Fixed by querying off `type`
(indexed) with `.and()` filtering the rest, and replaced the silent
catch with `console.error`.

User then asked to proceed with full edit/update support for the
multi-pile allocations - DONE. New `originalExtraAllocations` state
(snapshot of each real sibling exactly as loaded - `{ id, serialNo,
pileId, numberOfBags, netKilos }` - separate from `extraPileAllocations`
itself, which mutates live as the user edits). New shared
`reverseGroupEffect(primary)` helper reverses the primary's AND every
original extra's pile effect, then reverses the GROUP's combined old
bags/kilos from the authority balance in one call - fixes the bug
above, used by both `handleUpdate` and `handleDeleteConfirmed`.
`handleUpdate` reconciles `extraPileAllocations` against
`originalExtraAllocations` by `txId`: a retained line updates its own
record in place (keeps its existing serialNo - avoids unnecessary
Sheet-backup churn), a line with no `txId` is new this edit and gets
the next unused letter suffix, a removed original gets deleted
(`queueTransactionDeletion` fired). Primary's `groupSerialNo` is set/
cleared based on whether any valid extras remain, so a transaction can
transition single-pile <-> multi-pile cleanly. Finishes via
`loadTransactionIntoForm(updated)` (fresh sibling re-fetch) rather than
a bare `setLoadedTransaction`, so a second edit in the same session
reconciles correctly. `handleDeleteConfirmed` now deletes the WHOLE
group, not just the primary - avoids orphaning extras with a
non-existent primary while their share stays silently stuck in pile
totals and the authority balance. The extra-pile JSX inputs are
interactive again (previous round's read-only lock removed).

Deliberately NOT touched, flagged as a known related gap:
`handleConfirmVoid`/`handleConfirmUnvoid` have the identical
"primary-only" flaw, but voiding a multi-pile group raises its own
design question (should extras become their own Cancelled records
mirroring the primary?) that wasn't part of this round's actual ask -
scoped out rather than guessed at.

Traced through several scenarios by hand before shipping (unchanged
extras, removing the only extra, adding a new extra, moving an extra
to a different pile) given the stakes - live production data, pile
ledger + authority balance math. Not yet verified against the user's
real data.

**Multi-pile `-A` sibling rows fixed on two fronts - both belt and
suspenders now, not yet confirmed by user.** Went through a revert-
then-restore this session: a round added `combineMultiPileGroups` to
`Reports.jsx` (groups multi-pile siblings into one on-screen row,
mirroring how `pdfGenerator.js` already combines them for the PDF
export - that file itself was never touched). User initially pushed
back thinking this meant the PDF export was being changed - it wasn't
- so it got reverted and root-fixed only inside `StockFormBase.jsx`'s
`checkAndLoadSerial` instead (redirects a `-A` lookup, however
reached, to the group's real primary record and corrects the Serial
No. field to match). User then re-read both files, confirmed the
Reports.jsx grouping was correct and wanted after all, and it was
restored. Current, correct, final state: BOTH fixes are in place
together - `Reports.jsx`'s grouping stops a `-A` row from ever
appearing there in the first place, and `StockFormBase.jsx`'s redirect
is the backstop for a `-A` serial typed directly into the Serial No.
field, a path Reports grouping alone can't cover.

**Real bug fixed: multi-pile WSI issuances never reloaded their other
piles - fixed, not yet confirmed by user.** User-reported: tapping an
existing multi-pile transaction from Reports, or stepping back to its
serial on the input form, only ever showed one pile. Root cause: a
multi-pile WSI saves each additional pile as its own sibling
transaction (same `groupSerialNo`, base serial + letter suffix), but
`loadTransactionIntoForm` never looked those up - reopening the
PRIMARY record (the natural entry point either way) silently dropped
every other pile from view. Not data loss - the siblings were always
intact in the DB, purely a reload gap. Fixed: `loadTransactionIntoForm`
now queries siblings by `groupSerialNo` (excluding itself) and
repopulates `extraPileAllocations` from them, fire-and-forget async,
same pattern as the existing Sheet-backfill fetch.

Also found and deliberately NOT fixed in the same pass: the extra-pile
inputs are always editable, but `handleUpdate` has never touched
`extraPileAllocations` at all - only the primary record saves on
Update. With extras visible again, that's now a real footgun (edit an
extra pile, tap Update, get an "updated" toast, edit silently
discarded) - locked those fields read-only specifically when reviewing
an existing transaction, with an inline note explaining why. Actually
wiring up Update for extras is a separate follow-up - surfaced a
related pre-existing bug along the way: `handleUpdate`'s authority
reversal/reapply only ever accounts for the primary record's own
bags/kilos, never the extras' combined share from the original save,
so ANY update to a multi-pile transaction's primary (even an unrelated
field) silently drops the extras' share from the authority's running
issued total. Flagged to the user, not attempted blind.

**Auto-compute Net Kilos never switched off automatically anymore,
only by the user's own toggle tap - fixed, not yet confirmed by
user.** Per explicit request. Two places in `StockFormBase.jsx`
(WSR/WSI) silently switched it off without the user touching the
toggle: (1) `handleSelectAuthority` (the "Browse" AI picker) - forced
`manualNetKilos` to the authority's exact remaining balance AND
switched auto-compute off; now only seeds `manualNetKilos` (ready if
the user switches to manual entry themselves), auto-compute stays on.
(2) The `prefill.autoComputeNet === false` handling, whose only real
caller (`AuthorityMonitor.jsx`'s "open WSI from a pending AI") sent it
unconditionally - removed from both the consumer (now genuinely dead)
and the sender. `prefill`/`manualNetKilos`'s remaining-kilos seed value
is still sent/set either way. Checked every other
`openTransactionForm('WSI', ...)` caller (`AuthoritiesInfoPanel.jsx` -
already doesn't touch it) and `loadTransactionIntoForm`'s own handling
(loading an EXISTING transaction's real saved state - deliberately
untouched, that's not a "new transaction default" question).
`SackFormBase.jsx` has no Net Kilos concept; `WTSForm.jsx` computes it
automatically with no manual-override toggle at all - nothing to
change in either.

**Real bug fixed: By Products Pile ID picker was silently excluding
valid piles - fixed, not yet confirmed by user.** User-reported, framed
as "variety doesn't reset per transaction." Actual cause:
`StockFormBase.jsx`'s `sortedPiles` filters by `pileFilterVarietyId`
(set from whichever AI/SIA authority's own varietyId was selected),
requiring an exact `p.varietyId === pileFilterVarietyId` match -
correct for Rice/Palay, but a By Products pile's own varietyId is now
often blank (the earlier variety-optional change) or just one of
several varieties it actually holds, so this silently excluded valid
piles, sometimes all of them. Not literally a stale-state bug -
`resetToBlankEntry` already clears `pileFilterVarietyId` between
transactions - the filter just assumed a per-pile invariant that no
longer holds for By Products. Fixed by skipping it entirely when
`activeCategory === 'By Products'`; also hid the now-inapplicable
"Showing only piles matching the linked authority's variety" hint in
that case. Checked `WTSForm.jsx` (no equivalent pre-filter, always
lists every pile) and `SackFormBase.jsx` (no Pile ID picker at all) -
nothing to fix in either.

**By Products beginning balance goes per-variety (Settings' Create Pile
tab and BeginningBalancesPanel's edit view); NewPileDialog gets a
genuine Age requirement - fixed, not yet confirmed by user.** Per
explicit request, three different behaviors across the three pile-data
surfaces:
1. `Settings.jsx`'s Create Pile tab, By Products only: one row per
   configured By Products variety (fixed set, not addable/removable),
   each with its own optional Bags/Kilos (`byProductBalances` state).
   `handleCreate`'s By Products branch creates the bare pile, then adds
   one `isInitialBalance` seed transaction per non-empty line, then
   `recalculatePileCurrentState` to re-derive totals from the real
   ledger.
2. `BeginningBalancesPanel.jsx`'s Piles tab (editing an EXISTING pile):
   its repeatable-line UI already supported multiple seed transactions
   per pile, but every line shared one pile-level variety - added a
   per-line Variety `<select>`, shown only for By Products piles.
   `emptyLine()`/`handleEdit`/`handleSave` all updated so each line's
   own varietyId is read, edited, and actually persisted (previously
   silently ignored, always fell back to the pile's own varietyId).
   Also fixed `editingCategory` - was derived via
   `varietyMap.get(pile.varietyId)?.category`, which breaks for any
   pile with a blank varietyId (now possible for By Products) -
   switched to `pile.cerealType` directly. This surfaced a real
   pre-existing bug: `sackTypesForCategory` filtered by exact category
   match, but sack types have no 'By Products' category of their own -
   was silently showing zero sack-weight options for every By Products
   pile. Fixed to match NewPileDialog.jsx's own existing pattern.
3. `NewPileDialog.jsx` ("+ New Pile" from a transaction) stays simple,
   deliberately NOT given the per-variety lines - Age is now a genuine
   requirement there instead (amber border + blocking toast), matching
   Pile Name; previously it silently defaulted to 0 with no
   validation. Condition needs no check, always has a value by
   construction.

**By Products pile creation no longer requires a Variety; new piles
default Age to 1 day - fixed, not yet confirmed by user.** Per
explicit request, in both places a pile can be created
(`NewPileDialog.jsx`'s "+ New Pile", and `Settings.jsx`'s
`PileBalanceSection` Create/Edit Pile panel): (1) `handleCreate` in
both files no longer requires a variety when category is By Products
(a By Products pile already accepts any mix of By Products varieties
over its lifetime, per existing design) - only Rice/Palay still
require one. Variety field UI updated to match: "(optional)" label,
"Optional — accepts any" placeholder, amber "required" border only for
Rice/Palay. `NewPileDialog.jsx`'s note claiming a pile's variety "can
never be changed" was flatly wrong for By Products - now conditional.
(2) Both files' age state now defaults to `'1'` instead of `''`
(Settings.jsx's `resetForm`, reused after every create, updated to
match) - same reasoning as WSR's own default-age change earlier this
session. Editing an existing pile still loads its real stored age,
unaffected.

**Pile ID dropdown drops the variety parenthetical for By Products
piles only - fixed, not yet confirmed by user.** Went through a
misfire mid-session: the original "only on the By Products tab"
request was implemented correctly first, then a follow-up comment was
misread as "remove it everywhere" and briefly shipped that way, then
user corrected it back - By Products only was right all along.
Current, correct state: `StockFormBase.jsx` (WSR/WSI) and
`WTSForm.jsx`'s `SidePanel` (both sides) render the bare pile name
only when `p.cerealType === 'By Products'`; Rice/Palay piles keep
`PileName (VarietyName)`, since they genuinely are locked to a single
variety. `SackFormBase.jsx` has no Pile ID picker at all (sacks are
keyed by sack type/condition), nothing to change there.

**MO/TMO completion is manual-only now; amber border flags an
already-looks-done pending order - fixed, not yet confirmed by user.**
Per explicit request. `MillingMonitor.jsx`'s `isOrderCompleted` (gates
both the pending and Completed lists) dropped `o.fulfilled` entirely -
now `manuallyCompleted || sheetStatus === 'DONE'` only, since
o.fulfilled's kg/piece math only ever tracks primary stock, never By
Products (entered too inconsistently to trust as proof the whole order
is done). A pending order that IS fulfilled now instead gets a new
`needsConfirmation` amber border on its row (`MillingOrderRow`) - a
"go check this, then confirm it yourself" cue, not an automatic
completion. `CompletedMillingModal.jsx`'s `canUncomplete` also used to
block uncheck when o.fulfilled was true (borrowed from the Authorities
rule, which assumes that signal IS trustworthy) - dropped, now just
`isAdmin && manuallyCompleted`, giving the admin full control both
directions consistently. `MillingOrderDetail`'s own separate
`isCompleted` (drives the Expected-vs-Actual recovery card) still uses
o.fulfilled, deliberately - unrelated to list membership, and exactly
the info an admin needs to decide whether to confirm.

**Save/Update/Delete now scroll to top + focus Date, all 3 transaction
forms - fixed, not yet confirmed by user.** Per explicit request:
Serial No. (first field in every form) must stay visible while Date
gets focus. `CalendarDatePicker.jsx` only exposed `open()` via its
imperative handle - added a `triggerRef` + `focus` method so it can be
focused externally like any other field. `StockFormBase.jsx`/
`SackFormBase.jsx` already had a `scrollToCustomerName` (scroll-to-top
+ focus Customer Name), but only wired up after Save, not Update/
Delete - renamed to `scrollToTop`, retargeted to a new `dateRef`, and
added to all three handlers in both files.
`SackFormBase.jsx`'s SEPARATE externally-exposed `focus()` (still
Customer Name, used when the form first opens) is untouched.
`WTSForm.jsx` had no equivalent function at all - added `scrollToTop`
from scratch, wired into Save/Update/Delete.

**WSR Age now defaults to 1 day - fixed, not yet confirmed by user.**
Per explicit request. `StockFormBase.jsx`'s `ageValue` now initializes
to `'1'` for WSR (was `''` for every type) - changed both the
component's initial `useState` (first render) and `resetToBlankEntry`
(seeds every SUBSEQUENT blank entry too - typing a new serial and the
post-save "next entry" flow both route through it). `ageUnit` already
defaulted to `'Days'` everywhere, so `1` + `Days` already reads "1
day" with no separate change needed. WSI/WTS unaffected, still start
blank.

**Trial field amber "required" border wrongly shown for By Products -
fixed, not yet confirmed by user.** `StockFormBase.jsx`'s Trial
dropdown (Test Milling receipts) applied its amber border
unconditionally whenever empty - `canSave` never actually required
`trialNumber` for any category, so the border was purely cosmetic and
misleading for By Products, where Trial Number genuinely isn't needed.
Same pattern already existed for Moisture Content a few lines below
(`activeCategory !== 'By Products'` exception, plus an "Optional"
placeholder) - Trial just never got it. Added the identical condition.
`SackFormBase.jsx`'s own Trial field has no By-Products concept at all
(no `activeCategory`), so nothing to change there.

**Uncheck-complete self-lockout - fixed, not yet confirmed by user.**
After using the admin checkbox to mark several MO/TMO complete, none
showed an uncheck control anymore. Genuine race, not a missing
feature: marking complete writes literal `'DONE'` to the Sheet's own
STATUS column (`markMillingOrderDone`, by design, keeps the Sheet in
sync). `CompletedMillingModal.jsx`'s `canUncomplete` gate used to also
exclude `o.sheetStatus === 'DONE'`, meant to block only orders marked
DONE independently on the Sheet - but the next sync pulls the app's
own DONE write straight back in, so `sheetStatus` reads DONE for every
order the admin just completed THROUGH the app, permanently hiding the
very control that was supposed to undo it. Fixed: `canUncomplete =
(o) => isAdmin && o.manuallyCompleted && !o.fulfilled` - drops the
`sheetStatus` check entirely, matches the same rule already used
correctly for AI/SIA Authorities (manually-completed + not genuinely
fulfilled, never gated on an externally-sourced status flag).

**Separate, NOT YET addressed:** user also asked why the by-products
TMO wasn't available for entering its own receipt - that's a different
picker, in `StockFormBase.jsx`/`SackFormBase.jsx`'s own
`millingOrderOptions`, hard-filtered to only the currently-typed
Customer Name's own ricemill (exact `ricemillName` match, no fallback
message on zero matches) - a deliberate earlier design choice ("a
selection for one miller should never show every other miller's
MOs/TMOs"), not an oversight like the Monitor bug. Waiting on the user
to confirm whether their typed Customer Name actually matches the
Sheet's ricemill name for that TMO before deciding whether/how to
change this one.

### OPEN (2026-08-17 session, round 26) - sack-weight separation bug + phantom deleted-pile beginning balance bug - PUSHED, user has since confirmed this is fixed

Two real bugs found and fixed. (1) Home Stocks' Rice/Palay sack-weight
separation read `piles.mtsSackTypeId`, which only reflects whichever
weight a pile was first CREATED with - never updated by later
receipts, which each carry their own weight on the TRANSACTION, not
the pile. A pile that genuinely received more than one sack weight
over its lifetime was invisible to the separation logic. Fixed via a
new `computePileStockBySackWeight` (`pileLedger.js`) that derives the
real per-weight breakdown from the pile's actual transaction history
instead. By Products stays unseparated, unchanged. (2) User reported
the exported weekly report still showed roughly DOUBLE a variety's
real stock after this session's earlier cutoff-date fixes (a
screenshot: PD1s-A report beginning balance 12,419 bags vs. only 6,292
across its two actual live piles). Root cause: `Reports.jsx`'s PDF
beginning-balance sum counts every `isInitialBalance` transaction
warehouse-wide with NO check that the pile it belongs to still exists
- a pile created by mistake and later deleted (transactions
deliberately kept forever) has its old seed balance permanently
inflating every future report for that variety. This is the
warehouse-wide counterpart to the "PD phantom-data" fix already
applied to the per-pile `computeHistoricalPileState` - a genuinely
separate code path that never got that same fix. Now filters to only
piles that still exist. Neither fix verified against the user's actual
live data this session - needs re-checking against their real
warehouse.

### OPEN (2026-08-16 session, round 25) - fixed single-age-bucket varieties showing no detail on Home Stocks - PUSHED

Real bug: `HomeStocks.jsx`'s `VarietyCard` required MORE THAN one age
bucket before it would render any per-bucket detail row at all (and
before the expand arrow itself would even appear, if that lone bucket
had no unwithdrawn stock) - so a variety whose entire stock sat in a
single bucket (e.g. only ever received in the last 0-3/0-6 months, no
older stock yet) showed nothing. Fixed both the `hasExpandableDetail`
gate and the bucket-mapping render to work correctly with exactly one
bucket too.

### OPEN (2026-08-16 session, round 24) - exit is slide+fade together, grid box hidden instantly on Back tap - PUSHED

User clarified round 23's plain fade wasn't what was asked - wanted
slide AND fade together. Also asked to directly eliminate the
recurring "flash of zoomed layout" glitch by hiding the grid's bordered
box THE INSTANT Back/exit is tapped, rather than continuing to try to
time the animation around it. New `hideGridDuringExit` state (Piles.jsx)
set synchronously in the same click handler that starts the exit
(`exitFullScreen`, now shared by the Back button and the toggle
button), applied as `invisible` (not unmounted, so containerRef/its
ResizeObserver stay attached) on the grid's bordered box; cleared via a
new `onExited` callback on `FullScreenOverlay`, fired from the same
real `animationend` handler that drives the unmount. Exit animation
itself: new `fullscreen-slide-fade-out` keyframe (translateY + opacity
together) replaces round 23's plain fade reuse. Not verified on an
actual phone this session.

### OPEN (2026-08-16 session, round 23) - full-screen exit fades, page fades back in, header/nav slide in - PUSHED

User found round 22's slide-out still glitchy and asked for something
more coordinated instead: exit now fades (reusing `.animate-fade-out`),
the underlying normal page fades back in once the overlay is actually
gone (`justExited` flag + `.animate-fade-in` wrapper, triggered by the
real `animationend`), and AppHeader/BottomNav now slide back into view
in step with it - via a new `chromeHidden`/`setChromeHidden` in
`PageHeaderContext.jsx` that `Piles.jsx` drives off `isFullScreen`,
OR'd into `App.jsx`'s existing `barsHidden` (same mechanism already
used for transaction forms/admin dashboard). Not verified on an actual
phone this session.

### OPEN (2026-08-16 session, round 22) - simplified full-screen exit to a plain slide - PUSHED

Round 21 confirmed working on device (Add Pile/Cancel controls and the
grid boundary box now display correctly). User asked to simplify the
exit animation - drop the rotate+zoom-out, just slide the layout off
screen instead. Replaced `fullscreen-zoom-out` with a new
`fullscreen-slide-out` keyframe (`translateY(0)` -> `translateY(100%)`
+ fade, no rotation/scale) in `index.css`; entrance is unchanged. The
round 21 `animationend`-driven unmount logic still applies as-is, just
now listening for the slide's completion instead of the old zoom-out's.

### OPEN (2026-08-16 session, round 21) - hardened full-screen mechanism, removed all guessed timings - PUSHED

User reported round 20 showed NO visible change on their phone.
Replaced every remaining guessed value with a real signal: 100vh/100vw
-> 100dvh/100dvw (plain vh/vw can be taller than the actually-visible
mobile viewport, a plausible reason content still extended past the
real screen even with round 20's padding); the exit unmount now
triggers off the real `animationend` event instead of a hardcoded
setTimeout that had to be hand-kept in sync with the CSS duration; the
post-exit scale remeasurement now fires off a `containerVersion` state
that only changes when the grid's DOM node is actually reattached
(via a proper callback ref), instead of guessing how long the DOM swap
takes. If this ALSO shows no visible change, next step is confirming
the phone is even loading this build - check the Login page's version
label reads v1.8-11, otherwise it's a caching/stale-build issue, not a
code issue. Could not verify any of this on an actual phone this
session.

### OPEN (2026-08-16 session, round 20) - Add Pile still clipped + exit "zoom in" glitch - PUSHED

Round 19 wasn't enough: Add Pile was still clipped to a corner sliver,
and exiting full-screen visibly zoomed the grid IN for a moment before
the fade+rotate. Both traced to real causes this time (see
activity-log round 20 for the full geometric reasoning on the first
one): the controls row sits at the overlay's PRE-rotation top edge,
which becomes the VISUAL RIGHT edge once the portrait rotation is
applied - Add Pile, at the far end of that row, lands in the visual
bottom-right corner specifically, where phones commonly need real
safe-area clearance. Added `paddingTop: max(1.5rem, calc(0.75rem +
env(safe-area-inset-right)))` on the portrait branch. The zoom-in
glitch was the auto-fit scale measurement firing one frame after exit
began, reading the still-full-screen DOM (kept mounted for 220ms by
round 18's exit animation) against already-flipped normal-view math -
now deferred until after the real post-exit DOM swap. Neither fix
could be exercised on an actual phone this session - needs real-device
re-test.

### OPEN (2026-08-16 session, round 19) - four real mobile-only full-screen bugs from round 18 - PUSHED

Round 18's animation gate (`scaleReady`, hiding all full-screen content
until the grid's fit-to-screen scale was measured) caused Add Pile/
Cancel controls to go permanently invisible on some phones - removed
entirely, entrance animation now plays immediately on mount instead.
Also fixed: grid not filling 100% of the screen (missing `min-h-0` on
the round 18 inner animation wrapper), the app header flashing through
right after dismissing the delete ConfirmDialog (a z-index tie between
`FullScreenOverlay` and `AppHeader`, both `z-50` - bumped the overlay
to `z-[55]`), and the exit animation spinning further instead of
reversing the entrance (fixed the `fullscreen-zoom-out` keyframe to
mirror entrance exactly, `-8deg` both ways instead of `-8deg` in /
`+8deg` out). Could not verify on an actual phone this session - user
needs to re-test on mobile.

### OPEN (2026-08-16 session, round 18) - full-screen pile layout rotate+zoom entrance/exit - PUSHED

Replaced round 17's plain fade with a rotate+zoom entrance/exit, per
user feedback that the fade looked like a glitch. Found and fixed the
actual glitch cause along the way: the grid's auto-fit `scale` is
measured asynchronously after full-screen mode mounts, so the overlay
could briefly render at the wrong (stale) size before snapping to the
correct fit - a new `scaleReady` gate keeps the content invisible
(but still measurable) until that first measurement lands, so the
animation always plays at the correct final size. `FullScreenOverlay`
now has an outer node (static device-orientation rotation only, since
the Edit/Assign form portals directly into it) and an inner node
(the actual animation), so the two transforms don't conflict.

### OPEN (2026-08-16 session, round 17) - pile layout historical bug + PDF color mismatch + full-screen fade - PUSHED

Real bug fix: a box assigned to a backdated pile (beginning balance
"as of" an earlier date) only showed in the layout from the day it was
actually clicked/assigned in the UI, never for periods before that.
`Piles.jsx`'s `handleConfirmAssign` now stamps a box's `assignedDate`
with the assigned pile's own `dateOfReceipt` instead of always
`todayLocalISO()`, and a new one-time self-heal effect back-dates any
already-mis-stamped box automatically (no manual reassignment needed
for boxes assigned before this fix). Also fixed the exported PDF's box
colors to exactly match the on-screen colors (previously independently
hardcoded, only approximately similar), and gave full-screen pile
layout mode a fade in/out instead of snapping instantly.

### OPEN (2026-08-16 session, round 16) - inline duplicate pile-name checker - PUSHED

Blur-triggered (not live-per-keystroke), per-warehouse duplicate
pile-name check in both places a pile name can be entered/edited:
`NewPileDialog.jsx` ("+ New Pile" from a stock form, create-only) and
`Settings.jsx`'s Create/Edit Pile panel (create + rename, so its check
excludes the pile currently being edited). Green check icon + neon
border when unique, amber warning icon + amber border + amber subtext
("This pile name is already used in this warehouse.") when a duplicate
exists, both triggered `onBlur` via a Dexie query, reset to idle on
every keystroke. Both files also re-run the check fresh right before
actually saving (`handleCreate`/`handleUpdate`) and block with a toast
if a duplicate slipped through - defends against the user ignoring the
inline warning or a collision from concurrent activity. Settings.jsx's
now-unused `ValidatedField` import for the pile-name field was removed
(shared component itself untouched, still used elsewhere presumably).

### OPEN (2026-08-16 session, round 15) - fixed Purity/MC not auto-filling when editing a pile - PUSHED

`createPileWithBeginningBalance` (pileLedger.js) saved `purity`/
`moistureContent` onto the `piles` record but never onto its own seed
transaction (`moistureContent` hardcoded `null`, `purity` omitted
entirely) - since `BeginningBalancesPanel.jsx`'s `handleEdit` reads
these two fields FROM the seed, every pile with a beginning balance had
a real value on the pile record but showed blank on edit. Fixed both
sides: the seed now gets the real values going forward, and
`handleEdit` now falls back to the pile record's own values when the
seed's are blank - retroactively fixes every already-existing pile too,
no migration needed. Covers all pile-creation paths (Settings.jsx,
NewPileDialog.jsx) since they share the one function.

### OPEN (2026-08-16 session, round 14) - Completed MO/TMO sort now uses the Sheet's own milling date - PUSHED

The Completed list's sort only ever used LOCAL transaction dates - an
order with no real WSI/WSR ever posted through this app fell back to
arbitrary/insertion order instead of a real date. New `dateOfMilling`
field (from the Sheet's column J, "DATE OF MILLING") now flows through
`docs/apps-script-full-replacement.js` -> `googleSheetsBridge.js` ->
`db.millingOrders`, and `MillingMonitor.jsx`'s `lastActivityDate` falls
back to it when there's no local transaction date. **Requires another
Apps Script redeploy** (same file, already updated for round 12's
STATUS write-back too) plus a resync before it actually populates -
until then the sort behaves exactly as before, not worse.

### OPEN (2026-08-16 session, round 13) - expected-vs-actual recovery comparison on completed MillingOrderDetail - PUSHED

MO 151 (round 11/12's "wrongly shows completed" investigation) turned
out to be a real, correctly-completed order - user had already encoded
its recovery data. No bug, closed.

`MillingOrderDetail`'s "Expected Recovery" card now shows a second,
MO-only variant once an order is completed: Expected (recalculated
from what was actually ISSUED, not the full allocation) side by side
with Actual (received), whole-card border green when actual meets/
exceeds expected, amber when it falls short. Pending orders unchanged
- still show the original allocation-based preview card.

### OPEN (2026-08-16 session, round 12) - fixed a real MillingOrderDetail crash + added Sheet STATUS write-back for admin MO/TMO mark-done/undone - PUSHED

`ReferenceError: shouldRenderMoreDetails is not defined` was crashing
the completed-order detail view for any MO/TMO with By Products/Source
Warehouse/Last Activity content - a latent bug from an earlier
session's animation-sequencing refactor where two derived consts were
referenced in JSX but never actually defined. Fixed in
`MillingMonitor.jsx` (`shouldRenderMoreDetails`/`shouldRenderTabContent`
now correctly derived from `visibleSection`).

Also added Sheet STATUS write-back per user request: admin mark-done
now writes "DONE" to the Sheet's STATUS column (reusing the existing
`markMillingOrderDone`, already used for natural completion elsewhere),
and admin mark-pending clears it. **`docs/apps-script-full-
replacement.js` needs to be redeployed to Google** for the "clear on
revert" direction to actually take effect - marking done keeps working
immediately either way (default behavior unchanged).

Still OPEN from round 11: MO 151 is confirmed present locally with full
data but incorrectly showing as Completed - root cause (which field is
flipping `isOrderCompleted` true) not yet found, investigation was
interrupted by the crash above. Next step: get the exact stored
record's `manuallyCompleted`/`sheetStatus` values from the user.

### OPEN (2026-08-16 session, round 11) - fixed a real transaction race that silently reverted admin MO/TMO mark-done; MO 151 missing-order bug still open - PUSHED

User found (via live testing, screenshot evidence) that admin's new
MO/TMO checkbox wasn't sticking. Real root cause: `syncMillingOrders
FromSheets` auto-runs every 5 min + on login + on reconnect (bundled
into `startAuthoritySyncWorker`), fully clearing and rebuilding
`db.millingOrders` every time. Round 9's `manuallyCompleted`
preservation read the existing flags BEFORE the sync's network fetch
instead of atomically with the clear+rebuild, so any admin write
landing during that window (likely right after a manual sync) got
silently erased. Fixed in `googleSheetsBridge.js` by moving that read
inside the same `db.transaction('rw', ...)` block as the clear+bulkPut.

Second bug from the same report - a real MO (151) visible on the Sheet
never appears in the app despite a successful sync - is NOT yet
resolved. Checked every client-side filter and the documented Apps
Script logic; none would exclude it. Waiting on the user to check the
browser console's `[syncMillingOrdersFromSheets] synced N record(s)`
log after their next sync to confirm whether it's even being fetched at
all - if not, the deployed Apps Script (not just this repo's copy) is
the next place to look.

### OPEN (2026-08-16 session, round 10) - version bump, admin Authority Number picker scope bug, Completed AI/SIA search - PUSHED

`src/version.js` bumped to `1.8` (was pushed as part of round 9 without
actually updating this - caught by the user). `AdminMonitoring.jsx`'s
Authority Number picker next to the PENDING list was scoped to every
authority of that type regardless of status - fixed to pending-only
(`CompletedAuthorityModal.jsx`'s own picker was already correctly
completed-only, no change needed there). Also added a free-text
AI/SIA-number search box to `CompletedAuthorityModal.jsx`, matching the
pending list's existing search style. `npm run build` passes.

### OPEN (2026-08-16 session, round 9) - admin-only manual complete/uncomplete for Authorities AND MO/TMO on the Monitoring page - PUSHED

Full plan on file at
`C:\Users\DjArVee\.claude\plans\now-can-you-continue-vectorized-russell.md`
(implemented in full - read that file for exact diffs/reasoning if
picking this up cold). Short version: `AdminMonitoring.jsx` now gates
mark-done/undo controls on `isAdmin = user?.role === 'Admin'` (Visitor
still read-only). Authorities reused the existing `manuallyCompleted`
mechanism (small change). MO/TMO had NO manual-override concept at all
before this - new `millingOrders.manuallyCompleted` field (dexie v29),
with a critical gotcha fixed: `syncMillingOrdersFromSheets` fully
clears+rebuilds the table every sync, so the flag has to be explicitly
read and merged back in before every resync or it silently reverts.
`MillingMonitor`/`CompletedMillingModal` both gained a new `isAdmin`
prop (default `false`) - the regular user-side `Home.jsx` milling
widget never passes it, so it's completely unaffected. `npm run build`
passes; not yet manually tested on localhost or pushed.

### OPEN (2026-08-16 session, round 7-8) - app version label + authority cutoff fix - PUSHED

Round 8 addendum: `src/utils/unwithdrawnStock.js`'s shared
`activeAiAuthoritiesFor` helper now excludes an authority dated on or
before the warehouse's `reportingCutoffDate` from unwithdrawn/potential
math (all 4 exported functions route through it) - a pre-cutoff
authority still not withdrawn was wrongly dragging Potential down.
Deliberately does NOT hide it from AuthorityMonitor's own pending/
completed lists, only from the inventory math.

New `src/version.js` holds a single `APP_VERSION` constant (currently
`'1.7b-2'`) plus the full era-by-era reasoning in its own comment block
- read that file before ever bumping the version, it explains the
scheme (`MAJOR.MINOR<letter>-BUILD<letter>`) and where the current
number came from. `src/pages/Login.jsx` shows it as a small, muted line
directly below the existing "by ArVee" credit.
waiting on user go-ahead per the last message in this session.

### PUSHED (2026-08-16 session, round 6) - reportingCutoffDate app-wide + pile lifecycle/historical layout + date-aware pile picker + a real pile-delete bug fix - NOT MANUALLY TESTED ON LOCALHOST YET

**Addendum**: user caught a real, serious bug while reviewing this round
- deleting a pile (via Beginning Balances or the old, actually-unreachable
Settings.jsx copy) deleted every transaction tied to it too. Fixed:
pile deletion now only removes the `piles` record and unlinks its layout
box - transactions are NEVER deleted, always kept, always resolvable by
`pileId`. This was true of the ENTIRE feature set below by design
(nothing in Features A/B/C ever deletes a transaction), but this one
pre-existing delete flow was the one real exception, now closed.

Full plan (still on file at
`C:\Users\DjArVee\.claude\plans\now-can-you-continue-vectorized-russell.md`)
implemented in one pass across three linked features - read that file
for exact diffs/reasoning if picking this up cold. `npm run build`
passes after every phase, but **none of this has been manually verified
on localhost yet** - needs `npx vercel dev` (not plain `npm run dev`,
see Dev Environment notes below) and real click-through testing before
push. Full detail in docs/activity-log.md's "round 6" entry; short
version:

1. **`reportingCutoffDate`** (Admin > Warehouses > "Reports Start Date")
   now governs EVERY calculation, not just Reports.jsx - live pile
   totals (`pileLedger.js`'s `computeHistoricalPileState`, with a
   `WarehousesPanel.jsx` trigger to refresh the cached totals when the
   cutoff changes), live sack totals (`HomeSacks.jsx`/
   `AdminHomeSacks.jsx`, fully reactive already), and BIN Card exports
   (`pileBinCardGenerator.js`). Nothing is ever deleted - pre-cutoff
   transactions just stop being counted, everywhere, consistently.
2. **New pile lifecycle system**: `piles.zeroedDate` (dexie v28,
   distinct from manual `closedDate`) silently tracks when a pile hits
   zero, via a new shared `deriveZeroedDateUpdate` helper wired into
   every write path including `WTSForm.jsx`'s own two-sided logic. New
   `pileLayoutHistory` table captures a box's full prior geometry
   (position AND size) every time it's reassigned, moved, or auto-
   vacated. Piles.jsx gained a reactive auto-vacate effect (one day's
   grace period - a pile that zeroes still shows normally for the rest
   of that day) and its existing `periodTo` date picker now drives box
   occupancy/position/size too, not just totals - plus pile Age now
   correctly reflects the picked historical date instead of always
   showing today's age. Manual "Close Pile" in Beginning Balances now
   has a confirmation dialog and immediately vacates the pile's box.
3. **Date-aware pile picker**: `StockFormBase.jsx`/`WTSForm.jsx` no
   longer show a closed/zeroed pile for a same-or-future-dated
   transaction (closes the "ghost pile" risk flagged during planning),
   but still allow genuinely backdated entries against a pile's
   still-active period.

Explicitly verified (not assumed): BIN Card transaction matching is by
`pileId` (UUID) everywhere, never `pileName` - matters given this app's
real "Pile 1, Pile 2..." naming convention reuses names across different
physical piles over time.

### DONE (2026-08-16 session, round 5) - fixed round 4's animation for real

Round 4's glow+collapse animation had three real bugs, all fixed this round:

1. Checkbox never showed checked/unchecked at the moment of tap - it
   read `a.manuallyCompleted` directly, which only flips in the DB at
   the END of the (deliberately delayed) write. Both
   [AuthorityMonitor.jsx](../src/components/common/AuthorityMonitor.jsx)
   and [CompletedAuthorityModal.jsx](../src/components/common/CompletedAuthorityModal.jsx)
   now derive the checkbox's visual state from local `completingId`/
   `revertingId` so it flips instantly on tap, independent of the DB
   write timing.
2. "Reappears for a second" flicker was a real race: both places
   cleared their local animation-tracking id inside the same
   `setTimeout` that fired the DB write, but Dexie's live query
   recomputes asynchronously - so for one frame the id was cleared
   (row back to normal) while the item was still in the list. Fixed by
   clearing the id in a `useEffect` gated on the item actually being
   confirmed absent from the live-query-derived list.
3. Keyframes in [index.css](../src/index.css)
   (`row-complete-out`/`row-revert-out`) redesigned with per-keyframe
   easing (ease-out into the glow, ease-in through the collapse) plus
   `transform: scaleY(0)` from `transform-origin: top` combined with
   the max-height collapse, so the row now visibly flattens instead of
   just fading/shrinking. Duration 0.6s -> 0.7s so the glow has room to
   read before the flatten starts.

`npm run build` passes; hook imports re-checked in both touched files
(clean) given round 4's crash lesson below.

### DONE (2026-08-16 session, round 4) - crash fix + completion animations + arrow/total flip timing

1. **Crash fixed**: round 3's MillingMonitor.jsx sequencing change used
   `useEffect` without importing it - `npm run build` doesn't catch
   missing-identifier runtime errors, only syntax/unresolved-import
   ones, so it built clean but crashed on opening any Milling
   Operations detail modal. Fixed, then proactively re-checked every
   file touched today for the same mistake (hook used vs. imported) -
   clean. **Lesson: a clean build is not proof of runtime
   correctness** - worth remembering for future sessions.
2. Authority complete (pending list checkbox) / uncomplete (Completed
   modal, after confirm) now glow green/red and collapse their row
   height over 0.6s before the actual DB write happens, so rows below
   visibly slide up as a natural consequence - new
   `.animate-row-complete-out`/`.animate-row-revert-out` keyframes in
   [index.css](../src/index.css), same collapse technique already
   used for banner exits, just tuned for list rows.
3. HomeStocks.jsx variety-card arrow: rotation is back, but delayed via
   `transition-delay` to only start once the 300ms height-slide
   finishes - so it slides, then flips, not both at once.
4. HomeStocks.jsx cereal Total block: the flip animation now wraps the
   WHOLE block (headline + detail) as one keyed unit, not just the
   newly-appended unwithdrawn/potential row.

Full detail in docs/activity-log.md's "2026-08-16 (round 4)" entry.
`npm run build` passes.

### DONE (2026-08-16 session, round 3) - Milling modal glitch, completed-authority fixes, real per-bucket data, single sliding arrow (see round 4 above for a crash this round introduced and then fixed)

Read the entry directly below first for what this builds on. This round:

1. Milling modal's "more details" toggle and the Stocks/Sacks tab
   section were each on their own independent `useDelayedUnmount`,
   so they animated in PARALLEL and briefly showed both at once
   (confirmed via screen recording) - replaced with a sequenced state
   machine so only one is ever mounted.
2. Real bug fixed in `calculateAuthorityStatus`
   ([calculations.js](../src/utils/calculations.js)): a literal `0`
   allocation fell through to the balance math instead of the null/
   undefined guard, computing balance=0 which reads as "Complete" -
   misclassifying a blank/zero-allocation authority as naturally
   complete and hiding its (correctly-deserved) uncomplete option.
   Now also guards `Number(totalAllocation) === 0`.
3. Two more modals had the same containing-block bug as last entry's
   Completed-list modals: the Add/View Transaction chooser (now
   `ChoiceAuthorityModal`, extracted from AuthorityMonitor.jsx) and
   `AuthorityReconciliationPanel.jsx`. Both portaled now. A proactive
   sweep found 5 more non-portaled `fixed inset-0` usages elsewhere in
   the app (BeginningBalancesPanel, EditPileAgeDialog, TransactionModal,
   AdminDashboard, WarehouseDetailModal) - none currently reachable
   from the specific problem ancestor as far as traced, left alone,
   flagged in the activity-log entry in case one surfaces later.
4. CompletedAuthorityModal: added a confirm step before uncompleting;
   **reverted** the prior entry's "always show uncomplete" back to
   "only manually-completed (not naturally complete) authorities" per
   explicit correction - removed the `manuallyReopened` field
   entirely (added then un-needed within the same session); warehouse
   filter now scoped to `accessibleWarehouses` (was showing every
   warehouse in the app) via a new prop, wired from both
   AuthorityMonitor.jsx and AdminMonitoring.jsx (which already reused
   this same modal, so the "admin/visitor side" request needed only
   this one prop, not a separate implementation).
5. **Fixed the per-bucket estimate bug for real**: authorities have a
   genuine `ageGroup` field already used elsewhere in the codebase
   (`computeUnwithdrawnByCategoryAge`) - added
   `computeUnwithdrawnByVarietyAge` and a `bucketFilter` param on
   `getUnwithdrawnDetail` ([unwithdrawnStock.js](../src/utils/unwithdrawnStock.js))
   so each age-group's unwithdrawn figure (and its drill-down modal) is
   now genuinely bucket-scoped, not the same full-variety numbers
   under every bucket (a real bug the user caught via screenshots).
6. **Arrow "jump" actually fixed this time**: the previous entry's fix
   was never actually implemented (still had two separate DOM nodes).
   Extracted `VarietyCard` as its own component (needed so
   `useDelayedUnmount` could be called per-instance, not inside a
   `.map()` - Rules of Hooks) with ONE persistent arrow as the last
   child, and the detail region's HEIGHT animating via CSS
   `grid-template-rows: 0fr -> 1fr` (not a transform-based reveal,
   which doesn't change layout height progressively) - so the arrow
   genuinely reflows/slides as the block grows, frame by frame.
7. Removed the redundant variety-level "Total" block (added two
   entries ago, immediately reported as a duplicate of the cereal-
   level Total when a category has one variety); restyled the
   surviving cereal-level Total to be bigger/bolder and match the
   per-bucket rows' `justify-between` layout.

Full detail in docs/activity-log.md's "2026-08-16 (yet another
continuation, round 3)" entry. `npm run build` passes throughout.

### DONE (2026-08-16 session, round 2) - large batch of refinements from live testing screenshots (see above entry for round 3, which fixes several things round 2 didn't fully land)

Read the entry directly below first for what this builds on. This
round, from screenshots of the app actually running:

- **MillingOrderDetail** ([MillingMonitor.jsx](../src/components/common/MillingMonitor.jsx)):
  By Products/Source Warehouse/Last Activity collapsed behind "Show
  more details" (was crowding the transaction list below); each
  `StockRow` now shows the transaction's pile's **Age** (computed from
  the pile's own `initialAgeValue`/`dateOfReceipt`, not a transaction
  field); Completed Milling list now sorts newest-activity-first.
- **CompletedAuthorityModal.jsx**: "mark as pending" is now always
  available (was gated to only manually-completed-non-naturally-
  complete authorities, so it never showed for the common case) - new
  `manuallyReopened` override flag in `isAuthorityComplete`
  ([calculations.js](../src/utils/calculations.js)) forces an authority
  back to pending regardless of the natural-completion math, cleared
  when explicitly re-marked complete from the pending list. Added a
  warehouse filter (defaults "All Warehouses").
- **AuthorityMonitor.jsx**: the two-chip stacked layout from the prior
  entry was reverted to one line ("ugly" per direct feedback) - title
  and a single `"{ai} AI · {sia} SIA"` pill share the header row, with
  larger/better-padded type than either earlier attempt.
- **HomeStocks.jsx variety cards, reworked again**: arrow now
  genuinely doesn't rotate (two separate non-transformed elements -
  one after the headline when collapsed, a different one after the
  full expanded detail when open - so it moves via normal document
  flow, not an animated transform); unwithdrawn badges state their
  unit (bags vs net bags); per-bucket unwithdrawn tags are now
  clickable (same modal, noted as "(estimated share)" since the
  underlying data is only tracked per-variety, not per-bucket);
  variety-level Total gets a left-side label + stacked values; cereal
  Total row's unwithdrawn moved inline with Potential (no longer
  beside the main figure) and gets a **flip** reveal
  (`animate-value-flip`, new keyframe in
  [index.css](../src/index.css)) instead of a fade/slide; sort order
  fixed to explicit Rice → Palay → By Products (was alphabetical,
  which put By Products first); unwithdrawn/potential text bumped to
  `text-xs sm:text-sm` (responsive, not fixed-size).
  **Standing principle going forward, per explicit request: new UI
  text should default to a responsive scale, not a single fixed
  size.**

Full detail in docs/activity-log.md's "2026-08-16 (yet another
continuation)" entry. `npm run build` passes. Still waiting on the
user's own localhost re-test before anything from today (4 entries
now) gets committed.

### DONE (2026-08-16 session, second continuation) - found the REAL sticky-header cause, fixed a modal-containment bug, more UX corrections (see above entry for the round after this one)

The previous round's `overflow-y: visible` fix (see the entry directly
below) was verified LIVE in the browser to still be broken -
`getComputedStyle` kept returning `overflow-y: auto` even with an
inline `!important` override, which meant it wasn't a specificity bug
at all: **`overflow-x: hidden` unconditionally forces the paired axis
to `auto` per the CSS spec, and no declaration can override that
pairing.** The actual fix, also verified live: use `overflow-x: clip`
instead of `overflow-x: hidden` on `html`/`body` in
[index.css](../src/index.css) - `clip` does not participate in that
axis-promotion rule. If a similar "my CSS declaration isn't taking
effect and I can't figure out why" problem ever comes up again, check
whether the two overflow axes are fighting each other this same way
before assuming it's a specificity/cascade issue.

Also found and fixed, this pass:
- **Modal containment bug**: CompletedMillingModal (new this session)
  and CompletedAuthorityModal (pre-existing) both rendered trapped
  inside their scrolling ancestor instead of covering the screen.
  Cause: both are opened from inside a `.stagger-fields`/`.animate-
  flow-down` ancestor, and those animations' `animation-fill-mode:
  both` leaves a non-`none` `transform` permanently applied even after
  the animation ends - which becomes the containing block for
  `position: fixed` descendants (same bug class as the Piles.jsx
  fullscreen ConfirmDialog fix from earlier this session, different
  mechanism). Fixed by portaling both to `document.body` via
  `createPortal`, and switched their entrance/exit from a fade to
  `animate-sheet-slide-up`/`animate-sheet-slide-down` (slide from the
  bottom) per explicit request.
- HomeStocks.jsx: variety-card arrow no longer rotates (nudges down
  instead, `translate-y-1`); each age bucket now also shows its own
  unwithdrawn/potential figures (a **proportional estimate** - the
  data model only tracks unwithdrawn stock at the variety level, not
  per bucket/pile - clearly commented as such); the cereal-type Total
  row's reveal of its own unwithdrawn detail now animates in via
  `animate-flow-down` instead of popping in instantly.
- AuthorityMonitor.jsx: renamed "AI / SIA Monitor" → "Authority
  Monitor"; the "AI (3) / SIA (4)" count moved to its own row as two
  separate, better-padded pill chips instead of one cramped inline
  string; `expanded` now defaults to `true` (direct reversal of the
  immediately-prior entry's "collapsed by default" - user clarified
  they meant the opposite).

Full detail in docs/activity-log.md's "2026-08-16 (continued again)"
entry. `npm run build` passes; the overflow-x:clip fix and the modal-
portal fix were both verified live in the browser tool this time, not
just by reading source. Still waiting on the user's own localhost
re-test before anything from today gets committed.

### DONE (2026-08-16 session, first continuation) - user tested Home declutter/FAB dodge on localhost and reported 5 issues, all fixed (see above entry for what needed a SECOND round of fixes)

Read the entry directly below this one first for the original scope
(Home declutter + FAB dodge); this note only covers what changed after
the user actually tried it locally:

1. **Sticky header broke entirely** - root cause was the horizontal-
   scrollbar fix from the 2026-08-15 (continued) session:
   `overflow-x: hidden` alone on `html`/`body` silently auto-promotes
   `overflow-y` to `auto` per the CSS spec, which turns them into their
   own scroll container separate from the viewport and breaks every
   `position: sticky` element's ancestor chain. Fixed by explicitly
   pairing it with `overflow-y: visible` in
   [index.css](../src/index.css).
2. **HomeStocks.jsx variety cards redesigned again** - the "Show age
   breakdown" button wasn't enough; per explicit direction the card
   now shows ONLY bags+net kilos by default (no unwithdrawn badge, no
   potential line either), with a centered chevron and the whole card
   tappable to reveal everything at once. The cereal type's Total row
   now mirrors whichever variety is expanded instead of always showing
   its own unwithdrawn detail.
3. **Two real Home.jsx bugs**: the Overview/Activity panel divs shared
   the literal same `key={currentWarehouseId}` (fixed to unique keys),
   and `inventoryTab` (Stocks/Sacks selection) lived above the
   warehouse-keyed remount boundary so it never reset on a warehouse
   switch (fixed with a `useEffect`). A third report - "a second
   Stocks/Sacks tab appears with 2+ cereal types" - wasn't reproducible
   by reading the code; flag to the user if it recurs after these
   fixes, ideally with a fresh screenshot showing 2+ cereal types.
4. **AI/SIA Monitor** now shows per-type counts (`AI (3) / SIA (4)`)
   instead of one combined "N pending" chip.
5. **Milling Operations completed list** moved out of the inline
   pending list (which used to just swap in place) into its own modal
   ([CompletedMillingModal.jsx](../src/components/common/CompletedMillingModal.jsx)),
   matching AuthorityMonitor/CompletedAuthorityModal's existing
   convention. Row rendering was extracted into a shared
   `MillingOrderRow` (exported from MillingMonitor.jsx) so the pending
   list and the completed modal can't drift apart.

Full detail in docs/activity-log.md's "2026-08-16 (continued)" entry.
`npm run build` passes. Still waiting on the user's own localhost
re-test before anything in either 2026-08-16 entry gets committed.

### DONE (2026-08-16 session, first pass) - Home page declutter + FAB dodge, IMPLEMENTED in real code (see above entry for post-testing fixes)

Both items below were demoed first (see the 2026-08-15 entry this one
replaces), then approved, then actually built this session. `npm run
build` passes for all of it. **Not committed or pushed yet** - the user
explicitly wants to try it on their running `localhost:3000` dev server
first (HMR should pick these up automatically). Verifying it myself in
the browser tool failed: the README's documented seed PIN (`123456`)
returned "Invalid access PIN" against this environment's actual
database, so login couldn't be completed from here - whoever picks this
up next should confirm with the user whether it's already been tried
locally before assuming it still needs testing.

- **FAB dodge** - DONE, in [BottomNav.jsx](src/components/layout/BottomNav.jsx)
  and [index.css](src/index.css) (`@keyframes fab-dodge` /
  `.animate-fab-dodge`). A `useFabDodge(column)` hook (mirrors the
  existing `useSquashOnChange` retrigger-via-forced-reflow pattern)
  fires only when `Math.min(prev,col) < FAB_COLUMN < Math.max(prev,col)`
  (`FAB_COLUMN = 2`, matching the gap in `REGULAR_NAV_COLUMN`) - i.e.
  only on a genuine cross-FAB tap (Home/Piles ↔ Reports/Settings), never
  on a same-side tap. Visitor nav has no FAB at all, so the hook is
  still called unconditionally (hooks can't be conditional) but its ref
  just never attaches to anything there.
  - Went through two demo-iteration rounds before this: first version
    had the FAB resting lower to visually sit "in the pill's path" -
    user correctly rejected this ("does not need to rest lower, ...
    must never touch"). Root cause was actually timing, not position:
    the dodge fired ~90ms after tap and didn't reach full clearance
    fast enough relative to how quickly the pill's own back-out easing
    (`cubic-bezier(0.34,1.56,0.64,1)`) sweeps through. Fixed by
    triggering the dodge with **zero delay** (same tick as the pill's
    own transition starts) and holding the FAB at full clearance
    (translateY beyond ~-3.1rem) for the pill's *entire* likely transit
    window rather than trying to time a narrow hop precisely - removes
    any need to model the exact bezier curve.
    Second round: user reported the result felt "laggy/slow" - the
    hold window (0.78s total) was outliving the pill's own 0.55s
    transition by a wide margin, reading as the FAB dragging its feet
    after the interaction was already over. Tightened to 0.6s total
    with per-keyframe `animation-timing-function` (fast punch into the
    leap, gentler hold/settle) so the fully-clear window still safely
    covers the pill's real danger zone (estimated first ~350ms of its
    transition) without the long trailing tail. FAB's rest transform
    (`-translate-y-5` / `-1.25rem`) was never actually the problem and
    is unchanged - the keyframe's 0%/100% match it exactly so handing
    control back to the static utility class at animation-end doesn't
    snap.
- **Home page declutter** - DONE:
  1. Overview/Activity top-level tabs in
     [Home.jsx](src/pages/Home.jsx) - same full-width sliding-pill
     pattern as Reports.jsx's Summary/Stock Statement split, panels
     kept mounted and toggled via `hidden` (not conditional render, to
     avoid the known useLiveQuery-remount-flash bug) with
     `animate-flow-down` applied unconditionally so it replays on every
     `hidden` toggle (display:none resets a running/finished CSS
     animation on its own - no JS retrigger or remount key needed, same
     technique just used for Reports.jsx's tabs).
  2. [HomeStocks.jsx](src/pages/HomeStocks.jsx): per-variety age-bucket
     breakdown now collapses behind a "Show age breakdown" button
     (state: `expandedVarieties`, a `Set` keyed by
     `${cerealType}::${varietyName}`, collapsed by default). Skipped
     entirely (no button, no toggle) when a variety only has one age
     bucket - showing a disclosure for a single row that just repeats
     the headline number would be pointless.
  3. New [AlertsPanel.jsx](src/components/common/AlertsPanel.jsx)
     merges ProcurementBagsNotification + PalayDryingStatus (which
     itself renders up to 3 sub-notifications as a Fragment) into one
     collapsed-by-default strip with a count badge. Implemented exactly
     per the plan noted in the prior handoff entry: a single always-
     mounted body wrapper (visibility toggled via `hidden`, not
     unmount) holds the real notification components, and a
     `MutationObserver` on that wrapper tracks `el.children.length` -
     since none of the sub-notifications wrap themselves in their own
     DOM node beyond what they conditionally render (`null` when
     inactive), this gives an exact live count without duplicating any
     of their internal useLiveQuery logic, and the count doubles as
     "hide the whole strip when 0" and "expand default section's
     content it's already counting" in one wrapper - no duplicate
     mounts.
  4. [AuthorityMonitor.jsx](src/components/common/AuthorityMonitor.jsx)
     (AI/SIA Monitor) is now collapsible by default (`expanded` state +
     `useDelayedUnmount`, same flow-down/up-exit pattern Milling
     Operations already used), with a "N pending" chip computed as
     `authorities.filter(a => !isAuthorityComplete(a)).length` (a
     simpler, non-ref-deduped count than the `filtered` list used for
     actual rendering - fine for a rough summary badge, not meant to be
     exact to the record).

Full detail (including the diagnostic approach used for two of the prior
session's bugfixes - extracting/tiling video frames via Python+opencv
since no ffmpeg was available) in docs/activity-log.md's "2026-08-15
(continued)" and "2026-08-16" entries.

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
