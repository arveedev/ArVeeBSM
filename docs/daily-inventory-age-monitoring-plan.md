# Daily Inventory and Age Monitoring: Build Plan

Status: PLAN ONLY. Nothing is built. Replaces the two Google Apps Script files
(`age monitoring.txt`, `daily inventory.txt`) with reports computed from the
BSM App's own data.

## 1. Decisions already made (from the owner)

| # | Decision |
|---|----------|
| 1 | Age is tracked **per receipt (lot)**, not per pile. If 500 bags cross into the next bracket, only those 500 bags move. |
| 2 | Three bracket sets (section 4). |
| 3 | By-products (DKA, DKB, DKC, BIN) are included. PHF and NFAO RM are included, with their special rules carried over. |
| 4 | Data starts **September 1, 2026**. A pile's start date is the anchor for stock that existed before the app; new receipts in the app start their own age. |
| 5 | Audience: Admin and Visitor, behind a hidden icon (same pattern as the other hidden admin/visitor tools). |
| 6 | Output also goes to a Google Sheet: daily inventory with SUMMARY, per-month, and MT views. |
| 7 | Daily Inventory and Age Monitoring always show **net bags**. MT views convert **net kilos / 1000**. |

## 2. Rules for how the data works

### 2.1 What a "lot" is
One lot = one receipt into one pile. It keeps its own received date, variety,
sack type and condition, and its own bags and net kilos.

Lot sources, all already in the app:
- A WSR (and any receiving WTS) creates a lot dated at the transaction date.
- A beginning-balance seed creates a lot dated at that seed line's date of
  receipt. Today a seed line has a free-text "Date Received/Procured" and an
  "As of" date. The age anchor needs a **real calendar date per seed line**. The
  fallback is the pile start date (`computePileStartDate`).
- A WTS **carries the lots' original dates** to the destination pile, so a
  transfer does not reset age. (Confirm in section 8.)
- Repiling or rebagging: the new bags keep the source lot's date.

### 2.2 Issues use first-in-first-out
A WSI, or the issuing side of a WTS, takes from the oldest lots in that pile
first. The old scripts relied on a typed age group on the AI row. The app has no
such field, so FIFO within the pile is the default. An optional "take from this
lot" choice on the issue form can come later if it is needed. The report flags
any issue larger than the lots available (a "discrepancy" like the scripts
show today, but listed per pile).

### 2.3 Age in months
The app stores age in days (`calculateCurrentAge`). A lot's age in months on a
report date is `days since received / 30.4375`, shown to one decimal, with
bracket edges inclusive on the upper side (1.0 belongs to 0.1-1.0), same as the
current scripts. Open question 8.3 confirms.

### 2.4 Override date and beginning balances (answer to the owner's question)
How it works in the code today:
- Each warehouse can carry its own **Reports Start Date** (`reportingCutoffDate`).
  The global `dataStartDate` is the fallback.
- The date that applies to a warehouse is the **later** of its own date and the
  global one (`effectiveCutoffDate`).
- Beginning-balance seeds (`isInitialBalance`) are always counted. Every normal
  transaction dated on or before the start date is ignored.

So the owner is right:
- Warehouses with complete September data: leave them alone. They keep
  September's real transactions, and October opens with their real September
  ending balance.
- Warehouses with incomplete September data: set **only their** Reports Start
  Date to September 30 and enter their beginning-balance seeds as of
  September 30. They start October from the seeds you typed.
- No other warehouse needs to be touched. To go back to real data later, clear
  that warehouse's date and delete its seeds.

Two things the new reports will add:
- Because lots need dates, each seed line you type for an override needs a real
  date of receipt (see 2.1). Without it, the lot gets the pile start date and
  its age is only approximate.
- The report header will show which warehouses are using an override date, so a
  reader knows which numbers come from typed seeds and which from transactions.

## 3. Calculation engine (one shared module)

New file `src/utils/inventoryLots.js`. Read-only. Does not write to the database.

`buildLots(asOfDate)` does one pass over the data:
1. Load transactions once (Active only), grouped by pile. No per-pile queries.
2. Apply each warehouse's effective start date (same rule as 2.4).
3. Walk each pile in date order: receipts add lots, issues take FIFO.
4. Return the lots remaining on `asOfDate`.

On top of that:
- `dailyMovement(date range)`: per warehouse, variety and day, the ADD by
  transaction type and LESS by transaction type, in bags and net kilos.
