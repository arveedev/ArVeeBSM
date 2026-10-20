// The audit file (a second Google Sheet next to the GSR): Summary, Cells, Documents, Excluded, Settings used.
// Built in the same pass as the GSR from the same numbers, so the two can never disagree (pure, no database).

import { SheetBuilder, BAGS_FORMAT } from './sheetModel.js'
import { longDate } from '../inventoryReport.js'
import { periodTitle } from './period.js'

const table = (sheet, startRow, headers, rows, widths) => {
  headers.forEach((h, c) => sheet.set(startRow, c, h))
  sheet.boldRange(startRow, 0, startRow, headers.length - 1)
  sheet.fill(startRow, 0, startRow, headers.length - 1, '#d9ead3')
  rows.forEach((row, i) => row.forEach((v, c) => sheet.set(startRow + 1 + i, c, v)))
  if (widths) widths.forEach((w, c) => { sheet.colWidths[c] = w })
  return startRow + 1 + rows.length
}

export const AUDIT_READBACK_REF = 'B13'
export const AUDIT_STATUS_REF = 'B14'

export const buildAuditFile = (res, { appInfo = {}, firstRun = true }) => {
  const summary = new SheetBuilder('Summary')
  const rows = [
    ['Report', `${res.fileName} (memo date ${longDate(res.memoISO)})`],
    ['Title', res.title],
    ['Period reported', `${longDate(res.from)} to ${longDate(res.to)}`],
    ['For the month / for the year', `from ${longDate(res.monthFrom)} / from ${res.yearFrom ? longDate(res.yearFrom) : '-'}`],
    ['Created by', appInfo.createdBy ?? 'Admin'],
    ['Created', appInfo.createdAt ?? ''],
    ['App version / database', `${appInfo.version ?? ''} / ${appInfo.databaseId ?? ''}`],
    ['Sheets in this run', 'PALAY INVENTORY (the other ten are built in later steps)'],
    ['Stock lines counted / total net bags', `${res.lots.length} lots / ${res.lotsTotal.toFixed(2)}`],
    ['Blocking checks', res.checks.blocking.length === 0 ? 'all passed' : `${res.checks.blocking.length} open`],
    ['Warnings', String(res.checks.warnings.length)],
    ['Read-back from Drive', 'pending'],
    ['Status', firstRun ? 'FIRST RUN - HAND CHECK' : 'Verified'],
  ]
  summary.set(0, 0, 'Item'); summary.set(0, 1, 'Value')
  summary.boldRange(0, 0, 0, 1)
  rows.forEach(([a, b], i) => { summary.set(1 + i, 0, a); summary.set(1 + i, 1, b) })
  summary.colWidths = { 0: 260, 1: 560 }
  let r = rows.length + 3
  summary.set(r, 0, 'Tally against the warehouses (net bags)')
  summary.boldRange(r, 0, r, 0)
  r += 1
  r = table(summary, r, ['Column', 'Opening', 'Received', 'Issued', 'Corrections', 'Ending (warehouse)', 'Printed in GSR', 'Walk ties', 'Sheet ties'],
    res.checks.movement.map((m) => [m.column, m.opening, m.received, m.issued, m.corrections, m.ending, m.printed, m.okWalk ? 'yes' : 'NO', m.okSheet ? 'yes' : 'NO']))
  summary.format(r - res.checks.movement.length, 1, r, 6, BAGS_FORMAT)
  r += 1
  summary.set(r, 0, 'Ties between sheets')
  summary.boldRange(r, 0, r, 0)
  r += 1
  r = table(summary, r, ['Check', 'Sheet A', 'Sheet B', 'Result'], res.checks.ties.map((t) => [t.label, t.a, t.b, t.ok ? 'match' : 'DIFFERENT']))
  r += 1
  if (res.checks.warnings.length) {
    summary.set(r, 0, 'Warnings')
    summary.boldRange(r, 0, r, 0)
    r += 1
    res.checks.warnings.forEach((w) => { summary.set(r, 0, w.text); r += 1 })
  }

  // Cells: every figure of the GSR sheets, with what is behind it
  const cells = new SheetBuilder('Cells')
  const figureByRef = new Map(res.palay.cells.map((c) => [c.cell, c]))
  const cellRows = []
  for (const sheet of res.sheets) {
    const expected = sheet.expected()
    for (const [ref, v] of expected) {
      if (typeof v !== 'number') continue
      const fig = figureByRef.get(ref)
      cellRows.push([sheet.name, ref, fig?.rowLabel ?? '', fig?.colLabel ?? '', v, fig ? fig.parts.length : '', fig ? 'stock lines of the Summary (Documents tab)' : 'formula (sum of cells above / beside it)'])
    }
  }
  table(cells, 0, ['Sheet', 'Cell', 'Row', 'Column', 'Value (net bags)', 'Stock lines', 'Where it comes from'], cellRows, [150, 60, 190, 220, 110, 80, 330])
  cells.format(1, 4, cellRows.length + 1, 4, BAGS_FORMAT)

  // Documents: the lots behind the stock
  const docs = new SheetBuilder('Documents')
  const docRows = res.lots.map((l) => [l.column, l.warehouse, l.pile, l.variety, l.received, l.document, l.customer, l.netBags])
  let dr = table(docs, 0, ['GSR column', 'Warehouse', 'Pile', 'Variety', 'Received', 'Document', 'Customer', 'Net bags'], docRows, [220, 150, 100, 110, 90, 140, 200, 100])
  docs.format(1, 7, dr, 7, BAGS_FORMAT)
  docs.set(dr + 1, 0, 'Total of the lots above (before the Stock Desk\'s opening-balance and closed-pile corrections)')
  docs.set(dr + 1, 7, res.lotsTotal)
  docs.format(dr + 1, 7, dr + 1, 7, BAGS_FORMAT)
  docs.set(dr + 2, 0, 'Total printed in the GSR'); docs.set(dr + 2, 7, res.palay.grandBags)
  docs.format(dr + 2, 7, dr + 2, 7, BAGS_FORMAT)
  docs.set(dr + 3, 0, 'Difference = corrections the Stock Desk applies (see the Tally on the Summary tab)'); docs.set(dr + 3, 7, res.palay.grandBags - res.lotsTotal)
  docs.format(dr + 3, 7, dr + 3, 7, BAGS_FORMAT)
  docs.boldRange(dr + 1, 0, dr + 3, 7)

  // Excluded
  const ex = new SheetBuilder('Excluded')
  const exRows = res.outside.map((w) => [w.name, w.facilityType ?? '', 'not facility type "Warehouse"; not part of the GSR'])
  table(ex, 0, ['Facility', 'Type', 'Reason'], exRows.length ? exRows : [['(none)', '', '']], [260, 140, 380])
  ex.set(exRows.length + 3, 0, 'Documents dated before the data start (September) are never counted.')

  // Settings used
  const st = new SheetBuilder('Settings used')
  const s = res.settings
  const setRows = [
    ['Warehouse columns', res.columns.map((g) => `${g.provinceName}: ${g.title} (code ${g.code || '-'}; ${g.labels.join(' + ')})`).join('\n')],
    ['Palay varieties', s.palayBlocks.map((b) => `${b.name} <- ${b.match.join(', ')}`).concat([`${s.pwBlock.name} <- ${s.pwBlock.match.join(', ')}`]).join('\n')],
    ['Grade letters (by month row)', Object.entries(s.grades).map(([k, v]) => `${k} months: ${v}`).join('\n')],
    ['Memo', `FOR: ${s.memo.forName}, ${s.memo.forTitle}, ${s.memo.forOffice}\nPrepared by: ${s.memo.preparedBy}, ${s.memo.preparedByTitle}`],
    ['Period title', periodTitle(res.from, res.to)],
  ]
  table(st, 0, ['Setting', 'Value at the time of this run'], setRows, [220, 700])

  return { name: `${res.fileName} - AUDIT`, sheets: [summary, cells, docs, ex, st] }
}
