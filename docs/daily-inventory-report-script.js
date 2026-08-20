/**
 * GSR Daily Inventory Automation — v2 (gap-fix pass)
 *
 * SETUP (one time):
 * 1. Create a NEW, blank Google Spreadsheet. This script goes in ITS
 *    Apps Script project (Extensions > Apps Script), not the existing
 *    production spreadsheet's project. This script only ever READS from
 *    the production spreadsheet (via SpreadsheetApp.openByUrl) — it
 *    never writes a single cell there.
 * 2. In this new spreadsheet, add a "Config" sheet with:
 *      B1 = URL of the existing production spreadsheet (the one with
 *           AI / DATA_ENTRY - this script only reads those two sheets
 *           from it, nothing else)
 *      B2 = the date to start accounting from (e.g. 2026-05-01)
 *      B3 = comma-separated list of admin emails allowed to run/trigger
 *           a sync (e.g. "arvee.dev.apps@gmail.com, other.admin@x.com")
 *      B4, B5 = OPTIONAL active-hours window for the 5-minute
 *           auto-trigger (24-hour, GMT+8) - e.g. B4=8, B5=18 only
 *           actually syncs between 8 AM and 6 PM, so overnight trigger
 *           firings cost almost nothing against the daily quota. Leave
 *           both blank to run around the clock instead. Manual "Update
 *           Now" clicks always work regardless of this window.
 *      B6 = URL of the Age Monitoring spreadsheet (the second new
 *           spreadsheet from docs/age-monitoring-report-script.js).
 *           REQUIRED - this script has NO local SETUP sheet of its own.
 *           Variety->category mapping AND one-time starting balances
 *           both come from QA, and QA only enters that data once, in the
 *           Age Monitoring spreadsheet's own SETUP + QA_AGE_SUBMISSIONS
 *           sheets - this script reads both of those directly instead of
 *           asking for the same data a second time.
 * 3. In the Age Monitoring spreadsheet, run "⛳ Initialize Setup Sheet"
 *    and fill in every variety's Palay/Rice category, then use "Bulk
 *    Import Latest Known Ages" (including Net Bags where known) so this
 *    spreadsheet has real starting balances to read on its first sync.
 * 4. Run "Install Auto-Update (every 5 min)" from the menu once
 *    (authorizes the trigger). After that, this spreadsheet updates
 *    itself every 5 minutes with no further action needed - see the
 *    quota warning on installDailyTrigger() below before relying on this
 *    once the season's data grows large.
 *
 * WHAT CHANGED FROM v1 (see docs/inventory-and-age-monitoring-review.md
 * for the full writeup of what each of these fixes and why):
 *
 * 1. ADMIN-ONLY: every entry point (menu click AND the daily trigger)
 *    checks the caller's email against Config!B3 before touching
 *    anything. A non-admin gets a rejection alert, not a partial run.
 *
 * 2. LOCKED: the whole sync runs inside LockService.getScriptLock(), so
 *    a manual run and the daily trigger (or two overlapping triggers)
 *    can never race each other and produce a half-written state.
 *
 * 3. STRICT VARIETY MAPPING: v1 fell back to guessing a variety's
 *    Palay/Rice category from its letters if it wasn't registered in
 *    SETUP_AGE_MONITORING. That silently misfiled unmapped varieties.
 *    v2 refuses to guess — an unmapped variety is collected and
 *    reported to the admin as an explicit warning, and its bags are
 *    still recorded (under an "UNMAPPED" bucket) so no data is lost,
 *    but nothing is silently miscategorized.
 *
 * 4. KEYED STATE, NOT POSITIONAL SCANNING: v1 recovered "manual"
 *    beginning-balance overrides by re-reading a month sheet's own
 *    headers and matching them back to warehouse/variety by column
 *    position — a reordered or newly-added column could silently
 *    misalign it. v2 keeps a hidden STATE sheet recording each month's
 *    computed ending balance keyed by warehouse|variety|age (never by
 *    column position). When "auto-sync previous balance" is unchecked
 *    for a month, v2 simply leaves that month's Beginning Inventory row
 *    exactly as it already is in the sheet (whatever the admin last
 *    manually typed there) instead of trying to reconstruct it.
 *
 * 5. EXPLICIT RENDER STATE, NOT "SHEET EXISTS": v1 decided whether a
 *    month needed re-rendering by checking whether a sheet with that
 *    name existed. If a month sheet was ever renamed/deleted, v1 would
 *    treat it as brand-new and silently reseed it from the (increasingly
 *    stale) SETUP baseline. v2 tracks "last rendered" per month in the
 *    STATE sheet — if STATE says a month was already rendered but its
 *    sheet is now missing, that's flagged as a warning to the admin
 *    instead of being silently treated as new.
 *
 * 6. SOURCE-ROW DEDUPLICATION: before aggregating, every DATA_ENTRY and
 *    AI row is keyed by its own document number + warehouse (WSR#/WSI#/
 *    AI# etc., whichever column holds it). If the same document number
 *    appears more than once for the same warehouse, only the first is
 *    counted and the rest are reported to the admin as duplicates found
 *    in the source data — this is the same class of bug already fixed
 *    in the main app, surfaced here instead of silently double-counted.
 *
 * Everything else (the rendering, merge, and border logic) is carried
 * over from v1 essentially unchanged — that part was never the problem.
 */

const THEME = {
  font: "Twentieth Century",
  primaryGreen: "#c8e6c9",
  secondaryBlue: "#1976d2",
  headerText: "#000000",
  alternateRow: "#f5f5f5",
  border: "#000000",
  numberFormat: "_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)"
};

const EXCLUDED_VARIETIES = new Set(["DKA", "DKB", "DKC", "BIN"]);
const STATE_SHEET_NAME = "STATE (do not edit)";

const dateCache = {};
const colLetterCache = {};

function getCachedDateInfo(dateObj) {
  const time = dateObj.getTime();
  if (!dateCache[time]) {
    dateCache[time] = {
      month: Utilities.formatDate(dateObj, "GMT+8", "MMMM"),
      day: Utilities.formatDate(dateObj, "GMT+8", "d"),
      shortDate: Utilities.formatDate(dateObj, "GMT+8", "MMM dd")
    };
  }
  return dateCache[time];
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🌾 GSR Daily Inventory')
    .addItem('🚀 Update Now', 'syncGSRDataManual')
    .addSeparator()
    .addItem('⏰ Install Auto-Update (every 5 min)', 'installDailyTrigger')
    .addItem('🛑 Remove Auto-Update', 'removeDailyTrigger')
    .addToUi();
}

/**
 * This spreadsheet has NO local SETUP of its own anymore. Variety
 * category mapping AND starting-balance/age data both come from QA, so
 * they live in exactly one place - the Age Monitoring spreadsheet's own
 * SETUP + QA_AGE_SUBMISSIONS sheets (Config!B6 there) - and this script
 * reads both directly, the same way it already reads AI/DATA_ENTRY from
 * the production spreadsheet. Nothing needs to be entered twice.
 *
 * Reads:
 *   - Age Monitoring's SETUP sheet -> { variety: "rice"|"palay" }
 *   - Age Monitoring's QA_AGE_SUBMISSIONS sheet -> one-time starting
 *     balances, keyed "warehouse|variety|age". Only submissions dated ON
 *     OR BEFORE this sync's startDate qualify (a submission dated AFTER
 *     startDate would double-count against receipts already flowing
 *     through DATA_ENTRY for that same period) and only rows that
 *     actually included a Net Bags value are used. Each qualifying
 *     submission's age is projected forward from its own submission date
 *     to startDate (same elapsed-time logic Age Monitoring itself uses),
 *     so the age bucket reflects "as of startDate," not "as of whenever
 *     QA happened to submit it."
 */
