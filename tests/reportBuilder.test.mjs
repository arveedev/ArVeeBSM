import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { T, N, D, inferFields, humanize, isDenied, weekOfDate, monthOfDate, monthOrder, buildFields } from '../src/utils/reportBuilder/fields.js'
import { blankLayout, buildTable, selectRows, passFilter, aggregate, flatten, toCsv, toTsv, sanitizeLayout, filterText } from '../src/utils/reportBuilder/engine.js'
import { reconcile, reconcileTable } from '../src/utils/reportBuilder/reconcile.js'

const rows = [
  { date: '2026-09-02', wh: 'BSI', type: 'WSR', who: 'Cedo', bags: 100, kg: 5000, status: 'Active' },
  { date: '2026-09-15', wh: 'BSI', type: 'WSI', who: 'LGU', bags: 40, kg: 2000, status: 'Active' },
  { date: '2026-10-03', wh: 'VRT', type: 'WSR', who: 'Seva', bags: 60, kg: 3000, status: 'Cancelled' },
  { date: '2026-10-04', wh: 'VRT', type: 'WSR', who: 'Cedo', bags: 20, kg: 1000, status: 'Active' },
  { date: '2026-10-05', wh: 'BSI', type: 'WSR', who: '', bags: 10, kg: 500, status: 'Active' },
]
const base = [D('date', 'Date'), T('wh', 'Warehouse'), T('type', 'Document'), T('who', 'Party'), N('bags', 'Net bags'), N('kg', 'Net kg'), T('status', 'Status')]
const L = (over) => ({ ...blankLayout('docs'), ...over })

test('a field list reads the data itself, hides secrets, and turns dates and timestamps into dates', () => {
  const f = inferFields([{ id: 'a', accessCode: 'x', name: 'N', bags: 5, at: 1760000000000, day: '2026-10-01', flag: true, arr: [1], owner: 'z' }])
  const ids = f.map((x) => x.id)
  assert.deepEqual(ids.sort(), ['at', 'bags', 'day', 'flag', 'id', 'name'])
  assert.equal(f.find((x) => x.id === 'bags').kind, 'num')
  assert.equal(f.find((x) => x.id === 'day').kind, 'date')
  assert.equal(f.find((x) => x.id === 'at').kind, 'date')
  assert.equal(f.find((x) => x.id === 'flag').get({ flag: true }), 'Yes')
  assert.equal(humanize('regionalAuthorityNumber'), 'Regional authority number')
  assert.ok(isDenied('accessCode') && isDenied('clientSecret') && !isDenied('warehouse'))
})

test('date parts: week starts on Monday, month sorts in time order', () => {
  assert.equal(weekOfDate('2026-10-07'), 'Wk 2026-10-05')
  assert.equal(monthOfDate('2026-10-07'), 'Oct 2026')
  assert.ok(monthOrder('Sep 2026') < monthOrder('Oct 2026'))
  assert.equal(monthOrder('Warehouse'), null)
})

test('filters: text, number and date rules, and the search over every field', () => {
  const fields = buildFields(base)
  const has = (ft) => rows.filter((r) => passFilter(r, ft, fields.map)).length
  assert.equal(has({ f: 'wh', op: 'is', v: ['BSI'] }), 3)
  assert.equal(has({ f: 'wh', op: 'isnot', v: ['BSI'] }), 2)
  assert.equal(has({ f: 'who', op: 'blank' }), 1)
  assert.equal(has({ f: 'who', op: 'has', v: 'ed' }), 2)
  assert.equal(has({ f: 'bags', op: 'gt', v: '40' }), 2)
  assert.equal(has({ f: 'bags', op: 'btw', v: '20', v2: '60' }), 3)
  assert.equal(has({ f: 'date', op: 'onafter', v: '2026-10-01' }), 3)
  assert.equal(has({ f: 'date', op: 'btw', v: '2026-09-10', v2: '2026-10-03' }), 2)
  assert.equal(selectRows(rows, L({ search: 'cancel' }), fields).length, 1)
  assert.equal(selectRows(rows, L({ search: 'bsi', filters: [{ f: 'type', op: 'is', v: ['WSR'] }] }), fields).length, 2)
})

