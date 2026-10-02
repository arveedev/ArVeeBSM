// Warehouse Move - Admin tool for records encoded under the wrong
// warehouse. A literal move: every selected transaction (and the
// siblings it is bound to) leaves the source warehouse entirely and
// lands in the destination, so nothing is left behind.
//
// Rules (agreed with the owner):
//  - Pile name stays the same. Destination pile matched by name + cereal
//    type; created (empty, no layout box) when missing, merged into when
//    present. A same-named pile holding a different variety blocks.
//  - Serial numbers are not changed. A record whose exact
//    [type+warehouseId+serialNo] already exists at the destination blocks.
//  - Records sharing a groupSerialNo (multi-pile issuances) move together.
//  - Initial-balance seeds are not movable (pile setup, not an entry).
//  - Google Sheet: moved rows get isSynced:false so the normal sync queue
//    re-runs updateTransactionBackup with the NEW warehouse's context;
//    the row is matched by serial and only its warehouse fields change.
//  - Authorities are untouched; the user re-assigns them on the record.

import { db } from '../db/dexie.js'
import { recalculatePileCurrentState } from './pileLedger.js'
import { recalculateSerialCounter } from './serialNumber.js'

const norm = (s) => String(s ?? '').trim().toLowerCase()
const pileIdsOf = (t) => [t.pileId, t.receivedPileId, t.issuedPileId].filter(Boolean)

/** Source-warehouse transactions the admin may pick from (no seeds). */
export const loadMovableTransactions = async (warehouseId) => {
  if (!warehouseId) return []
  const rows = await db.transactions.where('warehouseId').equals(warehouseId).toArray()
  return rows
    .filter((t) => !t.isInitialBalance)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || String(a.serialNo).localeCompare(String(b.serialNo), undefined, { numeric: true }))
}

/**
 * Dry run. Returns { records, siblingsAdded, piles, blockers, warnings }.
 * piles: one entry per source pile touched, with the destination match
 * (existing pile id or null = will be created) and net bag/kilo effect.
 */
export const planWarehouseMove = async (selectedIds, sourceWarehouseId, destWarehouseId) => {
  const blockers = []
  const warnings = []
  if (!sourceWarehouseId || !destWarehouseId) return { records: [], siblingsAdded: 0, piles: [], blockers: ['Pick both warehouses.'], warnings }
  if (sourceWarehouseId === destWarehouseId) return { records: [], siblingsAdded: 0, piles: [], blockers: ['Source and destination are the same warehouse.'], warnings }

  const all = await db.transactions.where('warehouseId').equals(sourceWarehouseId).toArray()
  const byId = new Map(all.map((t) => [t.id, t]))
  const picked = new Map()
  for (const id of selectedIds) { const t = byId.get(id); if (t) picked.set(id, t) }

  // Siblings of a multi-pile group travel together, all-or-nothing.
  let siblingsAdded = 0
  for (const t of [...picked.values()]) {
    if (!t.groupSerialNo) continue
    for (const s of all) {
      if (s.type === t.type && s.groupSerialNo === t.groupSerialNo && !picked.has(s.id)) {
        picked.set(s.id, s)
        siblingsAdded++
      }
    }
  }
  const records = [...picked.values()]
  if (records.length === 0) return { records, siblingsAdded, piles: [], blockers: ['Nothing selected.'], warnings }

  for (const t of records) {
    if (t.isInitialBalance) blockers.push(`${t.type} ${t.serialNo} is an initial-balance seed and cannot be moved.`)
    const clash = await db.transactions
      .where('[type+warehouseId+serialNo]').equals([t.type, destWarehouseId, t.serialNo]).first()
    if (clash) blockers.push(`${t.type} ${t.serialNo} already exists in the destination warehouse.`)
  }

  // Pile mapping.
  const destPiles = await db.piles.where('warehouseId').equals(destWarehouseId).toArray()
  const sourcePileIds = [...new Set(records.flatMap(pileIdsOf))]
  const piles = []
  for (const pid of sourcePileIds) {
    const src = await db.piles.get(pid)
    if (!src) { blockers.push(`A record points at a pile that no longer exists (${pid}).`); continue }
    if (src.warehouseId !== sourceWarehouseId) {
      blockers.push(`Pile "${src.pileName}" belongs to a different warehouse than the records using it.`)
      continue
    }
    const candidates = destPiles.filter((p) => norm(p.pileName) === norm(src.pileName) && p.cerealType === src.cerealType)
    const dest = candidates.find((p) => !p.closedDate) ?? candidates[0] ?? null
    if (dest && src.varietyId && dest.varietyId && src.varietyId !== dest.varietyId && src.cerealType !== 'By Products') {
      blockers.push(`Pile "${src.pileName}" exists at the destination with a different variety.`)
    }
    if (dest?.closedDate) warnings.push(`Destination pile "${dest.pileName}" is closed; records will merge into it anyway.`)
    let bags = 0
    let kilos = 0
    for (const t of records) {
      if (t.type === 'WTS') {
        if (t.issuedPileId === pid) { bags -= t.issuedBags ?? 0; kilos -= t.issuedNetKilos ?? 0 }
        if (t.receivedPileId === pid) { bags += t.receivedBags ?? 0; kilos += t.receivedNetKilos ?? 0 }
      } else if (t.pileId === pid && t.status === 'Active') {
        const sign = t.type === 'WSR' ? 1 : t.type === 'WSI' ? -1 : 0
        bags += (t.numberOfBags ?? 0) * sign
        kilos += (t.netKilos ?? 0) * sign
      }
    }
    if (src.currentBags - bags < 0) warnings.push(`Pile "${src.pileName}" at the source would go below zero bags after the move.`)
    piles.push({ sourcePileId: pid, pileName: src.pileName, cerealType: src.cerealType, destPileId: dest?.pileId ?? null, bags, kilos })
  }

  return { records, siblingsAdded, piles, blockers, warnings }
}