- `ageBuckets(lots, bracketSet)`: groups remaining lots into a chosen bracket set.
- `ageOutlook(lots, days)`: which lots cross the next bracket in the next N days.

The engine reuses `calculations.js`, `pileLedger.js`, and
`effectiveCutoffDate`, so sack-weight and cutoff rules stay in one place.

Performance rule (the owner has seen slow data retrieval): one transactions
query per report, no per-pile loops against IndexedDB, computed in a single
function. Report screens are lazy-loaded so the main bundle does not grow. This
is covered by the performance gate in section 7.

## 4. Age bracket sets

| Set | Used for | Brackets (months) |
|-----|----------|-------------------|
| A. Monthly | The detailed age monitoring grid | 0.1-1.0, 1.1-2.0, 2.1-3.0, ... one per month, up to 36 (the QA table's range) |
| B. Coarse | Rice; Palay | Rice: 0-3, more than 3. Palay: 0-6, 6.1-12, more than 12 |
| C. Fine (MT) | Rice, in MT | 0-3, 3.1-6.0, 6.1-9.0, 9.1-12.0, more than 12 |

Brackets live in one config object in the code so the labels cannot drift
between screens, PDF and Sheet.

## 5. Screens

Entry: hidden icon (Admin and Visitor), as the other hidden tools do. One page,
`Inventory Reports`, three tabs. Read-only. No changes to existing screens.

1. **Daily Inventory**
   - Pick a date or a month.
   - Rows: province, then warehouse; columns: variety. Subtotal per province
     and grand total.
   - Per day: beginning, ADD by type, LESS by type, ending, all in net bags.
   - Tap a figure to list the transactions behind it.
   - By-products, PHF and NFAO RM shown as their own sections with the rules
     from section 6.
2. **Age Monitoring**
   - Bracket set picker (A, B, C). Warehouse × variety × age bracket, net bags.
   - Oldest lots first list (pile, received date, bags).
   - "Crossing soon" list from `ageOutlook`.
3. **MT view**
   - The same two reports, converted to MT (net kilos / 1000), including the
     fine rice buckets (set C).

Plus a **Check** panel: discrepancies, overrides in use, issues that exceeded
stock, lots with no real date.

## 6. Special rules carried over from the scripts

- Excluded from totals but reported separately where the scripts did so:
  by-products DKA/DKB/DKC/BIN are now **included**, as their own section.
- PHF is not a reporting warehouse. Transfers out of PHF are added as
  MECHANICAL DRYING receipts in the receiving warehouse.
- NFAO RM is not a reporting warehouse. Its issuances are added to the receiving
  side.
- Provinces: Albay and Catanduanes come from the province record, not from a
  hand-kept map. Warehouse naming comes from the warehouse record, so the alias
  and trailing-letter merging code is not needed. (Confirm GID warehouses still
  group as they do today.)
- Duplicates: the app already blocks duplicate document numbers and has a
  cleanup tool, so the dedupe code is not needed.

## 7. Output: PDF, Excel, Google Sheet

**What the app can do today:** PDF only (jsPDF). There is no Excel export and no
code that creates a Google Sheet; the Google Sheets bridge pushes individual
transactions to existing sheets through an Apps Script web app.

**Planned:**
- **Excel (.xlsx):** add a spreadsheet library, loaded only when the Export
  button is tapped (so it adds nothing to normal use). A reusable
  `exportWorkbook()` helper takes the same tables the screens show, so any
  report can use it later (Stock Statement, Pile list, and so on).
- **Google Sheet:** extend the existing Apps Script web app with an action that
  takes the computed tables and writes the tabs: **SUMMARY**, one tab **per
  month**, **WAREHOUSE_AGE_MT**, and the age grid. The app computes the numbers
  and the script only writes them, so the script has no business rules of its
  own. Triggered by an **Export to Google Sheet** button, and optionally once a
  day by the app when an admin has it open. It needs the owner to deploy the
  updated script once. It also needs internet; offline, the button waits.
- Existing PDF look kept for the printed versions.

## 8. Open questions

1. Does a transfer between piles keep the lots' original dates? (Proposed: yes.)
2. For issues, is FIFO within the pile acceptable as the default?
3. Month length: `days / 30.4375`, or a flat 30 days per month, to match your
   Sheet's results?
4. Seed lines: add a real "Date of receipt" per seed line in Beginning
   Balances (needed for per-lot age on piles that existed before the app)?
5. Should the Google Sheet be a **new** spreadsheet (recommended, so the old one
   stays as a reference) or overwrite the current one?
6. Which spreadsheet does GSR read for the QA table, and should GSR point to the
   new one later? (Not needed to start.)

## 9. Build phases (each ends with a check; nothing ships until it passes)

| Phase | Work | Check before moving on |
|-------|------|------------------------|
| 0 | Confirm section 8. Add per-seed-line receipt date field, hidden, optional (non-indexed field, no schema bump). | Existing Beginning Balances screens unchanged when the field is empty. |
| 1 | `inventoryLots.js` engine + a **read-only test page** (no new menu entry yet). | For September, per warehouse and variety, the engine's ending balance **equals** the existing pile balances and the Stock Statement. Any difference is listed and explained before continuing. |
| 2 | Daily Inventory screen behind the hidden icon. | Compare against your daily inventory sheet for two chosen days; list the differences by bucket. |
| 3 | Age Monitoring screen (sets A, B, C), outlook list, Check panel. | Compare against the age monitoring sheet for a month-end. |
| 4 | Excel export helper (lazy-loaded). | Build size unchanged for the main bundle; the xlsx opens in LibreOffice. |
| 5 | Google Sheet export (script update + button). | Run against a **copy** sheet first; compare tabs with the screens. |
| 6 | Parallel run (below), then retire the scripts. | Owner sign-off. |

Safety rules for every phase:
- Reports only **read** data. No writes to transactions, piles or authorities.
- New files only, plus one entry in the hidden-icon area. No edits to existing
  report code, except the optional seed-date field in phase 0.
- No Dexie schema change in phases 0-5 (lots are computed, not stored). If daily
  snapshots are added later, they will be a separate, reviewed schema change.
- Performance check on a low-end profile (CPU throttled) before each release.
- Each phase is its own version, pushed separately so any one can be reverted.

## 10. What "run both in parallel, then retire the scripts" means

For about one month (e.g. all of October), the **Google Sheet scripts keep
running exactly as they do now**, and the new app reports run next to them. At
each month-end (and a few mid-month days) you compare the two, bucket by
bucket. Every difference gets resolved one of two ways: the app is right and the
Sheet had drifted, or the app has a bug that we fix. After one clean month, you
stop the Sheet triggers; the old scripts stay saved as an archive but no longer
run. Until then, nothing is switched off, so there is no risk of losing the
daily report.

## 11. Additions after the UI previews (planning only)

Decisions from the owner:
- Transfers keep the lots' original dates. Issues take the oldest lot **of the pile the stock was issued from**. Lots count months by a rule to be matched to the existing Sheet (checked by reading the script, not by asking).
- Optional per-line "Date of receipt" in Beginning Balances (blank = pile start date, flagged as approximate).
- Google Sheet export goes to a NEW spreadsheet, tested on a copy first. Excel export is added.
- Warehouse names: option **Combined** (BSI, BSI B, BSI C shown as BSI; GID names keep their letter) or **Separate**.
- Wide ledger: choose which warehouses to show on screen; the Sheet/Excel export keeps the full width.
- Reports show variety **and** age bracket for every warehouse; Daily ledger and Summary accept a day, a date range, or a whole month.
- Summary has province subtotals (Albay, Catanduanes) and a branch total. A warehouse can hold palay, rice and by-products at once; each commodity gets its own column group.

New reports (same hidden Inventory Reports area):
1. **Daily Procurement Status Report** (net bags of 50 kg). PD = dry palay, PW = wet palay, per province and branch, with weekly subtotal rows. CPF Balance per province = sum of every SDO's cash on hand in that province, plus Cash in Bank where the user chooses (Albay, Catanduanes, or not added). Reuses `buildCpfHistory` for the daily cash figures.
2. **Milling Liquidation per ricemill (regular format)**: issues (WSI, ESI, SIA) and receipts (WSR, ESR) per batch, from the milling order records.
3. **Test Milling Liquidation per ricemill**: TMO/TRL numbers, by-product columns DKA/DKC/BIN, a SUMMARY with unit prices and amounts, and signatories taken from settings.
Both liquidations export to PDF and Excel.

Open questions: how the app tells PD from PW (variety name prefix, or a field); where ricemill name/contractor and signatories are stored; unit prices for local rice and by-products on the test-milling summary (typed per export, or kept in settings); whether regular milling also needs a by-product summary.

## 12. Owner answers and final report rules (planning only)

- **Hide empty everywhere:** any variety column, warehouse row, or by-product column with no values is hidden on screen, PDF, Excel and Google Sheet. No "show all" switch.
- **PD / PW:** a palay variety belongs to PD or PW by the first two letters of its name (PDs, PDm, PD1s-A, PD2s-A = PD; PW1-A, PW1-B, PW2-A = PW). No new field.
- **Regular milling** now has the same by-product columns (DKA, DKC, BIN) and the same SUMMARY (local rice bags x unit price, less by-products) as test milling.
- **Filters on both liquidations:** miller, issuing warehouse, period (from / to), and batch (regular) or trial (test). The on-screen filter also drives the export.
- **Unit prices:** stored per ricemill in the app (rice WD1 per 50 kg bag, DKA, DKC, BIN per kg). They are editable on the liquidation itself; a change is saved for that miller and used from then on. Each export keeps the prices used in its own file.
- **Admin settings:** a "Milling prices and signatories" panel holds the per-ricemill prices, the miller contractor, and the signatory names (Milling Supervisor, Accountant III, BSQAO, Engineer III, Acting Assistant Branch Manager, Acting Branch Manager). Printed on every liquidation.
- **Storage:** new settings are kept in the existing reportConfig record and the ricemill records (new optional fields, no schema version bump). Reports read the milling order, WSI, ESI, WSR and ESR records; they write nothing.

## 13. Placement, triggers and responsive behaviour (planning only)

- **Entry:** a quiet icon (clipboard-data, 16-18 px, neutral grey, turns neon on hover or tap, same quiet style as the Total CPF history icon) in the right side of the Admin/Visitor Home header, beside the bell. Shown only when the signed-in role is Admin or Visitor. No new bottom-nav tab; no change to the nav pill or nav columns.
- **Opens:** a full-screen sheet over Home (same pattern as the warehouse detail modal), not a new route. Nothing in routing or ProtectedRoute changes. Closing returns to Home exactly as it was.
- **Hub:** six report tiles (Daily inventory, Summary, Age monitoring, Procurement status, Milling liquidation, Test milling). One column of tiles on phone, three on desktop.
- **Report screen:** period chip (custom calendar picker, start then end), a single "Filter and sort" button with a count badge, and an Export button (Excel, Google Sheet, PDF). All filters and sort options live in the Filter and sort sheet: a bottom sheet on phone, a side popover on desktop. Reset and Apply buttons.
- **Tables:** sticky first column, horizontal scroll inside the table only, never the page. Phone shows the most-recent period and keeps the same columns; desktop uses the extra width, not extra features. Large displays cap the content width and center it.
- **Unit prices:** one source of truth. Prices set in Admin settings are the stored values; editing a price on a liquidation updates that same stored value (with a visible "updated" tag), and an export records the prices it used.
- **Signatories** are shared across ricemills; only the miller contractor is per ricemill.
- **Calendar picker:** the existing CalendarDatePicker takes a single date. A range mode (pick start, then end, with the start highlighted while choosing the end) will be added as a new component that reuses its look; the existing picker stays untouched.

## 14. Icon placement revised (replaces the header icon in section 13)

The top-right header pill is shared by every role and is crowded on phones (cloud, bell, KG/MT, theme, logout), so the icon does **not** go there. It goes on the Admin/Visitor Home screen, in the "Net Bags by Province & Category" title row, right after the title text: a small grey clipboard icon (same quiet style as the Total CPF history icon, 15 px, 24 px tap area). Visitor and Admin see it; it is part of AdminHome only, so no other role and no global header or nav change. It opens the full-screen Inventory Reports sheet.

## 15. Icon style approved

The entry icon is a plain, dim grey clipboard glyph (14 px, no circle, no color, slightly lighter on hover) after the "Net Bags by Province & Category" title on the Admin/Visitor Home screen. The green dashed outline seen in earlier previews was a preview-only highlight and is not part of the app. Triple-tap on the "Dashboard" title remains the fallback if the icon proves too visible.

## 16. Status

Planning and UI previews approved: Daily ledger, Summary (province subtotals, combined/separate warehouse names, empty columns hidden), Age monitoring (per variety, crossing-soon list), Daily procurement status, Milling and Test milling liquidations, Filter and sort sheet, entry icon. Nothing is built. Next step, on the owner's go-ahead: Phase 0 (optional per-seed-line receipt date) and Phase 1 (read-only calculation and test page, compared against September pile balances and the Stock Statement).


## 17. Age anchor rules (confirmed by the owner)

- Beginning-balance lines: age starts from the "Date Received" text on that line or pile. A range starts at its **first** date (MAR 24 TO APR 4, 2025 = March 24). Month-only text starts on the **1st**. Blank or unreadable text falls back to the pile date and is flagged as approximate on the Check panel. No new Phase 0 field is needed.
- Every receipt entered in the app from September 1 (WSR, transfer in) ages from its own receipt date, one lot per receipt.
- Typed override balances behave like beginning-balance lines; receipts entered after the override date use their own dates.
- Months are calendar months (April 1 to October 1 is exactly 6.0) plus the days since the last monthly anniversary as a fraction of 30.44 days (changed in v1.10-323; the Sheet script used a plain 30.44-day count).

## 18. Build status (v1.10-302 to v1.10-309)

Built and live: Inventory Lots Check (Admin > System), Daily inventory ledger,
Summary, Age monitoring (monthly / coarse / fine brackets, moving-to-next-bracket
and oldest-stock lists), Data check, Daily procurement status, Milling and Test
Milling Liquidation per ricemill (Excel and PDF), Milling Prices settings,
Excel export for the table reports, Google Sheet export (Apps Script in
docs/inventory-sheet-export-script.js, setup in docs/inventory-sheet-export-setup.md).

Not built (by decision): daily snapshots (reports stay derived, so a corrected
old record corrects the report); a PDF for the stock tables (Excel and the
Google Sheet cover them); the optional per-seed-line receipt-date field (the
existing Date Received text plus the pile date is enough).

## 19. Changes after first use (v1.10-311)

- Tapping an ADD or LESS value on Daily inventory shows the documents behind it (document, customer, pile, amount); the same lines are cell notes in the Excel file and the Google Sheet.
- Daily inventory has an Admin-only **Opening balance** override: type the balance a warehouse, variety and bracket should start from at the end of the day before the first day. Only the differences are saved (`reportConfig.inventoryOpening`), they apply from that date to Daily inventory, Summary and Age monitoring only, and Clear removes them. Since v1.10-323 they are worked into the stock itself and age with it (before, they stayed frozen in one bracket). Piles, transactions and every other screen are unchanged.
- A day with only an age change is no longer listed, so the ledger ends with one ENDING INVENTORY.
- Age monitoring lists are split into palay and rice, and by-products, and each moving lot shows the bracket it moves to and the date.
- Data check: issued-more-than-received lists the document and its transaction type; a rebuilt-versus-stored difference on a closed or empty pile carries a note.
- Liquidations: one tab per ricemill, prices are labels (an Admin sees a pencil), no signatory box on screen (exports only), batch/trial range, and the printed layout shows only when it fits the width (otherwise cards), so it never scrolls sideways.
- (v1.10-312) Liquidations are always the printed table, scaled down to fit the window (it only scrolls if the window is far narrower than the form). Regular milling shows the date of every WSI. The summary lists palay issued by variety with a **milling fee** per bag, local rice received with a **trucking fee** per bag, and by-products per kilo; the fees are stored per ricemill under the variety name, the same values Admin > Milling Prices shows. Every report table keeps its header visible while scrolling.
- (v1.10-314) Every report table highlights the row and column under the mouse. Every report starts the day after the Data Start Date (September 1, 2026): an earlier date picked in any date picker is moved to that day, the default periods start there and the procurement month list begins with September. Warehouses with their own later start date (override) still follow it.
- (v1.10-316) **LESS comes from the authorities.** In Daily inventory, Summary and Age monitoring, an active AI (with a variety and a warehouse) reserves stock: on the authority's date its authorized kilos leave the available stock (oldest lot first, same warehouse and variety), so the same stock cannot be authorized twice. An authority that is already complete reserves only what was withdrawn. The WSIs and transfers that carry out an authority only use up that reservation (no second deduction); an issue beyond the authorization, or with no authority, still deducts on its own date. The cell notes then list the AI, the customer and the pile. Filter and sort can switch LESS back to WSI. The Lots check and the pile comparisons in Data check stay physical. Data check lists authorities that reserve more than the warehouse had (over-authorized) and is Admin only; the menu tiles have icons.
- (v1.10-317) **WSI never deducts in a report; authorities do.** The WSI option was removed. An authority reserves its own authorized kilos (or, once complete, what it issued) on its date, from the age bracket named in its Age Group column (0-3, >3, 6.1-12, >12, ...); an authority that names no readable bracket deducts from the oldest stock and is listed on the Data check, as are WSIs that no reserving authority covers (they are not deducted) and authorities that ask for more than the bracket held. The ADJUSTMENT row in Daily inventory is the difference between the day's ending stock and what that day's ADD and LESS rows explain: it names the pile when a pile was closed that day (closing zeroes what was left), otherwise it is a data gap.
- (v1.10-318) **Only a closed pile adjusts the inventory.** Each day's stock changes only by its ADD and LESS documents. Closing a pile zeroes what it still held, and that is the one adjustment: a row "PILE CLOSED: <warehouse pile>" whose values carry a note naming the pile. Any other change without a document (a beginning balance entered late, activity on a closed pile) is a gap: it is added up from the data start date and taken out of every later balance, so it never moves the Daily inventory or the Summary. The Summary equals the Daily inventory's ending for the same date. An Admin's opening-balance override remains its own row.
- (v1.10-319) In the reports a beginning balance is opening stock whatever date it was typed. One entered late (for example ABACORP A Pile 2, 434 bags typed on Sep 22 for stock already there on Sep 3) now exists from the start of the period; before this, the authorities that took that stock out earlier produced negative balances. The Lots check stays physical. An opening-balance override saved before this change was computed against the old figures: reopen Opening balance and check it.
- (v1.10-320) Combined names also merge dry palay: the m and s are ignored (PD1m-A and PD1s-A become PD1-A, PDm and PDs become PD); wet palay (PW) is left as it is. By-products are hidden by default; a visible toggle in the toolbar shows them. In the Daily inventory each day is a block: a date band with a heavy rule above it, then ADD and LESS on their own rows, then ENDING INVENTORY. An authority is one line in a value's note (total, customer, and the piles it was taken from). Stock moving to the next age bracket as it ages is not a document and has no row; the bracket a lot sits in is worked out each day from its receipt date.
- (v1.10-321) Corrections. Combined names merge only dry palay that has a number (PD1m-A + PD1s-A = PD1-A); PDm, PDs and PW stay as they are. The Summary closes each cereal type with a TOTAL column (palay, rice, by-products) and an ALL column. An authority is assigned to a warehouse with a variety and an age group, so its note is one line (document, customer, total) and never shows piles; the lots-and-piles handling stays inside the calculation. Daily inventory and Summary work out a lot's age bracket at the 1st of the month, so stock stays in one bracket all month and its move shows in the next month; Age monitoring uses the exact day and shows the movement. All of this lives only in the Daily inventory, Summary and Age monitoring (and their exports); no other screen or record uses it.
- (v1.10-322) Opening-balance override fix. The editor now saves the balance as typed (`t`) and the reports work out the correction (typed minus computed at the override date) every time, so the typed value always shows on the override date even when the calculation underneath changes. Before, only the correction was saved, so a later change in the computed stock (a late beginning balance, the new age brackets) moved the shown value away from what was typed. The correction is also placed in the column the view uses: Combined names merge the dry-palay letters (before, a PD1s-A correction sat in its own column), and another bracket set gets the nearest bracket (before, the override disappeared when the bracket set differed). The notice above the table shows whenever an override exists. Saves made earlier (correction only) keep working as they were; opening the editor and saving once converts them.
- (v1.10-323) Accuracy round. (1) Ages are counted in calendar months, so stock received exactly 6 months ago stays in 0-6 (it was pushed to 6.1-12 a day early; two authorities, AI 26320220 and 26320249 for VRT WD1 0-3, that could not find stock now do). (2) The opening-balance override is worked into the lots: a lower balance takes the difference out of the lots in its bracket, a higher one adds a lot of that age; so it ages like real stock and never leaves a negative or phantom cell in a later month. (3) A new month re-sorts stock into its brackets; the Daily inventory now says so: the beginning cells (and an AGE BRACKET MOVES row when a later month starts inside the period) carry a note per lot with the pile and receipt date, e.g. "Moved to >12 · BSI Pile 3A, received September 3, 2025". (4) The analysis walks up to 1,500 days (it silently stopped at 200 before) and reuses the lot state on days with no record. (5) Data check opens with a Stock book self-check: summary equals ledger ending, each day starts where the day before ended, every day balances, no negative balance, typed balances show as typed, the override is fully placed, Combined equals separate, ages agree with an independent count. Tested on the 2026-10-08 backup copy over 180 runs (3 bracket sets, separate and combined, 5 dates, random overrides) and by breaking the code on purpose to confirm each check catches it.

