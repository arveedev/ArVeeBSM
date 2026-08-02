// BIN Card PDF — a per-pile transaction ledger. Landscape orientation.
// Shows EVERY transaction ever recorded against a pile (beginning
// balance, every WSR/WSI, every WTS transfer in or out, and a closing
// entry if the pile has been closed), in chronological order, with
// separate column groups for Receipts and Issues and a running
// Balance on the far right - the classic warehouse "bin card" format.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtBags, fmtKilos } from './calculations.js'
import { stripWarehouseCodePrefix } from '../services/googleSheetsBridge.js'

const BLACK = [0, 0, 0]
const HEADER_BG = [200, 200, 200]
const CONTENT_BORDER = [180, 180, 180]
const margin = 12

const fmtDate = (s) => {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Builds the chronological ledger of every transaction affecting this
 * pile - a beginning balance entry (if any), every WSR/WSI where
 * pileId matches, every WTS where issuedPileId or receivedPileId
 * matches (a transfer affects two piles at once, so only the side
 * relevant to THIS pile is shown as a row), and finally a closing
 * entry if the pile has been closed - which zeroes out whatever
 * balance remained at that point, regardless of what it was, since
 * closing means the pile is done being tracked (depleted, or closed
 * for any other reason) and its running balance has no further
 * meaning past that point. Cancelled transactions are excluded
 * entirely - a cancelled document never happened as far as the
 * pile's real stock movement is concerned.
 */
const buildLedgerRows = (pile, transactions) => {
  const relevant = transactions.filter((t) => {
    if (t.status === 'Cancelled') return false
    if (t.type === 'WTS') return t.issuedPileId === pile.pileId || t.receivedPileId === pile.pileId
    return t.pileId === pile.pileId
  })

  const sorted = [...relevant].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.isInitialBalance) return -1
    if (b.isInitialBalance) return 1
    const n = (x) => parseInt((x.serialNo ?? '').replace(/\D/g, ''), 10) || 0
    return n(a) - n(b)
  })

  let runningBags = 0
  let runningKilos = 0
  const rows = []

  for (const t of sorted) {
    let type, customer, reference, receiptBags = null, receiptKilos = null, issueBags = null, issueKilos = null

    if (t.isInitialBalance) {
      type = 'Beginning Balance'
      customer = ''
      reference = ''
      receiptBags = t.numberOfBags ?? 0
      receiptKilos = t.netKilos ?? 0
    } else if (t.type === 'WSR') {
      type = t.transactionTypeName ?? 'Receipt'
      customer = t.customerName ?? ''
      reference = t.serialNo ?? ''
      receiptBags = t.numberOfBags ?? 0
      receiptKilos = t.netKilos ?? 0
    } else if (t.type === 'WSI') {
      type = t.transactionTypeName ?? 'Issuance'
      customer = t.customerName ?? ''
      reference = t.serialNo ?? ''
      issueBags = t.numberOfBags ?? 0
      issueKilos = t.netKilos ?? 0
    } else if (t.type === 'WTS' && t.receivedPileId === pile.pileId) {
      type = 'Transfer In'
      customer = ''
      reference = t.serialNo ?? ''
      receiptBags = t.receivedBags ?? 0
      receiptKilos = t.receivedNetKilos ?? 0
    } else if (t.type === 'WTS' && t.issuedPileId === pile.pileId) {
      type = 'Transfer Out'
      customer = ''
      reference = t.serialNo ?? ''
      issueBags = t.issuedBags ?? 0
      issueKilos = t.issuedNetKilos ?? 0
    }

    runningBags += (receiptBags ?? 0) - (issueBags ?? 0)
    runningKilos += (receiptKilos ?? 0) - (issueKilos ?? 0)

    rows.push({
      date: t.date, type, customer, reference,
      receiptBags, receiptKilos, issueBags, issueKilos,
      balanceBags: runningBags, balanceKilos: runningKilos,
    })
  }

  // Closing entry - zeroes whatever balance remained, regardless of
  // its sign or size, since a closed pile's balance is no longer
  // meaningful past this point.
  if (pile.closedDate) {
    rows.push({
      date: pile.closedDate,
      type: 'CLOSED',
      customer: 'Pile Closed',
      reference: '',
      receiptBags: runningBags < 0 ? -runningBags : null,
      receiptKilos: runningBags < 0 ? -runningKilos : null,
      issueBags: runningBags > 0 ? runningBags : null,
      issueKilos: runningBags > 0 ? runningKilos : null,
      balanceBags: 0,
      balanceKilos: 0,
    })
  }

  return rows
}

