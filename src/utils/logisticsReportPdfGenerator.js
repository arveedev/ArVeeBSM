// Weekly Warehouse Equipment and Logistics Report (PDF): wooden pallets, platform scales and other logistics
// (tarpaulin, sackoline, bag closer, fumigating sheets) as entered by the warehouse, with the usual signatories.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { addPageNumbers } from './pdfPageNumbers.js'

const BLACK = [0, 0, 0]
const GRAY_TEXT = [80, 80, 80]
const HEADER_BG = [214, 214, 214]
const CONTENT_BORDER = [150, 150, 150]
const margin = 14
const pageW = 210

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
const ymd = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d } }

/** "OCTOBER 1 - 7, 2026", "SEPTEMBER 30 - OCTOBER 6, 2026", or across years in full. */
export const fmtLogisticsPeriod = (fromIso, toIso) => {
  if (!fromIso || !toIso) return ''
  const a = ymd(fromIso), b = ymd(toIso)
  if (a.y === b.y && a.m === b.m) return a.d === b.d ? `${MONTHS[a.m - 1]} ${a.d}, ${a.y}` : `${MONTHS[a.m - 1]} ${a.d} - ${b.d}, ${a.y}`
  if (a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d} - ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`
  return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} - ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`
}

const num = (v) => (v === '' || v == null ? '' : Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-PH') : String(v))

const tableStyles = {
  headStyles: { fillColor: HEADER_BG, textColor: BLACK, fontStyle: 'bold', fontSize: 7.5, lineWidth: 0.4, lineColor: BLACK, halign: 'center', valign: 'middle' },
  bodyStyles: { fontSize: 8, textColor: BLACK, lineWidth: 0.2, lineColor: CONTENT_BORDER, fillColor: [255, 255, 255], valign: 'middle', minCellHeight: 6 },
  rowPageBreak: 'avoid',
  didDrawCell: (data) => {
    if (data.section !== 'head') return
    const { x, y, width, height } = data.cell
    data.doc.setDrawColor(...BLACK)
    data.doc.setLineWidth(0.5)
    data.doc.rect(x, y, width, height)
  },
}

/**
 * data = { palletRows: [{ classification, utilized, available, transfer, remarks }],
 *          scaleRows: [{ type, serials, serviceable, forRepair, unserviceable, remarks }],
 *          logisticRows: [{ name, brandNew, serviceable, unserviceable, remarks }] }
 */
export const generateLogisticsReport = ({ branch, warehouse, province, dateFrom, dateTo, data, signatories }) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = 14
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BLACK)
  doc.text('NATIONAL FOOD AUTHORITY', pageW / 2, y, { align: 'center' })
  y += 5.5
  doc.setFontSize(10)
  doc.text('WEEKLY WAREHOUSE EQUIPMENT AND LOGISTICS REPORT', pageW / 2, y, { align: 'center' })
  y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(fmtLogisticsPeriod(dateFrom, dateTo), pageW / 2, y, { align: 'center' })
  y += 8

  const branchBase = String(branch?.name ?? '').replace(/\s*branch(\s*office)?\s*$/i, '').trim()
  const info = [
    ['REGION', branch?.region ?? ''],
    ['PROVINCE', `${branchBase || (province?.name ?? '')} BRANCH OFFICE`.toUpperCase()],
    ['WAREHOUSE', `${warehouse?.name ?? ''} WAREHOUSE`.toUpperCase()],
    ['CODE', warehouse?.code ?? ''],
  ]
  info.forEach(([label, value]) => {
    doc.setFont('helvetica', 'normal'); doc.text(label, margin, y)
    doc.text(':', margin + 22, y)
    doc.setFont('helvetica', 'bold'); doc.text(String(value), margin + 25, y)
    y += 4
  })
  y += 3

  const section = (title) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...BLACK)
    doc.text(title, margin, y)
    y += 2
  }
  const run = (opts) => {
    autoTable(doc, { startY: y, margin: { left: margin, right: margin }, ...tableStyles, ...opts })
    y = doc.lastAutoTable.finalY + 6
  }
  const right = { halign: 'center' }

  section('WOODEN PALLETS')
  run({
    head: [
      [{ content: 'CLASSIFICATION', rowSpan: 2 }, { content: 'QUANTITY', colSpan: 3 }, { content: 'REMARKS', rowSpan: 2 }],
      ['UTILIZED', 'AVAILABLE', 'TRANSFER'],
    ],
    body: data.palletRows.map((r) => [r.classification, num(r.utilized), num(r.available), num(r.transfer), r.remarks ?? '']),
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 24, ...right }, 2: { cellWidth: 24, ...right }, 3: { cellWidth: 24, ...right } },
  })

  section('PLATFORM SCALE')
  const scaleBody = data.scaleRows.length ? data.scaleRows : [{ type: '', serials: '', serviceable: '', forRepair: '', unserviceable: '', remarks: '' }]
  run({
    head: [['TYPE', 'SERVICEABLE', 'FOR REPAIR', 'UNSERVICEABLE', 'REMARKS']],
    body: scaleBody.map((r) => [{ content: `${(r.type ?? '').toUpperCase()}${r.serials ? `\n${r.serials}` : ''}` }, num(r.serviceable), num(r.forRepair), num(r.unserviceable), r.remarks ?? '']),
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 26, ...right }, 2: { cellWidth: 26, ...right }, 3: { cellWidth: 28, ...right } },
  })

  section('OTHER LOGISTICS')
  run({
    head: [
      [{ content: 'NAME', rowSpan: 2 }, { content: 'QUANTITY', colSpan: 3 }, { content: 'REMARKS', rowSpan: 2 }],
      ['BRAND NEW', 'SERVICEABLE', 'UNSERVICEABLE'],
    ],
    body: data.logisticRows.map((r) => [(r.name ?? '').toUpperCase(), num(r.brandNew), num(r.serviceable), num(r.unserviceable), r.remarks ?? '']),
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 24, ...right }, 2: { cellWidth: 24, ...right }, 3: { cellWidth: 28, ...right } },
  })

  // ---- signatories: four across, Noted By centred underneath ----
  const pageH = doc.internal.pageSize.getHeight()
  const need = 62
  if (y + need > pageH - 12) { doc.addPage(); y = 20 }
  const col = (pageW - margin * 2) / 4
  const sig = (label, who, x, yy, w = col) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRAY_TEXT)
    doc.text(label, x, yy)
    const lineY = yy + 14
    doc.setDrawColor(...BLACK); doc.setLineWidth(0.3)
    doc.line(x, lineY, x + w - 4, lineY)
    const people = (Array.isArray(who) ? who : [who]).filter((p) => p && (p.name || p.position))
    let py = lineY
    ;(people.length ? people : [{ name: '', position: '' }]).forEach((p, i) => {
      if (i > 0) { py += 12; doc.line(x, py, x + w - 4, py) }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...BLACK)
      doc.text(String(p.name ?? '').toUpperCase(), x + (w - 4) / 2, py - 1, { align: 'center' })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text(p.position ?? '', x + (w - 4) / 2, py + 3.6, { align: 'center' })
    })
    return py + 4
  }
  const bottoms = [
    sig('Certified Correct:', signatories.certifiedCorrect, margin, y),
    sig('Reviewed by:', signatories.reviewedBy, margin + col, y),
    sig('Verified Correct:', signatories.verifiedCorrect, margin + col * 2, y),
    sig('Audited by:', signatories.auditedBy, margin + col * 3, y),
  ]
  const notedY = Math.max(...bottoms) + 8
  sig('Noted by:', signatories.notedBy, margin + col * 2, notedY)

  addPageNumbers(doc, { right: margin, bottom: 3.5 })
  return doc
}
