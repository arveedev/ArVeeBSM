/**
 * ADDITION to the existing Apps Script file (result.txt / whatever you've
 * named it). This does NOT replace anything - it adds:
 *   1. Two new helper functions (place them anywhere in the file, e.g.
 *      right after findRowIndexByMatch).
 *   2. A new "fetchTransactionBySerial" and "fetchSerialFloor" action,
 *      added inside the EXISTING doGet(e) function's action check.
 *
 * ─────────────────────────────────────────────────────────────────────
 * STEP 1 — add these two new helper functions anywhere in the file
 * (e.g. right after findRowIndexByMatch, since they're related):
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * Like findRowIndexByMatch, but matches on TWO columns at once (e.g.
 * serial number AND warehouse name) rather than one. This exists
 * because a single spreadsheet can hold multiple warehouses' data in
 * the same sheet tab - two different warehouses could both legitimately
 * have a "WSR #50", and a serial-only match could silently return the
 * wrong warehouse's row. Returns -1 if no row matches both conditions.
 */
function findRowIndexByDoubleMatch(sheet, matchColumn, matchValue, warehouseColumn, warehouseValue) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return -1;

  const headers = values[0];
  const colIndex = headers.indexOf(matchColumn);
  const whIndex = warehouseColumn ? headers.indexOf(warehouseColumn) : -1;
  if (colIndex === -1) return -1;

  for (let r = 1; r < values.length; r++) {
    const serialMatches = String(values[r][colIndex]) === String(matchValue);
    if (!serialMatches) continue;
    if (warehouseColumn && whIndex !== -1) {
      const warehouseMatches = String(values[r][whIndex]).trim() === String(warehouseValue).trim();
      if (!warehouseMatches) continue;
    }
    return r + 1; // +1 for 1-based getRange row numbering
  }
  return -1;
}

/**
 * Scans every row in a sheet (optionally scoped to one warehouse) and
 * returns the lowest and highest numeric serial found in matchColumn -
 * used for the "floor" check, so the app can tell a regular user
 * "there's nothing before #3" based on what's ACTUALLY in the sheet,
 * not a guess. Non-numeric or unparseable serials are ignored. Returns
 * { min: null, max: null } if the sheet has no matching rows at all.
 */
function findSerialRange(sheet, matchColumn, warehouseColumn, warehouseValue) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { min: null, max: null };

  const headers = values[0];
  const colIndex = headers.indexOf(matchColumn);
  const whIndex = warehouseColumn ? headers.indexOf(warehouseColumn) : -1;
  if (colIndex === -1) return { min: null, max: null };

  let min = null, max = null;
  for (let r = 1; r < values.length; r++) {
    if (warehouseColumn && whIndex !== -1) {
      const warehouseMatches = String(values[r][whIndex]).trim() === String(warehouseValue).trim();
      if (!warehouseMatches) continue;
    }
    const raw = String(values[r][colIndex] ?? '');
    const digits = raw.match(/\d+/);
    if (!digits) continue;
    const num = parseInt(digits[0], 10);
    if (Number.isNaN(num)) continue;
    if (min === null || num < min) min = num;
    if (max === null || num > max) max = num;
  }
  return { min, max };
}

/**
 * ─────────────────────────────────────────────────────────────────────
 * STEP 2 — inside your EXISTING doGet(e) function, the action check
 * currently looks like this:
 *
 *     if (action !== 'fetchAuthorities') {
 *       return jsonResponse({ status: 'ERROR', message: 'Unknown action' });
 *     }
 *     ... rest of fetchAuthorities logic ...
 *
 * Replace JUST that opening block with this instead (everything else
 * in doGet stays exactly as it is):
 * ─────────────────────────────────────────────────────────────────────
 */

/*
  if (action === 'fetchTransactionBySerial') {
    const sheetName = e.parameter.sheet;
    const matchColumn = e.parameter.matchColumn;
    const matchValue = e.parameter.matchValue;
    const warehouseColumn = e.parameter.warehouseColumn || null;
    const warehouseValue = e.parameter.warehouseValue || null;

    if (!sheetName || !matchColumn || !matchValue) {
      return jsonResponse({ status: 'ERROR', message: 'Missing sheet/matchColumn/matchValue parameter' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return jsonResponse({ status: 'ERROR', message: `Sheet "${sheetName}" not found` });
    }

    const rowIndex = findRowIndexByDoubleMatch(sheet, matchColumn, matchValue, warehouseColumn, warehouseValue);
    if (rowIndex === -1) {
      return jsonResponse({ status: 'SUCCESS', row: null });
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const row = {};
    headers.forEach((header, i) => {
      if (!header) return;
      const cell = rowValues[i];
      row[header] = cell instanceof Date ? cell.toISOString() : cell;
    });

    // Last Modified fallback: if this row predates the onEdit trigger
    // and has no stamped value, fall back to column A's own timestamp
    // for that row, per explicit request - so historical rows never
    // come back with a missing/blank Last Modified.
    const lastModHeader = headers[LAST_MODIFIED_COLUMN_INDEX];
    if (lastModHeader && !row[lastModHeader]) {
      const colAHeader = headers[0];
      row[lastModHeader] = row[colAHeader] ?? null;
    }

    return jsonResponse({ status: 'SUCCESS', row });
  }

  if (action === 'fetchSerialFloor') {
    const sheetName = e.parameter.sheet;
    const matchColumn = e.parameter.matchColumn;
    const warehouseColumn = e.parameter.warehouseColumn || null;
    const warehouseValue = e.parameter.warehouseValue || null;

    if (!sheetName || !matchColumn) {
      return jsonResponse({ status: 'ERROR', message: 'Missing sheet/matchColumn parameter' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return jsonResponse({ status: 'ERROR', message: `Sheet "${sheetName}" not found` });
    }

    const range = findSerialRange(sheet, matchColumn, warehouseColumn, warehouseValue);
    return jsonResponse({ status: 'SUCCESS', min: range.min, max: range.max });
  }

  if (action !== 'fetchAuthorities') {
    return jsonResponse({ status: 'ERROR', message: 'Unknown action' });
  }
  ... rest of fetchAuthorities logic continues exactly as before ...
*/
