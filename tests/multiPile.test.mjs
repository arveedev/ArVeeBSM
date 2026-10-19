import test from 'node:test'
import assert from 'node:assert/strict'
import { combineMultiPileGroups, primaryIdMap } from '../src/utils/multiPile.js'

// the real case reported on 2026-10-19: WSR 11766812 received into two piles
const wsr = { id: 'p1', serialNo: '11766812', groupSerialNo: '11766812', numberOfBags: 118, grossKilos: 6071, netKilos: 6059.79, customerName: 'FLORESINDA C. BILASA', moistureContent: 13.8, date: '2026-10-14' }
const wsrA = { id: 'p2', serialNo: '11766812-A', groupSerialNo: '11766812', numberOfBags: 12, grossKilos: 617, netKilos: 615.86, customerName: 'FLORESINDA C. BILASA', moistureContent: 13.8, date: '2026-10-14' }
const other = { id: 'x1', serialNo: '11766813', numberOfBags: 20, grossKilos: 1000, netKilos: 990, customerName: 'SOMEONE' }

test('two piles of one receipt become ONE row with the primary number and the summed receipt', () => {
  const rows = combineMultiPileGroups([wsrA, wsr, other])
  assert.equal(rows.length, 2)
  const r = rows.find((x) => x.serialNo === '11766812')
  assert.equal(r.id, 'p1')
  assert.equal(r.numberOfBags, 130)
  assert.equal(r.grossKilos, 6688)
  assert.ok(Math.abs(r.netKilos - 6675.65) < 1e-9)
  assert.deepEqual(r.groupIds.sort(), ['p1', 'p2'])
  assert.ok(!rows.some((x) => String(x.serialNo).endsWith('-A')))
})

test('an ordinary receipt passes through untouched and gets no groupIds', () => {
  const rows = combineMultiPileGroups([other])
  assert.equal(rows[0], other)
  assert.equal(rows[0].groupIds, undefined)
})

test('three piles, and a sibling listed before its primary, still combine to the primary', () => {
  const b = { ...wsrA, id: 'p3', serialNo: '11766812-B', numberOfBags: 5, grossKilos: 250, netKilos: 248 }
  const rows = combineMultiPileGroups([b, wsrA, wsr])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].serialNo, '11766812')
  assert.equal(rows[0].numberOfBags, 135)
})

test('missing numbers count as zero, not NaN', () => {
  const rows = combineMultiPileGroups([wsr, { ...wsrA, numberOfBags: undefined, grossKilos: null, netKilos: undefined }])
  assert.equal(rows[0].numberOfBags, 118)
  assert.equal(rows[0].netKilos, 6059.79)
})

test('a Purchase Receipt filed against the extra pile is attributed to the primary', () => {
  const m = primaryIdMap([wsr, wsrA, other])
  assert.equal(m.get('p2'), 'p1')
  assert.equal(m.get('p1'), 'p1')
  assert.equal(m.has('x1'), false)
})
