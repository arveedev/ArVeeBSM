# BSM App — App Flow

*Companion to `docs/updated-prd.md` and `docs/technical-design-document.md`.
This document specifies the user-facing journeys the system shall support,
step by step, plus a navigation map of every route. Written as pre-build
UX planning.*

## 1. Navigation Map

Every authenticated route is guarded by `ProtectedRoute`, which enforces
role visibility (`denyRoles` / `requireRole`) on top of simple
authentication. The Visitor role's own bottom navigation physically
offers only two of these five destinations; the rest are unreachable for
that role even by direct URL.

| Route | Component | Who sees it | Notes |
|---|---|---|---|
| `/login` | `Login` | Everyone, unauthenticated | PIN keypad |
| `/` | `Home` (regular user) or `AdminHome` (Admin/Visitor) | Everyone | Role determines which component renders |
| `/piles` | `Piles` | Every role except Admin and Visitor | Admin sees "Monitor" here instead — see BottomNav below |
| `/monitoring` | `AdminMonitoring` | Admin, Visitor | Cross-warehouse AI/SIA + MO/TMO oversight |
| `/reports` | `Reports` | Everyone except Visitor | |
| `/settings` | `Settings` | Everyone except Visitor | |
| `/admin` | `AdminDashboard` | Admin only | Full-screen configuration overlay, not a page-slide route |

The bottom navigation bar is role-aware rather than a fixed five-item
list:

- **Admin / Visitor**: Home, Monitor, Reports, Settings (Visitor: Home
  and Monitor only, no floating action button).
- **Everyone with an assigned warehouse** (Supervisor/Assistant/MPO III
  and their Acting variants): Home, Piles, Reports, Settings, plus a
  central floating action button (FAB) that opens a five-way transaction
  sheet: WSR / WSI / WTS / ESI / ESR.

A transaction form opened from the FAB (or deep-linked from an authority
row via `window.openTransactionForm`) renders as a full-screen overlay
above the current route rather than a navigation — the header and bottom
nav slide out of view while it's open, and closing it slides them back
rather than the app navigating away and back.

## 2. Login Flow

1. User opens the app (or it's already installed as a PWA and opened
   from the home screen). If a device has never been online, the
   precached app shell still loads and renders the Login screen.
2. The PIN keypad (6-digit, on-screen grid plus a hidden native numeric
   input for physical-keyboard entry) accepts digits one at a time;
   entered digits show as filled dots, never the actual digit.
3. On the 6th digit, the app hashes the entered PIN and looks up a
   matching `users.accessCode` hash (or, for the shared Visitor code,
   `reportConfig.visitorAccessCode`) — entirely against local Dexie
   data, no network round-trip required.
4. **Match**: the login screen plays its exit animation (buttons fly
   outward, then the screen fades), the authenticated shell fades in,
   and the user lands on `/` — `Home` for an assigned-warehouse role,
   `AdminHome` for Admin or Visitor.
5. **No match**: an inline error shows, the dots clear, and the keypad
   is ready for another attempt — no lockout, no "forgot PIN" flow (an
   admin resets a user's PIN directly from the Users panel in Admin
   Dashboard).
6. On successful login, three background workers start silently: the
   Sheets backup sync queue, the AI/SIA + MO/TMO authority sync, and (for
   the first login on a device, or the first time a given warehouse/type
   combination is touched) a transaction history preload — none of these
   block the user from immediately opening a form.

## 3. Recording a Transaction (WSR / WSI / WTS / ESR / ESI)

This is the app's single most frequent flow, and the one offline
reliability is built around.

1. From Home, the user taps the FAB and picks a document type from the
   five-way sheet (or a form is opened pre-filled from an authority row
   in Piles/Monitor).
2. The form opens as a full-screen overlay. Its serial number field is
   pre-populated with the system-suggested next serial for that
   warehouse + document type (WSR/WSI additionally scope this per
   cereal category — Rice / Palay / By Products keep independent serial
   series). The user can step backward/forward through existing serials
   (with a directional slide animation) to review or edit a past entry
   instead of starting a new one, or type a specific serial directly.
3. **WSR/WSI (stock forms)**: variety, pile (WSI may draw from more than
   one pile in a single issuance — one primary pile plus any number of
   additional pile allocations), number of bags, gross kilos, sack
   condition, moisture content %, an optional linked AI number, and
   (for a Milling-type transaction) batch/trial number. Net Kilos and
   Net Bags compute live as the user types, never manually entered.
