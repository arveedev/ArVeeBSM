// Excel versions of the printed reports (Stock Report, BIN Card, Pile Layout, SDO Abstract,
// CPF Cash Disbursement Record).
//
// Each report's PDF generator records what it prints (see pdfCapture.js); this file turns
// that record into a workbook, so the Excel file always shows the same rows and totals as
// the PDF. The spreadsheet library is imported only when Export is tapped. Read-only: the
// file is built in memory and downloaded; nothing in the app's data is touched.

const NUMBER_LIKE = /^[₱]?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+$|^[₱]?\s?-?\d{1,3}(?:,\d{3})+$/

const loadExcel = async () => {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

const download = async (wb, fileName) => {
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// "62,000.00" and "1,240" become real numbers (so Excel can add them up) with the same number of
// decimals as printed. Anything with a leading zero ("0415"), letters or hyphens stays text -
// unless `numericColumn` says the whole column holds quantities, where bare integers and the
// "-" placeholder for nothing are numbers too (shown as "-" again by the number format).
const fmtFor = (dec, dash = false) => {
  const f = '#,##0' + (dec ? '.' + '0'.repeat(dec) : '')
  return dash ? `${f};-${f};"-"` : f
}

export const asCell = (v, numericColumn = false, colDec = 0) => {
  if (typeof v === 'number') return { value: v }
  const s = String(v ?? '')
  const t = s.trim()
  if (NUMBER_LIKE.test(t) && !/^[₱]?\s?-?0\d/.test(t)) {
    const num = Number(t.replace(/[₱,\s]/g, ''))
    if (Number.isFinite(num)) {
      const dec = (t.split('.')[1] || '').length
      return { value: num, numFmt: fmtFor(dec) }
    }
  }
  if (numericColumn) {
    if (/^-?(0|[1-9]\d*)$/.test(t)) return { value: Number(t), numFmt: fmtFor(colDec) }
    if (t === '-') return { value: 0, numFmt: fmtFor(colDec, true) }
  }
  return { value: s }
}

// The PDF breaks long ids after hyphens ("05- 05- 10-") and stacks dates over two lines; in a spreadsheet they read as one value.
const tidy = (v) => (typeof v === 'string' ? v.replace(/(\d)- (?=\d)/g, '$1-').replace(/^([A-Za-z]{3})\n(\d{1,2})$/, '$1 $2') : v)

const argb = (rgb) => (Array.isArray(rgb) ? 'FF' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('') : null)
const thin = { style: 'thin', color: { argb: 'FF808080' } }
const border = { top: thin, left: thin, bottom: thin, right: thin }
const HEAD_FILL = 'FFD9D9D9'
const FONT = 'Arial'
const NUMERIC_HEAD = /bags|kls|kilos|kg\b|qty|quantit|amount|balance|total|debit|credit|receipt|issue|price|cost|₱|peso|sacks|withdraw|deposit/i
const colName = (c) => { let n = '', k = c; while (k > 0) { n = String.fromCharCode(65 + ((k - 1) % 26)) + n; k = Math.floor((k - 1) / 26) } return n }
const textOf = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))

// Lays autoTable-style rows (strings, or { content, colSpan, rowSpan, styles }) onto grid
// coordinates, honouring merged cells.
const layoutRows = (rows, startRow) => {
  const taken = new Set()
  const out = []
  rows.forEach((row, ri) => {
    const r = startRow + ri
    let c = 1
    for (const cell of row) {
      while (taken.has(`${r}:${c}`)) c++
      const o = cell !== null && typeof cell === 'object' ? cell : { content: cell }
      const cs = o.colSpan || 1, rs = o.rowSpan || 1
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) taken.add(`${r + dr}:${c + dc}`)
      out.push({ r, c, cs, rs, o })
      c += cs
    }
  })
  return out
}