/** Applies a plan. Throws on blockers. Returns { moved, createdPiles }. */
export const executeWarehouseMove = async (plan, sourceWarehouseId, destWarehouseId, actor = null) => {
  if (plan.blockers.length > 0) throw new Error('Plan has blockers')
  const records = plan.records
  const pileMap = new Map()
  let createdPiles = 0

  await db.transaction('rw', db.transactions, db.piles, db.purchaseReceipts, db.errorLogs, async () => {
    for (const p of plan.piles) {
      if (p.destPileId) { pileMap.set(p.sourcePileId, p.destPileId); continue }
      const src = await db.piles.get(p.sourcePileId)
      // eslint-disable-next-line no-unused-vars
      const { owner, realmId, ...rest } = src
      const newId = crypto.randomUUID()
      await db.piles.add({
        ...rest,
        pileId: newId,
        warehouseId: destWarehouseId,
        currentBags: 0,
        currentKilos: 0,
        closedDate: null,
      })
      pileMap.set(p.sourcePileId, newId)
      createdPiles++
    }

    const remap = (id) => (id ? pileMap.get(id) ?? id : id)
    for (const t of records) {
      const patch = { warehouseId: destWarehouseId, isSynced: false }
      if (t.pileId) patch.pileId = remap(t.pileId)
      if (t.receivedPileId) patch.receivedPileId = remap(t.receivedPileId)
      if (t.issuedPileId) patch.issuedPileId = remap(t.issuedPileId)
      await db.transactions.update(t.id, patch)
    }

    const ids = records.map((t) => t.id)
    const prs = await db.purchaseReceipts.where('wsrTransactionId').anyOf(ids).toArray()
    for (const pr of prs) {
      await db.purchaseReceipts.update(pr.prId, { warehouseId: destWarehouseId, isSynced: false })
    }

    await db.errorLogs.add({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      context: 'Warehouse Move',
      message: JSON.stringify({
        from: sourceWarehouseId,
        to: destWarehouseId,
        actor,
        pileMap: Object.fromEntries(pileMap),
        records: records.map((t) => ({ id: t.id, type: t.type, serialNo: t.serialNo, pileId: t.pileId ?? null, receivedPileId: t.receivedPileId ?? null, issuedPileId: t.issuedPileId ?? null })),
      }),
      stack: null,
      refId: null,
      resolved: true,
    })
  })

  // Derived state, recomputed from the real ledgers on both sides.
  for (const p of plan.piles) {
    await recalculatePileCurrentState(p.sourcePileId)
    await recalculatePileCurrentState(pileMap.get(p.sourcePileId))
  }
  const types = [...new Set(records.map((t) => t.type))]
  for (const type of types) {
    await recalculateSerialCounter(type, sourceWarehouseId, null)
    await recalculateSerialCounter(type, destWarehouseId, null)
    const cats = [...new Set(records.filter((t) => t.type === type).map((t) => t.cerealCategory).filter(Boolean))]
    for (const c of cats) {
      await recalculateSerialCounter(type, sourceWarehouseId, c)
      await recalculateSerialCounter(type, destWarehouseId, c)
    }
  }

  return { moved: records.length, createdPiles }
}
