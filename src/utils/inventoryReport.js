// Daily Inventory report builders - READ-ONLY, pure functions (no database).
// Turn the lot engine's output (inventoryLots.js) into the tables the report
// screens, the PDF and the Excel export all share, so the three always agree.
//
// Units: everything is carried in KILOS. Net bags = kilos / 50 (the same as
// Home > Stocks), MT = kilos / 1000.

import { buildLots, buildLotsDetailed, lotAgeMonths } from './inventoryLots.js'

export const NET_BAG_KG = 50
export const toUnit = (kilos, unit) => (unit === 'mt' ? kilos / 1000 : kilos / NET_BAG_KG)

const EPS_KG = 0.5 // anything smaller than half a kilo is treated as empty

// Age brackets (months, upper edge inclusive). 'coarse' is the default view.
export const AGE_SETS = {
  coarse: {
    Rice: [{ label: '0-3', max: 3 }, { label: '>3', max: Infinity }],
    Palay: [{ label: '0-6', max: 6 }, { label: '6.1-12', max: 12 }, { label: '>12', max: Infinity }],
  },
  fine: {
    Rice: [
      { label: '0-3', max: 3 }, { label: '3.1-6.0', max: 6 }, { label: '6.1-9.0', max: 9 },
      { label: '9.1-12.0', max: 12 }, { label: '>12', max: Infinity },
    ],
    Palay: [{ label: '0-6', max: 6 }, { label: '6.1-12', max: 12 }, { label: '>12', max: Infinity }],
  },
}

const COMMODITY_ORDER = { Palay: 0, Rice: 1, 'By Products': 2 }
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

/** "ALB-BSI B" -> "BSI B"; combined -> "BSI" (GID names keep their letter). */
export const warehouseLabel = (name, combine) => {
  const base = (name ?? '').replace(/^[A-Z]{2,6}[\s-]+/, '').trim()
  if (!combine || /GID/i.test(base)) return base
  return base.replace(/\s[A-Z]$/, '')
}

const commodityOf = (pile) => (pile?.cerealType === 'Rice' || pile?.cerealType === 'Palay' ? pile.cerealType : 'By Products')

const bucketOf = (commodity, months, setName) => {
  const set = AGE_SETS[setName]?.[commodity]
  if (!set) return ''
  return set.find((b) => months <= b.max).label
}

/** Lookups shared by every builder. */
export const makeContext = ({ piles, warehouses, provinces, varieties, transactionTypes, combine = false, ageSet = 'coarse' }) => ({
  pileById: new Map(piles.map((p) => [p.pileId, p])),
  whById: new Map(warehouses.map((w) => [w.warehouseId, w])),
  provById: new Map(provinces.map((p) => [p.provinceId ?? p.id, p])),
  varietyName: new Map(varieties.map((v) => [v.varietyId, v.name])),
  typeName: new Map(transactionTypes.map((t) => [t.transactionTypeId ?? t.id, t.name])),
  combine, ageSet,
})

const rowOf = (ctx, pile) => {
  const wh = ctx.whById.get(pile?.warehouseId)
  const prov = ctx.provById.get(wh?.provinceId)
  return { province: prov?.name ?? '(no province)', label: warehouseLabel(wh?.name, ctx.combine) }
}
const rowKey = (r) => `${r.province}|${r.label}`
const colId = (commodity, variety, bucket) => `${commodity}|${variety}|${bucket}`

const accept = (filters, pile, ctx) => {
  if (!pile) return false
  if (filters.warehouseIds && !filters.warehouseIds.has(pile.warehouseId)) return false
  if (filters.provinceId) {
    const wh = ctx.whById.get(pile.warehouseId)
    if (wh?.provinceId !== filters.provinceId) return false
  }
  if (filters.commodity && commodityOf(pile) !== filters.commodity) return false
  return true
}

const put = (grid, rk, cid, kilos) => {
  let row = grid.get(rk)
  if (!row) { row = new Map(); grid.set(rk, row) }
  row.set(cid, (row.get(cid) ?? 0) + kilos)
}

const lotCol = (ctx, pile, varietyId, lotDate, asOf) => {
  const commodity = commodityOf(pile)
  const variety = ctx.varietyName.get(varietyId ?? pile?.varietyId) ?? (commodity === 'By Products' ? 'BY-PRODUCTS' : '?')
  const months = lotAgeMonths(lotDate, asOf) ?? 0
  return { commodity, variety, bucket: bucketOf(commodity, months, ctx.ageSet) }
}

