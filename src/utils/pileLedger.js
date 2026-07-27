// Pile ledger — keeps `piles.currentBags`/`currentKilos` as live running
// totals rather than values re-derived by summing every transaction on
// every render. WSR (receipt) adds to a pile; WSI (issuance) subtracts.
// WTS (Warehouse Transfer Stock) has its own two-sided apply/reverse
// logic in WTSForm.jsx, since it moves two piles at once with net kilos
// computed from gross via MTS deduction — not handled here.

import { db } from '../db/dexie.js'
import { normalizeAgeToDays, todayLocalISO } from './calculations.js'

const DIRECTION_BY_TYPE = {
  WSR: 1,
  WSI: -1,
  WTS: 0,
}

/**
 * Applies a stock transaction's effect to its target pile's running
 * totals. Call this once, right after the transaction itself is saved.
 * No-ops safely if the pile no longer exists or the type has no defined
 * direction (e.g. WTS, until it's built out).
 */
export const applyTransactionToPile = async (transaction) => {
  const direction = DIRECTION_BY_TYPE[transaction.type]
  if (!direction || !transaction.pileId) return

  const pile = await db.piles.get(transaction.pileId)
  if (!pile) return

  const bagsDelta = (transaction.numberOfBags ?? 0) * direction
  const kilosDelta = (transaction.netKilos ?? 0) * direction

  const update = {
    currentBags: Math.max(0, (pile.currentBags ?? 0) + bagsDelta),
    currentKilos: Math.max(0, (pile.currentKilos ?? 0) + kilosDelta),
  }

  // A receipt's entered age was previously stored only on the
  // transaction itself, never applied to the pile - meaning it had no
  // effect on the pile's actual age bucketing at all. Only propagate
  // when the user genuinely entered an age (ageValue is null when left
  // blank), so leaving it blank correctly preserves the pile's existing
  // age instead of silently resetting it to 0.
  if (transaction.type === 'WSR' && transaction.ageValue != null) {
    update.initialAgeValue = transaction.initialAgeValue ?? 0
    update.dateOfReceipt = transaction.date ?? pile.dateOfReceipt
  }

  await db.piles.update(pile.pileId, update)
}

/**
 * Reverses a stock transaction's effect on its target pile — the inverse
 * of applyTransactionToPile. Used when a transaction is updated (reverse
 * the OLD values, then re-apply the NEW ones) or deleted (reverse only).
 */
export const reverseTransactionFromPile = async (transaction) => {
  const direction = DIRECTION_BY_TYPE[transaction.type]
  if (!direction || !transaction.pileId) return

  const pile = await db.piles.get(transaction.pileId)
  if (!pile) return

  const bagsDelta = (transaction.numberOfBags ?? 0) * direction
  const kilosDelta = (transaction.netKilos ?? 0) * direction

  await db.piles.update(pile.pileId, {
    currentBags: Math.max(0, (pile.currentBags ?? 0) - bagsDelta),
    currentKilos: Math.max(0, (pile.currentKilos ?? 0) - kilosDelta),
  })
}

/**
 * Creates a pile seeded with a beginning balance, for onboarding a
 * warehouse that already has physical stock into the app. Creates the
 * pile plus a synthetic WSR transaction flagged isInitialBalance: true
 * if bags or kilos are nonzero - excluded from visible statement rows,
 * but counted in a report's beginning-balance figure.
 */
export const createPileWithBeginningBalance = async ({
  warehouseId, pileName, category, varietyId, bags, kilos, age, ageUnit, condition, purity, dateProcured, moistureContent,
}) => {
  const ageDays = age ? normalizeAgeToDays(Number(age), ageUnit) : 0

  const pile = {
    pileId: crypto.randomUUID(),
    warehouseId,
    pileName: pileName.trim(),
    cerealType: category,
    varietyId,
    currentBags: bags || 0,
    currentKilos: kilos || 0,
    initialAgeValue: ageDays,
    dateOfReceipt: todayLocalISO(),
    purity: purity?.trim() || null,
    dateProcured: dateProcured?.trim() || null,
    moistureContent: moistureContent?.trim() || null,
    condition: condition || null,
  }

  await db.piles.add(pile)

  if (bags > 0 || kilos > 0) {
    await db.transactions.add({
      id: crypto.randomUUID(),
      type: 'WSR',
      serialNo: `INIT-${pile.pileId.slice(0, 8)}`,
      status: 'Active',
      date: pile.dateOfReceipt,
      warehouseId,
      pileId: pile.pileId,
      varietyId,
      condition,
      numberOfBags: bags || 0,
      grossKilos: kilos || 0,
      netKilos: kilos || 0,
      moistureContent: null,
      customerName: 'Beginning Balance',
      isInitialBalance: true,
      // A beginning balance is a starting figure, not a real
      // accountable transaction - it belongs in a config/settings area
      // (not yet built), not the WSR backup log. isSynced: true here
      // (not false) means it's never picked up by the sync queue at
      // all, rather than being pushed to the Sheet and needing to be
      // filtered back out later.
      isSynced: true,
    })
  }

  return pile
}

/**
 * Reconstructs a pile's bags/kilos as of a specific cutoff date, by
 * replaying its transaction history rather than reading the live
 * running totals (piles.currentBags/currentKilos, which always reflect
 * today regardless of what date the user is actually looking at).
 * Needed for the Piles page's period filter - without this, "as of last
 * month" and "as of today" would show identical (today's) figures.
 *
 * isInitialBalance seed transactions are date-gated the same as any
 * other transaction here - a pile's beginning balance has its own real
 * date (pile.dateOfReceipt), and viewing a cutoff before that date
 * should correctly show zero, not the seed balance, since the pile
 * genuinely did not exist yet at that point. (This intentionally
 * differs from report-summary contexts elsewhere, where
 * isInitialBalance bypasses date filtering on purpose - there, it
 * represents the report's own opening figure for whatever period is
 * being summarized, not a point-in-time existence question.)
 * WSR/WSI use the pileId field directly; WTS never sets it (only
 * issuedPileId/receivedPileId), so it needs a separate pass to avoid
 * missing (or double-counting) a pile's transfer history.
 */
export const computeHistoricalPileState = async (pileId, cutoffDate) => {
  // Unlike the report-summary context (where isInitialBalance
  // intentionally bypasses date filtering, since it represents that
  // period's own opening figure), a point-in-time "as of this date"
  // reconstruction must respect the beginning balance's own date too -
  // before that date, the pile genuinely did not exist yet, and should
  // show zero rather than silently including a balance from the future
  // (relative to the date being viewed).
  const direct = await db.transactions
    .where('pileId').equals(pileId)
    .and((t) => t.status === 'Active' && t.date <= cutoffDate)
    .toArray()

  const wtsAll = await db.transactions
    .where('type').equals('WTS')
    .and((t) => t.status === 'Active' &&
      (t.issuedPileId === pileId || t.receivedPileId === pileId) &&
      t.date <= cutoffDate)
    .toArray()

  let bags = 0
  let kilos = 0

  for (const t of direct) {
    const sign = t.type === 'WSR' ? 1 : t.type === 'WSI' ? -1 : 0
    bags += (t.numberOfBags ?? 0) * sign
    kilos += (t.netKilos ?? 0) * sign
  }

  for (const t of wtsAll) {
    if (t.issuedPileId === pileId) {
      bags -= t.issuedBags ?? 0
      kilos -= t.issuedNetKilos ?? 0
    }
    if (t.receivedPileId === pileId) {
      bags += t.receivedBags ?? 0
      kilos += t.receivedNetKilos ?? 0
    }
  }

  return { bags, kilos }
}
