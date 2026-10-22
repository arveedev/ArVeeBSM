// Report Builder engine (pure, no database, no writes): filter, search, sort, group, total and lay out a table from flat rows.
// The same table model feeds the screen and every export, so what is printed is exactly what was seen.

import { buildFields, readValue, numericOf, dayOf, monthOrder } from './fields.js'

// The data of this app is complete from September 1, 2026: no table of the Report Builder ever shows an earlier date.
export const REPORT_FLOOR = '2026-09-01'
export const clampPeriod = (p, floor = REPORT_FLOOR) => {
  const today = new Date().toISOString().slice(0, 10)
  const from = dayOf(p?.from) > floor ? dayOf(p.from) : floor
  const to = dayOf(p?.to) > floor ? dayOf(p.to) : (dayOf(p?.to) ? floor : today)
  return { from, to: to < from ? from : to }
}
/** Keep the rows whose date field falls inside the period (a row with no date cannot be placed, so it is left out). */
export const applyPeriod = (rows, dateField, period) => {
  if (!dateField) return rows
  const { from, to } = clampPeriod(period)
  return rows.filter((r) => { const d = dayOf(r[dateField]); return d !== '' && d >= from && d <= to })
}

export const AGG = { sum: 'Sum', avg: 'Average', count: 'Count', min: 'Smallest', max: 'Largest', distinct: 'Different' }
export const OPS = {
  txt: [['is', 'is'], ['isnot', 'is not'], ['has', 'contains'], ['starts', 'starts with'], ['hasno', 'does not contain'], ['blank', 'is empty'], ['filled', 'is not empty']],
  num: [['eq', '='], ['ne', '≠'], ['gt', '>'], ['ge', '≥'], ['lt', '<'], ['le', '≤'], ['btw', 'between']],
  date: [['on', 'is on'], ['after', 'is after'], ['onafter', 'is on or after'], ['before', 'is before'], ['onbefore', 'is on or before'], ['btw', 'is between'], ['blank', 'is empty']],
}
export const opLabel = (kind, op) => (OPS[kind].find((o) => o[0] === op) || [0, op])[1]

export const blankLayout = (source) => ({
  source, mode: 'pivot', rows: [], cols: [], vals: [], filters: [], search: '', sort: [], hidden: [], order: [],
  heat: false, subt: false, pct: 'none', topn: 0, sortTot: false, hl: { op: '', val: 0, col: 'red' }, calc: [], options: {},
})

/** A saved layout may name a field that no longer exists: drop that part and say what was dropped. */
export const sanitizeLayout = (layout, fieldMap) => {
  const dropped = []
  const keep = (id, what) => { if (fieldMap[id]) return true; dropped.push(`${what} "${id}"`); return false }
  const L = { ...blankLayout(layout.source), ...layout }
  L.rows = (L.rows ?? []).filter((id) => keep(id, 'row'))
  L.cols = (L.cols ?? []).filter((id) => keep(id, 'column'))
  L.vals = (L.vals ?? []).filter((v) => keep(v.f, 'value'))
  L.filters = (L.filters ?? []).filter((f) => keep(f.f, 'filter'))
  L.sort = (L.sort ?? []).filter((s) => keep(s.f, 'sort'))
  L.hidden = (L.hidden ?? []).filter((id) => fieldMap[id])
  L.order = (L.order ?? []).filter((id) => fieldMap[id])
  return { layout: L, dropped }
}

