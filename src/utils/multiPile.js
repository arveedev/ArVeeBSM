// A document received into (or issued from) several piles is saved as one transaction record per pile: the primary
// keeps the document's own number and every extra pile gets the same number plus a letter ("11766812", "11766812-A").
// They share `groupSerialNo` (the primary's number). To every reader other than the pile ledger it is ONE document, so the
// lists and totals combine them: one number, the receipt of all piles added together. Reports and the exported PDF already
// did; the SDO side (payment list, Procurement overview) did not, so the extra pile showed as a second WSR to be paid.

/** One row per document: the primary record with bags, gross and net kilos summed over its piles, plus `groupIds`. */
export const combineMultiPileGroups = (transactions) => {
  const groups = new Map()
  for (const t of transactions) {
    const key = t.groupSerialNo ?? t.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]
    const primary = group.find((t) => t.serialNo === t.groupSerialNo) ?? group[0]
    return {
      ...primary,
      numberOfBags: group.reduce((sum, t) => sum + (t.numberOfBags ?? 0), 0),
      grossKilos: group.reduce((sum, t) => sum + (t.grossKilos ?? 0), 0),
      netKilos: group.reduce((sum, t) => sum + (t.netKilos ?? 0), 0),
      groupIds: group.map((t) => t.id),
    }
  })
}

/** id of every record in a multi-pile document -> the primary record's id, so a Purchase Receipt filed against any pile counts for the document. */
export const primaryIdMap = (transactions) => {
  const groups = new Map()
  for (const t of transactions) {
    if (!t.groupSerialNo) continue
    if (!groups.has(t.groupSerialNo)) groups.set(t.groupSerialNo, [])
    groups.get(t.groupSerialNo).push(t)
  }
  const out = new Map()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const primary = group.find((t) => t.serialNo === t.groupSerialNo) ?? group[0]
    for (const t of group) out.set(t.id, primary.id)
  }
  return out
}
