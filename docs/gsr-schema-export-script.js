/**
 * GSR Schema Export Tool — replaces your current gsrsheet.txt script
 * entirely. This is a DIAGNOSTIC/EXPORT tool only, not the GSR generator
 * itself - it lets me see a faithful blueprint of each existing GSR
 * sheet (values, formulas, bold, merges, column widths, frozen panes) so
 * the new generator can be built to actually match, instead of guessing.
 *
 * REMOVED from your current script (per your instructions):
 *   - CPF & SDO Balances modal + PROCURMENT 2 read/write (showCpfModal,
 *     getCurrentData, saveCpfData) - CPF is being redesigned as a daily
 *     Disbursing-Officer submission feeding the new GSR generator, not
 *     this manual modal.
 *   - clearToday() - was for reusing ONE persistent GSR sheet day after
 *     day; the new GSR is a brand-new spreadsheet file per report, so
 *     there's nothing to "clear" going forward.
 *   - The entire old hide/unhide mechanism (setupConfigSheet,
 *     letterToColumn, getConfigMap, isRowEmpty, hideEmptyRowsAllSheets,
 *     unhideAllRowsAllSheets, and the _Config_ sheet it depended on) -
 *     you confirmed neither is used in the current workflow; hiding
 *     empty rows/columns will be handled automatically by the new
 *     generator based on which warehouses/varieties actually have data,
 *     not this manual per-sheet row-range config.
 *
 * KEPT + ENHANCED: getSheetList/showSchemaPicker (same picker UI you're
 * used to), getSingleSheetSchema replaced with getSingleSheetSchemaFull -
 * same compact shape as before (plain value when nothing special about
 * a cell) but now also captures:
 *   - formulas (the cell's real formula, e.g. "=IFERROR(G7/G8,0)")
 *   - bold
 *   - merged ranges (as A1 notation)
 *   - column widths
 *   - frozen rows/columns
 *
 * USE: run this in the SAME GSR spreadsheet's Apps Script project
 * (replace the old script entirely, or add as a new file - either
 * works, just make sure only ONE onOpen()/showSchemaPicker() pair
 * exists to avoid a naming collision). Reload the spreadsheet, use the
 * menu to generate the schema for each of the 9 report pages, and paste
 * each result back the same way you shared the original JSON exports.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('GSR Tools')
    .addItem('Get Full Sheet Schema (values + formulas + formatting)', 'showSchemaPicker')
    .addToUi();
}

/** Gets all sheet names for the picker. */
function getSheetList() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().map(s => s.getName());
}

/**
 * Same compact shape as the original getSingleSheetSchema (a plain
 * scalar for an ordinary cell, headers from row 1, blank cells/rows
 * dropped) but a cell becomes a small object - { v, f, b } - the moment
 * it has a formula and/or is bold, so nothing about layout/logic is lost.
 * Sheet-level metadata (frozen panes, merges, column widths) sits
 * alongside the rows.
 */
function getSingleSheetSchemaFull(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return JSON.stringify({ error: "Sheet not found" });

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    return JSON.stringify({ [sheetName]: "Empty Sheet" }, null, 2);
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const formulas = range.getFormulas();
  const weights = range.getFontWeights();

  const headers = values[0];
  const dataRows = [];

  for (let r = 1; r < values.length; r++) {
    const rowObj = {};
    let hasData = false;
    for (let c = 0; c < headers.length; c++) {
      const rawVal = values[r][c];
      const formula = formulas[r][c];
      const isBold = weights[r][c] === 'bold';
      if (rawVal === "" && !formula && !isBold) continue;

      const key = headers[c] || `Col_${c + 1}`;
      const val = Object.prototype.toString.call(rawVal) === '[object Date]' ? rawVal.toISOString() : rawVal;

      if (!formula && !isBold) {
        rowObj[key] = val; // plain cell - same as the original compact format
      } else {
        const cellObj = {};
        if (formula) cellObj.f = formula; // the real formula - source of truth when present
        else if (val !== "") cellObj.v = val;
        if (isBold) cellObj.b = true;
        rowObj[key] = cellObj;
      }
      hasData = true;
    }
    if (hasData) dataRows.push(rowObj);
  }

  const merges = range.getMergedRanges().map((r) => r.getA1Notation());

  const columnWidths = {};
  for (let c = 1; c <= lastCol; c++) columnWidths[getColumnLetters_(c)] = sheet.getColumnWidth(c);

  const schema = {
    [sheetName]: {
      frozenRows: sheet.getFrozenRows(),
      frozenColumns: sheet.getFrozenColumns(),
      merges: merges,
      columnWidths: columnWidths,
      headerRow: headers,
      rows: dataRows,
    },
  };

  return JSON.stringify(schema, null, 2);
}

