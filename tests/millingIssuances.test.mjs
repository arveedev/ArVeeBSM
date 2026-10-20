import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMillingIssuances } from '../src/utils/millingIssuances.js'

const warehouses = [{ warehouseId: 'w1', name: 'NFAO RM', provinceId: 'pv1' }]
const provinces = [{ provinceId: 'pv1', name: 'ALBAY' }]
const varieties = [{ varietyId: 'rice', name: 'WD1', category: 'Rice' }, { varietyId: 'palay', name: 'PD1', category: 'Palay' }]
const allocations = [{ regionalAuthorityNumber: 'RAN-1', totalNetKgs: 1e6, millingInputCapacityBags: 100 }]
const out = (id, date, bags, over = {}) => ({ type: 'AI', authId: id, aiNumber: id, date, transactionTypeName: 'TRANSFER', varietyId: 'rice', regionalAuthorityNumber: 'RAN-1', assignedWarehouse: 'w1', totalAllocationKilos: bags * 50, totalIssuedKilos: bags * 50, ...over })
const run = (authorities, extra = {}) => buildMillingIssuances({ transactions: [], authorities, warehouses, provinces, varieties, ricemillAllocations: allocations, from: '2026-10-01', to: '2026-10-31', ...extra })

test('NFA-owned ricemill: a normal day counts 100 bags, a day under 60% recovery counts 50', () => {
  const r = run([out('A1', '2026-10-05', 70), out('A2', '2026-10-06', 59), out('A3', '2026-10-07', 60)])
  assert.deepEqual(r.nfa.issues.map((x) => x.bags), [100, 50, 100]) // 70 ok; 59 < 60 -> 50; exactly 60 is not under 60
  assert.equal(r.nfa.issuedTotal, 250)
  assert.equal(r.nfa.recoveredTotal, 189)
})

test('several hand-outs on one day are one ricemill day, judged together', () => {
  const r = run([out('A1', '2026-10-05', 30), out('A2', '2026-10-05', 35)])
  assert.equal(r.nfa.issues.length, 1)
  assert.equal(r.nfa.issues[0].bags, 100) // 65 bags of rice is 65%
})

test('milling authorities of an NFA-owned ricemill are no longer counted on top of the daily amounts', () => {
  const mill = out('M1', '2026-10-05', 500, { transactionTypeName: 'MILLING', varietyId: 'palay' })
  const r = run([mill, out('A1', '2026-10-05', 80)])
  assert.equal(r.nfa.issuedTotal, 100)
})

test('a day outside the period is not counted; a ricemill with no capacity set uses 100', () => {
  const r = run([out('A1', '2026-09-30', 80), out('A2', '2026-10-02', 80)], { ricemillAllocations: [{ regionalAuthorityNumber: 'RAN-1', totalNetKgs: 1, millingInputCapacityBags: 0 }] })
  assert.equal(r.nfa.issues.length, 1)
  assert.equal(r.nfa.issues[0].bags, 100)
})