// Places one captured table (head, body, foot). Totals that really are the sum of the rows above
// become =SUM() formulas, and Ending = Beginning + Receipts - Issues becomes a formula per row, so
// editing a figure in Excel carries through. A formula is only written where it reproduces the
// printed figure; anything else stays as the plain number.
const placeTable = (ws, startRow, t, wmap) => {
  const head = layoutRows(t.head || [], startRow)
  const bodyStart = startRow + (t.head || []).length
  const body = layoutRows(t.body || [], bodyStart)
  const footStart = bodyStart + (t.body || []).length
  const foot = layoutRows(t.foot || [], footStart)

  // which columns hold quantities, and how many decimals they print with
  const headText = {}
  head.forEach((x) => { for (let k = 0; k < x.cs; k++) headText[x.c + k] = (headText[x.c + k] || '') + ' ' + textOf(tidy(x.o.content)) })
  const numCols = new Set(), dec = {}
  const scan = (list) => list.forEach((x) => {
    if (x.cs > 1) return
    const t0 = textOf(tidy(x.o.content)).trim()
    if (NUMBER_LIKE.test(t0) && !/^[₱]?\s?-?0\d/.test(t0)) { numCols.add(x.c); dec[x.c] = Math.max(dec[x.c] || 0, (t0.split('.')[1] || '').length) }
  })
  scan(body); scan(foot)
  Object.keys(headText).forEach((c) => { if (NUMERIC_HEAD.test(headText[c])) numCols.add(Number(c)) })

  const put = (list, kind) => list.forEach(({ r, c, cs, rs, o }) => {
    if (cs > 1 || rs > 1) ws.mergeCells(r, c, r + rs - 1, c + cs - 1)
    const raw = tidy(o.content)
    const t0 = asCell(raw, kind !== 'head' && cs === 1 && numCols.has(c), dec[c] || 0)
    const wc = ws.getCell(r, c)
    wc.value = t0.value
    if (t0.numFmt) wc.numFmt = t0.numFmt
    const st = o.styles || {}
    const bold = kind !== 'body' || /bold/.test(st.fontStyle || '')
    wc.font = { name: FONT, size: 10, bold, italic: /italic/.test(st.fontStyle || ''), color: argb(st.textColor) ? { argb: argb(st.textColor) } : undefined }
    wc.alignment = {
      horizontal: kind === 'head' ? 'center' : (st.halign || (typeof t0.value === 'number' ? 'right' : 'left')),
      vertical: 'middle',
      wrapText: true,
    }
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) ws.getCell(r + dr, c + dc).border = border
    if (kind === 'head') wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
    else if (kind === 'foot') wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
    else if (argb(st.fillColor)) wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.fillColor) } }
    if (cs === 1) {
      const text = typeof t0.value === 'number' ? t0.value.toLocaleString('en-US', { minimumFractionDigits: dec[c] || 0, maximumFractionDigits: Math.max(dec[c] || 0, 3) }) : textOf(t0.value)
      const longest = kind === 'head'
        ? text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0) * 1.15
        : text.split('\n').reduce((m, l) => Math.max(m, l.length), 0)
      wmap[c] = Math.max(wmap[c] || 0, longest + (typeof t0.value === 'number' ? 2 : 1))
    }
  })
  put(head, 'head'); put(body, 'body'); put(foot, 'foot')

  const cellNum = (r, c) => { const v = ws.getCell(r, c).value; return typeof v === 'number' ? v : (v && typeof v === 'object' && typeof v.result === 'number' ? v.result : null) }
  const bodyRows = [...new Set(body.map((x) => x.r))]

  // Ending = Beginning + Receipts - Issues, per row
  const grp = (re) => head.find((x) => re.test(textOf(x.o.content)))
  const gb = grp(/^\s*BEGINNING/i), gr = grp(/^\s*RECEIPTS/i), gi = grp(/^\s*ISSUES/i), ge = grp(/^\s*ENDING/i)
  if (gb && gr && gi && ge && [gr.cs, gi.cs, ge.cs].every((n) => n === gb.cs)) {
    for (const r of bodyRows) for (let k = 0; k < gb.cs; k++) {
      const [b, rc, is, en] = [gb.c + k, gr.c + k, gi.c + k, ge.c + k].map((c) => cellNum(r, c))
      if ([b, rc, is, en].some((v) => v == null)) continue
      if (Math.abs(b + rc - is - en) > 0.05) continue
      const ref = (c) => colName(c) + r
      ws.getCell(r, ge.c + k).value = { formula: `${ref(gb.c + k)}+${ref(gr.c + k)}-${ref(gi.c + k)}`, result: en }
    }
  }
  // totals row = sum of the rows above it
  if (bodyRows.length) {
    const first = bodyRows[0], last = bodyRows[bodyRows.length - 1]
    foot.forEach(({ r, c, cs }) => {
      if (cs > 1) return
      const total = cellNum(r, c)
      if (total == null || !numCols.has(c)) return
      let sum = 0, any = false
      for (const br of bodyRows) { const v = cellNum(br, c); if (v != null) { sum += v; any = true } }
      if (any && Math.abs(sum - total) <= 0.05) ws.getCell(r, c).value = { formula: `SUM(${colName(c)}${first}:${colName(c)}${last})`, result: total }
    })
  }
  return footStart + (t.foot || []).length
}

