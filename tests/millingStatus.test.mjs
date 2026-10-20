import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMillingStatus, millingStatusText, remarksText } from '../src/utils/millingStatus.js'

const issue = (id, ai, customer, bags, warehouse = 'TABACO GID', date = '2026-10-05') => ({ id, aiNumber: ai, customer, bags, warehouse, date, withdrawn: 0 })
const piles = [{ pileId: 'p1', pileName: 'PILE 1' }, { pileId: 'p4', pileName: 'Pile 4B' }]
const wsi = (id, ai, pileId, bags, date, createdAt = 1) => ({ id, type: 'WSI', status: 'Active', aiNumber: ai, pileId, netKilos: bags * 50, date, createdAt })
const orders = [
  { aiNumber: 'A1', ricemillName: 'BORROMEO RM', recoveryPercent: 63.27, receivingWarehouse: 'Abacorp/ Leg Gid' },
  { aiNumber: 'A2', ricemillName: 'Borromeo Ricemill', recoveryPercent: 64.84, receivingWarehouse: 'Leg GID' },
]

test('rows: QTY, GMR, expected recovery, receiving warehouse, pile, total issuance and the last issuance', () => {
  const r = buildMillingStatus({
    issues: [issue('1', 'A1', 'Borromeo Ricemill', 6124.18)],
    transactions: [wsi('w1', 'A1', 'p1', 1000, '2026-10-06'), wsi('w2', 'A1', 'p1', 500, '2026-10-09'), wsi('w3', 'A1', 'p1', 250, '2026-10-08')],
    piles, millingOrders: orders,
  })
  const row = r.rows[0]
  assert.equal(row.qty, 6124.18)
  assert.equal(row.gmr, 63.27)
  assert.equal(Math.round(row.expected * 100) / 100, 3874.77) // the office's own figure
  assert.equal(row.receiving, 'Abacorp/ Leg Gid')
  assert.equal(row.pile, '1')
  assert.equal(row.issued, 1750)
  assert.equal(Math.round(row.balance * 100) / 100, 4374.18) // authorized 6,124.18 - issued 1,750
  assert.equal(Math.round(row.pctIssued * 10) / 10, 28.6)
  assert.equal(row.lastBags, 500) // the latest by date, not the biggest
  assert.equal(remarksText(row), 'Last issuance: 500.00 bags (Oct 9)')
})

test('no issuance yet and no matching MO are shown plainly, not as zero figures', () => {
  const r = buildMillingStatus({ issues: [issue('1', 'ZZ', 'Buama Ricemill', 100)], piles, millingOrders: orders })
  assert.equal(r.rows[0].gmr, null)
  assert.equal(r.rows[0].expected, null)
  assert.equal(remarksText(r.rows[0]), 'No issuance yet')
})

test('grouped by ricemill (spellings merged), lot numbers run on, group totals add up', () => {
  const r = buildMillingStatus({
    issues: [issue('1', 'A1', 'Borromeo Ricemill', 100), issue('2', 'A2', 'BORROMEO RM', 50, 'BSI', '2026-10-06'), issue('3', 'A3', 'Buama Ricemill', 40)],
    piles, millingOrders: orders,
  })
  assert.equal(r.groups.length, 2)
  assert.deepEqual(r.rows.map((x) => x.lot), [1, 2, 3])
  assert.equal(r.groups[0].total.qty, 150)
  assert.equal(r.total.qty, 190)
  const text = millingStatusText(r)
  assert.equal(text.split('\n').filter((l) => l.includes('\tTotal\t')).length, 1) // only the group of 2 rows has a Total
})
