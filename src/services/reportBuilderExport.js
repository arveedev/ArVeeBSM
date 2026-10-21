// Report Builder: exports (Excel, PDF, CSV, clipboard). Builds a file in memory from the table the screen shows and downloads it.
// Reads nothing from the database and writes nothing to it.

import { lastHead, toCsv, toTsv } from '../utils/reportBuilder/engine.js'

const stamp = () => new Date().toLocaleString('en-PH')
const safe = (s) => String(s ?? 'report').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'report'

const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/** meta: { title, sourceName, filters: string[], who } ; t: the flat table ({ hr, head, body, foot }) */
export async function exportXlsx(t, meta, fileBase) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'BSM App Report Builder'
  const ws = wb.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 2 + (t.hr ? t.hr.length : 1) }] })
  const hb = String(meta.headBg || '#1e293b').replace('#', '').toUpperCase()
  const ink = (parseInt(hb.slice(0, 2), 16) * 0.299 + parseInt(hb.slice(2, 4), 16) * 0.587 + parseInt(hb.slice(4, 6), 16) * 0.114) > 150 ? 'FF111827' : 'FFFFFFFF'
  const cols = lastHead(t).length
  const line = (text, bold) => { const r = ws.addRow([text]); r.font = { bold: !!bold, size: bold ? 13 : 10, color: { argb: bold ? 'FF111111' : 'FF555555' } }; ws.mergeCells(r.number, 1, r.number, Math.max(2, Math.min(cols, 8))) }
  line(meta.title, true) // the only thing above the table: the title the person typed
  ws.addRow([])
  const headRows = t.hr ?? [t.head]
  for (const hr of headRows) {
    const r = ws.addRow(hr)
    r.font = { bold: true, color: { argb: ink } }
    r.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hb}` } } })
  }
  for (const [ri, row] of t.body.entries()) {
    const r = ws.addRow(row)
    if (t.rowCls?.[ri] === 'subt') { r.font = { bold: true, color: { argb: 'FF064E3B' } }; r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCDECDC' } }; c.border = { top: { style: 'thin', color: { argb: 'FF10966E' } }, bottom: { style: 'thin', color: { argb: 'FF10966E' } } } }) }
    else if (t.colCls) row.forEach((_, ci) => { if (/\btc\b/.test(t.colCls[ci] || '')) { const c = r.getCell(ci + 1); c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDEF2E8' } } } })
    row.forEach((v, i) => { if (typeof v === 'number') { const c = r.getCell(i + 1); c.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.00'; c.alignment = { horizontal: 'right' } } })
  }
  if (t.foot) { const r = ws.addRow(t.foot); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F5A42' } }; if (typeof c.value === 'number') c.numFmt = '#,##0.00' }) }
  const widths = lastHead(t).map((h, i) => Math.max(10, Math.min(36, String(h ?? '').length + 3, ...t.body.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))))
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  if (!t.hr) ws.autoFilter = { from: { row: 2 + 1, column: 1 }, to: { row: 2 + 1, column: cols } }
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safe(fileBase)}.xlsx`)
}

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null }