const tableWidth = (t) => {
  const widest = (rows) => rows.reduce((m, row) => Math.max(m, row.reduce((a, c) => a + ((c && c.colSpan) || 1), 0)), 0)
  return Math.max(widest(t.head || []), widest(t.body || []), widest(t.foot || []), 1)
}

const safeSheetName = (s, used) => {
  let n = String(s || 'Report').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Report'
  let k = 2
  const base = n
  while (used.has(n.toLowerCase())) { n = `${base.slice(0, 28)} ${k++}` }
  used.add(n.toLowerCase())
  return n
}

// A sheet is one "page" of the captured report: its title lines, details, headings, tables and signatories.
const groupPages = (capture) => {
  const pages = []
  let cur = null
  for (const rec of capture) {
    if (rec.kind === 'page' || !cur) { cur = { title: rec.kind === 'page' ? rec : { lines: [] }, items: [] }; pages.push(cur); if (rec.kind === 'page') continue }
    cur.items.push(rec)
  }
  return pages
}

const LABEL_LINE = /^([A-Z][A-Z .\/&]{1,28}):\s*(.*)$/

// Signatories laid out as on the printed page: three across (Certified / Verified / Audited), then
// Noted By centred underneath; every name sits on its signature line with the position below it.
const placeSignatures = (ws, startRow, blocks, width) => {
  let r = startRow + 1
  const live = (blocks || []).filter((b) => (b.people || []).some((x) => x && (x.name || x.position)) || b.always)
  if (width < 3) {
    const one = (text, o = {}) => { const c = ws.getCell(r, 1); c.value = text; c.font = { name: FONT, size: 10, ...o }; r++ }
    for (const b of live) {
      one(b.role + ':', { color: { argb: 'FF666666' } })
      for (const x of b.people) { if (x?.name) one(String(x.name).toUpperCase(), { bold: true }); if (x?.position) one(x.position, { color: { argb: 'FF666666' } }) }
      r++
    }
    return r
  }
  const band = Math.floor(width / 3)
  const span = (k) => [1 + k * band, k === 2 ? width : (k + 1) * band]
  for (let i = 0; i < live.length; i += 3) {
    const group = live.slice(i, i + 3)
    const slots = group.length === 1 ? [1] : group.map((_, k) => k)
    const merged = (row, k, text, o = {}) => {
      const [c1, c2] = span(k)
      if (c2 > c1) ws.mergeCells(row, c1, row, c2)
      const cell = ws.getCell(row, c1)
      cell.value = text
      cell.font = { name: FONT, size: 10, ...o.font }
      cell.alignment = { horizontal: o.align || 'center', vertical: 'middle', wrapText: true }
      if (o.line) for (let c = c1; c <= c2; c++) ws.getCell(row, c).border = { top: { style: 'thin', color: { argb: 'FF000000' } } }
    }
    group.forEach((b, gi) => merged(r, slots[gi], b.role + ':', { align: 'left', font: { color: { argb: 'FF666666' } } }))
    ws.getRow(r).height = 16; r++
    ws.getRow(r).height = 26; r++
    const most = Math.max(...group.map((b) => Math.max(b.people.length, 1)))
    for (let pi = 0; pi < most; pi++) {
      group.forEach((b, gi) => { const x = b.people[pi]; if (x && (x.name || b.always)) merged(r, slots[gi], x.name ? String(x.name).toUpperCase() : '', { line: true, font: { bold: true } }) })
      r++
      group.forEach((b, gi) => { const x = b.people[pi]; if (x?.position) merged(r, slots[gi], x.position, { font: { size: 9, color: { argb: 'FF444444' } } }) })
      r++
      if (pi < most - 1) { ws.getRow(r).height = 14; r++ }
    }
    r++
  }
  return r
}