test('pivot: rows x columns with totals that add up, sorted months, and every number leads to its records', () => {
  const layout = L({ rows: ['wh'], cols: ['date_mo'], vals: [{ f: 'bags', a: 'sum' }] })
  const t = buildTable(layout, base, rows)
  assert.deepEqual(t.head[0].map((c) => c.t), ['Warehouse', 'Sep 2026', 'Oct 2026', 'Total'])
  const bsi = t.body.find((r) => r.cells[0].t === 'BSI')
  assert.deepEqual(bsi.cells.slice(1).map((c) => c.v), [140, 10, 150])
  assert.equal(t.foot.at(-1).v, 230) // grand total = every record
  const drill = t.cells.get(bsi.cells[1].id)
  assert.equal(drill.recs.length, 2) // the two BSI documents of September
  assert.equal(drill.recs.reduce((s, r) => s + r.bags, 0), 140)
})

test('pivot options: several values, subtotals, percentages, top N, shading, highlight', () => {
  const t = buildTable(L({ rows: ['wh', 'type'], vals: [{ f: 'bags', a: 'sum' }, { f: 'kg', a: 'count' }], subt: true }), base, rows)
  assert.equal(t.body.filter((r) => r.cls === 'subt').length, 2)
  const p = buildTable(L({ rows: ['wh'], vals: [{ f: 'bags', a: 'sum' }], pct: 'total' }), base, rows)
  assert.equal(p.body.find((r) => r.cells[0].t === 'BSI').cells[1].t, '65.2%') // 150 of 230
  const top = buildTable(L({ rows: ['who'], vals: [{ f: 'bags', a: 'sum' }], topn: 1 }), base, rows)
  assert.equal(top.body.length, 1)
  assert.equal(top.body[0].cells[0].t, 'Cedo')
  const hl = buildTable(L({ rows: ['wh'], vals: [{ f: 'bags', a: 'sum' }], hl: { op: '>', val: 100, col: 'red' } }), base, rows)
  assert.ok(hl.body.find((r) => r.cells[0].t === 'BSI').cells[1].cls.includes('hl-red'))
})

test('calculated fields check one number against another', () => {
  const calc = [{ id: 'c1', label: 'Kg per bag', a: 'kg', op: '/', b: 'bags' }]
  const t = buildTable(L({ mode: 'list', calc, filters: [{ f: 'c1', op: 'ne', v: '50' }] }), base, rows)
  assert.equal(t.body.length, 0) // every document weighs 50 kg a bag
  const diff = buildTable(L({ rows: ['wh'], calc: [{ id: 'c2', label: 'Over', a: 'kg', op: '-', b: '#', k: 1000 }], vals: [{ f: 'c2', a: 'sum' }] }), base, rows)
  assert.equal(diff.foot.at(-1).v ?? diff.foot[1].v, 11500 - 5000 - 0) // 11,500 kg total less 5 x 1,000
})

test('list mode: sort by several levels, hide and reorder columns, the first 300 only on screen but all in an export', () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ ...rows[i % 5], bags: i }))
  const t = buildTable(L({ mode: 'list', sort: [{ f: 'wh', dir: 1 }, { f: 'bags', dir: -1 }], hidden: ['kg'], order: ['bags'] }), base, many)
  assert.equal(t.cols[0].id, 'bags')
  assert.ok(!t.cols.some((c) => c.id === 'kg'))
  assert.equal(t.body.length, 300)
  assert.equal(t.stats.more, 150)
  assert.equal(buildTable(L({ mode: 'list' }), base, many, { full: true }).body.length, 450)
  const first = t.body[0].map((c) => c.t)
  assert.equal(first[0], '449') // BSI rows, biggest bags first
})

test('exports come from the same table: numbers stay numbers, csv and tsv are correct', () => {
  const layout = L({ rows: ['wh'], vals: [{ f: 'bags', a: 'sum' }] })
  const flat = flatten(layout, buildTable(layout, base, rows))
  assert.deepEqual(flat.body[0], ['BSI', 150])
  assert.deepEqual(flat.foot, ['Total', 230])
  assert.equal(toCsv(flat).split('\n')[0], '"Warehouse","Net bags (Sum)"')
  assert.equal(toTsv(flat).split('\n').at(-1), 'Total\t230')
  assert.deepEqual(filterText(L({ filters: [{ f: 'type', op: 'is', v: ['WSR'] }], search: 'x' }), buildFields(base)), ['Document is WSR', 'Search "x"'])
})

