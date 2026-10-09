// Daily Inventory report builders - READ-ONLY, pure functions (no database).
// Turn the lot engine's output (inventoryLots.js) into the tables the report
// screens, the PDF and the Excel export all share, so the three always agree.
//
// Units: everything is carried in KILOS. Net bags = kilos / 50 (the same as
// Home > Stocks), MT = kilos / 1000.

import { buildLots, buildLotsDetailed, lotAgeMonths, DAYS_PER_MONTH } from './inventoryLots.js'

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

// Monthly brackets for every month up to 3 years (0.1-1.0, 1.1-2.0, ...).
const monthlySet = [
  ...Array.from({ length: 36 }, (_, i) => ({ label: i === 0 ? '0.1-1.0' : `${i}.1-${i + 1}.0`, max: i + 1 })),
  { label: '>36', max: Infinity },
]
AGE_SETS.monthly = { Rice: monthlySet, Palay: monthlySet }

const COMMODITY_ORDER = { Palay: 0, Rice: 1, 'By Products': 2 }
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

/** "ALB-BSI B" -> "BSI B"; combined -> "BSI" (a trailing single letter is dropped, e.g. GID 2 A -> GID 2, TABACO GID B -> TABACO GID). */
export const warehouseLabel = (name, combine) => {
  const base = (name ?? '').replace(/^[A-Z]{2,6}[\s-]+/, '').trim()
  return combine ? base.replace(/\s[A-Z]$/, '') : base
}

const commodityOf = (pile) => (pile?.cerealType === 'Rice' || pile?.cerealType === 'Palay' ? pile.cerealType : 'By Products')

const bucketOf = (commodity, months, setName) => {
  // By-products: just the number of months (0.1-1.0 -> "1 mo", 1.1-2.0 -> "2 mo" ...).
  if (commodity === 'By Products') return `${Math.max(1, Math.ceil(months - 1e-9))} mo`
  const set = AGE_SETS[setName]?.[commodity]
  if (!set) return ''
  return set.find((b) => months <= b.max).label
}

/** Lookups shared by every builder. */
export const makeContext = ({ piles, warehouses, provinces, varieties, transactionTypes, combine = false, ageSet = 'coarse', opening = null }) => ({
  opening,
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
// Opening-balance override (Daily inventory only): a per-cell correction, saved by an
// Admin, added to the stock of every date from its date onward. It lives in the
// report settings and never touches a pile, a transaction or any other screen.
const applyOpening = (ctx, grid, stateDate, filters) => {
  const o = ctx.opening
  if (!o || !stateDate || stateDate < o.date || o.ageSet !== ctx.ageSet) return
  for (const c of o.cells) {
    const like = { warehouseId: c.w, cerealType: c.c }
    if (!accept(filters, like, ctx)) continue
    put(grid, rowKey(rowOf(ctx, like)), colId(c.c, c.v, c.b), c.k)
  }
}

const stockGrid = (ctx, state, ageDate, filters, stateDate = null) => {
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
  applyOpening(ctx, grid, stateDate, filters)
  return grid
}

const parseCol = (id) => {
  const [commodity, variety, bucket] = id.split('|')
  return { id, commodity, variety, bucket }
}
const bucketRank = (c, setName) => {
  if (c.commodity === 'By Products') return parseInt(c.bucket, 10) || 0
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
  const grid = stockGrid(ctx, state, asOf, filters, asOf)
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
    const beg = stockGrid(ctx, getState(prev), prev, filters, prev)
    const aged = stockGrid(ctx, getState(prev), d, filters, prev)
    const end = stockGrid(ctx, getState(d), d, filters, d)
    const shift = diff(aged, beg)

    const adds = new Map()
    const lesses = new Map()
    const moves = []
    for (const m of movements) {
      if (m.date !== d) continue
      const pile = ctx.pileById.get(m.pileId)
      if (!accept(filters, pile, ctx)) continue
      const c = lotCol(ctx, pile, m.varietyId, m.lotDate, d)
      const target = m.kind === 'add' ? adds : lesses
      const label = typeLabel(m)
      if (!target.has(label)) target.set(label, new Map())
      const rk = rowKey(rowOf(ctx, pile))
      const cid = colId(c.commodity, c.variety, c.bucket)
      put(target.get(label), rk, cid, m.kilos)
      moves.push({ kind: m.kind, label, rowKey: rk, colId: cid, docType: m.docType, serial: m.serial, customer: m.customer, pile: pile.pileName, kilos: m.kilos })
    }
    const net = new Map()
    for (const g of [aged]) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, v)
    for (const g of adds.values()) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, v)
    for (const g of lesses.values()) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, -v)
    const adjustment = diff(end, net)

    const hasMove = adds.size > 0 || lesses.size > 0 || nonEmpty(adjustment)
    if (!hasMove) continue
    const order = (a, b) => (a === 'BEGINNING BALANCE' ? -1 : b === 'BEGINNING BALANCE' ? 1 : a === 'TRANSFER' ? 1 : b === 'TRANSFER' ? -1 : natural(a, b))
    const rec = {
      date: d, moves, beginning: beg, shift: nonEmpty(shift) ? shift : null,
      adds: [...adds].sort((a, b) => order(a[0], b[0])).map(([label, grid]) => ({ label, grid })),
      lesses: [...lesses].sort((a, b) => order(a[0], b[0])).map(([label, grid]) => ({ label, grid })),
      adjustment: nonEmpty(adjustment) ? adjustment : null, ending: end,
      // piles closed on this day (closing zeroes whatever stock was left)
      closedPiles: nonEmpty(adjustment)
        ? [...ctx.pileById.values()].filter((p) => p.closedDate === d && accept(filters, p, ctx)).map((p) => `${rowOf(ctx, p).label} ${p.pileName}`)
        : [],
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
  const openingDate = ctx.opening && ctx.opening.ageSet === ctx.ageSet ? ctx.opening.date : null
  return { cols, days: out, openingDate }
}

