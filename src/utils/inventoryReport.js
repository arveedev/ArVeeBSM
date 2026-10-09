// Daily Inventory report builders - READ-ONLY, pure functions (no database).
// Turn the lot engine's output (inventoryLots.js) into the tables the report
// screens, the PDF and the Excel export all share, so the three always agree.
//
// Units: everything is carried in KILOS. Net bags = kilos / 50 (the same as
// Home > Stocks), MT = kilos / 1000.

import { buildLots, buildLotsDetailed, lotAgeMonths, addMonthsISO } from './inventoryLots.js'

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
export const makeContext = ({ piles, warehouses, provinces, varieties, transactionTypes, combine = false, ageSet = 'coarse', opening = null, ageBasis = 'month' }) => ({
  opening, ageBasis,
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
  if (filters.byProducts === false && commodityOf(pile) === 'By Products') return false
  return true
}

const put = (grid, rk, cid, kilos) => {
  let row = grid.get(rk)
  if (!row) { row = new Map(); grid.set(rk, row) }
  row.set(cid, (row.get(cid) ?? 0) + kilos)
}

const lotCol = (ctx, pile, varietyId, lotDate, asOf) => {
  const commodity = commodityOf(pile)
  let variety = ctx.varietyName.get(varietyId ?? pile?.varietyId) ?? (commodity === 'By Products' ? 'BY-PRODUCTS' : '?')
  // Combined names also merge dry palay with a number: ignore the m and s (PD1m-A, PD1s-A -> PD1-A); PDm, PDs and PW stay as they are
  if (ctx.combine && commodity === 'Palay') variety = variety.replace(/^(PD\d+)[ms](?=-|$)/i, '$1')
  // Daily inventory and Summary: a lot's bracket is fixed for the month (its age at the 1st), so a move
  // to the next bracket shows in the next month; Age monitoring uses the exact day.
  const ageDate = ctx.ageBasis === 'exact' ? asOf : `${asOf.slice(0, 8)}01`
  const months = lotAgeMonths(lotDate, ageDate) ?? 0
  return { commodity, variety, bucket: bucketOf(commodity, months, ctx.ageSet) }
}

/** Stock grid (rowKey -> colId -> kilos) of a lot state, aged as of `ageDate`. */
// Opening-balance override (Daily inventory only): a per-cell correction, saved by an
// Admin, added to the stock of every date from its date onward. It lives in the
// report settings and never touches a pile, a transaction or any other screen.
const applyOpening = (ctx, grid, stateDate, filters) => {
  const o = ctx.opening
  if (!o || !stateDate || stateDate < o.date) return
  for (const c of ctx.openingCells ?? []) {
    const like = { warehouseId: c.w, cerealType: c.c }
    if (!accept(filters, like, ctx)) continue
    put(grid, rowKey(rowOf(ctx, like)), colId(c.c, c.v, c.b), c.k)
  }
}

// The typed balances of the override are kept as absolute values, so what an Admin typed is
// what shows at the override date, whatever the report logic computes underneath. The
// correction of each cell is worked out here (typed minus computed, both as of the override
// date). Each correction is then worked into the lots themselves (see the lot engine), so it
// ages and is used up like real stock instead of staying frozen in one bracket. Only a cell the
// engine cannot place (a variety with no id, a warehouse with no pile) is added as a plain
// correction in the column the view uses. Older saves that only kept the correction (`k`) are
// used as they were.
const bracketOf = (commodity, ageSet, label) => {
  if (commodity === 'By Products') {
    const n = parseInt(label, 10)
    if (!Number.isFinite(n) || n < 1) return null
    return { lo: n === 1 ? -1 : n - 1, hi: n, age: n - 0.5 }
  }
  const set = AGE_SETS[ageSet]?.[commodity]
  const i = set ? set.findIndex((x) => x.label === label) : -1
  if (i < 0) return null
  const prev = i > 0 ? set[i - 1].max : 0
  const hi = set[i].max
  // a representative age in the middle of the bracket (a bracket is lo < age <= hi)
  return { lo: i > 0 ? prev : -1, hi, age: Number.isFinite(hi) ? (prev + hi) / 2 : prev + 1 }
}

const withOpening = (ctx, inputs) => {
  if (ctx.openingCells) return ctx
  const o = ctx.opening
  if (!o || !Array.isArray(o.cells) || o.cells.length === 0) return { ...ctx, openingCells: [], openingEngine: null }
  const needBase = o.cells.some((c) => c.t != null)
  const base = needBase ? computeOpeningBase({ ...ctx, combine: false, ageBasis: 'month', ageSet: o.ageSet, openingCells: [] }, inputs, o.date) : new Map()
  const idByName = new Map()
  for (const [id, name] of ctx.varietyName) if (!idByName.has(name)) idByName.set(name, id)
  // the pile that holds extra stock of a cell: same warehouse and cereal type, never-closed first, same variety first
  const holderFor = (c, varietyId) => {
    let best = null
    let score = -1
    for (const p of ctx.pileById.values()) {
      if (p.warehouseId !== c.w || commodityOf(p) !== c.c) continue
      const sc = (p.closedDate ? 0 : 2) + (p.varietyId === varietyId ? 1 : 0)
      if (sc > score) { best = p.pileId; score = sc }
    }
    return best
  }
  const engine = []
  const fallback = []
  for (const c of o.cells) {
    const baseKilos = base.get(`${c.w}|${c.c}|${c.v}|${c.b}`)?.kilos ?? 0
    const k = c.t != null ? c.t - baseKilos : c.k
    if (!(Math.abs(k) >= 0.001)) continue
    const varietyId = idByName.get(c.v)
    const br = bracketOf(c.c, o.ageSet, c.b)
    const holder = varietyId && k > 0 ? holderFor(c, varietyId) : null
    if (varietyId && br && (k < 0 || holder)) { engine.push({ w: c.w, c: c.c, v: c.v, b: c.b, varietyId, k, holder, lo: br.lo, hi: br.hi, age: br.age }); continue }
    let v = c.v
    if (ctx.combine && c.c === 'Palay') v = v.replace(/^(PD\d+)[ms](?=-|$)/i, '$1')
    let b = c.b
    if (o.ageSet !== ctx.ageSet && c.c !== 'By Products') {
      const set = AGE_SETS[o.ageSet]?.[c.c] ?? []
      const i = set.findIndex((x) => x.label === c.b)
      if (i >= 0) b = bucketOf(c.c, (i > 0 ? set[i - 1].max : 0) + 0.05, ctx.ageSet) || c.b
    }
    fallback.push({ w: c.w, c: c.c, v, b, k })
  }
  return { ...ctx, openingCells: fallback, openingEngine: engine.length > 0 ? { date: o.date, cells: engine } : null }
}

// The inputs the lot engine needs for the reports: the override cells ride along.
const withEngine = (ctx, inputs) => (ctx.openingEngine ? { ...inputs, opening: ctx.openingEngine } : inputs)

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

const addDaysISO = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const gridDiff = (a, b) => {
  const out = new Map()
  for (const [g, sign] of [[a, 1], [b, -1]]) for (const [rk, row] of g) for (const [id, v] of row) put(out, rk, id, sign * v)
  return out
}
const gridAdd = (a, b) => gridDiff(a, gridDiff(new Map(), b))
const gridNonEmpty = (g) => [...g.values()].some((row) => [...row.values()].some((v) => Math.abs(v) >= EPS_KG))

/**
 * Day-by-day analysis shared by the Daily inventory and the Summary, so both always show
 * the same balances.
 *
 * Each day the stock should change only by its ADD and LESS documents. When it changes for
 * any other reason (a beginning balance entered late, activity on a closed pile, ...) the
 * report does NOT let that move the inventory: the difference is a "gap", added up from
 * the data start date and taken out of every later balance. The only change allowed
 * without a document is a CLOSED PILE: closing zeroes the stock it still held, and that
 * is shown as an adjustment naming the pile. An Admin's opening-balance override is shown
 * as its own row. `gapAt(date)` is the running total of gaps up to that date.
 */
// Longest span the daily analysis walks (about four years); a longer one would be cut short, so it is refused loudly.
const MAX_DAYS = 1500
// Every calendar day that carries a record (and the day after it, for 'after this date' rules).
const eventDays = (inputs) => {
  const out = new Set()
  const scan = (o) => {
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = v.slice(0, 10); out.add(d); out.add(addDaysISO(d, 1)) }
    }
  }
  for (const list of [inputs.piles, inputs.transactions, inputs.warehouses, inputs.authorities]) for (const o of list ?? []) scan(o)
  if (inputs.opening?.date) { out.add(inputs.opening.date); out.add(addDaysISO(inputs.opening.date, 1)) }
  if (inputs.globalDataStartDate) { out.add(inputs.globalDataStartDate); out.add(addDaysISO(inputs.globalDataStartDate, 1)) }
  return out
}

