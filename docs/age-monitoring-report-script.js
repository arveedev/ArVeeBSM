/**
 * Age of Stocks Monitoring — v2 (gap-fix pass)
 *
 * SETUP (one time):
 * 1. Create a second NEW, blank Google Spreadsheet (separate from the
 *    Daily Inventory one). This script goes in ITS Apps Script project.
 *    It only ever READS from the existing production spreadsheet — it
 *    never writes a single cell there.
 * 2. In this new spreadsheet, add a "Config" sheet with:
 *      B1 = URL of the existing production spreadsheet
 *      B2 = Monitoring start date (e.g. 2026-05-01)
 *      B3 = comma-separated list of admin emails allowed to generate
 *           the report (only admins can run it, per your requirement)
 * 3. Run "Initialize Setup Sheet" once from the menu — creates the
 *    (now much simpler) SETUP sheet and the QA_AGE_SUBMISSIONS sheet.
 * 4. Each month, QA opens "Submit Monthly Ages" from the menu, fills in
 *    the observed age (in months) per warehouse/variety, and saves.
 *    That becomes the anchor the report is computed from going forward
 *    — no more pure elapsed-time guessing drifting further from reality
 *    every month with nothing to correct it.
 *
 * WHAT CHANGED FROM v1:
 *
 * 1. ADMIN-ONLY generation + locked (LockService) — same as the
 *    Inventory script, so two overlapping runs can't corrupt output.
 *
 * 2. QA MONTHLY AGE ANCHORING (the structural fix): v1 computed every
 *    stock's age purely as elapsed time since receipt, forever, with a
 *    manually-typed SETUP baseline that only ever gets more stale. v2
 *    adds a real QA_AGE_SUBMISSIONS table (warehouse, variety,
 *    submitted age in months, submission date). For any warehouse+
 *    variety with a submission, THAT is the age anchor — the report
 *    projects forward from the submission date instead of from the
 *    original receipt date. Where no submission exists yet, it falls
 *    back to the old elapsed-time-since-receipt calculation, so nothing
 *    breaks before QA's first submission — but every month a submission
 *    comes in, that variety/warehouse's drift gets corrected instead of
 *    compounding.
 *
 * 3. FIFO SHORTFALL IS NO LONGER SILENT: v1's applyFIFO stopped when it
 *    ran out of stock in the matching age bucket, silently leaving the
 *    issuance partially unsubtracted. v2 tracks any shortfall and
 *    surfaces it in a "Data Discrepancies" block on the report — it's a
 *    real signal that an AI issuance and the recorded stock don't
 *    agree, worth someone's attention instead of being invisible.
 *
 * 4. SOURCE-ROW DEDUPLICATION: same fix as the Inventory script — before
 *    aggregating, receipts/issuances are deduplicated by document
 *    number + warehouse, with any duplicates found reported rather than
 *    silently double-counted.
 *
 * 5. SETUP IS NOW PURE CONFIG: v1's SETUP_AGE_MONITORING mixed
 *    configuration (start date, variety→category map) with "initial
 *    balances" that had to be manually kept in sync. v2's SETUP only
 *    holds the start date and the variety→category map — actual
 *    balances/ages come from QA's submissions plus the transaction log,
 *    never from a hand-maintained number that can silently drift.
 *
 * Everything not touched here (printTable rendering, the two-province
 * summary/detailed layout) is carried over from v1 — that part matched
 * your reference JSON and wasn't part of the bug list.
 */

const CONFIG = {
  SHEET_RECEIPTS: "DATA_ENTRY",
  SHEET_ISSUES: "AI",
  SHEET_REPORT: "AGE_MONITORING",
  CATANDUANES_WH: ["CTD GID 2"],
  RICE_VARIETIES: ["wd1", "wd2", "rwd1"],
  PALAY_VARIETIES: ["pds", "pdm", "pd1-a", "pd2-a", "pw"],
};

const SETUP_SHEET_NAME = "SETUP";
const QA_SUBMISSIONS_SHEET_NAME = "QA_AGE_SUBMISSIONS";