export const generatePileBinCard = ({ warehouse, branch, pile, variety, transactions }) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const pileName = pile?.pileName ?? ''
  const warehouseName = stripWarehouseCodePrefix(warehouse?.name ?? '')

  let y = 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text('NATIONAL FOOD AUTHORITY', pageW / 2, y, { align: 'center' })
  y += 5

  if (branch?.name) {
    doc.setFontSize(9)
    doc.text(branch.name.toUpperCase(), pageW / 2, y, { align: 'center' })
    y += 4.5
  }

  doc.setFontSize(13)
  doc.text('BIN CARD', pageW / 2, y, { align: 'center' })
  y += 7

  // Simplified identification block - only warehouse / cereal type /
  // variety, no province, no pile name label (the pile name lives in
  // the corners instead).
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const labelW = 26
  const col2X = margin + 95

  doc.text('WAREHOUSE:', margin, y)
  doc.setFont('helvetica', 'bold')
  doc.text(warehouseName.toUpperCase(), margin + labelW, y)
  doc.setFont('helvetica', 'normal')
  doc.text('CEREAL TYPE:', col2X, y)
  doc.setFont('helvetica', 'bold')
  doc.text(pile?.cerealType?.toUpperCase() ?? '', col2X + labelW, y)
  y += 4.5

  doc.setFont('helvetica', 'normal')
  doc.text('VARIETY:', margin, y)
  doc.setFont('helvetica', 'bold')
  doc.text(variety?.name ?? '', margin + labelW, y)
  y += 7

  const rows = buildLedgerRows(pile, transactions)

  const body = rows.map((r) => [
    fmtDate(r.date),
    r.customer,
    r.type,
    r.reference,
    r.receiptBags != null ? fmtBags(r.receiptBags) : '',
    r.receiptKilos != null ? fmtKilos(r.receiptKilos) : '',
    r.issueBags != null ? fmtBags(r.issueBags) : '',
    r.issueKilos != null ? fmtKilos(r.issueKilos) : '',
    fmtBags(r.balanceBags),
    fmtKilos(r.balanceKilos),
  ])

  // Corner labels (pile name, no "PILE NAME:" label) - drawn on every
  // page via didDrawPage, since a long-running pile's ledger can span
  // several pages and every page needs its own identification. Upper
  // right matches the BIN CARD title's own size (13pt); the other
  // three corners share a smaller, consistent size. A 10mm margin
  // keeps every corner comfortably inside the printable area most
  // printers actually support (typical non-printable zones are
  // 4-5mm) - well clear even after accounting for the text's own
  // height/width. Lower RIGHT carries the current/total page
  // indicator.
  const cornerFontLarge = 13
  const cornerFontSmall = 10
  const cornerMargin = 10
  const usableWidth = pageW - margin * 2

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, top: 22, bottom: 16 },
    tableWidth: usableWidth,
    theme: 'grid',
    styles: {
      fontSize: 7,
      textColor: BLACK,
      lineWidth: 0.2,
      lineColor: CONTENT_BORDER,
      cellPadding: 1.4,
    },
    headStyles: {
      fillColor: HEADER_BG,
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: 7,
      lineWidth: 0.4,
      lineColor: BLACK,
      halign: 'center',
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    head: [
      [
        { content: 'DATE', rowSpan: 2 },
        { content: 'CUSTOMER', rowSpan: 2 },
        { content: 'TRANSACTION', rowSpan: 2 },
        { content: 'REFERENCE\nNO.', rowSpan: 2 },
        { content: 'RECEIPTS', colSpan: 2 },
        { content: 'ISSUES', colSpan: 2 },
        { content: 'BALANCE', colSpan: 2 },
      ],
      [
        { content: 'BAGS' }, { content: 'NET KILOS' },
        { content: 'BAGS' }, { content: 'NET KILOS' },
        { content: 'BAGS' }, { content: 'NET KILOS' },
      ],
    ],
    body,
    // Widths sum to exactly usableWidth (273mm on landscape A4 with a
    // 12mm margin) so the table fills the full page width rather than
    // leaving unused space - combined with tableWidth above, which
    // tells autoTable to stretch to that exact target regardless of
    // content-driven auto-sizing.
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 51 },
      2: { cellWidth: 36 },
      3: { cellWidth: 22 },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' },
      7: { cellWidth: 26, halign: 'right' },
      8: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
      9: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
    },
    didDrawPage: () => {
      const pageCount = doc.internal.getNumberOfPages()
      const pageCurrent = doc.internal.getCurrentPageInfo().pageNumber

      // Upper left - small
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(cornerFontSmall)
      doc.setTextColor(...BLACK)
      doc.text(pileName, cornerMargin, cornerMargin)

      // Upper right - large, matches BIN CARD title size
      doc.setFontSize(cornerFontLarge)
      doc.text(pileName, pageW - cornerMargin, cornerMargin + 1, { align: 'right' })

      // Lower left - small
      doc.setFontSize(cornerFontSmall)
      doc.text(pileName, cornerMargin, pageH - cornerMargin)

      // Lower right - small, plus current/total page indicator below it
      doc.text(pileName, pageW - cornerMargin, pageH - cornerMargin, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(`Page ${pageCurrent}/${pageCount}`, pageW - cornerMargin, pageH - cornerMargin + 4, { align: 'right' })
    },
  })

  return doc
}
