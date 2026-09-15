// SDO (Disbursing Officer) — Purchase Receipt computation helpers.
//
// Two explicit rounding rules, both confirmed directly and both
// corrected at least once from an earlier stated version - this is the
// settled shape: any peso amount (Basic Cost, Pricer Amount, Total
// Amount, Cash on Hand) is standard-ROUNDED to 2 decimals, not
// truncated (corrected from an earlier "truncated/3rd decimal
// dropped"). Equivalent Net Weight is truncated (never rounded), but
// to HOW MANY decimals depends on the ENW factor itself - confirmed
// directly: when the factor is exactly 1 (1.0000), ENW truncates to 3
// decimals; for any other factor, it truncates to 4. A factor of
// exactly 1 means the classification needed no moisture adjustment at
// all (dry, top grade), which is apparently precise enough at 3;
// anything actually adjusted by the factor table keeps the extra digit.

/** Truncates (never rounds) `n` to `decimals` places - used only for Equivalent Net Weight. */
export const truncTo = (n, decimals) => {
  const f = 10 ** decimals
  return Math.floor((n + Number.EPSILON) * f) / f
}

/** Standard-rounds (not truncates) `n` to `decimals` places - used for every peso amount. */
export const roundTo = (n, decimals) => {
  const f = 10 ** decimals
  return Math.round((n + Number.EPSILON) * f) / f
}

export const roundPeso2 = (n) => roundTo(n, 2)

/** Decimal places ENW truncates to for a given factor - 3 when the factor is exactly 1, 4 otherwise. Tolerance-compared, not strict ===, in case a factor is ever derived rather than hand-entered (float drift like 0.9999999 must still read as 1). */
export const enwDecimalsForFactor = (factor) => (Math.abs(Number(factor) - 1) < 0.0001 ? 3 : 4)

/**
 * Finds the ENW factor row that applies to this Palay variety's own
 * fixed Purity letter / D&D bracket (set once, per variety, in the
 * Variety Types admin panel — confirmed: "we can set it by the variety
 * of the palay") at this specific WSR's own Moisture Content.
 * Boundary handling is inclusive on both ends of an MC bracket - admin-
 * entered brackets must not overlap, or the first matching row wins.
 */
// Numeric fields are compared with Number() coercion and a small
// tolerance rather than strict === - real, reported case: a match that
// should have worked (same values visibly in both the variety's own
// classification and the ENW grid) still failed, most plausibly a
// string-vs-number mismatch somewhere upstream (a form field read as
// text before being saved) that strict equality can't forgive but a
// numeric comparison can. Purity letter is compared case/whitespace-
// insensitively for the same reason.
const numClose = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001
const letterEq = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase()

export const lookupEnwFactor = (enwFactors, variety, mcValue) => {
  if (!variety || mcValue == null) return null
  const mc = Number(mcValue)
  const row = (enwFactors ?? []).find(
    (r) =>
      letterEq(r.purityLetter, variety.purityLetter) &&
      numClose(r.ddMin, variety.ddMin) &&
      numClose(r.ddMax, variety.ddMax) &&
      mc >= Number(r.mcMin) &&
      mc <= Number(r.mcMax)
  )
  return row?.factor ?? null
}

/** Equivalent Net Weight = Net Kilos × ENW factor, truncated to 3 decimals when factor is exactly 1, 4 otherwise. */
export const computeEquivalentNetWeight = (netKilos, factor) => truncTo(netKilos * factor, enwDecimalsForFactor(factor))

/** Basic Cost = Equivalent Net Weight × Unit Cost, rounded to 2 decimals. */
export const computeBasicCost = (enw, unitCost) => roundPeso2(enw * unitCost)

/** Pricer Amount = Equivalent Net Weight × Pricer Rate, rounded to 2 decimals. */
export const computePricerAmount = (enw, rate) => roundPeso2(enw * (rate || 0))

