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
// Per explicit request - a replenishment row's own text (matching the
// real paper record's own convention, confirmed directly against a
// sample).
const REPLENISH_BLUE = [37, 61, 173]
// 0.2in, tighter than the Abstract's 0.3in - this table's 19 columns
// need every bit of width they can get; every column width below is
// measured directly against the widest real string it actually has to
// hold (including bold SUB-TOTAL/TOTAL row variants), and even then
// only clears the available width by ~2mm at this margin.
const margin = 0.18 * 25.4
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
// Per explicit request: the month stacked above the day instead of side
// by side on one line - a narrower DATE column this way, freeing width
// for every other column that actually needed it (RSBSA, NATURE OF
// PAYMENT, AMOUNT, CASH ADVANCE/FUND BALANCE). The year, when every row
// shares one (the common case - see commonYear below), already lives in
// the column header, so stacking just needs Month/Day; a period that
// genuinely crosses a year boundary stacks "Mon D" over the year
// instead, so that information isn't lost.
const fmtDateStacked = (iso, yearInHeader) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return yearInHeader ? `${MONTHS[m - 1].slice(0, 3)}\n${d}` : `${MONTHS[m - 1].slice(0, 3)} ${d}\n${y}`
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

// Confirmed, reported real bug: an RSBSA number has no spaces at all
// (just hyphen-joined segments), and a real RSBSA column width - sized
// for the common case - is too narrow for every real format this app
// has actually seen (some provinces use a 3-digit code, some suffixes
// are alphanumeric, an FA's joined multi-member value can run even
// longer). jsPDF's own text wrapping only ever breaks at whitespace;
// with none in the string at all, it falls back to forcing a break at
// an arbitrary CHARACTER position instead, splitting a number or a
// code letter in half. A real space after every hyphen gives it a
// genuine place to break that only ever falls on a hyphen boundary -
// confirmed directly: the same real alphanumeric RSBSA that used to
// split as "05-005-07-043-Q1N" / "WAG" now breaks as "05- 005- 07-
// 043-" / "Q1NWAG" regardless of how narrow the column actually is.
const hyphenWrap = (s) => (s ?? '').replace(/-/g, '- ')

