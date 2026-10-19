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