/** Value of a ledger/summary grid cell in kilos (0 when absent). */
export const cell = (grid, rk, cid) => grid?.get(rk)?.get(cid) ?? 0

// ---------------------------------------------------------------------------
// Table models: one neutral shape that the screen, the Excel export (and later
// the PDF / Google Sheet) all render, so they can never disagree.
//   { title, subtitle, head: [[{ t, span, tone }]], edges, tones, rows: [...], empty? }
// `cells` hold numbers already converted to the chosen unit (null = blank).
// `edges[i]` marks where data column i starts a new warehouse/commodity ('wh')
// or a new variety ('var'); `tones[i]` (0/1) alternates per warehouse/commodity
// so neighbouring groups are visibly different.
// ---------------------------------------------------------------------------

const COMMODITY_LABEL = { Palay: 'PALAY', Rice: 'RICE', 'By Products': 'BY-PRODUCTS' }
const num = (kilos, unit) => (Math.abs(kilos) < EPS_KG ? null : Math.round(toUnit(kilos, unit) * 10000) / 10000)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}` }
export const unitLabel = (unit) => (unit === 'mt' ? 'in metric tons (net kg / 1,000)' : 'in net bags of 50 kg')

// Header row from a per-column key: consecutive equal keys merge into one cell.
const headRow = (cols, keyOf, textOf, tones) => {
  const out = []
  cols.forEach((c, i) => {
    const k = keyOf(c)
    const last = out[out.length - 1]
    if (last && last.k === k) last.span += 1
    else out.push({ k, t: textOf(c), span: 1, tone: tones[i] })
  })
  return out.map(({ t, span, tone }) => ({ t, span, tone }))
}

// Where each column starts a new top group ('wh') or a new variety ('var'), and
// an alternating tone per top group.
const edgesAndTones = (cols, topKey) => {
  const edges = []
  const tones = []
  let tone = 0
  cols.forEach((c, i) => {
    const prev = cols[i - 1]
    if (!prev || topKey(prev) !== topKey(c)) { edges.push(i === 0 ? null : 'wh'); if (i > 0) tone = 1 - tone }
    else if (prev.variety !== c.variety) edges.push('var')
    else edges.push(null)
    tones.push(tone)
  })
  return { edges, tones }
}

export const summaryModel = (summary, unit, { asOf, scope = 'ALBAY BRANCH' }) => {
  const cols = summary.cols
  const { edges, tones } = edgesAndTones(cols, (c) => c.commodity)
  const head = [
    [{ t: 'WAREHOUSE', span: 1 }, ...headRow(cols, (c) => c.commodity, (c) => COMMODITY_LABEL[c.commodity], tones), { t: 'TOTAL', span: 1, tone: 0 }],
    [{ t: '', span: 1 }, ...headRow(cols, (c) => `${c.commodity}|${c.variety}`, (c) => c.variety, tones), { t: '', span: 1, tone: 0 }],
    [{ t: '', span: 1 }, ...cols.map((c, i) => ({ t: c.bucket, span: 1, tone: tones[i] })), { t: '', span: 1, tone: 0 }],
  ]
  const line = (first, values, kind) => {
    const cells = cols.map((c) => num(values.get(c.id) ?? 0, unit))
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
    head, edges: [...edges, 'wh'], tones: [...tones, 0], rows,
    empty: summary.provinces.length === 0 ? 'No stock found for these filters.' : null,
  }
}

// The documents behind one ADD / LESS value (the old sheet showed them as a cell note).
const notesFor = (moves, kind, label, c, unit) => {
  const lines = moves
    .filter((m) => m.kind === kind && m.label === label && m.rowKey === c.rowKey && m.colId === c.id)
    .map((m) => ({ doc: `${m.docType ?? ''} ${m.serial ?? ''}`.trim(), customer: m.customer ?? '', pile: m.pile ?? '', value: num(m.kilos, unit) ?? 0 }))
  return lines.length ? lines : null
}

export const ledgerModel = (ledger, unit, { from, to, scope = 'ALBAY BRANCH' }) => {
  const cols = ledger.cols
  const { edges, tones } = edgesAndTones(cols, (c) => c.rowKey)
  const head = [
    [{ t: 'DATE / PARTICULARS', span: 1 }, ...headRow(cols, (c) => c.rowKey, (c) => c.label, tones)],
    [{ t: '', span: 1 }, ...headRow(cols, (c) => `${c.rowKey}|${c.commodity}|${c.variety}`, (c) => c.variety, tones)],
    [{ t: '', span: 1 }, ...cols.map((c, i) => ({ t: c.bucket, span: 1, tone: tones[i] }))],
  ]
  const line = (first, grid, kind, dash = false) => ({
    kind, first, dash,
    cells: cols.map((c) => num(cell(grid, c.rowKey, c.id), unit)),
  })
  const rows = []
  const day = ledger.days
  if (day.length > 0) rows.push(line(`${longDate(day[0].date)} · BEGINNING INVENTORY`, day[0].beginning, 'beg', true))
  for (const d of day) {
    const [, m, dd] = d.date.split('-').map(Number)
    const stamp = `${MONTHS[m - 1]} ${dd}`
    if (d.adds.length > 0) {
      rows.push({ kind: 'add-label', first: `${stamp} · ADD:`, cells: [] })
      for (const a of d.adds) rows.push({ ...line(a.label, a.grid, 'add'), notes: cols.map((c) => notesFor(d.moves, 'add', a.label, c, unit)), day: d.date })
    }
    if (d.lesses.length > 0) {
      rows.push({ kind: 'less-label', first: d.adds.length > 0 ? 'LESS:' : `${stamp} · LESS:`, cells: [] })
      for (const l of d.lesses) rows.push({ ...line(l.label, l.grid, 'less'), notes: cols.map((c) => notesFor(d.moves, 'less', l.label, c, unit)), day: d.date })
    }
    if (d.adjustment) rows.push(line(d.date === ledger.openingDate ? 'OPENING BALANCE OVERRIDE' : d.closedPiles?.length ? `ADJUSTMENT: pile closed (${d.closedPiles.join(', ')})` : 'ADJUSTMENT: stock changed with no ADD or LESS document', d.adjustment, 'row'))
    rows.push(line('ENDING INVENTORY', d.ending, 'end', true))
  }
  return {
    title: 'DAILY INVENTORY', subtitle: `${scope} · ${longDate(from)} to ${longDate(to)} · ${unitLabel(unit)}`,
    head, edges, tones, rows, colTitles: cols.map((c) => `${c.label} · ${c.variety} · ${c.bucket}`),
    empty: day.length === 0 ? 'No movement in this period for these filters.' : null,
  }
}

// ---------------------------------------------------------------------------
// Card models for small screens (same numbers, stacked instead of a wide table).
// ---------------------------------------------------------------------------

const lineLabel = (c) => `${c.variety} · ${c.bucket}`

export const summaryCards = (summary, unit) => {
  const mk = (values) => summary.cols
    .map((c) => ({ label: lineLabel(c), commodity: c.commodity, value: num(values.get(c.id) ?? 0, unit) }))
    .filter((l) => l.value != null)
  const total = (values) => num([...values.values()].reduce((s, v) => s + v, 0), unit) ?? 0
  return {
    provinces: summary.provinces.map((p) => ({
      name: p.name,
      warehouses: p.rows.map((r) => ({ label: r.label, total: total(r.values), lines: mk(r.values) })),
      subtotal: { total: total(p.subtotal), lines: mk(p.subtotal) },
    })),
    total: { total: total(summary.total), lines: mk(summary.total) },
  }
}

export const ledgerCards = (ledger, unit) => {
  const byWh = new Map()
  for (const c of ledger.cols) { if (!byWh.has(c.rowKey)) byWh.set(c.rowKey, []); byWh.get(c.rowKey).push(c) }
  return ledger.days.map((d) => ({
    date: d.date,
    warehouses: [...byWh].map(([rk, cols]) => {
      const lines = cols.map((c) => {
        const v = (g) => cell(g, rk, c.id)
        const adds = d.adds.map((a) => ({ label: a.label, v: num(v(a.grid), unit), lines: notesFor(d.moves, 'add', a.label, { rowKey: rk, id: c.id }, unit) })).filter((x) => x.v != null)
        const lesses = d.lesses.map((a) => ({ label: a.label, v: num(v(a.grid), unit), lines: notesFor(d.moves, 'less', a.label, { rowKey: rk, id: c.id }, unit) })).filter((x) => x.v != null)
        return {
          label: lineLabel(c), beg: num(v(d.beginning), unit), end: num(v(d.ending), unit),
          shift: null, adj: d.adjustment ? num(v(d.adjustment), unit) : null, adds, lesses,
        }
      }).filter((l) => l.beg != null || l.end != null || l.adj != null || l.adds.length || l.lesses.length)
      return { label: cols[0].label, lines }
    }).filter((w) => w.lines.length > 0),
  }))
}

export const checksModel = (checks, unit, { asOf }) => {
  const rows = []
  const section = (title, items, line) => {
    rows.push({ kind: 'section', first: title, cells: [] })
    if (items.length === 0) rows.push({ kind: 'row', first: 'None', cells: [null, null] })
    for (const it of items) rows.push({ kind: 'row', ...line(it) })
  }
  section('Warehouses using a start-date override', checks.overrides, (o) => ({ first: o.warehouse, cells: [`starts after ${longDate(o.date)}`, null] }))
  section('Authorized more than the stock available', checks.overAuthorized ?? [], (o) => ({ first: `AI ${o.aiNumber} · ${o.warehouse} · ${o.variety}`, cells: [`${o.customer} · ${longDate(o.date)}`, Math.round(toUnit(o.kilos, unit) * 100) / 100] }))
  section('Authority age group blank or unreadable (deducted from the oldest stock)', checks.noAgeGroup ?? [], (o) => ({ first: `AI ${o.aiNumber} · ${o.warehouse} · ${o.variety}`, cells: [`${o.customer} · ${longDate(o.date)}${o.ageGroup ? ` · "${o.ageGroup}"` : ''}`, Math.round(toUnit(o.kilos, unit) * 100) / 100] }))
  section('WSI not covered by an authority (not deducted)', checks.uncoveredWsi ?? [], (o) => ({ first: `WSI ${o.serial} · ${o.warehouse}${o.aiNumber ? ` · AI ${o.aiNumber}` : ''}`, cells: [`${o.customer} · ${longDate(o.date)}`, Math.round(toUnit(o.kilos, unit) * 100) / 100] }))
  section('Issued more than was received', checks.shortages, (o) => ({ first: o.name, cells: [o.events.map((e) => `${e.kind} ${e.serial} ${e.type}`).join('; ') || 'bags over', Math.round(o.bags * 100) / 100] }))
  section('Rebuilt stock differs from the pile balance (today)', checks.mismatches, (o) => ({ first: o.name, cells: [`stored ${Math.round(toUnit(o.stored, unit) * 100) / 100}${o.note ? ` - ${o.note}` : ''}`, Math.round(toUnit(o.rebuilt, unit) * 100) / 100] }))
  section('Age is approximate (no readable Date Received)', checks.approx, (o) => ({ first: o.name, cells: [`from ${longDate(o.date)}`, Math.round(toUnit(o.kilos, unit) * 100) / 100] }))
  section('Documents not assigned to a pile', checks.unassigned, (o) => ({ first: `${o.type} ${o.serial} · ${o.warehouse}`, cells: [longDate(o.date), o.bags] }))
  return {
    title: 'DATA CHECK', subtitle: `As of ${longDate(asOf)}`,
    head: [[{ t: 'ITEM', span: 1 }, { t: 'DETAIL', span: 1 }, { t: 'VALUE', span: 1 }]], edges: [null, null], tones: [0, 0], rows,
  }
}

// ---------------------------------------------------------------------------
// Age monitoring lists and data checks (read-only).
// ---------------------------------------------------------------------------

const addDaysISO = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/**
 * Lots about to move into the next age bracket (within `windowDays`) and the
 * oldest lots on hand. Each line is ONE lot, so only that lot moves, never the
 * whole pile. Quantities are kilos (convert with toUnit).
 */
export const buildAgeLists = (ctx, inputs, { asOf, filters = {}, windowDays = 30, topOld = 15 }) => {
  const state = buildLots({ ...inputs, asOf })
  const limit = addDaysISO(asOf, windowDays)
  const crossing = []
  const lots = []
  for (const [pileId, st] of state) {
    const pile = ctx.pileById.get(pileId)
    if (!accept(filters, pile, ctx)) continue
    const row = rowOf(ctx, pile)
    for (const lot of st.lots) {
      if (lot.kilos < EPS_KG) continue
      const c = lotCol(ctx, pile, lot.varietyId, lot.date, asOf)
      const months = lotAgeMonths(lot.date, asOf) ?? 0
      const base = {
        province: row.province, warehouse: row.label, variety: c.variety, commodity: c.commodity,
        pile: pile.pileName, lotDate: lot.date, months, kilos: lot.kilos, bucket: c.bucket,
        approx: lot.anchor === 'pile-date',
      }
      lots.push(base)
      // next boundary above the current age
      let boundary = null
      let nextLabel = null
      if (c.commodity === 'By Products') {
        boundary = Math.max(1, Math.ceil(months - 1e-9))
        nextLabel = `${boundary + 1} mo`
      } else {
        const set = AGE_SETS[ctx.ageSet]?.[c.commodity]
        const i = set ? set.findIndex((b) => b.label === c.bucket) : -1
        if (i >= 0 && Number.isFinite(set[i].max)) { boundary = set[i].max; nextLabel = set[i + 1].label }
      }
      if (boundary == null) continue
      const crossDate = addDaysISO(lot.date, Math.floor(boundary * DAYS_PER_MONTH) + 1)
      if (crossDate >= asOf && crossDate <= limit) crossing.push({ ...base, nextLabel, crossDate })
    }
  }
  crossing.sort((a, b) => (a.crossDate < b.crossDate ? -1 : a.crossDate > b.crossDate ? 1 : natural(a.warehouse, b.warehouse)))
  lots.sort((a, b) => b.months - a.months)
  return { crossing, oldest: lots.slice(0, topOld) }
}

/**
 * Data checks for the report: warehouses running on a start-date override,
 * piles issued more than received, lots with an approximate age, documents
 * not assigned to a pile after the start date, and piles whose rebuilt stock
 * differs from the pile's stored balance (as of today only).
 */
export const buildChecks = (ctx, inputs, { asOf, todayISO }) => {
  // piles are compared with PHYSICAL stock; authorities are checked on their own below
  const state = buildLots({ ...inputs, asOf, reserve: false })
  const reservedState = buildLots({ ...inputs, asOf, reserve: true })
  const overAuthorized = (reservedState.authShort ?? []).map((x) => ({
    aiNumber: x.aiNumber, date: x.date, kilos: x.kilos, customer: x.customer ?? '',
    warehouse: warehouseLabel(ctx.whById.get(x.warehouseId)?.name, false), variety: ctx.varietyName.get(x.varietyId) ?? '?',
    ageGroup: x.ageGroup ?? '',
  })).sort((a, b) => natural(a.warehouse, b.warehouse) || (a.date < b.date ? -1 : 1))
  const label = (id) => warehouseLabel(ctx.whById.get(id)?.name, false)
  const noAgeGroup = (reservedState.authNoAge ?? []).map((x) => ({
    aiNumber: x.aiNumber, date: x.date, kilos: x.kilos, customer: x.customer ?? '', ageGroup: x.ageGroup, warehouse: label(x.warehouseId), variety: ctx.varietyName.get(x.varietyId) ?? '?',
  })).sort((a, b) => natural(a.warehouse, b.warehouse) || (a.date < b.date ? -1 : 1))
  const uncoveredWsi = (reservedState.uncovered ?? []).map((x) => ({
    serial: x.serial, date: x.date, aiNumber: x.aiNumber, kilos: x.kilos, customer: x.customer ?? '', warehouse: label(x.warehouseId),
  })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const global = inputs.globalDataStartDate ?? null
  const overrides = []
  for (const w of inputs.warehouses) {
    if (w.reportingCutoffDate && global && w.reportingCutoffDate > global) overrides.push({ warehouse: warehouseLabel(w.name, false), date: w.reportingCutoffDate })
  }
  overrides.sort((a, b) => natural(a.warehouse, b.warehouse))

  const shortages = []
  const approx = []
  const mismatches = []
  for (const [pileId, st] of state) {
    const pile = ctx.pileById.get(pileId)
    const row = rowOf(ctx, pile)
    const name = `${row.label} · ${pile.pileName}`
    if (st.shortBags > 0) {
      shortages.push({
        name, bags: st.shortBags, kilos: st.shortKilos,
        events: st.shortEvents.map((e) => ({ serial: e.serial, date: e.date, kind: e.kind, type: ctx.typeName.get(e.typeId) ?? (e.kind === 'WTS' ? 'TRANSFER' : 'OTHER'), bags: e.bags })),
      })
    }
    for (const lot of st.lots) if (lot.anchor === 'pile-date' && lot.kilos >= EPS_KG) approx.push({ name, kilos: lot.kilos, date: lot.date })
    if (asOf === todayISO) {
      const kilos = st.lots.reduce((s, l) => s + l.kilos, 0)
      if (Math.abs(kilos - (pile.currentKilos ?? 0)) >= 1) {
        const note = pile.closedDate ? `Closed pile (closed ${longDate(pile.closedDate)})` : ((pile.currentBags ?? 0) === 0 ? `Empty pile (0 bags${pile.zeroedDate ? `, emptied ${longDate(pile.zeroedDate)}` : ''}), kilos left over` : '')
        mismatches.push({ name, rebuilt: kilos, stored: pile.currentKilos ?? 0, note })
      }
    }
  }
  const whById = ctx.whById
  const unassigned = inputs.transactions.filter((t) => {
    if (t.status !== 'Active' || (t.type !== 'WSR' && t.type !== 'WSI') || t.pileId || t.date > asOf) return false
    const w = whById.get(t.warehouseId)
    const cut = [w?.reportingCutoffDate, global].filter(Boolean).sort().pop()
    return !cut || t.date > cut
  }).map((t) => ({
    type: t.type, serial: t.serialNo, date: t.date, kilos: t.netKilos ?? 0, bags: t.numberOfBags ?? 0,
    warehouse: warehouseLabel(whById.get(t.warehouseId)?.name, false),
  }))
  const byName = (a, b) => natural(a.name, b.name)
  return { overrides, overAuthorized, noAgeGroup, uncoveredWsi, shortages: shortages.sort(byName), approx: approx.sort(byName), mismatches: mismatches.sort(byName), unassigned }
}

/**
 * The computed stock at the end of `dateISO`, per warehouse x commodity x variety x bracket,
 * WITHOUT any override. This is what the opening-balance editor shows and compares with.
 * Keys use the warehouse id so a saved override survives renaming and the Combined view.
 */
export const computeOpeningBase = (ctx, inputs, dateISO) => {
  const bare = { ...ctx, opening: null }
  const state = buildLots({ ...inputs, asOf: dateISO })
  const out = new Map()
  for (const [pileId, st] of state) {
    const pile = ctx.pileById.get(pileId)
    if (!pile) continue
    for (const lot of st.lots) {
      const c = lotCol(bare, pile, lot.varietyId, lot.date, dateISO)
      const key = `${pile.warehouseId}|${c.commodity}|${c.variety}|${c.bucket}`
      const cur = out.get(key) ?? { w: pile.warehouseId, c: c.commodity, v: c.variety, b: c.bucket, kilos: 0 }
      cur.kilos += lot.kilos
      out.set(key, cur)
    }
  }
  return out
}

/** Bracket labels for a commodity under an age set (By-products use whole months). */
export const bracketLabels = (commodity, ageSet) => {
  if (commodity === 'By Products') return Array.from({ length: 24 }, (_, i) => `${i + 1} mo`)
  return (AGE_SETS[ageSet]?.[commodity] ?? []).map((b) => b.label)
}