function readSharedQaData_(configSheet, startDate) {
  const ageMonitoringUrl = configSheet.getRange("B6").getValue();
  if (!ageMonitoringUrl || ageMonitoringUrl.toString().trim() === "") {
    return { error: "Age Monitoring spreadsheet URL is missing in Config B6. This is required - variety mapping and starting balances now come from there instead of a local SETUP sheet." };
  }

  let qaSs;
  try {
    qaSs = SpreadsheetApp.openByUrl(ageMonitoringUrl);
  } catch (e) {
    return { error: `Could not open the Age Monitoring spreadsheet from Config B6: ${e.toString()}` };
  }

  const setupSheet = qaSs.getSheetByName("SETUP");
  const qaSheet = qaSs.getSheetByName("QA_AGE_SUBMISSIONS");
  if (!setupSheet || !qaSheet) {
    const missing = [!setupSheet && "SETUP", !qaSheet && "QA_AGE_SUBMISSIONS"].filter(Boolean).join(", ");
    return { error: `Required sheet(s) not found in the Age Monitoring spreadsheet: ${missing}. Run "Initialize Setup Sheet" there first.` };
  }

  const varietyTypeMap = {};
  const setupValues = setupSheet.getDataRange().getValues();
  for (let i = 2; i < setupValues.length; i++) {
    const variety = String(setupValues[i][0] || "").trim();
    const cat = String(setupValues[i][1] || "").trim().toLowerCase();
    if (variety && (cat === "rice" || cat === "palay")) varietyTypeMap[variety] = cat;
  }

  const msPerMonth = 30.44 * 24 * 60 * 60 * 1000;
  const startingBalances = {};
  const qaValues = qaSheet.getDataRange().getValues();
  // Track the latest qualifying (<= startDate) submission per warehouse|variety.
  const latestByKey = {};
  for (let i = 1; i < qaValues.length; i++) {
    const [wh, variety, ageMonthsRaw, netBagsRaw, submissionDateRaw] = qaValues[i];
    if (!wh || !variety) continue;
    const netBags = netBagsRaw === "" || netBagsRaw === undefined || netBagsRaw === null ? null : Number(netBagsRaw);
    if (netBags === null || isNaN(netBags) || netBags === 0) continue; // age-only correction, nothing to seed a balance with

    const submissionDate = submissionDateRaw instanceof Date ? submissionDateRaw : new Date(submissionDateRaw);
    if (isNaN(submissionDate.getTime()) || submissionDate > startDate) continue; // see function doc - future-dated submissions are excluded

    const key = `${String(wh).trim()}|${String(variety).trim()}`;
    if (!latestByKey[key] || submissionDate > latestByKey[key].submissionDate) {
      latestByKey[key] = { ageMonths: parseFloat(ageMonthsRaw) || 0, netBags, submissionDate };
    }
  }

  Object.keys(latestByKey).forEach((key) => {
    const [wh, variety] = key.split('|');
    const entry = latestByKey[key];
    const elapsedSinceSubmission = (startDate.getTime() - entry.submissionDate.getTime()) / msPerMonth;
    const ageAtStartDate = entry.ageMonths + elapsedSinceSubmission;
    const category = varietyTypeMap[variety]; // "rice"/"palay"/undefined
    const ageGroup = getAgeGroupFromType(category || "", ageAtStartDate);
    const balanceKey = `${wh}|${variety}|${ageGroup}`;
    startingBalances[balanceKey] = (startingBalances[balanceKey] || 0) + entry.netBags;
  });

  return { varietyTypeMap, startingBalances };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN GATE
// ─────────────────────────────────────────────────────────────────────────────

function getAdminEmails_(configSheet) {
  const raw = configSheet.getRange("B3").getValue();
  return String(raw || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true if the CURRENT effective user is allowed to run a sync.
 * Session.getEffectiveUser() (not getActiveUser()) so this also works
 * correctly when the daily trigger runs it, not just interactive clicks.
 */
function isCallerAdmin_(configSheet) {
  const admins = getAdminEmails_(configSheet);
  if (admins.length === 0) return true; // no allowlist configured yet - don't lock the owner out
  const caller = (Session.getEffectiveUser().getEmail() || "").toLowerCase();
  return admins.includes(caller);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE SHEET (keyed beginning/ending balances + render tracking)
// ─────────────────────────────────────────────────────────────────────────────

function getOrCreateStateSheet_(ss) {
  let sheet = ss.getSheetByName(STATE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STATE_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([["Month", "Key (Warehouse|Variety|Age)", "Ending Balance", "Rendered At"]]);
    sheet.hideSheet();
  }
  return sheet;
}

/**
 * Reads the STATE sheet into { monthName -> { rendered: bool, balances: {key: number} } }
 */
function readState_(ss) {
  const sheet = getOrCreateStateSheet_(ss);
  const values = sheet.getDataRange().getValues();
  const state = {};
  for (let i = 1; i < values.length; i++) {
    const [month, key, balance] = values[i];
    if (!month || !key) continue;
    if (!state[month]) state[month] = { rendered: true, balances: {} };
    state[month].balances[key] = Number(balance) || 0;
  }
  return state;
}

/**
 * Overwrites the STATE sheet's rows for the given month with a fresh
 * set of ending balances. Other months' rows are left untouched.
 */
function writeMonthState_(ss, monthName, balancesByKey) {
  const sheet = getOrCreateStateSheet_(ss);
  const values = sheet.getDataRange().getValues();
  const keptRows = values.filter((row, i) => i === 0 || row[0] !== monthName);

  const timestamp = new Date().toISOString();
  const newRows = Object.keys(balancesByKey).map((key) => [monthName, key, balancesByKey[key], timestamp]);

  sheet.clearContents();
  const finalRows = [...keptRows, ...newRows];
  if (finalRows.length > 0) {
    sheet.getRange(1, 1, finalRows.length, 4).setValues(finalRows);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs every 5 minutes (Apps Script's minimum granularity for a
 * minutes-based trigger). IMPORTANT constraint to watch: consumer Google
 * accounts get roughly 90 minutes of TOTAL trigger execution time per
 * day - at 5-minute intervals that's 288 runs/day, so each run needs to
 * average under ~18 seconds or the quota gets exhausted and updates
 * silently stop firing for the rest of that day (check Apps Script's
 * "Executions" log if updates seem to have stalled). Since every run
 * recomputes the running total from Config!B2's start date forward (not
 * just new rows since the last run), this will get slower as the
 * season's data grows - if runs start taking noticeably longer, switch
 * to .everyMinutes(15) or .everyMinutes(30) below rather than letting the
 * daily quota silently cut updates off.
 */
function installDailyTrigger() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Config");
  if (!configSheet || !isCallerAdmin_(configSheet)) {
    ui.alert("Not authorized", "Only an admin listed in Config!B3 can install the auto-update trigger.", ui.ButtonSet.OK);
    return;
  }

  removeDailyTrigger(); // avoid stacking duplicate triggers on repeated installs
  ScriptApp.newTrigger('syncGSRDataAuto')
    .timeBased()
    .everyMinutes(5)
    .create();

  ui.alert("Installed", "Daily Inventory will now auto-update every 5 minutes. If runs ever start taking a long time as data grows, check Executions in the Apps Script editor - the daily trigger-time quota can silently stop updates if runs get too slow.", ui.ButtonSet.OK);
}

function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((t) => {
    if (t.getHandlerFunction() === 'syncGSRDataAuto') ScriptApp.deleteTrigger(t);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

function syncGSRDataManual() {
  const ui = SpreadsheetApp.getUi();
  const result = runSyncCore_();
  if (result.error) {
    ui.alert("Error", result.error, ui.ButtonSet.OK);
    return;
  }
  ui.alert(
    "Process Complete",
    buildSummaryMessage_(result),
    ui.ButtonSet.OK
  );
}

/**
 * Reads Config!B4/B5 as an "active hours" window (24-hour, GMT+8) - e.g.
 * B4=8, B5=18 means only actually sync between 8:00 AM and 5:59 PM.
 * Outside that window this returns false almost instantly (no sheet
 * reads, no lock, no real work), so the 5-minute trigger firing overnight
 * costs essentially nothing against the daily quota. Leave B4/B5 blank
 * to run around the clock instead.
 */
function isWithinActiveHours_(configSheet) {
  const startHourRaw = configSheet.getRange("B4").getValue();
  const endHourRaw = configSheet.getRange("B5").getValue();
  if (startHourRaw === "" || endHourRaw === "") return true; // not configured - always active

  const startHour = Number(startHourRaw);
  const endHour = Number(endHourRaw);
  if (isNaN(startHour) || isNaN(endHour)) return true;

  const currentHour = Number(Utilities.formatDate(new Date(), "GMT+8", "H"));
  return currentHour >= startHour && currentHour < endHour;
}

function syncGSRDataAuto() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Config");
  if (configSheet && !isWithinActiveHours_(configSheet)) {
    return; // outside Config!B4-B5 active window - skip without touching anything else, keeps quota cost near zero
  }

  const result = runSyncCore_();
  if (result.error) {
    Logger.log("Daily auto-sync FAILED: " + result.error);
    return;
  }
  Logger.log("Daily auto-sync OK: " + buildSummaryMessage_(result));
}

function buildSummaryMessage_(result) {
  let msg = `Updated ${result.renderedCount} month sheet(s): ${result.monthsToRender.join(", ")}.\n`;
  if (result.monthsToSkip.length > 0) {
    msg += `Skipped ${result.monthsToSkip.length} existing month sheet(s): ${result.monthsToSkip.join(", ")}.\n`;
  }
  if (result.unmappedVarieties.length > 0) {
    msg += `\n⚠️ Unmapped varieties (add to the Age Monitoring spreadsheet's SETUP sheet - it's shared by both): ${result.unmappedVarieties.join(", ")}.\n`;
  }
  if (result.duplicateRows.length > 0) {
    msg += `\n⚠️ Duplicate source rows ignored (same document # + warehouse seen more than once):\n${result.duplicateRows.join("\n")}\n`;
  }
  if (result.missingMonthSheets.length > 0) {
    msg += `\n⚠️ These months were previously rendered but their sheet is now missing, so they were re-rendered from stored state: ${result.missingMonthSheets.join(", ")}.\n`;
  }
  return msg;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR (locked, admin-gated)
// ─────────────────────────────────────────────────────────────────────────────

function runSyncCore_() {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000);
  if (!gotLock) {
    return { error: "Another sync is already in progress. Try again shortly." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("Config");
    if (!configSheet) return { error: 'Sheet named "Config" not found. Please check your configuration.' };

    if (!isCallerAdmin_(configSheet)) {
      return { error: "Not authorized. Only an admin listed in Config!B3 can run this." };
    }

    const sourceUrl = configSheet.getRange("B1").getValue();
    if (!sourceUrl || sourceUrl.toString().trim() === "") {
      return { error: "Source spreadsheet URL is missing in Config B1." };
    }
    const startDateRaw = configSheet.getRange("B2").getValue();
    const startDate = new Date(startDateRaw);
    if (!startDateRaw || isNaN(startDate.getTime())) {
      return { error: "Start date in Config B2 is missing or invalid." };
    }

    const sharedQaData = readSharedQaData_(configSheet, startDate);
    if (sharedQaData.error) return { error: sharedQaData.error };
    const { varietyTypeMap, startingBalances } = sharedQaData;

    const sourceSs = SpreadsheetApp.openByUrl(sourceUrl);
    const aiSheet = sourceSs.getSheetByName("AI");
    const deSheet = sourceSs.getSheetByName("DATA_ENTRY");
    if (!aiSheet || !deSheet) {
      const missing = [!aiSheet && "AI", !deSheet && "DATA_ENTRY"].filter(Boolean).join(", ");
      return { error: `Required sheets not found in source spreadsheet: ${missing}` };
    }

    const deHeaders = getSheetHeaders_(deSheet);
    const aiHeaders = getSheetHeaders_(aiSheet);

    const deData = getDateFilteredRows(deSheet, resolveColumnIndex_(deHeaders, ["Date"], 1) + 1, startDate);
    const aiData = getDateFilteredRows(aiSheet, resolveColumnIndexByPrefix_(aiHeaders, ["DATE"], 0) + 1, startDate);

    const parsed = parseAndFilterData(aiData, deData, startDate, deHeaders, aiHeaders, varietyTypeMap, startingBalances);

    if (parsed.columns.length === 0) {
      return { error: "No valid transactions or balances found for the selected period." };
    }

    const sortedMonthNames = Object.keys(parsed.months).sort((a, b) => parsed.monthDates[a] - parsed.monthDates[b]);
    const startMonthName = sortedMonthNames[0];

    const savedState = readState_(ss);
    const missingMonthSheets = [];

    const monthsToRender = [];
    const monthsToSkip = [];
    sortedMonthNames.forEach((monthName, idx) => {
      const sheetExists = ss.getSheetByName(monthName) !== null;
      const wasRendered = Boolean(savedState[monthName]);
      if (idx === 0) {
        monthsToRender.push(monthName); // start month is always live
      } else if (!sheetExists && !wasRendered) {
        monthsToRender.push(monthName); // genuinely new month
      } else if (!sheetExists && wasRendered) {
        missingMonthSheets.push(monthName); // was rendered before, sheet vanished - re-render, don't silently reseed from SETUP
        monthsToRender.push(monthName);
      } else {
        monthsToSkip.push(monthName);
      }
    });

    const numDataCols = parsed.columns.length;
    const startMonthDate = parsed.monthDates[startMonthName];
    const prevMonthDate = new Date(startMonthDate.getFullYear(), startMonthDate.getMonth(), 0);
    const prevMonthName = getCachedDateInfo(prevMonthDate).month;

    let beginningBalances;
    if (savedState[prevMonthName]) {
      beginningBalances = Object.assign({}, savedState[prevMonthName].balances);
    } else {
      beginningBalances = Object.assign({}, parsed.balances);
    }

    let runningBalances = Object.assign({}, beginningBalances);

    monthsToRender.forEach((monthName) => {
      const currentMonthDate = parsed.monthDates[monthName];
      const prevDay = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth(), 0);
      const prevDateStr = getCachedDateInfo(prevDay).shortDate;
      const priorMonthNameForThis = getCachedDateInfo(prevDay).month;
      const monthBeginningBalances = savedState[priorMonthNameForThis]
        ? savedState[priorMonthNameForThis].balances
        : (monthName === startMonthName ? beginningBalances : parsed.balances);

      renderGSRSheet(ss, monthName, parsed.months[monthName], parsed.columns, parsed.uniqueVarieties, prevDateStr, monthBeginningBalances, runningBalances);

      const monthDays = parsed.months[monthName];
      for (const dayKey in monthDays) {
        const day = monthDays[dayKey];
        for (const typeKey in day.add) {
          const addMap = day.add[typeKey];
          for (const k in addMap) runningBalances[k] = (runningBalances[k] || 0) + addMap[k];
        }
        for (const typeKey in day.less) {
          const lessMap = day.less[typeKey];
          for (const k in lessMap) runningBalances[k] = (runningBalances[k] || 0) - lessMap[k];
        }
      }
      for (const k in runningBalances) {
        runningBalances[k] = Math.round(runningBalances[k] * 10000) / 10000;
        if (runningBalances[k] === 0 || runningBalances[k] === -0) runningBalances[k] = 0;
      }
    });

    SpreadsheetApp.flush();

    const allMonthsEndingBalances = {};
    sortedMonthNames.forEach((monthName) => {
      const monthlySheet = ss.getSheetByName(monthName);
      if (!monthlySheet) return;
      const lastRow = monthlySheet.getLastRow();
      const finalValues = monthlySheet.getRange(lastRow, 3, 1, numDataCols).getValues()[0];
      const isolatedMonthEndBalance = {};
      parsed.columns.forEach((col, idx) => {
        const val = parseFloat(finalValues[idx]);
        isolatedMonthEndBalance[col.join('|')] = isNaN(val) ? 0 : val;
      });
      allMonthsEndingBalances[monthName] = isolatedMonthEndBalance;
      if (monthsToRender.includes(monthName)) {
        writeMonthState_(ss, monthName, isolatedMonthEndBalance);
      }
    });

    const latestMonthName = sortedMonthNames[sortedMonthNames.length - 1];
    renderSummarySheet(ss, allMonthsEndingBalances[latestMonthName], parsed.varietyTypeMap);
    renderMonthlySheet(ss, allMonthsEndingBalances, parsed.varietyTypeMap, sortedMonthNames);

    SpreadsheetApp.flush();

    return {
      renderedCount: monthsToRender.length,
      monthsToRender,
      monthsToSkip,
      unmappedVarieties: parsed.unmappedVarieties,
      duplicateRows: parsed.duplicateRows,
      missingMonthSheets,
    };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-FILTERED SOURCE READ HELPER
// ─────────────────────────────────────────────────────────────────────────────

function getDateFilteredRows(sheet, dateCol1Based, startDate) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [null];

  const dateColValues = sheet.getRange(2, dateCol1Based, lastRow - 1, 1).getValues();
  let minOffset = -1;
  for (let i = 0; i < dateColValues.length; i++) {
    const raw = dateColValues[i][0];
    if (!raw) continue;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(d.getTime())) continue;
    if (d >= startDate) {
      if (minOffset === -1 || i < minOffset) minOffset = i;
    }
  }
  if (minOffset === -1) return [null];

  const startRowSheet = minOffset + 2;
  const numRows = lastRow - startRowSheet + 1;
  const slice = sheet.getRange(startRowSheet, 1, numRows, lastCol).getValues();
  return [null, ...slice];
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA PARSING (with source-row dedup + strict variety mapping)
// ─────────────────────────────────────────────────────────────────────────────

/** Row 1 headers as trimmed strings, in column order (0-based). */
function getSheetHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
}

/** First matching column index for any of candidateNames, or fallbackIndex if none found. */
function resolveColumnIndex_(headers, candidateNames, fallbackIndex) {
  for (const name of candidateNames) {
    const idx = headers.indexOf(name);
    if (idx !== -1) return idx;
  }
  return fallbackIndex;
}

/**
 * Like resolveColumnIndex_, but matches a header that STARTS WITH one of
 * the given prefixes - for headers that embed the year, e.g. the AI
 * sheet's confirmed "DATE (2026)" (will read "DATE (2027)" next year,
 * "DATE (2028)" the year after, etc. - an exact-name match would break
 * every January without this).
 */
function resolveColumnIndexByPrefix_(headers, prefixes, fallbackIndex) {
  for (const prefix of prefixes) {
    const idx = headers.findIndex((h) => h.toUpperCase().startsWith(prefix.toUpperCase()));
    if (idx !== -1) return idx;
  }
  return fallbackIndex;
}

/**
 * DATA_ENTRY dedup — keyed by column NAME, not position (confirmed real
 * headers: Timestamp, Date, Transaction, Variety, Bags, Net Kilos,
 * Warehouse Name, Customer Name, Province, Net Bags, WH Code, WSR #,
 * WSI #, AGE, Age Unit, Last Modified). A row's own document number is
 * whichever of WSR #/WSI # is actually populated for THAT row - a
 * TRANSFER row can carry both (see the sample the user provided), so
 * this checks WSR # first, then WSI #, per row rather than committing
 * to a single column for every row.
 */
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

    // No document number on this row at all - either a genuinely blank
    // row (skip silently) or a value-only composite match, which - same
    // reasoning as dedupAiRows_ - is NOT trustworthy enough to remove.
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
  return { rows: kept, duplicates, cols: { warehouseCol, wsrCol, wsiCol, dateCol, varietyCol, netBagsCol } };
}

/**
 * AI sheet dedup — confirmed real headers (from a sample row): DATE
 * (2026) [year embedded, see resolveColumnIndexByPrefix_], AI #, NAME OF
 * CUSTOMER, ISSUING WHSE, VARIETY CODE, BAG, NET KG, TRANSACTION,
 * AUTHORITY, OR No., Note1, Note2, Age Group, Last Modified. "AI #" is a
 * real unique reference number - a genuinely trustworthy key, so AI rows
 * now dedup the same safe way DATA_ENTRY's WSR#/WSI# already does (real
 * removal on a match). Any row that somehow has no AI # at all falls
 * back to the conservative value-composite report-only check, same
 * reasoning as dedupDataEntryRows_'s no-document-number branch.
 */
function dedupAiRows_(rows, headers) {
  const dateCol = resolveColumnIndexByPrefix_(headers, ["DATE"], 0);
  const aiNumberCol = resolveColumnIndex_(headers, ["AI #"], -1);
  const warehouseCol = resolveColumnIndex_(headers, ["ISSUING WHSE", "Warehouse Name", "Warehouse"], 3);
  const varietyCol = resolveColumnIndex_(headers, ["VARIETY CODE", "Variety"], 4);
  const kilosCol = resolveColumnIndex_(headers, ["NET KG", "Net Kilos", "Kilos"], 6);

  const seen = new Map();
  const kept = [null];
  const duplicates = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const warehouse = String(row[warehouseCol] || "").trim();
    const aiNumber = aiNumberCol !== -1 ? String(row[aiNumberCol] || "").trim() : "";
    const dateVal = row[dateCol], varietyVal = row[varietyCol], kilosVal = row[kilosCol];

    if (aiNumber) {
      // AI # is a real unique reference number - safe to actually remove.
      if (seen.has(aiNumber)) { duplicates.push(`AI #${aiNumber} (${warehouse})`); continue; }
      seen.set(aiNumber, true);
      kept.push(row);
      continue;
    }

    // No AI # on this row (shouldn't normally happen) - blank row, or a
    // value-only match that isn't trustworthy enough to remove.
    const isBlankRow = !dateVal && !warehouse && !varietyVal && !kilosVal;
    kept.push(row);
    if (isBlankRow) continue;

    const compositeKey = `${dateVal}::${warehouse}::${varietyVal}::${kilosVal}`;
    if (seen.has(compositeKey)) {
      duplicates.push(`${compositeKey} (${warehouse}) - no AI # on this row, verify against the sheet, NOT auto-removed`);
    } else {
      seen.set(compositeKey, true);
    }
  }
  return { rows: kept, duplicates, cols: { dateCol, aiNumberCol, warehouseCol, varietyCol, kilosCol } };
}

function parseAndFilterData(aiData, deData, startDate, deHeaders, aiHeaders, varietyTypeMap, startingBalances) {
  const isExcluded = v => !v || EXCLUDED_VARIETIES.has(v.toString().trim().toUpperCase());

  const deDedup = dedupDataEntryRows_(deData, deHeaders);
  const aiDedup = dedupAiRows_(aiData, aiHeaders);
  deData = deDedup.rows;
  aiData = aiDedup.rows;
  const duplicateRows = [...deDedup.duplicates.map(d => `DATA_ENTRY: ${d}`), ...aiDedup.duplicates.map(d => `AI: ${d}`)];

  // Resolve the remaining column names once, by header, for use below.
  const deVarietyCol = deDedup.cols.varietyCol;
  const deDateCol = deDedup.cols.dateCol;
  const deNetBagsCol = deDedup.cols.netBagsCol;
  const deWarehouseCol = deDedup.cols.warehouseCol;
  const deTransactionCol = resolveColumnIndex_(deHeaders, ["Transaction"], 2);
  const deAgeCol = resolveColumnIndex_(deHeaders, ["AGE"], 13); // NOT "Age Unit" (a text label like "Days") - that was v1's bug

  const aiDateCol = aiDedup.cols.dateCol;
  const aiWarehouseCol = aiDedup.cols.warehouseCol;
  const aiVarietyCol = aiDedup.cols.varietyCol;
  const aiKilosCol = aiDedup.cols.kilosCol;
  const aiTypeCol = resolveColumnIndex_(aiHeaders, ["TRANSACTION", "Transaction", "Type"], 7);
  const aiAgeGroupCol = resolveColumnIndex_(aiHeaders, ["Age Group", "AGE"], 12);

  let allVarieties = new Set(Object.keys(varietyTypeMap));

  if (deData && deData.length > 1) {
    for (let i = 1; i < deData.length; i++) {
      if (deData[i] && deData[i][deVarietyCol]) allVarieties.add(deData[i][deVarietyCol].toString().trim());
    }
  }
  if (aiData && aiData.length > 1) {
    for (let i = 1; i < aiData.length; i++) {
      if (aiData[i] && aiData[i][aiVarietyCol]) allVarieties.add(aiData[i][aiVarietyCol].toString().trim());
    }
  }

  const unmappedVarieties = [];
  allVarieties.forEach(v => {
    if (!varietyTypeMap[v]) {
      varietyTypeMap[v] = "unknown";
      if (!isExcluded(v)) unmappedVarieties.push(v);
    }
  });

  const balances = Object.assign({}, startingBalances); // this spreadsheet's own local SETUP, not the production sheet

  let months = {};
  let monthDates = {};
  const initDay = (m, d) => {
    if (!months[m]) months[m] = {};
    if (!months[m][d]) months[m][d] = { add: {}, less: {} };
  };

  for (let i = 1; i < deData.length; i++) {
    const row = deData[i];
    if (!row || !row[deDateCol]) continue;
    const date = row[deDateCol] instanceof Date ? row[deDateCol] : new Date(row[deDateCol]);
    if (isNaN(date.getTime()) || date < startDate) continue;

    const variety = row[deVarietyCol];
    const netBags = Number(row[deNetBagsCol]) || 0;
    if (netBags === 0 || isExcluded(variety)) continue;

    const dateInfo = getCachedDateInfo(date);
    const m = dateInfo.month, d = dateInfo.day;
    if (!monthDates[m] || date < monthDates[m]) monthDates[m] = new Date(date);

    initDay(m, d);
    // deAgeCol resolves to the real "AGE" column (numeric months/days),
    // NOT "Age Unit" (a text label like "Days") - v1 read the wrong one.
    const age = getAgeGroupFromVariety(variety, row[deAgeCol], varietyTypeMap);
    const destinationWh = row[deWarehouseCol] ? row[deWarehouseCol].toString().trim() : "";
    const key = `${destinationWh}|${variety}|${age}`;
    const type = (row[deTransactionCol] || "RECEIPT").toString().toUpperCase().trim();

    if (!months[m][d].add[type]) months[m][d].add[type] = {};
    months[m][d].add[type][key] = (months[m][d].add[type][key] || 0) + netBags;
  }

  for (let i = 1; i < aiData.length; i++) {
    const row = aiData[i];
    if (!row || !row[aiDateCol]) continue;
    const date = row[aiDateCol] instanceof Date ? row[aiDateCol] : new Date(row[aiDateCol]);
    if (isNaN(date.getTime()) || date < startDate) continue;

    const variety = row[aiVarietyCol];
    const netBags = (Number(row[aiKilosCol]) || 0) / 50;
    if (netBags === 0 || isExcluded(variety)) continue;

    const age = row[aiAgeGroupCol];
    if (age === undefined || age === null || age.toString().trim() === "") continue;

    const dateInfo = getCachedDateInfo(date);
    const m = dateInfo.month, d = dateInfo.day;
    if (!monthDates[m] || date < monthDates[m]) monthDates[m] = new Date(date);

    initDay(m, d);
    const sourceWh = (row[aiWarehouseCol] || "").toString().trim();
    const sourceWhUpper = sourceWh.toUpperCase();
    const key = `${sourceWh}|${variety}|${age}`;
    const type = (row[aiTypeCol] || "ISSUE").toString().toUpperCase().trim();

    if (sourceWhUpper === "PHF" && type.includes("TRANSFER")) {
      const addType = "MECHANICAL DRYING";
      if (!months[m][d].add[addType]) months[m][d].add[addType] = {};
      months[m][d].add[addType][key] = (months[m][d].add[addType][key] || 0) + netBags;
    }
    if (sourceWhUpper === "NFAO RM") {
      if (!months[m][d].add[type]) months[m][d].add[type] = {};
      months[m][d].add[type][key] = (months[m][d].add[type][key] || 0) + netBags;
    }

    if (!months[m][d].less[type]) months[m][d].less[type] = {};
    months[m][d].less[type][key] = (months[m][d].less[type][key] || 0) + netBags;
  }

  const activeKeysSet = new Set(Object.keys(balances));
  for (const month of Object.values(months)) {
    for (const day of Object.values(month)) {
      for (const typeMap of Object.values(day.add)) for (const k of Object.keys(typeMap)) activeKeysSet.add(k);
      for (const typeMap of Object.values(day.less)) for (const k of Object.keys(typeMap)) activeKeysSet.add(k);
    }
  }

  const sortedKeys = Array.from(activeKeysSet).sort();
  const columns = sortedKeys.map(k => k.split('|'));
  const uniqueVarieties = Array.from(new Set(columns.map(c => c[1]))).sort();

  return { months, balances, columns, uniqueVarieties, varietyTypeMap, monthDates, unmappedVarieties, duplicateRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY / AGE HELPERS (strict — no letter-guessing fallback)
// ─────────────────────────────────────────────────────────────────────────────

function getVarietyCategory(varietyName, varietyTypeMap = {}) {
  const mapped = (varietyTypeMap[varietyName] || "").toString().toLowerCase();
  if (mapped === "rice") return "rice";
  if (mapped === "palay") return "palay";
  return "unknown"; // NOT guessed - caller must handle "unknown" explicitly
}

function getAgeGroupFromType(typeStr, ageValue) {
  const type = (typeStr || "").toString().toLowerCase();
  const age = isNaN(Number(ageValue)) ? 0 : Number(ageValue);
  if (type.includes("rice")) return age <= 3 ? "0-3" : ">3";
  if (age <= 6) return "0-6";
  if (age <= 12) return "6.1-12";
  return ">12";
}

function getAgeGroupFromVariety(variety, ageValue, varietyTypeMap) {
  const cat = getVarietyCategory(variety, varietyTypeMap);
  return getAgeGroupFromType(cat === "unknown" ? "" : cat, ageValue);
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN LETTER / MERGE / BORDER HELPERS (unchanged from v1)
// ─────────────────────────────────────────────────────────────────────────────

function getColumnLetters(col) {
  if (colLetterCache[col]) return colLetterCache[col];
  let letters = "", n = col;
  while (n > 0) {
    const temp = (n - 1) % 26;
    letters = String.fromCharCode(65 + temp) + letters;
    n = Math.floor((n - temp - 1) / 26);
  }
  colLetterCache[col] = letters;
  return letters;
}

function mergeHeaderRowOptimized(sheet, rowNum, startCol, rowDataArray, parentDataArray = null) {
  const mergeA1s = [];
  let start = startCol;
  for (let i = startCol; i <= rowDataArray.length; i++) {
    const curr = rowDataArray[i - 1];
    const next = i < rowDataArray.length ? rowDataArray[i] : null;
    const pCurr = parentDataArray ? parentDataArray[i - 1] : null;
    const pNext = parentDataArray && i < rowDataArray.length ? parentDataArray[i] : null;
    const shouldBreak = curr !== next || (parentDataArray && pCurr !== pNext) || i === rowDataArray.length;
    if (shouldBreak) {
      if (i > start && curr !== "") {
        mergeA1s.push(`${getColumnLetters(start)}${rowNum}:${getColumnLetters(i)}${rowNum}`);
      }
      start = i + 1;
    }
  }
  for (let idx = 0; idx < mergeA1s.length; idx++) sheet.getRange(mergeA1s[idx]).merge();
  if (mergeA1s.length > 0) sheet.getRange(rowNum, startCol, 1, rowDataArray.length - startCol + 1).setFontWeight("bold");
}

function applyVerticalBorders(sheet, columns, maxRow, dataColCount) {
  let start = 3;
  const borderRanges = [];
  for (let i = 0; i < dataColCount; i++) {
    if (i === dataColCount - 1 || columns[i][0] !== columns[i + 1][0]) {
      borderRanges.push(`${getColumnLetters(start)}2:${getColumnLetters(3 + i)}${maxRow}`);
      start = 3 + i + 1;
    }
  }
  if (borderRanges.length > 0) {
    sheet.getRangeList(borderRanges).setBorder(null, true, null, true, null, null, "BLACK", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY GSR SHEET RENDERER (simplified beginning-balance logic — fix #4)
// ─────────────────────────────────────────────────────────────────────────────

function renderGSRSheet(ss, monthName, daysData, columns, uniqueVarieties, prevDateStr, keyedBeginningBalances, calculatedBalances) {
  const sheetExists = ss.getSheetByName(monthName) !== null;
  const sheet = ss.getSheetByName(monthName) || ss.insertSheet(monthName);

  let isCheckboxTrue = sheetExists ? sheet.getRange("B4").getValue() === true : true;

  // If the sheet exists and auto-sync is OFF, preserve whatever the admin
  // manually typed into row 5 (Beginning Inventory) by capturing it BEFORE
  // clear() — keyed to this month's own columns, not scanned from headers.
  let preservedRow5 = null;
  if (sheetExists && !isCheckboxTrue) {
    const lastCol = sheet.getLastColumn();
    if (lastCol >= 3) preservedRow5 = sheet.getRange(5, 3, 1, lastCol - 2).getValues()[0];
  }

  sheet.clear();

  const dataColCount = columns.length;
  const totalColCount = 2 + dataColCount + uniqueVarieties.length;

  const h1 = ["DATE", "PARTICULARS", ...columns.map(c => c[0]), ...uniqueVarieties.map(() => "VARIETY TOTALS")];
  const h2 = ["", "", ...columns.map(c => c[1]), ...uniqueVarieties.map(v => "TOTAL " + v)];
  const h3 = ["AUTO-SYNC PREV BAL? ->", isCheckboxTrue, ...columns.map(c => c[2]), ...uniqueVarieties.map(() => "")];

  const allValues = [];
  const allColors = [];
  const allWeights = [];
  const allFontColors = [];

  const createRow = (bgColor = "#ffffff", weight = "normal", fontColor = "#000000") => ({
    v: new Array(totalColCount).fill(""),
    c: new Array(totalColCount).fill(bgColor),
    w: new Array(totalColCount).fill(weight),
    fc: new Array(totalColCount).fill(fontColor)
  });
  const pushRow = ({ v, c, w, fc }) => { allValues.push(v); allColors.push(c); allWeights.push(w); allFontColors.push(fc); };

  pushRow(createRow());
  [h1, h2, h3].forEach(arr => { const r = createRow(THEME.primaryGreen, "bold", THEME.headerText); r.v = arr; pushRow(r); });

  const begRow = createRow("#fffde7", "normal", "#000000");
  begRow.v[0] = prevDateStr;
  begRow.v[1] = "BEGINNING INVENTORY";
  begRow.w[1] = "bold";

  columns.forEach((col, idx) => {
    const key = col.join('|');
    let finalVal;
    if (preservedRow5 !== null) {
      finalVal = preservedRow5[idx]; // admin's manual entry, untouched
    } else if (isCheckboxTrue) {
      finalVal = keyedBeginningBalances[key] || 0;
    } else {
      finalVal = keyedBeginningBalances[key] || 0; // no prior manual entry to preserve yet - seed from state
    }
    if (typeof finalVal === 'number') {
      finalVal = Math.round(finalVal * 10000) / 10000;
      if (finalVal === 0 || finalVal === -0) finalVal = 0;
    }
    begRow.v[2 + idx] = finalVal;
  });

  uniqueVarieties.forEach((v, vIdx) => {
    const cells = [];
    columns.forEach((col, cIdx) => { if (col[1] === v) cells.push(getColumnLetters(3 + cIdx) + 5); });
    if (cells.length > 0) { begRow.v[2 + dataColCount + vIdx] = `=${cells.join("+")}`; begRow.w[2 + dataColCount + vIdx] = "bold"; }
  });
  pushRow(begRow);

  let currentRow = 6;
  const days = Object.keys(daysData).sort((a, b) => Number(a) - Number(b));
  const dayBorderRows = [];

  days.forEach((day, dayIdx) => {
    const dayStartRow = currentRow;
    const renderSection = (dataMap, label, labelColor, valColor) => {
      const keys = Object.keys(dataMap);
      if (keys.length === 0) return currentRow - 1;
      const lblRow = createRow(currentRow % 2 === 0 ? THEME.alternateRow : "#ffffff");
      if (label === "ADD:") lblRow.v[0] = `${monthName} ${day}`;
      lblRow.v[1] = label; lblRow.w[1] = "bold"; lblRow.fc[1] = labelColor;
      pushRow(lblRow); currentRow++;

      keys.forEach(type => {
        const r = createRow(currentRow % 2 === 0 ? THEME.alternateRow : "#ffffff", "normal", valColor);
        r.v[1] = type; r.w[1] = "bold"; r.fc[1] = "#000000";
        columns.forEach((col, idx) => { const val = dataMap[type][col.join('|')]; if (val) r.v[2 + idx] = val; });
        uniqueVarieties.forEach((v, vIdx) => {
          const cells = [];
          columns.forEach((col, cIdx) => { if (col[1] === v) cells.push(getColumnLetters(3 + cIdx) + currentRow); });
          if (cells.length > 0) { r.v[2 + dataColCount + vIdx] = `=${cells.join("+")}`; r.w[2 + dataColCount + vIdx] = "bold"; }
        });
        pushRow(r); currentRow++;
      });
      return currentRow - 1;
    };

    const addEnd = renderSection(daysData[day].add, "ADD:", THEME.secondaryBlue, THEME.secondaryBlue);
    const skipAdd = addEnd < dayStartRow;
    const lessEnd = renderSection(daysData[day].less, "LESS:", "#b71c1c", "#b71c1c");
    if (skipAdd && lessEnd >= dayStartRow) allValues[dayStartRow - 1][0] = `${monthName} ${day}`;

    const endRow = createRow(currentRow % 2 === 0 ? THEME.alternateRow : "#ffffff", "bold");
    endRow.v[1] = "ENDING INVENTORY";
    for (let i = 0; i < dataColCount; i++) {
      const colChar = getColumnLetters(3 + i);
      const prevEnd = dayIdx === 0 ? 5 : dayStartRow - 1;
      const lessStart = addEnd >= dayStartRow + 1 ? addEnd + 2 : dayStartRow + 1;
      const addR = addEnd >= dayStartRow + 1 ? `SUM(${colChar}${dayStartRow + 1}:${colChar}${addEnd})` : "0";
      const lessR = lessEnd >= lessStart ? `SUM(${colChar}${lessStart}:${colChar}${lessEnd})` : "0";
      endRow.v[2 + i] = `=ROUND(${colChar}${prevEnd} + ${addR} - ${lessR}, 4)`;
    }
    uniqueVarieties.forEach((v, vIdx) => {
      const cells = [];
      columns.forEach((col, cIdx) => { if (col[1] === v) cells.push(getColumnLetters(3 + cIdx) + currentRow); });
      if (cells.length > 0) endRow.v[2 + dataColCount + vIdx] = `=${cells.join("+")}`;
    });
    pushRow(endRow);
    dayBorderRows.push(currentRow);
    currentRow++;
  });

  const totalRows = allValues.length;
  if (totalRows > 0) {
    const range = sheet.getRange(1, 1, totalRows, totalColCount);
    range.setValues(allValues);
    range.setBackgrounds(allColors);
    range.setFontWeights(allWeights);
    range.setFontColors(allFontColors);
    range.setFontFamily(THEME.font);
  }

  sheet.getRange("B4").insertCheckboxes();
  if (totalRows >= 5) sheet.getRange(5, 3, totalRows - 4, totalColCount - 2).setNumberFormat(THEME.numberFormat);
  sheet.getRange(2, 1, 3, totalColCount).setHorizontalAlignment("center");
  mergeHeaderRowOptimized(sheet, 2, 3, h1);
  mergeHeaderRowOptimized(sheet, 3, 3, h2, h1);
  applyVerticalBorders(sheet, columns, totalRows, dataColCount);

  if (dayBorderRows.length > 0) {
    const lastColChar = getColumnLetters(totalColCount);
    sheet.getRangeList(dayBorderRows.map(r => `A${r}:${lastColChar}${r}`))
      .setBorder(true, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
  }

  sheet.setColumnWidth(2, 180);
  sheet.setHiddenGridlines(true);
  sheet.setFrozenColumns(2);
}

function mergeMonthlyHeaderRow(sheet, rowNum, startCol, rowDataArray, parentDataArray = null) {
  mergeHeaderRowOptimized(sheet, rowNum, startCol, rowDataArray, parentDataArray);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY SHEET RENDERER — unchanged from v1 (not part of the bug list)
// ─────────────────────────────────────────────────────────────────────────────

function renderSummarySheet(ss, endingBalances, varietyTypeMap) {
  const sheet = ss.getSheetByName("SUMMARY") || ss.insertSheet("SUMMARY");
  sheet.clear();

  const THEME_PALAY = "#d9ead3", THEME_PALAY_ALT = "#c9dec2", THEME_HEADER_PALAY = "#b6d7a8";
  const THEME_RICE = "#cfe2f3", THEME_RICE_ALT = "#bdcddf", THEME_HEADER_RICE = "#9fc5e8";
  const THEME_LABEL = "#ffffff", THEME_LABEL_ALT = "#f3f3f3", THEME_SPACER = "#ffffff";

  let palayVarieties = new Set(), riceVarieties = new Set(), validWHs = new Set();
  const hasActivity = {};

  Object.keys(endingBalances).forEach(key => {
    const [wh, varName, age] = key.split('|');
    const whUpper = wh.toUpperCase();
    if (whUpper === "PHF" || whUpper === "NFAO RM") return;
    if (endingBalances[key] !== 0) {
      validWHs.add(wh);
      if (getVarietyCategory(varName, varietyTypeMap) === "rice") riceVarieties.add(varName);
      else palayVarieties.add(varName);
      hasActivity[`${varName}|${age}`] = true;
    }
  });

  palayVarieties = Array.from(palayVarieties).sort();
  riceVarieties = Array.from(riceVarieties).sort();
  validWHs = Array.from(validWHs).sort();

  const palayAges = ["0-6", "6.1-12", ">12"];
  const riceAges = ["0-3", ">3"];
  const colHasData = (v, a) => hasActivity[`${v}|${a}`];
  const getBal = (wh, v, a) => endingBalances[`${wh}|${v}|${a}`] || 0;

  const cols = [{ cat: "", var: "WAREHOUSE", age: "", type: "LABEL", color: THEME_LABEL, altColor: THEME_LABEL_ALT, headerColor: THEME_LABEL }];

  palayVarieties.forEach(v => palayAges.forEach(a => {
    if (colHasData(v, a)) cols.push({ cat: "PALAY", var: v, age: a, type: "DATA", color: THEME_PALAY, altColor: THEME_PALAY_ALT, headerColor: THEME_HEADER_PALAY });
  }));
  riceVarieties.forEach(v => riceAges.forEach(a => {
    if (colHasData(v, a)) cols.push({ cat: "RICE", var: v, age: a, type: "DATA", color: THEME_RICE, altColor: THEME_RICE_ALT, headerColor: THEME_HEADER_RICE });
  }));

  cols.push({ cat: "", var: "", age: "", type: "SPACER", color: THEME_SPACER, altColor: THEME_SPACER, headerColor: THEME_SPACER });

  if (palayVarieties.length > 0) {
    palayAges.forEach(a => {
      if (palayVarieties.some(v => colHasData(v, a)))
        cols.push({ cat: "PALAY", var: "SUB-TOTAL", age: a, type: "AGE_SUBTOTAL", color: THEME_PALAY, altColor: THEME_PALAY_ALT, headerColor: THEME_HEADER_PALAY });
    });
  }
  if (riceVarieties.length > 0) {
    riceAges.forEach(a => {
      if (riceVarieties.some(v => colHasData(v, a)))
        cols.push({ cat: "RICE", var: "SUB-TOTAL", age: a, type: "AGE_SUBTOTAL", color: THEME_RICE, altColor: THEME_RICE_ALT, headerColor: THEME_HEADER_RICE });
    });
  }

  cols.push({ cat: "", var: "", age: "", type: "SPACER", color: THEME_SPACER, altColor: THEME_SPACER, headerColor: THEME_SPACER });

  palayVarieties.forEach(v => cols.push({ cat: "PALAY", var: v, age: "", type: "VAR_GRANDTOTAL", parentCat: "PALAY", color: THEME_PALAY, altColor: THEME_PALAY_ALT, headerColor: THEME_HEADER_PALAY }));
  if (palayVarieties.length > 0) cols.push({ cat: "PALAY", var: "TOTAL PALAY", age: "", type: "CAT_GRANDTOTAL", parentCat: "PALAY", color: THEME_PALAY, altColor: THEME_PALAY_ALT, headerColor: THEME_HEADER_PALAY });
  riceVarieties.forEach(v => cols.push({ cat: "RICE", var: v, age: "", type: "VAR_GRANDTOTAL", parentCat: "RICE", color: THEME_RICE, altColor: THEME_RICE_ALT, headerColor: THEME_HEADER_RICE }));
  if (riceVarieties.length > 0) cols.push({ cat: "RICE", var: "TOTAL RICE", age: "", type: "CAT_GRANDTOTAL", parentCat: "RICE", color: THEME_RICE, altColor: THEME_RICE_ALT, headerColor: THEME_HEADER_RICE });

  const totalCols = cols.length;
  const allValues = [], allWeights = [];
  const pushRow = (v, w) => { allValues.push(v); allWeights.push(new Array(totalCols).fill(w)); };

  const computeRowValues = rowArr => {
    for (let i = 1; i < totalCols; i++) {
      const c = cols[i];
      if (c.type === "AGE_SUBTOTAL") {
        let sum = 0;
        for (let j = 1; j < i; j++) if (cols[j].type === "DATA" && cols[j].cat === c.cat && cols[j].age === c.age) sum += rowArr[j];
        rowArr[i] = sum;
      } else if (c.type === "VAR_GRANDTOTAL") {
        let sum = 0;
        for (let j = 1; j < i; j++) if (cols[j].type === "DATA" && cols[j].cat === c.parentCat && cols[j].var === c.var) sum += rowArr[j];
        rowArr[i] = sum;
      } else if (c.type === "CAT_GRANDTOTAL") {
        let sum = 0;
        for (let j = 1; j < i; j++) if (cols[j].type === "DATA" && cols[j].cat === c.parentCat) sum += rowArr[j];
        rowArr[i] = sum;
      }
    }
  };

  pushRow(new Array(totalCols).fill(""), "normal");
  const titleRow = new Array(totalCols).fill(""); titleRow[0] = "BRANCH"; pushRow(titleRow, "bold");
  pushRow(cols.map(c => c.cat), "bold");
  pushRow(cols.map(c => c.var), "bold");
  pushRow(cols.map(c => c.age), "bold");

  validWHs.forEach(wh => {
    const row = cols.map(c => c.type === "LABEL" ? wh : c.type === "DATA" ? getBal(wh, c.var, c.age) : 0);
    computeRowValues(row);
    allValues.push(row);
    allWeights.push(cols.map(c => c.type.includes("TOTAL") ? "bold" : "normal"));
  });

  const granEndRow = allValues.length;
  pushRow(new Array(totalCols).fill(""), "normal");

  const provTitleRowIdx = allValues.length + 1;
  const provTitleRow = new Array(totalCols).fill(""); provTitleRow[0] = "BRANCH TOTALS"; pushRow(provTitleRow, "bold");

  const provDataStartRow = allValues.length + 1;
  // NOTE: "ALBAY"/"CATANDUANES" below are the two provinces from the
  // reference JSON — replace this list (and the GID-2 filter) with
  // whatever province groupings actually apply to your warehouse set.
  ["ALBAY", "CATANDUANES"].forEach(prov => {
    const row = cols.map(c => {
      if (c.type === "LABEL") return prov;
      if (c.type === "DATA") {
        return validWHs
          .filter(wh => prov === "CATANDUANES" ? wh.toUpperCase().includes("GID 2") : !wh.toUpperCase().includes("GID 2"))
          .reduce((sum, wh) => sum + getBal(wh, c.var, c.age), 0);
      }
      return 0;
    });
    computeRowValues(row);
    pushRow(row, "bold");
  });

  const numRows = allValues.length;
  if (numRows === 0) return;

  const range = sheet.getRange(1, 1, numRows, totalCols);
  range.setValues(allValues);
  range.setFontFamily("Twentieth Century");

  const colorArray = [], styleArray = [];
  for (let rIdx = 0; rIdx < allValues.length; rIdx++) {
    const rowColors = [], rowStyles = [];
    const isDataRowG = rIdx >= 5 && rIdx < granEndRow;
    const isDataRowP = rIdx >= provDataStartRow - 1;
    for (let cIdx = 0; cIdx < totalCols; cIdx++) {
      const c = cols[cIdx];
      if (c.type === "SPACER") { rowColors.push("#ffffff"); rowStyles.push("normal"); continue; }
      if (rIdx === 0) { rowColors.push("#ffffff"); rowStyles.push("normal"); continue; }
      if (rIdx === 1) { rowColors.push(THEME.primaryGreen); rowStyles.push("normal"); continue; }
      if (rIdx >= 2 && rIdx <= 4) { rowColors.push(c.headerColor); rowStyles.push("normal"); continue; }
      if (rIdx === provTitleRowIdx - 1) { rowColors.push(THEME.primaryGreen); rowStyles.push("normal"); continue; }
      if (rIdx === granEndRow) { rowColors.push("#ffffff"); rowStyles.push("normal"); continue; }

      let isAlt = false;
      if (isDataRowG) isAlt = (rIdx - 5) % 2 !== 0;
      else if (isDataRowP) isAlt = (rIdx - (provDataStartRow - 1)) % 2 !== 0;

      rowColors.push(isAlt ? c.altColor : c.color);
      rowStyles.push((isDataRowG || isDataRowP) && c.type === "AGE_SUBTOTAL" ? "italic" : "normal");
    }
    colorArray.push(rowColors);
    styleArray.push(rowStyles);
  }

  range.setBackgrounds(colorArray);
  range.setFontWeights(allWeights);
  range.setFontStyles(styleArray);

  sheet.getRange(6, 2, numRows - 5, totalCols - 1).setNumberFormat(THEME.numberFormat);
  sheet.getRange(3, 1, 3, totalCols).setHorizontalAlignment("center");
  sheet.getRange(provDataStartRow, 1, numRows - provDataStartRow + 1, totalCols).setHorizontalAlignment("center");

  mergeHeaderRowOptimized(sheet, 3, 2, cols.map(c => c.cat));
  mergeHeaderRowOptimized(sheet, 4, 2, cols.map(c => c.var), cols.map(c => c.cat));

  sheet.setColumnWidth(1, 120);
  if (totalCols > 1) sheet.setColumnWidths(2, totalCols - 1, 80);
  cols.forEach((c, i) => { if (c.type === "SPACER") sheet.setColumnWidth(i + 1, 10); });

  sheet.setFrozenColumns(1);
  sheet.setHiddenGridlines(true);

  const dataBlocks = [];
  let currentStart = 1;
  for (let i = 0; i < cols.length; i++) {
    if (cols[i].type === "SPACER") {
      if (currentStart <= i) dataBlocks.push({ start: currentStart, width: i - currentStart + 1 });
      currentStart = i + 2;
    }
  }
  if (currentStart <= cols.length) dataBlocks.push({ start: currentStart, width: cols.length - currentStart + 1 });

  dataBlocks.forEach(block => {
    const mergeCol = block.start === 1 ? 2 : block.start;
    const mergeLen = block.start === 1 ? block.width - 1 : block.width;
    if (mergeLen > 0) {
      sheet.getRange(2, mergeCol, 1, mergeLen).merge().setHorizontalAlignment("center");
      sheet.getRange(provTitleRowIdx, mergeCol, 1, mergeLen).merge().setHorizontalAlignment("center");
    }
    const gRange = sheet.getRange(3, block.start, granEndRow - 2, block.width);
    gRange.setBorder(true, true, true, true, true, true, "black", SpreadsheetApp.BorderStyle.SOLID);
    gRange.setBorder(true, true, true, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
    sheet.getRange(3, block.start, 3, block.width).setBorder(null, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
    const pRange = sheet.getRange(provTitleRowIdx, block.start, numRows - provTitleRowIdx + 1, block.width);
    pRange.setBorder(true, true, true, true, true, true, "black", SpreadsheetApp.BorderStyle.SOLID);
    pRange.setBorder(true, true, true, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
    sheet.getRange(provTitleRowIdx, block.start, 1, block.width).setBorder(null, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  const granBorderRanges = [], provBorderRanges = [];
  for (let i = 0; i < cols.length; i++) {
    const colIndex = i + 1;
    let drawThick = false;
    if (i === cols.length - 1) drawThick = true;
    else {
      const curr = cols[i], next = cols[i + 1];
      if (curr.type === "LABEL") drawThick = true;
      else if (curr.type === "SPACER" || next.type === "SPACER") drawThick = false;
      else if (curr.var !== next.var) drawThick = true;
      else if (curr.type !== next.type && next.type.includes("TOTAL")) drawThick = true;
    }
    if (drawThick && cols[i].type !== "SPACER") {
      const cc = getColumnLetters(colIndex);
      granBorderRanges.push(`${cc}3:${cc}${granEndRow}`);
      provBorderRanges.push(`${cc}${provTitleRowIdx}:${cc}${numRows}`);
    }
  }
  if (granBorderRanges.length > 0) sheet.getRangeList(granBorderRanges).setBorder(null, null, null, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
  if (provBorderRanges.length > 0) sheet.getRangeList(provBorderRanges).setBorder(null, null, null, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY TRACKING SHEET RENDERER — unchanged from v1 (not part of the bug list)
// ─────────────────────────────────────────────────────────────────────────────

function renderMonthlySheet(ss, allMonthsEndingBalances, varietyTypeMap, sortedMonthNames) {
  const sheet = ss.getSheetByName("MONTHLY") || ss.insertSheet("MONTHLY");

  const THEME_PALAY = "#d9ead3", THEME_PALAY_ALT = "#c9dec2", THEME_HEADER_PALAY = "#b6d7a8";
  const THEME_RICE = "#cfe2f3", THEME_RICE_ALT = "#bdcddf", THEME_HEADER_RICE = "#9fc5e8";
  const THEME_LABEL = "#ffffff", THEME_LABEL_ALT = "#f3f3f3", THEME_SPACER = "#ffffff";

  let validWHs = new Set();
  const monthlyVarBalances = {}, validVarietiesPerMonth = {};

  sortedMonthNames.forEach(month => {
    monthlyVarBalances[month] = {};
    validVarietiesPerMonth[month] = { palay: new Set(), rice: new Set() };
    const rawData = allMonthsEndingBalances[month] || {};

    for (const key in rawData) {
      const val = rawData[key];
      if (Math.abs(val) < 0.01) continue;
      const [wh, varName] = key.split('|');
      const whUpper = wh.toUpperCase();
      if (whUpper === "PHF" || whUpper === "NFAO RM") continue;
      validWHs.add(wh);
      const noAgeKey = `${wh}|${varName}`;
      monthlyVarBalances[month][noAgeKey] = (monthlyVarBalances[month][noAgeKey] || 0) + val;
      const cat = getVarietyCategory(varName, varietyTypeMap);
      if (cat === "rice") validVarietiesPerMonth[month].rice.add(varName);
      else validVarietiesPerMonth[month].palay.add(varName);
    }
  });

  let albayWHs = [], ctdWHs = [];
  let isExistingSheet = false;
  const cols = [{ month: "", cat: "", var: "WAREHOUSE", type: "LABEL", color: THEME_LABEL, altColor: THEME_LABEL_ALT, headerColor: THEME_LABEL }];
  const historicalDataMap = {};

  if (sheet.getLastRow() > 3 && sheet.getLastColumn() > 1) {
    const lastCol = sheet.getLastColumn();
    const headerValues = sheet.getRange(1, 1, 3, lastCol).getValues();
    const existingVals = sheet.getDataRange().getValues();

    let currentSection = "ALBAY";
    for (let i = 3; i < existingVals.length; i++) {
      const val = existingVals[i][0].toString().trim();
      if (val === "SUB-TOTAL ALBAY") { currentSection = "CTD"; continue; }
      if (val === "SUB-TOTAL CATANDUANES") break;
      if (!val || val === "ALBAY BRANCH INVENTORY") continue;
      if (currentSection === "ALBAY") albayWHs.push(val);
      else ctdWHs.push(val);
    }
    if (albayWHs.length > 0 || ctdWHs.length > 0) isExistingSheet = true;

    let currentMonth = "", currentCat = "";
    const existingColsMeta = [null];

    for (let j = 1; j < lastCol; j++) {
      const m = headerValues[0][j].toString().trim();
      const c = headerValues[1][j].toString().trim();
      const v = headerValues[2][j].toString().trim();
      if (m !== "") currentMonth = m;
      if (c !== "") currentCat = c;
      let type = "DATA";
      if (v === "") type = "SPACER";
      else if (v.includes("TOTAL")) type = "CAT_TOTAL";
      existingColsMeta.push({ month: type === "SPACER" ? "" : currentMonth, cat: type === "SPACER" ? "" : currentCat, var: v, type, contextMonth: currentMonth });
    }

    for (let j = 1; j < lastCol; j++) {
      const meta = existingColsMeta[j];
      if (sortedMonthNames.includes(meta.contextMonth)) continue;
      let color = THEME_LABEL, altColor = THEME_LABEL_ALT, headerColor = THEME_LABEL;
      if (meta.cat === "PALAY") { color = THEME_PALAY; altColor = THEME_PALAY_ALT; headerColor = THEME_HEADER_PALAY; }
      else if (meta.cat === "RICE") { color = THEME_RICE; altColor = THEME_RICE_ALT; headerColor = THEME_HEADER_RICE; }
      else if (meta.type === "SPACER") { color = THEME_SPACER; altColor = THEME_SPACER; headerColor = THEME_SPACER; }
      cols.push({ month: meta.month, cat: meta.cat, var: meta.var, type: meta.type, color, altColor, headerColor });
    }

    for (let r = 3; r < existingVals.length; r++) {
      const whLabel = existingVals[r][0].toString().trim();
      if (!whLabel || whLabel.includes("SUB-TOTAL") || whLabel === "ALBAY BRANCH INVENTORY") continue;
      for (let j = 1; j < existingVals[r].length; j++) {
        const meta = existingColsMeta[j];
        if (meta.type !== "DATA" || sortedMonthNames.includes(meta.contextMonth)) continue;
        historicalDataMap[`${whLabel}|${meta.month}|${meta.cat}|${meta.var}`] = parseFloat(existingVals[r][j]) || 0;
      }
    }
  }

  const incomingWHs = Array.from(validWHs);
  const incomingAlbay = incomingWHs.filter(wh => !wh.toUpperCase().includes("GID 2"));
  const incomingCtd = incomingWHs.filter(wh => wh.toUpperCase().includes("GID 2"));

  incomingAlbay.forEach(wh => { if (!albayWHs.includes(wh)) albayWHs.push(wh); });
  if (!isExistingSheet) albayWHs.sort();
  incomingCtd.forEach(wh => { if (!ctdWHs.includes(wh)) ctdWHs.push(wh); });
  if (!isExistingSheet) ctdWHs.sort();

  const whArray = [...albayWHs, ...ctdWHs];

  sortedMonthNames.forEach(month => {
    const palayVars = Array.from(validVarietiesPerMonth[month].palay).sort();
    const riceVars = Array.from(validVarietiesPerMonth[month].rice).sort();
    if (palayVars.length === 0 && riceVars.length === 0) return;
    palayVars.forEach(v => cols.push({ month, cat: "PALAY", var: v, type: "DATA", color: THEME_PALAY, altColor: THEME_PALAY_ALT, headerColor: THEME_HEADER_PALAY }));
    if (palayVars.length > 0) cols.push({ month, cat: "PALAY", var: "TOTAL PALAY", type: "CAT_TOTAL", color: THEME_PALAY, altColor: THEME_PALAY_ALT, headerColor: THEME_HEADER_PALAY });
    riceVars.forEach(v => cols.push({ month, cat: "RICE", var: v, type: "DATA", color: THEME_RICE, altColor: THEME_RICE_ALT, headerColor: THEME_HEADER_RICE }));
    if (riceVars.length > 0) cols.push({ month, cat: "RICE", var: "TOTAL RICE", type: "CAT_TOTAL", color: THEME_RICE, altColor: THEME_RICE_ALT, headerColor: THEME_HEADER_RICE });
    cols.push({ month: "", cat: "", var: "", type: "SPACER", color: THEME_SPACER, altColor: THEME_SPACER, headerColor: THEME_SPACER });
  });

  const totalCols = cols.length;
  const allValues = [], allWeights = [];
  const pushRow = (v, w) => { allValues.push(v); allWeights.push(new Array(totalCols).fill(w)); };

  pushRow(cols.map(c => c.month), "bold");
  pushRow(cols.map(c => c.cat), "bold");
  pushRow(cols.map(c => c.var), "bold");

  const generateRow = (labelName, whList) => {
    const row = cols.map(c => {
      if (c.type === "LABEL") return labelName;
      if (c.type === "DATA") {
        if (sortedMonthNames.includes(c.month)) {
          return whList.reduce((s, wh) => s + (monthlyVarBalances[c.month][`${wh}|${c.var}`] || 0), 0);
        }
        return whList.reduce((s, wh) => s + (historicalDataMap[`${wh}|${c.month}|${c.cat}|${c.var}`] || 0), 0);
      }
      return 0;
    });
    for (let i = 1; i < totalCols; i++) {
      if (cols[i].type === "CAT_TOTAL") {
        let sum = 0;
        for (let j = 1; j < i; j++) if (cols[j].type === "DATA" && cols[j].month === cols[i].month && cols[j].cat === cols[i].cat) sum += row[j];
        row[i] = sum;
      }
    }
    return row;
  };

  albayWHs.forEach(wh => pushRow(generateRow(wh, [wh]), "normal"));
  pushRow(generateRow("SUB-TOTAL ALBAY", albayWHs), "bold");
  const albayEndIdx = allValues.length;

  ctdWHs.forEach(wh => pushRow(generateRow(wh, [wh]), "normal"));
  pushRow(generateRow("SUB-TOTAL CATANDUANES", ctdWHs), "bold");
  const ctdEndIdx = allValues.length;

  pushRow(new Array(totalCols).fill(""), "normal");
  pushRow(generateRow("ALBAY BRANCH INVENTORY", whArray), "bold");
  const grandTotalIdx = allValues.length;

  sheet.clear();
  if (allValues.length === 0) return;

  const range = sheet.getRange(1, 1, allValues.length, totalCols);
  range.setValues(allValues);
  range.setFontFamily("Twentieth Century");

  const colorArray = allValues.map((row, rIdx) =>
    cols.map(c => {
      if (c.type === "SPACER") return "#ffffff";
      if (rIdx <= 2) return c.headerColor;
      if (rIdx === albayEndIdx - 1 || rIdx === ctdEndIdx - 1 || rIdx === grandTotalIdx - 1) return c.headerColor;
      if (rIdx === ctdEndIdx) return "#ffffff";
      return rIdx % 2 !== 0 ? c.altColor : c.color;
    })
  );

  range.setBackgrounds(colorArray);
  range.setFontWeights(allWeights);
  sheet.getRange(4, 2, allValues.length - 3, totalCols - 1).setNumberFormat(THEME.numberFormat);
  sheet.getRange(1, 1, 3, totalCols).setHorizontalAlignment("center");

  mergeMonthlyHeaderRow(sheet, 1, 2, cols.map(c => c.month));
  mergeMonthlyHeaderRow(sheet, 2, 2, cols.map(c => c.cat), cols.map(c => c.month));

  sheet.setColumnWidth(1, 150);
  if (totalCols > 1) sheet.setColumnWidths(2, totalCols - 1, 90);
  cols.forEach((c, i) => { if (c.type === "SPACER") sheet.setColumnWidth(i + 1, 15); });

  sheet.setFrozenColumns(1);
  sheet.setFrozenRows(3);
  sheet.setHiddenGridlines(true);

  const borderRanges = [];
  for (let i = 0; i < cols.length; i++) {
    const colIndex = i + 1;
    let drawThick = false;
    if (i === cols.length - 1) drawThick = true;
    else {
      const curr = cols[i], next = cols[i + 1];
      if (curr.type === "LABEL" || curr.month !== next.month) drawThick = true;
      else if (curr.type === "SPACER" || next.type === "SPACER") drawThick = false;
      else if (curr.type !== next.type && next.type.includes("TOTAL")) drawThick = true;
    }
    if (drawThick && cols[i].type !== "SPACER") {
      const cc = getColumnLetters(colIndex);
      borderRanges.push(`${cc}1:${cc}${albayEndIdx}`);
      borderRanges.push(`${cc}${albayEndIdx + 1}:${cc}${ctdEndIdx}`);
      borderRanges.push(`${cc}${grandTotalIdx}:${cc}${grandTotalIdx}`);
    }
  }
  if (borderRanges.length > 0) {
    sheet.getRangeList(borderRanges).setBorder(null, null, null, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
  }

  const sC = "A", eC = getColumnLetters(totalCols);
  sheet.getRange(`${sC}3:${eC}3`).setBorder(null, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
  sheet.getRange(`${sC}${albayEndIdx}:${eC}${albayEndIdx}`).setBorder(true, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
  sheet.getRange(`${sC}${ctdEndIdx}:${eC}${ctdEndIdx}`).setBorder(true, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
  sheet.getRange(`${sC}${grandTotalIdx}:${eC}${grandTotalIdx}`).setBorder(true, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_THICK);
}