/** Builds a workbook from a generator's capture array: one sheet per captured page. */
export const captureToWorkbook = async (capture, { sheetName = 'Report' } = {}) => {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.calcProperties = { fullCalcOnLoad: true }
  const used = new Set()
  const pages = groupPages(capture)
  pages.forEach((p) => {
    const heading = p.items.find((i) => i.kind === 'h')
    const base = (p.title.sheet || p.title.lines[p.title.lines.length > 2 ? 2 : p.title.lines.length - 1] || sheetName)
    const cereal = heading ? heading.text.replace(/^(TYPE OF CEREAL|CEREAL TYPE):\s*(LOCAL\s+)?/i, '') : ''
    const ws = wb.addWorksheet(safeSheetName(`${base}${cereal ? ' ' + cereal : ''}`, used), { views: [{ state: 'normal', showGridLines: false }] })
    const width = Math.max(4, ...p.items.filter((i) => i.kind === 'table').map(tableWidth))
    const wmap = {}
    let r = 1
    const full = (text, opt = {}) => {
      ws.mergeCells(r, 1, r, width)
      const c = ws.getCell(r, 1)
      c.value = text
      c.font = { name: FONT, bold: !!opt.bold, size: opt.size || 10, italic: !!opt.italic, color: opt.muted ? { argb: 'FF666666' } : undefined }
      c.alignment = { horizontal: opt.align || 'center', vertical: 'middle' }
      r++
    }
    const lines = p.title.lines
    lines.forEach((l, i) => {
      const bold = lines.length >= 5 ? (i < 2 || (i >= 3 && i < lines.length - 1)) : i < lines.length - 1
      full(l, { bold, size: i === 0 ? 13 : 10.5 })
    })
    if (lines.length) r++
    for (const it of p.items) {
      if (it.kind === 'info') {
        it.lines.forEach((l) => {
          const m = LABEL_LINE.exec(l)
          if (m) {
            const a = ws.getCell(r, 1), b = ws.getCell(r, 2)
            a.value = m[1] + ':'; a.font = { name: FONT, size: 10 }; a.alignment = { horizontal: 'left', vertical: 'middle' }
            b.value = m[2]; b.font = { name: FONT, size: 10, bold: true }; b.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false }
            r++
          } else full(l, { align: 'left' })
        })
        r++
      } else if (it.kind === 'h') full(it.text, { bold: true, align: 'left' })
      else if (it.kind === 'table') { r = placeTable(ws, r, it, wmap); r++ }
      else if (it.kind === 'sign') r = placeSignatures(ws, r, it.blocks, width)
      else if (it.kind === 'kv') {
        for (const [label, value, bold] of it.rows) {
          const a = ws.getCell(r, 1), b = ws.getCell(r, 2), v = asCell(value)
          a.value = label; b.value = v.value; if (v.numFmt) b.numFmt = v.numFmt
          a.font = b.font = { name: FONT, size: 10, bold: !!bold }
          b.alignment = { horizontal: 'right' }
          wmap[1] = Math.max(wmap[1] || 0, String(label).length + 2)
          wmap[2] = Math.max(wmap[2] || 0, String(value).length + 3)
          r++
        }
      }
    }
    for (let c = 1; c <= width; c++) ws.getColumn(c).width = Math.min(46, Math.max(9, Math.ceil(wmap[c] || 0) + 1))
    ws.pageSetup = {
      paperSize: 9, orientation: p.items.some((i) => i.kind === 'table' && tableWidth(i) > 9) ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    }
  })
  if (!pages.length) wb.addWorksheet(sheetName)
  return wb
}

