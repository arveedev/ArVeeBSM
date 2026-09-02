// Stock already authorized via an active AI (Authority to Issue) but not
// yet actually withdrawn (no matching WSI/WTS issued against it yet)
// still physically sits in the warehouse's live pile totals - but it's
// already committed to leave. Without surfacing this, a user seeing
// "1000 bags" on hand could issue an AI for 500 more, not knowing 800 of
// those 1000 are already spoken for by an earlier, not-yet-withdrawn
// authority. This computes, per warehouse per variety, how many bags/
// kilos remain authorized-but-unwithdrawn, so "actual minus unwithdrawn"
// gives the true available/potential stock.
//
// Scoped to AI/WSI/WTS (bags+kilos) only - SIA/ESI tracks sack PIECES,
// a different unit that doesn't roll into a bags/kilos "net bags" figure.

import { db } from '../db/dexie.js'
import { isAuthorityComplete, AGE_BUCKETS, isBagRepackingTypeName, effectiveCutoffDate } from './calculations.js'

export const UNSPECIFIED_AGE = 'Unspecified Age'

// Best-effort: pulls a representative day-count out of an AI's free-text
// ageGroup field (the Sheet's repurposed "Note3"/"Age Group" column,
// e.g. "0-6 months", ">12 months", "6.1-12") so it can run through the
// exact same AGE_BUCKETS test() functions used for pile age, instead of
// maintaining a second parallel bucket definition. ageGroup is
// unenforced free text (AI only, never set on SIA) - returns null for
// anything blank or unparseable, which callers should treat as its own
// "unspecified" bucket rather than guessing.
const ageGroupToDays = (ageGroup) => {
  if (!ageGroup) return null
  const s = String(ageGroup).toLowerCase()
  const openEnded = s.match(/(\d+(?:\.\d+)?)\s*\+|>\s*(\d+(?:\.\d+)?)/)
  if (openEnded) return Math.round(Number(openEnded[1] ?? openEnded[2]) * 30) + 1
  const range = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/)
  if (range) return Math.round(((Number(range[1]) + Number(range[2])) / 2) * 30)
  const single = s.match(/(\d+(?:\.\d+)?)/)
  return single ? Math.round(Number(single[1]) * 30) : null
}

// Resolves one authority's own age bucket label for a given category -
// shared by the category-wide rollup below and by getUnwithdrawnDetail's
// optional bucket filter, so both use the exact same resolution logic
// and can never disagree with each other about which bucket an
// authority belongs to.
const resolveAuthorityBucketLabel = (authority, category) => {
  const days = ageGroupToDays(authority.ageGroup)
  const buckets = AGE_BUCKETS[category] ?? AGE_BUCKETS.Rice
  const bucket = days != null ? buckets.find((b) => b.test(days)) : null
  return bucket?.label ?? UNSPECIFIED_AGE
}

// Every WSI/WTS actually withdrawn against one AI so far, plus the totals.
const withdrawalsForAuthority = async (aiNumber) => {
  const withdrawals = await db.transactions
    .where('aiNumber').equals(aiNumber)
    .and((t) => t.status === 'Active' && (t.type === 'WSI' || t.type === 'WTS'))
    .toArray()

  const withdrawnBags = withdrawals.reduce(
    (s, t) => s + (t.type === 'WSI' ? (t.numberOfBags ?? 0) : (t.issuedBags ?? 0)), 0
  )
  const withdrawnKilos = withdrawals.reduce(
    (s, t) => s + (t.type === 'WSI' ? (t.netKilos ?? 0) : (t.issuedNetKilos ?? 0)), 0
  )

  return { withdrawals, withdrawnBags, withdrawnKilos }
}

// Excludes an authority dated on or before the warehouse's
// reportingCutoffDate from unwithdrawn/potential-inventory math - same
// rule as everywhere else the cutoff applies. An authority itself is
// NOT hidden from the Authority Monitor by this (that's a separate,
// intentional distinction - a warehouse manager still needs to see and
// act on an old outstanding authority), only excluded from the numbers
// that assume its allocated stock is still part of "actual" - which it
// isn't once that stock's own pre-cutoff history stops being counted.
const activeAiAuthoritiesFor = async (warehouseId, varietyIds) => {
  const varietySet = varietyIds ? new Set(varietyIds) : null
  const [warehouse, globalConfig] = await Promise.all([db.warehouses.get(warehouseId), db.reportConfig.get('global')])
  const reportingCutoffDate = effectiveCutoffDate(warehouse?.reportingCutoffDate, globalConfig?.dataStartDate)
  return db.authorities
    .where('assignedWarehouse').equals(warehouseId)
    .and((a) => a.type === 'AI' && Boolean(a.varietyId) && !isAuthorityComplete(a)
      && (!varietySet || varietySet.has(a.varietyId))
      && (!reportingCutoffDate || !a.date || a.date > reportingCutoffDate))
    .toArray()
}

