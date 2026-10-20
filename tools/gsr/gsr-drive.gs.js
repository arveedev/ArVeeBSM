/**
 * BSM GSR -> Google Drive receiver (Apps Script web app). A SEPARATE script from the backup receiver, so a GSR
 * problem can never touch the backups.
 *
 * What it does: creates Google Sheets (the GSR and its audit file) inside one designated Drive folder, reads them
 * back so the app can verify every value, sets a few cells and renames a file. It never deletes anything and never
 * reads or writes outside the designated folder.
 *
 * Setup (once, by the owner) - see docs/gsr-drive-setup.md:
 *   1. Create a Drive folder (for the first test a scratch folder named GSR-TEST; later the real one named NEWGSR).
 *   2. script.google.com > New project > paste this file as Code.gs.
 *   3. Project Settings (gear icon) > Script properties > Add:
 *        GSR_TOKEN          = a long random text (also saved in Vercel as GSR_SCRIPT_TOKEN)
 *        GSR_ROOT_FOLDER_ID = the id of the Drive folder from step 1 (the last part of its web address)
 *   4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *      Copy the web app URL that ends in /exec (saved in Vercel as GSR_SCRIPT_URL).
 *   5. Open that URL in a browser: it shows {"ok":true,"service":"bsm-gsr-drive",...}.
 *
 * The token is the only protection of the web address, so keep it as long and random as a password.
 */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function props_() {
  return PropertiesService.getScriptProperties()
}

function root_() {
  var id = props_().getProperty('GSR_ROOT_FOLDER_ID')
  if (!id) throw new Error('GSR_ROOT_FOLDER_ID is not set')
  return DriveApp.getFolderById(id)
}

function doGet() {
  var name = ''
  try { name = root_().getName() } catch (e) { name = '(folder not set: ' + e.message + ')' }
  return json_({ ok: true, service: 'bsm-gsr-drive', folder: name })
}

function subfolder_(parent, name) {
  var it = parent.getFoldersByName(name)
  return it.hasNext() ? it.next() : parent.createFolder(name)
}

function uniqueName_(folder, name) {
  var n = name
  var i = 2
  while (folder.getFilesByName(n).hasNext()) { n = name + ' (' + i + ')'; i += 1 }
  return n
}

function inRoot_(fileId) {
  // the file must live (at any depth) inside the designated folder
  var root = root_()
  var file = DriveApp.getFileById(fileId)
  var parents = file.getParents()
  while (parents.hasNext()) {
    var p = parents.next()
    while (true) {
      if (p.getId() === root.getId()) return true
      var up = p.getParents()
      if (!up.hasNext()) break
      p = up.next()
    }
  }
  return false
}

function writeSheet_(ss, sheetPayload, first) {
  var sh = first ? ss.getSheets()[0] : ss.insertSheet()
  sh.setName(sheetPayload.name)
  var rows = sheetPayload.rows
  var R = rows.length
  var C = R ? rows[0].length : 0
  if (R && C) {
    if (sh.getMaxRows() < R) sh.insertRowsAfter(sh.getMaxRows(), R - sh.getMaxRows())
    if (sh.getMaxColumns() < C) sh.insertColumnsAfter(sh.getMaxColumns(), C - sh.getMaxColumns())
    sh.getRange(1, 1, R, C).setValues(rows)
  }
  var f = sheetPayload.formats || []
  for (var i = 0; i < f.length; i++) sh.getRange(f[i][0] + 1, f[i][1] + 1, f[i][2] - f[i][0] + 1, f[i][3] - f[i][1] + 1).setNumberFormat(f[i][4])
  var b = sheetPayload.bold || []
  for (i = 0; i < b.length; i++) sh.getRange(b[i][0] + 1, b[i][1] + 1, b[i][2] - b[i][0] + 1, b[i][3] - b[i][1] + 1).setFontWeight('bold')
  var fl = sheetPayload.fills || []
  for (i = 0; i < fl.length; i++) sh.getRange(fl[i][0] + 1, fl[i][1] + 1, fl[i][2] - fl[i][0] + 1, fl[i][3] - fl[i][1] + 1).setBackground(fl[i][4])
  var al = sheetPayload.align || []
  for (i = 0; i < al.length; i++) sh.getRange(al[i][0] + 1, al[i][1] + 1, al[i][2] - al[i][0] + 1, al[i][3] - al[i][1] + 1).setHorizontalAlignment(al[i][4])
  var m = sheetPayload.merges || []
  for (i = 0; i < m.length; i++) sh.getRange(m[i][0] + 1, m[i][1] + 1, m[i][2] - m[i][0] + 1, m[i][3] - m[i][1] + 1).merge()
  var w = sheetPayload.colWidths || {}
  Object.keys(w).forEach(function (k) { sh.setColumnWidth(Number(k) + 1, w[k]) })
  return sh
}

function create_(body) {
  var folder = root_()
  var path = body.path || []
  for (var i = 0; i < path.length; i++) folder = subfolder_(folder, String(path[i]))
  var out = []
  var files = body.files || []
  for (var f = 0; f < files.length; f++) {
    var spec = files[f]
    var name = uniqueName_(folder, String(spec.name))
    var ss = SpreadsheetApp.create(name)
    for (var s = 0; s < spec.sheets.length; s++) writeSheet_(ss, spec.sheets[s], s === 0)
    SpreadsheetApp.flush()
    var file = DriveApp.getFileById(ss.getId())
    file.moveTo(folder)
    out.push({ name: name, id: ss.getId(), url: ss.getUrl() })
  }
  return { ok: true, files: out, folder: folder.getName() }
}

function read_(body) {
  if (!inRoot_(body.fileId)) throw new Error('file is outside the designated folder')
  var ss = SpreadsheetApp.openById(body.fileId)
  var sheets = ss.getSheets()
  var out = []
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i]
    var r = sh.getLastRow()
    var c = sh.getLastColumn()
    out.push({ name: sh.getName(), values: r && c ? sh.getRange(1, 1, r, c).getValues() : [] })
  }
  return { ok: true, name: ss.getName(), sheets: out }
}

function setCells_(body) {
  if (!inRoot_(body.fileId)) throw new Error('file is outside the designated folder')
  var sh = SpreadsheetApp.openById(body.fileId).getSheetByName(body.sheet)
  if (!sh) throw new Error('no such sheet')
  var cells = body.cells || []
  for (var i = 0; i < cells.length; i++) sh.getRange(cells[i].ref).setValue(cells[i].value)
  SpreadsheetApp.flush()
  return { ok: true }
}

function rename_(body) {
  if (!inRoot_(body.fileId)) throw new Error('file is outside the designated folder')
  DriveApp.getFileById(body.fileId).setName(String(body.name))
  return { ok: true }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents)
    if (!body || body.token !== props_().getProperty('GSR_TOKEN')) return json_({ ok: false, error: 'bad token' })
    switch (body.action) {
      case 'ping': return json_({ ok: true, folder: root_().getName() })
      case 'create': return json_(create_(body))
      case 'read': return json_(read_(body))
      case 'setCells': return json_(setCells_(body))
      case 'rename': return json_(rename_(body))
      default: return json_({ ok: false, error: 'unknown action' })
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) })
  }
}
