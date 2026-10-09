// Excel and PDF files for the milling liquidations. Both are built from the
// same section layout the screen shows (see millingLiquidation.js), loaded only
// when an export button is tapped. Read-only: files are built in memory and
// downloaded; nothing is saved to the database.

import { signatoryBlocks, summaryLineText } from './millingLiquidation.js'

const { fmt2, fmt3, fmtInt } = summaryLineText

const download = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------- Excel
export const exportLiquidationExcel = async (sections, { fileName, config }) => {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const thin = { style: 'thin' }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const used = new Set()

  for (const sec of sections) {
    let name = sec.miller.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Liquidation'
    while (used.has(name)) name = `${name.slice(0, 26)}_${used.size}`
    used.add(name)
    const ws = wb.addWorksheet(name)
    const width = sec.colCount
    let r = 1
    const line = (text, o = {}) => {
      ws.mergeCells(r, 1, r, width)
      const c = ws.getCell(r, 1)
      c.value = text
      c.alignment = { horizontal: 'center' }
      c.font = { bold: !!o.bold, underline: !!o.underline, size: o.size ?? 11 }
      r += 1
    }
    for (const h of sec.heading) line(h, { bold: h === 'NATIONAL FOOD AUTHORITY' })
    if (sec.heading.length) r += 1
    line(sec.title, { bold: true, underline: sec.kind === 'TMO', size: 13 })
    if (sec.subtitle) line(sec.subtitle)
    r += 1

    // grid writer that honours rowSpan / colSpan
    const occupied = new Set()
    const writeRows = (rows, style) => {
      for (const row of rows) {
        let col = 1
        for (const cell of row) {
          while (occupied.has(`${r}:${col}`)) col += 1
          const cs = cell.cs ?? 1
          const rs = cell.rs ?? 1
          if (cs > 1 || rs > 1) ws.mergeCells(r, col, r + rs - 1, col + cs - 1)
          for (let y = 0; y < rs; y++) for (let x = 0; x < cs; x++) { occupied.add(`${r + y}:${col + x}`); ws.getCell(r + y, col + x).border = box }
          const c = ws.getCell(r, col)
          c.value = cell.t
          c.alignment = { horizontal: cell.a === 'r' ? 'right' : cell.a === 'c' ? 'center' : 'left', vertical: 'middle', wrapText: true }
          c.font = { bold: !!cell.b || style === 'head' }
          if (style === 'head') c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }
          col += cs
        }
        r += 1
      }
    }
    writeRows(sec.head, 'head')
    writeRows(sec.rows.map((x) => x.cells), 'body')
    writeRows([sec.totalCells], 'body')
    for (let c = 1; c <= width; c++) ws.getColumn(c).width = c <= 3 ? 14 : 12
    r += 1

    // SUMMARY
    ws.getCell(r, 1).value = 'SUMMARY:'
    ws.getCell(r, 1).font = { bold: true }
    r += 1
    const t = (row, labels) => {
      labels.forEach((v, i) => { const c = ws.getCell(row, 1 + i * 2); c.value = v })
    }
    if (sec.summary.palay.length) {
      ws.getCell(r, 1).value = 'Palay issued - milling fee'
      ws.getCell(r, 3).value = 'BAGS'
      ws.getCell(r, 5).value = 'MILLING FEE'
      ws.getCell(r, 7).value = 'AMOUNT'
      for (const c of [1, 3, 5, 7]) ws.getCell(r, c).font = { bold: true }
      r += 1
      for (const l of sec.summary.palay) {
        ws.getCell(r, 1).value = l.product
        ws.getCell(r, 3).value = l.bags
        ws.getCell(r, 5).value = l.price
        ws.getCell(r, 7).value = l.amount
        ws.getCell(r, 3).numFmt = '#,##0.00'
        ws.getCell(r, 5).numFmt = '#,##0.00'
        ws.getCell(r, 7).numFmt = '#,##0.000'
        r += 1
      }
      ws.getCell(r, 1).value = 'TOTAL MILLING FEE'
      ws.getCell(r, 1).font = { bold: true }
      ws.getCell(r, 7).value = sec.summary.palayTotal
      ws.getCell(r, 7).numFmt = '#,##0.000'
      ws.getCell(r, 7).font = { bold: true }
      r += 2
    }
    ws.getCell(r, 1).value = 'Local rice - trucking fee'
    ws.getCell(r, 3).value = 'BAGS @ 50 kgs'
    ws.getCell(r, 5).value = 'TRUCKING FEE'
    ws.getCell(r, 7).value = 'AMOUNT'
    for (const c of [1, 3, 5, 7]) ws.getCell(r, c).font = { bold: true }
    r += 1
    for (const l of sec.summary.rice) {
      ws.getCell(r, 1).value = l.product
      ws.getCell(r, 3).value = l.bags
      ws.getCell(r, 5).value = l.price
      ws.getCell(r, 7).value = l.amount
      ws.getCell(r, 3).numFmt = '#,##0.00'
      ws.getCell(r, 5).numFmt = '#,##0.00'
      ws.getCell(r, 7).numFmt = '#,##0.000'
      r += 1
    }
    if (sec.summary.rice.length) {
      ws.getCell(r, 1).value = 'TOTAL TRUCKING FEE'
      ws.getCell(r, 1).font = { bold: true }
      ws.getCell(r, 7).value = sec.summary.riceTotal
      ws.getCell(r, 7).numFmt = '#,##0.000'
      ws.getCell(r, 7).font = { bold: true }
      r += 1
    }
    if (sec.summary.byProducts.length) {
      r += 1
      ws.getCell(r, 1).value = 'LESS: BY-PRODUCTS'
      ws.getCell(r, 3).value = 'NET KG'
      ws.getCell(r, 5).value = 'U.P.'
      ws.getCell(r, 7).value = 'AMOUNT'
      for (const c of [1, 3, 5, 7]) ws.getCell(r, c).font = { bold: true }
      r += 1
      for (const l of sec.summary.byProducts) {
        ws.getCell(r, 1).value = l.product
        ws.getCell(r, 3).value = l.kilos
        ws.getCell(r, 5).value = l.price
        ws.getCell(r, 7).value = l.amount
        ws.getCell(r, 3).numFmt = '#,##0.000'
        ws.getCell(r, 5).numFmt = '#,##0.00'
        ws.getCell(r, 7).numFmt = '#,##0.000'
        r += 1
      }
      ws.getCell(r, 1).value = 'TOTAL'
      ws.getCell(r, 1).font = { bold: true }
      ws.getCell(r, 7).value = sec.summary.byTotal
      ws.getCell(r, 7).numFmt = '#,##0.000'
      ws.getCell(r, 7).font = { bold: true }
      r += 1
    }
    r += 1
    ws.getCell(r, 1).value = 'Certified Correct:'
    r += 2
    const sig = signatoryBlocks(config, sec.contractor)
    const step = Math.max(3, Math.floor(width / 4))
    sig.top.forEach((s, i) => { ws.getCell(r, 1 + i * step).value = s.name; ws.getCell(r, 1 + i * step).font = { bold: true }; ws.getCell(r + 1, 1 + i * step).value = s.title })
    r += 3
    sig.bottom.forEach((s, i) => { ws.getCell(r, 1 + i * step).value = s.name; ws.getCell(r, 1 + i * step).font = { bold: true }; ws.getCell(r + 1, 1 + i * step).value = s.title })
    void t
  }
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