export const computeUnwithdrawnByVariety = async (warehouseId) => {
  if (!warehouseId) return new Map()

  const authorities = await activeAiAuthoritiesFor(warehouseId)
  const result = new Map() // varietyId -> { bags, kilos }

  for (const a of authorities) {
    const { withdrawnBags, withdrawnKilos } = await withdrawalsForAuthority(a.aiNumber)
    const unwithdrawnBags = Math.max(0, (a.totalAllocationBags ?? 0) - withdrawnBags)
    const unwithdrawnKilos = Math.max(0, (a.totalAllocationKilos ?? 0) - withdrawnKilos)
    if (unwithdrawnBags <= 0 && unwithdrawnKilos <= 0) continue

    const cur = result.get(a.varietyId) ?? { bags: 0, kilos: 0 }
    result.set(a.varietyId, { bags: cur.bags + unwithdrawnBags, kilos: cur.kilos + unwithdrawnKilos })
  }

  return result
}

// An authority carries totalAllocationBags and totalAllocationKilos as
// two SEPARATE, independently-typed fields from the Sheet - normally
// bags x 50 = kilos, but a Sheet typo on either one can leave them
// disagreeing on the same real authority. A small gap is completely
// normal (real bags don't all weigh exactly 50kg), which is why every
// "Net Bags" figure elsewhere in this app is deliberately always
// derived from kilos rather than trusting the separately-typed bags
// field - but a LARGE gap (more than this tolerance) stops looking like
// ordinary bag-weight variance and starts looking like one of the two
// fields is just wrong. Flagged rather than silently trusted either
// way, so a user sees the two disagree and can go check the real AI
// record instead of unknowingly relying on whichever number their
// current Bags/Net Bags toggle happens to read from.
const BAGS_KILOS_MISMATCH_TOLERANCE = 0.05 // 5%
// transactionTypeName is optional (older/other callers may not have it) -
// a FILLERS/REBAGGING/BAGGING/RECLASSIFICATION authority is EXPECTED to
// carry bags with zero (or near-zero) matching kilos, confirmed directly
// - repacking bags is a real bag-count change that doesn't move kilos,
// not a data-entry error, so it's never flagged.
export const bagsKilosMismatch = (bags, kilos, transactionTypeName = null) => {
  if (isBagRepackingTypeName(transactionTypeName)) return false
  const bagsFromKilos = kilos / 50
  if (bagsFromKilos <= 0) return bags > 0
  return Math.abs(bags - bagsFromKilos) / bagsFromKilos > BAGS_KILOS_MISMATCH_TOLERANCE
}

// Per-authority breakdown (allocated/withdrawn/unwithdrawn, plus every
// WSI/WTS document that contributed to "withdrawn") for one or more
// varieties in one warehouse - the drill-down behind an "unwithdrawn"
// badge, so a user can see exactly which AI(s) and which documents
// produced that number instead of just the rolled-up total.
// bucketFilter, when passed as { category, label }, restricts the
// result to only authorities whose OWN ageGroup resolves to that exact
// bucket (via resolveAuthorityBucketLabel) - used for the per-age-group
// drill-down on HomeStocks.jsx, so that modal shows genuinely bucket-
// specific authorities/documents instead of the same full-variety list
// regardless of which bucket was tapped.
export const getUnwithdrawnDetail = async (warehouseId, varietyIds, bucketFilter) => {
  if (!warehouseId) return []

  const authorities = await activeAiAuthoritiesFor(warehouseId, varietyIds)
  const detail = []

  for (const a of authorities) {
    if (bucketFilter && resolveAuthorityBucketLabel(a, bucketFilter.category) !== bucketFilter.label) continue
    const { withdrawals, withdrawnBags, withdrawnKilos } = await withdrawalsForAuthority(a.aiNumber)
    const unwithdrawnBags = Math.max(0, (a.totalAllocationBags ?? 0) - withdrawnBags)
    const unwithdrawnKilos = Math.max(0, (a.totalAllocationKilos ?? 0) - withdrawnKilos)
    if (unwithdrawnBags <= 0 && unwithdrawnKilos <= 0) continue

    detail.push({
      authority: a,
      allocatedBags: a.totalAllocationBags ?? 0,
      allocatedKilos: a.totalAllocationKilos ?? 0,
      withdrawnBags,
      withdrawnKilos,
      unwithdrawnBags,
      unwithdrawnKilos,
      hasBagsKilosMismatch: bagsKilosMismatch(a.totalAllocationBags ?? 0, a.totalAllocationKilos ?? 0, a.transactionTypeName),
      withdrawals: [...withdrawals].sort((x, y) => (x.date < y.date ? -1 : 1)),
    })
  }

  return detail.sort((x, y) => (x.authority.aiNumber ?? '').localeCompare(y.authority.aiNumber ?? ''))
}

