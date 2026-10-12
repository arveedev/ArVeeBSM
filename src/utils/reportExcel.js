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
// decimals as printed. Anything with a leading zero ("0415"), letters or hyphens stays text.
export const asCell = (v) => {
  if (typeof v === 'number') return { value: v }
  const s = String(v ?? '')
  const t = s.trim()
  if (NUMBER_LIKE.test(t) && !/^[₱]?\s?-?0\d/.test(t)) {
    const num = Number(t.replace(/[₱,\s]/g, ''))
    if (Number.isFinite(num)) {
      const dec = (t.split('.')[1] || '').length
      return { value: num, numFmt: '#,##0' + (dec ? '.' + '0'.repeat(dec) : '') }
    }
  }
  return { value: s }
}

// The PDF breaks long ids after hyphens ("05- 05- 10-") and stacks dates over two lines; in a spreadsheet they read as one value.
const tidy = (v) => (typeof v === 'string' ? v.replace(/(\d)- (?=\d)/g, '$1-').replace(/^([A-Za-z]{3})\n(\d{1,2})$/, '$1 $2') : v)

const argb = (rgb) => (Array.isArray(rgb) ? 'FF' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('') : null)
const thin = { style: 'thin', color: { argb: 'FF999999' } }
const border = { top: thin, left: thin, bottom: thin, right: thin }
const HEAD_FILL = 'FFD9D9D9'

// Places autoTable-style rows (strings, or { content, colSpan, rowSpan, styles }) starting at `startRow`,
// honouring merged cells. Returns the next free row.
const placeRows = (ws, startRow, rows, kind) => {
  const taken = new Set()
  rows.forEach((row, ri) => {
    const r = startRow + ri
    let c = 1
    for (const cell of row) {
      while (taken.has(`${r}:${c}`)) c++
      const o = cell !== null && typeof cell === 'object' ? cell : { content: cell }
      const cs = o.colSpan || 1, rs = o.rowSpan || 1
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) taken.add(`${r + dr}:${c + dc}`)
      if (cs > 1 || rs > 1) ws.mergeCells(r, c, r + rs - 1, c + cs - 1)
      const t = asCell(tidy(o.content))
      const wc = ws.getCell(r, c)
      wc.value = t.value
      if (t.numFmt) wc.numFmt = t.numFmt
      const st = o.styles || {}
      const bold = kind !== 'body' || /bold/.test(st.fontStyle || '')
      wc.font = { bold, italic: /italic/.test(st.fontStyle || ''), color: argb(st.textColor) ? { argb: argb(st.textColor) } : undefined }
      wc.alignment = {
        horizontal: kind === 'head' ? 'center' : (st.halign || (typeof t.value === 'number' ? 'right' : 'left')),
        vertical: 'middle',
        wrapText: true,
      }
      wc.border = border
      if (kind === 'head') wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
      else if (kind === 'foot') wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }
      else if (argb(st.fillColor)) wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.fillColor) } }
      c += cs
    }
  })
  return startRow + rows.length
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

const autoWidths = (ws, minW = 8, maxW = 44) => {
  const w = []
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.isMerged && cell.master && cell.master !== cell) return
      const span = cell.model?.master ? 0 : 1
      if (!span) return
      const text = cell.value == null ? '' : typeof cell.value === 'object' ? String(cell.value.result ?? '') : String(cell.value)
      const longest = text.split('\n').reduce((m, l) => Math.max(m, l.length), 0)
      const c = Number(cell.col)
      w[c] = Math.max(w[c] || 0, longest)
    })
  })
  w.forEach((len, c) => { if (c) ws.getColumn(c).width = Math.min(maxW, Math.max(minW, (len || 0) + 2)) })
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

/** Builds a workbook from a generator's capture array: one sheet per captured page. */
export const captureToWorkbook = async (capture, { sheetName = 'Report' } = {}) => {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const used = new Set()
  const pages = groupPages(capture)
  pages.forEach((p, idx) => {
    const heading = p.items.find((i) => i.kind === 'h')
    const base = (p.title.sheet || p.title.lines[p.title.lines.length > 2 ? 2 : p.title.lines.length - 1] || sheetName)
    const cereal = heading ? heading.text.replace(/^(TYPE OF CEREAL|CEREAL TYPE):\s*(LOCAL\s+)?/i, '') : ''
    const ws = wb.addWorksheet(safeSheetName(`${base}${cereal ? ' ' + cereal : ''}`, used), { views: [{ state: 'normal' }] })
    const width = Math.max(4, ...p.items.filter((i) => i.kind === 'table').map(tableWidth))
    let r = 1
    const full = (text, opt = {}) => {
      ws.mergeCells(r, 1, r, width)
      const c = ws.getCell(r, 1)
      c.value = text
      c.font = { bold: !!opt.bold, size: opt.size || 11, italic: !!opt.italic, color: opt.muted ? { argb: 'FF666666' } : undefined }
      c.alignment = { horizontal: opt.align || 'center', vertical: 'middle' }
      r++
    }
    p.title.lines.forEach((l, i) => full(l, { bold: i < p.title.lines.length - 1, size: i === 0 ? 13 : 11 }))
    if (p.title.lines.length) r++
    for (const it of p.items) {
      if (it.kind === 'info') { it.lines.forEach((l) => full(l, { align: 'left' })); r++ }
      else if (it.kind === 'h') full(it.text, { bold: true, align: 'left' })
      else if (it.kind === 'table') {
        if (it.head?.length) r = placeRows(ws, r, it.head, 'head')
        if (it.body?.length) r = placeRows(ws, r, it.body, 'body')
        if (it.foot?.length) r = placeRows(ws, r, it.foot, 'foot')
        r++
      } else if (it.kind === 'sign') {
        r++
        for (const b of it.blocks) {
          if (!(b.people || []).some((x) => x && (x.name || x.position)) && !b.always) continue
          full(b.role + ':', { align: 'left', muted: true })
          for (const x of b.people) { if (x && x.name) full(String(x.name).toUpperCase(), { align: 'left', bold: true }); if (x && x.position) full(x.position, { align: 'left', muted: true }) }
          r++
        }
      } else if (it.kind === 'kv') {
        for (const [label, value, bold] of it.rows) {
          const a = ws.getCell(r, 1), b = ws.getCell(r, 2)
          a.value = label; b.value = asCell(value).value; if (asCell(value).numFmt) b.numFmt = asCell(value).numFmt
          a.font = b.font = { bold: !!bold }
          b.alignment = { horizontal: 'right' }
          r++
        }
      }
    }
    autoWidths(ws)
    ws.pageSetup = { orientation: it_landscape(p) ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    void idx
  })
  if (!pages.length) wb.addWorksheet(sheetName)
  return wb
}
const it_landscape = (p) => p.items.some((i) => i.kind === 'table' && tableWidth(i) > 9)

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
  autoWidths(list)
  await download(wb, fileName)
}

/** Saves a finished report either as the PDF or as Excel (built from the captured content). */
export const saveReport = async ({ doc, capture, kind, baseName, sheetName }) => {
  if (kind === 'excel') await exportCaptureToExcel(capture, { fileName: `${baseName}.xlsx`, sheetName })
  else doc.save(`${baseName}.pdf`)
}
