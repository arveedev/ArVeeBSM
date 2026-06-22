// SIA allocation parsing — turns the raw sheet data for a SIA record into
// sack lines (sackTypeId, condition, pieces) that can pre-fill an ESI
// form's Sack Lines section.
//
// Two real shapes seen in the sheet's "TYPE/CAPACITY" + "# OF BAGS"
// columns:
//
//  SINGLE sack type, single or multiple conditions — handled here:
//    TYPE/CAPACITY: "PPRE50"
//    # OF BAGS: "65 bn / 17 sh"        -> two lines, same sackTypeId
//    # OF BAGS: 2500 (plain number)    -> one line, condition unknown
//      (falls back to whatever single condition that sack type has, if
//      only one is configured; otherwise left for the user to pick)
//
//  MULTIPLE sack types in one record — explicitly NOT parsed yet, per
//  instruction to hold off until real Google Sheet connection testing:
//    TYPE/CAPACITY: "PPRE50/PPMG50"
//    # OF BAGS: "4 BN / 144 US / 876 SH / 6014 BN / 193 US"
//  Splitting this requires detecting which condition code repeats (the
//  repeat marks the start of the second sack type's figures) — deferred.
//  resolveSiaSackLines() returns an empty array for this shape, and the
//  caller should fall back to showing rawSiaAllocation as read-only text
//  instead of pre-filled lines.

const CONDITION_CODES = ['BN', 'SH', 'US']

/** True if TYPE/CAPACITY names more than one sack type code (e.g. has a "/"). */
const isMultiSackType = (sackTypeRaw = '') => sackTypeRaw.trim().includes('/')

/**
 * Parses a "# OF BAGS" string like "65 bn / 17 sh" into
 * [{ condition: 'BN', pieces: 65 }, { condition: 'SH', pieces: 17 }].
 * Returns [] if it doesn't match the expected "<number> <condition>"
 * repeated pattern.
 */
const parsePiecesString = (raw = '') => {
  const parts = raw.split('/').map((p) => p.trim()).filter(Boolean)
  const lines = []

  for (const part of parts) {
    const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/.exec(part)
    if (!match) return []
    const [, numStr, condRaw] = match
    const condition = condRaw.toUpperCase()
    if (!CONDITION_CODES.includes(condition)) return []
    lines.push({ condition, pieces: Number(numStr) })
  }

  return lines
}

/**
 * Resolves a SIA authority record into sack lines ready to pre-fill an
 * ESI form, given the app's configured sackTypes (for code -> sackTypeId
 * lookup). Returns [] if the record represents a multi-sack-type
 * allocation (deferred) or if nothing could be confidently resolved.
 */
export const resolveSiaSackLines = (authority, sackTypes = []) => {
  const sackTypeRaw = authority.sackTypeRaw ?? ''
  if (!sackTypeRaw || isMultiSackType(sackTypeRaw)) return []

  const sackType = sackTypes.find((s) => s.code === sackTypeRaw.trim())
  if (!sackType) return []

  // Plain numeric allocation, no condition breakdown in the sheet — only
  // pre-fill a condition if this sack type has exactly one configured.
  if (typeof authority.totalAllocationBags === 'number') {
    const availableConditions = CONDITION_CODES.filter((c) => sackType.weights?.[c] != null)
    if (availableConditions.length === 1) {
      return [{
        sackTypeId: sackType.sackTypeId,
        condition: availableConditions[0],
        pieces: authority.totalAllocationBags,
      }]
    }
    return []
  }

  // "65 bn / 17 sh" style breakdown.
  if (authority.rawSiaAllocation) {
    const parsed = parsePiecesString(authority.rawSiaAllocation)
    if (parsed.length === 0) return []
    return parsed.map((line) => ({ sackTypeId: sackType.sackTypeId, ...line }))
  }

  return []
}
