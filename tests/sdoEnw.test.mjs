// The SDO's 2-decimal setting is about the NET weight only; the Equivalent Net Weight keeps its own 3 or 4 decimals so the amount paid is exact.
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeEquivalentNetWeight, computeBasicCost, netKilosForPr } from '../src/utils/sdoCalculations.js'

test('with the 2-decimal setting the net is rounded to 2 but the ENW is not', () => {
  const net = netKilosForPr(236.5304, 2)
  assert.equal(net, 236.53)
  const enw = computeEquivalentNetWeight(net, 0.91, 2)
  assert.equal(enw, 215.2423) // 4 decimals, never 215.24
  assert.equal(computeBasicCost(enw, 27), Math.round(215.2423 * 27 * 100) / 100)
})

test('the ENW keeps 3 decimals when the factor is 1, 4 otherwise, in both settings', () => {
  assert.equal(computeEquivalentNetWeight(860.39, 1, 2), 860.39)
  assert.equal(computeEquivalentNetWeight(1290.4357, 1, 3), 1290.435)
  assert.equal(computeEquivalentNetWeight(1000.123, 0.9532, 3), 953.3172)
})
