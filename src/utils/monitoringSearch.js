// Shared "broad" search matchers for every Admin/Visitor Monitoring
// screen (AI/SIA pending + Completed, Milling/Test Milling pending +
// Completed, NFA) - per explicit request, search should find a record by
// customer name, authority number, warehouse, AI/SIA number, MO/TMO
// number, ricemill name, O.R. number, or other notes, not just one
// narrow reference field. One shared implementation so every screen's
// idea of "broad" stays the same instead of each picking its own subset.

const matchesAny = (query, candidates) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return candidates.some((c) => c != null && String(c).toLowerCase().includes(q))
}

/**
 * AI/SIA authority record - fields confirmed directly against the
 * Sheet-sync writer (googleSheetsBridge.js): aiNumber/siaNumber,
 * customerName, regionalAuthorityNumber, orNumber (the real field name
 * for "O.R. Number"), remarks (the real field name for "notes"), note1/
 * note2, sourceWarehouse (a plain string, separate from assignedWarehouse
 * which is a warehouseId resolved via warehouseMap below).
 */
export const authorityMatchesQuery = (a, query, warehouseMap) => {
  const warehouse = warehouseMap?.get(a.assignedWarehouse)
  return matchesAny(query, [
    a.aiNumber, a.siaNumber, a.customerName, a.regionalAuthorityNumber,
    a.orNumber, a.remarks, a.note1, a.note2, a.sourceWarehouse,
    warehouse?.code, warehouse?.name, a.assignedWarehouse,
  ])
}

/**
 * MO/TMO milling order record - db.millingOrders itself has no
 * customerName/orNumber/notes fields (confirmed directly against the
 * sync writer) - those only exist on the AUTHORITY it links to (via its
 * own aiNumber/siaNumber). `linkedAuthority` is the caller's own
 * pre-joined lookup (by orderId, matching the existing
 * regionalAuthByOrder-style join in MillingMonitor.jsx) - null when an
 * order has no linked authority yet, which is real and not an error.
 */
export const millingOrderMatchesQuery = (o, query, linkedAuthority, warehouseMap) => {
  const warehouse = linkedAuthority ? warehouseMap?.get(linkedAuthority.assignedWarehouse) : null
  return matchesAny(query, [
    o.number, o.ricemillName, o.receivingWarehouse, o.aiNumber, o.siaNumber,
    linkedAuthority?.customerName, linkedAuthority?.regionalAuthorityNumber,
    linkedAuthority?.orNumber, linkedAuthority?.remarks, linkedAuthority?.note1, linkedAuthority?.note2,
    linkedAuthority?.sourceWarehouse, warehouse?.code, warehouse?.name,
  ])
}

/**
 * NFA Regional Authority Number allocation row - the allocation record
 * itself only has regionalAuthorityNumber as a real identifier (it's a
 * quota config, not a per-transaction record); the AI numbers that
 * actually moved stock under it live in its computed transferEntries
 * (recoverySummaryByNumber, from NfaMillingMonitor.jsx), passed in here.
 */
export const nfaAllocationMatchesQuery = (regionalAuthorityNumber, transferEntries, query) =>
  matchesAny(query, [regionalAuthorityNumber, ...(transferEntries ?? []).map((e) => e.aiNumber)])
