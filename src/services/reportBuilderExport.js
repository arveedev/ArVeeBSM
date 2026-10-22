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
export async function exportXlsx(t, meta, fileBase, extra = null) {
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
  const writeTable = (tt) => {
    const headRows = tt.hr ?? [tt.head]
    for (const hr of headRows) {
      const r = ws.addRow(hr)
      r.font = { bold: true, color: { argb: ink } }
      r.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hb}` } } })
    }
    for (const [ri, row] of tt.body.entries()) {
      const r = ws.addRow(row)
      if (tt.rowCls?.[ri] === 'subt') { r.font = { bold: true, color: { argb: 'FF064E3B' } }; r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCDECDC' } }; c.border = { top: { style: 'thin', color: { argb: 'FF10966E' } }, bottom: { style: 'thin', color: { argb: 'FF10966E' } } } }) }
      else if (tt.colCls) row.forEach((_, ci) => { if (/\btc\b/.test(tt.colCls[ci] || '')) { const c = r.getCell(ci + 1); c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDEF2E8' } } } })
      row.forEach((v, i) => { if (typeof v === 'number') { const c = r.getCell(i + 1); c.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.00'; c.alignment = { horizontal: 'right' } } })
    }
    if (tt.foot) { const r = ws.addRow(tt.foot); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F5A42' } }; if (typeof c.value === 'number') c.numFmt = '#,##0.00' }) }
  }
  writeTable(t)
  if (extra) {
    ws.addRow([])
    const sr = ws.addRow([extra.title])
    sr.font = { bold: true, size: 12, color: { argb: 'FF111111' } }
    writeTable(extra.table)
  }
  const widths = lastHead(t).map((h, i) => Math.max(10, Math.min(36, String(h ?? '').length + 3, ...t.body.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))))
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  if (!t.hr) ws.autoFilter = { from: { row: 2 + 1, column: 1 }, to: { row: 2 + 1, column: cols } }
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safe(fileBase)}.xlsx`)
}

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null }

