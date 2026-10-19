import test from 'node:test'
import assert from 'node:assert/strict'
import { lastActivityDate, effectiveCloseDate, documentsAfterClose } from '../src/utils/closedPileActivity.js'

// the real case (Legazpi GID, 2026-10-19): old PILE 3 closed on 2026-09-30, WSIs of Oct 1-7 still recorded against it
const piles = [
  { pileId: 'old3', pileName: 'PILE 3', warehouseId: 'w', varietyId: 'WD0', closedDate: '2026-09-30' },
  { pileId: 'old2', pileName: 'Pile 2', warehouseId: 'w', varietyId: 'WD0', closedDate: '2026-09-30' },
  { pileId: 'new3', pileName: 'PILE 3', warehouseId: 'w', varietyId: 'WD0', closedDate: null },
  { pileId: 'new4', pileName: 'PILE 4', warehouseId: 'w', varietyId: 'WD1', closedDate: null },
]
const wsi = (serial, date, pileId, bags) => ({ type: 'WSI', status: 'Active', serialNo: serial, date, pileId, numberOfBags: bags, warehouseId: 'w' })
const txs = [
  wsi('26530767', '2026-10-01', 'old3', 170), wsi('26530772', '2026-10-07', 'old3', 58), wsi('26530771', '2026-10-07', 'old2', 187),
  wsi('26530758', '2026-09-22', 'old3', 400), // before the close: fine
  { type: 'WSR', status: 'Active', serialNo: 'INIT-old3', date: '2026-10-01', pileId: 'old3', isInitialBalance: true, numberOfBags: 97 }, // a seed is not a document
  { ...wsi('X', '2026-10-05', 'old3', 5), status: 'Cancelled' },
]

test('lists every Active document dated after its pile closed, oldest close first, with the open pile to move it to', () => {
  const r = documentsAfterClose(piles, txs)
  assert.deepEqual(new Set(r.map((x) => x.serial)), new Set(['26530767', '26530771', '26530772']))
  assert.equal(r[0].serial, '26530767') // dated first
  assert.equal(r.length, 3)
  assert.ok(r.every((x) => x.closedDate === '2026-09-30'))
  assert.deepEqual(r[0].openPiles, ['PILE 3'])
  assert.equal(r.reduce((s, x) => s + x.bags, 0), 170 + 58 + 187)
})

test('a seed, a cancelled document and one dated on or before the close are never listed', () => {
  const r = documentsAfterClose(piles, txs)
  assert.ok(!r.some((x) => x.serial === '26530758' || x.serial === 'X' || String(x.serial).startsWith('INIT')))
})

test('documents on or before the warehouse cutoff and after asOf are left out', () => {
  assert.equal(documentsAfterClose(piles, txs, { cutoffFor: () => '2026-10-05' }).length, 2)
  assert.equal(documentsAfterClose(piles, txs, { asOf: '2026-10-02' }).length, 1)
})

test('a transfer counts on either side', () => {
  const wts = { type: 'WTS', status: 'Active', serialNo: 'T1', date: '2026-10-03', issuedPileId: 'old3', receivedPileId: 'new3', issuedBags: 10, warehouseId: 'w' }
  assert.equal(documentsAfterClose(piles, [wts]).length, 1)
})

test('closing a pile earlier than its last document uses the date of that document', () => {
  assert.equal(lastActivityDate('old3', txs), '2026-10-07')
  assert.equal(effectiveCloseDate('old3', '2026-09-30', txs), '2026-10-07')
  assert.equal(effectiveCloseDate('old3', '2026-10-10', txs), '2026-10-10')
  assert.equal(effectiveCloseDate('new4', '2026-10-10', txs), '2026-10-10')
})
