/**
 * BSM App JSON API — the doPost/doGet layer this spreadsheet's Apps
 * Script project needs so the standalone React app (BSM App) can talk
 * to it over plain HTTP. This is a NEW file for a NEW deployment - it
 * does not replace or depend on any script from the earlier, separate
 * project.
 *
 * Add this as a new script file in this spreadsheet's Apps Script
 * project (Extensions > Apps Script > the "+" next to Files > Script),
 * alongside your existing onEdit trigger - they don't conflict.
 *
 * UPDATED: added updateTransaction and deleteTransaction actions.
 * Neither hardcodes a column name - both take matchColumn/matchValue
 * from the request itself (see findRowIndexByMatch below), so the app
 * decides which column identifies a row (WSR #, WSI #, ESR#, ESI#,
 * etc., one per sheet type) - this script just searches whatever
 * column name it's told to.
 *
 * UPDATED AGAIN: added fetchTransactionBySerial and fetchSerialFloor
 * (both GET, read-only, added at the very end of this file along with
 * their two helper functions). These let the app recognize and pull in
 * historical rows that were never created through the app itself (e.g.
 * rows entered before the app was used, or by any other means), and let
 * it determine the true earliest serial on record for a warehouse so
 * navigation never wanders below real history. Both match on serial
 * AND warehouse name together - a single spreadsheet can hold multiple
 * warehouses' rows in the same tab, and two different warehouses could
 * legitimately both have e.g. a "WSR #50", so matching serial alone
 * would risk silently returning the wrong warehouse's data. These two
 * new actions are read-only and are not subject to WRITE_ALLOWLIST -
 * they cannot modify anything.
 *
 * UPDATED AGAIN: added fetchTransactionsBulk (GET, read-only) - returns
 * every row for a sheet matching a given set of warehouse names in one
 * response, optionally filtered by Last Modified (modifiedSince), for
 * preloading a user's assigned warehouse(s) worth of transaction
 * history into the app in one pass at login, instead of looking a
 * single serial up at a time during navigation. Also read-only, not
 * subject to WRITE_ALLOWLIST.
 *
 * ── Safety, enforced here, not just trusted from the calling app ──
 * This app must NEVER write to the AI or SIA sheets - WRITE_ALLOWLIST
 * below is checked on every single write request BEFORE anything
 * touches the spreadsheet. A caller asking to write to "AI" or any
 * sheet not in this list gets rejected here, regardless of what the
 * calling app claims or intends. If you ever need to allow writing to
 * a new sheet, add its exact name to this list deliberately - nothing
 * is writable by default.
 */

const SPREADSHEET_ID = '1R5MpAlcY7WnJnc5DZTNyg3RYu1VYN9G8FyQnWIYZ1EU';

const WRITE_ALLOWLIST = [
  'DATA_ENTRY',              // WSR backup
  'Issues Backup',           // WSI backup
  'Sacks Receipts Backup',   // ESR backup
  'Sacks Issues Backup',     // ESI backup
  'MO',                      // Milling Order - STATUS column only, see markMillingOrderDone
  'TMO',                     // Test Milling Order - STATUS column only, see markMillingOrderDone
];

const LAST_MODIFIED_COLUMN_INDEX = 13; // column N, zero-based (N is the 14th column)

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Reads a sheet's data range into an array of plain objects keyed by
 * its header row (row 1) - e.g. a row with "AI #" in column A becomes
 * { "AI #": <that cell's value>, ... } for every column with a header.
 */
function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return []; // header only, or empty

  const headers = values[0];
  const rows = values.slice(1);

  return rows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      if (!header) return; // skip unlabeled/blank columns entirely
      const cell = row[i];
      // Dates come back as real Date objects from getValues() - convert
      // to ISO strings so JSON.stringify doesn't silently mangle them.
      obj[header] = cell instanceof Date ? cell.toISOString() : cell;
    });
    return obj;
  });
}

