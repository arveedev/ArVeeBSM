// NFA Warehouse Stock Report PDF Generator — Phase 8.
//
// Produces the exact NFA paper document structure. Per cereal type with
// activity in the selected period:
//   Page 1: Summary (beginning balance / receipts / issues / ending balance)
//   Page 2+: Statement of Receipts
//   Page N:  Recapitulation of Receipts by nature of transaction
//   Page N:  Statement of Issues
//   Page N:  Recapitulation of Issues
//
// Then for sacks (ESR/ESI):
//   Page N:  Warehouse MTS Report (sack summary: beginning/receipts/issues/ending)
//   Page N:  Statement of MTS Issues (per Image 1)
//   Page N:  Weekly Recapitulation of Empty Sack Issues (per Image 2)
//   Page N:  Statement of MTS Receipts
//   Page N:  Recapitulation of MTS Receipts
//
// Number formatting:
//   Bags / pieces = whole integers with comma separator (7,581)
//   Kilos         = 2 decimal places with comma separator (427,309.97)

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { customerNameWithMillingRef } from './calculations.js'
import { compareByRecency } from './serialNumber.js'

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmtBags = (n) =>
  (n == null || n === 0) ? '-' : Math.round(n).toLocaleString('en-PH')

const fmtKilos = (n) =>
  (n == null || n === 0) ? '-' : Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })

