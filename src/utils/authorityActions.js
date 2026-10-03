// User-initiated, one-transaction-at-a-time fixes offered from the
// Authority Review screen. Nothing here runs automatically.
//
//  - findReplacementCandidates: ranked suggestions for "the authority this
//    probably became" (never applied without the user picking one).
//  - applyReplacementAuthority: re-points ONE transaction at the chosen
//    authority (same edit a user can make by hand on the entry form),
//    then re-derives authority issued totals from the real transactions.
//  - moveTransactionForAuthority: moves ONE transaction (plus any
//    grouped siblings) to another warehouse via the same planner/executor
//    the Admin "Move Records" tool uses, optionally giving it the next
//    serial of the destination warehouse's own series.

import { db } from '../db/dexie.js'
import { planWarehouseMove, executeWarehouseMove } from './warehouseMove.js'
import { renameTransactionSerial } from './serialRename.js'
import { suggestNextSerial } from './serialNumber.js'
import { recalculateAuthorityIssuedTotals } from '../services/googleSheetsBridge.js'

const DAY_MS = 86400000
const toMs = (v) => (v ? new Date(v).getTime() || 0 : 0)
const sum = (lines, key) => (lines ?? []).reduce((a, l) => a + (l?.[key] ?? 0), 0)
const closeTo = (a, b, pct) => a != null && b != null && b !== 0 && Math.abs(a - b) / Math.abs(b) <= pct

const allocationBags = (a) => (a.type === 'SIA' ? sum(a.sackLines, 'totalAllocationBags') : a.totalAllocationBags ?? null)
const issuedBags = (a) => (a.type === 'SIA' ? sum(a.sackLines, 'totalIssuedBags') : a.totalIssuedBags ?? 0)

/**
 * Suggests authorities the flagged one may have been replaced by. `tx` is
 * the transaction being reviewed; `warehouseIds` the user's accessible
 * warehouses (candidates for a warehouse the user can't see are ignored).
 */
export const findReplacementCandidates = async (authority, tx, warehouseIds, limit = 5) => {
  const allowed = new Set(warehouseIds ?? [])
  const pool = await db.authorities
    .where('type').equals(authority.type)
    .and((a) => a.authId !== authority.authId && !a.missingFromSheetAt && (!a.assignedWarehouse || allowed.has(a.assignedWarehouse)))
    .toArray()

  const refMs = toMs(authority.missingFromSheetAt) || toMs(authority.changeLog?.at(-1)?.at) || Date.now()
  const needBags = authority.type === 'SIA'
    ? (tx.sackLines ?? []).reduce((a, l) => a + (l.pieces ?? 0), 0)
    : tx.numberOfBags ?? 0
  const oldAlloc = allocationBags(authority)

  const scored = pool.map((a) => {
    let score = 0
    const reasons = []
    const add = (pts, why) => { score += pts; reasons.push(why) }
    if (authority.customerName && a.customerName === authority.customerName) add(3, 'same customer')
    if (authority.transactionTypeName && a.transactionTypeName === authority.transactionTypeName) add(2, 'same transaction type')
    if (authority.type === 'AI' && authority.varietyId && a.varietyId === authority.varietyId) add(3, 'same variety')
    if (authority.type === 'SIA') {
      const mine = new Set((authority.sackLines ?? []).map((l) => `${l.sackTypeId}::${l.condition}`))
      if ((a.sackLines ?? []).some((l) => mine.has(`${l.sackTypeId}::${l.condition}`))) add(3, 'same sack type/condition')
    }
    const alloc = allocationBags(a)
    if (oldAlloc != null && alloc != null) {
      if (alloc === oldAlloc) add(3, 'same allocated bags')
      else if (closeTo(alloc, oldAlloc, 0.1)) add(1, 'allocated bags within 10%')
    }
    if (a.assignedWarehouse && a.assignedWarehouse === tx.warehouseId) add(3, 'same warehouse as the transaction')
    else if (a.assignedWarehouse && allowed.has(a.assignedWarehouse)) add(1, 'a warehouse you are assigned to')
    const seenMs = toMs(a.firstSeenAt) || toMs(a.date)
    if (seenMs && Math.abs(seenMs - refMs) <= 60 * DAY_MS) add(1, 'created/dated around the same time')
    if (alloc != null) {
      const remaining = alloc - issuedBags(a)
      if (remaining >= needBags) add(2, `${remaining.toLocaleString('en-US')} bags still available`)
      else reasons.push(`only ${Math.max(0, remaining).toLocaleString('en-US')} bags available (this transaction used ${needBags.toLocaleString('en-US')})`)
    }
    return { authority: a, score, reasons }
  })

  return scored.filter((c) => c.score >= 6).sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Re-points one transaction at another authority and re-derives totals. */
export const applyReplacementAuthority = async (tx, candidate) => {
  const isSia = candidate.type === 'SIA'
  const number = isSia ? candidate.siaNumber : candidate.aiNumber
  const patch = { isSynced: false, authorityAckAt: Date.now(), authorityAckNote: `Re-linked to ${isSia ? 'SIA' : 'AI'} ${number}` }
  if (isSia) patch.siaNumber = number
  else patch.aiNumber = number
  if (tx.linkedDocNo != null) patch.linkedDocNo = number
  await db.transactions.update(tx.id, patch)
  await recalculateAuthorityIssuedTotals()
}

/**
 * Moves one transaction (and any grouped siblings) to `destWarehouseId`.
 * With `changeSerial`, afterwards renames it to the next serial of the
 * destination's own series (the paper document must then be reissued, and
 * the old Sheet row is left for manual cleanup - same as any rename).
 * Returns { moved, newSerial }. Throws with a readable message on blockers.
 */
export const moveTransactionForAuthority = async (tx, destWarehouseId, { changeSerial = false, actor = null } = {}) => {
  const plan = await planWarehouseMove([tx.id], tx.warehouseId, destWarehouseId)
  if (plan.blockers.length > 0) throw new Error(plan.blockers.join(' '))
  const sourceWarehouseId = tx.warehouseId
  const result = await executeWarehouseMove(plan, sourceWarehouseId, destWarehouseId, actor)

  let newSerial = null
  if (changeSerial) {
    const fresh = await db.transactions.get(tx.id)
    newSerial = await suggestNextSerial(fresh.type, destWarehouseId, '1', fresh.cerealCategory ?? null)
    await renameTransactionSerial(fresh, newSerial, { type: fresh.type, warehouseId: destWarehouseId, cerealCategory: fresh.cerealCategory ?? null })
  }
  await db.transactions.update(tx.id, { authorityAckAt: Date.now(), authorityAckNote: `Moved to another warehouse${newSerial ? ` as ${newSerial}` : ''}` })
  await recalculateAuthorityIssuedTotals()
  return { moved: result.moved, newSerial }
}