/**
 * The Buying Price active on `asOfDate` - the latest row whose
 * effectiveFrom is on or before that date, not necessarily today's
 * price. A PR for an older, backlogged WSR must use the price that was
 * actually in effect on the WSR's own date.
 *
 * Real, reported case this falls back for: a price set TODAY for the
 * first time, being used to pay a WSR encoded BEFORE today - strictly,
 * no price row has an effectiveFrom on or before that older date, so
 * the rule above finds nothing even though a price clearly exists.
 * Falling back to the EARLIEST price on record (rather than reporting
 * "no price set") treats it as the price that's effectively been in
 * force since the beginning - the sensible reading when nothing more
 * specific was ever recorded for that period.
 *
 * Ties on effectiveFrom (the price was corrected more than once on the
 * same day) break on `createdAt` - whichever row was actually saved
 * most recently wins, instead of depending on incidental array order.
 * Rows saved before `createdAt` existed fall back to 0, so an old row
 * never outranks a newer one that does carry a real timestamp.
 */
export const resolveBuyingPrice = (buyingPrices, asOfDate) => {
  const sorted = [...(buyingPrices ?? [])].sort((a, b) => {
    if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
  const applicable = sorted.find((p) => p.effectiveFrom <= asOfDate)
  return applicable ?? sorted[sorted.length - 1] ?? null
}

/** Picks Dry or Wet price from a resolved buying-price row, by the variety's moisture state. */
export const resolveUnitCost = (priceRow, moistureState) => {
  if (!priceRow) return null
  return moistureState === 'wet' ? priceRow.wetPrice : priceRow.dryPrice
}

/**
 * Cash on Hand is never a stored running number - always this live
 * sum, so cancelling or deleting a Purchase Receipt "reverts the cash"
 * automatically: the instant its status leaves 'Active', it drops out
 * of `activePrTotal` on its own. A voided ledger entry (see
 * CashHistoryModal.jsx) is excluded the same way - it stays in the
 * table as a visible, explained record, it just no longer counts.
 */
export const computeCashOnHand = (ledgerEntries, activePrTotals) => {
  const live = (ledgerEntries ?? []).filter((e) => !e.voided)
  const replenished = live
    .filter((e) => e.type === 'replenish')
    .reduce((s, e) => s + e.amount, 0)
  const liquidated = live
    .filter((e) => e.type === 'liquidate')
    .reduce((s, e) => s + e.amount, 0)
  const disbursed = (activePrTotals ?? []).reduce((s, amt) => s + amt, 0)
  return roundPeso2(replenished - liquidated - disbursed)
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

const threeDigitsToWords = (n) => {
  const parts = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`)
    n %= 100
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)])
    if (n % 10) parts.push(ONES[n % 10])
  } else if (n > 0) {
    parts.push(ONES[n])
  }
  return parts.join(' ')
}

/** Whole-pesos portion of `amount`, in words, title-capitalized NFA-style ("Seventy Four Thousand..."). */
export const wholeNumberToWords = (n) => {
  n = Math.floor(n)
  if (n === 0) return 'zero'
  const groups = []
  const scales = ['', ' thousand', ' million', ' billion']
  let scaleIdx = 0
  while (n > 0) {
    const chunk = n % 1000
    if (chunk > 0) groups.unshift(threeDigitsToWords(chunk) + scales[scaleIdx])
    n = Math.floor(n / 1000)
    scaleIdx += 1
  }
  return groups.join(' ').trim()
}

/** "Seventy four thousand seven hundred sixty five pesos and 91/100 only" - the exact wording every PR/Abstract signature line already uses. */
export const amountInWords = (amount) => {
  const pesos = Math.floor(amount)
  const centavos = Math.round((amount - pesos) * 100)
  const pesosWords = wholeNumberToWords(pesos)
  const capitalized = pesosWords.charAt(0).toUpperCase() + pesosWords.slice(1)
  return `${capitalized} pesos and ${String(centavos).padStart(2, '0')}/100 only`
}