/**
 * Finds the 1-based sheet row index (matching getRange's row numbering,
 * so row 1 is the header) whose value in matchColumn equals matchValue.
 * Returns -1 if no match or the column doesn't exist. Used by both
 * updateTransaction and deleteTransaction to locate the right row
 * before acting on it.
 */
function findRowIndexByMatch(sheet, matchColumn, matchValue) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return -1;

  const headers = values[0];
  const colIndex = headers.indexOf(matchColumn);
  if (colIndex === -1) return -1;

  for (let r = 1; r < values.length; r++) {
    // String comparison - serial numbers may be stored as text or
    // numbers depending on how a cell was originally entered.
    if (String(values[r][colIndex]) === String(matchValue)) {
      return r + 1; // +1 for 1-based getRange row numbering
    }
  }
  return -1;
}

/**
 * Pre-formats a specific cell as plain text BEFORE anything is written
 * to it. This has to happen BEFORE the write, not after - Google
 * Sheets auto-detects a value like "09190210" as a number and silently
 * strips the leading zero (storing 9190210 instead) at the moment the
 * value is written; reading it back afterward would only return the
 * already-stripped value, too late to recover the original. Once a
 * cell's format is set to '@' (text) ahead of time, Sheets respects it
 * and stores the value as entered instead. columnName is whichever
 * column actually holds the serial number for a given sheet (WSR #,
 * WSI #, ESR#, ESI#) - looked up dynamically so this works for every
 * sheet without hardcoding a specific one. No-ops harmlessly if
 * columnName isn't found or wasn't provided.
 */
function preformatSerialColumnAsText(sheet, headers, columnName, rowIndex) {
  if (!columnName) return;
  const colIndex = headers.indexOf(columnName);
  if (colIndex === -1) return;
  sheet.getRange(rowIndex, colIndex + 1).setNumberFormat('@');
  SpreadsheetApp.flush(); // ensure the format is committed before the value is written
}

/**
 * GET {webAppUrl}?action=fetchAuthorities&sheet={name}&type=AI|SIA&modifiedSince={ISO string, optional}
 * -> { status: "SUCCESS", rows: [...] }
 *
 * modifiedSince filters using column N (Last Modified, auto-stamped by
 * your existing onEdit trigger) - if a row has no Last Modified value
 * at all (e.g. it predates the trigger being added), it's included
 * regardless, so genuinely old rows are never silently dropped just
 * because they were never touched since the trigger went in.
 *
 * GET {webAppUrl}?action=fetchTransactionBySerial&sheet={name}&matchColumn={col}&matchValue={serial}&warehouseColumn=Warehouse Name&warehouseValue={name}
 * -> { status: "SUCCESS", row: {...} | null }
 * Looks up a single historical row by serial + warehouse together. Read-only.
 *
 * GET {webAppUrl}?action=fetchSerialFloor&sheet={name}&matchColumn={col}&warehouseColumn=Warehouse Name&warehouseValue={name}
 * -> { status: "SUCCESS", min: number|null, max: number|null }
 * Returns the lowest/highest serial actually on record for a warehouse. Read-only.
 */
