# GSR (Grains Situationer Report) generated from the app - planning notes

Status: PLANNING, not a design yet (2026-10-19). Source: the owner's real report `BSM-Safety\GSR\GSR OCTOBER 16-18.xlsx` (13 sheets, a 6-page report), read on 2026-10-19.

## Decisions by the owner
- The Admin generates the GSR **from the app**; the file appears in a **designated Google Drive folder**.
- The distribution scheme is **set by the Admin** (a settings screen), not hardcoded.
- The report counts **from September (data start) forward only**; no year-to-date baseline for earlier months.
- The generated file must contain **the same sheets** as the real report, in the **same order, starting with PALAY INVENTORY** (all of them except `_Config_`, which is left out: 12 sheets) and in the same layout, refreshed **daily or for a chosen period** (the example is `GSR OCTOBER 16-18`: a period file named for the period reported).
- The existing Google Apps Script generator (docs/gsr-*.js, August) is "not even near" the real report, so it is replaced, not extended.

## The real report, sheet by sheet (what it shows and where the app's data would come from)

| Sheet (page) | What it shows | Source in the app |
|---|---|---|
| PALAY INVENTORY (1) | Memo header (date, FOR: Regional Manager, SUBJECT). Palay stock by variety (PDm, PD1-A ...), age in monthly brackets (0-1.0, 1.1-2.0 ... to 5 years, with a grade letter A/B/C by age), one column per warehouse (code row such as 50502) grouped by province (Albay, Catanduanes) with sub-totals and grand total. | Stock Desk lots (age monitoring) as of the report date, by warehouse, variety and month bracket. |
| RICE INVENTORY (2) | Same layout for local rice (WD1, WD2, RWD1 ...), warehouse columns, plus the unwithdrawn / potential stocks block. | Lots plus authorities (unwithdrawn = authorized not yet issued). |
| DISTRIBUTION PER VARIETY | Sales today / for the month / daily average / cumulative for the year, by province and variety (WD, WD2, RWD1), in net bags, net kgs and MT. | Authority-based issuances (Milling and Issuances / Daily inventory rules: authorized amount only). |
| DIST. (TODAY) / (MONTH) / (YEAR) | Sales per **scheme** (I Disaster/Relief/Calamity: DSWD, OCD, OVP, senators, congressmen, LGUs, PNRC, NDRRMC, other agencies, NGOs; II Non-relief/special projects: DSWD, LGUs, legislators, BJMP, provincial jail, EO 51, other agencies, NGOs, DA-FTI Kadiwa/P20, FTI P20, DOLE-DA P20, FTI-LGU; III Food security emergency; IV Public auction; V One-time rice assistance) x price columns (P29, P33, P35, P32, P39) per province (Albay, Catanduanes) and for the branch. | Needs the **Admin-set scheme map**: customer name keyword (LGU, FTI, Jail...) or transaction type to scheme, and the price per age tier per scheme. |
| DISPERSAL (4) | III Inflow: A inter-regional, B intra-regional (source, carrier, destination, wire authority, variety, authorized volume, actual volume transferred today / month / cumulative in gross and net bags, balance, remarks). IV Outflow: dispersal to other provinces by date. | TRANSFER authorities (regional authority number), WTS and transfer WSR/WSI. The owner's three categories: inside the branch, to outside branches, from other regions. |
| PROCURMENT 1 / 2 (the sheet name misses the E) | Palay procurement per scheme and participant (individual FA, cooperatives ...) today / month / year, per province, targets, daily average. | Procurement WSRs (from September), PRs, per-participant data. Targets are settings. |
| PROC.MILL (5) | Procurement and milling status, unpaid deliveries. | Procurement overview, PRs, milling data. |
| PRICES (6) | Weekly NFA cereal price monitoring: this week / last week, prevailing, low, high, per province (palay dry/fresh, regular and well-milled rice ...). | Weekly input form (admin or SDO) with "this week rolls into last week". |
| INVENTORY | Branch summary: local rice, palay, TEMRI (palay x 0.63 + rice), total potential stocks, days to last. | Computed from the two inventory sheets. |
| _Config_ | Hide/unhide helper from the old workflow. | Not needed (dropped earlier). |

## Observations about the real file
- Many cells are hand-typed arithmetic (for example `=3.78+1163.92-1000+122.58-...`): the report is currently maintained by hand on top of the formulas; the generator should write clean values and keep the formulas that add rows and columns.
- Sheet names are page-numbered in the file ("PAGE 2 of 6" ...), and the layout is fixed print layout: the generator must reproduce column widths, merged headers and print order.
- Warehouse columns and codes (50502 etc.) are fixed per province: they need an Admin-maintained list (which warehouses appear, in which column, with which code).

## Proposed build order (to be confirmed)
1. Page 1 and 2: Palay and Rice inventory plus the INVENTORY summary (the data already exists in the Stock Desk).
2. Distribution per variety and the three scheme sheets, with the Admin scheme map screen.
3. Dispersal.
4. Procurement 1, 2 and Proc.Mill.
5. Prices (needs the weekly input form).
6. Output to the designated Google Drive folder (same receiver pattern as the backups: an Apps Script web app writes the file into the folder) and a Generate button in the Admin area with period dates.