const fmtDate = (s) => {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtPeriod = (from, to) => {
  if (!from && !to) return ''
  const f = fmtDate(from).toUpperCase()
  const t = fmtDate(to).toUpperCase()
  return from === to ? f : `${f} – ${t}`
}

// ── Layout constants ──────────────────────────────────────────────────────────

const BLACK = [0, 0, 0]
const GRAY_TEXT = [80, 80, 80]
const HEADER_BG = [200, 200, 200]   // light gray for table header cells
const CONTENT_BORDER = [180, 180, 180]  // gray for content row borders
const margin = 14
const pageW = 210 // A4 width mm

// ── Header builder ────────────────────────────────────────────────────────────

const addPageHeader = (doc, { branch, warehouse, province, periodLabel, subtitle }) => {
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
  if (branch?.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(branch.address.toUpperCase(), pageW / 2, y, { align: 'center' })
    y += 4.5
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const subtitleLines = subtitle.toUpperCase().split('\n')
  for (const line of subtitleLines) {
    doc.text(line, pageW / 2, y, { align: 'center' })
    y += 4.5
  }
  y += 0.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`FOR THE PERIOD: ${periodLabel}`, pageW / 2, y, { align: 'center' })
  y += 6

  return y
}

// REGION / PROVINCE / CODE / WHSE block — stacked left-aligned labels with
// bold values, matching the real Warehouse MTS Report layout exactly. This
// is the preferred warehouse identification block; reused across stock and
// sack report pages for visual consistency. `region` comes from the
// warehouse's branch (set in the Branches admin tab), never hardcoded.
const addRegionProvinceCodeWhse = (doc, { warehouse, province, branch }, y) => {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...BLACK)
  const leftX = margin
  const labelW = 22

  doc.text('REGION:', leftX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(branch?.region ?? '', leftX + labelW, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.text('PROVINCE:', leftX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(province?.name?.toUpperCase() ?? '', leftX + labelW, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.text('CODE:', leftX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(warehouse?.code ?? '', leftX + labelW, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.text('WHSE:', leftX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(warehouse?.name?.toUpperCase() ?? '', leftX + labelW, y)
  y += 7

  return y
}

// WAREHOUSE NAME / CODE block stacked (used by recap and summary pages)

// ── Signatory block ───────────────────────────────────────────────────────────
// Layout (from real docs):
//   LEFT col:    Certified Correct
//   MIDDLE col:  Verified Correct (stacked, no repeated label)
//   RIGHT col:   Audited By
//   CENTER row:  Noted By (below, centered)
// All names and positions are centered on their line/underline.

const addSignatories = (doc, { certifiedCorrectName, certifiedCorrectPosition, signatories }, startY) => {
  const col = (pageW - margin * 2) / 3
  const baseY = startY + 10
  const lineGap = 4.5

  const renderName = (name, position, x, y, colWidth) => {
    // Underline first
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.3)
    doc.line(x, y, x + colWidth - 2, y)
    // Name centered on underline
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...BLACK)
    doc.text(name ?? '', x + (colWidth - 2) / 2, y - 1, { align: 'center' })
    // Position centered below
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(position ?? '', x + (colWidth - 2) / 2, y + lineGap, { align: 'center' })
  }

  const renderLabel = (label, x, y) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY_TEXT)
    doc.text(label, x, y)
  }

  // LEFT — Certified Correct
  renderLabel('Certified Correct:', margin, baseY)
  renderName(
    certifiedCorrectName,
    certifiedCorrectPosition,
    margin, baseY + lineGap * 3,
    col
  )

  // MIDDLE — Verified Correct (label once, then each name stacked below)
  let vcY = baseY
  const vcList = signatories?.verifiedCorrect ?? []
  renderLabel('Verified Correct:', margin + col, vcY)
  vcY += lineGap * 3
  for (const vc of vcList) {
    renderName(vc.name, vc.position, margin + col, vcY, col)
    vcY += lineGap * 3.5
  }

  // RIGHT — Audited By
  renderLabel('Audited By:', margin + col * 2, baseY)
  if (signatories?.auditedByName) {
    renderName(
      signatories.auditedByName,
      signatories.auditedByPosition,
      margin + col * 2, baseY + lineGap * 3,
      col
    )
  }

  // BOTTOM CENTER — Noted By
  const notedY = Math.max(vcY, baseY + lineGap * 7) + 4
  renderLabel('Noted By:', pageW / 2 - 10, notedY)
  if (signatories?.notedByName) {
    renderName(
      signatories.notedByName,
      signatories.notedByPosition,
      pageW / 2 - col / 2, notedY + lineGap * 3,
      col
    )
  }
}

// ── Table style presets ───────────────────────────────────────────────────────
// Per real docs: solid black borders on header, gray on content rows.

const tableStyles = {
  headStyles: {
    fillColor: HEADER_BG,
    textColor: BLACK,
    fontStyle: 'bold',
    fontSize: 7,
    lineWidth: 0.4,
    lineColor: BLACK,     // solid black header border
    halign: 'center',
  },
  bodyStyles: {
    fontSize: 7,
    textColor: BLACK,
    lineWidth: 0.2,
    lineColor: CONTENT_BORDER,  // gray content borders
    fillColor: [255, 255, 255],
  },
  alternateRowStyles: { fillColor: [248, 248, 248] },
}

// ── Footer (page numbers) ─────────────────────────────────────────────────────

const addFooter = (doc) => {
  const pageCount = doc.internal.getNumberOfPages()
  const dateOnly = new Date().toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(160, 160, 160)
    doc.text(
      `BSM by ArVee · ${dateOnly} · Page ${i} of ${pageCount}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 5,
      { align: 'center' }
    )
  }
}

// ── STOCK REPORT PAGES ────────────────────────────────────────────────────────

const addStockSummaryPage = (doc, { header, cerealType, varieties, receipts, issues, beginBalMap, sackTypeMap, pileMtsById, sigCtx }) => {
  doc.addPage()
  let y = addPageHeader(doc, { ...header, subtitle: 'Summary of Weekly Stock Receipts, Issues and Balances' })
  y = addRegionProvinceCodeWhse(doc, header, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...BLACK)
  doc.text(`CEREAL TYPE: LOCAL ${cerealType.toUpperCase()}`, margin, y)
  y += 4

  // Collect variety+condition+mtsWeight raw keys from transactions AND
  // from the beginning balance map itself - a pile with a beginning
  // balance but zero transactions in this period must still get a
  // row.
  const mtsWeightOf = (t) => {
    const ownSackTypeId = t.mtsSackTypeId ?? pileMtsById?.get(t.pileId)?.mtsSackTypeId
    const ownCondition = t.mtsCondition ?? pileMtsById?.get(t.pileId)?.mtsCondition
    return sackTypeMap?.get(ownSackTypeId)?.weights?.[ownCondition] ?? null
  }
  const rawKeys = new Set()
  for (const t of [...receipts, ...issues]) {
    if (t.varietyId && t.condition) rawKeys.add(`${t.varietyId}::${t.condition}::${mtsWeightOf(t) ?? ''}`)
  }
  if (beginBalMap) {
    for (const key of beginBalMap.keys()) rawKeys.add(key)
  }

  // First pass: for each variety+condition pair, collect every
  // distinct MTS weight actually in use across all its raw keys.
  // Per explicit clarification, separation into labeled rows only
  // happens when a pair genuinely has more than one distinct weight -
  // a variety+condition using a single sack type throughout (the
  // common case) stays merged as one plain row, exactly as before
  // this feature existed.
  const weightsByVarietyCondition = new Map()
  for (const rawKey of rawKeys) {
    const [varietyId, condition, mtsWeightStr] = rawKey.split('::')
    if (!mtsWeightStr) continue
    const vcKey = `${varietyId}::${condition}`
    if (!weightsByVarietyCondition.has(vcKey)) weightsByVarietyCondition.set(vcKey, new Set())
    weightsByVarietyCondition.get(vcKey).add(mtsWeightStr)
  }

  // Second pass: fold raw keys down to their display key - the raw
  // key itself (separate per weight) when separation is needed, or
  // just the variety+condition pair (merged) otherwise.
  const keys = new Set()
  const displayKeyOf = (rawKey) => {
    const [varietyId, condition] = rawKey.split('::')
    const vcKey = `${varietyId}::${condition}`
    const needsSeparation = cerealType !== 'By Products' && (weightsByVarietyCondition.get(vcKey)?.size ?? 0) > 1
    return needsSeparation ? rawKey : vcKey
  }
  for (const rawKey of rawKeys) keys.add(displayKeyOf(rawKey))

  let totBegBags = 0, totBegKilos = 0
  let totRecBags = 0, totRecKilos = 0
  let totIssBags = 0, totIssKilos = 0

  const body = [...keys].sort().map((key) => {
    const [varietyId, condition, mtsWeightStr] = key.split('::')
    const mtsWeight = mtsWeightStr ? parseFloat(mtsWeightStr) : null
    const variety = varieties.find((v) => v.varietyId === varietyId)
    const matchesGroup = (t) => {
      if (t.varietyId !== varietyId || t.condition !== condition) return false
      const rawKey = `${t.varietyId}::${t.condition}::${mtsWeightOf(t) ?? ''}`
      return displayKeyOf(rawKey) === key
    }
    let beg = { bags: 0, kilos: 0 }
    if (beginBalMap) {
      for (const [rawKey, val] of beginBalMap.entries()) {
        if (displayKeyOf(rawKey) === key) {
          beg = { bags: beg.bags + val.bags, kilos: beg.kilos + val.kilos }
        }
      }
    }
    const recBags = receipts.filter(matchesGroup).reduce((s, t) => s + (t.numberOfBags ?? 0), 0)
    const recKilos = receipts.filter(matchesGroup).reduce((s, t) => s + (t.netKilos ?? 0), 0)
    const issBags = issues.filter(matchesGroup).reduce((s, t) => s + (t.numberOfBags ?? 0), 0)
    const issKilos = issues.filter(matchesGroup).reduce((s, t) => s + (t.netKilos ?? 0), 0)
    const endBags = beg.bags + recBags - issBags
    const endKilos = beg.kilos + recKilos - issKilos

    totBegBags += beg.bags; totBegKilos += beg.kilos
    totRecBags += recBags; totRecKilos += recKilos
    totIssBags += issBags; totIssKilos += issKilos

    return [
      mtsWeight != null ? `${variety?.name ?? varietyId} (${mtsWeight.toFixed(3)})` : (variety?.name ?? varietyId),
      condition,
      fmtBags(beg.bags), fmtKilos(beg.kilos),
      fmtBags(recBags), fmtKilos(recKilos),
      fmtBags(issBags), fmtKilos(issKilos),
      fmtBags(endBags), fmtKilos(endKilos),
    ]
  })

  const endTotBags = totBegBags + totRecBags - totIssBags
  const endTotKilos = totBegKilos + totRecKilos - totIssKilos
  body.push([
    { content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold', halign: 'left' } },
    fmtBags(totBegBags), fmtKilos(totBegKilos),
    fmtBags(totRecBags), fmtKilos(totRecKilos),
    fmtBags(totIssBags), fmtKilos(totIssKilos),
    fmtBags(endTotBags), fmtKilos(endTotKilos),
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    ...tableStyles,
    head: [
      [
        { content: 'VARIETY', rowSpan: 2, styles: { valign: 'middle' } },
        { content: 'COND.', rowSpan: 2, styles: { valign: 'middle' } },
        { content: 'BEGINNING BALANCE', colSpan: 2 },
        { content: 'RECEIPTS', colSpan: 2 },
        { content: 'ISSUES', colSpan: 2 },
        { content: 'ENDING BALANCE', colSpan: 2 },
      ],
      ['BAGS', 'NT. KLS', 'BAGS', 'NT. KLS', 'BAGS', 'NT. KLS', 'BAGS', 'NT. KLS'],
    ],
    body,
    columnStyles: {
      2: { halign: 'right' }, 3: { halign: 'right' },
      4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right' }, 7: { halign: 'right' },
      8: { halign: 'right' }, 9: { halign: 'right' },
    },
  })

  addSignatories(doc, sigCtx, doc.lastAutoTable.finalY)
}

const addStockStatementPage = (doc, { header, cerealType, transactions, isIssues, sigCtx }) => {
  doc.addPage()
  let y = addPageHeader(doc, {
    ...header,
    subtitle: isIssues ? 'Statement of Weekly Issues' : 'Statement of Weekly Receipts',
  })
  y = addRegionProvinceCodeWhse(doc, header, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...BLACK)
  doc.text(`TYPE OF CEREAL: LOCAL ${cerealType.toUpperCase()}`, margin, y)
  y += 3

  const isByProducts = cerealType === 'By Products'

  // Defensive safeguard against duplicate transaction records, given
  // the severity of duplicated figures appearing on an official
  // report - deduplicates first by id (in case the same record somehow
  // appears twice in the input array), then by the same type+
  // warehouseId+serialNo+cerealCategory key already proven correct for
  // genuine data-level duplicates elsewhere this session. Runs before
  // the groupSerialNo combination below, so a duplicated multi-pile
  // record can't get summed twice into an already-correct total.
  const seenIds = new Set()
  const dedupedById = transactions.filter((t) => {
    if (seenIds.has(t.id)) return false
    seenIds.add(t.id)
    return true
  })
  const seenKeys = new Map()
  const dedupedTransactions = []
  for (const t of dedupedById) {
    const key = `${t.type}::${t.warehouseId}::${t.serialNo}::${t.cerealCategory ?? ''}`
    const existing = seenKeys.get(key)
    if (!existing) {
      seenKeys.set(key, t)
      dedupedTransactions.push(t)
    }
    // else: a genuine duplicate slipped through data cleanup - silently
    // dropped here rather than shown twice on the printed report.
  }

  // Multi-pile issuances (linked via groupSerialNo) are combined into
  // a single row here - per explicit request, these should appear as
  // one transaction on every report, even though they're saved as
  // several separate, linked records under the hood (one per pile,
  // for accurate per-pile ledger tracking). An ordinary transaction
  // has no groupSerialNo, so it falls back to its own unique id as the
  // grouping key and passes through completely unaffected, as its own
  // single-item group.
  const groups = new Map()
  for (const t of dedupedTransactions) {
    const key = t.groupSerialNo ?? t.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const combinedTransactions = [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]
    // The primary record (no serial suffix) supplies every display
    // field except the three that get summed across the whole group.
    const primary = group.find((t) => t.serialNo === t.groupSerialNo) ?? group[0]
    return {
      ...primary,
      numberOfBags: group.reduce((sum, t) => sum + (t.numberOfBags ?? 0), 0),
      grossKilos: group.reduce((sum, t) => sum + (t.grossKilos ?? 0), 0),
      netKilos: group.reduce((sum, t) => sum + (t.netKilos ?? 0), 0),
    }
  })

  // Sorted by date then by series (compareByRecency - the same real
  // chronological/booklet-recency order navigation uses), not raw serial
  // magnitude alone - a magnitude-only sort mixed rows from unrelated
  // dates and series together whenever one booklet's numbers happened to
  // be smaller than another's, producing the reported "mixed data"
  // ordering instead of a clean date-then-series arrangement.
  const sorted = [...combinedTransactions].sort(compareByRecency)

  let totBags = 0, totGross = 0, totNet = 0
  const body = sorted.map((t) => {
    totBags += t.numberOfBags ?? 0
    totGross += t.grossKilos ?? 0
    totNet += t.netKilos ?? 0
    const row = [
      fmtDate(t.date),
      t.transactionTypeName ?? '',
      t.serialNo ?? '',
      isIssues ? (t.aiNumber ?? '') : (t.linkedDocNo ?? ''),
      t.status === 'Cancelled' ? 'CANCELLED' : customerNameWithMillingRef(t.customerName, t.transactionTypeName, t.batchNumber, t.trialNumber),
      t.varietyName ?? '',
      ...(isByProducts ? [] : [t.moistureContent != null ? Number(t.moistureContent).toFixed(1) : '-']),
      fmtBags(t.numberOfBags),
      fmtKilos(t.grossKilos),
      fmtKilos(t.netKilos),
    ]
    if (isIssues) row.splice(5, 0, t.orNumber ?? '')
    return row
  })

  const totalRow = [
    '', '', '', '',
    { content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } },
    ...(isByProducts ? [] : ['']),
    { content: fmtBags(totBags), styles: { fontStyle: 'bold', halign: 'right' } },
    { content: fmtKilos(totGross), styles: { fontStyle: 'bold', halign: 'right' } },
    { content: fmtKilos(totNet), styles: { fontStyle: 'bold', halign: 'right' } },
  ]
  if (isIssues) totalRow.splice(5, 0, '')
  body.push(totalRow)

  const linkedColHeader = isIssues ? 'AI #' : 'WSI/PR/BL'
  const serialHeader = isIssues ? 'WSI/WTS' : 'WSR/WTS'

  const head = [
    'DATE',
    { content: 'NATURE OF TRANS\nACTIVITY', styles: { halign: 'center' } },
    serialHeader,
    linkedColHeader,
    { content: 'FROM WHOM ' + (isIssues ? 'ISSUED' : 'RECEIVED') + '\nNAME', styles: { halign: 'center' } },
    'VARIETY\nCODE',
    ...(isByProducts ? [] : ['MC\n%']),
    'BAGS',
    'GROSS\nKILOS',
    'NET\nKILOS',
  ]
  if (isIssues) head.splice(5, 0, 'OR #')

  // Column widths are built as an ordered list matching the head/body
  // arrays above position-for-position, then converted to the indexed
  // object autoTable expects - this way the widths automatically shift
  // correctly whichever columns are actually present, rather than
  // needing every index hand-adjusted whenever a column is added,
  // removed, or conditionally omitted (like MC is here for By Products).
  const widthList = [
    { cellWidth: 15 },   // DATE
    { cellWidth: 28 },   // NATURE OF TRANS ACTIVITY
    { cellWidth: 18 },   // serial
    { cellWidth: 16 },   // linked doc
    { cellWidth: isIssues ? 30 : 38 }, // FROM WHOM NAME
    ...(isIssues ? [{ cellWidth: 16 }] : []), // OR #
    { cellWidth: 13 },   // VARIETY CODE
    ...(isByProducts ? [] : [{ cellWidth: 9, halign: 'right' }]), // MC%
    { cellWidth: 14, halign: 'right' }, // BAGS
    { halign: 'right' }, // GROSS KILOS
    { halign: 'right' }, // NET KILOS
  ]
  const columnStyles = Object.fromEntries(widthList.map((style, i) => [i, style]))


  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    ...tableStyles,
    head: [head],
    body,
    columnStyles,
  })

  addSignatories(doc, sigCtx, doc.lastAutoTable.finalY)
}

const addStockRecapPage = (doc, { header, cerealType, transactions, isIssues, sigCtx }) => {
  doc.addPage()
  let y = addPageHeader(doc, {
    ...header,
    subtitle: isIssues
      ? 'Recapitulation of Stock Issues by Nature of Transaction'
      : 'Recapitulation of Stock Receipts by Nature of Transaction',
  })
  y = addRegionProvinceCodeWhse(doc, header, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...BLACK)
  doc.text(`CEREAL TYPE: LOCAL ${cerealType.toUpperCase()}`, margin, y)
  y += 5

  const byActivity = {}
  for (const t of transactions) {
    const act = t.transactionTypeName || 'UNKNOWN'
    if (!byActivity[act]) byActivity[act] = []
    byActivity[act].push(t)
  }

  let grandBags = 0, grandKilos = 0

  for (const [activity, txList] of Object.entries(byActivity).sort()) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(`ACTIVITY: ${activity.toUpperCase()}`, margin, y)
    y += 2

    const byVC = {}
    for (const t of txList) {
      const k = `${t.varietyName}::${t.condition}`
      if (!byVC[k]) byVC[k] = { bags: 0, kilos: 0 }
      byVC[k].bags += t.numberOfBags ?? 0
      byVC[k].kilos += t.netKilos ?? 0
    }

    let actBags = 0, actKilos = 0
    const body = Object.entries(byVC).sort().map(([k, v]) => {
      const [vName, cond] = k.split('::')
      actBags += v.bags; actKilos += v.kilos
      return [vName, cond, fmtBags(v.bags), fmtKilos(v.kilos)]
    })
    body.push([
      { content: 'TOTAL PER ACTIVITY', colSpan: 2, styles: { fontStyle: 'bold' } },
      { content: fmtBags(actBags), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: fmtKilos(actKilos), styles: { fontStyle: 'bold', halign: 'right' } },
    ])
    grandBags += actBags; grandKilos += actKilos

    autoTable(doc, {
      startY: y,
      margin: { left: margin * 2, right: margin },
      ...tableStyles,
      head: [['VARIETY', 'COND.', 'BAGS', 'NET KILOS']],
      body,
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    })
    y = doc.lastAutoTable.finalY + 4
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin * 2, right: margin },
    ...tableStyles,
    head: [[{ content: '', colSpan: 2 }, 'BAGS', 'NET KILOS']],
    body: [[
      { content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold' } },
      { content: fmtBags(grandBags), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: fmtKilos(grandKilos), styles: { fontStyle: 'bold', halign: 'right' } },
    ]],
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
  })

  addSignatories(doc, sigCtx, doc.lastAutoTable.finalY)
}

// ── SACK REPORT PAGES (per Images 1, 2, 3) ───────────────────────────────────

// Image 3: Warehouse MTS Report — sack summary (beginning/add/less/ending)
const addSackSummaryPage = (doc, { header, sackReceipts, sackIssues, sackBeginBals, sackTypeMap, sigCtx }) => {
  doc.addPage()
  let y = addPageHeader(doc, { ...header, subtitle: 'Warehouse MTS Report' })
  y = addRegionProvinceCodeWhse(doc, header, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('A. EMPTY SACK REPORT', margin, y)
  y += 3

  // Collect all sack type+condition combos from transactions AND from
  // the beginning balance map itself - same reasoning as the stock
  // summary page above.
  const combos = new Set()
  for (const t of [...sackReceipts, ...sackIssues]) {
    for (const l of (t.sackLines ?? [])) {
      if (l.sackTypeId && l.condition) combos.add(`${l.sackTypeId}::${l.condition}`)
    }
  }
  if (sackBeginBals) {
    for (const key of sackBeginBals.keys()) combos.add(key)
  }

  const body = [...combos].sort().map((key) => {
    const [sackTypeId, condition] = key.split('::')
    const sackType = sackTypeMap.get(sackTypeId)
    const beg = sackBeginBals?.get(key) ?? 0
    const rec = sackReceipts.flatMap(t => t.sackLines ?? [])
      .filter(l => l.sackTypeId === sackTypeId && l.condition === condition)
      .reduce((s, l) => s + (l.pieces ?? 0), 0)
    const iss = sackIssues.flatMap(t => t.sackLines ?? [])
      .filter(l => l.sackTypeId === sackTypeId && l.condition === condition)
      .reduce((s, l) => s + (l.pieces ?? 0), 0)
    const end = beg + rec - iss
    return [
      sackType?.code ?? sackTypeId,
      condition,
      beg > 0 ? beg.toLocaleString('en-PH') : '-',
      rec > 0 ? rec.toLocaleString('en-PH') : '-',
      iss > 0 ? iss.toLocaleString('en-PH') : '-',
      end !== 0 ? end.toLocaleString('en-PH') : '-',
    ]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    ...tableStyles,
    head: [['MTS TYPE', 'COND.', 'BEGINNING\nBALANCE', 'ADD\nRECEIPTS', 'LESS\nISSUES', 'ENDING\nBALANCE']],
    body,
    columnStyles: {
      2: { halign: 'right' }, 3: { halign: 'right' },
      4: { halign: 'right' }, 5: { halign: 'right' },
    },
  })

  addSignatories(doc, sigCtx, doc.lastAutoTable.finalY)
}

// Image 1: Statement of MTS Issues / Receipts
const addSackStatementPage = (doc, { header, transactions, isIssues, sackTypeMap, sigCtx }) => {
  doc.addPage()
  const subtitle = isIssues ? 'Statement of MTS Issues' : 'Statement of MTS Receipts'
  let y = addPageHeader(doc, { ...header, subtitle })
  y = addRegionProvinceCodeWhse(doc, header, y)

  const serialHeader = isIssues ? 'ESI/WTS#' : 'ESR/WTS#'
  const linkedHeader = isIssues ? 'SIA #' : 'ESI #'
  const nameHeader = isIssues ? 'ISSUED TO\nNAME' : 'RECEIVED FROM\nNAME'

  const body = []
  let grandTotal = 0

  // See addStockStatementPage's matching comment - date-then-series
  // order, not raw serial magnitude alone.
  const sorted = [...transactions].sort(compareByRecency)

  for (const t of sorted) {
    const lines = t.sackLines ?? []
    const sackCodes = [...new Set(lines.map(l => sackTypeMap.get(l.sackTypeId)?.code ?? '?'))].join('/')
    for (let i = 0; i < Math.max(lines.length, 1); i++) {
      const l = lines[i]
      const pcs = l?.pieces ?? 0
      grandTotal += pcs
      body.push([
        i === 0 ? fmtDate(t.date) : '',
        i === 0 ? (t.transactionTypeName ?? '') : '',
        i === 0 ? (t.serialNo ?? '') : '',
        i === 0 ? (isIssues ? (t.siaNumber ?? t.linkedDocNo ?? '') : (t.linkedDocNo ?? '')) : '',
        i === 0 ? (t.status === 'Cancelled' ? 'CANCELLED' : customerNameWithMillingRef(t.customerName, t.transactionTypeName, t.batchNumber, t.trialNumber)) : '',
        sackTypeMap.get(l?.sackTypeId)?.code ?? (i === 0 ? sackCodes : ''),
        sackTypeMap.get(l?.sackTypeId) ? (l?.condition === 'BN' ? 'BN' : l?.condition === 'SH' ? 'SH' : l?.condition ?? '') : '',
        pcs > 0 ? pcs.toLocaleString('en-PH') : '-',
      ])
    }
  }

  body.push([
    '', '', '', '', '',
    { content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } },
    { content: grandTotal.toLocaleString('en-PH'), styles: { fontStyle: 'bold', halign: 'right' } },
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    ...tableStyles,
    head: [[
      'DATE',
      { content: 'NATURE OF TRANSACTION\nACTIVITY', styles: { halign: 'center' } },
      serialHeader,
      linkedHeader,
      nameHeader,
      'CODE',
      'SACK\nTYPE',
      'QTY',
    ]],
    body,
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 25 },
      2: { cellWidth: 18 },
      3: { cellWidth: 15 },
      4: { cellWidth: 45 },
      5: { cellWidth: 18 },
      6: { cellWidth: 14, halign: 'center' },
      7: { halign: 'right' },
    },
  })

  addSignatories(doc, sigCtx, doc.lastAutoTable.finalY)
}

// Image 2: Weekly Recapitulation of Quantity of Empty Sack Issues/Receipts
// Title is single-line only — "By Sack Type by Activity by Sack Condition"
// is removed since a multi-line subtitle caused text to overlap the period
// line below it.
const addSackRecapPage = (doc, { header, transactions, isIssues, sackTypeMap, sigCtx }) => {
  doc.addPage()
  let y = addPageHeader(doc, {
    ...header,
    subtitle: isIssues
      ? 'Weekly Recapitulation of Quantity of Empty Sack Issues'
      : 'Weekly Recapitulation of Quantity of Empty Sack Receipts',
  })
  y = addRegionProvinceCodeWhse(doc, header, y)

  // Condition set matches the app's actual data model (shared.js
  // SACK_CONDITIONS) - MENDABLE/MENDED from the real paper form are not
  // tracked anywhere in the app, so those columns are omitted rather than
  // always showing zero.
  const conditionLabels = {
    BN: 'BRAND NEW',
    SH: 'SECOND HAND',
    US: 'UNSERVICEABLE',
  }
  const conditionKeys = ['BN', 'SH', 'US']

  // Group by sack type code + activity → condition → total pieces
  const groups = {}
  for (const t of transactions) {
    const actLabel = t.transactionTypeName ?? '—'
    for (const l of (t.sackLines ?? [])) {
      const code = sackTypeMap.get(l.sackTypeId)?.code ?? '?'
      const key = `${code}::${actLabel}`
      if (!groups[key]) groups[key] = { code, activity: actLabel, totals: {} }
      const cond = l.condition ?? 'BN'
      groups[key].totals[cond] = (groups[key].totals[cond] ?? 0) + (l.pieces ?? 0)
    }
  }

  const body = []
  const grandTotals = {}
  conditionKeys.forEach((c) => { grandTotals[c] = 0 })

  for (const [, g] of Object.entries(groups).sort()) {
    const row = [g.code, g.activity]
    for (const c of conditionKeys) {
      const v = g.totals[c] ?? 0
      grandTotals[c] += v
      row.push(v > 0 ? v.toLocaleString('en-PH') : '0')
    }
    body.push(row)
  }

  const totalRow = [{ content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold' } }]
  for (const c of conditionKeys) {
    totalRow.push({ content: grandTotals[c].toLocaleString('en-PH'), styles: { fontStyle: 'bold', halign: 'right' } })
  }
  body.push(totalRow)

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    ...tableStyles,
    head: [
      [
        { content: 'SACK TYPE/', rowSpan: 2, styles: { valign: 'middle' } },
        { content: 'ACTIVITY', rowSpan: 2, styles: { valign: 'middle' } },
        { content: 'SACK CONDITION', colSpan: 3, styles: { halign: 'center' } },
      ],
      conditionKeys.map((c) => conditionLabels[c] ?? c),
    ],
    body,
    columnStyles: {
      2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
    },
  })

  addSignatories(doc, sigCtx, doc.lastAutoTable.finalY)
}

// ── Main export ───────────────────────────────────────────────────────────────

export const generateNfaReport = ({
  warehouse, province, branch,
  dateFrom, dateTo,
  receipts, issues,
  sackReceipts, sackIssues,
  stockBeginningBals, sackBeginningBals,
  signatories, certifiedCorrect,
  varieties, sackTypes, sackTypeMap, pileMtsById,
}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.deletePage(1)

  const periodLabel = fmtPeriod(dateFrom, dateTo)
  const header = { warehouse, province, branch, periodLabel }
  const sigCtx = { certifiedCorrectName: certifiedCorrect?.name, certifiedCorrectPosition: certifiedCorrect?.position, signatories }

  // ── Stock pages per cereal type ──
  // cerealTypes is the union of transaction categories AND categories
  // with a beginning balance (from piles' isInitialBalance seeds) - a
  // warehouse with stock but zero transactions in this period must still
  // get a summary page showing beginning = ending balance.
  const allStockTx = [...receipts, ...issues]
  const cerealTypes = [...new Set([
    ...allStockTx.map(t => t.cerealCategory ?? 'Unknown'),
    ...(stockBeginningBals ? [...stockBeginningBals.keys()] : []),
  ])].sort()

  for (const cerealType of cerealTypes) {
    const catRec = receipts.filter(t => (t.cerealCategory ?? 'Unknown') === cerealType)
    const catIss = issues.filter(t => (t.cerealCategory ?? 'Unknown') === cerealType)

    const catVars = varieties.filter(v => v.category === cerealType)
    const beginBalMap = stockBeginningBals?.get(cerealType) ?? new Map()

    // Summary always renders (beginning/ending balance is meaningful even
    // with zero activity). Statement/recap pages only render if there is
    // actual activity to list - a statement of zero rows is meaningless.
    addStockSummaryPage(doc, { header, cerealType, varieties: catVars, receipts: catRec, issues: catIss, beginBalMap, sackTypeMap, pileMtsById, sigCtx })
    if (catRec.length > 0) {
      addStockStatementPage(doc, { header, cerealType, transactions: catRec, isIssues: false, sigCtx })
      addStockRecapPage(doc, { header, cerealType, transactions: catRec, isIssues: false, sigCtx })
    }
    if (catIss.length > 0) {
      addStockStatementPage(doc, { header, cerealType, transactions: catIss, isIssues: true, sigCtx })
      addStockRecapPage(doc, { header, cerealType, transactions: catIss, isIssues: true, sigCtx })
    }
  }

  // ── Sack pages ──
  const resolvedSackReceipts = sackReceipts.map(t => ({
    ...t,
    sackLines: (t.sackLines ?? []).map(l => ({
      ...l,
      condition: l.condition,
    })),
  }))
  const resolvedSackIssues = sackIssues.map(t => ({
    ...t,
    sackLines: (t.sackLines ?? []).map(l => ({
      ...l,
      condition: l.condition,
    })),
  }))

  const hasSacks = resolvedSackReceipts.length > 0 || resolvedSackIssues.length > 0 ||
    (sackBeginningBals && sackBeginningBals.size > 0)
  if (hasSacks) {
    addSackSummaryPage(doc, { header, sackReceipts: resolvedSackReceipts, sackIssues: resolvedSackIssues, sackBeginBals: sackBeginningBals, sackTypeMap, sigCtx })
    if (resolvedSackReceipts.length > 0) {
      addSackStatementPage(doc, { header, transactions: resolvedSackReceipts, isIssues: false, sackTypeMap, sigCtx })
      addSackRecapPage(doc, { header, transactions: resolvedSackReceipts, isIssues: false, sackTypeMap, sigCtx })
    }
    if (resolvedSackIssues.length > 0) {
      addSackStatementPage(doc, { header, transactions: resolvedSackIssues, isIssues: true, sackTypeMap, sigCtx })
      addSackRecapPage(doc, { header, transactions: resolvedSackIssues, isIssues: true, sackTypeMap, sigCtx })
    }
  }

  addFooter(doc)
  return doc
}