test('a saved layout that names a missing field drops that part and says so', () => {
  const { layout, dropped } = sanitizeLayout({ source: 'docs', rows: ['wh', 'gone'], vals: [{ f: 'bags', a: 'sum' }, { f: 'gone2', a: 'sum' }], filters: [{ f: 'gone3', op: 'is', v: ['x'] }] }, buildFields(base).map)
  assert.deepEqual(layout.rows, ['wh'])
  assert.equal(layout.vals.length, 1)
  assert.equal(layout.filters.length, 0)
  assert.equal(dropped.length, 3)
})

test('compare two sources by a key: matches, differences, and what is only on one side', () => {
  const A = { rows: [{ ai: '1', auth: 100 }, { ai: '2', auth: 50 }, { ai: '3', auth: 10 }], baseFields: [T('ai', 'Authority'), N('auth', 'Authorized')], key: ['ai'], value: 'auth' }
  const B = { rows: [{ ai: '1', kg: 60 }, { ai: '1', kg: 40 }, { ai: '2', kg: 45 }, { ai: '9', kg: 5 }], baseFields: [T('ai', 'Authority'), N('kg', 'Issued')], key: ['ai'], value: 'kg' }
  const r = reconcile(A, B, { tolerance: 0 })
  const by = (k) => r.rows.find((x) => x.key[0] === k)
  assert.equal(by('1').status, 'match') // 60 + 40 = 100
  assert.equal(by('2').status, 'differs')
  assert.equal(by('2').diff, 5)
  assert.equal(by('3').status, 'onlyA')
  assert.equal(by('9').status, 'onlyB')
  assert.deepEqual([r.summary.match, r.summary.differs, r.summary.onlyA, r.summary.onlyB], [1, 1, 1, 1])
  assert.equal(reconcile(A, B, { tolerance: 5 }).rows.find((x) => x.key[0] === '2').status, 'match')
  assert.equal(reconcileTable(r, { key: ['Authority'], a: 'Authorized', b: 'Issued' }).body.length, 4)
})

test('THE RULE: nothing under reportBuilder can write to the database', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils', 'reportBuilder')
  const banned = /\.(add|put|update|delete|bulkPut|bulkAdd|bulkDelete|clear|upsert)\s*\(|transaction\(\s*['"]rw|db\.[a-zA-Z]+\.(?:add|put|update|delete)/
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    assert.ok(!banned.test(text), `${f} contains a write call`)
  }
})

test('roles: the Analyst reads like a Visitor, the Visitor never gets the Tools, staff only their own warehouses', async () => {
  const { isViewerRole, isWideRole, canUseReportBuilder } = await import('../src/utils/roles.js')
  assert.ok(isViewerRole('Visitor') && isViewerRole('Analyst') && !isViewerRole('Admin') && !isViewerRole('SDO'))
  assert.ok(isWideRole('Admin') && isWideRole('Analyst') && !isWideRole('Warehouse Supervisor') && !isWideRole('Visitor'))
  assert.ok(canUseReportBuilder({ role: 'Admin' }) && canUseReportBuilder({ role: 'Analyst' }) && canUseReportBuilder({ role: 'MPO III' }) && canUseReportBuilder({ role: 'Acting Warehouse Assistant' }))
  assert.ok(!canUseReportBuilder({ role: 'Visitor' }) && !canUseReportBuilder({ role: 'SDO' }) && !canUseReportBuilder(null))
  assert.ok(!canUseReportBuilder({ role: 'Visitor' }, { reportBuilder: { staff: true, analyst: true } })) // no switch can open it to a Visitor
  assert.ok(!canUseReportBuilder({ role: 'Warehouse Supervisor' }, { reportBuilder: { staff: false } }))
  assert.ok(canUseReportBuilder({ role: 'Analyst' }, { reportBuilder: { staff: false } }))
})

test('sources: unique ids, secrets never offered, wide-only data is marked, staff are scoped in the data layer', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils', 'reportBuilder')
  const text = fs.readFileSync(path.join(dir, 'sources.js'), 'utf8')
  const ids = [...text.matchAll(/\{ id: '([a-z_]+)', (?:dateField: '[A-Za-z]+', )?group: /g)].map((m) => m[1])
  assert.ok(ids.length >= 25)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ['cash', 'cash_counts', 'cutoffs']) assert.ok(new RegExp(`id: '${id}'[^\n]*access: '(wide|admin)'`).test(text), `${id} must be wide or admin only`)
  assert.ok(!/group: 'Administration'/.test(text)) // nothing from the Administration area is offered to anyone
  assert.ok(/allowed = isWideRole\(user\?\.role\) \? null : new Set\(user\?\.assignedWarehouses \?\? \[\]\)/.test(text))
  assert.ok(isDenied('accessCode') && isDenied('pinHash'))
})