const fmtBags = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-PH'))
const fmtKilos = (n, d = 3) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d }))
const fmtPeso = (n) => (n == null ? '' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Confirmed, reported real bug (second correction - the first pass,
// 43, still read as too much space on a real export): every header gap
// is now built from this one shared unit instead of separately-guessed
// numbers, so "one row" means the same thing everywhere it's used -
// title block to officer block, officer block to the table on page 1,
// and title/period to the table on every continuation page.
const ROW_GAP = 5
const TITLE_END_Y = 23 // page 1's own last title line (cityLabel)
const BLOCK_Y = TITLE_END_Y + ROW_GAP // officer block's value line
const BLOCK_LABEL_OFFSET = 6 // label line sits this far below its own value line, inside the block
const TABLE_START_Y = BLOCK_Y + BLOCK_LABEL_OFFSET + ROW_GAP
const CONTINUATION_TITLE_END_Y = 15 // continuation page's own last title line (period)
const CONTINUATION_MARGIN_TOP = CONTINUATION_TITLE_END_Y + ROW_GAP

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
  doc.text((cityLabel ?? '').toUpperCase(), pageW / 2, TITLE_END_Y, { align: 'center' })

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
  blocks.forEach((b, i) => {
    // Confirmed, reported real bug: this was the column's own LEFT edge
    // (margin + i*colW), not its center - centering text ON a left edge
    // pushes half of it off the page to the left, clipping the first
    // block's own name ("JOSE..." printing as "...HINE M. ETCOY").
    const x = margin + i * colW + colW / 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(b.value, x, BLOCK_Y, { align: 'center', maxWidth: colW - 4 })
    doc.setLineWidth(0.3)
    doc.line(x - colW / 2 + 6, BLOCK_Y + 2, x + colW / 2 - 6, BLOCK_Y + 2)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7.5)
    doc.setTextColor(90, 90, 90)
    doc.text(b.label, x, BLOCK_Y + BLOCK_LABEL_OFFSET, { align: 'center' })
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
  const fmtRowDate = (iso) => fmtDateStacked(iso, Boolean(year))
  const dateHeader = year ? { content: `DATE\n${year}`, rowSpan: 2, styles: { valign: 'middle' } } : { content: 'DATE', rowSpan: 2, styles: { valign: 'middle' } }

  const head = [
    [
      dateHeader,
      { content: 'PR No.', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'WSR No.', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'NAME OF FARMER/\nADDRESS', rowSpan: 2, styles: { valign: 'middle' } },
      { content: 'RSBSA #', rowSpan: 2, styles: { valign: 'middle' } },
      // Confirmed, reported real bug: "NATURE OF" together (14.15mm
      // bold) is wider than "PAYMENT" alone (11.48mm) - a 2-line break
      // here still needed a wider column than the narrower single word
      // did, and the column was sized for the single word, forcing
      // "NATURE" and "PAYMENT" to each auto-wrap mid-word. 3 lines, one
      // word each, needs only as much width as the single longest word.
      { content: 'NATURE\nOF\nPAYMENT', rowSpan: 2, styles: { valign: 'middle' } },
      // Explicit 3-way break (not left to auto-wrap) - confirmed,
      // reported real bug: auto-wrapping "REPLENISHMENT/LIQUIDATION"
      // inside too narrow a column let a single stray letter ("N") spill
      // onto its own fourth line. Forcing the breaks at the "/"
      // boundaries, together with this column's own explicit cellWidth
      // below, keeps it to a clean 3 lines.
      { content: 'CASH ADVANCE RECEIVED/\nREPLENISHMENT/\nLIQUIDATION', rowSpan: 2, styles: { valign: 'middle' } },
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
  // own sign conventions (sdoCalculations.js). runningAfterRow[i] - the
  // balance immediately after body0[i] is processed - is captured
  // alongside each row so the per-page SUB-TOTAL/continuation rows below
  // can show the real balance at that exact point, not a meaningless sum
  // of running balances.
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
      // Per explicit request, a replenishment row's text prints in blue
      // - every cell, even blank ones, so the row reads as one
      // consistent color (a blank cell's own color never actually
      // shows, but keeping it uniform avoids any doubt).
      const replenishStyle = isReplenish ? { textColor: REPLENISH_BLUE } : {}
      const cell = (content, extra = {}) => ({ content, styles: { ...replenishStyle, ...extra } })
      return [
        cell(fmtRowDate(e.date)), cell(''), cell(''),
        cell(label, { halign: 'left' }),
        cell(''), cell(''),
        cell(fmtPeso(e.amount)),
        cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell(''),
        cell(fmtPeso(running)),
      ]
    }
    const pr = ev.pr
    running -= pr.totalAmount ?? 0
    return [
      fmtRowDate(pr.date), (pr.prNo ?? '').toUpperCase(), (pr.wsrSerialNo ?? '').toUpperCase(),
      { content: `${(pr.payeeName ?? '').toUpperCase()}\n${(pr.payeeAddress ?? '').toUpperCase()}`, styles: { halign: 'left' } },
      hyphenWrap((pr.rsbsa ?? '').toUpperCase()), 'CASH', '',
      fmtBags(pr.numberOfBags), baseVarietyCode(pr.classification).toUpperCase(),
      fmtKilos(pr.moistureContent, 1), purityText(pr).toUpperCase(),
      fmtKilos(pr.grossKilos), fmtKilos(pr.sackKilos), fmtKilos(pr.netKilos),
      pr.enwFactor?.toFixed(4) ?? '', fmtKilos(pr.enw, 4), fmtKilos(pr.unitCost, 2),
      fmtPeso(pr.totalAmount),
      fmtPeso(running),
    ]
  }

  const runningAfterRow = [openingBalance]
  const rowMeta0 = [{ type: 'opening' }]
  const body0 = [openingRow]
  for (const ev of events) {
    body0.push(buildEventRow(ev))
    runningAfterRow.push(running)
    rowMeta0.push({ type: ev.kind, ev })
  }

  // Sums only the real PR (disbursement) rows in `metas` - a ledger
  // event or the opening-balance row never contributes to the
  // DISBURSEMENTS totals, only to the running balance itself.
  const sumPrTotals = (metas) => metas.filter((m) => m.type === 'pr').reduce((a, m) => ({
    bags: a.bags + (m.ev.pr.numberOfBags ?? 0),
    gross: a.gross + (m.ev.pr.grossKilos ?? 0),
    net: a.net + (m.ev.pr.netKilos ?? 0),
    enw: a.enw + (m.ev.pr.enw ?? 0),
    amount: a.amount + (m.ev.pr.totalAmount ?? 0),
  }), { bags: 0, gross: 0, net: 0, enw: 0, amount: 0 })

  const totals = sumPrTotals(rowMeta0)
  // Every real (non-spacer) row in body0 strictly before
  // `uptoIndexExclusive` - i.e. everything already printed on earlier
  // pages by the time a given page's own opening index is reached. Same
  // "per-page call, per-page SUB-TOTAL" approach sdoAbstractPdfGenerator
  // uses - see that file's own top comment for the full reasoning and
  // the real jspdf-autotable pagination bug it works around.
  const cumulativeThrough = (uptoIndexExclusive) => sumPrTotals(rowMeta0.slice(0, uptoIndexExclusive))

  // Shared cell shape for TOTAL/SUB-TOTAL - `runningBalance` is null for
  // the real TOTAL row (a SUM of running balances is meaningless, so it
  // stays blank, confirmed directly against a real sample) and the
  // actual balance at that point for a SUB-TOTAL/continuation row (which
  // genuinely needs to carry that figure forward across the page break).
  const buildTotalsRowCells = (t, runningBalance) => [
    fmtBags(t.bags), '', '', '',
    fmtKilos(t.gross), '', fmtKilos(t.net),
    '', fmtKilos(t.enw, 4), '',
    fmtPeso(t.amount),
    runningBalance == null ? '' : fmtPeso(runningBalance),
  ]

  // TOTAL row only sums the DISBURSEMENTS group's own totalable columns
  // (bags, gross kg, net kg, enw kg, amount) - confirmed directly
  // against a real sample, which leaves MC/Purity/MTS/ENW Factor/Unit
  // Cost blank (rates, not totals).
  const foot = [[{ content: 'TOTAL', colSpan: 7 }, ...buildTotalsRowCells(totals, null)]]

  const lastColIndex = 18 // DATE..RSBSA(5) + NATURE+CASH ADV RECEIVED(2) + 11 DISBURSEMENTS cols + balance = 19 cols, 0-indexed
  const CONTINUATION_STYLES = { fontStyle: 'bolditalic', fillColor: [240, 240, 240] }
  const buildContinuationRow = (t, runningBalance) => [
    { content: 'SUB-TOTAL', colSpan: 7, styles: CONTINUATION_STYLES },
    ...buildTotalsRowCells(t, runningBalance).map((content) => ({ content, styles: CONTINUATION_STYLES })),
  ]

  // Per explicit request: GROSS KG through CASH ADVANCE/FUND BALANCE
  // (columns 11-18), plus CASH ADVANCE RECEIVED/REPLENISHMENT/
  // LIQUIDATION (6), right-aligned instead of the default center -
  // numbers read far more naturally lining up on their decimal point.
  const RIGHT_ALIGN_COLS = new Set([6, 11, 12, 13, 14, 15, 16, 17, 18])
  // Confirmed, reported real bug: every column except 3 and 6 was left
  // to autoTable's own 'auto' width - computed independently PER CALL
  // from whatever rows that specific call happened to receive, since
  // this report is one autoTable() call per page (not one call for the
  // whole document). Two calls with different row content can and did
  // land on visibly different column widths, so the table no longer
  // lined up from one page to the next. Giving every column an explicit
  // cellWidth removes content from the width calculation entirely - the
  // same fixed widths are used regardless of which rows a given page's
  // call happens to carry, so every page is pixel-identical.
  // Confirmed, reported real overflow warnings - measured directly with
  // doc.getTextWidth() rather than guessed, against the two actual
  // culprits: a full RSBSA string ("05-05-10-017-000045", one
  // unbreakable hyphenated token, no spaces to wrap at) measures ~25.3mm
  // at this table's own font/size, wider than the 22mm column 4 was
  // given; column 6's own header text "CASH ADVANCE RECEIVED/" (its own
  // first forced line) measures ~33.5mm bold, leaving almost no margin
  // against a 36mm column once cellPadding is subtracted. Both widened
  // with real headroom this time, not another guess.
  // Every width below was checked against doc.getTextWidth() for the
  // actual longest real string that column has to hold - including the
  // BOLD TOTAL/SUB-TOTAL row variants, which run measurably wider than
  // the same figure in a plain body row and were the source of several
  // of the overflow warnings this set went through (e.g. a 4-decimal
  // ENW kg SUB-TOTAL, or the WSR No. column's own 8-digit values, were
  // never checked against their real content the first few times this
  // was sized by eye).
  // Isolated directly with a placeholder-content render: once every
  // column has its own explicit cellWidth (none left 'auto'),
  // autoTable's own default width mode still tries to STRETCH the table
  // to fill the full page and logs a benign "X units width could not
  // fit page" warning when it can't cleanly redistribute the leftover
  // slack among already-fixed columns - not an actual content-clipping
  // bug (reproduced with trivial single-character cells, nothing to do
  // with real content width). tableWidth: 'wrap' below (not used until
  // now) tells it to just use these widths exactly instead of trying to
  // stretch them, which removes the warning entirely.
  // The actual source of every remaining overflow warning, found by
  // isolating it to a placeholder BODY with the REAL multi-row head:
  // the two-line column sub-headers ("VARIETY\nCODE", "NO. OF\nBAGS",
  // "ENW\nFACTOR", a single-line "PURITY") are each wider, on their own
  // longest line, than the narrow numeric columns they were first
  // given - "VARIETY" alone needs ~13.9mm, not the ~9mm a "PD1"-sized
  // body value suggested. Every width below is now checked against
  // BOTH its header's own longest line and its widest real body value.
  // Confirmed, reported real bugs against actual production data (much
  // larger figures and messier real-world formats than the test
  // dataset this was first tuned against): AMOUNT/BALANCE needed more
  // room for genuine 7-8 digit running totals, RSBSA needed real
  // headroom for 3-digit province codes and alphanumeric suffixes (see
  // hyphenWrap's own comment for the rest of that fix), and the DATE
  // column shrinks now that its value stacks Month over Day instead of
  // sitting side by side on one line - freeing width for everything
  // that actually needed it.
  const columnStyles = {
    0: { cellWidth: 10 }, // DATE (stacked Month/Day) - "DATE" header itself needs ~6.5mm bold
    1: { cellWidth: 13 }, // PR No.
    2: { cellWidth: 15 }, // WSR No.
    3: { cellWidth: 25, halign: 'left' }, // NAME OF FARMER/ADDRESS
    4: { cellWidth: 26 }, // RSBSA # (hyphenWrap handles the rest)
    5: { cellWidth: 15 }, // NATURE OF PAYMENT (3-line header)
    6: { cellWidth: 37, halign: 'right' }, // CASH ADVANCE RECEIVED/...
    7: { cellWidth: 12 }, // NO. OF BAGS
    8: { cellWidth: 13 }, // VARIETY CODE
    9: { cellWidth: 8 }, // MC
    10: { cellWidth: 12 }, // PURITY
    11: { cellWidth: 18, halign: 'right' }, // GROSS KG
    12: { cellWidth: 11 }, // MTS
    13: { cellWidth: 18, halign: 'right' }, // Net kg
    14: { cellWidth: 13 }, // ENW FACTOR
    15: { cellWidth: 19, halign: 'right' }, // ENW kg
    16: { cellWidth: 10 }, // UNIT COST
    17: { cellWidth: 20, halign: 'right' }, // AMOUNT
    18: { cellWidth: 25, halign: 'right' }, // CASH ADVANCE/FUND BALANCE
  }
  const sharedTableOptions = {
    margin: { left: margin, right: margin, top: CONTINUATION_MARGIN_TOP },
    head,
    theme: 'grid',
    rowPageBreak: 'avoid',
    tableWidth: 'wrap',
    styles: { font: 'helvetica', fontSize: 7.5, textColor: BLACK, lineColor: [150, 150, 150], lineWidth: 0.1, cellPadding: 1.2, halign: 'center', valign: 'middle' },
    headStyles: { fillColor: HEADER_BG, textColor: BLACK, fontStyle: 'bold', fontSize: 7, halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [240, 240, 240], textColor: BLACK, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
    columnStyles,
  }

  // PASS 1 - throwaway measurement renders (discarded jsPDF instances)
  // purely to learn where autoTable's own layout engine will actually
  // put each page break. Confirmed, reported real bug: an earlier
  // version measured ONCE against body0 with no continuation rows ever
  // spliced in, then reused those same breakpoints for the real
  // per-page render where pages 2+ DO carry an extra continuation row -
  // a page measured as exactly full choked on that one extra row and
  // silently overflowed onto an unplanned second page within that same
  // per-page autoTable() call, corrupting that page's own SUB-TOTAL
  // (financial data - this is not a cosmetic risk). Now measures one
  // page at a time, starting fresh from wherever the previous page
  // ended and including the REAL continuation row that page would
  // actually carry, so every page boundary already accounts for it.
  const pageStartIndices = [0]
  {
    let cursor = 0
    while (cursor < body0.length) {
      const isFirstChunk = cursor === 0
      const prefix = isFirstChunk ? [] : [buildContinuationRow(cumulativeThrough(cursor), runningAfterRow[cursor - 1])]
      const measureDoc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] })
      let overflowIndex = null
      autoTable(measureDoc, {
        ...sharedTableOptions,
        startY: isFirstChunk ? TABLE_START_Y : CONTINUATION_MARGIN_TOP,
        body: [...prefix, ...body0.slice(cursor)],
        didDrawCell: (data) => {
          if (data.section !== 'body' || data.column.index !== 0) return
          const pageNum = measureDoc.internal.getCurrentPageInfo().pageNumber
          // data.row.index is relative to [...prefix, ...rest] - map back
          // to body0's own index space, and only the FIRST row that lands
          // on page 2 of this measurement matters (that's where THIS
          // page's own content actually has to stop).
          if (pageNum === 2 && overflowIndex === null) {
            overflowIndex = cursor + (data.row.index - prefix.length)
          }
        },
      })
      cursor = overflowIndex ?? body0.length
      if (cursor < body0.length) pageStartIndices.push(cursor)
    }
  }

  // PASS 2 - the real render, one autoTable() call per page (see
  // sdoAbstractPdfGenerator.js's own top comment for why a single call
  // relying on autoTable's own pagination can't reliably place a
  // continuation row on the right page).
  const columnX = new Map()
  let footRowHeight = 7.66
  let mainFinalY = 0
  let cumulative = { bags: 0, gross: 0, net: 0, enw: 0, amount: 0 }

  pageStartIndices.forEach((rangeStart, pageIdx) => {
    const isFirstPage = pageIdx === 0
    const isLastPage = pageIdx === pageStartIndices.length - 1
    const rangeEnd = pageIdx + 1 < pageStartIndices.length ? pageStartIndices[pageIdx + 1] : body0.length
    const pageRowsMeta = rowMeta0.slice(rangeStart, rangeEnd)
    const pageBody = body0.slice(rangeStart, rangeEnd)
    const chunkBody = isFirstPage
      ? pageBody
      : [buildContinuationRow(cumulativeThrough(rangeStart), runningAfterRow[rangeStart - 1]), ...pageBody]

    let bottomY = 0
    autoTable(doc, {
      ...sharedTableOptions,
      // Confirmed, reported real bug: passing the full-page-1 startY
      // (43, reserved for the officer identification block) on EVERY
      // per-page call - not just the first - left a large, pointless
      // gap at the top of every continuation page, since each is its
      // own separate autoTable() call and startY governs where ITS OWN
      // first page starts regardless of pageBreak:'always'. Only page 1
      // reserves that much room; continuation pages fall back to
      // margin.top (CONTINUATION_MARGIN_TOP) instead, same as the old
      // single-call version already did correctly.
      ...(isFirstPage ? { startY: TABLE_START_Y } : {}),
      body: chunkBody,
      ...(isLastPage ? { foot, showFoot: 'lastPage' } : {}),
      ...(isFirstPage ? {} : { pageBreak: 'always' }),
      didDrawPage: () => drawHeader(doc, { branchLabel, cityLabel, periodLabel, officer, isFirstPage }),
      didDrawCell: (data) => {
        if (data.section === 'head') columnX.set(data.column.index, { x: data.cell.x, width: data.cell.width })
        if (data.section === 'foot') footRowHeight = data.cell.height
        if (data.section === 'body') bottomY = Math.max(bottomY, data.cell.y + data.cell.height)
      },
    })

    mainFinalY = doc.lastAutoTable.finalY

    const pageOwnTotals = sumPrTotals(pageRowsMeta)
    cumulative = {
      bags: cumulative.bags + pageOwnTotals.bags,
      gross: cumulative.gross + pageOwnTotals.gross,
      net: cumulative.net + pageOwnTotals.net,
      enw: cumulative.enw + pageOwnTotals.enw,
      amount: cumulative.amount + pageOwnTotals.amount,
    }

    // Draws this page's own running SUB-TOTAL row by hand against this
    // call's own captured column x/width, same approach (and same
    // reasoning) as sdoAbstractPdfGenerator.js's identical block.
    if (!isLastPage) {
      const runningAtPageEnd = runningAfterRow[rangeEnd - 1]
      const subtotalCells = [{ content: 'SUB-TOTAL', colSpan: 7 }, ...buildTotalsRowCells(cumulative, runningAtPageEnd)]
      const rowY = bottomY
      const rowH = footRowHeight

      doc.setFillColor(240, 240, 240)
      doc.rect(margin, rowY, pageW - margin * 2, rowH, 'F')
      doc.setDrawColor(150, 150, 150)
      doc.setLineWidth(0.1)
      doc.setFont('helvetica', 'bolditalic')
      doc.setFontSize(7.5)
      doc.setTextColor(...BLACK)

      let colIndex = 0
      for (const cellItem of subtotalCells) {
        const span = (typeof cellItem === 'object' && cellItem.colSpan) || 1
        const text = typeof cellItem === 'object' ? cellItem.content : cellItem
        const first = columnX.get(colIndex)
        let w = 0
        for (let s = 0; s < span; s++) w += columnX.get(colIndex + s)?.width ?? 0
        if (first) {
          doc.line(first.x, rowY, first.x, rowY + rowH)
          if (text !== '') {
            if (RIGHT_ALIGN_COLS.has(colIndex)) {
              doc.text(String(text), first.x + w - 1.5, rowY + rowH / 2 + 1.5, { align: 'right' })
            } else {
              doc.text(String(text), first.x + w / 2, rowY + rowH / 2 + 1.5, { align: 'center' })
            }
          }
        }
        colIndex += span
      }
      const lastCol = columnX.get(lastColIndex)
      if (lastCol) doc.line(lastCol.x + lastCol.width, rowY, lastCol.x + lastCol.width, rowY + rowH)
      doc.line(margin, rowY, pageW - margin, rowY)
      doc.line(margin, rowY + rowH, pageW - margin, rowY + rowH)
    }
  })

  const finalY = mainFinalY

  // CERTIFICATION block - one signature line only (the Accountable
  // Officer themselves), confirmed directly against a real sample: a
  // short certification sentence naming their designation and the
  // period, then a centered signature line with "Name and Signature" /
  // "Date" labels underneath, unlike the Abstract's three-column
  // Prepared/Verified/Noted By footer.
  // Confirmed, reported real bug (correction to an earlier change):
  // the gap above CERTIFICATION only needs to read as roughly one
  // table row's worth of space, not the much larger gap +14 produced.
  let y = finalY + 8
  if (y + 30 > pageH - margin) {
    doc.addPage()
    drawHeader(doc, { branchLabel, cityLabel, periodLabel, officer, isFirstPage: false })
    y = CONTINUATION_MARGIN_TOP + 8
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
  // Confirmed, reported missing: a second signature-style line for the
  // Date itself, same shape as the Name/Signature line above it
  // (shorter, since a date needs far less room) - was just the label
  // with nothing to actually sign on.
  const dateLineY = sigY + 12
  const dateLineW = 30
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.3)
  doc.line(pageW / 2 - dateLineW / 2, dateLineY, pageW / 2 + dateLineW / 2, dateLineY)
  doc.text('Date', pageW / 2, dateLineY + 5, { align: 'center' })
  doc.setTextColor(...BLACK)

  return doc
}
