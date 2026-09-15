// Abstract of Cereal Purchases — SDO export.
//
// Deliberately self-contained (its own palette/margin constants, not
// imported from pdfGenerator.js) per explicit instruction to keep this
// whole feature contained in its own space, isolated from the existing
// NFA stock report generator.
//
// Column set and footer layout copy the real NFA report exactly (RSBSA
// No., the Gross/Sack/Net split, Rate/Amount only when Pricer applies,
// signatories lower-left with the role label on top, cash
// reconciliation as its own boxed column lower-right) - confirmed
// directly against a real sample of the document, not guessed.
//
// Pagination relies on autoTable's own built-in page-splitting: the
// column header repeats on every physical page via showHead
// (default 'everyPage'), and didDrawPage redraws the branch header on
// each one - the TOTAL row and signatures/reconciliation are appended
// to the body/foot data itself, so they only ever print once, after
// the very last row, on whichever page that lands on.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const BLACK = [0, 0, 0]
const HEADER_BG = [232, 232, 232]
const margin = 12
// 8.5 x 13 in (the physical paper this is actually printed on -
// confirmed directly, not A4), landscape: width/height swapped, both
// converted from inches to mm since the rest of this file works in mm.
const PAGE_W_IN = 13
const PAGE_H_IN = 8.5
const pageW = PAGE_W_IN * 25.4
const pageH = PAGE_H_IN * 25.4

const fmtBags = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-PH'))
const fmtKilos = (n, d = 3) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d }))
const fmtPeso = (n) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

