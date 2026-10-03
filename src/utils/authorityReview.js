// Turns the authority change log / missing flag (utils/authorityChanges.js)
// into the per-warehouse "needs review" groups shown by the bell. Purely
// derived - nothing is stored per user or per device. A transaction needs
// review when its authority changed (or left the Sheet) AFTER the
// transaction was created or last acknowledged (`authorityAckAt`).
// Acknowledging only stamps that field; it never changes anything else.

import { db } from '../db/dexie.js'

const toMs = (v) => {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

const sinceMs = (tx) => Math.max(toMs(tx.authorityAckAt), toMs(tx.createdAt))

/**
 * Groups of (authority, affected transactions) visible to this user.
 * scope: { isAdmin, warehouseIds } - admin sees every warehouse.
 */
export const computeReviewGroups = async ({ isAdmin, warehouseIds }) => {
  const allowed = new Set(warehouseIds ?? [])
  const flagged = await db.authorities
    .filter((a) => (a.changeLog?.length ?? 0) > 0 || Boolean(a.missingFromSheetAt))
    .toArray()

  const groups = []
  for (const authority of flagged) {
    const isSia = authority.type === 'SIA'
    const number = isSia ? authority.siaNumber : authority.aiNumber
    if (!number) continue
    const linked = await db.transactions
      .where(isSia ? 'siaNumber' : 'aiNumber').equals(number)
      .and((t) => t.status === 'Active' && (isAdmin || allowed.has(t.warehouseId)))
      .toArray()

    const latestChangeMs = Math.max(0, ...(authority.changeLog ?? []).map((c) => toMs(c.at)))
    const missingMs = toMs(authority.missingFromSheetAt)
    const eventMs = Math.max(latestChangeMs, missingMs)
    const affected = linked.filter((t) => eventMs > sinceMs(t))
    if (affected.length === 0) continue

    groups.push({
      key: authority.authId,
      authority,
      number,
      kind: missingMs > latestChangeMs ? 'missing' : 'changed',
      eventAt: new Date(eventMs).toISOString(),
      // Only the changes newer than the oldest affected transaction's baseline matter.
      changes: (authority.changeLog ?? [])
        .filter((c) => toMs(c.at) > Math.min(...affected.map(sinceMs)))
        .flatMap((c) => c.changes.map((ch) => ({ ...ch, at: c.at }))),
      transactions: affected.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    })
  }
  return groups.sort((a, b) => b.eventAt.localeCompare(a.eventAt))
}

/** Marks transactions as reviewed. Touches only the two ack fields. */
export const acknowledgeTransactions = async (ids, note = null) => {
  const now = Date.now()
  for (const id of ids) {
    await db.transactions.update(id, { authorityAckAt: now, authorityAckNote: note })
  }
}

/**
 * Admin overview: transactions linked to an AI/SIA number that has no
 * authority record at all (true orphans), plus how many open review items
 * each flagged authority has.
 */
export const scanOrphanTransactions = async () => {
  const [authorities, txs] = await Promise.all([db.authorities.toArray(), db.transactions.toArray()])
  const aiNumbers = new Set(authorities.filter((a) => a.type === 'AI').map((a) => a.aiNumber))
  const siaNumbers = new Set(authorities.filter((a) => a.type === 'SIA').map((a) => a.siaNumber))
  const orphans = []
  for (const t of txs) {
    if (t.status !== 'Active') continue
    if (t.aiNumber && !aiNumbers.has(t.aiNumber)) orphans.push({ tx: t, kind: 'AI', number: t.aiNumber })
    else if (t.siaNumber && !siaNumbers.has(t.siaNumber)) orphans.push({ tx: t, kind: 'SIA', number: t.siaNumber })
  }
  return orphans.sort((a, b) => (b.tx.date ?? '').localeCompare(a.tx.date ?? ''))
}