function doGet(e) {
  try {
    const action = e.parameter.action;

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
      // for that row, so historical rows never come back with a
      // missing/blank Last Modified.
      const lastModHeader = headers[LAST_MODIFIED_COLUMN_INDEX];
      if (lastModHeader && !row[lastModHeader]) {
        const colAHeader = headers[0];
        row[lastModHeader] = row[colAHeader] ?? null;
      }

      return jsonResponse({ status: 'SUCCESS', row });
    }

    if (action === 'fetchMillingOrders') {
      const sheetName = e.parameter.sheet;
      const orderType = e.parameter.type; // 'MO' or 'TMO'

      if (!sheetName || !orderType) {
        return jsonResponse({ status: 'ERROR', message: 'Missing sheet/type parameter' });
      }

      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        return jsonResponse({ status: 'ERROR', message: `Sheet "${sheetName}" not found` });
      }

      // Read by raw column POSITION, not header name - column A = index
      // 0, C = index 2, D = index 3, E = index 4, G = index 6, L = index
      // 11. Data starts on row 4 (rows 1-3 are header/metadata), so
      // skip the first 3 rows.
      const values = sheet.getDataRange().getValues();
      const dataRows = values.slice(3);

      const orders = dataRows
        .filter((row) => row[0]) // skip fully blank rows
        .map((row) => {
          const prefix = String(row[0]).trim(); // Column A - e.g. "MO No. ALB-2026"
          const letter = String(row[2] ?? '').trim(); // Column C - e.g. "D"
          const sequence = String(row[3] ?? '').trim(); // Column D - e.g. "027"
          const number = [prefix, letter, sequence].filter(Boolean).join('-');
          const ricemillName = String(row[4] ?? '').trim(); // Column E
          const recoveryPercent = row[11] !== '' && row[11] != null ? Number(row[11]) : null; // Column L
          const aiNumber = String(row[7] ?? '').trim() || null; // Column H
          const siaNumber = String(row[8] ?? '').trim() || null; // Column I
          const receivingWarehouse = String(row[10] ?? '').trim() || null; // Column K
          // Column M - manually typed "DONE" by the admin. Previously
          // this caused the row to be excluded entirely from every
          // response, meaning once an MO/TMO was marked DONE, the app
          // could never see it again through this sync path at all -
          // not even for editing/verifying an already-existing
          // transaction that used it. Now included with an explicit
          // status flag instead, so the client can decide what to show
          // depending on context (hide DONE ones when creating a new
          // transaction, but show everything - including DONE - when
          // editing an existing one, so a user can see and verify
          // exactly which MO/TMO was actually selected).
          const sheetStatus = String(row[12] ?? '').trim().toUpperCase();

          const result = { number, ricemillName, recoveryPercent, aiNumber, siaNumber, receivingWarehouse, type: orderType, sheetStatus: sheetStatus || null };

          if (orderType === 'MO') {
            // Column G - "1 of 15" format: current batch / total batches
            // FOR THIS RICEMILL specifically (one MO can involve several
            // ricemills, each with their own independent batch count).
            const batchRaw = String(row[6] ?? '').trim();
            const batchMatch = batchRaw.match(/(\d+)\s*of\s*(\d+)/i);
            result.batchCurrent = batchMatch ? Number(batchMatch[1]) : null;
            result.batchTotal = batchMatch ? Number(batchMatch[2]) : null;
            result.batchRaw = batchRaw || null;
          }

          return result;
        })
        .filter((o) => o && o.number); // must have a constructible number, and not be marked DONE

      return jsonResponse({ status: 'SUCCESS', orders });
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

    if (action === 'fetchTransactionsBulk') {
      const sheetName = e.parameter.sheet;
      const warehouseColumn = e.parameter.warehouseColumn || null;
      // Comma-separated list of warehouse names to include - kept as a
      // single request rather than one call per warehouse, since a
      // user can be assigned to more than one.
      const warehouseValuesRaw = e.parameter.warehouseValues || '';
      const warehouseValues = warehouseValuesRaw
        ? warehouseValuesRaw.split(',').map((v) => v.trim()).filter(Boolean)
        : [];
      const modifiedSince = e.parameter.modifiedSince || null;

      if (!sheetName) {
        return jsonResponse({ status: 'ERROR', message: 'Missing sheet parameter' });
      }

      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        return jsonResponse({ status: 'ERROR', message: `Sheet "${sheetName}" not found` });
      }

      let rows = sheetToObjects(sheet);

      if (warehouseColumn && warehouseValues.length > 0) {
        const wanted = new Set(warehouseValues);
        rows = rows.filter((row) => wanted.has(String(row[warehouseColumn] ?? '').trim()));
      }

      if (modifiedSince) {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const lastModHeader = headers[LAST_MODIFIED_COLUMN_INDEX];
        const cutoff = new Date(modifiedSince);
        rows = rows.filter((row) => {
          const stamped = row[lastModHeader];
          if (!stamped) return true; // never stamped - include rather than risk dropping it
          return new Date(stamped) >= cutoff;
        });
      }

      return jsonResponse({ status: 'SUCCESS', rows });
    }

    if (action !== 'fetchAuthorities') {
      return jsonResponse({ status: 'ERROR', message: 'Unknown action' });
    }

    const sheetName = e.parameter.sheet;
    if (!sheetName) {
      return jsonResponse({ status: 'ERROR', message: 'Missing sheet parameter' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return jsonResponse({ status: 'ERROR', message: `Sheet "${sheetName}" not found` });
    }

    let rows = sheetToObjects(sheet);

    // Regional Authority Number - Column J (index 9), read by raw
    // position rather than header name, since only the column's
    // position was confirmed, not its header wording. A separate
    // reference number from the app's own AI/SIA numbers - used to tag
    // milling operations with a common cross-warehouse reference.
    const rawValues = sheet.getDataRange().getValues();
    const dataRows = rawValues.slice(1);
    rows.forEach((row, i) => {
      const regionalAuthNum = dataRows[i] ? dataRows[i][9] : null;
      row['Regional Authority Number'] = regionalAuthNum != null && regionalAuthNum !== ''
        ? String(regionalAuthNum).trim()
        : null;
      // Source Warehouse - Column D (index 3), same raw-position
      // reasoning as Regional Authority Number above.
      const sourceWarehouse = dataRows[i] ? dataRows[i][3] : null;
      row['Source Warehouse'] = sourceWarehouse != null && sourceWarehouse !== ''
        ? String(sourceWarehouse).trim()
        : null;
    });

    const modifiedSince = e.parameter.modifiedSince;
    if (modifiedSince) {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const lastModHeader = headers[LAST_MODIFIED_COLUMN_INDEX];
      const cutoff = new Date(modifiedSince);

      rows = rows.filter((row) => {
        const stamped = row[lastModHeader];
        if (!stamped) return true; // never stamped - include rather than risk dropping it
        return new Date(stamped) >= cutoff;
      });
    }

    return jsonResponse({ status: 'SUCCESS', rows });
  } catch (error) {
    return jsonResponse({ status: 'ERROR', message: error.message });
  }
}

