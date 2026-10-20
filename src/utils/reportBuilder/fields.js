// Report Builder: field definitions (pure, no database).
// A source is an array of flat rows (plain objects). A field says how to read one value of a row, what kind of value it is
// ('txt' | 'num' | 'date') and how it is labelled. Date fields also offer a week and a month version for grouping.

import { parseFormula, evalTree } from './formula.js'

export const KINDS = ['txt', 'num', 'date']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayOf = (v) => String(v ?? '').slice(0, 10)
export const weekOfDate = (s) => {
  const d = dayOf(s)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  const t = new Date(`${d}T00:00:00Z`)
  const dow = (t.getUTCDay() + 6) % 7
  return `Wk ${new Date(t - dow * 86400000).toISOString().slice(0, 10)}`
}
export const monthOfDate = (s) => {
  const d = dayOf(s)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : ''
}
/** The sort key of a "Mon YYYY" label (so Sep 2026 comes before Oct 2026), or null when the text is not a month label. */
export const monthOrder = (text) => {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(String(text ?? ''))
  return m && MONTHS.includes(m[1]) ? +m[2] * 12 + MONTHS.indexOf(m[1]) : null
}

export const T = (id, label) => ({ id, label, kind: 'txt' })
export const N = (id, label) => ({ id, label, kind: 'num' })
export const D = (id, label) => ({ id, label, kind: 'date' })

/** "regionalAuthorityNumber" -> "Regional authority number"; "wsr_no" -> "Wsr no". */
export const humanize = (id) => {
  const s = String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Anything that must never be offered, whatever the table (secrets, tokens, internal sync bookkeeping).
const DENY = /(^|\b)(accesscode|pin|password|secret|token|clientsecret|hash|owner|realmid|\$\$|_rev|isSynced|hasBeenBackedUp|sheetRow)/i
export const isDenied = (id) => DENY.test(String(id))

const looksDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(v)
const looksEpoch = (v) => typeof v === 'number' && v > 1.2e12 && v < 4.2e12

/**
 * Fields for a table whose columns are not listed by hand: read from the data itself. Scalar values only (arrays and objects are
 * left to the source adapters, which can spread them into their own rows). `overrides` = { id: { label, kind, hide } }.
 */
export const inferFields = (rows, overrides = {}, sample = 200) => {
  const seen = new Map()
  const looked = new Map() // how many filled values of a column have been looked at (the first few decide its kind)
  for (const r of rows) {
    for (const [k, v] of Object.entries(r ?? {})) {
      if (k.startsWith('__') || isDenied(k) || (overrides[k] && overrides[k].hide)) continue
      const empty = v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
      if (empty) { if (!seen.has(k)) seen.set(k, null); continue }
      if (typeof v === 'object') { seen.set(k, 'skip'); continue }
      const prev = seen.get(k)
      if (prev === 'skip') continue
      const n = looked.get(k) ?? 0
      if (n >= sample && prev) continue
      looked.set(k, n + 1)
      const kind = typeof v === 'number' ? (looksEpoch(v) ? 'epoch' : 'num') : typeof v === 'boolean' ? 'bool' : looksDate(v) ? 'date' : 'txt'
      if (prev && prev !== kind) seen.set(k, 'txt')
      else seen.set(k, kind)
    }
  }
  const out = []
  for (const [id, kind] of seen) {
    if (kind === 'skip') continue
    const o = overrides[id] ?? {}
    const k = o.kind ?? (kind === 'epoch' ? 'date' : kind === 'bool' ? 'txt' : kind ?? 'txt')
    const f = { id, label: o.label ?? humanize(id), kind: k }
    if (kind === 'epoch') f.get = (r) => (typeof r[id] === 'number' ? new Date(r[id]).toISOString().slice(0, 16).replace('T', ' ') : '')
    else if (kind === 'bool') f.get = (r) => (r[id] === true ? 'Yes' : r[id] === false ? 'No' : '')
    out.push(f)
  }
  return out
}

/** Every field plus, for each date field, its week and month versions (marked `d` so a plain list can leave them out). */
export const withDateParts = (fields) => {
  const out = []
  for (const f of fields) {
    out.push(f)
    if (f.kind === 'date') {
      const read = (r) => (f.get ? f.get(r) : r[f.id])
      out.push({ id: `${f.id}_wk`, label: `${f.label} (week)`, kind: 'txt', d: true, get: (r) => weekOfDate(read(r)) })
      out.push({ id: `${f.id}_mo`, label: `${f.label} (month)`, kind: 'txt', d: true, get: (r) => monthOfDate(read(r)) })
    }
  }
  return out
}

/** Fields of a source plus the layout's own calculated fields, as { list, map }. */
export const buildFields = (base, calc = []) => {
  const list = withDateParts(base)
  for (const c of calc) list.push({ id: c.id, label: c.label, kind: 'num', calc: c })
  const map = Object.fromEntries(list.map((f) => [f.id, f]))
  return { list, map }
}

export const readValue = (row, f, map) => {
  if (f.calc) return calcValue(row, f.calc, map)
  return f.get ? f.get(row) : row[f.id]
}
const numberOf = (row, id, map) => {
  const f = map[id]
  const v = f ? readValue(row, f, map) : row[id]
  return typeof v === 'number' ? v : Number(v) || 0
}
// A formula names fields by the label shown on screen; resolved through an index kept per field map.
const indexes = new WeakMap()
const labelIndex = (map) => {
  let m = indexes.get(map)
  if (!m) { m = new Map(); for (const f of Object.values(map)) if (!m.has(f.label.toLowerCase())) m.set(f.label.toLowerCase(), f.id); indexes.set(map, m) }
  return m
}
export function calcValue(row, c, map, depth = 0) {
  if (c.formula != null) {
    const p = parseFormula(c.formula)
    if (!p.ok || depth > 6) return 0
    const idx = labelIndex(map)
    const get = (name) => {
      const id = idx.get(String(name).toLowerCase()) ?? (map[name] ? name : undefined)
      if (!id) return undefined
      if (id === c.id) return 0
      const f = map[id]
      const v = f.calc ? calcValue(row, f.calc, map, depth + 1) : (f.get ? f.get(row) : row[f.id])
      return typeof v === 'number' ? v : Number(v) || 0
    }
    try { return evalTree(p.tree, get) } catch { return 0 }
  }
  // the first version of a calculated field: A (+ - * /) B or a fixed number
  const a = numberOf(row, c.a, map)
  const b = c.b === '#' ? Number(c.k) || 0 : numberOf(row, c.b, map)
  if (c.op === '+') return a + b
  if (c.op === '-') return a - b
  if (c.op === '*') return a * b
  return b ? a / b : 0
}
export const numericOf = numberOf