// Per warehouse, per cereal category, per age bucket: unwithdrawn net
// bags - powers AdminHomeStocks.jsx's "Age Grouping" tab showing
// potential (actual minus unwithdrawn) instead of raw actual inventory.
// An authority whose ageGroup can't be resolved to a specific bucket
// lands under UNSPECIFIED_AGE - callers should subtract that only from
// a row/grand TOTAL, never attribute it to one specific age column,
// since which bucket it actually belongs to is genuinely unknown.
export const computeUnwithdrawnByCategoryAge = async (warehouseId, varietyCategoryMap) => {
  const result = new Map() // category -> Map(bucketLabel -> netBags)
  if (!warehouseId) return result

  const authorities = await activeAiAuthoritiesFor(warehouseId)

  for (const a of authorities) {
    const category = varietyCategoryMap?.get(a.varietyId) ?? 'Unknown'
    const { withdrawnKilos } = await withdrawalsForAuthority(a.aiNumber)
    const unwithdrawnKilos = Math.max(0, (a.totalAllocationKilos ?? 0) - withdrawnKilos)
    if (unwithdrawnKilos <= 0) continue

    const label = resolveAuthorityBucketLabel(a, category)

    if (!result.has(category)) result.set(category, new Map())
    const catMap = result.get(category)
    catMap.set(label, (catMap.get(label) ?? 0) + unwithdrawnKilos / 50)
  }

  return result
}

// Per warehouse, per VARIETY (not just category), per age bucket:
// unwithdrawn bags+kilos - powers HomeStocks.jsx's per-age-group
// unwithdrawn figures. computeUnwithdrawnByCategoryAge above rolls up
// every variety in a category together, which isn't precise enough
// once a category has more than one variety in play; this keeps them
// separate. Same UNSPECIFIED_AGE handling - an authority whose
// ageGroup can't be resolved is excluded from every specific bucket
// (only ever reflected in computeUnwithdrawnByVariety's plain total),
// not attributed to a bucket it may not actually belong to.
export const computeUnwithdrawnByVarietyAge = async (warehouseId, varietyCategoryMap) => {
  const result = new Map() // varietyId -> Map(bucketLabel -> { bags, kilos })
  if (!warehouseId) return result

  const authorities = await activeAiAuthoritiesFor(warehouseId)

  for (const a of authorities) {
    if (!a.varietyId) continue
    const category = varietyCategoryMap?.get(a.varietyId) ?? 'Unknown'
    const { withdrawnBags, withdrawnKilos } = await withdrawalsForAuthority(a.aiNumber)
    const unwithdrawnBags = Math.max(0, (a.totalAllocationBags ?? 0) - withdrawnBags)
    const unwithdrawnKilos = Math.max(0, (a.totalAllocationKilos ?? 0) - withdrawnKilos)
    if (unwithdrawnBags <= 0 && unwithdrawnKilos <= 0) continue

    const label = resolveAuthorityBucketLabel(a, category)
    if (label === UNSPECIFIED_AGE) continue

    if (!result.has(a.varietyId)) result.set(a.varietyId, new Map())
    const varietyMap = result.get(a.varietyId)
    const cur = varietyMap.get(label) ?? { bags: 0, kilos: 0 }
    varietyMap.set(label, { bags: cur.bags + unwithdrawnBags, kilos: cur.kilos + unwithdrawnKilos })
  }

  return result
}