export const exportCaptureToExcel = async (capture, { fileName, sheetName }) => {
  const wb = await captureToWorkbook(capture, { sheetName })
  await download(wb, fileName)
}

/** Pile Layout: the floor plan as a grid of merged cells (one per pile box), plus a plain list of every pile. */
export const exportPileLayoutToExcel = async ({ warehouse, branch, periodFrom, periodTo, gridCols, gridRows, boxes, fmtBags, fmtKilos, fileName }) => {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Layout')
  const cols = Math.max(gridCols || 1, 1), rows = Math.max(gridRows || 1, 1)
  const lines = ['NATIONAL FOOD AUTHORITY', branch?.name, warehouse?.name, 'PILE LAYOUT', `As of ${periodFrom} - ${periodTo}`].filter(Boolean)
  lines.forEach((l, i) => {
    ws.mergeCells(i + 1, 1, i + 1, Math.max(cols, 4))
    const c = ws.getCell(i + 1, 1)
    c.value = l
    c.font = { bold: i < 4, size: i === 0 ? 13 : 11 }
    c.alignment = { horizontal: 'center' }
  })
  const top = lines.length + 2
  for (let c = 1; c <= cols; c++) ws.getColumn(c).width = 18
  for (let r = 0; r < rows; r++) ws.getRow(top + r).height = 46
  const text = (box) => {
    if (!box.pile) return `${box.label ?? ''}\nVACANT`.trim()
    const p = box.pile
    const rowsOf = box.groupRows ?? []
    const parts = [p.pileName]
    if (box.variety?.name) parts.push(`Var: ${box.variety.name}`)
    if (rowsOf.length > 1) rowsOf.forEach((g) => parts.push(`${g.varietyName ?? g.sackLabelText ?? 'Stock'}: ${fmtBags(g.bags)} bags / ${fmtKilos(g.kilos)} kg`))
    else parts.push(`${fmtBags(p.currentBags)} bags / ${fmtKilos(p.currentKilos)} kg`)
    if (p.formattedAge) parts.push(`Age: ${p.formattedAge}`)
    return parts.join('\n')
  }
  for (const box of boxes) {
    const r1 = top + box.rowStart - 1, c1 = box.colStart, r2 = r1 + box.rowSpan - 1, c2 = c1 + box.colSpan - 1
    if (r2 > r1 || c2 > c1) ws.mergeCells(r1, c1, r2, c2)
    const cell = ws.getCell(r1, c1)
    cell.value = text(box)
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    cell.font = { size: 9, color: { argb: box.pile ? 'FF000000' : 'FF888888' } }
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } }
    if (box.pile) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F4EA' } }
  }
  const list = wb.addWorksheet('Piles')
  const head = ['Pile', 'Cereal', 'Variety', 'Bags', 'Net kg', 'Age', 'Row', 'Column']
  list.addRow(head).font = { bold: true }
  for (const b of boxes.filter((x) => x.pile)) {
    list.addRow([b.pile.pileName, b.pile.cerealType ?? '', b.variety?.name ?? '', b.pile.currentBags ?? '', b.pile.currentKilos ?? '', b.pile.formattedAge ?? '', b.rowStart, b.colStart])
  }
  list.getColumn(4).numFmt = '#,##0'; list.getColumn(5).numFmt = '#,##0.000'
  ;[18, 12, 18, 10, 14, 14, 8, 8].forEach((w, i) => { list.getColumn(i + 1).width = w })
  await download(wb, fileName)
}

/** Saves a finished report either as the PDF or as Excel (built from the captured content). */
export const saveReport = async ({ doc, capture, kind, baseName, sheetName }) => {
  if (kind === 'excel') await exportCaptureToExcel(capture, { fileName: `${baseName}.xlsx`, sheetName })
  else doc.save(`${baseName}.pdf`)
}
