import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLots, sumLots } from '../src/utils/inventoryLots.js'

const warehouses = [{ warehouseId: 'w1', name: 'ABACORP B' }]
const piles = [{ pileId: 'p1', warehouseId: 'w1', varietyId: 'v1' }]
const receipt = { id: 't1', type: 'WSR', status: 'Active', date: '2026-10-01', pileId: 'p1', varietyId: 'v1', numberOfBags: 1000, netKilos: 50000, createdAt: 1 }
const ai = (over) => ({ type: 'AI', aiNumber: 'A1', varietyId: 'v1', date: '2026-10-15', assignedWarehouse: 'w1', totalAllocationKilos: 25000, totalAllocationBags: 500, totalIssuedKilos: 0, ageGroup: '', ...over })
const left = (authorities, transactions = [receipt]) => sumLots(buildLots({ piles, transactions, warehouses, asOf: '2026-10-20', authorities, reserve: true }).get('p1').lots)

test('an authority deducts exactly what it authorizes, even when its WSI weighed more (the reported 500.85 case)', () => {
  const wsi = { id: 't2', type: 'WSI', status: 'Active', date: '2026-10-15', pileId: 'p1', aiNumber: 'A1', numberOfBags: 500, netKilos: 25042.5, createdAt: 2 }
  const r = left([ai({ totalIssuedKilos: 25042.5 })], [receipt, wsi])
  assert.equal(r.kilos, 25000) // 50,000 received - 25,000 authorized; the 42.5 kg over-issue changes nothing
})

test('an authority with nothing issued deducts its full authorized amount', () => {
  assert.equal(left([ai({ totalIssuedKilos: 0 })]).kilos, 25000)
})

test('an authority issued LESS than authorized still deducts the full authorization', () => {
  assert.equal(left([ai({ totalIssuedKilos: 10000 })]).kilos, 25000)
})

test('authorized in bags only: 500 bags is 25,000 kg', () => {
  assert.equal(left([ai({ totalAllocationKilos: 0, totalAllocationBags: 500 })]).kilos, 25000)
})

test('only an authority with no authorized amount at all falls back to what it issued', () => {
  assert.equal(left([ai({ totalAllocationKilos: 0, totalAllocationBags: 0, totalIssuedKilos: 100 })]).kilos, 49900)
})

test('a WSI never deducts on its own in this report', () => {
  const wsi = { id: 't2', type: 'WSI', status: 'Active', date: '2026-10-15', pileId: 'p1', aiNumber: 'NOPE', numberOfBags: 100, netKilos: 5000, createdAt: 2 }
  assert.equal(left([], [receipt, wsi]).kilos, 50000)
})
