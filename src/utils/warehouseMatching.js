/**
 * Normalizes a warehouse nickname for matching against the AI/SIA sheet.
 * Confirmed rule: whitespace and hyphens are ignored (so "ABACORP",
 * "ABACORP ", and "ABACORP-A"/"ABACORP A" collapse toward each other for
 * comparison), but any other difference in letters means a genuinely
 * different warehouse ("ABACORP" vs "ABACORP A" are NOT the same, since
 * "A" is an extra letter, not a formatting difference - likewise "BSI"
 * vs "BSI-B"/"BSI B" are different, but "BSI-B" and "BSI B" are the same
 * as each other). This is stored as the actual key (both when saving an
 * alias in WarehousesPanel and when looking one up during sync in
 * googleSheetsBridge), not just applied ad-hoc at match time, so two
 * visually-different-but-equivalent spellings can never end up
 * registered against different warehouses by accident.
 */
export const normalizeWarehouseAlias = (raw) =>
  (raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