// ---------------------------------------------------------------------------------------------------- filtering and search
export function passFilter(row, ft, map) {
  const f = map[ft.f]
  if (!f) return true
  const v = readValue(row, f, map)
  if (f.kind === 'txt') {
    const s = String(v ?? '').toLowerCase()
    const a = String(ft.v ?? '').toLowerCase()
    const list = Array.isArray(ft.v) ? ft.v.map((x) => String(x).toLowerCase()) : null
    switch (ft.op) {
      case 'is': return list ? list.includes(s) : s === a
      case 'isnot': return list ? !list.includes(s) : s !== a
      case 'has': return s.includes(a)
      case 'hasno': return !s.includes(a)
      case 'starts': return s.startsWith(a)
      case 'blank': return s === ''
      default: return s !== ''
    }
  }
  if (f.kind === 'num') {
    const x = Number(v)
    const y = Number(ft.v)
    const z = Number(ft.v2)
    switch (ft.op) {
      case 'eq': return x === y
      case 'ne': return x !== y
      case 'gt': return x > y
      case 'ge': return x >= y
      case 'lt': return x < y
      case 'le': return x <= y
      default: return x >= Math.min(y, z) && x <= Math.max(y, z)
    }
  }
  const d = dayOf(v)
  switch (ft.op) {
    case 'blank': return !d
    case 'on': return d === dayOf(ft.v)
    case 'after': return !!d && d > dayOf(ft.v)
    case 'onafter': return !!d && d >= dayOf(ft.v)
    case 'before': return !!d && d < dayOf(ft.v)
    case 'onbefore': return !!d && d <= dayOf(ft.v)
    default: return !!d && d >= dayOf(ft.v) && d <= dayOf(ft.v2)
  }
}

export function selectRows(rows, layout, fields) {
  const q = String(layout.search ?? '').trim().toLowerCase()
  const real = fields.list.filter((f) => !f.d)
  return rows.filter((r) => layout.filters.every((ft) => passFilter(r, ft, fields.map))
    && (!q || real.some((f) => String(readValue(r, f, fields.map) ?? '').toLowerCase().includes(q))))
}

export const filterText = (layout, fields) => [
  ...layout.filters.map((ft) => {
    const f = fields.map[ft.f]
    if (!f) return ''
    const v = Array.isArray(ft.v) ? ft.v.join(', ') : ft.v
    return `${f.label} ${opLabel(f.kind, ft.op)}${['blank', 'filled'].includes(ft.op) ? '' : ` ${v}`}${ft.op === 'btw' ? ` and ${ft.v2}` : ''}`
  }),
  layout.search ? `Search "${layout.search}"` : '',
].filter(Boolean)

// ---------------------------------------------------------------------------------------------------- numbers
export function aggregate(rows, v, fields) {
  const f = fields.map[v.f]
  if (!f) return null
  if (v.a === 'count') return rows.length
  if (v.a === 'distinct') return new Set(rows.map((r) => readValue(r, f, fields.map))).size
  const xs = rows.map((r) => numericOf(r, v.f, fields.map))
  if (!xs.length) return null
  if (v.a === 'sum') return xs.reduce((a, b) => a + b, 0)
  if (v.a === 'avg') return xs.reduce((a, b) => a + b, 0) / xs.length
  if (v.a === 'min') return Math.min(...xs)
  return Math.max(...xs)
}
/** Black or white writing, whichever reads on this background colour. */
export const inkOn = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!m) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#111827' : '#ffffff'
}
/** The header the person typed for a field, or the field's own name. */
const nameOf = (layout, f) => String(layout.headers?.[f.id] ?? '').trim() || f.label

export const fmtNumber = (v, a) => (v == null || Number.isNaN(v) || Number(v) === 0 ? '' : a === 'count' || a === 'distinct' ? Math.round(v).toLocaleString('en-US') : Number(v).toLocaleString('en-US', { maximumFractionDigits: a === 'avg' ? 1 : 2 }))

const hlClass = (layout, x) => {
  const h = layout.hl
  if (!h || !h.op || x == null) return ''
  const t = Number(h.val)
  const hit = h.op === '>' ? x > t : h.op === '<' ? x < t : h.op === '=' ? x === t : x !== t
  return hit ? ` hl-${h.col}` : ''
}

// ---------------------------------------------------------------------------------------------------- the table model
/**
 * @returns { head: [[{t, span, rs, id, cls}]], body: [...], foot, cols, stats, cells: Map(id -> { recs, label }) }
 * List mode: body is an array of rows of cells. Pivot mode: body is an array of { cls, cells }.
 */
