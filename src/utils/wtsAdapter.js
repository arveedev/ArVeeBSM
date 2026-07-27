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

export const normalizeWtsSide = (tx, side) => ({
  ...tx,
  varietyId: tx[`${side}VarietyId`] ?? null,
  numberOfBags: tx[`${side}Bags`] ?? null,
  grossKilos: tx[`${side}GrossKilos`] ?? null,
  netKilos: tx[`${side}NetKilos`] ?? null,
  condition: tx[`${side}Condition`] ?? null,
  customerName: tx.customerName ?? 'Warehouse Transfer',
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
