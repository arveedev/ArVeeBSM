// SDO (Disbursing Officer) — Purchase Receipt computation helpers.
//
// Two explicit, non-negotiable rounding rules (confirmed directly, not
// a guess): Equivalent Net Weight is truncated (never rounded) to 4
// decimals; any peso amount (Basic Cost, Pricer Amount, Total Amount)
// is truncated (never rounded) to 2 decimals - "they don't round the
// paid amount, they drop the 3rd decimal."

/** Truncates (never rounds) `n` to `decimals` places. */
export const truncTo = (n, decimals) => {
  const f = 10 ** decimals
  return Math.floor((n + Number.EPSILON) * f) / f
}

export const truncKilos4 = (n) => truncTo(n, 4)
export const truncPeso2 = (n) => truncTo(n, 2)

/**
 * Finds the ENW factor row that applies to this Palay variety's own
 * fixed Purity letter / D&D bracket (set once, per variety, in the
 * Variety Types admin panel — confirmed: "we can set it by the variety
 * of the palay") at this specific WSR's own Moisture Content.
 * Boundary handling is inclusive on both ends of an MC bracket - admin-
 * entered brackets must not overlap, or the first matching row wins.
 */
export const lookupEnwFactor = (enwFactors, variety, mcValue) => {
  if (!variety || mcValue == null) return null
  const row = (enwFactors ?? []).find(
    (r) =>
      r.purityLetter === variety.purityLetter &&
      r.ddMin === variety.ddMin &&
      r.ddMax === variety.ddMax &&
      mcValue >= r.mcMin &&
      mcValue <= r.mcMax
  )
  return row?.factor ?? null
}

/** Equivalent Net Weight = Net Kilos × ENW factor, truncated to 4 decimals. */
export const computeEquivalentNetWeight = (netKilos, factor) => truncKilos4(netKilos * factor)

/** Basic Cost = Equivalent Net Weight × Unit Cost, truncated to 2 decimals. */
export const computeBasicCost = (enw, unitCost) => truncPeso2(enw * unitCost)

/** Pricer Amount = Equivalent Net Weight × Pricer Rate, truncated to 2 decimals. */
export const computePricerAmount = (enw, rate) => truncPeso2(enw * (rate || 0))

/**
 * The Buying Price active on `asOfDate` - the latest row whose
 * effectiveFrom is on or before that date, not necessarily today's
 * price. A PR for an older, backlogged WSR must use the price that was
 * actually in effect on the WSR's own date.
 */
export const resolveBuyingPrice = (buyingPrices, asOfDate) => {
  const applicable = (buyingPrices ?? [])
    .filter((p) => p.effectiveFrom <= asOfDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  return applicable[0] ?? null
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
 * of `activePrTotal` on its own.
 */
export const computeCashOnHand = (ledgerEntries, activePrTotals) => {
  const replenished = (ledgerEntries ?? [])
    .filter((e) => e.type === 'replenish')
    .reduce((s, e) => s + e.amount, 0)
  const liquidated = (ledgerEntries ?? [])
    .filter((e) => e.type === 'liquidate')
    .reduce((s, e) => s + e.amount, 0)
  const disbursed = (activePrTotals ?? []).reduce((s, amt) => s + amt, 0)
  return truncPeso2(replenished - liquidated - disbursed)
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
