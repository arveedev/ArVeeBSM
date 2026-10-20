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
  const ws = wb.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 6 + (t.hr ? t.hr.length : 1) }] })
  const cols = lastHead(t).length
  const line = (text, bold) => { const r = ws.addRow([text]); r.font = { bold: !!bold, size: bold ? 13 : 10, color: { argb: bold ? 'FF111111' : 'FF555555' } }; ws.mergeCells(r.number, 1, r.number, Math.max(2, Math.min(cols, 8))) }
  line(meta.title, true)
  line(`Source: ${meta.sourceName}`)
  line(`Filters: ${meta.filters.length ? meta.filters.join('; ') : 'none'}`)
  line(`Made on ${stamp()}${meta.who ? ` by ${meta.who}` : ''} - read-only copy of the app's records`)
  ws.addRow([])
  ws.addRow([])
  const headRows = t.hr ?? [t.head]
  for (const hr of headRows) {
    const r = ws.addRow(hr)
    r.font = { bold: true }
    r.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }; c.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } } })
  }
  for (const row of t.body) {
    const r = ws.addRow(row)
    row.forEach((v, i) => { if (typeof v === 'number') { const c = r.getCell(i + 1); c.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.00'; c.alignment = { horizontal: 'right' } } })
  }
  if (t.foot) { const r = ws.addRow(t.foot); r.font = { bold: true }; r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }; if (typeof c.value === 'number') c.numFmt = '#,##0.00' }) }
  const widths = lastHead(t).map((h, i) => Math.max(10, Math.min(36, String(h ?? '').length + 3, ...t.body.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))))
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  if (!t.hr) ws.autoFilter = { from: { row: 6 + 1, column: 1 }, to: { row: 6 + 1, column: cols } }
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safe(fileBase)}.xlsx`)
}

export async function exportPdf(t, meta, fileBase) {
  const [pdfMod, tableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const jsPDF = pdfMod.jsPDF ?? pdfMod.default?.jsPDF ?? pdfMod.default
  const autoTable = typeof tableMod.default === 'function' ? tableMod.default : tableMod.default?.default ?? tableMod.autoTable
  const wide = lastHead(t).length > 12
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: wide ? 'legal' : 'a4' })
  const W = doc.internal.pageSize.getWidth()
  doc.setFontSize(13); doc.setTextColor(20); doc.text(meta.title, 10, 12)
  doc.setFontSize(8.5); doc.setTextColor(90)
  doc.text(`Source: ${meta.sourceName}`, 10, 17)
  doc.text(`Filters: ${meta.filters.length ? meta.filters.join('; ') : 'none'}`, 10, 21, { maxWidth: W - 20 })
  doc.text(`Made on ${stamp()}${meta.who ? ` by ${meta.who}` : ''} - read-only copy of the app's records`, 10, 25)
  const nf = (x) => (typeof x === 'number' ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : x ?? '')
  autoTable(doc, {
    startY: 29, head: t.hr ?? [t.head], body: t.body.map((r) => r.map(nf)), foot: t.foot ? [t.foot.map(nf)] : undefined, theme: 'grid', showFoot: 'lastPage',
    styles: { fontSize: wide ? 6.5 : 7.5, cellPadding: 1.3, halign: 'right', lineColor: [200, 200, 200] }, headStyles: { fillColor: [235, 235, 235], textColor: 20, halign: 'center' }, footStyles: { fillColor: [235, 235, 235], textColor: 20 },
    columnStyles: { 0: { halign: 'left' } }, margin: { left: 10, right: 10, bottom: 12 },
  })
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Page ${i} of ${n}`, W - 10, doc.internal.pageSize.getHeight() - 5, { align: 'right' }) }
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
