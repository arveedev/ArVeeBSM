// A pile that was closed on one date but still has documents dated AFTER that date.
//
// Closing a pile zeroes it on its close date, and every statement starts a closed pile at 0. A receipt or issue dated after
// the close therefore counts in the period it is dated in, but the pile is left out of the NEXT period's beginning balance,
// so the weekly summaries stop agreeing (reported 2026-10-19: Legazpi GID rice, five piles closed 2026-09-30 while their
// WSIs of Oct 1-7 were still recorded against them; week 1 ended at 444 bags, week 2 began at 947).
// Pure functions (no database) so the rule is tested.

/** Latest date of an Active document on this pile (receipt, issue, or either side of a transfer), or null. */
export const lastActivityDate = (pileId, transactions) => {
  let last = null
  for (const t of transactions) {
    if (t.status !== 'Active' || t.isInitialBalance) continue
    const on = t.type === 'WTS' ? (t.issuedPileId === pileId || t.receivedPileId === pileId) : t.pileId === pileId
    if (on && (!last || t.date > last)) last = t.date
  }
  return last
}

/** The date a pile can really be closed on: the date asked for, or the date of its last document if that is later. */
export const effectiveCloseDate = (pileId, requested, transactions) => {
  const last = lastActivityDate(pileId, transactions)
  return last && last > requested ? last : requested
}

/**
 * Every Active document dated after its pile's close date. `cutoffFor(warehouseId)` gives the date on or before which a
 * warehouse's documents are ignored (or null). A closing-residue transfer is dated on the close date itself, so it never counts.
 */
export const documentsAfterClose = (piles, transactions, { asOf = '9999-12-31', cutoffFor = () => null } = {}) => {
  const pileById = new Map(piles.map((p) => [p.pileId, p]))
  const out = []
  for (const t of transactions) {
    if (t.status !== 'Active' || t.isInitialBalance || t.date > asOf) continue
    const ids = t.type === 'WTS' ? [t.issuedPileId, t.receivedPileId] : [t.pileId]
    for (const id of ids) {
      const p = id ? pileById.get(id) : null
      if (!p?.closedDate || !(t.date > p.closedDate)) continue
      const cut = cutoffFor(t.warehouseId)
      if (cut && t.date <= cut) continue
      const open = piles
        .filter((x) => !x.closedDate && x.warehouseId === p.warehouseId && x.varietyId === p.varietyId && x.pileId !== p.pileId)
        .map((x) => x.pileName)
      out.push({
        type: t.type, serial: t.serialNo, date: t.date, bags: t.numberOfBags ?? t.issuedBags ?? 0, warehouseId: t.warehouseId,
        pile: p.pileName, pileId: p.pileId, closedDate: p.closedDate, openPiles: open,
      })
    }
  }
  return out.sort((a, b) => (a.closedDate < b.closedDate ? -1 : a.closedDate > b.closedDate ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