/** Stock grid (rowKey -> colId -> kilos) of a lot state, aged as of `ageDate`. */
const stockGrid = (ctx, state, ageDate, filters) => {
  const grid = new Map()
  for (const [pileId, st] of state) {
    const pile = ctx.pileById.get(pileId)
    if (!accept(filters, pile, ctx)) continue
    const rk = rowKey(rowOf(ctx, pile))
    for (const lot of st.lots) {
      const c = lotCol(ctx, pile, lot.varietyId, lot.date, ageDate)
      put(grid, rk, colId(c.commodity, c.variety, c.bucket), lot.kilos)
    }
  }
  return grid
}

const parseCol = (id) => {
  const [commodity, variety, bucket] = id.split('|')
  return { id, commodity, variety, bucket }
}
const bucketRank = (c, setName) => {
  const set = AGE_SETS[setName]?.[c.commodity]
  return set ? set.findIndex((b) => b.label === c.bucket) : 0
}
const sortCols = (cols, setName) => cols.sort((a, b) =>
  (COMMODITY_ORDER[a.commodity] - COMMODITY_ORDER[b.commodity]) || natural(a.variety, b.variety) || (bucketRank(a, setName) - bucketRank(b, setName)))

const gridCols = (grids) => {
  const ids = new Set()
  for (const g of grids) for (const row of g.values()) for (const [id, v] of row) if (Math.abs(v) >= EPS_KG) ids.add(id)
  return ids
}

/**
 * Summary: stock per warehouse x variety x age bracket as of one date, with a
 * subtotal per province and a branch total. Empty rows/columns are dropped.
 */
export const buildSummary = (ctx, inputs, { asOf, filters = {}, sort = 'name' }) => {
  const state = buildLots({ ...inputs, asOf })
  const grid = stockGrid(ctx, state, asOf, filters)
  const cols = sortCols([...gridCols([grid])].map(parseCol), ctx.ageSet)

  const byProvince = new Map()
  for (const [rk, row] of grid) {
    if (![...row.values()].some((v) => Math.abs(v) >= EPS_KG)) continue
    const [province, label] = rk.split('|')
    if (!byProvince.has(province)) byProvince.set(province, [])
    byProvince.get(province).push({ label, values: row, total: [...row.values()].reduce((s, v) => s + v, 0) })
  }
  const sum = (rows) => {
    const m = new Map()
    for (const r of rows) for (const [id, v] of r.values) m.set(id, (m.get(id) ?? 0) + v)
    return m
  }
  const provinces = [...byProvince.keys()].sort(natural).map((name) => {
    const rows = byProvince.get(name).sort((a, b) => (sort === 'stock' ? b.total - a.total : natural(a.label, b.label)))
    return { name, rows, subtotal: sum(rows) }
  })
  return { cols, provinces, total: sum(provinces.flatMap((p) => p.rows)) }
}

/**
 * Daily ledger for [from, to]: per day the beginning stock, age shift, ADD and
 * LESS by transaction type, and ending stock, for every warehouse x variety x
 * age bracket that has anything in the period. A day with no movement and no
 * age shift is omitted; an "ADJUSTMENT" row appears only if the figures do not
 * balance (a late-entered beginning balance, for example).
 */
