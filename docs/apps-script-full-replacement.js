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
          // Column J - when the actual milling happened, per the Sheet
          // itself. Needed so a completed order that never had a real
          // WSI/WSR transaction posted through this app (fully done via
          // some other path before this tracking existed) still has a
          // real date to sort by, instead of falling back to arbitrary
          // row order. Dates come back as real Date objects from
          // getValues() - convert to ISO so JSON.stringify doesn't
          // silently mangle them, matching the same convention already
          // used for transaction/authority dates elsewhere in this file.
          const dateOfMilling = row[9] instanceof Date ? row[9].toISOString() : (row[9] || null);
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

          const result = { number, ricemillName, recoveryPercent, aiNumber, siaNumber, receivingWarehouse, type: orderType, sheetStatus: sheetStatus || null, dateOfMilling };

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
        // Strips a leading warehouse-code-style prefix (e.g. "ALB-")
        // before comparing - confirmed via direct evidence that the
        // app's own warehouse names include this prefix while the
        // Sheet's own Warehouse Name column does not, which meant this
        // filter was silently excluding every row for a warehouse
        // whenever the two didn't match exactly, with the fetch itself
        // still reporting success - the actual root cause of preload
        // being marked complete while having imported nothing.
        const stripPrefix = (s) => String(s ?? '').trim().replace(/^[A-Z]{2,5}-/, '');
        const wanted = new Set(warehouseValues.map(stripPrefix));
        rows = rows.filter((row) => wanted.has(stripPrefix(row[warehouseColumn])));
      }

      if (modifiedSince) {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        // Deliberately name-based ("Last Modified" by exact header
        // text), NOT the same LAST_MODIFIED_COLUMN_INDEX used by
        // fetchAuthorities - that sheet's column at that fixed
        // position may have entirely different header text, and this
        // action's backup sheets have no such column at all yet, so
        // there is no existing position-based behavior to preserve
        // or risk breaking here.
        const hasLastModifiedColumn = headers.includes('Last Modified');
        if (hasLastModifiedColumn) {
          const cutoff = new Date(modifiedSince);
          rows = rows.filter((row) => {
            const stamped = row['Last Modified'];
            if (!stamped) return true; // never stamped - include rather than risk dropping it
            return new Date(stamped) >= cutoff;
          });
        }
        // No "Last Modified" column on this sheet at all - modifiedSince
        // is silently ignored and every row is returned, rather than
        // erroring out. This keeps the endpoint usable immediately after
        // ensureBackupSheetColumns/ensureLastModifiedColumn adds the
        // column but before every row has been touched/stamped yet.
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
  // Every write action below does a read-then-write (find a row, or find
  // there's no matching row, THEN append/update/delete) - without a lock,
  // two requests arriving close together (two devices/tabs both pushing
  // the same not-yet-confirmed-synced transaction, or the app's own retry
  // logic firing again because a previous response was lost in transit)
  // can both read the "before" state, both decide to append, and both
  // write - producing duplicate rows with nothing to stop it. LockService
  // serializes every doPost invocation against every other one, so the
  // second request always sees the FIRST request's completed write
  // before making its own decision. waitLock throws if it can't acquire
  // the lock within the timeout, which the outer try/catch below turns
  // into an ERROR response - the app's own postToSheetsWithRetry already
  // retries on any non-SUCCESS response, so a request that had to wait
  // simply retries shortly after, rather than racing.
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(30000);
    lockAcquired = true;
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
      // Stamped with the server's own current time, not anything the
      // client sent - keeps this consistent regardless of any given
      // device's clock being off, which matters for a timestamp other
      // devices will later filter on.
      const lastModIndex = headers.indexOf('Last Modified');
      if (lastModIndex !== -1) newRow[lastModIndex] = new Date().toISOString();

      // Idempotency guard: a row for this exact serial may already exist
      // on this sheet - from a retried sync after a dropped/late
      // confirmation, a race between two devices/tabs both pushing the
      // same not-yet-flagged-synced transaction, or a WTS append where
      // one side succeeded but the other failed and the whole push got
      // retried. Overwriting that existing row in place (the same thing
      // updateTransaction below does) instead of blindly appending again
      // keeps this action idempotent - calling it any number of times
      // with the same serial converges to exactly one row, never a
      // duplicate. This was the actual source of the "3, sometimes 12+
      // copies" duplication - nothing anywhere previously stopped a
      // retried or raced append from writing another row.
      const serialValue = body.row[body.serialColumn];
      const existingRowIndex = (serialValue !== undefined && serialValue !== null && serialValue !== '')
        ? findRowIndexByMatch(sheet, body.serialColumn, serialValue)
        : -1;

      if (existingRowIndex !== -1) {
        preformatSerialColumnAsText(sheet, headers, body.serialColumn, existingRowIndex);
        sheet.getRange(existingRowIndex, 1, 1, newRow.length).setValues([newRow]);
        return jsonResponse({ status: 'SUCCESS', deduped: true });
      }

      const newRowIndex = sheet.getLastRow() + 1;
      preformatSerialColumnAsText(sheet, headers, body.serialColumn, newRowIndex);
      sheet.appendRow(newRow);
      return jsonResponse({ status: 'SUCCESS' });
    }

    if (body.action === 'updateTransaction') {
      const rowIndex = findRowIndexByMatch(sheet, body.matchColumn, body.matchValue);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const updatedRow = headers.map((header) => (header in body.row ? body.row[header] : ''));
      const lastModIndex = headers.indexOf('Last Modified');
      if (lastModIndex !== -1) updatedRow[lastModIndex] = new Date().toISOString();

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
        // `found: false` lets the caller tell this apart from an actual
        // deletion - a row that was never located here (e.g. it lives on
        // a different date-ranged sheet source than the one this request
        // targeted) previously looked identical to a successful delete,
        // silently leaving stale rows behind with no way for the app to
        // notice or warn the user.
        return jsonResponse({ status: 'SUCCESS', found: false });
      }
      sheet.deleteRow(rowIndex);
      return jsonResponse({ status: 'SUCCESS', found: true });
    }

    if (body.action === 'markLastModified') {
      // Batch-stamps rows the app has only ever read/preloaded, never
      // written to - marking them "seen" so future modifiedSince
      // checks can finally exclude them, rather than including them
      // forever since they never had a timestamp to compare against.
      // Only stamps a row whose Last Modified cell is currently
      // blank, so this can never overwrite a timestamp from an actual
      // edit or app write - those are always more meaningful than a
      // mere "seen" mark. Reads and writes the entire column in one
      // pass each, not one cell at a time, given this can be called
      // with thousands of values from a single preload batch.
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const matchColIndex = headers.indexOf(body.matchColumn);
      const lastModColIndex = headers.indexOf('Last Modified');
      if (matchColIndex === -1 || lastModColIndex === -1 || sheet.getLastRow() < 2) {
        return jsonResponse({ status: 'SUCCESS', stamped: 0 }); // nothing to do on this sheet
      }

      const numRows = sheet.getLastRow() - 1;
      const matchValues = sheet.getRange(2, matchColIndex + 1, numRows, 1).getValues();
      const lastModRange = sheet.getRange(2, lastModColIndex + 1, numRows, 1);
      const lastModValues = lastModRange.getValues();
      const wanted = new Set((body.values || []).map(String));
      const now = new Date().toISOString();
      let stamped = 0;

      for (let i = 0; i < numRows; i++) {
        const rowValue = String(matchValues[i][0]);
        const alreadyStamped = lastModValues[i][0];
        if (wanted.has(rowValue) && !alreadyStamped) {
          lastModValues[i][0] = now;
          stamped++;
        }
      }

      if (stamped > 0) lastModRange.setValues(lastModValues);
      return jsonResponse({ status: 'SUCCESS', stamped });
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

      // value defaults to 'DONE' (existing natural-completion callers
      // never send it) - an explicit empty string clears the cell
      // instead, used when an admin manually reverts a completed
      // MO/TMO back to pending from the app.
      const statusValue = body.value !== undefined ? body.value : 'DONE';
      sheet.getRange(foundRow, 13).setValue(statusValue); // Column M
      return jsonResponse({ status: 'SUCCESS' });
    }

    return jsonResponse({ status: 'ERROR', message: 'Unknown action' });
  } catch (error) {
    return jsonResponse({ status: 'ERROR', message: error.message });
  } finally {
    if (lockAcquired) lock.releaseLock();
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
 *   Last Modified  - automatically stamped by the app itself with the
 *                  exact time a row was last written (appended or
 *                  updated) - never edit this by hand. Used to sync
 *                  only what has actually changed since a given time,
 *                  instead of re-downloading every row on every sync.
 */
function ensureBackupSheetColumns() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const sheetsAndColumns = [
    { name: 'DATA_ENTRY', columns: ['AGE', 'Age Unit', 'MO Number', 'TMO Number', 'Batch Number', 'Trial Number', 'RSBSA', 'Gender', 'Farmer Organization Members', 'Last Modified'] },
    { name: 'Issues Backup', columns: ['AGE', 'Age Unit', 'MO Number', 'TMO Number', 'Batch Number', 'Trial Number', 'RSBSA', 'Gender', 'Farmer Organization Members', 'Last Modified'] },
    { name: 'Sacks Receipts Backup', columns: ['MO Number', 'TMO Number', 'Batch Number', 'Trial Number', 'Last Modified'] },
    { name: 'Sacks Issues Backup', columns: ['MO Number', 'TMO Number', 'Batch Number', 'Trial Number', 'Last Modified'] },
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

/**
 * Simple trigger - Google Sheets recognizes and runs this
 * automatically on every manual edit made directly in the Sheets UI,
 * with no separate trigger setup required beyond saving this script.
 * (Simple triggers do NOT fire for the app's own programmatic writes
 * via appendTransaction/updateTransaction - only for a human actually
 * typing or pasting into a cell - so there is no risk of this
 * conflicting with the server-side stamping those actions already do.)
 *
 * Deliberately generic: works on whichever sheet was actually edited,
 * checking only whether that sheet happens to have a "Last Modified"
 * column by header name - not a hardcoded list of specific sheet
 * names. This means it already covers every backup sheet once
 * ensureBackupSheetColumns has been run, and will also cover the AI/
 * SIA sheets the moment they gain this same column, with no further
 * changes needed here.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const lastModCol = headers.indexOf('Last Modified') + 1; // 1-indexed for Range APIs
  if (lastModCol === 0) return; // this sheet has no such column at all - nothing to stamp

  // Skip entirely if the edit was made directly to the Last Modified
  // column itself, or to the header row (row 1) - neither should
  // trigger a stamp.
  const editedCol = e.range.getColumn();
  const editedColEnd = editedCol + e.range.getNumColumns() - 1;
  if (e.range.getRow() === 1) return;
  if (editedCol <= lastModCol && lastModCol <= editedColEnd && e.range.getNumColumns() === 1) return;

  const now = new Date().toISOString();
  const startRow = e.range.getRow();
  const numRows = e.range.getNumRows();
  for (let r = startRow; r < startRow + numRows; r++) {
    sheet.getRange(r, lastModCol).setValue(now);
  }
}