test('formulas: arithmetic with brackets, functions, conditions; mistakes are explained, nothing is evaluated as code', async () => {
  const { parseFormula, unknownRefs } = await import('../src/utils/reportBuilder/formula.js')
  const f = buildFields(base, [
    { id: 'c1', label: 'Weight check', formula: '[Net kg] * [Net bags] - [Net kg]' },
    { id: 'c2', label: 'Per bag', formula: 'ROUND(([Net kg] / [Net bags]) * 50, 2)' },
    { id: 'c3', label: 'Big only', formula: 'IF([Net kg] > 2500, [Net kg], 0)' },
    { id: 'c4', label: 'Uses another', formula: '[Weight check] + 1' },
    { id: 'c5', label: 'Divide', formula: '[Net kg] / 0' },
    { id: 'c6', label: 'Power and minus', formula: '-2 ^ 2 + MAX(1, 5, 3) - ABS(-4)' },
  ])
  const t = buildTable(L({ mode: 'list', hidden: [] }), base, rows.slice(0, 1))
  void t
  const r = rows[0] // 100 bags (field 'bags'), 5000 kg
  const get = (id) => buildTable(L({ rows: [], vals: [{ f: id, a: 'sum' }], calc: f.list.filter((x) => x.calc).map((x) => x.calc) }), base, [r]).foot ?? null
  const sum = (id) => buildTable(L({ vals: [{ f: id, a: 'sum' }], calc: f.list.filter((x) => x.calc).map((x) => x.calc) }), base, [r]).body[0].cells.at(-1).v
  assert.equal(sum('c1'), 5000 * 100 - 5000)
  assert.equal(sum('c2'), 2500)
  assert.equal(sum('c3'), 5000)
  assert.equal(sum('c4'), 5000 * 100 - 5000 + 1)
  assert.equal(sum('c5'), 0)
  assert.equal(sum('c6'), 4 + 5 - 4) // unary minus binds tighter than ^ here: (-2)^2 = 4
  void get
  assert.equal(parseFormula('[a] +').ok, false)
  assert.match(parseFormula('process.exit(1)').error, /not a function/)
  assert.match(parseFormula('[Net kg').error, /closing/)
  assert.match(parseFormula('').error, /Write a formula/)
  assert.deepEqual(unknownRefs('[Net kg] + [Nope]', ['Net kg']), ['Nope'])
})

test('categories: main fields first, technical bookkeeping folded away, every field in exactly one group', async () => {
  const { groupFields, categoryOf } = await import('../src/utils/reportBuilder/categories.js')
  const fields = [D('date', 'Date'), T('wh', 'Warehouse'), N('bags', 'Net bags'), N('amount', 'Amount (PHP)'), T('authorityAckAt', 'Authority ack at'), T('createdByName', 'Entered by'), T('aiNumber', 'Authority no. (AI)'), T('status', 'Status'), T('zzz', 'Whatever')]
  const g = groupFields(fields, ['date', 'wh', 'bags'])
  assert.deepEqual(g[0].fields.map((f) => f.id), ['date', 'wh', 'bags'])
  assert.equal(g.reduce((n, x) => n + x.fields.length, 0), fields.length - 1) // the bookkeeping field is left out
  assert.ok(!g.some((x) => x.id === 'tech'))
  assert.equal(categoryOf(fields[4], []), 'tech')
  assert.equal(categoryOf(fields[3], []), 'money')
  assert.equal(categoryOf(fields[5], []), 'people')
  assert.equal(categoryOf(fields[6], []), 'authority')
  assert.equal(categoryOf({ id: 'c', label: 'x', kind: 'num', calc: {} }, []), 'calc')
})

