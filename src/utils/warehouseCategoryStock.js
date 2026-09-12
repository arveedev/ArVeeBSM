// Single source of truth for "how much Rice/Palay/By Products does
// warehouse X actually have right now, and how much of that is already
// authorized-but-unwithdrawn" - built specifically because HomeStocks.jsx
// (per-warehouse detail) and AdminHomeStocks.jsx (province/branch
// rollups) each maintained their OWN separate version of this same
// calculation, and kept drifting apart despite several rounds of fixing
// individual discrepancies between them - confirmed, reported case: a
// warehouse's own Potential figure on its own detail page disagreeing
// with that same warehouse's contribution to the province-level
// overview, persisting across multiple fix attempts aimed at specific
// spotted differences. Rather than keep chasing new gaps between two
// hand-maintained implementations, this is the only place either page
// computes this now - summing this function's own output per warehouse
// is how a province/branch total is built, so there is exactly one
// calculation left to ever get wrong.
//
// Actual is computed via computePileStockBreakdown - the exact same,
// per-pile function HomeStocks.jsx's own PileWeightSubscriber already
// calls - rather than the separately-implemented, batched
// computeCurrentPileStatesBatch, so the actual figure is bit-for-bit
// the same calculation the per-warehouse page already shows and the
// user already trusts, not a second implementation that has to be kept
// in sync with it by hand.

import { db } from '../db/dexie.js'
import { computePileStockBreakdown } from './pileLedger.js'
import { computeUnwithdrawnByVariety } from './unwithdrawnStock.js'

const emptyTotals = () => ({ actualBags: 0, actualKilos: 0, unwithdrawnBags: 0, unwithdrawnKilos: 0 })

/**
 * Returns Map<category, { actualBags, actualKilos, unwithdrawnBags,
 * unwithdrawnKilos }> for one warehouse. varieties/sackTypes are passed
 * in (rather than fetched here) so a caller looping over many
 * warehouses fetches each just once, not once per warehouse.
 *
 * Category resolution matches HomeStocks.jsx's own established rule -
 * a pile's variety's own category wins; the pile's own stored
 * cerealType field is only a fallback for when the variety can't be
 * resolved at all (the known case: a By Products pile, whose own
 * varietyId field is unreliable - see pileLedger.js's own
 * documentation of that gap).
 */
export const computeWarehouseCategoryStock = async (warehouseId, { varieties, sackTypes }) => {
  const varietyCategoryMap = new Map(varieties.map((v) => [v.varietyId, v.category]))
  const [warehouse, piles] = await Promise.all([
    db.warehouses.get(warehouseId),
    db.piles.where('warehouseId').equals(warehouseId).toArray(),
  ])

  const result = new Map()
  const addActual = (cat, bags, kilos) => {
    const cur = result.get(cat) ?? emptyTotals()
    cur.actualBags += bags
    cur.actualKilos += kilos
    result.set(cat, cur)
  }

  for (const pile of piles) {
    if (pile.closedDate) continue
    const breakdown = await computePileStockBreakdown(pile.pileId, '9999-12-31', warehouse, sackTypes)
    const bags = breakdown.reduce((s, g) => s + g.bags, 0)
    const kilos = breakdown.reduce((s, g) => s + g.kilos, 0)
    // Same as computeCurrentPileStatesBatch's own per-pile floor -
    // there's no such thing as negative physical stock, and
    // computePileStockBreakdown's own groups are deliberately NOT
    // floored individually (a genuine, needed offset between groups),
    // only the pile's own final total is.
    const cat = varietyCategoryMap.get(pile.varietyId) ?? pile.cerealType ?? 'Unknown'
    addActual(cat, Math.max(0, bags), Math.max(0, kilos))
  }

  const unwithdrawnByVariety = await computeUnwithdrawnByVariety(warehouseId)
  for (const [varietyId, uw] of unwithdrawnByVariety) {
    const cat = varietyCategoryMap.get(varietyId) ?? 'Unknown'
    const cur = result.get(cat) ?? emptyTotals()
    cur.unwithdrawnBags += uw.bags
    cur.unwithdrawnKilos += uw.kilos
    result.set(cat, cur)
  }

  return result
}