export async function exportPdf(t, meta, fileBase) {
  const [pdfMod, tableMod, fonts] = await Promise.all([import('jspdf'), import('jspdf-autotable'), import('./pdfFonts.js')])
  const jsPDF = pdfMod.jsPDF ?? pdfMod.default?.jsPDF ?? pdfMod.default
  const autoTable = typeof tableMod.default === 'function' ? tableMod.default : tableMod.default?.default ?? tableMod.autoTable
  const ncol = lastHead(t).length
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: ncol > 18 ? 'legal' : 'a4' })
  // the same font as the table on screen (Montserrat, the Stock Desk table font)
  doc.addFileToVFS('Montserrat-Regular.ttf', fonts.MONTSERRAT_REGULAR)
  doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal')
  doc.addFileToVFS('Montserrat-Bold.ttf', fonts.MONTSERRAT_BOLD)
  doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold')
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const HEAD = hexRgb(meta.headBg) ?? [30, 41, 59]
  const HEAD_INK = (HEAD[0] * 0.299 + HEAD[1] * 0.587 + HEAD[2] * 0.114) > 150 ? [17, 24, 39] : [255, 255, 255]
  const GREEN = [15, 90, 66]
  // the only thing above the table: the title the person typed
  doc.setFont('Montserrat', 'bold'); doc.setFontSize(15); doc.setTextColor(17, 24, 39)
  doc.text(meta.title, 10, 13, { maxWidth: W - 20 })
  const nf = (x) => (typeof x === 'number' ? (x === 0 ? '' : x.toLocaleString('en-US', { maximumFractionDigits: 2 })) : x ?? '')
  const rh = t.rhCols ?? 0
  const isNum = (ci) => (t.kinds ? t.kinds[ci] === 'num' : ci >= rh)
  const head = t.hdr
    ? t.hdr.map((row) => row.map((c) => ({ content: c.content, colSpan: c.colSpan, rowSpan: c.rowSpan, styles: { halign: c.left ? 'left' : 'center', valign: 'middle', fillColor: c.tc ? GREEN : HEAD, textColor: c.tc ? 255 : HEAD_INK, fontStyle: 'bold' } })))
    : [t.head.map((h, ci) => ({ content: h, styles: { halign: isNum(ci) ? 'right' : 'left', fillColor: HEAD, textColor: HEAD_INK, fontStyle: 'bold' } }))]
  const body = t.body.map((r, ri) => {
    const sub = t.rowCls?.[ri] === 'subt'
    const cells = []
    r.forEach((v, ci) => {
      if (sub && rh > 1 && ci > 0 && ci < rh) return // the "Subtotal" label spans the row-name columns
      const tc = /\btc\b/.test(t.colCls?.[ci] || '')
      const lead = ci < rh
      const styles = { halign: isNum(ci) ? 'right' : 'left', fontStyle: sub || tc || lead ? 'bold' : 'normal' }
      if (sub) { styles.fillColor = [205, 236, 220]; styles.textColor = [6, 78, 59]; styles.lineColor = [16, 150, 110]; styles.lineWidth = 0.35 } else if (tc) styles.fillColor = [222, 242, 232]
      const cell = { content: sub && ci === 0 ? 'Subtotal' : nf(v), styles }
      if (sub && ci === 0) { styles.halign = 'right'; if (rh > 1) cell.colSpan = rh }
      cells.push(cell)
    })
    return cells
  })
  const foot = t.foot ? [t.foot.map((v, ci) => ({ content: nf(v), styles: { halign: isNum(ci) ? 'right' : 'left', fillColor: GREEN, textColor: 255, fontStyle: 'bold' } }))] : undefined
  autoTable(doc, {
    startY: 19, head, body, foot, theme: 'grid', showFoot: 'lastPage', showHead: 'everyPage', horizontalPageBreak: true, horizontalPageBreakRepeat: rh ? Array.from({ length: rh }, (_, i) => i) : undefined,
    styles: { font: 'Montserrat', fontSize: ncol > 10 ? 7.8 : 9, cellPadding: { top: 1.9, bottom: 1.9, left: 2.2, right: 2.2 }, lineColor: [214, 219, 226], lineWidth: 0.15, textColor: [31, 41, 55], valign: 'middle' },
    alternateRowStyles: { fillColor: [249, 250, 252] }, margin: { left: 10, right: 10, bottom: 12 },
  })
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('Montserrat', 'normal'); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Page ${i} of ${n}`, W - 10, H - 5, { align: 'right' }) }
  saveBlob(doc.output('blob'), `${safe(fileBase)}.pdf`)
}

export const exportCsv = (t, fileBase) => saveBlob(new Blob([`﻿${toCsv(t)}`], { type: 'text/csv;charset=utf-8' }), `${safe(fileBase)}.csv`)

export async function copyTable(t) {
  const text = toTsv(t)
  try { await navigator.clipboard.writeText(text); return true } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
    return ok
  }
}
