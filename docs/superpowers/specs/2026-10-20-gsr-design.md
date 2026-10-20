# GSR (Grains Situationer Report) generated from the app - design document

Status: DESIGN FOR APPROVAL (2026-10-20). Nothing is built. Companion: `docs/gsr-design-samples.html` (screens, sheets and audit file drawn with sample numbers). Earlier decisions: `2026-10-19-gsr-from-app-notes.md`.

## 1. Principles
1. **The warehouses' data in the app is the only truth.** The old GSR is an estimate and is never used as a reference.
2. **Every number is traceable.** Each figure in the report is backed by a list of documents in an audit file.
3. **The generator never guesses a cell.** Layout comes from one map, labels are checked before writing, values are read back after writing.
4. **Admin only.** Generating, settings and the Drive folder are Admin functions (same rule as Milling and Issuances).
5. **Counts from September forward only.** No baseline for earlier months.

## 2. Where it lives
A new Admin-only tile in the **Stock Desk** menu, after "Milling and Issuances": **GSR report** (icon: file-spreadsheet). Visitors never see it. The Stock Desk modal already builds its menu from a list of `{ id, name, desc, Icon }` and adds Admin-only entries conditionally (`isAdmin ? [...]`), so this is one more entry plus one more screen. Its settings live on a second tab of the same screen ("Settings"), not in the general Settings page.

## 3. The Generate flow (what the Admin does)
1. Open Stock Desk > GSR report.
2. The screen proposes the dates (section 3.1). The Admin can change them.
3. Press **Prepare**. The app computes all 11 sheets in memory (no file yet) and shows the **Check page**: totals that tie, items needing attention (blocking vs warning), and a thumbnail of each sheet.
4. If there is no blocking problem, press **Create in Google Drive**. The app sends the finished values to the Drive receiver, which creates two Google Sheets in `NEWGSR/{year}/{MM MONTHNAME}/`: the **GSR** and its **audit file**.
5. The app reads both back and compares (section 8). The result is shown with links to open each file. The run is logged.

### 3.1 Report date versus period reported
- The memo date is the day the report is made (default today). The period reported is the previous working day: Monday reports Friday to Sunday ("GRAINS SITUATIONER REPORT FOR OCTOBER 16-18, 2026"), any other day reports yesterday. The Admin can edit both dates (holidays, special periods).
- File name: `GSR OCTOBER 16-18` (a single day: `GSR OCTOBER 15`). A second run for the same period makes `GSR OCTOBER 16-18 (2)`; nothing is overwritten.
- "Today" columns mean the period reported; "For the month" means the 1st of the month of the period's last day through the period's last day; "For the year" means September 1 (data start) through the last day.

## 4. Output and Drive
- Google Sheets, not Excel. Folder `NEWGSR/{year}/{MM MONTHNAME}/` (for example `NEWGSR/2026/10 OCTOBER/`), created if missing.
- A separate Apps Script web app (the same receiver pattern as the backups: secret token, `/exec` address stored in Vercel variables, called from a new `api/gsr-publish.js`). It only creates files in the one designated folder and cannot read or delete anything else. A separate script from the backup script, so a GSR problem can never affect backups.
- The sheets are **written as values with real formulas for the totals** (sub-totals, province totals, grand totals), so a person editing a cell in Drive sees the totals recompute. The audit file records the values the app computed, so any hand edit can be detected later (a "compare with the app" button re-reads the Drive file).
- Page setup (paper size, orientation, fit to one page wide, column widths, merged headers) reproduced per sheet from the layout map.