export const buildLedger = (ctx, inputs, { from, to, filters = {} }) => {
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
  const days = []
  for (let d = from; d <= to && days.length < 93; d = addDays(d, 1)) days.push(d)

  const { movements } = buildLotsDetailed({ ...inputs, asOf: to })
  const stateAt = new Map()
  const getState = (d) => { if (!stateAt.has(d)) stateAt.set(d, buildLots({ ...inputs, asOf: d })); return stateAt.get(d) }

  const typeLabel = (m) => m.label ?? ctx.typeName.get(m.typeId) ?? 'OTHER'
  const diff = (a, b, sign = 1) => {
    const out = new Map()
    for (const g of [[a, 1], [b, -sign]]) for (const [rk, row] of g[0]) for (const [id, v] of row) put(out, rk, id, g[1] * v)
    return out
  }
  const nonEmpty = (g) => [...g.values()].some((row) => [...row.values()].some((v) => Math.abs(v) >= EPS_KG))

  const out = []
  const allGrids = []
  for (const d of days) {
    const prev = addDays(d, -1)
    const beg = stockGrid(ctx, getState(prev), prev, filters)
    const aged = stockGrid(ctx, getState(prev), d, filters)
    const end = stockGrid(ctx, getState(d), d, filters)
    const shift = diff(aged, beg)

    const adds = new Map()
    const lesses = new Map()
    for (const m of movements) {
      if (m.date !== d) continue
      const pile = ctx.pileById.get(m.pileId)
      if (!accept(filters, pile, ctx)) continue
      const c = lotCol(ctx, pile, m.varietyId, m.lotDate, d)
      const target = m.kind === 'add' ? adds : lesses
      const label = typeLabel(m)
      if (!target.has(label)) target.set(label, new Map())
      put(target.get(label), rowKey(rowOf(ctx, pile)), colId(c.commodity, c.variety, c.bucket), m.kilos)
    }
    const net = new Map()
    for (const g of [aged]) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, v)
    for (const g of adds.values()) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, v)
    for (const g of lesses.values()) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, -v)
    const adjustment = diff(end, net)

    const hasMove = adds.size > 0 || lesses.size > 0 || nonEmpty(shift) || nonEmpty(adjustment)
    if (!hasMove) continue
    const order = (a, b) => (a === 'BEGINNING BALANCE' ? -1 : b === 'BEGINNING BALANCE' ? 1 : a === 'TRANSFER' ? 1 : b === 'TRANSFER' ? -1 : natural(a, b))
    const rec = {
      date: d, beginning: beg, shift: nonEmpty(shift) ? shift : null,
      adds: [...adds].sort((a, b) => order(a[0], b[0])).map(([label, grid]) => ({ label, grid })),
      lesses: [...lesses].sort((a, b) => order(a[0], b[0])).map(([label, grid]) => ({ label, grid })),
      adjustment: nonEmpty(adjustment) ? adjustment : null, ending: end,
    }
    out.push(rec)
    allGrids.push(beg, end, ...(rec.shift ? [rec.shift] : []), ...rec.adds.map((x) => x.grid), ...rec.lesses.map((x) => x.grid))
  }

  // Columns: only warehouse x variety x bracket combinations with something in them.
  const used = new Set()
  for (const g of allGrids) for (const [rk, row] of g) for (const [id, v] of row) if (Math.abs(v) >= EPS_KG) used.add(`${rk}|${id}`)
  const cols = [...used].map((k) => {
    const [province, label, commodity, variety, bucket] = k.split('|')
    return { key: k, province, label, rowKey: `${province}|${label}`, ...parseCol(`${commodity}|${variety}|${bucket}`) }
  })
  cols.sort((a, b) => natural(a.province, b.province) || natural(a.label, b.label)
    || (COMMODITY_ORDER[a.commodity] - COMMODITY_ORDER[b.commodity]) || natural(a.variety, b.variety)
    || (bucketRank(a, ctx.ageSet) - bucketRank(b, ctx.ageSet)))
  return { cols, days: out }
}

/** Value of a ledger/summary grid cell in kilos (0 when absent). */
export const cell = (grid, rk, cid) => grid?.get(rk)?.get(cid) ?? 0

// ---------------------------------------------------------------------------
// Table models: one neutral shape that the screen, the Excel export (and later
// the PDF / Google Sheet) all render, so they can never disagree.
//   { title, subtitle, head: [[{ t, span }]], rows: [{ kind, first, cells, dash }], empty? }
// `cells` hold numbers already converted to the chosen unit (null = blank).
// ---------------------------------------------------------------------------

const groupHead = (cols, pick) => {
  const out = []
  for (const c of cols) {
    const t = pick(c)
    const last = out[out.length - 1]
    if (last && last.key === `${t}` && last.group === c.__group) last.span += 1
    else out.push({ t, span: 1, key: `${t}`, group: c.__group })
  }
  return out.map(({ t, span }) => ({ t, span }))
}