4. **WTS (Weigher's Tally Sheet)**: a genuinely dual-sided form — an
   issued side and a received side, each with its own pile, variety,
   sack condition, and bags, each side's net kilos computed
   independently. Saving applies both sides' effects to their
   respective piles in one transaction.
5. **ESR/ESI (empty sacks)**: one or more sack lines
   (`{ sackTypeId, condition, pieces }`), letting a single document
   cover multiple sack types/conditions in one receipt or issuance.
6. Every numeric input live-formats with comma separators as the user
   types; every date field opens the app's own calendar picker, never
   the OS native date input. Inline validation messages appear directly
   under the field they concern, stating what's wrong and how to fix it.
7. On save, the transaction is written to Dexie immediately — this
   completes with no network dependency. `pileLedger.js` applies the
   transaction's effect to its pile's (or piles') running totals in the
   same operation. A toast confirms the save. If a serial being edited
   was already backed up to the Sheet, the edit reverses the old
   pile/authority effect and re-applies the new one atomically.
8. In the background (immediately if online, or the next time
   connectivity returns), the sync worker pushes the transaction to the
   Google Sheets backup log — appending a new row for a never-backed-up
   transaction, updating the existing row (matched by serial) for an
   edit. This is invisible to the user beyond the header's sync-status
   icon.
9. Voiding a transaction (available from its own detail view) marks it
   `Cancelled` — never a hard delete — reverses its pile/authority
   effect, and pushes the status change to the Sheet backup.

## 4. Admin Configuring Warehouses, Users, and Authorities

1. Admin taps Settings, then opens the Admin Dashboard (a full-screen
   overlay, entering with the same pop transition used by transaction
   forms).
2. The dashboard is grouped into four sections, each with its own
   sub-tabs, following the real dependency chain of the data:
   - **Structure**: Provinces → Branches → Warehouses → Users.
   - **Inventory**: Varieties, Sack Types, Beginning Balances.
   - **Operations**: Customers, Miller Allocations, Transaction Types,
     AI/SIA (read-only view of synced authority data).
   - **System**: Signatories, Visitor Access, Sheet Sources, Data Start
     Date, Backup, Error Log.
3. A typical first-time setup sequence: create a Branch → its Provinces
   → each Province's Warehouses (setting `facilityType` to Warehouse,
   Ricemill, or Mechanical Dryer as appropriate) → Users (assigning
   role and one or more warehouses, setting an initial PIN) → Variety
   Types and Sack Types (with per-condition tare weights) → Signatories
   (the report sign-off block) → Sheet Sources (the production
   spreadsheet's URL, sheet names, and effective date range).
4. Configuring the Google Sheets bridge is done once per source: the
   admin enters the Apps Script Web App URL and the exact sheet-tab
   names for AI, SIA, transactions backup, and (for milling) MO/TMO.
   Warehouse and customer name mismatches between the Sheet's own
   nicknames and this app's canonical records are resolved via the
   Warehouse Aliases / Customer Aliases / User Aliases admin panels —
   an ongoing task as new spelling variants are discovered in live data,
   not a one-time setup step.
5. Closing the Admin Dashboard plays the reverse pop transition and
   returns to Settings.

## 5. AI/SIA Reconciliation Flow

1. Authorities sync into the app automatically and periodically (login,
   reconnect, and on an interval) from every configured Sheet source —
   this is read-only from the app's perspective; nothing the app does
   ever writes back to the AI/SIA sheets.
2. A regular user sees their own warehouse's pending/completed
   authorities surfaced in Piles (via the Authority Monitor panel); an
   Admin/Visitor sees every warehouse's authorities cross-warehouse in
   Monitoring.
3. Each authority shows its actual issued-vs-allocated balance, large
   and color-coded (neutral while pending, green at exactly Complete,
   crimson if Over-Issued) — this figure is always derived from real
   transaction data linked to that authority's number, never a manually
   entered running count.
4. Recording a WSI (or an SIA-linked ESI) against an authority's number
   automatically updates that authority's issued total the moment the
   transaction saves — no separate reconciliation step is needed for
   the common case.
5. For an authority that will legitimately never balance perfectly on
   paper (e.g. a partial fulfillment tracked outside this app), an admin
   can manually mark it Completed from the Monitor — this only overrides
   the display; if the authority later becomes genuinely, fully issued
   through real recorded documents, it is never left stuck showing a
   stale manual-complete state alongside contradictory real data.
6. Milling Orders (MO/TMO) follow the same read-in, admin-completable
   pattern, tracked separately from AI/SIA since private millers'
   Milling/Test Milling work is authorized by MO/TMO number, not AI/SIA.

## 6. Reporting / PDF Export Flow

1. From Reports, the user picks a report category (Summary, Statement
   of Receipts, Recapitulation of Receipts, Statement of Issues,
   Recapitulation of Issues for stocks; Warehouse MTS Report, Statement
   of MTS Issues/Receipts, Weekly Recapitulation of Empty Sack
   Issues/Receipts for sacks; Pile Layout for the floor plan).
2. A period is selected via the app's own calendar picker or one of the
   built-in presets (1–7 / 8–15 / 16–22 / 23–end of month for the
   current or previous month, defaulting to the previous month during
   the first few days of a new one).
3. The report is generated by genuinely reconstructing historical state
   as of the selected period — replaying every relevant transaction up
   to that date, including WTS's two-sided effect — rather than always
   showing today's live totals; this is what lets a report be
   regenerated correctly for any past period, not just the current one.
4. Each cereal type with any real activity in the selected period gets
   its own generated report; a type with no activity is omitted rather
   than shown as a blank form.
5. The rendered report matches the real NFA paper form layout exactly
   (REGION/PROVINCE/CODE/WHSE header block, five-signatory sign-off),
   exported via jsPDF/jspdf-autotable as a PDF (or html2canvas as an
   image where relevant). No field is ever truncated — a long value
   wraps to multiple lines with its row height adjusted to fit.
6. The user shares or prints the exported file through their device's
   own OS share sheet — the app itself has no direct printer
   integration.

## 7. Pile Layout Flow

1. From Piles, the user opens the warehouse's floor-plan editor — a
   fixed 24×20 grid representing the physical warehouse floor.
2. Drawing a new pile's footprint on the grid shows a live green/red
   valid/invalid preview as the user drags, validated against the
   pile's actual content-driven size (which can exceed the footprint
   originally drawn for it) so a new box can never be placed somewhere a
   data-heavy neighbor will later grow into.
3. An existing pile can be moved to a new grid position without
   changing its size, with the same live validation.
4. A full-screen, rotated-landscape mode is available for reviewing the
   whole layout at once on a portrait phone — entered and exited with
   its own zoom/slide transition, distinct from the plain page-slide
   used for regular navigation.
5. A pile that drains to zero bags and kilos is automatically flagged
   (`zeroedDate`) and, after one full calendar day's grace period,
   becomes eligible for its grid box to auto-vacate — freeing that floor
   space for a new pile without requiring a manual "close pile" step
   first, though a manual close remains available.
6. Exporting the floor plan as a PDF always renders true warehouse
   proportions (never auto-cropped to just the currently-used area, the
   way the on-screen editor may appear) since the exported document must
   represent the whole physical space regardless of current occupancy.
7. Every box reassignment, move, or vacate snapshots the box's prior
   full geometry into `pileLayoutHistory` before overwriting it, so a
   past date's layout can be reconstructed exactly — not just which pile
   occupied a space, but its position and size at that time.

## 8. Offline-to-Online Sync Flow

1. The app is opened or continues running with no network connection.
   Every read and write completes normally against local Dexie data;
   the header's sync-status icon shows a static "pending" state rather
   than actively animating.
2. Connectivity returns (browser `online` event, or the periodic
   background retry timer fires regardless of that event, since mobile
   network transitions are not always reported reliably).
3. The sync worker acquires a cross-tab lock (Web Locks API, falling
   back to a same-tab in-memory flag where unsupported) so only one tab
   of the same device runs a sync pass at a time.
4. Every locally pending (`isSynced: false`) transaction is pushed to
   the Google Sheets backup log — a first-time push appends a new row; a
   transaction previously backed up (`hasBeenBackedUp: true`) has its
   existing row updated instead, matched by serial number, never
   duplicated.
5. Any queued offline deletions (`pendingSheetDeletions`) are replayed
   against the backup log.
6. Dexie Cloud independently and continuously syncs the full local
   database with every other device sharing the same shared service
   account identity, in the background, with no explicit user action.
7. The header's sync icon animates (pulses, then briefly shows a
   checkmark ripple) once a push completes; a toast summarizes how many
   records synced or failed. A failed push is retried on the next sync
   pass rather than requiring the user to manually resend it.
8. `isCloudSyncCaughtUp()` gates one specific risky operation — importing
   a placeholder copy of a transaction from the Sheet backup when a
   serial lookup finds nothing locally — so a device whose initial
   cloud pull hasn't fully landed yet never wrongly concludes a record
   doesn't exist and creates a second, duplicate copy of it.