## Open questions
- Which page first, and is the build order right?
- The designated Drive folder: a new folder under `GSR/{year}/{MM MONTHNAME}/` as before, or one flat folder?
- Output format: Excel (.xlsx, opens in Drive) or a Google Sheet?
- Catanduanes: is its data in the app (warehouses and users) or still entered elsewhere?
- Which weekday/lag rule: a GSR dated today covers yesterday's transactions (as in the August notes)?

## Still in planning (owner, 2026-10-19: "leave the GSR on plan mode")
Nothing is built. Open item to settle in planning: the `_Config_` sheet (the old hide/unhide helper) is one of the 13 sheets, but the earlier decision was to drop that mechanism; confirm whether it is reproduced as it is or left out of the 13.

## Settled in planning (2026-10-19)
- `_Config_` is left out. The file has the other 12 sheets, in the real order: PALAY INVENTORY, RICE INVENTORY, DISTRIBUTION PER VARIETY, DIST. (TODAY), DIST. (MONTH), DIST. (YEAR), DISPERSAL, PROCUREMENT 1, PROCUREMENT 2, PROC.MILL, PRICES, INVENTORY. (The sheet name "PROCURMENT" in the old file is a typo; confirm whether the new file keeps or corrects it.)
- Build order follows the sheet order, starting with the palay inventory.
- Drive folder: `NEWGSR/{year}/{MM MONTHNAME}/` (the `NEWGSR` prefix separates the app's reports from the old ones).
- Still open: output as an Excel file or a Google Sheet; whether Catanduanes data is in the app; the reporting lag rule; whether to keep or correct the "PROCURMENT" spelling.

## Settled in planning, part 2 (2026-10-19)
- Output: a **Google Sheet** (not an Excel file), saved in `NEWGSR/{year}/{MM MONTHNAME}/`.
- Spelling: the new file says **PROCUREMENT 1 / PROCUREMENT 2** (corrected).
- Catanduanes **is in the app**: warehouses CTD-GID 2, CTD-GID 2 A and CTD-NFAO RM (province Catanduanes). The real report has Catanduanes columns GID 1 and GID 2; the app has no "GID 1" warehouse, so the mapping of report columns to app warehouses must be an Admin-maintained list.
- **Report date versus period reported** (from the two example screenshots): the memo date is the day the GSR is made; the data reported is the PREVIOUS working day. A GSR dated Friday October 16 reports October 15 ("GRAINS SITUATIONER REPORT FOR OCTOBER 15, 2026"); a GSR dated Monday October 19 reports Friday to Sunday ("... FOR OCTOBER 16-18, 2026"). The file is named for the period reported (for example `GSR OCTOBER 16-18`). Default rule: Monday covers the previous Friday to Sunday, any other day covers yesterday; the Admin can change the dates before generating (holidays, special periods).
- Still open: how the report's warehouse columns map to the app's warehouses (including GSR columns such as ROREDO GYM, BSI-B, GID 1 that may have no matching app warehouse).

## Settled in planning, part 3 (2026-10-19): warehouses are combined
- The report no longer has one column per warehouse. Like the Daily inventory's combined view, the data of **all warehouses is combined by province**: one column for **Albay**, one for **Catanduanes**, and the grand total (the app already knows each warehouse's province, so no mapping list is needed).
- Only facilities whose **facility type is "Warehouse"** are included. Other facilities (the app marks them: for example ALB-PHF SHED is a Mechanical Dryer, CTD-NFAO RM is a Ricemill; the real report's ROREDO GYM and similar columns) are left out.
- In the app today the Warehouse-type facilities are 17 in Albay and 2 in Catanduanes (CTD-GID 2, CTD-GID 2 A). ALB-NFA OWNED and ALB-SY are of type Warehouse but have no documents; they count as zero.
- The old open question about warehouse column mapping is closed.

## CORRECTION to part 3 (owner, 2026-10-19): still one column per warehouse, but lettered variants are merged
Not combined by province. The report keeps **one column per warehouse**, with the lettered variants merged into one: BSI + BSI B + BSI C = BSI. The app already carries a warehouse **code** that does exactly this grouping (050522 for all three BSI, 050520 for ABACORP / ABACORP A / ABACORP B, 050502 LEGAZPI GID and GID A, 050501 TABACO GID A and B, 050555 KINALE and KINALE A, 050563 VRT and VRT A, 052011 CTD-GID 2 and GID 2 A), and it matches the code row of the real report (50502, 50520, 50522 ...). Rule: group Warehouse-type facilities by code; other facility types (dryer PHF SHED, ricemill NFAO RM, ROREDO GYM) are left out; provinces keep their sub-totals (Albay, Catanduanes) and the grand total.

## Coverage analysis of the real report (2026-10-19, `GSR OCTOBER 16-18.xlsx`, 12 sheets without `_Config_`)
Method: every sheet was read cell by cell (formulas and cached values). About 3,130 data or formula cells; most "formulas" are hand-typed arithmetic (for example `=3.78+1163.92-1000+...`), i.e. the report is tallied by hand today. The inventory page even says "Age and quantity are tallied based on QUASAR data as of June 2026".

| Sheet | Cells | What it needs | Supply from the app today | Missing |
|---|---|---|---|---|
| PALAY INVENTORY | ~680 | stock by variety x month-age x warehouse, grade letter per age band, province sub-totals, memo header, signatories | Yes: Stock Desk lots (age by receipt date), warehouse code grouping, province, signatories table | variety name map (report PD1-A/PD1-B/PD2-A/PDm/PDs/PW vs app PD1m-A, PD1s-A, PD2m-A...), the age-band to grade-letter table, memo number (blank today), "PD" roll-up band definitions |
| RICE INVENTORY | ~400 | same for WD1, RR1, RWD1, WD0 plus unwithdrawn / potential stocks block | Yes (lots plus authorities not yet issued) | RR1 does not exist in the app (stray block); WD2 is in the report but not in the app |
| DISTRIBUTION PER VARIETY | ~70 | rice sales today / month / daily average / year by province and variety, net bags, kg, MT | Yes for totals (WSI of SALES types) | the rule of which transaction types count as sales; WD2 |
| DIST. (TODAY / MONTH / YEAR) | ~1,100 | sales per scheme (about 33 scheme lines) x price column (P29/P33/P35/P32/P39) x province | Only the totals; the split needs the scheme map | Admin scheme map (customer keyword or type to scheme line), price column per scheme and age tier, year column starting September |
| DISPERSAL | ~85 | inflow inter-/intra-regional by wire authority (source, carrier, destination, authorized volume, actual today/month/cumulative gross and net bags, balance), outflow to other provinces by date | Partly: authorities with regional authority numbers, TRANSFER receipts and issues, source warehouse | carrier name, gross bags split, outflow destination classification (inside the branch / outside branches / other regions), historic outflow lines before September |
| PROCUREMENT 1 | ~230 | palay procurement per participant (individual / IPP), mode (stationary / in-field / PALLGUs), by variety, today / month / year, per province | Partly: procurement WSRs by variety, individual versus cooperative (customer flag) | procurement mode (stationary versus in-field versus indirect) is not captured; the app treats all as stationary |
| PROCUREMENT 2 | ~240 | daily average, targets, % accomplishment, farmer counts, CPF balances, Jan to Dec monthly target and actual | Mostly: procurement totals, farmer counts, SDO cash on hand and in bank (CPF) | monthly and yearly targets (Admin table), Jan to August actuals (report counts from September only) |
| PROC.MILL | ~210 | procurement, unpaid deliveries, farmers served, CPF totals, test-milling per ricemill (palay issued, rice recovered) | Mostly: unpaid = WSR without a PR, milling per ricemill (built in Milling and Issuances) | targets, award volume and date table, "in-process" dropped by the owner |
| PRICES | ~90 | weekly cereal prices (farm, wholesale, retail) this week and last week, per province | No | a weekly input form with the this week to last week roll |
| INVENTORY | ~13 | rice, palay, TEMRI (palay x 0.63 + rice), potential stocks, days to last = TEMRI / DCR | Computed from the two inventory sheets | DCR (9,900 Albay; 1,810 Catanduanes) is a typed number: an Admin setting |

Rough share by cell count: about 65% can be filled from data the app already has; about 90% once the Admin settings exist (scheme map, price columns, targets, variety map, age-grade table, DCR, award table); about 10% needs new data capture (weekly prices, procurement mode, dispersal carrier and outflow destinations).

### Checks against the app (live export of 2026-10-19, stock as of October 18, net bags, lettered warehouses merged)
- TABACO GID 32,203.19 and KINALE 24,511.37 equal the report exactly.
- BSI 74,484 against 72,971, ABACORP 6,713 against 3,738, LEGAZPI GID 3,844 against 2,324, VRT 3,721 against 3,660, CTD-GID 2 1,059 against 1,628 differ (to be reconciled: hand-typed arithmetic in the report, or entries in the app).
- Sales October 1 to 18 (rice WSI of SALES and SALES (CONSIGNMENT), Warehouse type only): app Albay 7,718 and Catanduanes 946 against the report's 5,636 and 666 for the month; October 16 to 18: app 81 against the report's 6. Not yet explained.
- Conclusion: the report cannot be trusted as a reference yet, so a reference day on which the office agrees the report is right must be chosen to test against.

### Keeping every value in the right cell, always
1. One layout map: each output cell is defined once (sheet, row label, column label), not by guessing positions.
2. Before writing, the generator reads the template's own header labels at those positions and stops if any label differs.
3. Only values are written; the template's sum formulas stay, so totals recompute.
4. After writing, the generator reads the sheet back and checks every written value, every sub-total and grand total, and the ties between sheets (inventory to INVENTORY summary, DIST per scheme to DISTRIBUTION PER VARIETY), and shows a check page; a mismatch blocks publishing to the Drive folder.
5. A golden test on an agreed reference day (the owner's report and the app's data for the same day).
6. A log of each generation (period, who, source data version).
