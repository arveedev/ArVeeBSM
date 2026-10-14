// Closing residue - the net kilos a pile still holds (with no bags left) when it is closed.
//
// Closing a pile zeroes it, so those kilos used to vanish from every pile-level view (Stock Desk, Home
// Stocks, the pile list) while the warehouse-level statement still counted them, and the two stopped
// tallying. The residue is moved to another pile of the same variety in the same warehouse as an
// ordinary WTS-shaped record with 0 bags: issued from the closed pile, received by the destination,
// dated the day the pile was closed. Because it is an ordinary WTS, every ledger, BIN Card and report
// reads it the way it reads any transfer; `isClosingResidue` only labels it.
//
// Each warehouse's reporting start / override date is respected: a pile closed on or before it is left
// alone (nothing before that date is counted), and the pile's ledger is computed with the same cutoff.

import { db } from '../db/dexie.js'
import { effectiveCutoffDate, round3 } from './calculations.js'
import { computeHistoricalPileState, recalculatePileCurrentState, closePile, reopenPile } from './pileLedger.js'

const FAR_FUTURE = '9999-12-31'
const MIN_KILOS = 0.0005

// A stable number from the closed pile's id, so the residue record has its own serial that never
// collides with a real WTS serial, and so repeating the move is idempotent.
const serialFor = (pileId) => {
  let h = 2166136261
  for (const c of String(pileId)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return `RESIDUE-${String(h % 10000000).padStart(7, '0')}`
}
export const residueIdFor = (pileId) => `residue::${pileId}`

const globalStart = async () => (await db.reportConfig.get('global'))?.dataStartDate || null

// The sack weight and condition a pile mostly holds (by net kilos), so the moved kilos join that group
// of the pile's stock breakdown instead of showing up as a separate one.
const dominantSack = async (pile) => {
  const [direct, wts] = await Promise.all([
    db.transactions.where('pileId').equals(pile.pileId).toArray(),
    db.transactions.where('type').equals('WTS').and((t) => t.issuedPileId === pile.pileId || t.receivedPileId === pile.pileId).toArray(),
  ])
  const tally = new Map()
  const add = (sackTypeId, condition, kilos) => {
    if (!sackTypeId) return
    const k = `${sackTypeId}|${condition ?? ''}`
    tally.set(k, (tally.get(k) ?? 0) + Math.abs(kilos ?? 0))
  }
  for (const t of direct) if (t.status === 'Active' && !t.isClosingResidue) add(t.mtsSackTypeId, t.mtsCondition, t.netKilos)
  for (const t of wts) {
    if (t.status !== 'Active' || t.isClosingResidue) continue
    if (t.receivedPileId === pile.pileId) add(t.receivedSackTypeId, t.receivedCondition, t.receivedNetKilos)
    if (t.issuedPileId === pile.pileId) add(t.issuedSackTypeId, t.issuedCondition, t.issuedNetKilos)
  }
  let best = null
  for (const [k, v] of tally) if (!best || v > best[1]) best = [k, v]
  if (!best) return { sackTypeId: pile.mtsSackTypeId ?? null, condition: pile.mtsCondition ?? null }
  const [sackTypeId, condition] = best[0].split('|')
  return { sackTypeId, condition: condition || null }
}

/** Open piles of the same variety (and cereal) in the same warehouse that can take the residue on `date`. */
export const residueDestinations = (source, piles, date) => piles
  .filter((p) => p.pileId !== source.pileId && p.warehouseId === source.warehouseId &&
    (!p.closedDate || p.closedDate > date) &&
    (p.varietyId ?? null) === (source.varietyId ?? null) && (p.cerealType ?? null) === (source.cerealType ?? null))
  .sort((a, b) => (b.currentKilos ?? 0) - (a.currentKilos ?? 0) || String(a.pileName).localeCompare(String(b.pileName), undefined, { numeric: true }))

/**
 * What a closed pile still held when it was closed: bags 0 with kilos left. Piles that still show bags
 * are not residues (closing wrote those bags off on purpose). Skips piles closed on or before the
 * warehouse's reporting start date.
 */
export const residueOfClosedPile = async (pile, warehouse, startDate) => {
  if (!pile?.closedDate) return null
  const cut = effectiveCutoffDate(warehouse?.reportingCutoffDate, startDate)
  if (cut && pile.closedDate <= cut) return null
  const { bags, kilos } = await computeHistoricalPileState(pile.pileId, FAR_FUTURE, warehouse ?? null, { ignoreClose: true })
  if (bags > 1e-9 || kilos < MIN_KILOS) return null
  return { bags: 0, kilos: round3(kilos) }
}

/** Every closed pile with a residue still to move, oldest closing first, each with its candidate piles. */
export const findClosingResidues = async ({ warehouseId = null } = {}) => {
  const [allPiles, warehouses, start, varieties] = await Promise.all([
    db.piles.toArray(), db.warehouses.toArray(), globalStart(), db.varietyTypes.toArray(),
  ])
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const varName = new Map(varieties.map((v) => [v.varietyId, v.name]))
  const found = []
  for (const pile of allPiles) {
    if (!pile.closedDate || (warehouseId && pile.warehouseId !== warehouseId)) continue
    const wh = whById.get(pile.warehouseId)
    const res = await residueOfClosedPile(pile, wh, start)
    if (!res) continue
    found.push({
      pile, warehouse: wh, kilos: res.kilos, date: pile.closedDate,
      varietyName: varName.get(pile.varietyId) ?? pile.cerealType ?? '',
      destinations: residueDestinations(pile, allPiles, pile.closedDate),
    })
  }
  return found.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || String(a.pile.pileName).localeCompare(String(b.pile.pileName), undefined, { numeric: true }))
}