const drawBranchHeader = (doc, { branchLabel, periodLabel }) => {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...BLACK)
  doc.text('NATIONAL FOOD AUTHORITY', pageW / 2, 12, { align: 'center' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(branchLabel, pageW / 2, 17, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('ABSTRACT OF CEREAL PURCHASES', pageW / 2, 24, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`For the period ${periodLabel}`, pageW / 2, 29, { align: 'center' })
}

/**
 * `purchaseReceipts` — every Active PR in the period, each already
 * carrying its own snapshot of payee/classification/weight/cost fields
 * (see PurchaseReceiptModal.jsx's handleIssue - a PR never re-reads
 * live data after being issued, so a later Buying Price or variety
 * edit can't silently reshape an already-issued document).
 * `purityDisplayFormat`: 'range' | 'letter'.
 * `pricerEnabled`: whether THIS SDO has Pricer on - the Rate/Amount
 * columns are omitted entirely (not blanked) when false, per explicit
 * instruction.
 * `reconciliation`: { fundBalance, addLabel, addAmount, lessEntries: [{label, amount}] }
 * `signatories`: { preparedBy: {name, position}, verifiedBy, notedBy }
 */
export const generateSdoAbstract = ({
  branchLabel, periodLabel, purchaseReceipts, purityDisplayFormat = 'range',
  pricerEnabled, reconciliation, signatories,
}) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] })

  const purityText = (pr) => purityDisplayFormat === 'letter' ? (pr.purityLetter ?? '') : `${pr.purityMin ?? ''}–${pr.purityMax ?? ''}`

  const head = [[
    'Date', 'Whse', 'Name of Farmer', 'RSBSA No.', 'Address', 'PR No.', 'WSR No.', 'Qty Bags', 'Variety', 'MC', 'Pur.',
    'Gross', 'Sack', 'Net', 'ENW Factor', 'Equiv. Net Wt.', 'Unit Cost', 'Basic Cost',
    ...(pricerEnabled ? ['Rate', 'Amount'] : []),
    'Total Amount', '',
  ]]

  const body = purchaseReceipts.map((pr) => [
    pr.date, pr.warehouseCode ?? '', pr.payeeName, pr.rsbsa ?? '', pr.payeeAddress,
    pr.prNo, pr.wsrSerialNo ?? '', fmtBags(pr.numberOfBags), pr.classification, pr.moistureContent, purityText(pr),
    fmtKilos(pr.grossKilos), fmtKilos(pr.sackKilos), fmtKilos(pr.netKilos),
    pr.enwFactor?.toFixed(4) ?? '', fmtKilos(pr.enw, 3), fmtKilos(pr.unitCost, 2), fmtPeso(pr.basicCost),
    ...(pricerEnabled ? [fmtKilos(pr.pricerRate, 2), fmtPeso(pr.pricerAmount)] : []),
    fmtPeso(pr.totalAmount), (pr.mtsCondition ?? '').toLowerCase(),
  ])

  const totals = purchaseReceipts.reduce((a, pr) => ({
    bags: a.bags + (pr.numberOfBags ?? 0),
    gross: a.gross + (pr.grossKilos ?? 0),
    sack: a.sack + (pr.sackKilos ?? 0),
    net: a.net + (pr.netKilos ?? 0),
    enw: a.enw + (pr.enw ?? 0),
    basic: a.basic + (pr.basicCost ?? 0),
    pricer: a.pricer + (pr.pricerAmount ?? 0),
    total: a.total + (pr.totalAmount ?? 0),
  }), { bags: 0, gross: 0, sack: 0, net: 0, enw: 0, basic: 0, pricer: 0, total: 0 })

  const foot = [[
    { content: 'TOTAL', colSpan: 7 },
    fmtBags(totals.bags), '', '', '',
    fmtKilos(totals.gross), fmtKilos(totals.sack), fmtKilos(totals.net),
    '', fmtKilos(totals.enw, 3), '', fmtPeso(totals.basic),
    ...(pricerEnabled ? ['', fmtPeso(totals.pricer)] : []),
    fmtPeso(totals.total), '',
  ]]

  autoTable(doc, {
    startY: 34,
    margin: { left: margin, right: margin, top: 34 },
    head,
    body,
    foot,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, textColor: BLACK, lineColor: [150, 150, 150], lineWidth: 0.1, cellPadding: 1.3 },
    headStyles: { fillColor: HEADER_BG, textColor: BLACK, fontStyle: 'bold', fontSize: 7.5 },
    footStyles: { fillColor: [240, 240, 240], textColor: BLACK, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 2: { halign: 'left' }, 4: { halign: 'left' } },
    didDrawPage: () => drawBranchHeader(doc, { branchLabel, periodLabel }),
  })

  // Footer (signatories lower-left, reconciliation lower-right) prints
  // exactly once, right after the table's true final row - wherever
  // that landed, not necessarily page 1. Real bug fixed here: the
  // reconciliation box's x position + width used to be computed from a
  // hardcoded signature-column width that assumed A4's 297mm - on that
  // page it ran 18mm PAST the right edge of the sheet entirely. Every
  // width below is now derived from the actual page width, so the
  // footer always fits inside the margins regardless of paper size.
  let y = doc.lastAutoTable.finalY + 10
  if (y > pageH - 40) { doc.addPage(); drawBranchHeader(doc, { branchLabel, periodLabel }); y = 40 }

  const usableW = pageW - margin * 2
  const reconW = 78
  const gapBeforeRecon = 10
  const sigGap = 6
  const sigAreaW = usableW - reconW - gapBeforeRecon
  const sigW = (sigAreaW - sigGap * 2) / 3

  const sigCols = [
    { role: 'Prepared By', person: signatories?.preparedBy },
    { role: 'Verified By', person: signatories?.verifiedBy },
    { role: 'Noted By', person: signatories?.notedBy },
  ]
  sigCols.forEach((c, i) => {
    const x = margin + i * (sigW + sigGap)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(c.role, x, y)
    doc.setLineWidth(0.3)
    doc.line(x, y + 16, x + sigW, y + 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(c.person?.name ?? '', x, y + 20)
    doc.setTextColor(90, 90, 90)
    doc.text(c.person?.position ?? '', x, y + 24)
    doc.setTextColor(...BLACK)
  })

  const reconX = margin + sigAreaW + gapBeforeRecon
  let ry = y - 4
  doc.setFillColor(...BLACK)
  doc.rect(reconX, ry, reconW, 7, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Cash Reconciliation', reconX + reconW / 2, ry + 5, { align: 'center' })
  doc.setTextColor(...BLACK)
  ry += 7
  const rows = [
    ['COH — Fund Balance', fmtPeso(reconciliation?.fundBalance)],
    [reconciliation?.addLabel ?? 'ADD', fmtPeso(reconciliation?.addAmount)],
    ...(reconciliation?.lessEntries ?? []).map((e) => [e.label, fmtPeso(e.amount)]),
  ]
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  rows.forEach(([label, amt]) => {
    doc.text(label, reconX + 1.5, ry + 4.5)
    doc.text(amt, reconX + reconW - 1.5, ry + 4.5, { align: 'right' })
    doc.setDrawColor(200, 200, 200)
    doc.line(reconX, ry + 7, reconX + reconW, ry + 7)
    ry += 7
  })

  return doc
}
