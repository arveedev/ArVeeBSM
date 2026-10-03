// Authority change tracking - detection only. Authorities still come
// exclusively from the Google Sheet; nothing here ever edits a
// transaction, balance, pile or Sheet row. The Sheet sync (see
// googleSheetsBridge.js upsertAuthority/upsertSiaAuthority) calls the
// helpers below to APPEND a small entry to the authority's own
// `changeLog` whenever a material field of an authority that real
// transactions already use changes, and to stamp `missingFromSheetAt` on
// an authority that vanished from a complete full pull (typically a
// renumber). utils/authorityReview.js turns those into per-user
// notifications.
//
// Noise guards (production safety):
//  - a field going null -> value (late backfill) or value -> null (an
//    alias that failed to resolve this pass) is never a change;
//  - nothing is logged unless an Active transaction already links to the
//    authority, so a fresh deploy can't flood anyone;
//  - every helper swallows its own errors - a failure here must never
//    break the authority sync.

import { db } from '../db/dexie.js'

const CHANGELOG_CAP = 10

// Fields whose change can invalidate an issuance already made.
const AI_MATERIAL_FIELDS = ['assignedWarehouse', 'varietyId', 'transactionTypeName', 'totalAllocationBags', 'totalAllocationKilos']
const SIA_SCALAR_FIELDS = ['assignedWarehouse', 'transactionTypeName']

export const FIELD_LABELS = {
  assignedWarehouse: 'Warehouse',
  varietyId: 'Variety',
  transactionTypeName: 'Transaction type',
  totalAllocationBags: 'Allocated bags',
  totalAllocationKilos: 'Allocated net kg',
  sackLine: 'Sack line',
}

const isReal = (v) => v !== null && v !== undefined && v !== ''

const countLinkedTransactions = async (authority) => {
  const index = authority.type === 'SIA' ? 'siaNumber' : 'aiNumber'
  const number = authority.type === 'SIA' ? authority.siaNumber : authority.aiNumber
  if (!number) return 0
  return db.transactions.where(index).equals(number).and((t) => t.status === 'Active').count()
}

const diffAi = (existing, incoming) => {
  const changes = []
  for (const field of AI_MATERIAL_FIELDS) {
    const from = existing?.[field]
    const to = incoming?.[field]
    if (isReal(from) && isReal(to) && from !== to) changes.push({ field, from, to })
  }
  return changes
}

const diffSia = (existing, incoming, mergedLines) => {
  const changes = []
  for (const field of SIA_SCALAR_FIELDS) {
    const from = existing?.[field]
    const to = incoming?.[field]
    if (isReal(from) && isReal(to) && from !== to) changes.push({ field, from, to })
  }
  const newLines = mergedLines ?? []
  for (const old of existing?.sackLines ?? []) {
    const match = newLines.find((l) => l.sackTypeId === old.sackTypeId && l.condition === old.condition)
    if (!match) {
      changes.push({ field: 'sackLine', sackTypeId: old.sackTypeId, condition: old.condition, from: old.totalAllocationBags ?? null, to: null, removed: true })
    } else if (isReal(old.totalAllocationBags) && isReal(match.totalAllocationBags) && old.totalAllocationBags !== match.totalAllocationBags) {
      changes.push({ field: 'sackLine', sackTypeId: old.sackTypeId, condition: old.condition, from: old.totalAllocationBags, to: match.totalAllocationBags })
    }
  }
  return changes
}

/**
 * Returns a partial update ({ changeLog }) to merge into the authority
 * patch, or {} when nothing material changed / nothing links to it.
 * `incoming` is the new AI row (type 'AI') or the new SIA scalar fields;
 * `mergedLines` is the SIA's new sackLines array.
 */
export const buildChangeLogPatch = async (existing, incoming, mergedLines = null) => {
  try {
    if (!existing) return {}
    const changes = existing.type === 'SIA' ? diffSia(existing, incoming, mergedLines) : diffAi(existing, incoming)
    if (changes.length === 0) return {}
    if ((await countLinkedTransactions(existing)) === 0) return {}
    const log = [...(existing.changeLog ?? []), { at: new Date().toISOString(), changes }]
    return { changeLog: log.slice(-CHANGELOG_CAP) }
  } catch (err) {
    console.warn('[authority-changes] change log skipped:', err)
    return {}
  }
}

/**
 * After a COMPLETE full pull for one source: flags authorities that no
 * longer appear in the Sheet. Refuses to flag anything when the unseen
 * share looks like a truncated/shifted response rather than real
 * renumbers/removals. Only touches authorities that don't already carry
 * the flag, so a repeat pass writes nothing.
 */
export const markMissingAuthorities = async (sourceId, seenAi, seenSia) => {
  try {
    const mine = await db.authorities.filter((a) => a.sourceId === sourceId).toArray()
    if (mine.length === 0) return { flagged: 0 }
    const unseen = mine.filter((a) => (a.type === 'SIA' ? !seenSia.has(a.siaNumber) : !seenAi.has(a.aiNumber)))
    const toFlag = unseen.filter((a) => !a.missingFromSheetAt)
    if (unseen.length > Math.max(10, mine.length * 0.15)) {
      console.warn('[authority-changes] too many authorities missing from full pull (', unseen.length, 'of', mine.length, ') - not flagging')
      return { flagged: 0, skipped: true }
    }
    const now = new Date().toISOString()
    for (const a of toFlag) {
      if ((await countLinkedTransactions(a)) === 0) continue
      await db.authorities.update(a.authId, { missingFromSheetAt: now })
    }
    return { flagged: toFlag.length }
  } catch (err) {
    console.warn('[authority-changes] missing-flag pass skipped:', err)
    return { flagged: 0 }
  }
}
