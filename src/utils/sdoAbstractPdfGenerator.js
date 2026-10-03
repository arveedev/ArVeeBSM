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
// 0.3in (was 12mm/~0.47in) - per explicit request, a tighter page
// margin frees up more width for the actual report content, same
// in-to-mm conversion already used for the page dimensions below.
const margin = 0.3 * 25.4
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

// Per explicit request, Equivalent Net Weight is always 4 decimals
// everywhere on this export - the old factor-dependent 3-vs-4 split
// (this local copy, and sdoCalculations.js's own enwDecimalsForFactor)
// no longer applies here.

// Page 1's table content starts at TABLE_START_Y (36) to clear the full
// org identity block. A continuation page's much shorter header (title/
// period only, per explicit request) needs far less room - reusing the
// same 36mm reservation left a large, pointless blank gap at the top of
// every continuation page, which is real usable space wasted on every
// single page after the first (confirmed, reported: this was pushing
// the signature block onto a 3rd page that shouldn't have been needed).
// CONTINUATION_MARGIN_TOP is that page-break-time reservation instead -
// separate from TABLE_START_Y because jspdf-autotable itself treats
// them as two different things: `startY` only ever applies to the very
// first page a table appears on, while `margin.top` is what every
// LATER internal page break resumes content at - exactly the lever
// needed to give page 1 and continuation pages two different header
// heights within the same single autoTable() call.
// Extra blank space above everything on EVERY page (title block, table,
// continuation pages) so the printed report can be punched and filed
// without cutting into content - 0.5 inch (12.7mm), per explicit request
// (1 inch was tried first and judged too large).
const TOP_FILING_MARGIN = 12.7
const TABLE_START_Y = 36 + TOP_FILING_MARGIN
const CONTINUATION_MARGIN_TOP = 20 + TOP_FILING_MARGIN

// isFirstPage - per explicit request, a continuation page (2nd onward)
// only needs the report title/period, not the full org identity block
// (NATIONAL FOOD AUTHORITY/branch) and its divider line - that only
// needs to appear once. Positioned to fit within CONTINUATION_MARGIN_TOP
// above (with the same ~2mm clearance page 1's own header keeps before
// its table starts), not at the same y as page 1's title - it's sitting
// in a much shorter reserved space now, not the same slot.
const drawBranchHeader = (doc, { branchLabel, periodLabel, isFirstPage = true }) => {
  doc.setTextColor(...BLACK)
  if (isFirstPage) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('NATIONAL FOOD AUTHORITY', pageW / 2, 12 + TOP_FILING_MARGIN, { align: 'center' })
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text((branchLabel ?? '').toUpperCase(), pageW / 2, 17 + TOP_FILING_MARGIN, { align: 'center' })
    // Rule between the org block and the report title - present on the
    // reference layout, missing here before.
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.3)
    doc.line(margin, 20 + TOP_FILING_MARGIN, pageW - margin, 20 + TOP_FILING_MARGIN)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('ABSTRACT OF CEREAL PURCHASES', pageW / 2, 26 + TOP_FILING_MARGIN, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`FOR THE PERIOD ${periodLabel.toUpperCase()}`, pageW / 2, 31 + TOP_FILING_MARGIN, { align: 'center' })
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('ABSTRACT OF CEREAL PURCHASES', pageW / 2, 10 + TOP_FILING_MARGIN, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`FOR THE PERIOD ${periodLabel.toUpperCase()}`, pageW / 2, 15 + TOP_FILING_MARGIN, { align: 'center' })
  }
}

