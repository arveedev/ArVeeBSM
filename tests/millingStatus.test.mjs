import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMillingStatus, millingStatusText, remarksText, parseLotNote, lotKey } from '../src/utils/millingStatus.js'

// A tranche is one milling authority; its note reads "<issued so far> / <QTY of the lot>"
const tr = (ai, miller, note, bags, date, source = 'BSI') => ({ id: ai, aiNumber: ai, customer: miller, note, bags, date, source, warehouse: `ALB-${source}` })

test('the note is read as issued-so-far / QTY, with the pile in front when there is one', () => {
  assert.deepEqual(parseLotNote('6000 / 7205.05'), { issued: 6000, qty: 7205.05, pile: '' })
  assert.deepEqual(parseLotNote('KINALE 3B 500 / 6263.35'), { issued: 500, qty: 6263.35, pile: '3B' })
  assert.deepEqual(parseLotNote('TAB GID A 4 500 / 4996.96'), { issued: 500, qty: 4996.96, pile: '4' })
  assert.equal(parseLotNote('PARTIAL'), null)
  assert.equal(parseLotNote('ALB-2026-B-020'), null)
})

test('Magayon: eight tranches are ONE lot; QTY is the lot quantity, total issued and the last issuance come from the latest tranche', () => {
  const issues = [
    tr('1', 'MAGAYON RM', '1000 / 7205.05', 1000, '2026-09-30'), tr('2', 'MAGAYON RM', '2000 / 7205.05', 1000, '2026-09-30'),
    tr('3', 'MAGAYON RICEMILL', '6000 / 7205.05', 1000, '2026-10-09'), tr('4', 'MAGAYON RICEMILL', '7000 / 7205.05', 1000, '2026-10-10'),
    tr('5', 'MAGAYON RICEMILL', '7205 / 7205.05', 205, '2026-10-12'),
  ]
  const r = buildMillingStatus({ issues, millingOrders: [{ aiNumber: '5', ricemillName: 'MAGAYON RICEMILL', recoveryPercent: 64.3, receivingWarehouse: 'Abacorp/ Leg Gid' }] })
  assert.equal(r.rows.length, 1)
  const row = r.rows[0]
  assert.equal(row.qty, 7205.05) // as the office's table: never a sum of tranches
  assert.equal(row.totalIssued, 7205)
  assert.equal(row.asOf, '2026-10-12')
  assert.equal(Math.round(row.expected * 100) / 100, 4632.85) // the office's own figure
  assert.equal(row.receiving, 'Abacorp/ Leg Gid')
  assert.equal(remarksText(row), 'As of Oct 12')
  assert.equal(row.miller, 'Magayon') // the short name, as the office writes it
})

test('Lot No. is never the row count: blank until the Admin types it, then exactly what was typed', () => {
  const issues = [tr('1', 'Borromeo Ricemill', '750 / 6482.15', 750, '2026-10-06', 'TAB GID A'), tr('2', 'Borromeo Ricemill', '5250 / 6124.18', 750, '2026-10-03', 'TAB GID A')]
  const blank = buildMillingStatus({ issues })
  assert.deepEqual(blank.rows.map((x) => x.lotNo), ['', ''])
  const typed = buildMillingStatus({ issues, lotInfo: { [lotKey('Borromeo Ricemill', 6124.18)]: { lotNo: '1', pile: '1' }, [lotKey('Borromeo Ricemill', 6482.15)]: { lotNo: '2' } } })
  assert.deepEqual(typed.rows.map((x) => [x.lotNo, x.qty, x.pile]), [['1', 6124.18, '1'], ['2', 6482.15, '']])
  assert.equal(typed.rows[0].warehouse, 'TAB GID') // the lettered variant is shown as the warehouse
})

test('names and order as the office table: short ricemill and warehouse names, ricemills in the order of their first lot number', () => {
  const issues = [
    { ...tr('1', 'Dens Marketing Corporation', '1000 / 4012.57', 1000, '2026-10-08', 'KINALE'), warehouse: 'ALB-KINALE A' },
    { ...tr('2', 'Borromeo Ricemill', '750 / 6482.15', 750, '2026-10-06', 'TAB GID A'), warehouse: 'ALB-TABACO GID A' },
    { ...tr('3', 'MAGAYON RM', '1000 / 7205.05', 1000, '2026-10-06', 'BSI'), warehouse: 'ALB-BSI' },
  ]
  const lotInfo = { [lotKey('Dens Marketing Corporation', 4012.57)]: { lotNo: '12' }, [lotKey('Borromeo Ricemill', 6482.15)]: { lotNo: '2' }, [lotKey('MAGAYON RM', 7205.05)]: { lotNo: '7' } }
  const r = buildMillingStatus({ issues, lotInfo })
  assert.deepEqual(r.groups.map((g) => g.miller), ['Borromeo', 'Magayon', 'Dens'])
  assert.deepEqual(r.rows.map((x) => x.warehouse), ['Tabaco GID', 'BSI', 'Kinale'])
})

test('grouped by ricemill (spellings merged); a Total only for a group of 2 or more lots; authorities with no lot note are listed apart', () => {
  const issues = [
    tr('1', 'Borromeo Ricemill', '750 / 6482.15', 750, '2026-10-06', 'TAB GID A'), tr('2', 'BORROMEO RM', '5250 / 6124.18', 750, '2026-10-03', 'TAB GID A'),
    tr('3', 'Buama Ricemill', '500 / 3000', 500, '2026-10-13', 'TAB GID A'), tr('4', 'Buama Ricemill', 'PARTIAL', 100, '2026-10-14'),
  ]
  const r = buildMillingStatus({ issues })
  assert.equal(r.groups.length, 2)
  assert.equal(r.groups[0].total.qty, 6124.18 + 6482.15)
  assert.deepEqual(r.unassigned.map((x) => x.aiNumber), ['4'])
  const lines = millingStatusText(r).split('\n')
  assert.equal(lines.filter((l) => l.includes('\tTotal\t')).length, 1)
})