/**
 * Writes the residue record: `kilos` out of `source`, into `dest`, dated `date`. Safe to repeat
 * (one record per closed pile). Returns the record, or null when there is nothing to move.
 */
export const moveResidue = async ({ source, dest, kilos, date, createdByName = null }) => {
  const net = round3(kilos)
  if (!source || !dest || !(net >= MIN_KILOS)) return null
  const id = residueIdFor(source.pileId)
  const existing = await db.transactions.get(id)
  const [fromSack, toSack] = await Promise.all([dominantSack(source), dominantSack(dest)])
  const record = {
    id,
    type: 'WTS',
    serialNo: serialFor(source.pileId),
    status: 'Active',
    date,
    warehouseId: source.warehouseId,
    createdByName: 'Closing residue',
    aiNumber: null,
    transactionTypeId: null,
    moistureContent: null,
    issuedPileId: source.pileId,
    issuedVarietyId: source.varietyId ?? null,
    issuedSackTypeId: fromSack.sackTypeId,
    issuedCondition: fromSack.condition,
    issuedBags: 0,
    issuedGrossKilos: net,
    issuedNetKilos: net,
    issuedStockCondition: 'Good',
    receivedPileId: dest.pileId,
    receivedVarietyId: dest.varietyId ?? source.varietyId ?? null,
    receivedSackTypeId: toSack.sackTypeId,
    receivedCondition: toSack.condition,
    receivedBags: 0,
    receivedGrossKilos: net,
    receivedNetKilos: net,
    receivedStockCondition: 'Good',
    isClosingResidue: true,
    residueFromPileName: source.pileName ?? '',
    residueToPileName: dest.pileName ?? '',
    // an internal bookkeeping move: nothing to back up to the Google Sheet
    isSynced: true,
    createdAt: existing?.createdAt ?? Date.now(),
    editedBy: createdByName,
  }
  await db.transactions.put(record)
  await recalculatePileCurrentState(dest.pileId)
  return record
}

/** Undo: removes the residue record of a closed pile and refreshes the destination. */
export const undoResidue = async (sourcePileId) => {
  const rec = await db.transactions.get(residueIdFor(sourcePileId))
  if (!rec) return false
  await db.transactions.delete(rec.id)
  if (rec.receivedPileId) await recalculatePileCurrentState(rec.receivedPileId)
  return true
}

/** The record that moved a closed pile's residue, if any. */
export const residueRecordFor = (sourcePileId) => db.transactions.get(residueIdFor(sourcePileId))

/**
 * Close-time helper: what `pileId` would leave behind if closed on `date`, plus its destinations.
 * Returns null when there is no residue (bags remain, no kilos, or the date is inside the ignored period).
 */
export const previewResidueOnClose = async (pileId, date) => {
  const [pile, allPiles, start] = await Promise.all([db.piles.get(pileId), db.piles.toArray(), globalStart()])
  if (!pile || pile.closedDate) return null
  const wh = await db.warehouses.get(pile.warehouseId)
  const cut = effectiveCutoffDate(wh?.reportingCutoffDate, start)
  if (cut && date <= cut) return null
  const { bags, kilos } = await computeHistoricalPileState(pileId, date, wh ?? null)
  if (bags > 1e-9 || kilos < MIN_KILOS) return null
  return { pile, kilos: round3(kilos), date, destinations: residueDestinations(pile, allPiles, date) }
}

/**
 * What every "Close pile" button runs: moves the pile's leftover net kilos (if it has no bags left) to the
 * best open pile of the same variety in the warehouse, then closes the pile. The destination is the open
 * pile holding the most stock; Admin > Closing Residue can re-route it. Returns a sentence to show the user.
 */
export const closePileWithResidue = async (pileId, closedDate, createdByName = null) => {
  const preview = await previewResidueOnClose(pileId, closedDate)
  let message = null
  if (preview) {
    const dest = preview.destinations[0]
    if (dest) {
      await moveResidue({ source: preview.pile, dest, kilos: preview.kilos, date: closedDate, createdByName })
      message = `${preview.kilos.toLocaleString('en-US', { maximumFractionDigits: 3 })} kg net moved to ${dest.pileName}`
    } else {
      message = `${preview.kilos.toLocaleString('en-US', { maximumFractionDigits: 3 })} kg net could not be moved: no open pile of the same variety in this warehouse`
    }
  }
  await closePile(pileId, closedDate)
  return message
}

/** Re-opening a pile takes back the residue move made when it was closed. */
export const reopenPileWithResidue = async (pileId) => {
  await undoResidue(pileId)
  return reopenPile(pileId)
}

/** Gives residue records made before sack types were carried the sack type and condition of their piles. */
export const refreshResidueRecords = async () => {
  const recs = await db.transactions.filter((t) => t.isClosingResidue === true && !t.receivedSackTypeId).toArray()
  let fixed = 0
  for (const t of recs) {
    const [src, dst] = await Promise.all([db.piles.get(t.issuedPileId), db.piles.get(t.receivedPileId)])
    if (!src || !dst) continue
    const [a, b] = await Promise.all([dominantSack(src), dominantSack(dst)])
    if (!b.sackTypeId) continue
    await db.transactions.update(t.id, {
      issuedSackTypeId: a.sackTypeId, issuedCondition: a.condition, receivedSackTypeId: b.sackTypeId, receivedCondition: b.condition,
    })
    fixed += 1
  }
  return fixed
}