const analyzeDays = (ctx0, inputs0, filters, from, to) => {
  const ctx = withOpening(ctx0, inputs0)
  const inputs = withEngine(ctx, inputs0)
  const warmStart = inputs.globalDataStartDate ? addDaysISO(inputs.globalDataStartDate, 1) : from
  const first = warmStart < from ? warmStart : from
  const days = []
  for (let d = first; d <= to && days.length < MAX_DAYS; d = addDaysISO(d, 1)) days.push(d)

  const { movements } = buildLotsDetailed({ ...inputs, asOf: to })
  // The lot state only changes on a day that has a record dated on it (a document, an authority, a
  // pile or warehouse date), so every other day reuses the day before instead of being rebuilt.
  const hot = eventDays(inputs)
  const stateAt = new Map()
  const getState = (d) => {
    if (!stateAt.has(d)) {
      const before = addDaysISO(d, -1)
      stateAt.set(d, !hot.has(d) && stateAt.has(before) ? stateAt.get(before) : buildLots({ ...inputs, asOf: d }))
    }
    return stateAt.get(d)
  }
  const typeLabel = (m) => m.label ?? ctx.typeName.get(m.typeId) ?? 'OTHER'
  const opening = ctx.opening ? { date: ctx.opening.date, cells: ctx.openingCells } : null

  const recs = []
  const gapAt = new Map()
  let gap = new Map()
  for (const d of days) {
    const prev = addDaysISO(d, -1)
    const stPrev = getState(prev)
    // the day's brackets (fixed for the month), so a month opens with its stock in the new brackets
    const beg0 = stockGrid(ctx, stPrev, d, filters, prev)
    const aged0 = beg0
    const end0 = stockGrid(ctx, getState(d), d, filters, d)

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
      moves.push({ kind: m.kind, label, rowKey: rk, colId: cid, docType: m.docType, serial: m.serial, customer: m.customer, pile: m.docType === 'AI' ? '' : pile.pileName, kilos: m.kilos })
    }
    const net = new Map()
    for (const [rk, row] of aged0) for (const [id, v] of row) put(net, rk, id, v)
    for (const g of adds.values()) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, v)
    for (const g of lesses.values()) for (const [rk, row] of g) for (const [id, v] of row) put(net, rk, id, -v)
    const adjustment = gridDiff(end0, net)

    // closing a pile zeroes what it still held: the one adjustment that is allowed
    const closed = [...ctx.pileById.values()].filter((p) => p.closedDate === d && accept(filters, p, ctx))
    const closure = new Map()
    const closureLines = new Map()
    if (closed.length > 0) {
      const pre = buildLots({ ...inputs, asOf: d, clearClosed: false })
      for (const p of closed) {
        const rk = rowKey(rowOf(ctx, p))
        for (const lot of pre.get(p.pileId)?.lots ?? []) {
          const c = lotCol(ctx, p, lot.varietyId, lot.date, d)
          const cid = colId(c.commodity, c.variety, c.bucket)
          put(closure, rk, cid, -lot.kilos)
          const k = `${rk}|${cid}`
          const list = closureLines.get(k) ?? []
          list.push({ doc: 'Pile closed', customer: '', pile: `${rowOf(ctx, p).label} ${p.pileName}`, kilos: lot.kilos })
          closureLines.set(k, list)
        }
      }
    }
    // an Admin's opening-balance override is a deliberate change
    const openingAdj = new Map()
    if (opening && d === opening.date) {
      // the part worked into the lots: the day's stock with the override minus without it
      if (ctx.openingEngine) {
        const plain = buildLots({ ...inputs0, asOf: d })
        const effect = gridDiff(stockGrid({ ...ctx, openingCells: [] }, getState(d), d, filters), stockGrid({ ...ctx, openingCells: [] }, plain, d, filters))
        for (const [rk, row] of effect) for (const [id, v] of row) put(openingAdj, rk, id, v)
      }
      for (const c of opening.cells) {
        const like = { warehouseId: c.w, cerealType: c.c }
        if (accept(filters, like, ctx)) put(openingAdj, rowKey(rowOf(ctx, like)), colId(c.c, c.v, c.b), c.k)
      }
    }
    // everything else that moved the stock without a document is a gap and is ignored
    const dayGap = gridDiff(gridDiff(adjustment, closure), openingAdj)
    const gapBefore = gap
    gap = gridAdd(gap, dayGap)
    gapAt.set(d, gap)
    recs.push({
      date: d, moves, adds, lesses, beg0, end0, closure, closureLines, openingAdj, gapBefore, gapNow: gap, stPrev,
      closedNames: closed.map((p) => `${rowOf(ctx, p).label} ${p.pileName}`),
    })
  }
  return { recs, gapAt, truncated: days.length >= MAX_DAYS && addDaysISO(days[days.length - 1], 1) <= to }
}