/**
 * POST {webAppUrl}  body: { action, sheet, ... }
 * -> { status: "SUCCESS" } or { status: "ERROR", message }
 *
 * Three actions, all checked against WRITE_ALLOWLIST before touching
 * anything:
 *
 *   appendTransaction: { sheet, row } - adds a new row, mapping the
 *     posted object's keys to whichever columns the target sheet's own
 *     header row already has (in that sheet's own column order) - the
 *     header row is the single source of truth for column layout.
 *
 *   updateTransaction: { sheet, matchColumn, matchValue, row } - finds
 *     the row whose matchColumn cell equals matchValue and overwrites
 *     its entire contents with row (same column-mapping rule as
 *     append). Returns an error if no matching row is found - it does
 *     NOT fall back to creating one, since a mismatched serial number
 *     usually means something else is wrong and silently appending
 *     instead would hide that.
 *
 *   deleteTransaction: { sheet, matchColumn, matchValue } - finds and
 *     deletes the matching row entirely (mirrors the app's own
 *     behavior, which is a real hard delete, not a soft/marked one).
 *     Returns SUCCESS even if no matching row was found, since the end
 *     state (no such row exists) is the same either way.
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const sheetName = body.sheet;

    if (!WRITE_ALLOWLIST.includes(sheetName)) {
      return jsonResponse({ status: 'ERROR', message: `Writing to "${sheetName}" is not permitted` });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return jsonResponse({ status: 'ERROR', message: `Sheet "${sheetName}" not found` });
    }

    if (body.action === 'appendTransaction') {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const newRow = headers.map((header) => (header in body.row ? body.row[header] : ''));
      const newRowIndex = sheet.getLastRow() + 1;
      preformatSerialColumnAsText(sheet, headers, body.serialColumn, newRowIndex);
      sheet.appendRow(newRow);
      return jsonResponse({ status: 'SUCCESS' });
    }

    if (body.action === 'updateTransaction') {
      const rowIndex = findRowIndexByMatch(sheet, body.matchColumn, body.matchValue);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const updatedRow = headers.map((header) => (header in body.row ? body.row[header] : ''));

      if (rowIndex === -1) {
        // No matching row - most commonly because it was deleted by
        // hand (a real, expected scenario, not necessarily a mismatch
        // bug) - fall back to appending it fresh rather than retrying
        // this same failure forever with no way to ever resolve it.
        const newRowIndex = sheet.getLastRow() + 1;
        preformatSerialColumnAsText(sheet, headers, body.matchColumn, newRowIndex);
        sheet.appendRow(updatedRow);
        return jsonResponse({ status: 'SUCCESS' });
      }

      preformatSerialColumnAsText(sheet, headers, body.matchColumn, rowIndex);
      sheet.getRange(rowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);
      return jsonResponse({ status: 'SUCCESS' });
    }

    if (body.action === 'deleteTransaction') {
      const rowIndex = findRowIndexByMatch(sheet, body.matchColumn, body.matchValue);
      if (rowIndex === -1) {
        // Already gone (or never existed) - same end state either way, not an error.
        return jsonResponse({ status: 'SUCCESS' });
      }
      sheet.deleteRow(rowIndex);
      return jsonResponse({ status: 'SUCCESS' });
    }

    if (body.action === 'markMillingOrderDone') {
      // The ONLY write action for MO/TMO sheets, and it only ever
      // touches the STATUS column (M, column 13 / index 12) of exactly
      // one row - never any other cell or column. Finds the row by
      // reconstructing the A+C+D number the same way fetchMillingOrders
      // does, since there's no dedicated ID column to match against
      // directly.
      const targetNumber = body.number;
      if (!targetNumber) {
        return jsonResponse({ status: 'ERROR', message: 'Missing number parameter' });
      }

      const values = sheet.getDataRange().getValues();
      let foundRow = -1;
      // Data starts on row 4 (rows 1-3 are header/metadata) - matches
      // fetchMillingOrders' same offset.
      for (let i = 3; i < values.length; i++) {
        const row = values[i];
        const prefix = String(row[0] ?? '').trim();
        const letter = String(row[2] ?? '').trim();
        const sequence = String(row[3] ?? '').trim();
        const number = [prefix, letter, sequence].filter(Boolean).join('-');
        if (number === targetNumber) {
          foundRow = i + 1; // 1-based sheet row
          break;
        }
      }

      if (foundRow === -1) {
        return jsonResponse({ status: 'ERROR', message: `No row found matching "${targetNumber}"` });
      }

      sheet.getRange(foundRow, 13).setValue('DONE'); // Column M
      return jsonResponse({ status: 'SUCCESS' });
    }

    return jsonResponse({ status: 'ERROR', message: 'Unknown action' });
  } catch (error) {
    return jsonResponse({ status: 'ERROR', message: error.message });
  }
}

/**
 * Like findRowIndexByMatch, but matches on TWO columns at once (e.g.
 * serial number AND warehouse name) rather than one. This exists
 * because a single spreadsheet can hold multiple warehouses' data in
 * the same sheet tab - two different warehouses could both legitimately
 * have a "WSR #50", and a serial-only match could silently return the
 * wrong warehouse's row. Returns -1 if no row matches both conditions.
 * If warehouseColumn is omitted, behaves exactly like findRowIndexByMatch.
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
 * ONE-TIME MAINTENANCE FUNCTION - run this directly from the Apps
 * Script editor (select "ensureBackupSheetColumns" from the function
 * dropdown at the top, then click Run) to automatically add every
 * column the app needs for its Milling/Procurement fields, to every
 * backup sheet that's missing them.
 *
 * Safe to run multiple times - only ADDS columns that don't already
 * exist (checked by exact header text match); never touches, reorders,
 * or removes any existing column or any existing data. New columns are
 * always appended after the last existing column, so nothing shifts.
 *
 * What each column will contain, once the app starts writing to it:
 *   AGE          - the pile's age at the time of this transaction, as
 *                  a plain number (e.g. "2") - EXCEPT when Age Unit is
 *                  "Months + Days" (see below), in which case this
 *                  column instead contains a readable string like
 *                  "2 months, 5 days" rather than a bare number, since
 *                  a single number can't represent a combined value.
 *                  Only present on stock transactions (WSR/WSI) -
 *                  sacks never have an age. Numeric values are rounded
 *                  to at most 3 decimal places.
 *   Age Unit     - "Days", "Months", or "Months + Days" - whichever
 *                  unit was actually used for this specific
 *                  transaction. Always check this column before
 *                  interpreting the AGE column's number.
 *   MO Number    - the full Milling Order reference the app derived
 *                  for this transaction (e.g. "MO No. ALB-2026-D-027")
 *   TMO Number   - same, for Test Milling Order
 *   Batch Number - which batch (of however many) this transaction's
 *                  MO covers, as a plain number
 *   Trial Number - which trial (1, 2, or 3) this transaction's TMO
 *                  covers, as a plain number
 *   RSBSA        - the RSBSA registration ID of the farmer named on a
 *                  Procurement transaction (blank if not Procurement,
 *                  or if the field was left blank)
 *   Gender       - the farmer's gender, same conditions as RSBSA
 *   Farmer Organization Members - if the Procurement was from a
 *                  cooperative rather than an individual farmer, every
 *                  member's name, RSBSA, and gender, formatted as one
 *                  readable line per transaction (e.g. "Juan Dela Cruz
 *                  (12-34-56, Male); Maria Santos (no RSBSA, Female)")
 */
