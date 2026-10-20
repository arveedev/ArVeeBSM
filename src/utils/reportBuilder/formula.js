// Report Builder: calculated fields written as a formula (pure, no eval, no database).
//   [Net kg] * [Net bags] - [Gross kg]          a field is written in square brackets, by the name shown on screen
//   ROUND(([Amount] / [Net kg]) * 50, 2)         + - * / % ^ ( ), numbers, and these functions:
//   IF([Net kg] > 5000, [Net kg], 0)             ABS ROUND FLOOR CEIL MIN MAX IF AND OR NOT
// Conditions: > < >= <= = <>. A division by zero gives 0 (like a blank cell, never an error on screen). Text is never calculated.

const FUNCS = { ABS: 1, ROUND: [1, 2], FLOOR: 1, CEIL: 1, CEILING: 1, MIN: 'n', MAX: 'n', IF: 3, AND: 'n', OR: 'n', NOT: 1 }

class FormulaError extends Error {}
const fail = (m) => { throw new FormulaError(m) }

// ---------------------------------------------------------------------------------------------------- tokens
function tokenize(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '[') {
      const j = src.indexOf(']', i + 1)
      if (j < 0) fail('A [ has no closing ]')
      const name = src.slice(i + 1, j).trim()
      if (!name) fail('There is nothing between [ and ]')
      out.push({ t: 'ref', v: name }); i = j + 1; continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const n = Number(src.slice(i, j))
      if (!Number.isFinite(n)) fail(`"${src.slice(i, j)}" is not a number`)
      out.push({ t: 'num', v: n }); i = j; continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      const w = src.slice(i, j).toUpperCase()
      if (!(w in FUNCS) && w !== 'TRUE' && w !== 'FALSE') fail(`"${src.slice(i, j)}" is not a function. Write a field name in square brackets, like [Net kg]`)
      out.push(w === 'TRUE' || w === 'FALSE' ? { t: 'num', v: w === 'TRUE' ? 1 : 0 } : { t: 'fn', v: w }); i = j; continue
    }
    const two = src.slice(i, i + 2)
    if (['>=', '<=', '<>', '!=', '=='].includes(two)) { out.push({ t: 'op', v: two === '!=' ? '<>' : two === '==' ? '=' : two }); i += 2; continue }
    if ('+-*/%^()<>=,'.includes(c)) { out.push({ t: c === '(' || c === ')' || c === ',' ? c : 'op', v: c }); i++; continue }
    fail(`I do not understand "${c}"`)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------- parser (precedence climbing)
const PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '%': 3, '^': 5 }
function parse(tokens) {
  let p = 0
  const peek = () => tokens[p]
  const next = () => tokens[p++]
  function primary() {
    const t = next()
    if (!t) fail('The formula ends too soon')
    if (t.t === 'num') return { k: 'num', v: t.v }
    if (t.t === 'ref') return { k: 'ref', v: t.v }
    if (t.t === 'op' && t.v === '-') return { k: 'neg', a: primary() } // like a spreadsheet: -2^2 is 4
    if (t.t === 'op' && t.v === '+') return primary()
    if (t.t === '(') { const e = bin(0); if (next()?.t !== ')') fail('A ( has no closing )'); return e }
    if (t.t === 'fn') {
      if (next()?.t !== '(') fail(`${t.v} needs ( after it`)
      const args = []
      if (peek()?.t !== ')') { for (;;) { args.push(bin(0)); if (peek()?.t === ',') { next(); continue } break } }
      if (next()?.t !== ')') fail(`${t.v}( has no closing )`)
      const want = FUNCS[t.v]
      const ok = want === 'n' ? args.length >= 1 : Array.isArray(want) ? args.length >= want[0] && args.length <= want[1] : args.length === want
      if (!ok) fail(`${t.v} is given the wrong number of values`)
      return { k: 'fn', f: t.v, args }
    }
    return fail(`Unexpected "${t.v ?? t.t}"`)
  }
  function bin(min) {
    let left = primary()
    for (;;) {
      const t = peek()
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < min) break
      next()
      const right = bin(t.v === '^' ? PREC[t.v] : PREC[t.v] + 1)
      left = { k: 'bin', op: t.v, a: left, b: right }
    }
    return left
  }
  const tree = bin(0)
  if (p < tokens.length) fail(`Unexpected "${tokens[p].v ?? tokens[p].t}"`)
  return tree
}

let cache = new Map()
/** Parse a formula once. Returns { ok: true, tree, refs } or { ok: false, error }. */
export function parseFormula(text) {
  const key = String(text ?? '')
  if (cache.has(key)) return cache.get(key)
  let res
  try {
    if (!key.trim()) fail('Write a formula, for example [Net kg] * [Net bags]')
    const tree = parse(tokenize(key))
    const refs = []
    const walk = (n) => { if (n.k === 'ref') refs.push(n.v); n.a && walk(n.a); n.b && walk(n.b); n.args && n.args.forEach(walk) }
    walk(tree)
    res = { ok: true, tree, refs: [...new Set(refs)] }
  } catch (e) {
    if (!(e instanceof FormulaError)) throw e
    res = { ok: false, error: e.message }
  }
  if (cache.size > 500) cache = new Map()
  cache.set(key, res)
  return res
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
/** Evaluate a parsed tree for one row; `get(name)` returns the number for a field name (or undefined when there is no such field). */
export function evalTree(n, get) {
  switch (n.k) {
    case 'num': return n.v
    case 'ref': { const v = get(n.v); if (v === undefined) fail(`There is no field called [${n.v}]`); return num(v) }
    case 'neg': return -evalTree(n.a, get)
    case 'bin': {
      const a = evalTree(n.a, get)
      const b = evalTree(n.b, get)
      switch (n.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return b ? a / b : 0
        case '%': return b ? a % b : 0
        case '^': return a ** b
        case '=': return Math.abs(a - b) < 1e-9 ? 1 : 0
        case '<>': return Math.abs(a - b) < 1e-9 ? 0 : 1
        case '<': return a < b ? 1 : 0
        case '>': return a > b ? 1 : 0
        case '<=': return a <= b ? 1 : 0
        default: return a >= b ? 1 : 0
      }
    }
    default: {
      const v = n.args.map((a) => evalTree(a, get))
      switch (n.f) {
        case 'ABS': return Math.abs(v[0])
        case 'ROUND': { const d = 10 ** (v[1] ?? 0); return Math.round(v[0] * d) / d }
        case 'FLOOR': return Math.floor(v[0])
        case 'CEIL': case 'CEILING': return Math.ceil(v[0])
        case 'MIN': return Math.min(...v)
        case 'MAX': return Math.max(...v)
        case 'IF': return v[0] ? v[1] : v[2]
        case 'AND': return v.every(Boolean) ? 1 : 0
        case 'OR': return v.some(Boolean) ? 1 : 0
        default: return v[0] ? 0 : 1
      }
    }
  }
}

/** The names a formula refers to that are not in `names` (lower case compare). */
export const unknownRefs = (text, names) => {
  const p = parseFormula(text)
  if (!p.ok) return []
  const have = new Set([...names].map((x) => String(x).toLowerCase()))
  return p.refs.filter((r) => !have.has(r.toLowerCase()))
}