export function buildTable(layout, baseFields, rows, { full = false, listLimit = 300 } = {}) {
  const fields = buildFields(baseFields, layout.calc)
  const rs = selectRows(rows, layout, fields)
  const cells = new Map()
  let cid = 0
  const out = { head: [], body: [], foot: null, cells, fields, stats: { records: rs.length } }

  if (layout.mode === 'list') {
    const base = fields.list.filter((f) => !f.d).map((f) => f.id)
    const order = [...new Set([...layout.order.filter((id) => fields.map[id]), ...base])]
    const cols = order.filter((id) => !layout.hidden.includes(id)).map((id) => fields.map[id])
    const sorted = rs.slice()
    for (const s of [...layout.sort].reverse()) {
      const f = fields.map[s.f]
      if (!f) continue
      sorted.sort((a, b) => {
        const x = readValue(a, f, fields.map)
        const y = readValue(b, f, fields.map)
        return (f.kind === 'num' ? (Number(x) || 0) - (Number(y) || 0) : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * s.dir
      })
    }
    const lim = full ? sorted.length : listLimit
    out.cols = cols
    out.head = [cols.map((f) => ({ t: nameOf(layout, f), id: f.id, cls: f.kind === 'num' ? '' : 'l' }))]
    out.body = sorted.slice(0, lim).map((r) => cols.map((f) => {
      const v = readValue(r, f, fields.map)
      return { t: f.kind === 'num' ? fmtNumber(v, 'sum') : String(v ?? ''), v: f.kind === 'num' ? v : null, cls: f.kind === 'num' ? hlClass(layout, v).trim() : 'l' }
    }))
    out.stats = { records: sorted.length, shown: Math.min(lim, sorted.length), more: Math.max(0, sorted.length - lim) }
    return out
  }

  const srows = layout.rows.filter((f) => fields.map[f])
  const scols = layout.cols.filter((f) => fields.map[f])
  let vals = layout.vals.filter((v) => fields.map[v.f])
  const noVals = !vals.length
  if (noVals) vals = [{ f: fields.list.find((f) => !f.d).id, a: 'count' }]
  const key = (r, ids) => ids.map((id) => String(readValue(r, fields.map[id], fields.map) ?? ''))
  const rowMap = new Map()
  const colMap = new Map()
  for (const r of rs) {
    const rk = key(r, srows)
    const ck = key(r, scols)
    const a = rk.join('\u0001')
    const b = ck.join('\u0001')
    if (!rowMap.has(a)) rowMap.set(a, { key: rk, cells: new Map(), all: [] })
    const row = rowMap.get(a)
    row.all.push(r)
    if (!row.cells.has(b)) row.cells.set(b, [])
    row.cells.get(b).push(r)
    if (!colMap.has(b)) colMap.set(b, ck)
  }
  const cmp = (x, y) => x.join(' ').localeCompare(y.join(' '), undefined, { numeric: true })
  const cols = [...colMap.entries()].sort((x, y) => {
    const mx = monthOrder(x[1][0])
    const my = monthOrder(y[1][0])
    return mx != null && my != null ? mx - my : cmp(x[1], y[1])
  })
  let prow = [...rowMap.values()]
  const tot0 = (r) => aggregate(r.all, vals[0], fields) ?? 0
  if (layout.topn || layout.sortTot) prow.sort((p, q) => tot0(q) - tot0(p))
  else prow.sort((p, q) => cmp(p.key, q.key))
  if (layout.topn) prow = prow.slice(0, layout.topn)

  const nR = Math.max(1, srows.length)
  const hasC = scols.length > 0
  const totCol = layout.totCol !== false // a Total column at the right (when there are columns)
  const totRow = layout.totRow !== false // a Total row at the bottom
  const multi = vals.length > 1
  // Subtotal columns: with two or more fields in Columns, each group of the first field gets a subtotal column after its columns.
  const subCol = !!layout.subtCol && scols.length > 1
  const ents = []
  cols.forEach(([k, p], i) => {
    ents.push({ k, p, sub: false })
    if (subCol && (i === cols.length - 1 || cols[i + 1][1][0] !== p[0])) ents.push({ k: `\u0002${p[0]}`, p: [p[0]], sub: true, g: p[0] })
  })
  const sameKey = (e) => (e.sub ? (r) => key(r, scols)[0] === e.g : (r) => key(r, scols).join('\u0001') === e.k)
  const recsOf = (row, e) => (e.sub ? [...row.cells.entries()].filter(([kk]) => kk.split('\u0001')[0] === e.g).flatMap(([, v]) => v) : (row.cells.get(e.k) || []))
  const colName = (e) => (e.sub ? `${e.p[0] || '(blank)'} subtotal` : e.p.map((x) => x || '(blank)').join(' / '))
  const gt = vals.map((v) => aggregate(rs, v, fields))
  const colTot = ents.map((e) => vals.map((v) => aggregate(rs.filter(sameKey(e)), v, fields)))
  const pctOk = (v) => v.a === 'sum' || v.a === 'count'
  const show = (x, v, d) => (layout.pct !== 'none' && pctOk(v) && x != null && d ? `${((x / d) * 100).toFixed(1)}%` : fmtNumber(x, v.a))

  const valName = (v) => String(layout.headers?.[v.f] ?? '').trim() || `${fields.map[v.f].label} (${AGG[v.a]})`
  const solo = !multi && !hasC ? String(layout.headers?.[vals[0].f] ?? '').trim() : ''
  // one heading for each field in Rows, so every column that the rows create has its own name
  const h1 = srows.length
    ? srows.map((id, i) => ({ t: nameOf(layout, fields.map[id]), cls: i === 0 ? 'l rh rf' : 'l rh', span: 1, rs: multi ? 2 : 1 }))
    : [{ t: 'All records', cls: 'l rh rf', span: 1, rs: multi ? 2 : 1 }]
  for (const e of ents) h1.push({ t: hasC ? colName(e) : (multi ? '' : (solo || (noVals ? 'Records' : valName(vals[0])))), span: vals.length, cls: e.sub ? 'sc' : '' })
  if (hasC && totCol) h1.push({ t: 'Total', span: vals.length, cls: 'tc', id: '__tot' })
  out.head = [h1]
  if (multi) out.head.push(ents.concat(hasC && totCol ? [{ total: true }] : []).flatMap((e) => vals.map((v) => ({ t: valName(v), cls: e.total ? 'tc' : e.sub ? 'sc' : '' }))))

  let max = 0
  const grid = prow.map((r) => ents.map((e) => vals.map((v) => {
    const x = aggregate(recsOf(r, e), v, fields)
    if (x != null && pctOk(v) && !e.sub) max = Math.max(max, Math.abs(x))
    return x
  })))

  let group = []
  const flushSub = () => {
    if (layout.subt && srows.length > 1 && group.length) {
      const all = group.flatMap((r) => r.all)
      const cs = ents.flatMap((e) => vals.map((v) => { const x = aggregate(all.filter(sameKey(e)), v, fields); return { t: show(x, v, 0), v: x, cls: 'st' } }))
      const tot = hasC && totCol ? vals.map((v) => { const x = aggregate(all, v, fields); return { t: fmtNumber(x, v.a), v: x, cls: 'tc st' } }) : []
      out.body.push({ cls: 'subt', cells: [{ t: 'Subtotal', cls: 'rh rf st', span: nR }, ...cs, ...tot] })
    }
    group = []
  }
  prow.forEach((r, ri) => {
    if (srows.length > 1 && ri > 0 && prow[ri - 1].key[0] !== r.key[0]) flushSub()
    group.push(r)
    const keyParts = srows.length ? r.key : ['All']
    const lab = keyParts.map((p, i) => {
      const same = srows.length && ri > 0 && prow[ri - 1].key.slice(0, i + 1).join('|') === r.key.slice(0, i + 1).join('|')
      return { t: same && i < nR - 1 ? '' : (p || '(blank)'), cls: `l rh${i === 0 ? ' rf' : ''}${same && i < nR - 1 ? ' sb' : ''}` }
    })
    const cs = ents.flatMap((e, ci) => vals.map((v, vi) => {
      const recs = recsOf(r, e)
      const x = grid[ri][ci][vi]
      const id = ++cid
      cells.set(id, { recs, label: `${keyParts.join(' / ')}${hasC ? ` - ${colName(e)}` : ''}` })
      const d = layout.pct === 'total' ? gt[vi] : layout.pct === 'row' ? aggregate(r.all, v, fields) : colTot[ci][vi]
      return { t: show(x, v, d), v: x, id, cls: `${recs.length ? 'cl' : ''}${e.sub ? ' sc' : ''}${hlClass(layout, x)}`, heat: layout.heat && !e.sub && x != null && max && pctOk(v) ? Math.min(0.55, (Math.abs(x) / max) * 0.55) : 0 }
    }))
    const tot = hasC && totCol ? vals.map((v, vi) => {
      const x = aggregate(r.all, v, fields)
      const id = ++cid
      cells.set(id, { recs: r.all, label: keyParts.join(' / ') })
      return { t: show(x, v, layout.pct === 'total' ? gt[vi] : layout.pct === 'row' ? x : 0), v: x, id, cls: `tc cl${hlClass(layout, x)}` }
    }) : []
    out.body.push({ cells: [...lab, ...cs, ...tot] })
  })
  flushSub()

  const ft = [{ t: 'Total', cls: 'l', span: nR }]
  ents.forEach((e, ci) => vals.forEach((v, vi) => {
    const x = colTot[ci][vi]
    const id = ++cid
    cells.set(id, { recs: rs.filter(sameKey(e)), label: `Total - ${colName(e)}` })
    ft.push({ t: show(x, v, layout.pct === 'total' ? gt[vi] : layout.pct === 'col' ? x : 0), v: x, id, cls: e.sub ? 'cl sc' : 'cl' })
  }))
  if (hasC && totCol) vals.forEach((v, vi) => {
    const id = ++cid
    cells.set(id, { recs: rs, label: 'Everything' })
    ft.push({ t: show(gt[vi], v, layout.pct === 'none' ? 0 : gt[vi]), v: gt[vi], id, cls: 'cl' })
  })
  out.foot = totRow ? ft : null
  out.stats = { records: rs.length, rows: prow.length, cols: cols.length }
  return out
}

// ---------------------------------------------------------------------------------------------------- flat form (for exports)
const spread = (c, pct) => [c.v != null && pct === 'none' ? c.v : c.t, ...Array(Math.max(0, (c.span || 1) - 1)).fill('')]
const srowsCount = (table) => { const f = table.body.find((r) => r.cls !== 'subt'); return f ? f.cells.filter((c) => /\brh\b/.test(c.cls || '')).length : 1 }
export function flatten(layout, table) {
  if (layout.mode === 'list') {
    return { head: table.cols.map((f) => nameOf(layout, f)), hr: null, body: table.body.map((r) => r.map((c, i) => (table.cols[i].kind === 'num' ? c.v : c.t))), foot: null, kinds: table.cols.map((f) => f.kind) }
  }
  // a heading that reaches down two rows leaves its columns empty in the second row of the flat form
  const hr = table.head.map((r, ri) => [...Array(ri === 0 ? 0 : table.head[ri - 1].filter((c) => (c.rs || 1) > 1).reduce((n, c) => n + (c.span || 1), 0)).fill(''), ...r.flatMap((c) => [c.t, ...Array(Math.max(0, (c.span || 1) - 1)).fill('')])])
  const first = table.body.find((r) => r.cls !== 'subt')
  const colCls = (first ? first.cells : []).flatMap((c) => Array(Math.max(1, c.span || 1)).fill(c.cls || ''))
  const hdr = table.head.map((r) => r.map((c) => ({ content: c.t, colSpan: c.span || 1, rowSpan: c.rs || 1, tc: /\b(tc|sc)\b/.test(c.cls || ''), left: /\bl\b/.test(c.cls || '') })))
  return {
    hr, hdr, head: hr[hr.length - 1], body: table.body.map((r) => r.cells.flatMap((c) => spread(c, layout.pct))), foot: table.foot ? table.foot.flatMap((c) => spread(c, layout.pct)) : null,
    rowCls: table.body.map((r) => r.cls || ''), colCls, rhCols: Math.max(1, srowsCount(table)),
  }
}
export const lastHead = (t) => (t.hr ? t.hr[t.hr.length - 1] : t.head)
export const toCsv = (t) => [lastHead(t), ...t.body, ...(t.foot ? [t.foot] : [])].map((l) => l.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
export const toTsv = (t) => [lastHead(t), ...t.body, ...(t.foot ? [t.foot] : [])].map((l) => l.map((x) => String(x ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n')