function getColumnLetters_(col) {
  let letters = "", n = col;
  while (n > 0) {
    const temp = (n - 1) % 26;
    letters = String.fromCharCode(65 + temp) + letters;
    n = Math.floor((n - temp - 1) / 26);
  }
  return letters;
}

/** Displays the Picker Modal - same UI as before, now calling getSingleSheetSchemaFull. */
function showSchemaPicker() {
  const htmlContent = `
    <html>
      <head>
        <link rel="stylesheet" href="https://ssl.gstatic.com/docs/script/css/add-ons1.css">
        <style>
          body { padding: 20px; font-family: sans-serif; }
          select { width: 100%; padding: 8px; margin-bottom: 15px; }
          pre { background: #f4f4f4; padding: 10px; border: 1px solid #ddd; height: 350px; overflow: auto; font-size: 11px; display: none; white-space: pre-wrap; word-wrap: break-word; }
          .controls { display: flex; gap: 10px; margin-bottom: 10px; }
          #loading { display: none; font-size: 12px; color: #666; margin-top: 5px; }
        </style>
      </head>
      <body>
        <label>Select Sheet to Analyze:</label>
        <select id="sheetSelect"></select>

        <div class="controls">
          <button class="action" id="genBtn" onclick="generate()">Generate JSON</button>
          <button id="copyBtn" style="display:none;" onclick="copyToClipboard()">Copy JSON</button>
        </div>
        <div id="loading">Extracting values, formulas, and formatting... please wait.</div>

        <pre id="output"></pre>

        <script>
          google.script.run.withSuccessHandler(list => {
            const select = document.getElementById('sheetSelect');
            list.forEach(name => {
              const opt = document.createElement('option');
              opt.value = name;
              opt.innerHTML = name;
              select.appendChild(opt);
            });
          }).getSheetList();

          function generate() {
            const name = document.getElementById('sheetSelect').value;
            const btn = document.getElementById('genBtn');
            const loading = document.getElementById('loading');
            const output = document.getElementById('output');
            const copyBtn = document.getElementById('copyBtn');

            btn.disabled = true;
            loading.style.display = 'block';
            output.style.display = 'none';
            copyBtn.style.display = 'none';

            google.script.run.withSuccessHandler(json => {
              output.innerText = json;
              output.style.display = 'block';
              copyBtn.style.display = 'inline-block';
              btn.disabled = false;
              loading.style.display = 'none';
            }).getSingleSheetSchemaFull(name);
          }

          function copyToClipboard() {
            const text = document.getElementById('output').innerText;
            const elem = document.createElement('textarea');
            document.body.appendChild(elem);
            elem.value = text;
            elem.select();
            document.execCommand('copy');
            document.body.removeChild(elem);

            const copyBtn = document.getElementById('copyBtn');
            const originalText = copyBtn.innerText;
            copyBtn.innerText = 'Copied!';
            setTimeout(() => { copyBtn.innerText = originalText; }, 2000);
          }
        </script>
      </body>
    </html>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(500)
    .setHeight(550)
    .setTitle('GSR Full Schema Export');

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, ' ');
}
