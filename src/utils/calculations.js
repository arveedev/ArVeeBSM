// Core calculation utilities — see PRDD Section 4 for formula definitions.
// All decimal values are rounded to 2 places to avoid floating-point drift.

/**
 * Net Kilos = Gross Kilos - MTS
 * (Section 4.1)
 */
export const calculateNetKilos = (grossKilos, mts) => {
  return parseFloat((Number(grossKilos) - Number(mts)).toFixed(2))
}

/**
 * Net Bags = Net Kilos / 50
 * (Section 4.1)
 */
export const calculateNetBags = (netKilos) => {
  return parseFloat((Number(netKilos) / 50).toFixed(2))
}

/**
 * MTS (empty sack weight) = per-bag weight (from the selected Sack Code +
 * Condition, Admin Dashboard > Sack Types) * number of bags.
 * Phase 5 revision: MTS is no longer a free-typed number — it's derived
 * from the admin-configured sack weight so it can't be entered incorrectly.
 */
export const calculateMtsFromSackWeight = (weightPerBag, numberOfBags) => {
  const weight = Number(weightPerBag) || 0
  const bags = Number(numberOfBags) || 0
  return parseFloat((weight * bags).toFixed(3))
}

/**
 * Average weight per bag = Net Kilos / number of bags. Shown as a small
 * informational line under Net Kilos (Phase 5) — replaces Net Bags / Milling
 * Recovery on the stock transaction forms.
 */
export const calculateAverageWeightPerBag = (netKilos, numberOfBags) => {
  const bags = Number(numberOfBags) || 0
  if (bags <= 0) return 0
  return parseFloat((Number(netKilos) / bags).toFixed(2))
}

/**
 * Normalizes a (value, unit) age pair — unit is 'Days' or 'Months' — into a
 * single day count, treating 1 month as 30 days for storage/aggregation
 * consistency (e.g. the Phase 4 Admin Home age-bucket tables operate in days).
 */
export const normalizeAgeToDays = (value, unit) => {
  const num = Number(value) || 0
  return unit === 'Months' ? Math.round(num * 30) : Math.round(num)
}

/**
 * Current Age (Days) = Base Initial Age + (System Date - Date of Receipt)
 * If autoAgeMonitoring is false, the manual base value is returned unchanged.
 * (Section 4.2)
 */
export const calculateCurrentAge = (baseInitialAge, dateOfReceipt, autoAgeMonitoring) => {
  if (!autoAgeMonitoring) return baseInitialAge

  const receipt = new Date(dateOfReceipt)
  const today = new Date()

  receipt.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)

  const elapsedDays = Math.floor((today - receipt) / (1000 * 60 * 60 * 24))

  return baseInitialAge + elapsedDays
}

/**
 * Authority balance + status (Section 4.3), generalized to operate on
 * whichever unit (kilos or bags) the allocation was actually defined in —
 * Phase 5: AI/SIA can be bags-only, kilos-only, or both.
 */
export const calculateAuthorityStatus = (totalAllocation, totalIssued) => {
  if (totalAllocation === null || totalAllocation === undefined) {
    return { balanceRemaining: null, status: null }
  }

  const balanceRemaining = parseFloat(
    (Number(totalAllocation) - Number(totalIssued ?? 0)).toFixed(2)
  )

  let status = 'Pending'
  if (balanceRemaining === 0) status = 'Complete'
  else if (balanceRemaining < 0) status = 'Over-Issued'

  return { balanceRemaining, status }
}
