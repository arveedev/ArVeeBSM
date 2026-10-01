// CPF Cash Disbursement Record — SDO export.
//
// Deliberately self-contained (its own palette/margin/page-size
// constants, not imported from sdoAbstractPdfGenerator.js or
// pdfGenerator.js), matching the same "keep this whole feature
// contained in its own space" convention the Abstract generator already
// documents.
//
// A running cash-ledger printout, not a one-time summary: every Cash-
// paid Purchase Receipt in the period is interleaved, in date order,
// with every CPF replenishment/liquidation event from the same SDO's
// db.cashLedgerV2, each row carrying its own running CASH ADVANCE/FUND
// BALANCE figure - confirmed directly against a real sample of this
// document. Check-paid PRs never appear here at all (see
// computeCashOnHand's own comment in sdoCalculations.js: a check draws
// from the bank account, never the physical CPF cash this report
// tracks), and neither do Cancelled PRs (unlike the Abstract, which
// deliberately keeps a Cancelled row to explain a PR-number gap - that's
// a procurement-sequence concern, not a cash-ledger one; a Cancelled PR
// never actually disbursed anything).

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const BLACK = [0, 0, 0]
const HEADER_BG = [232, 232, 232]
const margin = 0.3 * 25.4
// Same physical paper/orientation as the Abstract (8.5 x 13in,
// landscape) - this report's column count (19) is in the same range.
const PAGE_W_IN = 13
const PAGE_H_IN = 8.5
const pageW = PAGE_W_IN * 25.4
const pageH = PAGE_H_IN * 25.4

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const fmtDateLong = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}
const fmtDateShort = (iso) => {
  if (!iso) return ''
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`
}
const fmtPeriodLabel = (dateFrom, dateTo) =>
  dateFrom === dateTo ? fmtDateLong(dateFrom) : `${fmtDateLong(dateFrom)} to ${fmtDateLong(dateTo)}`
const commonYear = (dates) => {
  const years = new Set(dates.filter(Boolean).map((iso) => iso.slice(0, 4)))
  return years.size === 1 ? [...years][0] : null
}

// One day before `iso` - the "Balance brought forward" row's own date
// label is the day right before the period starts (the same exclusive-
// cutoff convention DataStartDatePanel.jsx/effectiveCutoffDate already
// use everywhere else in this app), not the period's own first day.
const dayBefore = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// Same base-classifier extraction as the Abstract's baseVarietyCode.
const baseVarietyCode = (name) => name?.match(/^P[DW]\d+/)?.[0] ?? name ?? ''

const fmtBags = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-PH'))
const fmtKilos = (n, d = 3) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d }))
const fmtPeso = (n) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

const TABLE_START_Y = 40
const CONTINUATION_MARGIN_TOP = 16

// isFirstPage - only page 1 carries the full report title/org identity/
// officer-identification block; a continuation page just needs the
// title/period, same convention the Abstract's drawBranchHeader uses.
const drawHeader = (doc, { branchLabel, cityLabel, periodLabel, officer, isFirstPage = true }) => {
  doc.setTextColor(...BLACK)
  if (!isFirstPage) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('CPF CASH DISBURSEMENT RECORD', pageW / 2, 10, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`FOR THE PERIOD ${periodLabel.toUpperCase()}`, pageW / 2, 15, { align: 'center' })
    return
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('CPF CASH DISBURSEMENT RECORD', pageW / 2, 9, { align: 'center' })
  doc.setFontSize(11)
  doc.text('NATIONAL FOOD AUTHORITY', pageW / 2, 14.5, { align: 'center' })
  doc.setFontSize(9)
  doc.text((branchLabel ?? '').toUpperCase(), pageW / 2, 19, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.text((cityLabel ?? '').toUpperCase(), pageW / 2, 23, { align: 'center' })

  // Officer identification block - one person's Name / Official
  // Designation / Station, confirmed directly against a real sample:
  // three columns, each a bold+underlined value line with a smaller
  // muted label underneath (the same visual language the Abstract uses
  // for its signature blocks, just at the top of the page here instead
  // of the bottom, and describing one person instead of three).
  const usableW = pageW - margin * 2
  const colW = usableW / 3
  const blocks = [
    { value: (officer?.name ?? '').toUpperCase(), label: 'ACCOUNTABLE OFFICER' },
    { value: (officer?.position ?? '').toUpperCase(), label: 'OFFICIAL DESIGNATION' },
    // Per explicit confirmation: a static routing label, not a real,
    // per-branch/per-SDO signatory - always literally "FINANCE".
    { value: 'FINANCE', label: 'STATION' },
  ]
  const blockY = 30
  blocks.forEach((b, i) => {
    const x = margin + i * colW
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(b.value, x, blockY, { align: 'center', maxWidth: colW - 4 })
    doc.setLineWidth(0.3)
    doc.line(x - colW / 2 + 6, blockY + 2, x + colW / 2 - 6, blockY + 2)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7.5)
    doc.setTextColor(90, 90, 90)
    doc.text(b.label, x, blockY + 6, { align: 'center' })
    doc.setTextColor(...BLACK)
  })
}

/**
 * `purchaseReceipts` — Active, CASH-paid PRs in the period only (the
 * caller filters by paymentMethod and status - see
 * CpfDisbursementExportModal.jsx), each already carrying the same
 * payee/classification/weight/cost snapshot fields
 * generateSdoAbstract expects (payeeName, payeeAddress, rsbsa, prNo,
 * wsrSerialNo, numberOfBags, classification, moistureContent,
 * purityMin/purityMax/purityLetter, grossKilos, sackKilos, netKilos,
 * enwFactor, enw, unitCost, totalAmount, date).
 * `ledgerEntries` — this SDO's non-voided cashLedgerV2 rows dated within
 * the period (type: 'replenish'|'liquidate', amount, refNo, date).
 * `openingBalance` — the running balance as of right before `dateFrom`
 * (same computeCashOnHand call the Abstract's own opening balance uses).
 * `purityDisplayFormat`: 'range' | 'letter'.
 * `officer`: { name, position } — the Accountable Officer identification
 * block; printed once, at the top of page 1 only.
 */
export const generateCpfDisbursementRecord = ({
  branchLabel, cityLabel, dateFrom, dateTo,
  purchaseReceipts, ledgerEntries, openingBalance, purityDisplayFormat = 'range', officer,
}) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] })
  const periodLabel = fmtPeriodLabel(dateFrom, dateTo)

  const purityText = (pr) => purityDisplayFormat === 'letter' ? (pr.purityLetter ?? '') : `${pr.purityMin ?? ''}–${pr.purityMax ?? ''}`

  // Merges PR rows and ledger-event rows into one chronological ledger.
  // Same-date tie-break: a ledger event (cash arriving/leaving the
  // advance itself) sorts before a same-day disbursement, so the
  // running balance narrative always reads as "funds available, then
  // spent" rather than briefly going negative on paper for a same-day
  // replenishment that actually happened first.
  const prEvents = purchaseReceipts.map((pr) => ({ kind: 'pr', date: pr.date, pr }))
  const ledgerEvents = ledgerEntries.map((e) => ({ kind: 'ledger', date: e.date, entry: e }))
  const events = [...ledgerEvents, ...prEvents].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'ledger' ? -1 : 1
    if (a.kind === 'pr') {
      const na = Number(a.pr.prNo), nb = Number(b.pr.prNo)
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
      return (a.pr.prNo ?? '').localeCompare(b.pr.prNo ?? '', undefined, { numeric: true })
    }
    return 0
  })

  const allDates = [dayBefore(dateFrom), ...events.map((e) => e.date)]
  const year = commonYear(allDates)
  const fmtRowDate = (iso) => (year ? fmtDateShort(iso) : fmtDateLong(iso))
  const dateHeader = year ? { content: `DATE\n${year}`, rowSpan: 2, styles: { valign: 'middle' } } : { content: 'DATE', rowSpan: 2, styles: { valign: 'middle' } }

  const head = [
    [
      dateHeader,
      { content: 'PR No.', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'WSR No.', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'NAME OF FARMER/\nADDRESS', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'RSBSA #', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'NATURE OF\nPAYMENT', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'CASH ADVANCE RECEIVED/\nREPLENISHMENT/LIQUIDATION', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'DISBURSEMENTS', colSpan: 11 },
      { content: 'CASH ADVANCE/\nFUND BALANCE', rowSpan: 2, styles: { valign: 'middle' } },
    ],
    [
      'NO. OF\nBAGS', 'VARIETY\nCODE', 'MC', 'PURITY', 'GROSS\nKG', 'MTS', 'Net kg',
      'ENW\nFACTOR', 'ENW kg', 'UNIT\nCOST', 'AMOUNT',
    ],
  ]

  // Running balance starts at openingBalance and is updated once per
  // event, in the already-sorted chronological order above - a
  // replenishment adds, a liquidation subtracts, a Cash disbursement
  // subtracts its own totalAmount, exactly mirroring computeCashOnHand's
  // own sign conventions (sdoCalculations.js).
  let running = openingBalance

  const openingRow = [
    { content: fmtRowDate(dayBefore(dateFrom)), styles: { fontStyle: 'bolditalic' } },
    '', '',
    { content: `Balance brought forward`, styles: { fontStyle: 'bolditalic', halign: 'left' } },
    '', '', '', '', '', '', '', '', '', '', '', '', '',
    { content: fmtPeso(running), styles: { fontStyle: 'bolditalic' } },
  ]
  const rowStyles = { fillColor: [245, 245, 245] }
  openingRow.forEach((cell, i) => {
    if (typeof cell === 'string') return
    openingRow[i] = { ...cell, styles: { ...rowStyles, ...cell.styles } }
  })

  const buildEventRow = (ev) => {
    if (ev.kind === 'ledger') {
      const e = ev.entry
      const isReplenish = e.type === 'replenish'
      const label = isReplenish
        ? `REPLENISHMENT OF CPF — Check No. ${e.refNo ?? ''}`
        : `PARTIAL LIQUIDATION PER OR# ${e.refNo ?? ''}`
      running += isReplenish ? (e.amount ?? 0) : -(e.amount ?? 0)
      return [
        fmtRowDate(e.date), '', '',
        { content: label, styles: { halign: 'left' } },
        '', '',
        fmtPeso(e.amount),
        '', '', '', '', '', '', '', '', '', '',
        fmtPeso(running),
      ]
    }
    const pr = ev.pr
    running -= pr.totalAmount ?? 0
    return [
      fmtRowDate(pr.date), (pr.prNo ?? '').toUpperCase(), (pr.wsrSerialNo ?? '').toUpperCase(),
      { content: `${(pr.payeeName ?? '').toUpperCase()}\n${(pr.payeeAddress ?? '').toUpperCase()}`, styles: { halign: 'left' } },
      (pr.rsbsa ?? '').toUpperCase(), 'CASH', '',
      fmtBags(pr.numberOfBags), baseVarietyCode(pr.classification).toUpperCase(),
      fmtKilos(pr.moistureContent, 1), purityText(pr).toUpperCase(),
      fmtKilos(pr.grossKilos), fmtKilos(pr.sackKilos), fmtKilos(pr.netKilos),
      pr.enwFactor?.toFixed(4) ?? '', fmtKilos(pr.enw, 4), fmtKilos(pr.unitCost, 2),
      fmtPeso(pr.totalAmount),
      fmtPeso(running),
    ]
  }

  const body = [openingRow, ...events.map(buildEventRow)]

  const totals = purchaseReceipts.reduce((a, pr) => ({
    bags: a.bags + (pr.numberOfBags ?? 0),
    gross: a.gross + (pr.grossKilos ?? 0),
    net: a.net + (pr.netKilos ?? 0),
    enw: a.enw + (pr.enw ?? 0),
    amount: a.amount + (pr.totalAmount ?? 0),
  }), { bags: 0, gross: 0, net: 0, enw: 0, amount: 0 })

  // TOTAL row only sums the DISBURSEMENTS group's own totalable columns
  // (bags, gross kg, net kg, enw kg, amount) - confirmed directly
  // against a real sample, which leaves MC/Purity/MTS/ENW Factor/Unit
  // Cost blank (rates, not totals) and the running-balance column blank
  // too (a sum of running balances is meaningless).
  const foot = [[
    { content: 'TOTAL', colSpan: 7 },
    fmtBags(totals.bags), '', '', '',
    fmtKilos(totals.gross), '', fmtKilos(totals.net),
    '', fmtKilos(totals.enw, 4), '',
    fmtPeso(totals.amount),
    '',
  ]]

  autoTable(doc, {
    startY: TABLE_START_Y,
    margin: { left: margin, right: margin, top: CONTINUATION_MARGIN_TOP },
    head,
    body,
    foot,
    showFoot: 'lastPage',
    theme: 'grid',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 7.5, textColor: BLACK, lineColor: [150, 150, 150], lineWidth: 0.1, cellPadding: 1.2, halign: 'center', valign: 'middle' },
    headStyles: { fillColor: HEADER_BG, textColor: BLACK, fontStyle: 'bold', fontSize: 7, halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [240, 240, 240], textColor: BLACK, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
    columnStyles: { 3: { cellWidth: 32 } },
    didDrawPage: (data) => drawHeader(doc, {
      branchLabel, cityLabel, periodLabel, officer,
      isFirstPage: data.pageNumber === 1,
    }),
  })

  const finalY = doc.lastAutoTable.finalY

  // CERTIFICATION block - one signature line only (the Accountable
  // Officer themselves), confirmed directly against a real sample: a
  // short certification sentence naming their designation and the
  // period, then a centered signature line with "Name and Signature" /
  // "Date" labels underneath, unlike the Abstract's three-column
  // Prepared/Verified/Noted By footer.
  let y = finalY + 14
  if (y + 30 > pageH - margin) {
    doc.addPage()
    drawHeader(doc, { branchLabel, cityLabel, periodLabel, officer, isFirstPage: false })
    y = CONTINUATION_MARGIN_TOP + 14
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('CERTIFICATION', pageW / 2, y, { align: 'center' })
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const certLine1 = 'I hereby certify that the foregoing is a correct and complete record of all cash advances received and'
  const certLine2 = `disbursements made by me in my capacity as ${(officer?.position || 'ACCOUNTABLE OFFICER').toUpperCase()} during the period from ${periodLabel.toUpperCase()}`
  const certLine3 = 'inclusive as indicated in the corresponding columns.'
  doc.text(certLine1, pageW / 2, y, { align: 'center' })
  doc.text(certLine2, pageW / 2, y + 5, { align: 'center' })
  doc.text(certLine3, pageW / 2, y + 10, { align: 'center' })

  const sigY = y + 28
  const sigW = 70
  const sigX = pageW / 2 - sigW / 2
  doc.setLineWidth(0.3)
  doc.line(sigX, sigY, sigX + sigW, sigY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text((officer?.name ?? '').toUpperCase(), pageW / 2, sigY - 2, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(90, 90, 90)
  doc.text('Name and Signature', pageW / 2, sigY + 5, { align: 'center' })
  doc.text('Date', pageW / 2, sigY + 14, { align: 'center' })
  doc.setTextColor(...BLACK)

  return doc
}
