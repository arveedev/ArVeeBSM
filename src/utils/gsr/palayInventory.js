// Sheet 1 of the GSR: PALAY INVENTORY (pure, no database).
// Palay stock by variety x month bracket x warehouse column (lettered warehouses merged by code), province sub-totals and a grand total,
// the "PD" roll-up by age band, PW, and the memo header. The numbers come from the Stock Desk Summary (buildSummary), so this sheet and
// the Stock Desk can never disagree. A cell with no stock is BLANK, never 0.

import { SheetBuilder, refOf, rangeOf, BAGS_FORMAT } from './sheetModel.js'
import { blockOfVariety } from './settings.js'
import { periodTitle, memoDateText } from './period.js'
import { longDate } from '../inventoryReport.js'

export const SHEET_PALAY = 'PALAY INVENTORY'
const NET_BAG_KG = 50
// A figure under 0.1 kg (0.002 bag) is rounding dust, not stock: it prints blank (the tally allows for it, see prepare.js)
const MIN_KG = 0.1
const BRACKETS = 26 // 0-1.0 ... 25.1-26.0, then one overflow row, in every PD variety

// "0.1-1.0" -> 0, "3.1-4.0" -> 3, ">36" -> 36 (the Stock Desk's monthly brackets)
export const monthIndexOf = (bucket) => {
  if (String(bucket).startsWith('>')) return Number.parseInt(String(bucket).slice(1), 10)
  const m = /^(\d+)\.1-/.exec(bucket)
  if (m) return Number(m[1])
  return 0 // "0.1-1.0"
}
const monthsLabel = (i) => (i === 0 ? '0 - 1.0' : `${i}.1 - ${i + 1}.0`)
const round6 = (n) => Math.round(n * 1e6) / 1e6

const ROLLUP_BANDS = [
  { label: '0 - 2.0', grade: 'A', from: 0, to: 1 }, { label: '2.1 - 4.0', grade: '', from: 2, to: 3 },
  { label: '4.1 - 5.0', grade: 'B', from: 4, to: 4 }, { label: '5.1 - 6.0', grade: '', from: 5, to: 5 },
  { label: '6.1 - 9.0', grade: 'C', from: 6, to: 8 }, { label: '9.1 - 12.0', grade: '', from: 9, to: 11 },
  { label: '12.1 - 15.0', grade: 'D', from: 12, to: 14 }, { label: '15.1 - 18.0', grade: '', from: 15, to: 17 },
  { label: '>18.0', grade: '', from: 18, to: Infinity },
]

/**
 * @param summary  buildSummary(...) of the palay stock of the Warehouse-type facilities, as of the last day of the period
 * @param columns  warehouseColumns(...)
 * @returns { sheet, cells, unplaced, unmapped, placedKilos, grandBags }
 */
