// Core calculation utilities — see PRDD Section 4 for formula definitions.
// All decimal values are rounded to 2 places to avoid floating-point drift.

/**
 * Net Kilos = Gross Kilos - MTS
 * (Section 4.1)
 */
export const calculateNetKilos = (grossKilos, mts) => {
  return parseFloat((Number(grossKilos) - Number(mts)).toFixed(3))
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
/**
 * Today's date as YYYY-MM-DD in the LOCAL timezone. Deliberately not
 * new Date().toISOString().slice(0, 10) - toISOString() always returns
 * UTC, which is the wrong calendar day for any positive-UTC-offset
 * timezone (e.g. Philippines, UTC+8) during early morning local hours,
 * when the local date has already advanced but UTC hasn't yet. This was
 * a real, confirmed bug: a pile's dateOfReceipt computed this way could
 * end up one day in the past, adding a spurious +1 day to its age via
 * calculateCurrentAge and pushing it into the wrong age bucket.
 */
export const todayLocalISO = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Today minus N days, as a local-timezone ISO date - used when a
 * manual age correction should back-date the anchor (dateOfReceipt)
 * rather than resetting it to today, so "Date Received" keeps reading
 * as a real date the age counts from instead of always showing today.
 */
export const localISODaysAgo = (days) => {
  const d = new Date()
  d.setDate(d.getDate() - Math.round(days || 0))
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Common reporting-period presets (1-7, 8-15, 16-22, 23-end of month)
 * for a given month, plus a human-readable label for that month.
 * monthOffset: 0 = current month, -1 = previous month, etc. - lets the
 * caller navigate to a different month rather than assuming "current",
 * which breaks when a report is filed a few days into the next month
 * for a period that already completed.
 */
export const getPeriodPresetRanges = (monthOffset = 0) => {
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const year = base.getFullYear()
  const month = base.getMonth()
  const lastDay = new Date(year, month + 1, 0).getDate()
  const pad = (n) => String(n).padStart(2, '0')
  const iso = (day) => `${year}-${pad(month + 1)}-${pad(day)}`

  return {
    monthLabel: `${MONTH_NAMES[month]} ${year}`,
    ranges: [
      { label: '1–7', from: iso(1), to: iso(7) },
      { label: '8–15', from: iso(8), to: iso(15) },
      { label: '16–22', from: iso(16), to: iso(22) },
      { label: `23–${lastDay}`, from: iso(23), to: iso(lastDay) },
    ],
  }
}

/**
 * Sensible default month offset for the presets above - if within the
 * first few days of a new month, defaults to the PREVIOUS month (a
 * delayed report is more likely for the period that just completed
 * than for a month that's barely started); otherwise the current month.
 */
export const getDefaultPresetMonthOffset = () => (new Date().getDate() <= 5 ? -1 : 0)

export const normalizeAgeToDays = (value, unit) => {
  const num = Number(value) || 0
  return unit === 'Months' ? Math.round(num * 30) : Math.round(num)
}

/**
 * Current Age (Days) = Base Initial Age + (System Date - Date of Receipt)
 * If autoAgeMonitoring is false, the manual base value is returned unchanged.
 * (Section 4.2)
 */
export const calculateCurrentAge = (baseInitialAge, dateOfReceipt, autoAgeMonitoring, asOfDate = new Date()) => {
  if (!autoAgeMonitoring) return baseInitialAge

  const receipt = new Date(dateOfReceipt)
  const today = new Date(asOfDate)

  receipt.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)

  const elapsedDays = Math.floor((today - receipt) / (1000 * 60 * 60 * 24))

  return baseInitialAge + elapsedDays
}

/**
 * Formats a raw day count as "X days" when 30 or under, or "X month(s),
 * Y day(s)" once it exceeds 30 - e.g. 35 -> "1 month, 5 days", matching
 * the confirmed example. Months are a flat 30-day unit (not calendar
 * months, which vary), consistent with how age is already tracked
 * elsewhere in this app as a plain day count.
 */
export const fmtAge = (days) => {
  if (days == null) return '—'
  const n = Math.round(days)
  if (n <= 30) return `${n} day${n === 1 ? '' : 's'}`
  const months = Math.floor(n / 30)
  const remainingDays = n % 30
  const monthPart = `${months} month${months === 1 ? '' : 's'}`
  if (remainingDays === 0) return monthPart
  return `${monthPart}, ${remainingDays} day${remainingDays === 1 ? '' : 's'}`
}

/**
 * Picks the same unit fmtAge would display for a given day count, so an
 * edit form can show age in whatever unit actually matches - "Days" at
 * 30 or under, "Months" for a clean multiple of 30, "Months + Days"
 * otherwise. Returns enough to populate either a single value+unit pair
 * or a separate months/days pair.
 */
export const bestAgeUnit = (days) => {
  const n = Math.round(days ?? 0)
  if (n <= 30) return { unit: 'Days', value: n, months: 0, days: n }
  const months = Math.floor(n / 30)
  const remainingDays = n % 30
  if (remainingDays === 0) return { unit: 'Months', value: months, months, days: 0 }
  return { unit: 'Months + Days', value: n, months, days: remainingDays }
}

/**
 * Authority balance + status (Section 4.3), generalized to operate on
 * whichever unit (kilos or bags) the allocation was actually defined in —
 * Phase 5: AI/SIA can be bags-only, kilos-only, or both.
 */
export const calculateAuthorityStatus = (totalAllocation, totalIssued) => {
  // A zero allocation (not just a missing one) must also bail out to
  // status: null, not fall through to the balance math below - 0 - 0
  // computes a balanceRemaining of 0, which the "within tolerance"
  // check just below reads as genuinely Complete. That misclassified
  // a blank/zero-allocation authority as naturally complete, which in
  // turn hid the manual "mark as pending" option for one that was only
  // ever complete because a user manually flagged it - there was
  // nothing "natural" about it since it never had a real allocation to
  // fulfill in the first place.
  if (totalAllocation === null || totalAllocation === undefined || totalAllocation === '' || Number(totalAllocation) === 0) {
    return { balanceRemaining: null, status: null }
  }

  const balanceRemaining = parseFloat(
    (Number(totalAllocation) - Number(totalIssued ?? 0)).toFixed(2)
  )

  // A tiny overage (within 0.01) is treated as Complete rather than
  // Over-Issued - this tolerates small rounding differences rather
  // than leaving an authority that's functionally fully issued stuck
  // looking like an outstanding problem state. A more substantial
  // overage still correctly shows as Over-Issued.
  const OVERAGE_TOLERANCE = 0.01
  let status = 'Pending'
  if (balanceRemaining >= -OVERAGE_TOLERANCE && balanceRemaining <= 0) status = 'Complete'
  else if (balanceRemaining < -OVERAGE_TOLERANCE) status = 'Over-Issued'

  return { balanceRemaining, status }
}

/**
 * Whether an authority is genuinely, factually complete based on real
 * document data - independent of the manuallyCompleted override flag.
 * AI (and any legacy single-value SIA record) checks its own top-level
 * allocation/issued pair. A SIA with a sackLines array is only naturally
 * complete when EVERY line in it is fully issued - one line still
 * pending means the whole SIA is still pending, since it represents one
 * real-world authorization document.
 */
export const isAuthorityNaturallyComplete = (authority) => {
  if (authority.type === 'SIA' && Array.isArray(authority.sackLines)) {
    if (authority.sackLines.length === 0) return false
    return authority.sackLines.every((line) => {
      const { status } = calculateAuthorityStatus(line.totalAllocationBags, line.totalIssuedBags)
      return status === 'Complete'
    })
  }
  const { status } = calculateAuthorityStatus(
    authority.totalAllocationKilos ?? authority.totalAllocationBags,
    authority.totalIssuedKilos ?? authority.totalIssuedBags
  )
  return status === 'Complete'
}

/**
 * Whether an authority should be treated as complete for filtering
 * purposes (pending list vs completed list) - true if either manually
 * flagged or naturally complete per the above.
 */
export const isAuthorityComplete = (authority) => {
  if (authority.manuallyCompleted) return true
  return isAuthorityNaturallyComplete(authority)
}

/**
 * Every extra detail field an authority might carry, as an ordered
 * list of { label, value } pairs, skipping any that are blank/null.
 * These are synced from the Sheet (OR No., Remarks, Age Group, Note1,
 * Note2 for AI; Remarks for SIA) but were previously never actually
 * shown anywhere in the app despite being stored - used to render a
 * consistent "extra details" line across every authority display.
 */
export const authorityExtraDetails = (a) => {
  const details = []
  if (a.ageGroup) details.push({ label: 'Age Group', value: a.ageGroup })
  if (a.orNumber) details.push({ label: 'OR No.', value: a.orNumber })
  if (a.note1) details.push({ label: 'Note', value: a.note1 })
  if (a.note2) details.push({ label: 'Note', value: a.note2 })
  if (a.remarks) details.push({ label: 'Remarks', value: a.remarks })
  return details
}

// ── Number formatting utilities ───────────────────────────────────────────────
// Consistent comma-separated formatting used throughout the app: forms,
/**
 * Wet/dry palay detection - per explicit example, "PD1-A" is dry
 * palay and "PW1-A" is wet palay: the distinguishing letter (W or D)
 * sits immediately after the first character of the variety code.
 * Only meaningful for Palay cereal type - Rice and By Products don't
 * have a wet/dry distinction.
 */
export const getPalayMoistureState = (varietyCode, cerealType) => {
  if (cerealType !== 'Palay' || !varietyCode) return null
  const marker = varietyCode.trim()[1]?.toUpperCase()
  if (marker === 'W') return 'wet'
  if (marker === 'D') return 'dry'
  return null
}

/**
 * Matches a transaction type name against every recognized Milling
 * variant, case-insensitively - "MILLING", "Milling", "REMILLING" all
 * count. Confirmed: Remilling works exactly the same as Milling, just
 * a different name for the same operation.
 */
export const isMillingTypeName = (name) => {
  if (!name) return false
  const normalized = name.trim().toUpperCase()
  return normalized === 'MILLING' || normalized === 'REMILLING'
}

/**
 * Same as isMillingTypeName, for Test Milling / Test Re-Milling.
 */
export const isTestMillingTypeName = (name) => {
  if (!name) return false
  const normalized = name.trim().toUpperCase()
  return normalized === 'TEST MILLING' || normalized === 'TEST RE-MILLING'
}

/**
 * Same reasoning and pattern as isMillingTypeName/isTestMillingTypeName
 * above - transaction type names in the actual data are all-caps
 * (e.g. "PROCUREMENT"), which never matched a hardcoded exact-case
 * 'Procurement' comparison, silently hiding the RSBSA/Farmer
 * Organization fields entirely.
 */
export const isProcurementTypeName = (name) => (name ?? '').trim().toUpperCase() === 'PROCUREMENT'

export const isSalesTypeName = (name) => (name ?? '').trim().toUpperCase() === 'SALES'

// Home, Admin Home, Reports, and exported PDFs.

/** Formats a whole-number bag/piece count with comma separators. 7581 → "7,581" */
export const fmtBags = (n) => {
  if (n == null) return '—'
  return Math.round(Number(n)).toLocaleString('en-PH')
}

/** Formats kilos with commas and 2 decimal places. 427309.97 → "427,309.97" */
export const fmtKilos = (n) => {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

/** Formats net bags (kilos/50) with commas and 2 decimal places. */
export const fmtNetBags = (n) => {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Formats a net-kilos value in the user's preferred unit ('kg' or 'mt').
 * Takes the unit as a plain parameter rather than reading it from context
 * directly, so the same function works in React components (which pass
 * the value from useSettings()) and in the PDF generator (which is not a
 * component and cannot use hooks - the unit is passed in at export time
 * instead). Metric tons shown with 3 decimal places (1 MT = 1000 kg).
 */
export const fmtWeight = (kilos, unit = 'kg', label = '') => {
  if (kilos == null) return '—'
  if (unit === 'mt') {
    const mtLabel = label ? `${label} MT` : 'MT'
    return `${Number(kilos / 1000).toLocaleString('en-PH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${mtLabel}`
  }
  const kgLabel = label ? `${label} Kgs` : 'kg'
  return `${fmtKilos(kilos)} ${kgLabel}`
}

/** Strips commas/non-numeric chars (keeps one decimal point) for parsing a formatted display string. */
export const stripFormatting = (str) => String(str ?? '').replace(/,/g, '')

/** Parses a potentially comma-formatted number string to float. Returns 0 if invalid. */
export const parseFormattedNumber = (str) => parseFloat(stripFormatting(str)) || 0

/**
 * Live-formats a number input string as the user types: strips existing
 * commas, re-inserts them at the correct thousand positions, preserves a
 * trailing decimal point and partial decimal digits so typing isn't
 * disrupted mid-entry (e.g. "1234.5" while still typing the second
 * decimal digit doesn't get prematurely rounded).
 */
/**
 * Live-formats a number input string as the user types: strips existing
 * commas, re-inserts them at the correct thousand positions, preserves a
 * trailing decimal point and partial decimal digits so typing isn't
 * disrupted mid-entry (e.g. "1234.5" while still typing the second
 * decimal digit doesn't get prematurely rounded).
 *
 * decimalPlaces defaults to 2 (matches most fields: bags, kilos, MC%,
 * age). Fields needing finer precision (e.g. sack weight-by-condition,
 * which needs values like 0.095 or 0.102) can pass 3 explicitly.
 */
export const liveFormatNumber = (rawValue, decimalPlaces = 2) => {
  if (rawValue === '' || rawValue == null) return ''
  const cleaned = stripFormatting(rawValue).replace(/[^0-9.]/g, '')
  const parts = cleaned.split('.')
  const intPart = parts[0].replace(/^0+(?=\d)/, '') || '0'
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (parts.length > 1) {
    return `${formattedInt}.${parts[1].slice(0, decimalPlaces)}`
  }
  return cleaned.endsWith('.') ? `${formattedInt}.` : formattedInt
}

// Age buckets used by both AdminHome (per province/warehouse) and Home
// (per warehouse, per variety) for grouping pile stock by age.
export const AGE_BUCKETS = {
  Rice: [
    { label: '0-3 months', test: (d) => d <= 90 },
    { label: '>3 months', test: (d) => d > 90 },
  ],
  Palay: [
    { label: '0-6 months', test: (d) => d <= 180 },
    { label: '6.1-12 months', test: (d) => d > 180 && d <= 365 },
    { label: '>12 months', test: (d) => d > 365 },
  ],
  // Previously missing entirely - CATEGORIES already included 'By
  // Products' from an earlier session, but this table never got a
  // matching entry, causing a crash (AGE_BUCKETS['By Products'] was
  // undefined) once real By Products pile data existed to trigger
  // this render path. Using the same brackets as Rice as a reasonable
  // default - adjust if different age thresholds are wanted
  // specifically for By Products.
  'By Products': [
    { label: '0-3 months', test: (d) => d <= 90 },
    { label: '>3 months', test: (d) => d > 90 },
  ],
}

// Formats an ISO date string (YYYY-MM-DD) as MMDDYY for use in exported
// filenames - e.g. "2026-06-01" -> "060126".
export const fmtDateForFilename = (isoDate) => {
  if (!isoDate) return ''
  const [year, month, day] = isoDate.split('-')
  return `${month}${day}${year.slice(2)}`
}

// Strips whitespace from a warehouse name for use in exported filenames
// - e.g. "ALB-TABACO GID" -> "ALB-TABACOGID". Case is left as-is; only
// spaces are removed, since filenames shouldn't contain raw spaces.
export const sanitizeForFilename = (name) => (name ?? '').replace(/\s+/g, '')