function ensureBackupSheetColumns() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const sheetsAndColumns = [
    { name: 'DATA_ENTRY', columns: ['AGE', 'Age Unit', 'MO Number', 'TMO Number', 'Batch Number', 'Trial Number', 'RSBSA', 'Gender', 'Farmer Organization Members'] },
    { name: 'Issues Backup', columns: ['AGE', 'Age Unit', 'MO Number', 'TMO Number', 'Batch Number', 'Trial Number', 'RSBSA', 'Gender', 'Farmer Organization Members'] },
    { name: 'Sacks Receipts Backup', columns: ['MO Number', 'TMO Number', 'Batch Number', 'Trial Number'] },
    { name: 'Sacks Issues Backup', columns: ['MO Number', 'TMO Number', 'Batch Number', 'Trial Number'] },
  ];

  const results = [];

  sheetsAndColumns.forEach(({ name, columns }) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      results.push(`SKIPPED "${name}" - sheet not found`);
      return;
    }

    const lastCol = sheet.getLastColumn();
    const existingHeaders = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim())
      : [];

    const missing = columns.filter((c) => !existingHeaders.includes(c));
    if (missing.length === 0) {
      results.push(`"${name}" already has every needed column - nothing to add`);
      return;
    }

    // Append each missing column one at a time, always after the
    // current last column, so existing columns are never disturbed.
    missing.forEach((header) => {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(header);
    });
    results.push(`"${name}" - added: ${missing.join(', ')}`);
  });

  // Logged to the Apps Script editor's own execution log (View >
  // Logs, or Ctrl+Enter after running) - this is a one-time manual
  // run, not something the app calls, so there's no need for a JSON
  // response here.
  Logger.log(results.join('\n'));
  return results;
}