/**
 * `purchaseReceipts` — every Active PR in the period, each already
 * carrying its own snapshot of payee/classification/weight/cost fields
 * (see PurchaseReceiptModal.jsx's handleIssue - a PR never re-reads
 * live data after being issued, so a later Buying Price or variety
 * edit can't silently reshape an already-issued document).
 * `purityDisplayFormat`: 'range' | 'letter'.
 * `reconciliation`: { fundBalanceLabel, fundBalance, addEntries: [{label, amount}], lessEntries: [{label, amount}], totalLabel } - fundBalanceLabel defaults to 'COH — Fund Balance', totalLabel to 'TOTAL', if not given.
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
  const dateHeader = year ? { content: `DATE\n${year}`, styles: { valign: 'middle' } } : 'DATE'
  const fmtRowDate = (iso) => (year ? fmtDateShort(iso) : fmtDateLong(iso))

  // The BN/SH mark is deliberately NOT a table column - "must not be in
  // a table, just a text on that side" - tracked in its own array by
  // row index and drawn just past the table's right edge via
  // didDrawCell below, instead. Padded with one blank entry on each end
  // to stay aligned with body's own leading/trailing spacer rows below
  // (a blank mark is a no-op - didDrawCell's `if (!mark) return` guard
  // already skips it). Re-padded with one more blank per inserted
  // BROUGHT FORWARD row further below, so it always stays aligned to
  // the augmented body actually rendered.
  const marks0 = ['', ...purchaseReceipts.map((pr) => (pr.mtsCondition ?? '').toLowerCase()), '']

  // Column order per explicit request: Address comes right after the
  // farmer's name, RSBSA after Address (was Name -> RSBSA -> Address).
  // "Sack" (the Gross/Sack/Net weight split, not a sack-type count)
  // relabeled to "MTS" per explicit request.
  //
  // Basic Cost is only meaningfully DIFFERENT from Total Amount when
  // Pricer adds something on top of it - "the basic cost is part of
  // the pricers" - so with Pricer disabled it's the same figure as
  // Total Amount twice over, and the column is dropped entirely rather
  // than repeat it.
  const head = [[
    dateHeader, 'WHSE', 'NAME OF FARMER', 'ADDRESS', 'RSBSA NO.', 'PR NO.', 'WSR NO.', 'QTY BAGS', 'VARIETY', 'MC', 'PUR.',
    'GROSS', 'MTS', 'NET WT', 'ENW FACTOR', 'EQUIV. NET WT.', 'UNIT COST',
    ...(pricerEnabled ? ['BASIC COST', 'RATE', 'AMOUNT'] : []),
    'TOTAL AMOUNT',
  ]]

  // A blank row - one before the first real transaction row and one
  // right before TOTAL (appended as the body's own last row, since
  // TOTAL itself is the table's `foot`, drawn immediately after the
  // body) - visually separating the header/TOTAL from the actual
  // transaction rows. Keeps the grid's normal border (a real bug in the
  // first version of this: `lineWidth: 0` blanked the row's own border
  // entirely, leaving a gap with no outline instead of a clean empty
  // row that still reads as part of the table).
  const spacerRow = head[0].map(() => ({
    content: '', styles: { minCellHeight: 3, cellPadding: 0 },
  }))

  // A Cancelled PR (either voided after issuance, or pre-registered as
  // skipped via "Void PR Number" with no real farmer/weight data behind
  // it at all) still prints its own row - per explicit request, "it is
  // enough that the cancelled series appears" - so a gap in the PR
  // Number sequence is always explained, never silently invisible. Every
  // field but the date and PR No. itself is blank, and the word
  // CANCELLED replaces the farmer name, matching the same convention
  // the main NFA stock report already uses for a voided WSR/WSI row.
  const isCancelled = (pr) => pr.status === 'Cancelled'
  const buildPrRow = (pr) => isCancelled(pr) ? [
    fmtRowDate(pr.date), (pr.warehouseCode ?? '').toUpperCase(), 'CANCELLED',
    '', '', (pr.prNo ?? '').toUpperCase(), '', '', '', '', '', '', '', '', '', '', '',
    ...(pricerEnabled ? ['', '', ''] : []),
    '',
  ] : [
    fmtRowDate(pr.date), (pr.warehouseCode ?? '').toUpperCase(), (pr.payeeName ?? '').toUpperCase(),
    (pr.payeeAddress ?? '').toUpperCase(), (pr.rsbsa ?? '').toUpperCase(),
    (pr.prNo ?? '').toUpperCase(), (pr.wsrSerialNo ?? '').toUpperCase(), fmtBags(pr.numberOfBags),
    // Per explicit request, MC always shows one decimal even for a
    // whole number (14 -> "14.0") - fmtKilos already supports a
    // decimal-count override, reused here rather than a new helper.
    baseVarietyCode(pr.classification).toUpperCase(), fmtKilos(pr.moistureContent, 1), purityText(pr).toUpperCase(),
    fmtKilos(pr.grossKilos), fmtKilos(pr.sackKilos), fmtKilos(pr.netKilos),
    pr.enwFactor?.toFixed(4) ?? '', fmtKilos(pr.enw, 4), fmtKilos(pr.unitCost, 2),
    ...(pricerEnabled ? [fmtPeso(pr.basicCost), fmtKilos(pr.pricerRate, 2), fmtPeso(pr.pricerAmount)] : []),
    fmtPeso(pr.totalAmount),
  ]
  const body0 = purchaseReceipts.map(buildPrRow)
  body0.unshift(spacerRow)
  body0.push(spacerRow)

  // Parallel to body0 (and, after insertion below, to the augmented
  // body actually rendered) - lets every later step (SUB-TOTAL/BROUGHT
  // FORWARD totals, the BN/SH mark) look up what a given rendered row
  // actually IS by type, instead of the old `purchaseReceipts[rowIndex
  // - 1]` arithmetic, which only worked because body0 had a fixed,
  // predictable shape (exactly one spacer row on each end). Inserting a
  // BROUGHT FORWARD row per page break (see below) breaks that fixed
  // arithmetic entirely - this is what keeps every downstream lookup
  // correct regardless of how many rows get inserted, and where.
  const rowMeta0 = [{ type: 'spacer' }, ...purchaseReceipts.map((pr) => ({ type: 'pr', pr })), { type: 'spacer' }]

  // Cancelled rows never had real weights/costs to begin with, so they
  // contribute nothing to any total - same isCountable-style exclusion
  // the main NFA stock report already applies to its own cancelled rows.
  const sumPrTotals = (prs) => prs.filter((pr) => !isCancelled(pr)).reduce((a, pr) => ({
    bags: a.bags + (pr.numberOfBags ?? 0),
    gross: a.gross + (pr.grossKilos ?? 0),
    sack: a.sack + (pr.sackKilos ?? 0),
    net: a.net + (pr.netKilos ?? 0),
    enw: a.enw + (pr.enw ?? 0),
    basic: a.basic + (pr.basicCost ?? 0),
    pricer: a.pricer + (pr.pricerAmount ?? 0),
    total: a.total + (pr.totalAmount ?? 0),
  }), { bags: 0, gross: 0, sack: 0, net: 0, enw: 0, basic: 0, pricer: 0, total: 0 })
  const totals = sumPrTotals(purchaseReceipts)

  // Shared shape for every totals-style row (TOTAL/SUB-TOTAL/BROUGHT
  // FORWARD all print the exact same column layout, just with a
  // different label and figures) - factored out so the three stay
  // provably in sync instead of three hand-copied column lists that
  // could drift apart.
  const buildTotalsRowCells = (t) => [
    fmtBags(t.bags), '', '', '',
    fmtKilos(t.gross), fmtKilos(t.sack), fmtKilos(t.net),
    '', fmtKilos(t.enw, 4), '',
    ...(pricerEnabled ? [fmtPeso(t.basic), '', fmtPeso(t.pricer)] : []),
    fmtPeso(t.total),
  ]

  const foot = [[{ content: 'TOTAL', colSpan: 7 }, ...buildTotalsRowCells(totals)]]

  const lastColIndex = head[0].length - 1

  // Confirmed, reported real bug: a row that didn't fully fit at the
  // bottom of a page used to get SPLIT across the page break (autoTable's
  // default rowPageBreak: 'auto') - the whole row now moves to the next
  // page instead, never dividing a single farmer's data across two
  // pages.
  const sharedTableOptions = {
    startY: TABLE_START_Y,
    margin: { left: margin, right: margin, top: CONTINUATION_MARGIN_TOP },
    head,
    foot,
    showFoot: 'lastPage',
    theme: 'grid',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 8, textColor: BLACK, lineColor: [150, 150, 150], lineWidth: 0.1, cellPadding: 1.3, halign: 'center' },
    headStyles: { fillColor: HEADER_BG, textColor: BLACK, fontStyle: 'bold', fontSize: 7.5, halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [240, 240, 240], textColor: BLACK, fontStyle: 'bold', fontSize: 8, halign: 'center' },
    // Col 2 Name of Farmer, col 3 Address - both left-aligned. Col 4
    // RSBSA NO. gets a fixed, modest cellWidth - per explicit feedback,
    // an FA row's now-multi-value RSBSA ("A / B") was left to
    // auto-size and ate up disproportionate space, squeezing every
    // other column. Constrained width wraps a multi-value RSBSA onto a
    // second line (autoTable's default overflow behavior) rather than
    // stretching the column - a plain single-value RSBSA still fits on
    // one line comfortably at this width.
    columnStyles: { 2: { halign: 'left' }, 3: { halign: 'left' }, 4: { cellWidth: 26 } },
  }

  // PASS 1 - a throwaway measurement render (discarded jsPDF instance,
  // never shown to the user) using body0, purely to learn where
  // autoTable's own layout engine will actually put each page break.
  // This has to be a real render, not an estimate - the real column
  // widths/wrapping/row heights are exactly what decide where a page
  // fills up, and nothing short of actually laying it out predicts that
  // reliably.
  //
  // Confirmed, reported real bug (direct correction with a real
  // screenshot): the first version of this fed the discovered break
  // index straight back into ONE single augmented `body` array (with a
  // continuation row spliced in) and let autoTable's OWN pagination
  // place it - relying on jspdf-autotable's per-cell `styles.pageBreak`
  // to force it onto the right page. That style key does not exist -
  // jspdf-autotable only reads `pageBreak` as a whole-TABLE option,
  // never per-row/per-cell - so it was silently ignored, and the
  // continuation row (short, mostly-blank) kept fitting into whatever
  // slack space was left at the bottom of the PREVIOUS page even when
  // the real, taller (wrapped-text) row that belonged there next
  // couldn't - landing it on the wrong page every time real data (with
  // varying row heights) was used, exactly as reported.
  //
  // Fixed by splitting the real render into one autoTable() CALL PER
  // PAGE instead of one call for the whole document: each page's own
  // slice of body0 (known exactly from this measurement pass) becomes
  // its own call, and every call after the first passes the table-level
  // `pageBreak: 'always'` option - confirmed, from jspdf-autotable's own
  // source, to unconditionally start a fresh page before that call
  // draws anything, with no space-fitting judgment call involved at
  // all. This is the actual, real mechanism the previous attempt was
  // trying to reach for.
  const pageStartIndices = []
  {
    const measureDoc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] })
    const firstRowIndexByPage = new Map()
    autoTable(measureDoc, {
      ...sharedTableOptions,
      body: body0,
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const pageNum = measureDoc.internal.getCurrentPageInfo().pageNumber
        if (!firstRowIndexByPage.has(pageNum)) firstRowIndexByPage.set(pageNum, data.row.index)
      },
    })
    const measuredPages = [...firstRowIndexByPage.keys()].sort((a, b) => a - b)
    for (const pageNum of measuredPages) pageStartIndices.push(firstRowIndexByPage.get(pageNum))
  }

  // Totals of every real (non-spacer) row in body0 strictly before
  // `uptoIndexExclusive` - i.e. everything already printed on earlier
  // pages by the time this page's own opening index is reached, the
  // exact figure its own continuation row is supposed to carry.
  const cumulativeThrough = (uptoIndexExclusive) => {
    const prs = []
    for (let i = 0; i < uptoIndexExclusive; i++) {
      const meta = rowMeta0[i]
      if (meta.type === 'pr') prs.push(meta.pr)
    }
    return sumPrTotals(prs)
  }

  // Per explicit correction, labeled the same "SUB-TOTAL" as the row at
  // the bottom of the previous page - the exact same figure, carried
  // onto the next page, not a separately-worded "BROUGHT FORWARD" line.
  const CONTINUATION_STYLES = { fontStyle: 'bolditalic', fillColor: [240, 240, 240] }
  const buildContinuationRow = (t) => [
    { content: 'SUB-TOTAL', colSpan: 7, styles: CONTINUATION_STYLES },
    ...buildTotalsRowCells(t).map((content) => ({ content, styles: CONTINUATION_STYLES })),
  ]

  // PASS 2 - the real render, on the real `doc`, one autoTable() call
  // per page (see this whole section's opening comment for why).
  const columnX = new Map() // colIndex -> { x, width } - captured once, from any call's head row (identical column config every time)
  let footRowHeight = 7.66 // cellPadding(1.3)*2 + fontSize(8)*~1.15 - fallback only, overwritten by the real foot row's own height below
  let mainFinalY = 0
  let cumulative = { bags: 0, gross: 0, sack: 0, net: 0, enw: 0, basic: 0, pricer: 0, total: 0 }

  pageStartIndices.forEach((rangeStart, pageIdx) => {
    const isFirstPage = pageIdx === 0
    const isLastPage = pageIdx === pageStartIndices.length - 1
    const rangeEnd = pageIdx + 1 < pageStartIndices.length ? pageStartIndices[pageIdx + 1] : body0.length
    const pageRowsMeta = rowMeta0.slice(rangeStart, rangeEnd)
    const pageBody = body0.slice(rangeStart, rangeEnd)
    const pageMarks = marks0.slice(rangeStart, rangeEnd)
    const chunkBody = isFirstPage ? pageBody : [buildContinuationRow(cumulativeThrough(rangeStart)), ...pageBody]
    const chunkMarks = isFirstPage ? pageMarks : ['', ...pageMarks]

    let bottomY = 0
    autoTable(doc, {
      ...sharedTableOptions,
      body: chunkBody,
      // Per explicit request: a page that this table overflows onto
      // used to show the FULL grand total on every page (autoTable's
      // default `foot` behavior repeats it, same as `head`) - the real
      // grand TOTAL only ever prints once now, attached to just the
      // true last page's own call.
      // sharedTableOptions carries `foot` (needed for the measurement pass),
      // and autoTable reserves room for - and draws - a foot at the end of
      // EVERY call that has one, so a non-last page's call used to try to
      // fit the grand TOTAL row too. At the old margins it just happened to
      // fit; with a larger top margin it pushed the page's last farmer
      // (and the TOTAL) onto an extra internal page that was then drawn
      // with the first-page header on top of the table head. Non-last
      // pages must never have a foot at all.
      ...(isLastPage ? { foot, showFoot: 'lastPage' } : { foot: undefined, showFoot: 'never' }),
      // Forces this page to genuinely start fresh, regardless of
      // remaining space on the previous page - see this section's
      // opening comment.
      ...(isFirstPage ? {} : { pageBreak: 'always', startY: CONTINUATION_MARGIN_TOP }),
      didDrawPage: () => drawBranchHeader(doc, { branchLabel, periodLabel, isFirstPage }),
      // Draws each row's BN/SH mark just past the table's own right
      // edge once that row's last real column has been placed - small,
      // light gray, never part of the bordered grid itself.
      didDrawCell: (data) => {
        if (data.section === 'head') {
          columnX.set(data.column.index, { x: data.cell.x, width: data.cell.width })
        }
        if (data.section === 'foot') {
          footRowHeight = data.cell.height
        }
        if (data.section === 'body') {
          bottomY = Math.max(bottomY, data.cell.y + data.cell.height)
        }
        if (data.section !== 'body' || data.column.index !== lastColIndex) return
        const mark = chunkMarks[data.row.index]
        if (!mark) return
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6.5)
        doc.setTextColor(...GRAY_TEXT)
        doc.text(mark, data.cell.x + data.cell.width + 2, data.cell.y + data.cell.height / 2 + 1)
        doc.setTextColor(...BLACK)
      },
    })

    mainFinalY = doc.lastAutoTable.finalY

    const pageOwnTotals = sumPrTotals(pageRowsMeta.filter((m) => m.type === 'pr').map((m) => m.pr))
    cumulative = {
      bags: cumulative.bags + pageOwnTotals.bags,
      gross: cumulative.gross + pageOwnTotals.gross,
      sack: cumulative.sack + pageOwnTotals.sack,
      net: cumulative.net + pageOwnTotals.net,
      enw: cumulative.enw + pageOwnTotals.enw,
      basic: cumulative.basic + pageOwnTotals.basic,
      pricer: cumulative.pricer + pageOwnTotals.pricer,
      total: cumulative.total + pageOwnTotals.total,
    }

    // Draw this page's own running SUB-TOTAL row - same shape and grid
    // styling as the real `foot` TOTAL row, positioned directly under
    // this page's own table content. Drawn by hand with doc.rect/
    // doc.line/doc.text against this call's own captured column x/
    // width (`columnX`) rather than as a real table row, so it never
    // competes for the same page-fit budget the rows themselves use.
    if (!isLastPage) {
      const subtotalCells = [{ content: 'SUB-TOTAL', colSpan: 7 }, ...buildTotalsRowCells(cumulative)]
      const rowY = bottomY
      const rowH = footRowHeight

      doc.setFillColor(240, 240, 240)
      doc.rect(margin, rowY, pageW - margin * 2, rowH, 'F')
      doc.setDrawColor(150, 150, 150)
      doc.setLineWidth(0.1)
      doc.setFont('helvetica', 'bolditalic')
      doc.setFontSize(8)
      doc.setTextColor(...BLACK)

      let colIndex = 0
      for (const cell of subtotalCells) {
        const span = (typeof cell === 'object' && cell.colSpan) || 1
        const text = typeof cell === 'object' ? cell.content : cell
        const first = columnX.get(colIndex)
        let w = 0
        for (let s = 0; s < span; s++) w += columnX.get(colIndex + s)?.width ?? 0
        if (first) {
          doc.line(first.x, rowY, first.x, rowY + rowH)
          if (text !== '') doc.text(String(text), first.x + w / 2, rowY + rowH / 2 + 1.5, { align: 'center' })
        }
        colIndex += span
      }
      const lastCol = columnX.get(lastColIndex)
      if (lastCol) doc.line(lastCol.x + lastCol.width, rowY, lastCol.x + lastCol.width, rowY + rowH)
      doc.line(margin, rowY, pageW - margin, rowY)
      doc.line(margin, rowY + rowH, pageW - margin, rowY + rowH)
    }
  })

  const lastTablePage = doc.internal.getCurrentPageInfo().pageNumber

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
  let running = fundBalance
  // Per explicit request/correction: a check-numbered replenishment
  // received during the period must show as its own line (previously
  // every replenishment, checked or not, was silently folded into one
  // COH — Fund Balance figure and never appeared anywhere on the page).
  // `addEntries` here is only the period's replenishments that actually
  // have a real check number (see AbstractExportModal.jsx) - anything
  // without one (the one-time "Opening balance" seed entry) stays
  // folded into fundBalance itself, same as before, since it isn't a
  // real check to reference. One running TOTAL after all of them
  // together, not one per entry, so a period with several replenishments
  // doesn't turn into a wall of repeated TOTAL rows.
  // totalLabel - per explicit request, the SDO Abstract's simplified
  // ("showReplenishmentDetails off") reconciliation box now reads "Cash
  // Advance from CPF" / "LESS: Paid PR's" / "Fund Balance" instead of
  // the generic "Fund Balance" / "LESS: This Period's Replenishment" /
  // "TOTAL" - defaults to 'TOTAL' so the other (details-on) shape,
  // which never passes this, is completely unaffected.
  const totalLabel = reconciliation?.totalLabel ?? 'TOTAL'
  const reconRows = [{ label: reconciliation?.fundBalanceLabel ?? 'COH — Fund Balance', amt: fundBalance }]
  const addEntries = reconciliation?.addEntries ?? []
  for (const e of addEntries) {
    running += e.amount ?? 0
    reconRows.push({ label: e.label, amt: e.amount })
  }
  if (addEntries.length > 0) {
    reconRows.push({ label: totalLabel, amt: running, bold: true })
  }
  for (const e of reconciliation?.lessEntries ?? []) {
    running -= e.amount ?? 0
    reconRows.push({ label: e.label, amt: e.amount })
    reconRows.push({ label: totalLabel, amt: running, bold: true })
  }
  // The box itself starts 4mm ABOVE `y` (see `ry = y - 4` below), so its
  // true bottom relative to `y` is 3mm plus one 7mm row per reconRows
  // entry, not `y` plus the header bar.
  const reconBoxH = 3 + reconRows.length * 7
  const sigBoxH = 28 // role line at y, signature line at y+16, name/position through y+24
  const footerH = Math.max(reconBoxH, sigBoxH)

  let y = mainFinalY + 10
  if (y + footerH > pageH - margin) { doc.addPage(); drawBranchHeader(doc, { branchLabel, periodLabel, isFirstPage: false }); y = CONTINUATION_MARGIN_TOP + 4 }

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
    // Per explicit request: the signatory's own NAME always prints in
    // full caps AND bold, while their Role/Position stays exactly as
    // entered (Title Case, normal weight) - not the same treatment, so
    // only .name gets both.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text((c.person?.name ?? '').toUpperCase(), x, y + 20)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(90, 90, 90)
    doc.text(c.person?.position ?? '', x, y + 24)
    doc.setTextColor(...BLACK)
  })

  // Per explicit request, the black "Cash Reconciliation" header bar is
  // removed - the running-balance rows below print on their own, with
  // no boxed title above them.
  const reconX = margin + sigAreaW + gapBeforeRecon
  let ry = y - 4
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
