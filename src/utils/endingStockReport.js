// NFA ending stock balance per variety (the monthly form): month-end stock per
// province, paddy by variety and local rice by variety, in net bags. READ-ONLY.
// The figures are the Stock Book's own Summary at the last day of the month, so an
// opening-balance override an Admin saved shows here exactly as it does there.

import { buildSummary, longDate, toUnit } from './inventoryReport.js'

const PALAY_COLUMNS = ['PDs', 'PDm', 'PD1', 'PD2']
const RICE_COLUMNS = ['WD1', 'WD0', 'RWD1']
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

/** The form's variety column: PD1m-A, PD1s-A, PD1-B all count as PD1; PDm, PDs, WD1, RWD1 stay as they are. */
export const varietyGroup = (name) => String(name ?? '').replace(/-[A-Za-z]$/, '').replace(/^(PD\d+)[ms]$/i, '$1')

export const monthEnd = (month) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export const monthTitle = (month) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

const round2 = (n) => Math.round(n * 100) / 100

const table = ({ title, subtitle, groupLabel, columns, provinces, values, unit }) => {
  const get = (province, col) => values.get(province)?.get(col) ?? 0
  const cell = (kilos) => { const v = round2(toUnit(kilos, unit)); return v === 0 ? null : v }
  const rowFor = (province) => {
    const kilos = columns.map((c) => get(province, c))
    return { kind: 'row', first: province.toUpperCase(), dash: true, cells: [...kilos.map(cell), cell(kilos.reduce((s, v) => s + v, 0))] }
  }
  const sums = columns.map((c) => provinces.reduce((s, p) => s + get(p, c), 0))
  const rows = [
    ...provinces.map(rowFor),
    { kind: 'total', first: 'TOTAL', dash: true, cells: [...sums.map(cell), cell(sums.reduce((s, v) => s + v, 0))] },
  ]
  const width = columns.length + 1
  return {
    title, subtitle,
    head: [
      [{ t: 'PROVINCE', span: 1 }, { t: groupLabel, span: width, tone: 0 }],
      [{ t: '', span: 1 }, ...columns.map((c) => ({ t: c, span: 1, tone: 0 })), { t: 'TOTAL', span: 1, tone: 0 }],
    ],
    edges: [...columns.map((_, i) => (i === 0 ? null : 'var')), 'wh'],
    tones: Array.from({ length: width }, () => 0),
    rows,
  }
}

/**
 * @param ctx the report context (makeContext), inputs the lot-engine inputs, month 'YYYY-MM'
 * @returns { heading, asOf, tables: [paddy, localRice] }
 */
export const buildEndingStock = (ctx, inputs, { month, todayISO, provinceNames = [], unit = 'b' }) => {
  const end = monthEnd(month)
  const asOf = end > todayISO ? todayISO : end
  const summary = buildSummary(ctx, inputs, { asOf, filters: { byProducts: false } })

  // province -> commodity -> form column -> kilos
  const values = { Palay: new Map(), Rice: new Map() }
  const seen = { Palay: new Set(), Rice: new Set() }
  const provinces = new Set(provinceNames)
  for (const p of summary.provinces) {
    provinces.add(p.name)
    for (const r of p.rows) {
      for (const [id, kilos] of r.values) {
        const [commodity, variety] = id.split('|')
        if (!values[commodity]) continue
        const col = varietyGroup(variety)
        const byCol = values[commodity].get(p.name) ?? new Map()
        byCol.set(col, (byCol.get(col) ?? 0) + kilos)
        values[commodity].set(p.name, byCol)
        if (Math.abs(kilos) >= 0.5) seen[commodity].add(col)
      }
    }
  }
  const provinceList = [...provinces].sort(natural)
  // the form's own columns always show; any other variety with stock is added after them
  const columnsFor = (commodity, fixed) => [...fixed, ...[...seen[commodity]].filter((c) => !fixed.includes(c)).sort(natural)]
  const unitText = unit === 'mt' ? 'MT' : 'net bags'
  const subtitle = `As of ${longDate(asOf)} · ${unitText}`
  return {
    heading: `V. NFA ENDING STOCK BALANCE PER VARIETY AS OF ${monthTitle(month)}`,
    asOf,
    tables: [
      table({ title: `TABLE I - NFA ENDING INVENTORY OF PADDY (${unitText} per stock report)`, subtitle, groupLabel: 'PALAY', columns: columnsFor('Palay', PALAY_COLUMNS), provinces: provinceList, values: values.Palay, unit }),
      table({ title: `TABLE II - NFA ENDING INVENTORY OF LOCAL RICE (${unitText} per stock report)`, subtitle, groupLabel: 'LOCAL RICE', columns: columnsFor('Rice', RICE_COLUMNS), provinces: provinceList, values: values.Rice, unit }),
    ],
  }
}
