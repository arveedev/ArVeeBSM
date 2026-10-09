/**
 * BSM Inventory Reports -> Google Sheet export  (Apps Script, container-bound)
 *
 * Paste this into a NEW spreadsheet's Apps Script (Extensions > Apps Script),
 * NOT into any existing BSM sheet. See docs/inventory-sheet-export-setup.md.
 *
 * It only ever writes to the spreadsheet it is attached to, and only to tabs
 * whose names are on the allowed list below, so a bad request cannot touch
 * any other tab. The BSM App sends finished numbers; this script has no
 * business rules of its own.
 *
 * Script Property (optional): EXPORT_TOKEN - if set, requests must carry it.
 */

var ALLOWED_TAB = /^(SUMMARY|WAREHOUSE_AGE_MT|AGE_MONITORING|PROCUREMENT|DATA_CHECK|\d{4}-\d{2})$/;

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('EXPORT_TOKEN') || '';
    if (token && req.token !== token) return json_({ status: 'ERROR', message: 'Bad token' });

    if (req.action === 'ping') {
      var ss = SpreadsheetApp.getActive();
      return json_({ status: 'SUCCESS', spreadsheetUrl: ss.getUrl(), name: ss.getName() });
    }
    if (req.action === 'writeInventoryReport') return json_(writeReport_(req));
    return json_({ status: 'ERROR', message: 'Unknown action' });
  } catch (err) {
    return json_({ status: 'ERROR', message: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function writeReport_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActive();
    var written = [];
    (req.sheets || []).forEach(function (s) {
      if (!ALLOWED_TAB.test(String(s.name))) throw new Error('Tab name not allowed: ' + s.name);
      var sh = ss.getSheetByName(s.name) || ss.insertSheet(s.name);
      var rows = s.values.length;
      var width = s.width;

      // wipe the tab (values, formats, merges) before rewriting it
      sh.getRange(1, 1, Math.max(sh.getMaxRows(), rows), Math.max(sh.getMaxColumns(), width)).breakApart().clear();
      if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());

      sh.getRange(1, 1, rows, width).setValues(s.values);
      sh.getRange(3, 1).setValue('Updated from the BSM App on ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a'));
      s.merges.forEach(function (m) { sh.getRange(m[0], m[1], m[2] - m[0] + 1, m[3] - m[1] + 1).merge(); });

      // title
      sh.getRange(1, 1).setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
      sh.getRange(2, 1).setHorizontalAlignment('center');
      sh.getRange(3, 1).setFontColor('#777777').setFontSize(9);

      // header rows
      var head = sh.getRange(s.headStart, 1, s.headRows, width);
      head.setFontWeight('bold').setBackground('#d9ead3').setHorizontalAlignment('center').setVerticalAlignment('middle')
        .setBorder(true, true, true, true, true, true);
      sh.getRange(s.headStart, 1, s.headRows, 1).setHorizontalAlignment('left');

      // body: numbers, bold rows, borders
      if (s.kinds.length) {
        var body = sh.getRange(s.bodyStart, 2, s.kinds.length, Math.max(width - 1, 1));
        body.setNumberFormat('#,##0.00').setHorizontalAlignment('right');
        sh.getRange(s.bodyStart, 1, s.kinds.length, width).setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
        var bold = { day: 1, section: 1, sub: 1, total: 1, end: 1, beg: 1, week: 1, 'add-label': 1, 'less-label': 1 };
        var fill = { day: '#b6d7a8', sub: '#f3f3f3', total: '#e6e6e6', section: '#efefef', beg: '#fff2cc', week: '#f3f3f3' };
        s.kinds.forEach(function (k, i) {
          var r = sh.getRange(s.bodyStart + i, 1, 1, width);
          if (bold[k]) r.setFontWeight('bold');
          if (fill[k]) r.setBackground(fill[k]);
          if (k === 'add-label' || k === 'add') r.setFontColor('#1f5fbf');
          if (k === 'less-label' || k === 'less') r.setFontColor('#b3261e');
        });
      }

      // cell notes: the documents behind an ADD / LESS value
      (s.notes || []).forEach(function (n) { sh.getRange(n.r, n.c).setNote(n.t); });

      sh.setFrozenRows(s.headStart + s.headRows - 1);
      sh.setFrozenColumns(1);
      sh.setColumnWidth(1, 300);
      if (width > 1) sh.setColumnWidths(2, width - 1, 95);
      written.push(s.name);
    });
    SpreadsheetApp.flush();
    return { status: 'SUCCESS', written: written, spreadsheetUrl: ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}