export async function exportPdf(t, meta, fileBase, extra = null) {
  const [pdfMod, tableMod, fonts] = await Promise.all([import('jspdf'), import('jspdf-autotable'), import('./pdfFonts.js')])
  const jsPDF = pdfMod.jsPDF ?? pdfMod.default?.jsPDF ?? pdfMod.default
  const autoTable = typeof tableMod.default === 'function' ? tableMod.default : tableMod.default?.default ?? tableMod.autoTable
  // the same font as the table on screen (Montserrat, the Stock Desk table font)
  const make = (format) => {
    const d = new jsPDF({ orientation: 'landscape', unit: 'mm', format })
    d.addFileToVFS('Montserrat-Regular.ttf', fonts.MONTSERRAT_REGULAR)
    d.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal')
    d.addFileToVFS('Montserrat-Bold.ttf', fonts.MONTSERRAT_BOLD)
    d.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold')
    return d
  }
  const nf = (x) => (typeof x === 'number' ? (x === 0 ? '' : x.toLocaleString('en-US', { maximumFractionDigits: 2 })) : x ?? '')
  const leaf = lastHead(t)
  const ncol = leaf.length
  const rh = t.rhCols ?? 0
  const isNum = (ci) => (t.kinds ? t.kinds[ci] === 'num' : ci >= rh)

  // The whole width of the table must fit on the paper: find the largest type size (and the smallest paper) at which every column fits.
  const gauge = make('a4')
  const words = (s) => String(s ?? '').split(/\s+/).filter(Boolean)
  // For each column: the width it would like (a heading may wrap onto two lines, a name may wrap up to 70 mm) and the least it can have
  // (its widest number or longest word). Numbers are never squeezed below what they need.
  const meas = (fs) => {
    gauge.setFont('Montserrat', 'bold'); gauge.setFontSize(fs)
    const pad = 4.8
    const pref = []
    const min = []
    for (let ci = 0; ci < ncol; ci++) {
      const head = String(leaf[ci] || (ci < rh ? t.hr?.[0]?.[ci] : '') || '')
      const hw = gauge.getTextWidth(head)
      const longestHead = Math.max(0, ...words(head).map((w) => gauge.getTextWidth(w)))
      const texts = t.body.map((r) => nf(r[ci]))
      if (t.foot) texts.push(nf(t.foot[ci]))
      let body = 0
      let longestBody = 0
      for (const v of texts) { body = Math.max(body, gauge.getTextWidth(v)); for (const w of words(v)) longestBody = Math.max(longestBody, gauge.getTextWidth(w)) }
      if (isNum(ci)) { pref.push(Math.max(body, Math.min(hw, Math.max(longestHead, hw / 2))) + pad); min.push(Math.max(body, longestHead) + pad) } else { pref.push(Math.min(Math.max(body, hw), 70) + pad); min.push(Math.max(longestBody, longestHead) + pad) }
    }
    return { pref, min }
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0)
  const sizes = (format) => (format === 'a3' ? [9, 8.5, 8, 7.5, 7, 6.5, 6] : [9, 8.5, 8, 7.5, 7])
  const formats = [['a4', 297], ['legal', 356], ['a3', 420]]
  let pick = null
  for (const [format, pw] of formats) { for (const fs of sizes(format)) { if (pick) break; const m = meas(fs); if (sum(m.pref) <= pw - 20) pick = { format, fs, m, avail: pw - 20 } } if (pick) break }
  if (!pick) for (const [format, pw] of formats) { for (const fs of sizes(format)) { if (pick) break; const m = meas(fs); if (sum(m.min) <= pw - 20) pick = { format, fs, m, avail: pw - 20 } } if (pick) break }
  if (!pick) pick = { format: 'a3', fs: 6, m: meas(6), avail: 400 }
  const sp = sum(pick.m.pref)
  const sm = sum(pick.m.min)
  let widths
  if (sp <= pick.avail) { const k = Math.min(pick.avail / sp, 1.4); widths = pick.m.pref.map((x) => x * k) } else if (sm < pick.avail) { const f = (pick.avail - sm) / (sp - sm); widths = pick.m.pref.map((x, i) => pick.m.min[i] + (x - pick.m.min[i]) * f) } else { const k = pick.avail / sm; widths = pick.m.min.map((x) => x * k) }

  const doc = make(pick.format)
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const HEAD = hexRgb(meta.headBg) ?? [30, 41, 59]
  const HEAD_INK = (HEAD[0] * 0.299 + HEAD[1] * 0.587 + HEAD[2] * 0.114) > 150 ? [17, 24, 39] : [255, 255, 255]
  const GREEN = [15, 90, 66]
  // the only thing above the table: the title the person typed
  doc.setFont('Montserrat', 'bold'); doc.setFontSize(15); doc.setTextColor(17, 24, 39)
  doc.text(meta.title, 10, 13, { maxWidth: W - 20 })
  const shape = (tt) => {
    const rh = tt.rhCols ?? 0
    const isNum = (ci) => (tt.kinds ? tt.kinds[ci] === 'num' : ci >= rh)
    const head = tt.hdr
      ? tt.hdr.map((row) => row.map((c) => ({ content: c.content, colSpan: c.colSpan, rowSpan: c.rowSpan, styles: { halign: c.left ? 'left' : 'center', valign: 'middle', fillColor: c.tc ? GREEN : HEAD, textColor: c.tc ? 255 : HEAD_INK, fontStyle: 'bold' } })))
      : [tt.head.map((h, ci) => ({ content: h, styles: { halign: isNum(ci) ? 'right' : 'left', fillColor: HEAD, textColor: HEAD_INK, fontStyle: 'bold' } }))]
    const body = tt.body.map((r, ri) => {
      const sub = tt.rowCls?.[ri] === 'subt'
      const cells = []
      r.forEach((v, ci) => {
        if (sub && rh > 1 && ci > 0 && ci < rh) return // the "Subtotal" label spans the row-name columns
        const kind = tt.colCls?.[ci] || ''
        const tc = /\btc\b/.test(kind)
        const sc = /\bsc\b/.test(kind)
        const lead = ci < rh
        const styles = { halign: isNum(ci) ? 'right' : 'left', fontStyle: sub || tc || sc || lead ? 'bold' : 'normal' }
        if (sub) { styles.fillColor = [205, 236, 220]; styles.textColor = [6, 78, 59]; styles.lineColor = [16, 150, 110]; styles.lineWidth = 0.35 } else if (tc) styles.fillColor = [222, 242, 232]
        else if (sc) { styles.fillColor = [232, 245, 238]; styles.textColor = [6, 78, 59] }
        const cell = { content: sub && ci === 0 ? 'Subtotal' : nf(v), styles }
        if (sub && ci === 0) { styles.halign = 'right'; if (rh > 1) cell.colSpan = rh }
        cells.push(cell)
      })
      return cells
    })
    const foot = tt.foot ? [tt.foot.map((v, ci) => ({ content: nf(v), styles: { halign: isNum(ci) ? 'right' : 'left', fillColor: GREEN, textColor: 255, fontStyle: 'bold' } }))] : undefined
    return { head, body, foot }
  }
  const { head, body, foot } = shape(t)
  autoTable(doc, {
    startY: 19, head, body, foot, theme: 'grid', showFoot: 'lastPage', showHead: 'everyPage', tableWidth: widths.reduce((a, b) => a + b, 0),
    columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])),
    styles: { font: 'Montserrat', fontSize: pick.fs, cellPadding: { top: 1.9, bottom: 1.9, left: 2.4, right: 2.4 }, lineColor: [214, 219, 226], lineWidth: 0.15, textColor: [31, 41, 55], valign: 'middle', overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [249, 250, 252] }, margin: { left: 10, right: 10, bottom: 12 },
  })
  if (extra) {
    const y = (doc.lastAutoTable?.finalY ?? 19) + 10
    const room = H - y < 40
    if (room) doc.addPage()
    const top = room ? 15 : y
    doc.setFont('Montserrat', 'bold'); doc.setFontSize(11); doc.setTextColor(17, 24, 39)
    doc.text(extra.title, 10, top, { maxWidth: W - 20 })
    const sh = shape(extra.table)
    autoTable(doc, {
      startY: top + 3, head: sh.head, body: sh.body, foot: sh.foot, theme: 'grid', showFoot: 'lastPage', showHead: 'everyPage',
      styles: { font: 'Montserrat', fontSize: Math.min(pick.fs, 9), cellPadding: { top: 1.9, bottom: 1.9, left: 2.4, right: 2.4 }, lineColor: [214, 219, 226], lineWidth: 0.15, textColor: [31, 41, 55], valign: 'middle', overflow: 'linebreak' },
      alternateRowStyles: { fillColor: [249, 250, 252] }, margin: { left: 10, right: 10, bottom: 12 },
    })
  }
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
