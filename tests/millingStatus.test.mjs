import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMillingStatus, millingStatusText, remarksText, parseLotNote, DEFAULT_MILLING_TABLE } from '../src/utils/millingStatus.js'

const tr = (ai, miller, note, date, bags = 0) => ({ aiNumber: ai, customer: miller, note, date, bags })

test('the note is read as issued-so-far / QTY', () => {
  assert.deepEqual(parseLotNote('6000 / 7205.05'), { issued: 6000, qty: 7205.05 })
  assert.deepEqual(parseLotNote('KINALE 3B 500 / 6263.35'), { issued: 500, qty: 6263.35 })
  assert.deepEqual(parseLotNote('TAB GID A 4 500 / 4996.96'), { issued: 500, qty: 4996.96 })
  assert.equal(parseLotNote('PARTIAL'), null)
})

test("the office's table is kept exactly: every row, in order, and Expected Rice Recovery = QTY x GMR as printed", () => {
  const r = buildMillingStatus({})
  assert.equal(r.rows.length, 13)
  assert.deepEqual(r.rows.map((x) => x.lotNo), ['1', '2', '8', '9', '10', '3', '11', '13', '4', '5', '6', '12', '7']) // not 1..13
  const printed = [3874.77, 4203.03, 270.21, 4358.53, 2681.78, 3204.55, 4073.68, 1910.71, 3501.89, 6189.91, 10102.14, 2582.09, 4632.85]
  r.rows.forEach((x, i) => assert.equal(Math.round(x.expected * 100) / 100, printed[i], `lot ${x.lotNo}`))
  assert.equal(Math.round(r.groups[0].total.qty * 100) / 100, 24093.39) // Borromeo total as printed
  assert.equal(Math.round(r.groups[1].total.qty * 100) / 100, 14241.6)
  assert.equal(Math.round(r.groups[1].total.expected * 100) / 100, 9188.94)
  assert.deepEqual(r.groups.map((g) => g.miller), ['Borromeo', 'Kipshoven', 'Buama', 'Dens', 'Magayon'])
})

test('a row with no issuance yet shows no total issued and no as-of date', () => {
  const r = buildMillingStatus({ issues: [] })
  for (const x of r.rows) { assert.equal(x.totalIssued, null); assert.equal(x.asOf, null); assert.equal(remarksText(x), '') }
  const text = millingStatusText(r).split('\n')
  assert.ok(text.slice(1).every((l) => l.split('\t')[8] === '' && l.split('\t')[9] === ''))
})

test('total issued: the latest tranche of the lot (same ricemill, same QTY) up to the period end', () => {
  const issues = [
    tr('1', 'MAGAYON RM', '1000 / 7205.05', '2026-09-30'), tr('2', 'MAGAYON RICEMILL', '7000 / 7205.05', '2026-10-10'), tr('3', 'MAGAYON RICEMILL', '7205 / 7205.05', '2026-10-12', 205),
    tr('4', 'Borromeo Ricemill', '750 / 6482.15', '2026-10-06'), tr('5', 'Borromeo Ricemill', '4500 / 6482.15', '2026-10-15'),
    tr('6', 'Borromeo Ricemill', '5250 / 6124.18', '2026-10-03'), tr('7', 'Dens Marketing Corporation', '3000 / 4012.57', '2026-10-08'),
  ]
  const r = buildMillingStatus({ issues, to: '2026-10-12' })
  const by = (lot) => r.rows.find((x) => x.lotNo === lot)
  assert.equal(by('7').totalIssued, 7205)
  assert.equal(by('7').lastBatch, 205)
  assert.equal(remarksText(by('7')), 'As of Oct 12; last batch issued 205.00 bags')
  assert.equal(by('2').totalIssued, 750) // the Oct 15 tranche is after the period end
  assert.equal(by('1').totalIssued, 5250)
  assert.equal(by('12').totalIssued, 3000) // "Dens Marketing Corporation" is the table's Dens
  assert.equal(by('3').totalIssued, null) // Kipshoven lot: nothing yet
  const later = buildMillingStatus({ issues, to: '2026-10-19' })
  assert.equal(later.rows.find((x) => x.lotNo === '2').totalIssued, 4500)
})

test('a tranche of another QTY or another ricemill never lands on a row', () => {
  const r = buildMillingStatus({ issues: [tr('1', 'Borromeo Ricemill', '750 / 12606.33', '2026-09-30'), tr('2', 'Buama Ricemill', '750 / 6124.18', '2026-10-03')] })
  assert.ok(r.rows.every((x) => x.totalIssued === null))
  assert.equal(DEFAULT_MILLING_TABLE.length, 13)
})
