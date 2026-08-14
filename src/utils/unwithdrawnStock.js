// Stock already authorized via an active AI (Authority to Issue) but not
// yet actually withdrawn (no matching WSI/WTS issued against it yet)
// still physically sits in the warehouse's live pile totals - but it's
// already committed to leave. Without surfacing this, a user seeing
// "1000 bags" on hand could issue an AI for 500 more, not knowing 800 of
// those 1000 are already spoken for by an earlier, not-yet-withdrawn
// authority. This computes, per warehouse per variety, how many bags/
// kilos remain authorized-but-unwithdrawn, so "actual minus unwithdrawn"
// gives the true available/potential stock.
//
// Scoped to AI/WSI/WTS (bags+kilos) only - SIA/ESI tracks sack PIECES,
// a different unit that doesn't roll into a bags/kilos "net bags" figure.

import { db } from '../db/dexie.js'
import { isAuthorityComplete } from './calculations.js'

// Every WSI/WTS actually withdrawn against one AI so far, plus the totals.
const withdrawalsForAuthority = async (aiNumber) => {
  const withdrawals = await db.transactions
    .where('aiNumber').equals(aiNumber)
    .and((t) => t.status === 'Active' && (t.type === 'WSI' || t.type === 'WTS'))
    .toArray()

  const withdrawnBags = withdrawals.reduce(
    (s, t) => s + (t.type === 'WSI' ? (t.numberOfBags ?? 0) : (t.issuedBags ?? 0)), 0
  )
  const withdrawnKilos = withdrawals.reduce(
    (s, t) => s + (t.type === 'WSI' ? (t.netKilos ?? 0) : (t.issuedNetKilos ?? 0)), 0
  )

  return { withdrawals, withdrawnBags, withdrawnKilos }
}

const activeAiAuthoritiesFor = async (warehouseId, varietyIds) => {
  const varietySet = varietyIds ? new Set(varietyIds) : null
  return db.authorities
    .where('assignedWarehouse').equals(warehouseId)
    .and((a) => a.type === 'AI' && Boolean(a.varietyId) && !isAuthorityComplete(a)
      && (!varietySet || varietySet.has(a.varietyId)))
    .toArray()
}

export const computeUnwithdrawnByVariety = async (warehouseId) => {
  if (!warehouseId) return new Map()

  const authorities = await activeAiAuthoritiesFor(warehouseId)
  const result = new Map() // varietyId -> { bags, kilos }

  for (const a of authorities) {
    const { withdrawnBags, withdrawnKilos } = await withdrawalsForAuthority(a.aiNumber)
    const unwithdrawnBags = Math.max(0, (a.totalAllocationBags ?? 0) - withdrawnBags)
    const unwithdrawnKilos = Math.max(0, (a.totalAllocationKilos ?? 0) - withdrawnKilos)
    if (unwithdrawnBags <= 0 && unwithdrawnKilos <= 0) continue

    const cur = result.get(a.varietyId) ?? { bags: 0, kilos: 0 }
    result.set(a.varietyId, { bags: cur.bags + unwithdrawnBags, kilos: cur.kilos + unwithdrawnKilos })
  }

  return result
}

// Per-authority breakdown (allocated/withdrawn/unwithdrawn, plus every
// WSI/WTS document that contributed to "withdrawn") for one or more
// varieties in one warehouse - the drill-down behind an "unwithdrawn"
// badge, so a user can see exactly which AI(s) and which documents
// produced that number instead of just the rolled-up total.
export const getUnwithdrawnDetail = async (warehouseId, varietyIds) => {
  if (!warehouseId) return []

  const authorities = await activeAiAuthoritiesFor(warehouseId, varietyIds)
  const detail = []

  for (const a of authorities) {
    const { withdrawals, withdrawnBags, withdrawnKilos } = await withdrawalsForAuthority(a.aiNumber)
    const unwithdrawnBags = Math.max(0, (a.totalAllocationBags ?? 0) - withdrawnBags)
    const unwithdrawnKilos = Math.max(0, (a.totalAllocationKilos ?? 0) - withdrawnKilos)
    if (unwithdrawnBags <= 0 && unwithdrawnKilos <= 0) continue

    detail.push({
      authority: a,
      allocatedBags: a.totalAllocationBags ?? 0,
      allocatedKilos: a.totalAllocationKilos ?? 0,
      withdrawnBags,
      withdrawnKilos,
      unwithdrawnBags,
      unwithdrawnKilos,
      withdrawals: [...withdrawals].sort((x, y) => (x.date < y.date ? -1 : 1)),
    })
  }

  return detail.sort((x, y) => (x.authority.aiNumber ?? '').localeCompare(y.authority.aiNumber ?? ''))
}