// ---------------------------------------------------------------- PDF
export const exportLiquidationPdf = async (sections, { fileName, config }) => {
  const pdfMod = await import('jspdf')
  const jsPDF = pdfMod.jsPDF ?? pdfMod.default?.jsPDF ?? pdfMod.default
  const atMod = await import('jspdf-autotable')
  const autoTable = atMod.default?.default ?? atMod.default ?? atMod.autoTable
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'legal' })
  const pageW = doc.internal.pageSize.getWidth()
  let first = true

  const toCell = (c) => ({
    content: c.t, colSpan: c.cs ?? 1, rowSpan: c.rs ?? 1,
    styles: { halign: c.a === 'r' ? 'right' : c.a === 'c' ? 'center' : 'left', valign: 'middle', fontStyle: c.b ? 'bold' : 'normal' },
  })

  for (const sec of sections) {
    if (!first) doc.addPage()
    first = false
    let y = 10
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    for (const h of sec.heading) { doc.setFont('helvetica', h === 'NATIONAL FOOD AUTHORITY' ? 'bold' : 'normal'); doc.text(h, pageW / 2, y, { align: 'center' }); y += 4.5 }
    if (sec.heading.length) y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(sec.title, pageW / 2, y, { align: 'center' })
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    if (sec.subtitle) { doc.text(sec.subtitle, pageW / 2, y, { align: 'center' }); y += 4 }

    autoTable(doc, {
      startY: y + 2,
      head: sec.head.map((row) => row.map(toCell)),
      body: [...sec.rows.map((x) => x.cells.map(toCell)), sec.totalCells.map(toCell)],
      theme: 'grid',
      styles: { fontSize: 5.5, cellPadding: 0.9, lineColor: [60, 60, 60], lineWidth: 0.1, textColor: 20, overflow: 'linebreak' },
      headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold', halign: 'center' },
      margin: { left: 6, right: 6 },
    })
    let yy = doc.lastAutoTable.finalY + 6
    if (yy > 170) { doc.addPage(); yy = 12 }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('SUMMARY:', 8, yy)
    yy += 2
    if (sec.summary.palay.length) {
      autoTable(doc, {
        startY: yy,
        head: [['Palay issued - milling fee', 'BAGS', 'MILLING FEE', 'AMOUNT']],
        body: [...sec.summary.palay.map((l) => [l.product, fmt2(l.bags), fmt2(l.price), fmt3(l.amount)]), ['TOTAL MILLING FEE', '', '', fmt3(sec.summary.palayTotal)]],
        theme: 'plain', styles: { fontSize: 7, cellPadding: 0.8 }, headStyles: { fontStyle: 'bold' },
        tableWidth: 110, margin: { left: 8 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      })
      yy = doc.lastAutoTable.finalY + 2
    }
    autoTable(doc, {
      startY: yy,
      head: [['Local rice - trucking fee', 'BAGS @ 50 kgs', 'TRUCKING FEE', 'AMOUNT']],
      body: [...sec.summary.rice.map((l) => [l.product, fmt2(l.bags), fmt2(l.price), fmt3(l.amount)]), ...(sec.summary.rice.length ? [['TOTAL TRUCKING FEE', '', '', fmt3(sec.summary.riceTotal)]] : [])],
      theme: 'plain', styles: { fontSize: 7, cellPadding: 0.8 }, headStyles: { fontStyle: 'bold' },
      tableWidth: 110, margin: { left: 8 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    })
    yy = doc.lastAutoTable.finalY + 2
    if (sec.summary.byProducts.length) {
      autoTable(doc, {
        startY: yy,
        head: [['LESS: BY-PRODUCTS', 'NET KG', 'U.P.', 'AMOUNT']],
        body: [...sec.summary.byProducts.map((l) => [l.product, fmt3(l.kilos), fmt2(l.price), fmt3(l.amount)]), ['TOTAL', '', '', fmt3(sec.summary.byTotal)]],
        theme: 'plain', styles: { fontSize: 7, cellPadding: 0.8 }, headStyles: { fontStyle: 'bold' },
        tableWidth: 110, margin: { left: 8 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      })
      yy = doc.lastAutoTable.finalY + 2
    }
    // signatories on the right of the summary, as on the printed form
    const sig = signatoryBlocks(config, sec.contractor)
    let sy = Math.max(yy, doc.lastAutoTable.finalY) + 6
    if (sy > 190) { doc.addPage(); sy = 14 }
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('Certified Correct:', 130, sy - 3)
    const colW = (pageW - 140) / 4
    const place = (list, yRow) => list.forEach((s, i) => {
      doc.setFont('helvetica', 'bold'); doc.text(String(s.name || ''), 130 + i * colW, yRow)
      doc.setFont('helvetica', 'normal'); doc.text(s.title, 130 + i * colW, yRow + 4)
    })
    place(sig.top, sy + 6)
    place(sig.bottom, sy + 20)
    void fmtInt
  }
  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
}
