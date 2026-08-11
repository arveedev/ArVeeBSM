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
 * Finds or creates the single accountability pile for a given
 * warehouse+variety combination - used by Ricemill/Mechanical Dryer
 * facilities to hold stock passing through MPO III's own
 * accountability, which is not a physical, spatially-placed pile.
 * Flagged isAccountabilityPile: true so it's excluded from the normal
 * Piles grid/layout entirely. Created lazily on first use per variety,
 * since which varieties will actually pass through a given facility
 * isn't known ahead of time - one pile per variety, same as a normal
 * pile, just without a manual placement step.
 */
export const getOrCreateAccountabilityPile = async ({ warehouseId, category, varietyId, warehouseName }) => {
  const existing = await db.piles
    .where('warehouseId').equals(warehouseId)
    .and((p) => p.isAccountabilityPile === true && p.varietyId === varietyId)
    .first()
  if (existing) return existing

  const pile = {
    pileId: crypto.randomUUID(),
    warehouseId,
    pileName: `${warehouseName ?? 'Facility'} Accountability`,
    cerealType: category,
    varietyId,
    currentBags: 0,
    currentKilos: 0,
    initialAgeValue: 0,
    dateOfReceipt: todayLocalISO(),
    purity: null,
    dateProcured: null,
    moistureContent: null,
    condition: null,
    isAccountabilityPile: true,
  }
  await db.piles.add(pile)
  return pile
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
  asOfDate,
}) => {
  const ageDays = age ? normalizeAgeToDays(Number(age), ageUnit) : 0
  const receiptDate = asOfDate || todayLocalISO()

  const pile = {
    pileId: crypto.randomUUID(),
    warehouseId,
    pileName: pileName.trim(),
    cerealType: category,
    varietyId,
    currentBags: bags || 0,
    currentKilos: kilos || 0,
    initialAgeValue: ageDays,
    dateOfReceipt: receiptDate,
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

/**
 * Recomputes a pile's live currentBags/currentKilos from its COMPLETE
 * transaction history (seed + every transaction since) and writes the
 * result to the pile record. This is the correct way to reflect an
 * edited beginning balance in the pile's live totals - never overwrite
 * currentBags/currentKilos directly with a raw form value, since that
 * discards every transaction that has happened since the beginning
 * balance was first recorded. Call this after updating the seed
 * (isInitialBalance) transaction, not instead of updating it.
 */
export const recalculatePileCurrentState = async (pileId) => {
  const farFuture = '9999-12-31'
  const { bags, kilos } = await computeHistoricalPileState(pileId, farFuture)
  await db.piles.update(pileId, { currentBags: bags, currentKilos: kilos })
  return { bags, kilos }
}

/**
 * Closes a pile - a long-running pile's ledger can otherwise grow
 * indefinitely, so this marks it as done (depleted, or closed for any
 * other reason) with today's date, and zeroes out whatever balance
 * remains at that point regardless of its sign or size. No reason or
 * note is required - just the ability to close it. The BIN Card
 * generator reads pile.closedDate to render this as the ledger's final
 * entry, showing exactly what was zeroed out.
 */
export const closePile = async (pileId) => {
  const { bags, kilos } = await recalculatePileCurrentState(pileId)
  await db.piles.update(pileId, {
    closedDate: todayLocalISO(),
    currentBags: 0,
    currentKilos: 0,
  })
  return { previousBags: bags, previousKilos: kilos }
}

/**
 * Re-opens a previously closed pile - clears closedDate and restores
 * the live totals from the full ledger (which will now correctly
 * reflect the real balance again, since the closing zero-out is no
 * longer in effect).
 */
export const reopenPile = async (pileId) => {
  await db.piles.update(pileId, { closedDate: null })
  return recalculatePileCurrentState(pileId)
}
