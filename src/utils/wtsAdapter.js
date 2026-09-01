// WTS is a two-sided transaction (issued side + received side stored on
// one record with issued*/received* prefixed fields), but every report,
// summary, and PDF page expects a flat WSR/WSI-shaped transaction
// (varietyId, numberOfBags, grossKilos, netKilos, condition). Without
// this adapter, a WTS record shows up as "Unknown" cereal type with no
// values, since none of those flat fields exist on it directly.
//
// normalizeWtsSide() extracts one side of a WTS transaction into that
// flat shape. Used wherever WSR/WSI/WTS transactions are grouped or
// displayed together — the received side belongs with WSR (receipts),
// the issued side belongs with WSI (issues), since that mirrors how the
// real NFA paper documents show WTS on both statements.

// WTS carries TWO different, unrelated "condition" concepts per side:
// `issuedCondition`/`receivedCondition` (BN/SH/US) is the SACK's own
// condition - only used to look up the right tare weight for the net
// kilos calculation, same as every other form's MTS deduction. Every
// report/statement, on the other hand, expects the STOCK condition
// (GQ/TRD/INF/PD/TD - see shared.js's CONDITION_FLAGS), which is a
// completely different scale. Reusing the sack condition there is what
// made a plain BN sack show up as its own separate, wrong "BN" row on
// the weekly stock report instead of merging into the real GQ row -
// this maps WTS's own Stock Condition field (issuedStockCondition/
// receivedStockCondition, already collected on the form) to that scale
// instead.
const STOCK_CONDITION_TO_FLAG = { Good: 'GQ', 'Part Damaged': 'PD', Damaged: 'TD' }

export const normalizeWtsSide = (tx, side) => ({
  ...tx,
  varietyId: tx[`${side}VarietyId`] ?? null,
  numberOfBags: tx[`${side}Bags`] ?? null,
  grossKilos: tx[`${side}GrossKilos`] ?? null,
  netKilos: tx[`${side}NetKilos`] ?? null,
  condition: STOCK_CONDITION_TO_FLAG[tx[`${side}StockCondition`]] ?? 'GQ',
  // WTS is an internal transfer with no real "customer" - customerName
  // here is really "who prepared/handled this document". Falls back to
  // createdByName (the logged-in user at save time, see WTSForm.jsx),
  // and only to the generic label for older records saved before that
  // field existed.
  customerName: tx.createdByName || tx.customerName || 'Warehouse Transfer',
  wtsSide: side,
})

/**
 * Splits a mixed WSR/WSI/WTS transaction list into receipt-shaped and
 * issue-shaped rows. WSR rows go to receipts as-is, WSI rows go to
 * issues as-is, WTS rows contribute a normalized row to each side
 * (skipped if that side has no bags, e.g. a legacy one-sided WTS record).
 */
export const splitStockTransactions = (transactions) => {
  const receipts = []
  const issues = []
  for (const t of transactions) {
    if (t.type === 'WSR') {
      receipts.push(t)
    } else if (t.type === 'WSI') {
      issues.push(t)
    } else if (t.type === 'WTS') {
      if (t.receivedBags != null) receipts.push(normalizeWtsSide(t, 'received'))
      if (t.issuedBags != null) issues.push(normalizeWtsSide(t, 'issued'))
    }
  }
  return { receipts, issues }
}
