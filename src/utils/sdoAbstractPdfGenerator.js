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
const GRAY_TEXT = [140, 140, 140]
const HEADER_BG = [232, 232, 232]
const margin = 12
// 8.5 x 13 in (the physical paper this is actually printed on -
// confirmed directly, not A4), landscape: width/height swapped, both
// converted from inches to mm since the rest of this file works in mm.
const PAGE_W_IN = 13
const PAGE_H_IN = 8.5
const pageW = PAGE_W_IN * 25.4
const pageH = PAGE_H_IN * 25.4

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-09-15" -> "September 15, 2026" - the period line's own format. */
const fmtDateLong = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** "2026-09-15" -> "Sep 15" - the DATE column's per-row format once the year moves into the header. */
const fmtDateShort = (iso) => {
  if (!iso) return ''
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`
}

/** The period line: a single date, or a range - both in the long "Month D, YYYY" form, not raw ISO. */
const fmtPeriodLabel = (dateFrom, dateTo) =>
  dateFrom === dateTo ? fmtDateLong(dateFrom) : `${fmtDateLong(dateFrom)} to ${fmtDateLong(dateTo)}`

/** The year shared by every row's date, or null if the rows span more than one year - lets DATE move the year up into its own header instead of repeating it on every row. */
const commonYear = (dates) => {
  const years = new Set(dates.filter(Boolean).map((iso) => iso.slice(0, 4)))
  return years.size === 1 ? [...years][0] : null
}

// The Abstract's Variety column shows only the base classifier (PD1,
// PD2, PW1, PW2) - confirmed directly: a variety code like "PD1m-A"
// carries a moisture-state modifier letter (m/s) and a Purity-grade
// suffix (-A/-B) that matter for the ENW lookup, but shouldn't print
// here. Falls back to the full name unchanged if it doesn't match the
// expected P + D/W + digits shape, rather than silently blanking
// something unexpected.
const baseVarietyCode = (name) => name?.match(/^P[DW]\d+/)?.[0] ?? name ?? ''

const fmtBags = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-PH'))
const fmtKilos = (n, d = 3) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d }))
const fmtPeso = (n) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Duplicated locally rather than imported from sdoCalculations.js, per
// this file's own house rule (see the top comment) of staying self-
// contained - same rule the SDO reference screen uses: ENW shows 3
// decimals when its factor is exactly 1, 4 otherwise.
const enwDecimalsForFactor = (factor) => (Number(factor) === 1 ? 3 : 4)

const drawBranchHeader = (doc, { branchLabel, periodLabel }) => {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...BLACK)
  doc.text('NATIONAL FOOD AUTHORITY', pageW / 2, 12, { align: 'center' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(branchLabel, pageW / 2, 17, { align: 'center' })
  // Rule between the org block and the report title - present on the
  // reference layout, missing here before.
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.line(margin, 20, pageW - margin, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('ABSTRACT OF CEREAL PURCHASES', pageW / 2, 26, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`For the period ${periodLabel}`, pageW / 2, 31, { align: 'center' })
}

/**
 * `purchaseReceipts` — every Active PR in the period, each already
 * carrying its own snapshot of payee/classification/weight/cost fields
 * (see PurchaseReceiptModal.jsx's handleIssue - a PR never re-reads
 * live data after being issued, so a later Buying Price or variety
 * edit can't silently reshape an already-issued document).
 * `purityDisplayFormat`: 'range' | 'letter'.
 * `reconciliation`: { fundBalance, addLabel, addAmount, lessEntries: [{label, amount}] }
 * `signatories`: { preparedBy: {name, position}, verifiedBy, notedBy }
 *
 * Whether the Rate/Amount/Basic Cost columns print is decided from the
 * PRs' OWN pricerAmount snapshot, not from the SDO's current Pricer
 * eligibility - eligibility can be toggled by Admin after a PR was
 * issued, and a period can genuinely mix PRs issued while Pricer was on
 * and off. Deciding this per-export from a single live flag used to
 * make Basic Cost/Total Amount silently stop reconciling for whichever
 * PRs didn't match today's toggle state; deciding it from each PR's own
 * data (blank cells for a PR that had no pricer amount, same as
 * fmtPeso/fmtKilos already do for any null) keeps every row honest
 * regardless of what Admin does afterward.
 */
export const generateSdoAbstract = ({
  branchLabel, dateFrom, dateTo, purchaseReceipts, purityDisplayFormat = 'range',
  reconciliation, signatories,
}) => {
  const pricerEnabled = purchaseReceipts.some((pr) => pr.pricerAmount != null)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] })
  const periodLabel = fmtPeriodLabel(dateFrom, dateTo)

  const purityText = (pr) => purityDisplayFormat === 'letter' ? (pr.purityLetter ?? '') : `${pr.purityMin ?? ''}–${pr.purityMax ?? ''}`

  // DATE's own year moves into the column header (second line) instead
  // of repeating on every row, same convention the existing NFA stock
  // report already uses - only when every row actually shares one year;
  // a period that genuinely crosses a year boundary keeps the full date
  // per row so nothing is lost.
  const year = commonYear(purchaseReceipts.map((pr) => pr.date))
  const dateHeader = year ? { content: `Date\n${year}`, styles: { valign: 'middle' } } : 'Date'
  const fmtRowDate = (iso) => (year ? fmtDateShort(iso) : fmtDateLong(iso))

  // The BN/SH mark is deliberately NOT a table column - "must not be in
  // a table, just a text on that side" - tracked in its own array by
  // row index and drawn just past the table's right edge via
  // didDrawCell below, instead.
  const marks = purchaseReceipts.map((pr) => (pr.mtsCondition ?? '').toLowerCase())

  // Basic Cost is only meaningfully DIFFERENT from Total Amount when
  // Pricer adds something on top of it - "the basic cost is part of
  // the pricers" - so with Pricer disabled it's the same figure as
  // Total Amount twice over, and the column is dropped entirely rather
  // than repeat it.
  const head = [[
    dateHeader, 'Whse', 'Name of Farmer', 'RSBSA No.', 'Address', 'PR No.', 'WSR No.', 'Qty Bags', 'Variety', 'MC', 'Pur.',
    'Gross', 'Sack', 'Net', 'ENW Factor', 'Equiv. Net Wt.', 'Unit Cost',
    ...(pricerEnabled ? ['Basic Cost', 'Rate', 'Amount'] : []),
    'Total Amount',
  ]]

  const body = purchaseReceipts.map((pr) => [
    fmtRowDate(pr.date), pr.warehouseCode ?? '', pr.payeeName, pr.rsbsa ?? '', pr.payeeAddress,
    pr.prNo, pr.wsrSerialNo ?? '', fmtBags(pr.numberOfBags), baseVarietyCode(pr.classification), pr.moistureContent, purityText(pr),
    fmtKilos(pr.grossKilos), fmtKilos(pr.sackKilos), fmtKilos(pr.netKilos),
    pr.enwFactor?.toFixed(4) ?? '', fmtKilos(pr.enw, enwDecimalsForFactor(pr.enwFactor)), fmtKilos(pr.unitCost, 2),
    ...(pricerEnabled ? [fmtPeso(pr.basicCost), fmtKilos(pr.pricerRate, 2), fmtPeso(pr.pricerAmount)] : []),
    fmtPeso(pr.totalAmount),
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
    '', fmtKilos(totals.enw, 4), '',
    ...(pricerEnabled ? [fmtPeso(totals.basic), '', fmtPeso(totals.pricer)] : []),
    fmtPeso(totals.total),
  ]]

  const lastColIndex = head[0].length - 1

  autoTable(doc, {
    startY: 36,
    margin: { left: margin, right: margin, top: 36 },
    head,
    body,
    foot,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, textColor: BLACK, lineColor: [150, 150, 150], lineWidth: 0.1, cellPadding: 1.3, halign: 'center' },
    headStyles: { fillColor: HEADER_BG, textColor: BLACK, fontStyle: 'bold', fontSize: 7.5, halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [240, 240, 240], textColor: BLACK, fontStyle: 'bold', fontSize: 8, halign: 'center' },
    columnStyles: { 2: { halign: 'left' }, 4: { halign: 'left' } },
    didDrawPage: () => drawBranchHeader(doc, { branchLabel, periodLabel }),
    // Draws each row's BN/SH mark just past the table's own right edge
    // once that row's last real column has been placed - small, light
    // gray, never part of the bordered grid itself.
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== lastColIndex) return
      const mark = marks[data.row.index]
      if (!mark) return
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...GRAY_TEXT)
      doc.text(mark, data.cell.x + data.cell.width + 2, data.cell.y + data.cell.height / 2 + 1)
      doc.setTextColor(...BLACK)
    },
  })

  // Footer (signatories lower-left, reconciliation lower-right) prints
  // exactly once, right after the table's true final row - wherever
  // that landed, not necessarily page 1. Real bug fixed here: the
  // reconciliation box's x position + width used to be computed from a
  // hardcoded signature-column width that assumed A4's 297mm - on that
  // page it ran 18mm PAST the right edge of the sheet entirely. Every
  // width below is now derived from the actual page width, so the
  // footer always fits inside the margins regardless of paper size.
  //
  // The reconciliation rows are built BEFORE deciding whether a new
  // page is needed, so the overflow check below is sized to however
  // many LESS deductions this export actually has (today always
  // exactly one - "This period's disbursements" - but nothing here
  // assumes that), instead of a flat 40mm guess that only happened to
  // be enough for the current one-deduction shape.
  const fundBalance = reconciliation?.fundBalance ?? 0
  const addAmount = reconciliation?.addAmount ?? 0
  let running = fundBalance + addAmount
  // Reported real bug: a separate "Fund available" ADD row (even once
  // it was actually computing a real number, not the hardcoded 0 it
  // used to be) read as TWO fund balances on the page - the SDO's own
  // convention is one COH — Fund Balance figure, already inclusive of
  // any replenishment during the period. The caller now folds that in
  // before calling this, so addAmount is 0 for the current export - the
  // ADD row (and its own redundant TOTAL) is skipped whenever there's
  // nothing in it, collapsing back to the single-line figure. Kept
  // conditional rather than deleted outright so a genuinely separate
  // mid-period addition can still be shown distinctly if some future
  // export needs that shape.
  const reconRows = [{ label: 'COH — Fund Balance', amt: fundBalance }]
  if (addAmount) {
    reconRows.push({ label: reconciliation?.addLabel ?? 'ADD', amt: addAmount })
    reconRows.push({ label: 'TOTAL', amt: running, bold: true })
  }
  for (const e of reconciliation?.lessEntries ?? []) {
    running -= e.amount ?? 0
    reconRows.push({ label: e.label, amt: e.amount })
    reconRows.push({ label: 'TOTAL', amt: running, bold: true })
  }
  // The box itself starts 4mm ABOVE `y` (see `ry = y - 4` below), so its
  // true bottom relative to `y` is 3mm plus one 7mm row per reconRows
  // entry, not `y` plus the header bar.
  const reconBoxH = 3 + reconRows.length * 7
  const sigBoxH = 28 // role line at y, signature line at y+16, name/position through y+24
  const footerH = Math.max(reconBoxH, sigBoxH)

  let y = doc.lastAutoTable.finalY + 10
  if (y + footerH > pageH - margin) { doc.addPage(); drawBranchHeader(doc, { branchLabel, periodLabel }); y = 40 }

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
  // A running TOTAL after the initial COH+ADD, then again after EVERY
  // LESS deduction - confirmed directly against a real sample of this
  // document, and something this generator was missing entirely before
  // ("we are missing a total on the cash reconciliation part").
  reconRows.forEach(({ label, amt, bold }) => {
    if (bold) {
      doc.setFillColor(238, 238, 238)
      doc.rect(reconX, ry, reconW, 7, 'F')
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(8.5)
    doc.text(label, reconX + 1.5, ry + 4.5)
    doc.text(fmtPeso(amt), reconX + reconW - 1.5, ry + 4.5, { align: 'right' })
    doc.setDrawColor(bold ? 0 : 200, bold ? 0 : 200, bold ? 0 : 200)
    doc.setLineWidth(bold ? 0.3 : 0.1)
    doc.line(reconX, ry + 7, reconX + reconW, ry + 7)
    ry += 7
  })

  return doc
}