function onOpen() {
  SpreadsheetApp.getUi().createMenu('⏳ Age Monitoring')
    .addItem('⛳ Initialize Setup Sheet', 'initializeSetupSheet')
    .addItem('📝 Submit Monthly Ages (QA)', 'showAgeSubmissionForm')
    .addSeparator()
    .addItem('✅ Generate/Update Report', 'generateMonitoringReportManual')
    .addToUi();
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN GATE (report generation only — QA submission is intentionally open
// to QA staff, not just admins, since that's who's meant to use it)
// ─────────────────────────────────────────────────────────────────────────────

function getAdminEmails_(configSheet) {
  const raw = configSheet.getRange("B3").getValue();
  return String(raw || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function isCallerAdmin_(configSheet) {
  const admins = getAdminEmails_(configSheet);
  if (admins.length === 0) return true;
  const caller = (Session.getEffectiveUser().getEmail() || "").toLowerCase();
  return admins.includes(caller);
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP (pure config now — no manual balances to maintain)
// ─────────────────────────────────────────────────────────────────────────────

function initializeSetupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let setupSheet = ss.getSheetByName(SETUP_SHEET_NAME) || ss.insertSheet(SETUP_SHEET_NAME);
  setupSheet.clear();

  const headers = [
    ["VARIETY → CATEGORY MAP (Palay/Rice) — add every variety code you use", ""],
    ["Variety", "Category (Palay or Rice)"],
    ["WD1", "Rice"],
    ["PDS", "Palay"],
  ];
  setupSheet.getRange(1, 1, headers.length, 2).setValues(headers);
  setupSheet.getRange("A1:B1").merge().setFontWeight("bold").setBackground("#d9ead3");
  setupSheet.getRange("A2:B2").setFontWeight("bold").setBackground("#f3f3f3");
  setupSheet.autoResizeColumns(1, 2);

  const qaSheet = ss.getSheetByName(QA_SUBMISSIONS_SHEET_NAME) || ss.insertSheet(QA_SUBMISSIONS_SHEET_NAME);
  if (qaSheet.getLastRow() === 0) {
    qaSheet.getRange(1, 1, 1, 5).setValues([["Warehouse", "Variety", "Submitted Age (months)", "Submission Date", "Submitted By"]])
      .setFontWeight("bold").setBackground("#cfe2f3");
  }

  SpreadsheetApp.getUi().alert('Setup ready. Fill in every variety your warehouses use under SETUP, then use "Submit Monthly Ages" each month.');
}

/** Returns { varietyUpper: "rice"|"palay" } from the SETUP sheet. */
function readVarietyCategoryMap_(ss) {
  const setupSheet = ss.getSheetByName(SETUP_SHEET_NAME);
  const map = {};
  if (!setupSheet) return map;
  const values = setupSheet.getDataRange().getValues();
  for (let i = 2; i < values.length; i++) {
    const variety = String(values[i][0] || "").trim().toUpperCase();
    const cat = String(values[i][1] || "").trim().toLowerCase();
    if (variety && (cat === "rice" || cat === "palay")) map[variety] = cat;
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// QA MONTHLY AGE SUBMISSION FORM
// ─────────────────────────────────────────────────────────────────────────────

function showAgeSubmissionForm() {
  const html = HtmlService.createHtmlOutputFromFile('AgeSubmissionForm')
    .setWidth(600)
    .setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'Submit Monthly Stock Ages');
}

/**
 * NOTE: this project also needs an HTML file named "AgeSubmissionForm"
 * (Extensions > Apps Script > + > HTML) with a simple form: Warehouse
 * (dropdown or free text), Variety, Age in months, and a Submit button
 * that calls google.script.run.recordAgeSubmission(payload) — mirroring
 * the existing showEntryModal/processEntry pattern already used for
 * DATA_ENTRY in your warehouse-management script. Kept as a separate
 * HTML file per Apps Script convention rather than an inline template
 * string here, since this one is meant to be edited/extended by whoever
 * manages the QA form fields later.
 */
function recordAgeSubmission(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const qaSheet = ss.getSheetByName(QA_SUBMISSIONS_SHEET_NAME);
    if (!qaSheet) return { status: "error", message: "Run Initialize Setup Sheet first." };

    const warehouse = String(payload.warehouse || "").trim();
    const variety = String(payload.variety || "").trim();
    const ageMonths = parseFloat(payload.ageMonths);
    if (!warehouse || !variety || isNaN(ageMonths)) {
      return { status: "error", message: "Warehouse, Variety, and a numeric Age are required." };
    }

    // Overwrite this warehouse/variety's most recent submission for the
    // CURRENT month rather than appending a duplicate row for the same
    // month — keeps the sheet from accumulating repeat corrections.
    const values = qaSheet.getDataRange().getValues();
    const now = new Date();
    const currentMonthKey = Utilities.formatDate(now, "GMT+8", "yyyy-MM");
    let targetRow = -1;
    for (let i = 1; i < values.length; i++) {
      const rowWh = String(values[i][0] || "").trim();
      const rowVar = String(values[i][1] || "").trim();
      const rowDate = values[i][3] instanceof Date ? values[i][3] : new Date(values[i][3]);
      const rowMonthKey = isNaN(rowDate.getTime()) ? "" : Utilities.formatDate(rowDate, "GMT+8", "yyyy-MM");
      if (rowWh === warehouse && rowVar === variety && rowMonthKey === currentMonthKey) {
        targetRow = i + 1;
        break;
      }
    }

    const rowData = [warehouse, variety, ageMonths, now, Session.getEffectiveUser().getEmail() || "unknown"];
    if (targetRow > 0) {
      qaSheet.getRange(targetRow, 1, 1, 5).setValues([rowData]);
    } else {
      qaSheet.appendRow(rowData);
    }

    return { status: "success" };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Returns, per warehouse|variety key, the MOST RECENT submission on or
 * before `asOfDate` — { key: { ageMonths, submissionDate } }.
 */
function readLatestSubmissions_(ss, asOfDate) {
  const qaSheet = ss.getSheetByName(QA_SUBMISSIONS_SHEET_NAME);
  const latest = {};
  if (!qaSheet) return latest;

  const values = qaSheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const [wh, variety, ageMonths, submissionDateRaw] = values[i];
    if (!wh || !variety) continue;
    const submissionDate = submissionDateRaw instanceof Date ? submissionDateRaw : new Date(submissionDateRaw);
    if (isNaN(submissionDate.getTime()) || submissionDate > asOfDate) continue;

    const key = `${String(wh).trim()}|${String(variety).trim().toLowerCase()}`;
    if (!latest[key] || submissionDate > latest[key].submissionDate) {
      latest[key] = { ageMonths: parseFloat(ageMonths) || 0, submissionDate };
    }
  }
  return latest;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-ROW DEDUPLICATION — keyed by column NAME, not position, same
// approach (and same confirmed DATA_ENTRY headers) as the Inventory
// script. See dedupDataEntryRows_/dedupAiRows_ in
// daily-inventory-report-script.js for the header names this resolves.
// ─────────────────────────────────────────────────────────────────────────────

/** Row 1 headers as trimmed strings, in column order (0-based). */
function getSheetHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
}

function resolveColumnIndex_(headers, candidateNames, fallbackIndex) {
  for (const name of candidateNames) {
    const idx = headers.indexOf(name);
    if (idx !== -1) return idx;
  }
  return fallbackIndex;
}

/** DATA_ENTRY dedup — WSR # first, else WSI #, per row (a TRANSFER row can carry both). */
function dedupDataEntryRows_(rows, headers) {
  const warehouseCol = resolveColumnIndex_(headers, ["Warehouse Name"], 6);
  const wsrCol = resolveColumnIndex_(headers, ["WSR #"], 11);
  const wsiCol = resolveColumnIndex_(headers, ["WSI #"], 12);
  const dateCol = resolveColumnIndex_(headers, ["Date"], 1);
  const varietyCol = resolveColumnIndex_(headers, ["Variety"], 3);
  const netBagsCol = resolveColumnIndex_(headers, ["Net Bags"], 9);

  const seen = new Map();
  const kept = [null];
  const duplicates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const warehouse = String(row[warehouseCol] || "").trim();
    const wsr = String(row[wsrCol] || "").trim();
    const wsi = String(row[wsiCol] || "").trim();
    const docNumber = wsr || wsi;
    const dateVal = row[dateCol], varietyVal = row[varietyCol], netBagsVal = row[netBagsCol];

    if (docNumber) {
      // A real WSR#/WSI# match IS a trustworthy duplicate signal - safe to remove.
      const key = `${docNumber}::${warehouse}`;
      if (seen.has(key)) { duplicates.push(`${docNumber} (${warehouse})`); continue; }
      seen.set(key, true);
      kept.push(row);
      continue;
    }

    // No document number - blank row (skip silently) or a value-only
    // match, which isn't trustworthy enough to remove (see dedupAiRows_).
    const isBlankRow = !dateVal && !warehouse && !varietyVal && !netBagsVal;
    kept.push(row);
    if (isBlankRow) continue;

    const compositeKey = `${dateVal}::${warehouse}::${varietyVal}::${netBagsVal}`;
    if (seen.has(compositeKey)) {
      duplicates.push(`${compositeKey} (${warehouse}) - no WSR#/WSI# on this row, verify against the sheet, NOT auto-removed`);
    } else {
      seen.set(compositeKey, true);
    }
  }
  return { rows: kept, duplicates, cols: { warehouseCol, dateCol, varietyCol, netBagsCol } };
}

/**
 * AI dedup — composite key (AI headers not yet confirmed; adjust
 * candidates once you have a sample row). Without a real AI reference
 * number, a value-only match can't be distinguished from two genuinely
 * separate authorities that happen to share date/warehouse/variety/
 * amount - so this NEVER removes a row, only flags a repeat for manual
 * verification. See the longer note on dedupAiRows_ in
 * daily-inventory-report-script.js.
 */
function dedupAiRows_(rows, headers) {
  const dateCol = resolveColumnIndex_(headers, ["Date"], 0);
  const warehouseCol = resolveColumnIndex_(headers, ["Warehouse Name", "Warehouse"], 3);
  const varietyCol = resolveColumnIndex_(headers, ["Variety"], 4);
  const kilosCol = resolveColumnIndex_(headers, ["Net Kilos", "Kilos"], 6);
  const ageGroupCol = resolveColumnIndex_(headers, ["Age Group", "AGE"], 12);
  const typeCol = resolveColumnIndex_(headers, ["Transaction", "Type"], 7);

  const seen = new Map();
  const kept = [null];
  const possibleDuplicates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const dateVal = row[dateCol], warehouse = String(row[warehouseCol] || "").trim();
    const varietyVal = row[varietyCol], kilosVal = row[kilosCol];
    const isBlankRow = !dateVal && !warehouse && !varietyVal && !kilosVal;
    kept.push(row); // AI rows are ALWAYS kept
    if (isBlankRow) continue;

    const key = `${dateVal}::${warehouse}::${varietyVal}::${kilosVal}`;
    if (seen.has(key)) {
      possibleDuplicates.push(`${key} (${warehouse}) - verify against the sheet, NOT auto-removed`);
    } else {
      seen.set(key, true);
    }
  }
  return { rows: kept, duplicates: possibleDuplicates, cols: { dateCol, warehouseCol, varietyCol, kilosCol, ageGroupCol, typeCol } };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

function generateMonitoringReportManual() {
  const ui = SpreadsheetApp.getUi();
  const result = runReportCore_();
  if (result.error) {
    ui.alert("Error", result.error, ui.ButtonSet.OK);
    return;
  }
  let msg = `Report generated as of ${result.formattedDate}.`;
  if (result.duplicateRows.length > 0) {
    msg += `\n\n⚠️ Duplicate source rows ignored:\n${result.duplicateRows.join("\n")}`;
  }
  if (result.fifoShortfalls.length > 0) {
    msg += `\n\n⚠️ FIFO shortfalls found (issuance larger than recorded stock in that age bucket) — see "Data Discrepancies" on the report:\n${result.fifoShortfalls.join("\n")}`;
  }
  ui.alert("Report Complete", msg, ui.ButtonSet.OK);
}

function runReportCore_() {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000);
  if (!gotLock) return { error: "Another report generation is already in progress. Try again shortly." };

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("Config");
    if (!configSheet) return { error: 'Sheet named "Config" not found.' };
    if (!isCallerAdmin_(configSheet)) return { error: "Not authorized. Only an admin listed in Config!B3 can generate this report." };

    const sourceUrl = configSheet.getRange("B1").getValue();
    if (!sourceUrl) return { error: "Source spreadsheet URL is missing in Config B1." };
    const startDate = new Date(configSheet.getRange("B2").getValue());
    if (isNaN(startDate.getTime())) return { error: "Monitoring start date in Config B2 is missing or invalid." };

    const setupSheet = ss.getSheetByName(SETUP_SHEET_NAME);
    if (!setupSheet) return { error: "Run Initialize Setup Sheet first." };

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const sourceSs = SpreadsheetApp.openByUrl(sourceUrl);
    const recSheet = sourceSs.getSheetByName(CONFIG.SHEET_RECEIPTS);
    const issSheet = sourceSs.getSheetByName(CONFIG.SHEET_ISSUES);
    if (!recSheet || !issSheet) {
      const missing = [!recSheet && CONFIG.SHEET_RECEIPTS, !issSheet && CONFIG.SHEET_ISSUES].filter(Boolean).join(", ");
      return { error: `Required sheets not found in source spreadsheet: ${missing}` };
    }

    const varietyTypeMap = readVarietyCategoryMap_(ss);
    const latestSubmissions = readLatestSubmissions_(ss, endDate);

    const msPerMonth = 30.44 * 24 * 60 * 60 * 1000;
    let inventory = {};
    const duplicateRows = [];
    const fifoShortfalls = [];

    const recHeaders = getSheetHeaders_(recSheet);
    const issHeaders = getSheetHeaders_(issSheet);

    // 1. Receipts, deduped, age anchored to QA submission when one exists
    const recRaw = recSheet.getDataRange().getValues();
    const recDedup = dedupDataEntryRows_(recRaw, recHeaders);
    duplicateRows.push(...recDedup.duplicates.map((d) => `${CONFIG.SHEET_RECEIPTS}: ${d}`));
    const recAgeCol = resolveColumnIndex_(recHeaders, ["AGE"], 13); // NOT "Age Unit" - a text label like "Days"

    recDedup.rows.forEach((row) => {
      if (!row) return;
      const rDate = new Date(row[recDedup.cols.dateCol]);
      if (isNaN(rDate.getTime()) || rDate < startDate || rDate > endDate) return;

      const wh = row[recDedup.cols.warehouseCol], variety = row[recDedup.cols.varietyCol];
      const bags = parseFloat(row[recDedup.cols.netBagsCol]) || 0;
      if (!wh || !variety || bags === 0) return;

      const subKey = `${String(wh).trim()}|${String(variety).trim().toLowerCase()}`;
      let ageMonths;
      if (latestSubmissions[subKey]) {
        const elapsedSinceSubmission = (endDate.getTime() - latestSubmissions[subKey].submissionDate.getTime()) / msPerMonth;
        ageMonths = latestSubmissions[subKey].ageMonths + elapsedSinceSubmission;
      } else {
        const transferAgeOverride = parseFloat(row[recAgeCol]);
        if (!isNaN(transferAgeOverride) && transferAgeOverride > 0) {
          ageMonths = transferAgeOverride + (endDate.getTime() - rDate.getTime()) / msPerMonth;
        } else {
          ageMonths = (endDate.getTime() - rDate.getTime()) / msPerMonth;
        }
      }
      updateInv(inventory, wh, variety, ageMonths, bags);
    });

    // 2. Issuances (FIFO against the AI sheet's own age-group column), deduped
    const issRaw = issSheet.getDataRange().getValues();
    const issDedup = dedupAiRows_(issRaw, issHeaders);
    duplicateRows.push(...issDedup.duplicates.map((d) => `${CONFIG.SHEET_ISSUES}: ${d}`));

    issDedup.rows.forEach((row) => {
      if (!row) return;
      if (row[issDedup.cols.kilosCol] === "" || parseFloat(row[issDedup.cols.kilosCol]) <= 0) return;
      const iDate = new Date(row[issDedup.cols.dateCol]);
      if (isNaN(iDate.getTime()) || iDate < startDate || iDate > endDate) return;

      const wh = row[issDedup.cols.warehouseCol];
      const varCode = String(row[issDedup.cols.varietyCol]).toLowerCase();
      const bags = parseFloat(row[issDedup.cols.kilosCol]) / 50;
      const ageGroupCode = String(row[issDedup.cols.ageGroupCol]);

      if (inventory[wh] && inventory[wh][varCode]) {
        const shortfall = applyFIFO(inventory[wh][varCode], bags, ageGroupCode, isRice(varCode));
        if (shortfall > 0.01) {
          fifoShortfalls.push(`${wh} / ${varCode.toUpperCase()} / age group "${ageGroupCode}": issuance short by ${shortfall.toFixed(2)} bags`);
        }
      } else {
        fifoShortfalls.push(`${wh} / ${varCode.toUpperCase()} / age group "${ageGroupCode}": issuance of ${bags.toFixed(2)} bags has NO recorded stock at all`);
      }
    });

    renderReport(inventory, endDate, fifoShortfalls);

    return {
      formattedDate: Utilities.formatDate(endDate, Session.getScriptTimeZone(), "MMMM dd, yyyy"),
      duplicateRows,
      fifoShortfalls,
    };
  } finally {
    lock.releaseLock();
  }
}

function updateInv(inv, wh, varCode, ageMonths, bags) {
  if (!wh || !varCode) return;
  const v = String(varCode).toLowerCase();
  if (!inv[wh]) inv[wh] = {};
  if (!inv[wh][v]) inv[wh][v] = {};
  const ageKey = ageMonths.toFixed(2);
  inv[wh][v][ageKey] = (inv[wh][v][ageKey] || 0) + bags;
}

/** Returns the shortfall (bags requested but not available in-range) instead of silently dropping it. */
function applyFIFO(stockObj, bagsToSubtract, ageCode, isRiceVariety) {
  let availableAges = Object.keys(stockObj).map(Number).sort((a, b) => a - b);
  let remaining = bagsToSubtract;

  for (let age of availableAges) {
    if (remaining <= 0) break;
    if (!isAgeInRange(age, ageCode, isRiceVariety)) continue;
    let key = age.toFixed(2);
    let current = stockObj[key];
    let sub = Math.min(current, remaining);
    stockObj[key] -= sub;
    remaining -= sub;
  }
  return remaining; // > 0 means a real shortfall - surfaced by the caller, not swallowed
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT RENDERING — unchanged printTable logic from v1, plus a new
// Data Discrepancies block for FIFO shortfalls (fix #3)
// ─────────────────────────────────────────────────────────────────────────────

function getAgeDisplay(ageMonths) {
  if (ageMonths <= 1.0) return { label: "0.0 - 1.0", sort: 1 };
  let lower = Math.floor(ageMonths);
  let upper = Math.ceil(ageMonths);
  if (ageMonths % 1 === 0) return { label: `${lower - 1}.1 - ${lower}.0`, sort: lower };
  return { label: `${lower}.1 - ${upper}.0`, sort: upper };
}

function renderReport(inventory, endDate, fifoShortfalls) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let reportSheet = ss.getSheetByName(CONFIG.SHEET_REPORT) || ss.insertSheet(CONFIG.SHEET_REPORT);
  reportSheet.clear();
  reportSheet.getRange("A:Z").setFontFamily("Twentieth Century").setFontSize(14);

  const formattedDate = Utilities.formatDate(endDate, Session.getScriptTimeZone(), "MMMM dd, yyyy");
  reportSheet.getRange("A1").setValue(`As of ${formattedDate}`).setFontWeight("bold").setFontSize(16);

  let isEOM = false;
  let testDate = new Date(endDate.getTime());
  testDate.setDate(testDate.getDate() + 1);
  if (testDate.getMonth() !== endDate.getMonth()) isEOM = true;

  let riceSummaryEnd = printTable(reportSheet, 3, 1, inventory, true, "SUMMARY OVERVIEW - RICE", false, isEOM);
  let riceDetailedEnd = printTable(reportSheet, 3, 9, inventory, true, "DETAILED OVERVIEW - RICE", true, isEOM);
  let palayStartRow = Math.max(riceSummaryEnd, riceDetailedEnd) + 2;

  let palaySummaryEnd = printTable(reportSheet, palayStartRow, 1, inventory, false, "SUMMARY OVERVIEW - PALAY", false, isEOM);
  let palayDetailedEnd = printTable(reportSheet, palayStartRow, 9, inventory, false, "DETAILED OVERVIEW - PALAY", true, isEOM);

  if (fifoShortfalls.length > 0) {
    const discrepStart = Math.max(palaySummaryEnd, palayDetailedEnd) + 2;
    reportSheet.getRange(discrepStart, 1).setValue("⚠️ DATA DISCREPANCIES (issuance larger than recorded stock)").setFontWeight("bold").setFontColor("#b71c1c");
    const rows = fifoShortfalls.map((s) => [s]);
    reportSheet.getRange(discrepStart + 1, 1, rows.length, 1).setValues(rows);
  }

  reportSheet.autoResizeColumns(1, 15);
  reportSheet.setColumnWidth(3, 125);
  reportSheet.setColumnWidth(11, 125);
  reportSheet.setColumnWidth(8, 40);
}

function printTable(sheet, startRow, startCol, inventory, forRice, title, isDetailed = false, isEOM = false) {
  const colorHeader = forRice ? "#4a86e8" : "#6aa84f";
  let headers = isDetailed
    ? ["PROVINCE", "WAREHOUSE", "VARIETY", "AGE RANGE", "NET BAGS"]
    : (forRice ? ["PROVINCE", "WAREHOUSE", "VARIETY", "0-3 MONTHS", "> 3 MONTHS", "TOTAL"]
               : ["PROVINCE", "WAREHOUSE", "VARIETY", "0-6 MONTHS", "6.1-12.0 MONTHS", "> 12 MONTHS", "TOTAL"]);

  let rows = [[title.toUpperCase(), ...Array(headers.length - 1).fill("")], headers];
  let boldRows = [];
  let spacerRows = [];
  let provinces = ["Albay", "Catanduanes"];
  let colGrandTotals = Array(headers.length - 3).fill(0);

  let lastProv = "", lastWH = "", lastVar = "";

  provinces.forEach(prov => {
    let provHasData = false;
    let colProvTotals = Array(headers.length - 3).fill(0);

    for (let wh in inventory) {
      const whProv = CONFIG.CATANDUANES_WH.includes(wh) ? "Catanduanes" : "Albay";
      if (whProv !== prov) continue;

      for (let varCode in inventory[wh]) {
        if (isRice(varCode) !== forRice) continue;
        let stock = inventory[wh][varCode];

        if (isDetailed) {
          let aggregatedDetailed = {};
          Object.keys(stock).forEach(ageKey => {
            let ageMonths = parseFloat(ageKey);
            let val = stock[ageKey];
            if (val > 0.01) {
              let displayInfo = getAgeDisplay(ageMonths);
              if (!aggregatedDetailed[displayInfo.label]) aggregatedDetailed[displayInfo.label] = { val: 0, sort: displayInfo.sort };
              aggregatedDetailed[displayInfo.label].val += val;
            }
          });
          let sortedLabels = Object.keys(aggregatedDetailed).sort((a, b) => aggregatedDetailed[a].sort - aggregatedDetailed[b].sort);
          sortedLabels.forEach(label => {
            let val = aggregatedDetailed[label].val;
            let pDisp = prov !== lastProv ? prov : "";
            let wDisp = wh !== lastWH ? wh : "";
            let vDisp = varCode.toUpperCase() !== lastVar ? varCode.toUpperCase() : "";
            rows.push([pDisp, wDisp, vDisp, label, val]);
            colProvTotals[1] += val;
            lastProv = prov; lastWH = wh; lastVar = varCode.toUpperCase();
            provHasData = true;
          });
        } else {
          let cols = forRice ? [0, 0] : [0, 0, 0];
          Object.keys(stock).forEach(ageKey => {
            let ageMonths = parseFloat(ageKey);
            let val = stock[ageKey];
            if (forRice) { ageMonths <= 3 ? cols[0] += val : cols[1] += val; }
            else {
              if (ageMonths <= 6) cols[0] += val;
              else if (ageMonths <= 12) cols[1] += val;
              else cols[2] += val;
            }
          });
          let rowTotal = cols.reduce((a, b) => a + b, 0);
          if (rowTotal > 0.01) {
            let pDisp = prov !== lastProv ? prov : "";
            let wDisp = wh !== lastWH ? wh : "";
            rows.push([pDisp, wDisp, varCode.toUpperCase(), ...cols, rowTotal]);
            cols.forEach((val, idx) => colProvTotals[idx] += val);
            colProvTotals[colProvTotals.length - 1] += rowTotal;
            lastProv = prov; lastWH = wh; provHasData = true;
          }
        }
      }
      if (provHasData) {
        rows.push(Array(headers.length).fill(""));
        spacerRows.push(startRow + rows.length - 1);
        lastWH = ""; lastVar = "";
      }
    }

    if (provHasData) {
      let subtotalValues = [...colProvTotals];
      if (isDetailed) subtotalValues[0] = "";
      rows.push(["", "", "SUB-TOTAL", ...subtotalValues]);
      boldRows.push(startRow + rows.length - 1);
      rows.push(Array(headers.length).fill(""));
      spacerRows.push(startRow + rows.length - 1);
      colProvTotals.forEach((val, idx) => { if (typeof val === 'number') colGrandTotals[idx] += val; });
      lastProv = "";
    }
  });

  let grandTotalValues = [...colGrandTotals];
  if (isDetailed) grandTotalValues[0] = "";
  rows.push(["", "", "GRAND TOTAL", ...grandTotalValues]);
  boldRows.push(startRow + rows.length - 1);

  const range = sheet.getRange(startRow, startCol, rows.length, headers.length);
  range.setValues(rows);
  sheet.getRange(startRow, startCol).setFontWeight("bold");
  sheet.getRange(startRow + 1, startCol, 1, headers.length).setBackground(colorHeader).setFontColor("white").setFontWeight("bold").setHorizontalAlignment("center");
  boldRows.forEach(r => sheet.getRange(r, startCol, 1, headers.length).setFontWeight("bold"));
  spacerRows.forEach(r => sheet.setRowHeight(r, 10));

  let numRange = sheet.getRange(startRow + 2, startCol + 3, rows.length - 2, headers.length - 3);
  numRange.setNumberFormat('#,##0.00;[Red](#,##0.00);"-"');

  return startRow + rows.length;
}

function isRice(v) {
  return CONFIG.RICE_VARIETIES.includes(String(v).toLowerCase());
}

function isAgeInRange(ageMonths, code, isRiceVariety) {
  if (code.includes("0-3")) return ageMonths <= 3;
  if (code.includes(">3")) return ageMonths > 3;
  if (code.includes("0-6")) return ageMonths <= 6;
  if (code.includes("6.1-12")) return ageMonths > 6 && ageMonths <= 12;
  if (code.includes(">12")) return ageMonths > 12;
  return true;
}
