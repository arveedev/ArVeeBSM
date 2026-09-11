// Shared formatting for computePileStockBreakdown's groups (pileLedger.js) -
// used by Piles.jsx (grid box + hover/tap popups), HomePiles.jsx (Pile
// List), pileLayoutPdfGenerator.js (exported Pile Layout PDF) and
// pileBinCardGenerator.js (exported BIN Card), so all four surfaces label a
// group identically instead of each re-deriving its own text.

export const sackLabelText = (sackTypeMap, sackTypeId, mtsCondition) => {
  const sackType = sackTypeId && sackTypeMap ? sackTypeMap.get(sackTypeId) : null
  if (!sackType) return null
  return mtsCondition ? `${sackType.code} - ${mtsCondition}` : sackType.code
}

/**
 * Builds one display row per breakdown group, sorted by variety name (By
 * Products only) then sack label, each carrying everything a caller needs
 * to render it. varietyName is null for Rice/Palay groups (single variety
 * for life - the caller shows it once, outside the breakdown) and only
 * populated for By Products, where the variety mix IS the point of the
 * breakdown. Zero-figure groups (both bags and kilos exactly 0) are
 * dropped - nothing to show - but a real negative group is kept, since
 * negative offsets between groups are a genuine part of the total (see
 * computePileStockBreakdown's own comment).
 */
export const formatPileStockGroups = (breakdown, { varietyMap, sackTypeMap, cerealType }) => {
  const isByProducts = cerealType === 'By Products'
  return breakdown
    .filter((g) => g.bags !== 0 || g.kilos !== 0)
    .map((g) => ({
      key: `${g.varietyId ?? ''}::${g.sackTypeId ?? ''}::${g.mtsCondition ?? ''}`,
      varietyName: isByProducts ? (varietyMap.get(g.varietyId)?.name ?? 'Unspecified') : null,
      sackLabelText: sackLabelText(sackTypeMap, g.sackTypeId, g.mtsCondition),
      bags: g.bags,
      kilos: g.kilos,
      lastReceivedDate: g.lastReceivedDate,
    }))
    .sort((a, b) => {
      if (isByProducts) {
        const byVariety = (a.varietyName ?? '').localeCompare(b.varietyName ?? '', undefined, { sensitivity: 'base' })
        if (byVariety !== 0) return byVariety
      }
      return (a.sackLabelText ?? '').localeCompare(b.sackLabelText ?? '', undefined, { sensitivity: 'base' })
    })
}

/** A group's own heading text - variety name for By Products, sack label (or "Stock") for Rice/Palay. */
export const groupHeading = (row) => row.varietyName ?? row.sackLabelText ?? 'Stock'

/** Human-readable date, matching the style already used for dateProcured display elsewhere (e.g. "June 16, 2026"). */
export const fmtGroupDate = (isoDate) => {
  if (!isoDate) return null
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })
}