## 5. Admin settings (second tab of the GSR screen)
| # | Setting | What it holds | Why |
|---|---|---|---|
| 1 | **Warehouse columns** | Which warehouses appear, in what order, under which province, with the report's column title. Lettered variants are merged by the app's warehouse `code` (BSI + BSI B + BSI C = 050522). Only facility type "Warehouse" is listed. | One column per warehouse, no guessing |
| 2 | **Variety names** | Map of app varieties to report names (PD1m-A, PD1s-A ... to PD1-A, PDm, PW ...), separately for palay and rice, with the sheet row order. | Report names differ from app names |
| 3 | **Age brackets and grades** | The month brackets (0-1.0, 1.1-2.0 ...) and the grade letter of each age band (A, B, C, D, E). | Age by receipt date, grade per table |
| 4 | **Distribution schemes** | The list of scheme lines (I Disaster/Relief: DSWD, OCD, OVP, Senators, Congressmen, LGUs, PNRC, NDRRMC, Other agencies, NGOs; II Non-relief: DSWD, LGUs, Legislators, BJMP, Provincial Jail, EO 51, Other agencies, NGOs, DA-FTI Kadiwa/P20, FTI P20, DOLE-DA P20, FTI-LGU; III, IV, V) and the rule that puts a sale on a line: by keywords on the customer name and/or the transaction type (first match in the listed order wins). **A sale that matches no line stops the run** (no silent "other"). | The Admin sets the scheme |
| 5 | **Price columns** | Which selling price goes under P29, P33, P35, P32, P39 (price and, where needed, age tier or scheme). A price with no column stops the run. | Report columns are fixed |
| 6 | **Targets and awards** | Monthly and yearly procurement targets per province, award volumes and dates for PROC.MILL. | Typed numbers in the old file |
| 7 | **Memo and signatories** | Reference number format, "FOR" line, subject line, signatories (reuses the app's signatories). | The page header |
| 8 | **Drive** | Folder name prefix (NEWGSR), the receiver address check ("Test connection" button). | Output |

Each setting screen has a **Preview of the effect** line ("Last month this puts 5,507 bags under P35") so a wrong setting is seen before generating.

## 6. The 11 sheets, one by one
All amounts are net bags unless stated. "Authority amount" always means the authorized amount only (never the WSI weight), the same rule as the Daily inventory.

| # | Sheet | Source in the app | Rule | New data needed |
|---|---|---|---|---|
| 1 | **PALAY INVENTORY** | Stock Desk lots engine (`inventoryLots.js`) as of the last day of the period | Stock by variety x month bracket x warehouse column, grade letter from setting 3, province sub-totals, grand total. Memo header from setting 7. | none |
| 2 | **RICE INVENTORY** | Same lots engine, rice varieties (WD1, WD2, RWD1, WD0) | Same layout. The "unwithdrawn / potential stocks" block = authorities issued but not yet withdrawn, from the authorities table. The old RR1 stray block is not reproduced unless the Admin lists it as a variety. | none |
| 3 | **DISTRIBUTION PER VARIETY** | Authority-based issuances (SALES, SALES (CONSIGNMENT)) | Rows: today, for the month, daily average, cumulative for the year, each by province and variety, in net bags, net kg, MT. Daily average = month total / days elapsed in the month up to the period end. | none |
| 4 | **DIST. (TODAY)** | Same issuances, scheme map (setting 4) and price columns (setting 5) | Scheme lines x P29/P33/P35/P32/P39 x Albay, Catanduanes, Branch. | none beyond settings |
| 5 | **DIST. (MONTH)** | Same | Same layout, month range. | none |
| 6 | **DIST. (YEAR)** | Same | Same layout, September 1 through the period end. | none |
| 7 | **DISPERSAL** | Authorities with a regional authority number; TRANSFER receipts and issues | Inflow inter-regional and intra-regional: source, carrier, destination, wire authority, variety, authorized volume, actual today / month / cumulative in gross and net bags, balance. Outflow: by date to other provinces. | **Carrier name** and **vessel** (outflow), outflow destination class (inside the branch / outside branches / from other regions) on the transfer documents |
| 8 | **PROCUREMENT 1** | Procurement WSRs by variety, individual versus cooperative | Per scheme, participant and variety: today / month / year, per province, bags of 50 kg. | **Procurement mode** (stationary, in-field, indirect PALLGUs) on each procurement WSR |
| 9 | **PROCUREMENT 2** | Procurement totals, farmer counts, SDO cash on hand and in bank | Daily average, targets (setting 6), % accomplishment, farmers served, CPF balances, Jan-Dec monthly target and actual (months before September show no actual) | none beyond settings |
| 10 | **PROC.MILL** | Procurement overview, PRs, milling (regular and test) | Procurement and milling status, unpaid deliveries (a WSR without a PR), farmers served, test milling per ricemill (palay issued, rice recovered), awards (setting 6). "In process" is dropped. | none beyond settings |
| 11 | **PRICES** | New weekly price entry | This week / last week, prevailing, low, high, per province. "This week rolls into last week" at the first entry of a new week. | **Weekly price form** (section 9) |

Dropped: INVENTORY summary (TEMRI, days to last) and `_Config_`.

### 6.1 Every row is always shown (owner, 2026-10-20)
Rows come from the layout, never from the data. A line with no activity still prints, with 0 (or a dash where the old report leaves it empty):
- **DIST. (TODAY / MONTH / YEAR) and DISTRIBUTION PER VARIETY:** every scheme line (I A-J, II A-L, III, IV, V), every price column and every province, even when the whole period is zero.
- **PROCUREMENT 1 and 2 and PROC.MILL:** every scheme, participant type, mode and variety row, and every month of the Jan-Dec table.
- **DISPERSAL:** every section and total row is always printed. The inflow and outflow lines are one per wire authority that is still open or has activity this month or cumulatively; an authority with nothing moving this period still shows its authorized volume, cumulative figures and balance. The Admin can also pin an authority so it always shows.
- **PRICES:** every commodity row for every province; a price not yet entered this week shows as blank with a "no entry" mark in the audit file, never as 0.
- **Inventories:** every variety and every age bracket row, as today.

## 7. The audit file
A second Google Sheet in the same folder: `GSR OCTOBER 16-18 - AUDIT`. Tabs:
1. **Summary**: run details (who, when, memo date, period, app version, database id, row counts), the result of every check, and the list of warnings.
2. **Cells**: one row per figure in the GSR: sheet, cell, row label, column label, value, number of documents, and a link to the matching rows in the Documents tab. This is what lets an auditor take any cell and see what is behind it.
3. **Documents**: one row per document counted: type, number (WSR / WSI / PR / authority), date, warehouse (report column), pile, variety, customer, scheme line, price column, bags, kilos, and the cell(s) it landed in.
4. **Excluded**: documents seen but not counted, with the reason (outside the period, non-Warehouse facility, before September, voided, closed-pile guard).
5. **Settings used**: a snapshot of settings 1-8 at the moment of the run, so the same report can be explained later even if settings change.

The audit file is generated by the same code that computes the GSR (one pass), so the two can never disagree. It is read-only for everyone except the Admin.

## 8. Accuracy safeguards
1. **Layout map**: each output cell is defined once (sheet, row key, column key). No cell is written by position guessing.
2. **Label check before writing**: the generator writes the row and column titles first and re-reads them; a mismatch stops the run.
3. **Read-back after writing**: every value, every total and every cross-sheet tie is read back from Drive and compared; a mismatch is shown and the files are marked "NOT VERIFIED" in their title.
4. **Ties between sheets**: inventory totals = Stock Desk Summary totals; DIST. (TODAY/MONTH/YEAR) totals = DISTRIBUTION PER VARIETY totals; procurement totals = Daily procurement status; dispersal balances = authorities.
5. **Blocking checks**: a sale matching no scheme line; a price with no column; a warehouse with no column; a variety with no report name; a document dated after its pile was closed (existing Data check); a period inside an unfinished import.
6. **Warnings** (shown, not blocking): authority reserving more than available; approximate ages.
7. **One-time hand check**: before the generator is trusted, the owner picks one period and checks the audit file against the warehouses' own documents. The first live run is labelled "FIRST RUN - HAND CHECK" until the owner turns it off.
8. **Run log**: each run stored (who, period, counts, check results, links).

## 9. New data capture
| What | Where | How |
|---|---|---|
| Weekly prices (farm-gate, wholesale, retail, per commodity and province) | Stock Desk > GSR report > "Prices" tab (Admin) and optionally the SDO | Form with this week / last week; a new week copies this week to last week |
| Procurement mode | Not asked on the WSR form. Set by the Admin in batches from the GSR screen ("Procurement mode" tab): choose a period, warehouse or document list and mark them In-field or Indirect (PALLGUs). | Everything is **Stationary by default**, since that is what nearly all procurement is today; the Admin only marks the exceptions. |
| Weekly prices | Admin only | |
| Dispersal carrier, vessel, outflow destination class | Transfer receipts / WTS | Optional text/choice fields; older documents show "-" |

## 10. Data model (schema v49, proposal)
- `gsrSettings` (synced): `{ id, key, value, updatedAt, updatedBy }` for settings 1-8 (one document per setting, JSON value).
- `gsrPrices` (synced): `{ id, weekStart, province, commodity, prevailing, low, high, createdBy }`.
- `gsrRuns` (synced): `{ id, memoDate, from, to, createdAt, createdBy, status, driveGsrUrl, driveAuditUrl, checks }`.
- New optional fields on transactions: `procurementMode`, `carrier`, `vessel`, `outflowClass` (no migration needed).
- Admin-only enforced in the UI, same as the existing service tables.

## 11. Build order (follows the sheet order) and tests
1. Layout map, Check page, run log, Drive receiver and "Create" path with sheet 1 only (PALAY INVENTORY), plus audit file with sheet 1. Test with a scratch Drive folder and the practice database.
2. Sheet 2 (RICE INVENTORY).
3. Sheets 3-6 (distribution) with settings 4 and 5.
4. Sheet 7 (dispersal) with the new transfer fields.
5. Sheets 8-10 (procurement) with the new mode field and setting 6.
6. Sheet 11 (prices) with the weekly form.
Each step: unit tests for the pure calculators (`tests/gsr-*.test.mjs`), a tie test against the Stock Desk, the generate-and-read-back test against a scratch folder, docs updated.

## 12. Decisions (owner, 2026-10-20)
1. Stock Desk tile with Prepare / Check / Create flow: **approved**.
2. Separate Apps Script receiver for GSR: **approved**.
3. Procurement mode: **not required per WSR**; Admin sets it in batches, default Stationary (section 9).
4. Weekly prices: **Admin only**.
5. Scheme rule: **by keyword** (on the customer name and the transaction type), checked in the listed order, first match wins, no match stops the run. No customer categories.
6. "FIRST RUN - HAND CHECK" label: explained to the owner; kept as proposed unless they say otherwise.
7. Every row of the distribution, dispersal, procurement and prices sheets always prints, even with no data (section 6.1).
8. Rows with no data print a **blank cell, never 0** (a total that adds up to 0 is blank through the number format). Owner, 2026-10-20.
9. **Tally rule**: every GSR is checked against the warehouses' own totals for the period it reports (per warehouse column: opening + received - issued + the Stock Desk's corrections = ending = printed); any difference blocks the file. Owner, 2026-10-20.
10. The "FIRST RUN - HAND CHECK" label is kept. Step 1 (PALAY INVENTORY, audit file, Drive receiver) is built; guide: `docs/gsr-drive-setup.md`.
