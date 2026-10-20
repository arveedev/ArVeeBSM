// Report Builder: compare two sources by a key (pure, read-only).
// Rows of A and B are grouped by their key and a number is totalled on each side; the result lists every key with both totals, the
// difference and whether it matches, is only in A, only in B or differs. A tolerance (for rounding) decides what counts as a match.

import { buildFields, readValue, numericOf } from './fields.js'

const keyOf = (r, ids, fields) => ids.map((id) => String(readValue(r, fields.map[id], fields.map) ?? '').trim().toLowerCase()).join('\u0001')
const labelOf = (r, ids, fields) => ids.map((id) => String(readValue(r, fields.map[id], fields.map) ?? '').trim())

export const STATUS = { match: 'Matches', differs: 'Differs', onlyA: 'Only in A', onlyB: 'Only in B' }

/**
 * @param A,B { rows, baseFields, key: [fieldId...], value: fieldId | null (null = count of records) }
 * @param tolerance numbers that differ by no more than this count as a match
 */
export function reconcile(A, B, { tolerance = 0 } = {}) {
  const fa = buildFields(A.baseFields, A.calc)
  const fb = buildFields(B.baseFields, B.calc)
  const total = (rows, f, value) => (value ? rows.reduce((s, r) => s + numericOf(r, value, f.map), 0) : rows.length)
  const group = (src, f) => {
    const m = new Map()
    for (const r of src.rows) {
      const k = keyOf(r, src.key, f)
      if (!m.has(k)) m.set(k, { label: labelOf(r, src.key, f), rows: [] })
      m.get(k).rows.push(r)
    }
    return m
  }
  const ga = group(A, fa)
  const gb = group(B, fb)
  const keys = new Set([...ga.keys(), ...gb.keys()])
  const out = []
  for (const k of keys) {
    const a = ga.get(k)
    const b = gb.get(k)
    const va = a ? total(a.rows, fa, A.value) : null
    const vb = b ? total(b.rows, fb, B.value) : null
    const diff = (va ?? 0) - (vb ?? 0)
    const status = !a ? 'onlyB' : !b ? 'onlyA' : Math.abs(diff) <= tolerance ? 'match' : 'differs'
    out.push({ key: (a ?? b).label, a: va, b: vb, diff, status, countA: a ? a.rows.length : 0, countB: b ? b.rows.length : 0, recsA: a ? a.rows : [], recsB: b ? b.rows : [] })
  }
  out.sort((x, y) => x.key.join(' ').localeCompare(y.key.join(' '), undefined, { numeric: true }))
  const count = (s) => out.filter((r) => r.status === s).length
  return { rows: out, summary: { keys: out.length, match: count('match'), differs: count('differs'), onlyA: count('onlyA'), onlyB: count('onlyB'), totalA: out.reduce((s, r) => s + (r.a ?? 0), 0), totalB: out.reduce((s, r) => s + (r.b ?? 0), 0) } }
}

/** The result as a plain table (for the screen and the exports). */
export function reconcileTable(res, labels) {
  const head = [...labels.key, labels.a, labels.b, 'Difference', 'Result', 'Records A', 'Records B']
  const body = res.rows.map((r) => [...r.key, r.a ?? '', r.b ?? '', r.diff, STATUS[r.status], r.countA, r.countB])
  return { head, body }
}