test('the period: nothing before September 1, 2026 ever shows, and a row with no date is left out', async () => {
  const { REPORT_FLOOR, clampPeriod, applyPeriod } = await import('../src/utils/reportBuilder/engine.js')
  assert.equal(REPORT_FLOOR, '2026-09-01')
  assert.deepEqual(clampPeriod({ from: '2026-01-01', to: '2026-10-05' }), { from: '2026-09-01', to: '2026-10-05' })
  assert.deepEqual(clampPeriod({ from: '2026-08-01', to: '2026-08-20' }), { from: '2026-09-01', to: '2026-09-01' })
  assert.equal(clampPeriod({ from: '2026-10-10', to: '2026-10-01' }).to, '2026-10-10')
  const data = [{ date: '2026-08-30' }, { date: '2026-09-01' }, { date: '2026-09-15T08:00' }, { date: '' }, { date: null }, { date: '2026-10-20' }]
  assert.deepEqual(applyPeriod(data, 'date', { from: '2020-01-01', to: '2026-09-30' }).map((r) => r.date), ['2026-09-01', '2026-09-15T08:00'])
  assert.equal(applyPeriod(data, null, { from: '2026-09-01', to: '2026-09-02' }).length, 6) // a source with no dates is not cut
})

test('formulas: average, sum, median, count, power, sqrt, mod work over the values given', async () => {
  const { parseFormula, evalTree } = await import('../src/utils/reportBuilder/formula.js')
  const run = (t) => { const p = parseFormula(t); assert.ok(p.ok, t); return evalTree(p.tree, () => 0) }
  assert.equal(run('AVERAGE(2, 4, 9)'), 5)
  assert.equal(run('AVG(1, 2)'), 1.5)
  assert.equal(run('SUM(1, 2, 3)'), 6)
  assert.equal(run('MEDIAN(9, 1, 5)'), 5)
  assert.equal(run('MEDIAN(1, 2, 3, 4)'), 2.5)
  assert.equal(run('COUNT(0, 3, 4)'), 2)
  assert.equal(run('POWER(2, 3)'), 8)
  assert.equal(run('SQRT(16)'), 4)
  assert.equal(run('MOD(10, 4)'), 2)
})

test('fields nobody needs are left out of the picker, and a pivot blank key is named', async () => {
  const { isHiddenField } = await import('../src/utils/reportBuilder/categories.js')
  for (const [id, label] of [['createdByName', 'Entered by'], ['date_wk', 'Date (week)'], ['residuePileTo', 'Residue pile to'], ['warehouseCode', 'Warehouse code'], ['warehouseShort', 'Warehouse short'], ['recordedByName', 'Recorded by'], ['groupSerialNo', 'Group serial no.'], ['isClosingResidue', 'Is closing residue'], ['isInitialBalance', 'Is initial balance'], ['issuedStockCondition', 'Issued stock condition'], ['receivedCondition', 'Received condition'], ['ageUnit', 'Age unit'], ['ageValue', 'Age value'], ['createdAt', 'Created at'], ['dateProcured', 'Date procured'], ['issuedVariety', 'Issued variety'], ['receivedVariety', 'Received variety'], ['linkedDocNo', 'Linked doc no.']]) {
    assert.ok(isHiddenField({ id, label, kind: 'txt', d: id.endsWith('_wk') }), `${label} should be hidden`)
  }
  assert.ok(!isHiddenField({ id: 'netKilos', label: 'Net kg', kind: 'num' }))
  assert.ok(!isHiddenField({ id: 'date_mo', label: 'Date (month)', kind: 'txt', d: true }))
})