const COMMODITY_LABEL = { Palay: 'PALAY', Rice: 'RICE', 'By Products': 'BY-PRODUCTS' }
const num = (kilos, unit) => (Math.abs(kilos) < EPS_KG ? null : toUnit(kilos, unit))
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}` }
export const unitLabel = (unit) => (unit === 'mt' ? 'in metric tons (net kg / 1,000)' : 'in net bags of 50 kg')

export const summaryModel = (summary, unit, { asOf, scope = 'ALBAY BRANCH' }) => {
  const cols = summary.cols.map((c) => ({ ...c, __group: c.commodity }))
  const head = [
    [{ t: 'WAREHOUSE', span: 1 }, ...groupHead(cols, (c) => COMMODITY_LABEL[c.commodity]), { t: 'TOTAL', span: 1 }],
    [{ t: '', span: 1 }, ...groupHead(cols.map((c) => ({ ...c, __group: `${c.commodity}|${c.variety}` })), (c) => c.variety), { t: '', span: 1 }],
    [{ t: '', span: 1 }, ...cols.map((c) => ({ t: c.bucket || 'no age', span: 1 })), { t: '', span: 1 }],
  ]
  const line = (first, values, kind) => {
    const cells = summary.cols.map((c) => num(values.get(c.id) ?? 0, unit))
    const total = [...values.values()].reduce((s, v) => s + v, 0)
    return { kind, first, cells: [...cells, num(total, unit)], dash: true }
  }
  const rows = []
  for (const p of summary.provinces) {
    rows.push({ kind: 'section', first: p.name.toUpperCase(), cells: [] })
    for (const r of p.rows) rows.push(line(r.label, r.values, 'row'))
    rows.push(line(`SUBTOTAL ${p.name.toUpperCase()}`, p.subtotal, 'sub'))
  }
  if (summary.provinces.length > 0) rows.push(line('TOTAL BRANCH', summary.total, 'total'))
  return {
    title: 'DAILY INVENTORY SUMMARY', subtitle: `${scope} · stock as of ${longDate(asOf)} · ${unitLabel(unit)}`,
    head, rows, empty: summary.provinces.length === 0 ? 'No stock found for these filters.' : null,
  }
}

export const ledgerModel = (ledger, unit, { from, to, scope = 'ALBAY BRANCH' }) => {
  const cols = ledger.cols.map((c) => ({ ...c, __group: c.rowKey }))
  const head = [
    [{ t: 'DATE / PARTICULARS', span: 1 }, ...groupHead(cols, (c) => c.label)],
    [{ t: '', span: 1 }, ...groupHead(cols.map((c) => ({ ...c, __group: `${c.rowKey}|${c.commodity}|${c.variety}` })), (c) => c.variety)],
    [{ t: '', span: 1 }, ...cols.map((c) => ({ t: c.bucket || 'no age', span: 1 }))],
  ]
  const line = (first, grid, kind, dash = false) => ({
    kind, first, dash,
    cells: ledger.cols.map((c) => num(cell(grid, c.rowKey, c.id), unit)),
  })
  const rows = []
  const day = ledger.days
  if (day.length > 0) rows.push(line(`${longDate(day[0].date)} · BEGINNING INVENTORY`, day[0].beginning, 'beg', true))
  for (const d of day) {
    const [, m, dd] = d.date.split('-').map(Number)
    const stamp = `${MONTHS[m - 1]} ${dd}`
    if (d.shift) rows.push(line(`${stamp} · AGE SHIFT (stock moving to the next bracket)`, d.shift, 'row'))
    if (d.adds.length > 0) {
      rows.push({ kind: 'add-label', first: `${stamp} · ADD:`, cells: [] })
      for (const a of d.adds) rows.push(line(a.label, a.grid, 'add'))
    }
    if (d.lesses.length > 0) {
      rows.push({ kind: 'less-label', first: d.adds.length > 0 ? 'LESS:' : `${stamp} · LESS:`, cells: [] })
      for (const l of d.lesses) rows.push(line(l.label, l.grid, 'less'))
    }
    if (d.adjustment) rows.push(line('ADJUSTMENT (pile closed or data gap)', d.adjustment, 'row'))
    rows.push(line('ENDING INVENTORY', d.ending, 'end', true))
  }
  return {
    title: 'DAILY INVENTORY', subtitle: `${scope} · ${longDate(from)} to ${longDate(to)} · ${unitLabel(unit)}`,
    head, rows, empty: day.length === 0 ? 'No movement in this period for these filters.' : null,
  }
}