/**
 * Summary: stock per warehouse x variety x age bracket as of one date, with a
 * subtotal per province and a branch total. Empty rows/columns are dropped. It equals the
 * Daily inventory's ending balance for that date.
 */
export const buildSummary = (ctx0, inputs0, { asOf, filters = {}, sort = 'name' }) => {
  const ctx = withOpening(ctx0, inputs0)
  const inputs = withEngine(ctx, inputs0)
  const state = buildLots({ ...inputs, asOf })
  let grid = stockGrid(ctx, state, asOf, filters, asOf)
  const warm = inputs.globalDataStartDate ? addDaysISO(inputs.globalDataStartDate, 1) : null
  if (warm && asOf >= warm) {
    const { gapAt } = analyzeDays(ctx, inputs0, filters, asOf, asOf)
    const gap = gapAt.get(asOf)
    if (gap && gridNonEmpty(gap)) grid = gridDiff(grid, gap)
  }
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
 * Daily ledger for [from, to]: per day the beginning stock, ADD and LESS by transaction
 * type, and the ending stock, for every warehouse x variety x age bracket that has anything
 * in the period. A day appears only if it has an ADD, a LESS, a closed pile or an override.
 * Balances follow the documents; only a closed pile adjusts them (see analyzeDays).
 */
/**
 * The lots whose age bracket changes between the month of `oldRef` and the month of `newRef`
 * (brackets are fixed for a month): per warehouse x column, what left and what arrived, with the
 * pile and receipt date behind it. Quantity never changes, only the bracket it sits in.
 */
const ageMoves = (ctx, state, filters, oldRef, newRef) => {
  const grid = new Map()
  const lines = new Map()
  const note = (rk, cid, line) => {
    const k = `${rk}|${cid}`
    if (!lines.has(k)) lines.set(k, [])
    lines.get(k).push(line)
  }
  for (const [pileId, st] of state) {
    const pile = ctx.pileById.get(pileId)
    if (!accept(filters, pile, ctx)) continue
    const rk = rowKey(rowOf(ctx, pile))
    const where = `${rowOf(ctx, pile).label} ${pile.pileName}`
    for (const lot of st.lots) {
      if (lot.kilos < EPS_KG) continue
      const a = lotCol(ctx, pile, lot.varietyId, lot.date, oldRef)
      const b = lotCol(ctx, pile, lot.varietyId, lot.date, newRef)
      const from = colId(a.commodity, a.variety, a.bucket)
      const to = colId(b.commodity, b.variety, b.bucket)
      if (from === to) continue
      put(grid, rk, from, -lot.kilos)
      put(grid, rk, to, lot.kilos)
      const received = longDate(lot.date)
      note(rk, from, { doc: `Moved to ${b.bucket}`, customer: '', pile: `${where}, received ${received}`, kilos: -lot.kilos })
      note(rk, to, { doc: `Moved from ${a.bucket}`, customer: '', pile: `${where}, received ${received}`, kilos: lot.kilos })
    }
  }
  return gridNonEmpty(grid) ? { grid, lines } : null
}

export const buildLedger = (ctx0, inputs0, { from, to, filters = {} }) => {
  const ctx = withOpening(ctx0, inputs0)
  const { recs, gapAt, truncated } = analyzeDays(ctx, inputs0, filters, from, to)
  const typeOrder = (a, b) => (a === 'BEGINNING BALANCE' ? -1 : b === 'BEGINNING BALANCE' ? 1 : a === 'TRANSFER' ? 1 : b === 'TRANSFER' ? -1 : natural(a, b))
  const zero = new Map()
  const out = []
  const allGrids = []
  for (const r of recs) {
    if (r.date < from) continue
    const hasClosure = gridNonEmpty(r.closure)
    const hasOpening = gridNonEmpty(r.openingAdj)
    if (r.adds.size === 0 && r.lesses.size === 0 && !hasClosure && !hasOpening) continue
    const gPrev = gapAt.get(addDaysISO(r.date, -1)) ?? zero
    const beginning = gridDiff(r.beg0, gPrev)
    const ending = gridDiff(r.end0, r.gapNow)
    // a new month re-sorts the stock into its new brackets: shown so the day's balances can be followed
    const oldRef = out.length > 0 ? out[out.length - 1].date : addDaysISO(from, -1)
    const ageMove = oldRef.slice(0, 7) !== r.date.slice(0, 7) ? ageMoves(ctx, r.stPrev, filters, oldRef, r.date) : null
    const rec = {
      date: r.date, moves: r.moves, beginning, shift: null, ageMove, isFirst: out.length === 0,
      adds: [...r.adds].sort((a, b) => typeOrder(a[0], b[0])).map(([label, grid]) => ({ label, grid })),
      lesses: [...r.lesses].sort((a, b) => typeOrder(a[0], b[0])).map(([label, grid]) => ({ label, grid })),
      adjustment: hasClosure ? r.closure : null, closureLines: r.closureLines, closedPiles: r.closedNames,
      openingAdj: hasOpening ? r.openingAdj : null, ending,
    }
    out.push(rec)
    allGrids.push(beginning, ending, ...(ageMove ? [ageMove.grid] : []), ...rec.adds.map((x) => x.grid), ...rec.lesses.map((x) => x.grid), ...(rec.adjustment ? [rec.adjustment] : []), ...(rec.openingAdj ? [rec.openingAdj] : []))
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
  return { cols, days: out, truncated }
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
  // columns, with a TOTAL column closing each cereal type (palay, rice, by-products)
  const groups = []
  for (const c of summary.cols) {
    const g = groups[groups.length - 1]
    if (g && g.commodity === c.commodity) g.cols.push(c)
    else groups.push({ commodity: c.commodity, cols: [c] })
  }
  const items = groups.flatMap((g) => [
    ...g.cols.map((c) => ({ ...c, kind: 'col' })),
    { kind: 'total', commodity: g.commodity, variety: 'TOTAL', bucket: '', ids: g.cols.map((c) => c.id) },
  ])
  const { edges, tones } = edgesAndTones(items, (c) => c.commodity)
  const head = [
    [{ t: 'WAREHOUSE', span: 1 }, ...headRow(items, (c) => c.commodity, (c) => COMMODITY_LABEL[c.commodity], tones), { t: 'ALL', span: 1, tone: 0 }],
    [{ t: '', span: 1 }, ...headRow(items, (c) => `${c.commodity}|${c.variety}`, (c) => c.variety, tones), { t: 'TOTAL', span: 1, tone: 0 }],
    [{ t: '', span: 1 }, ...items.map((c, i) => ({ t: c.bucket, span: 1, tone: tones[i] })), { t: '', span: 1, tone: 0 }],
  ]
  const line = (first, values, kind) => {
    const cells = items.map((it) => (it.kind === 'col'
      ? num(values.get(it.id) ?? 0, unit)
      : num(it.ids.reduce((sum, id) => sum + (values.get(id) ?? 0), 0), unit)))
    const total = [...values.values()].reduce((sum, v) => sum + v, 0)
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
  const byDoc = new Map()
  for (const m of moves) {
    if (m.kind !== kind || m.label !== label || m.rowKey !== c.rowKey || m.colId !== c.id) continue
    const doc = `${m.docType ?? ''} ${m.serial ?? ''}`.trim()
    const key = `${doc}|${m.customer ?? ''}`
    const cur = byDoc.get(key) ?? { doc, customer: m.customer ?? '', piles: [], kilos: 0 }
    cur.kilos += m.kilos
    if (m.pile && !cur.piles.includes(m.pile)) cur.piles.push(m.pile)
    byDoc.set(key, cur)
  }
  const lines = [...byDoc.values()].map((x) => ({ doc: x.doc, customer: x.customer, pile: x.piles.join(', '), value: num(x.kilos, unit) ?? 0 }))
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
  const moveNotes = (m) => cols.map((c) => { const l = m.lines.get(`${c.rowKey}|${c.id}`); return l ? l.map((x) => ({ doc: x.doc, customer: '', pile: x.pile, value: num(x.kilos, unit) ?? 0 })) : null })
  if (day.length > 0) {
    // the first day: its beginning already sits in the new month's brackets, so the move is explained on the cells
    rows.push({ ...line(`${longDate(day[0].date)} · BEGINNING INVENTORY`, day[0].beginning, 'beg', true), ...(day[0].ageMove ? { notes: moveNotes(day[0].ageMove) } : {}) })
  }
  for (const d of day) {
    rows.push({ kind: 'day', first: longDate(d.date), cells: [] })
    if (d.ageMove && !d.isFirst) rows.push({ ...line('AGE BRACKET MOVES (new month)', d.ageMove.grid, 'row'), notes: moveNotes(d.ageMove), day: d.date })
    if (d.adds.length > 0) {
      rows.push({ kind: 'add-label', first: 'ADD:', cells: [] })
      for (const a of d.adds) rows.push({ ...line(a.label, a.grid, 'add'), notes: cols.map((c) => notesFor(d.moves, 'add', a.label, c, unit)), day: d.date })
    }
    if (d.lesses.length > 0) {
      rows.push({ kind: 'less-label', first: 'LESS:', cells: [] })
      for (const l of d.lesses) rows.push({ ...line(l.label, l.grid, 'less'), notes: cols.map((c) => notesFor(d.moves, 'less', l.label, c, unit)), day: d.date })
    }
    if (d.adjustment) {
      rows.push({
        ...line(`PILE CLOSED: ${d.closedPiles.join(', ')}`, d.adjustment, 'row'),
        notes: cols.map((c) => { const l = d.closureLines.get(`${c.rowKey}|${c.id}`); return l ? l.map((x) => ({ doc: x.doc, customer: '', pile: x.pile, value: num(x.kilos, unit) ?? 0 })) : null }),
        day: d.date,
      })
    }
    if (d.openingAdj) rows.push(line('OPENING BALANCE OVERRIDE', d.openingAdj, 'row'))
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
  const mk = (values) => {
    const out = []
    const order = [...new Set(summary.cols.map((c) => c.commodity))]
    for (const commodity of order) {
      const cols = summary.cols.filter((c) => c.commodity === commodity)
      for (const c of cols) { const v = num(values.get(c.id) ?? 0, unit); if (v != null) out.push({ label: lineLabel(c), commodity, value: v }) }
      const t = num(cols.reduce((sum, c) => sum + (values.get(c.id) ?? 0), 0), unit)
      if (t != null) out.push({ label: `Total ${COMMODITY_LABEL[commodity].toLowerCase()}`, commodity, value: t, total: true })
    }
    return out
  }
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
          move: d.ageMove ? num(v(d.ageMove.grid), unit) : null,
        }
      }).filter((l) => l.beg != null || l.end != null || l.adj != null || l.move != null || l.adds.length || l.lesses.length)
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
  section('Stock book self-check', checks.selfCheck ?? [], (r) => ({ first: r.title, cells: [r.ok ? 'passed' : r.detail.join('; '), null] }))
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
// Self-check: proves the stock book against itself every time it is opened in
// Data check, so a wrong figure is caught instead of being found by eye.
// ---------------------------------------------------------------------------

// Age worked out a second, independent way (count whole monthly anniversaries one by one),
// to catch any slip in lotAgeMonths.
const slowAgeMonths = (fromISO, asOfISO) => {
  if (asOfISO <= fromISO) return 0
  let n = 0
  while (addMonthsISO(fromISO, n + 1) <= asOfISO) n += 1
  const days = (Date.parse(`${asOfISO}T00:00:00Z`) - Date.parse(`${addMonthsISO(fromISO, n)}T00:00:00Z`)) / 86400000
  return n + days / 30.44
}

const byKey = (grid) => {
  const out = new Map()
  for (const [rk, row] of grid) for (const [id, v] of row) {
    const [commodity, variety] = id.split('|')
    const k = `${rk}|${commodity}|${variety}`
    out.set(k, (out.get(k) ?? 0) + v)
  }
  return out
}
const cellKeys = (grid) => {
  const out = new Map()
  for (const [rk, row] of grid) for (const [id, v] of row) out.set(`${rk}|${id}`, v)
  return out
}
const differences = (a, b, tolerance = 0.5) => {
  const bad = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const d = (a.get(k) ?? 0) - (b.get(k) ?? 0)
    if (Math.abs(d) >= tolerance) bad.push({ k, d })
  }
  return bad
}
const afterDate = (k) => k.split('|').slice(1).join(' · ')

export const buildSelfCheck = (ctx0, inputs, { asOf }) => {
  const warm = inputs.globalDataStartDate ? addDaysISO(inputs.globalDataStartDate, 1) : null
  if (!warm || asOf < warm) return []
  const results = []
  const add = (title, bad, show) => results.push({ title, ok: bad.length === 0, detail: bad.slice(0, 6).map(show), more: Math.max(0, bad.length - 6) })
  const bags = (kilos) => (kilos / 50).toFixed(2)
  const ctx = withOpening({ ...ctx0, combine: false, ageBasis: 'month', openingCells: undefined }, inputs)
  const filters = { byProducts: true }

  const ledger = buildLedger(ctx, inputs, { from: warm, to: asOf, filters })
  const lastDay = ledger.days.at(-1)?.date ?? asOf
  const summary = buildSummary(ctx, inputs, { asOf: lastDay, filters })
  const summaryGrid = new Map()
  for (const p of summary.provinces) for (const r of p.rows) summaryGrid.set(`${p.name}|${r.label}`, r.values)
  const last = ledger.days.at(-1)

  results.push({ title: 'The period is fully covered (not cut short)', ok: !ledger.truncated, detail: ledger.truncated ? ['The period is longer than the report can walk day by day.'] : [], more: 0 })

  // 1. The Summary and the Daily inventory work this out separately; they must agree on every cell.
  if (last) add(`Summary equals the Daily inventory ending (${longDate(last.date)})`, differences(cellKeys(summaryGrid), cellKeys(last.ending)), (x) => `${afterDate(x.k)}: ${bags(x.d)} bags apart`)

  // 2. A day starts where the day before ended; a new month only moves stock between brackets.
  const continuity = []
  const moved = []
  ledger.days.forEach((d, i) => {
    if (i > 0) {
      const expected = new Map(cellKeys(ledger.days[i - 1].ending))
      if (d.ageMove) for (const [k, v] of cellKeys(d.ageMove.grid)) expected.set(k, (expected.get(k) ?? 0) + v)
      for (const x of differences(cellKeys(d.beginning), expected)) continuity.push({ k: `${d.date}|${x.k}`, d: x.d })
    }
    if (d.ageMove) for (const [k, v] of byKey(d.ageMove.grid)) if (Math.abs(v) >= 0.5) moved.push({ k: `${d.date}|${k}`, d: v })
  })
  add('Each day starts where the day before ended (a new month only moves stock between brackets)', continuity, (x) => `${longDate(x.k.split('|')[0])} ${afterDate(x.k)}: ${bags(x.d)} bags`)
  add('An age move never changes the quantity of a variety', moved, (x) => `${longDate(x.k.split('|')[0])} ${afterDate(x.k)}: ${bags(x.d)} bags`)

  // 3. Every day balances: beginning + ADD - LESS + closed piles + override = ending, per warehouse and variety.
  const chain = []
  for (const d of ledger.days) {
    const net = new Map()
    const addTo = (grid, sign) => { for (const [k, v] of byKey(grid)) net.set(k, (net.get(k) ?? 0) + sign * v) }
    addTo(d.beginning, 1)
    d.adds.forEach((x) => addTo(x.grid, 1))
    d.lesses.forEach((x) => addTo(x.grid, -1))
    if (d.adjustment) addTo(d.adjustment, 1)
    if (d.openingAdj) addTo(d.openingAdj, 1)
    for (const x of differences(net, byKey(d.ending))) chain.push({ k: `${d.date}|${x.k}`, d: x.d })
  }
  add('Every day balances (beginning + ADD - LESS = ending)', chain, (x) => `${longDate(x.k.split('|')[0])} ${afterDate(x.k)}: ${bags(x.d)} bags`)

  // 4. No negative stock anywhere in the period.
  const negative = []
  for (const d of ledger.days) for (const [k, v] of cellKeys(d.ending)) if (v < -0.5) negative.push({ k: `${d.date}|${k}`, d: v })
  add('No negative balance', negative, (x) => `${longDate(x.k.split('|')[0])} ${afterDate(x.k)}: ${bags(x.d)} bags`)

  // 5. An opening balance typed by an Admin shows exactly as typed on its date.
  const o = ctx0.opening
  if (o && Array.isArray(o.cells) && o.cells.some((c) => c.t != null) && o.date >= warm && o.date <= asOf) {
    // the cells were typed in the bracket set saved with the override, so they are read back in that set
    const ctxO = withOpening({ ...ctx0, combine: false, ageBasis: 'month', ageSet: o.ageSet, openingCells: undefined }, inputs)
    const atDate = buildSummary(ctxO, inputs, { asOf: o.date, filters })
    const grid = new Map()
    for (const p of atDate.provinces) for (const r of p.rows) grid.set(`${p.name}|${r.label}`, r.values)
    const shown = cellKeys(grid)
    const bad = []
    for (const c of o.cells) {
      if (c.t == null) continue
      const k = `${rowKey(rowOf(ctxO, { warehouseId: c.w, cerealType: c.c }))}|${c.c}|${c.v}|${c.b}`
      const got = shown.get(k) ?? 0
      if (Math.abs(got - c.t) >= 0.5) bad.push({ k, d: got - c.t })
    }
    add(`The opening balance you typed shows as typed (${longDate(o.date)})`, bad, (x) => `${afterDate(x.k)}: shows ${bags(x.d)} bags off`)
  }

  // 5b. Every correction of the override is found in the stock (a lower balance needs that much stock in its bracket).
  if (ctx.openingEngine) {
    const short = buildLots({ ...withEngine(ctx, inputs), asOf }).overrideShort ?? []
    add('The opening balance is fully worked into the stock', short, (x) => `${rowOf(ctx, { warehouseId: x.w, cerealType: x.c }).label} · ${x.v} · ${x.b}: ${bags(x.short)} bags could not be placed`)
  }

  // 6. Combined names only merge columns: the totals must equal the separate view.
  const combined = buildSummary({ ...ctx, combine: true, openingCells: undefined }, inputs, { asOf: lastDay, filters })
  const tot = (S) => [...S.total.values()].reduce((a, b) => a + b, 0)
  add('Combined and separate names give the same total', Math.abs(tot(combined) - tot(summary)) >= 0.5 ? [{ k: 'total', d: tot(combined) - tot(summary) }] : [], (x) => `${bags(x.d)} bags apart`)

  // 7. Ages: the report's age agrees with an independent count.
  const state = buildLots({ ...inputs, asOf })
  const ageBad = []
  for (const [pileId, st] of state) {
    const pile = ctx.pileById.get(pileId)
    if (!pile) continue
    for (const lot of st.lots) {
      if (lot.kilos < EPS_KG || !lot.date) continue
      const a = lotAgeMonths(lot.date, asOf)
      const b = slowAgeMonths(lot.date.slice(0, 10), asOf)
      if (a == null || Math.abs(a - b) > 1e-6) ageBad.push({ k: `${pile.pileName}|${lot.date}`, d: (a ?? 0) - b })
    }
  }
  add('Lot ages agree with an independent count', ageBad, (x) => `${x.k.split('|')[0]} received ${x.k.split('|')[1]}`)
  return results
}

// ---------------------------------------------------------------------------
// Age monitoring lists and data checks (read-only).
// ---------------------------------------------------------------------------


/**
 * Lots about to move into the next age bracket (within `windowDays`) and the
 * oldest lots on hand. Each line is ONE lot, so only that lot moves, never the
 * whole pile. Quantities are kilos (convert with toUnit).
 */
export const buildAgeLists = (ctx0, inputs0, { asOf, filters = {}, windowDays = 30, topOld = 15 }) => {
  const ctx = withOpening(ctx0, inputs0)
  const state = buildLots({ ...withEngine(ctx, inputs0), asOf })
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
      const crossDate = addDaysISO(addMonthsISO(lot.date, boundary), 1)
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
  const selfCheck = buildSelfCheck(ctx, inputs, { asOf })
  return { selfCheck, overrides, overAuthorized, noAgeGroup, uncoveredWsi, shortages: shortages.sort(byName), approx: approx.sort(byName), mismatches: mismatches.sort(byName), unassigned }
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