export const buildPalayInventory = ({ summary, columns, settings, memoISO, from, to }) => {
  const labelToGroup = new Map()
  for (const g of columns) for (const l of g.labels) labelToGroup.set(`${g.provinceName}|${l}`, g)

  // 1. Place every palay figure of the Summary into (column group, report variety, month index).
  const kg = new Map() // groupKey -> Map(block -> Map(idx -> { kilos, parts }))
  const unplaced = []
  const unmapped = []
  let placedKilos = 0
  for (const prov of summary.provinces) {
    for (const row of prov.rows) {
      const g = labelToGroup.get(`${prov.name}|${row.label}`)
      for (const [id, kilos] of row.values) {
        const [commodity, variety, bucket] = id.split('|')
        if (commodity !== 'Palay' || Math.abs(kilos) < 0.0005) continue
        if (!g) { unplaced.push({ warehouse: `${prov.name} ${row.label}`, variety, bucket, kilos }); continue }
        const block = blockOfVariety(settings, variety)
        if (!block) { unmapped.push({ warehouse: `${prov.name} ${row.label}`, variety, bucket, kilos }); continue }
        const idx = monthIndexOf(bucket)
        let byBlock = kg.get(g.key)
        if (!byBlock) { byBlock = new Map(); kg.set(g.key, byBlock) }
        let byIdx = byBlock.get(block)
        if (!byIdx) { byIdx = new Map(); byBlock.set(block, byIdx) }
        const cur = byIdx.get(idx) ?? { kilos: 0, parts: [] }
        cur.kilos += kilos
        cur.parts.push({ warehouse: row.label, variety, bucket, kilos })
        byIdx.set(idx, cur)
        placedKilos += kilos
      }
    }
  }
  const take = (g, block, test) => {
    const byIdx = kg.get(g.key)?.get(block)
    let kilos = 0
    const parts = []
    if (byIdx) for (const [idx, cur] of byIdx) if (test(idx)) { kilos += cur.kilos; parts.push(...cur.parts) }
    return { kilos, parts }
  }

  // 2. Column layout: A variety, B age grade, C months, then per province its warehouses and a SUB-TOTAL, then GRAND TOTAL.
  const provinces = [...new Set(columns.map((g) => g.provinceName))]
  const cols = []
  let c = 3
  const provSpans = provinces.map((name) => {
    const gs = columns.filter((g) => g.provinceName === name)
    const first = c
    gs.forEach((g) => { cols.push({ g, c }); c += 1 })
    const sub = c
    c += 1
    return { name, first, last: sub - 1, sub, groups: gs }
  })
  const grandC = c
  const sheet = new SheetBuilder(SHEET_PALAY)
  const cells = [] // the audit's record of every figure
  const numAt = (r, cc) => { const x = sheet.get(r, cc); return x != null && typeof x === 'object' ? x.v : (typeof x === 'number' ? x : 0) }
  sheet.colWidths = { 0: 90, 1: 55, 2: 100 }
  for (let k = 3; k <= grandC; k++) sheet.colWidths[k] = 82

  // 3. Memo header
  const m = settings.memo
  sheet.set(1, 0, memoDateText(memoISO))
  sheet.set(3, 0, `MEMO ${memoISO.slice(0, 4)}`)
  sheet.set(4, 0, `${m.refPrefix}-${memoISO.slice(5, 7)}-_______________`)
  sheet.set(6, 0, 'FOR            :'); sheet.set(6, 2, m.forName)
  sheet.set(7, 2, m.forTitle)
  sheet.set(8, 2, m.forOffice)
  sheet.set(10, 0, 'SUBJECT:'); sheet.set(10, 2, `GRAINS SITUATIONER REPORT FOR ${periodTitle(from, to)}`)
  sheet.set(12, 0, 'I.A. PALAY  INVENTORY  PER VARIETY, AGE AND PROVINCE')
  sheet.boldRange(1, 0, 12, 2)

  // 4. Column headers
  let r = 14
  sheet.set(r, 0, 'VARIETY'); sheet.set(r, 1, 'AGE'); sheet.set(r, 2, 'MONTHS')
  sheet.merge(r, 0, r + 1, 0); sheet.merge(r, 1, r + 1, 1); sheet.merge(r, 2, r + 1, 2)
  for (const p of provSpans) { sheet.set(r, p.first, p.name.toUpperCase()); sheet.merge(r, p.first, r, p.sub) }
  sheet.set(r, grandC, 'GRAND TOTAL'); sheet.merge(r, grandC, r + 1, grandC)
  for (const { g, c: cc } of cols) sheet.set(r + 1, cc, g.title)
  for (const p of provSpans) sheet.set(r + 1, p.sub, 'SUB-TOTAL')
  sheet.boldRange(r, 0, r + 1, grandC)
  sheet.fill(r, 0, r + 1, grandC, '#d9ead3')
  sheet.alignRange(r, 0, r + 1, grandC, 'center')
  const headerLast = r + 1
  r += 2

  // helpers to write a row of figures: warehouse cells, then province sub-totals, then the grand total
  const finishRow = (row) => {
    for (const p of provSpans) {
      if (p.groups.length === 0) continue
      const v = round6(Array.from({ length: p.last - p.first + 1 }, (_, i) => numAt(row, p.first + i)).reduce((a, b) => a + b, 0))
      sheet.set(row, p.sub, { f: `=SUM(${rangeOf(row, p.first, row, p.last)})`, v })
    }
    const total = round6(provSpans.reduce((a, p) => a + numAt(row, p.sub), 0))
    sheet.set(row, grandC, { f: `=${provSpans.map((p) => refOf(row, p.sub)).join('+')}`, v: total })
  }
  const sumRows = (row, rowsFrom, rowsTo) => {
    for (const cc of [...cols.map((x) => x.c), ...provSpans.map((p) => p.sub), grandC]) {
      let v = 0
      for (let x = rowsFrom; x <= rowsTo; x++) v += numAt(x, cc)
      sheet.set(row, cc, { f: `=SUM(${rangeOf(rowsFrom, cc, rowsTo, cc)})`, v: round6(v) })
    }
  }
  const noteCells = (rowLabel, row, getter) => {
    for (const { g, c: cc } of cols) {
      const { kilos, parts } = getter(g)
      if (Math.abs(kilos) < MIN_KG) continue
      cells.push({ sheet: SHEET_PALAY, cell: refOf(row, cc), rowLabel, colLabel: `${g.provinceName} / ${g.title}`, value: kilos / NET_BAG_KG, parts })
    }
  }
  const writeFigures = (row, rowLabel, getter) => {
    for (const { g, c: cc } of cols) {
      const { kilos } = getter(g)
      if (Math.abs(kilos) >= MIN_KG) sheet.set(row, cc, round6(kilos / NET_BAG_KG))
    }
    noteCells(rowLabel, row, getter)
    finishRow(row)
  }

  const pdBlocks = settings.palayBlocks.map((b) => b.name)
  const blockRows = new Map() // block -> { first, last, sub, rowOfIdx: Map(idx -> row), overflowRow }
  const codeRow = r // the first block's header row also carries the warehouse codes
  const writeBlock = (name, specs, withCodes) => {
    sheet.set(r, 0, name)
    sheet.boldRange(r, 0, r, 0)
    if (withCodes) for (const { g, c: cc } of cols) { const n = Number(g.code); if (g.code && Number.isFinite(n)) sheet.set(r, cc, n) }
    r += 1
    const first = r
    const rowOfIdx = new Map()
    let overflowRow = null
    for (const spec of specs) {
      if (spec.grade) sheet.set(r, 1, spec.grade)
      sheet.set(r, 2, spec.label)
      writeFigures(r, `${name} ${spec.label} months`, (g) => take(g, name, spec.test))
      if (spec.idxs) for (const i of spec.idxs) rowOfIdx.set(i, r)
      if (spec.overflow) overflowRow = r
      r += 1
    }
    const last = r - 1
    sheet.set(r, 1, 'Sub- Total')
    sumRows(r, first, last)
    sheet.boldRange(r, 0, r, grandC)
    sheet.fill(r, 0, r, grandC, '#eef5ee')
    blockRows.set(name, { first, last, sub: r, rowOfIdx, overflowRow })
    r += 1
  }
  const bracketSpecs = () => [
    ...Array.from({ length: BRACKETS }, (_, i) => ({ idxs: [i], label: monthsLabel(i), grade: settings.grades[i + 1] ?? '', test: (x) => x === i })),
    { overflow: true, label: `>${BRACKETS}.0`, grade: '', test: (x) => x >= BRACKETS },
  ]
  pdBlocks.forEach((name, i) => writeBlock(name, bracketSpecs(), i === 0))

  // GRAND TOTAL of the PD varieties
  const pdGrand = r
  sheet.set(r, 0, 'GRAND TOTAL')
  for (const cc of [...cols.map((x) => x.c), ...provSpans.map((p) => p.sub), grandC]) {
    const refs = pdBlocks.map((b) => refOf(blockRows.get(b).sub, cc))
    const v = pdBlocks.reduce((a, b) => a + numAt(blockRows.get(b).sub, cc), 0)
    sheet.set(r, cc, { f: `=${refs.join('+')}`, v: round6(v) })
  }
  sheet.boldRange(r, 0, r, grandC)
  sheet.fill(r, 0, r, grandC, '#d9ead3')
  r += 1

  // "PD" roll-up by age band, built from the variety blocks above
  sheet.set(r, 0, 'PD')
  sheet.boldRange(r, 0, r, 0)
  r += 1
  const rollFirst = r
  for (const band of ROLLUP_BANDS) {
    if (band.grade) sheet.set(r, 1, band.grade)
    sheet.set(r, 2, band.label)
    for (const cc of [...cols.map((x) => x.c)]) {
      const refs = []
      let v = 0
      for (const b of pdBlocks) {
        const br = blockRows.get(b)
        for (const [i, row] of br.rowOfIdx) if (i >= band.from && i <= band.to) { refs.push(refOf(row, cc)); v += numAt(row, cc) }
        if (band.to === Infinity && br.overflowRow != null) { refs.push(refOf(br.overflowRow, cc)); v += numAt(br.overflowRow, cc) }
      }
      if (Math.abs(v) >= MIN_KG / NET_BAG_KG) sheet.set(r, cc, { f: `=${refs.join('+')}`, v: round6(v) })
    }
    finishRow(r)
    r += 1
  }
  const rollLast = r - 1
  sheet.set(r, 1, 'Sub- Total')
  sumRows(r, rollFirst, rollLast)
  sheet.boldRange(r, 0, r, grandC)
  sheet.fill(r, 0, r, grandC, '#eef5ee')
  const rollSub = r
  r += 1

  // PW
  writeBlock(settings.pwBlock.name, [
    { idxs: [0, 1], label: '0 - 2.0', grade: 'A', test: (x) => x <= 1 },
    { overflow: true, label: '>2.0', grade: '', test: (x) => x >= 2 },
  ], false)
  const pwSub = blockRows.get(settings.pwBlock.name).sub

  // final GRAND TOTAL = PD roll-up + PW
  const finalRow = r
  sheet.set(r, 0, 'GRAND TOTAL')
  for (const cc of [...cols.map((x) => x.c), ...provSpans.map((p) => p.sub), grandC]) {
    sheet.set(r, cc, { f: `=${refOf(rollSub, cc)}+${refOf(pwSub, cc)}`, v: round6(numAt(rollSub, cc) + numAt(pwSub, cc)) })
  }
  sheet.boldRange(r, 0, r, grandC)
  sheet.fill(r, 0, r, grandC, '#d9ead3')
  r += 2

  sheet.set(r, 0, `Note: Net bags of 50 kg, from the warehouse records in the BSM App as of ${longDate(to)}.`)
  r += 2
  sheet.set(r, 0, 'Prepared by:')
  r += 2
  sheet.set(r, 0, m.preparedBy)
  sheet.boldRange(r, 0, r, 0)
  sheet.set(r + 1, 0, m.preparedByTitle)

  sheet.format(headerLast + 1, 3, r, grandC, BAGS_FORMAT)
  sheet.format(codeRow, 3, codeRow, grandC, '0') // the warehouse codes are not quantities
  sheet.meta = { grandRow: finalRow, pdGrandRow: pdGrand, rollSubRow: rollSub, grandCol: grandC, columns: cols.map((x) => ({ c: x.c, title: x.g.title, code: x.g.code })) }
  const grandBags = numAt(finalRow, grandC)
  return { sheet, cells, unplaced, unmapped, placedKilos, grandBags }
}
