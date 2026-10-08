// Excel export for the inventory report table models (see inventoryReport.js).
// The library is imported only when Export is tapped, so it adds nothing to
// normal use. Read-only: builds a file in memory and downloads it.

const FILL = {
  head: 'FFD9EAD3', section: 'FFEFEFEF', sub: 'FFF3F3F3', total: 'FFE6E6E6', beg: 'FFFFF2CC',
}

export const exportModelToExcel = async (model, { fileName, sheetName = 'Report' }) => {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', xSplit: 1, ySplit: 5 }] })
  const width = model.head[0].reduce((s, c) => s + c.span, 0)

  // Title block (rows 1-2), then the three header rows (3-5).
  ws.mergeCells(1, 1, 1, Math.max(width, 2))
  ws.getCell(1, 1).value = model.title
  ws.getCell(1, 1).font = { bold: true, size: 13 }
  ws.getCell(1, 1).alignment = { horizontal: 'center' }
  ws.mergeCells(2, 1, 2, Math.max(width, 2))
  ws.getCell(2, 1).value = model.subtitle
  ws.getCell(2, 1).alignment = { horizontal: 'center' }

  model.head.forEach((row, i) => {
    let c = 1
    for (const h of row) {
      const r = 3 + i
      if (h.span > 1) ws.mergeCells(r, c, r, c + h.span - 1)
      const cell = ws.getCell(r, c)
      cell.value = h.t
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      for (let k = c; k < c + h.span; k++) {
        ws.getCell(r, k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.head } }
        ws.getCell(r, k).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
      }
      c += h.span
    }
  })

  let r = 6
  for (const row of model.rows) {
    const first = ws.getCell(r, 1)
    first.value = row.first
    const bold = ['section', 'sub', 'total', 'end', 'beg', 'add-label', 'less-label'].includes(row.kind)
    if (bold) first.font = { bold: true }
    if (row.kind === 'add-label') first.font = { bold: true, color: { argb: 'FF1F5FBF' } }
    if (row.kind === 'less-label') first.font = { bold: true, color: { argb: 'FFB3261E' } }
    const fill = row.kind === 'section' ? FILL.section : row.kind === 'sub' ? FILL.sub : row.kind === 'total' ? FILL.total : row.kind === 'beg' ? FILL.beg : null
    row.cells.forEach((v, i) => {
      const cell = ws.getCell(r, 2 + i)
      if (v == null) { if (row.dash) cell.value = '-'; cell.alignment = { horizontal: 'right' } } else cell.value = v
      cell.numFmt = '#,##0.00'
      if (bold) cell.font = { bold: true }
      if (row.kind === 'add') cell.font = { color: { argb: 'FF1F5FBF' } }
      if (row.kind === 'less') cell.font = { color: { argb: 'FFB3261E' } }
    })
    if (fill) for (let k = 1; k <= width; k++) ws.getCell(r, k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    if (row.kind === 'end' || row.kind === 'total') {
      for (let k = 1; k <= width; k++) ws.getCell(r, k).border = { top: { style: 'thin' }, bottom: { style: 'thin' } }
    }
    r += 1
  }

  ws.getColumn(1).width = 46
  for (let k = 2; k <= width; k++) ws.getColumn(k).width = 13

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
