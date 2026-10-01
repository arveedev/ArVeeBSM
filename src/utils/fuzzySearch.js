// Shared typo-tolerant "fuzzy contains" matcher for every search box in
// the app (Admin/Visitor Monitoring, Procurement tab, SDO transaction
// search, Customers admin panel, customer-name autocomplete suggestions,
// warehouse classifier-name suggestions) - per explicit request/idea,
// backed by bounded Levenshtein edit distance rather than a Trie: every
// one of these searches already re-filters a small, already-in-memory
// array on every keystroke (confirmed cheap in each site's own existing
// comments), so a Trie's real advantage - fast prefix lookup over a huge
// dataset - buys nothing here; a plain per-candidate distance check is
// simpler and just as fast at this scale.

// "Does `query` occur somewhere in `text`, allowing up to N edits?" -
// computed with a single O(query.length * text.length) DP pass (the
// standard "approximate substring matching" formulation: the first row
// is seeded with zeros so a match can start at ANY position in `text`,
// and the answer is the minimum of the last row so it can also END at
// any position) rather than manually sliding a fixed-size window across
// `text` and re-running a plain edit-distance check on each one, which
// is both slower and misses windows whose IDEAL length differs from
// `query`'s own length by more than whatever window range was tried.
const approxContainsDistance = (text, query) => {
  const n = text.length
  const m = query.length
  if (m === 0) return 0
  if (n === 0) return m
  let prev = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1)
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = query[i - 1] === text[j - 1] ? 0 : 1
      cur[j] = Math.min(
        prev[j] + 1, // delete from query
        cur[j - 1] + 1, // insert into query
        prev[j - 1] + cost // match/substitute
      )
    }
    prev = cur
  }
  return Math.min(...prev)
}

// How many typos to tolerate for a query of this length - short queries
// (a warehouse code, a couple of digits) get zero slack, since a typo
// there makes the match ambiguous rather than helpful; longer queries
// (a customer/farmer name) scale up gradually.
const allowedDistance = (queryLength) => {
  if (queryLength <= 3) return 0
  if (queryLength <= 6) return 1
  return 2
}

// Confirmed, reported real bug ("app-wide... when the user has already
// typed the exact name, series or etc, that exact match does not appear
// on top of the list, or... should be the only thing showing"): every
// search box in the app built on this file only ever FILTERED with a
// plain boolean (fuzzyContains/fuzzyMatchesAny below) - it never ranked
// what survived the filter, so the results stayed in whatever order the
// underlying array already had (insertion order, date order, alphabetical,
// ...), regardless of how well each one actually matched. Typing a full,
// exact name could leave it buried in the middle of a long list below a
// dozen looser partial matches.
//
// fuzzyMatchRank gives every match a relevance tier - 0 (exact) always
// beats 1 (starts with the query) always beats 2 (contains it as a plain
// substring) always beats 3 (typo-tolerant match only) - so a caller that
// stably sorts its already-filtered results by this number gets exact
// matches on top for free, with every other tier naturally grouped below
// it in the same relative order they were already in. fuzzyContains/
// fuzzyMatchesAny are now both defined in terms of this ranker (rank !==
// Infinity) instead of duplicating the same match logic, so every call
// site - whether it only needs a yes/no filter or wants to rank its
// results too - stays provably in sync with the exact same notion of
// "matches."
export const fuzzyMatchRank = (text, query) => {
  const t = (text ?? '').toString().toLowerCase()
  const q = (query ?? '').toString().trim().toLowerCase()
  if (!q) return 0
  if (t === q) return 0
  if (t.startsWith(q)) return 1
  if (t.includes(q)) return 2
  const maxDist = allowedDistance(q.length)
  if (maxDist > 0 && approxContainsDistance(t, q) <= maxDist) return 3
  return Infinity
}

/**
 * True if `text` contains `query`, tolerant of small typos. Always tries
 * a plain exact substring match first (the common case, and strictly
 * correct - never rejects a real match) before falling back to the
 * typo-tolerant check.
 */
export const fuzzyContains = (text, query) => fuzzyMatchRank(text, query) !== Infinity

/**
 * The BEST (lowest/most relevant) rank across every candidate field for
 * one record - Infinity if none match at all. A drop-in companion to
 * fuzzyMatchesAny for ranking instead of just filtering: a record whose
 * SERIAL NO. matches exactly ranks 0 even if its customer name is only a
 * loose fuzzy match, since any one field being an exact hit is what a
 * person searching by that field actually means.
 */
export const fuzzyMatchesAnyRank = (query, candidates) => {
  const q = (query ?? '').toString().trim()
  if (!q) return 0
  let best = Infinity
  for (const c of candidates) {
    if (c == null) continue
    const r = fuzzyMatchRank(String(c), q)
    if (r < best) best = r
  }
  return best
}

/**
 * True if `query` fuzzy-matches ANY of `candidates` (each coerced to a
 * string; nullish entries are skipped) - a drop-in replacement for a
 * chain of `.toLowerCase().includes(q)` checks across several fields.
 */
export const fuzzyMatchesAny = (query, candidates) => fuzzyMatchesAnyRank(query, candidates) !== Infinity

/**
 * Stably sorts `items` by their fuzzy-match rank (exact > starts-with >
 * contains > fuzzy), computed per item via `getRank`. Items that don't
 * match at all (rank === Infinity) are dropped, same as a `.filter` would
 * - this is meant to REPLACE a separate filter step, not follow one, so a
 * caller gets both the filtering and the relevance ordering from a single
 * pass. Ties keep their original relative order (Array.prototype.sort is
 * already stable in every engine this app targets), so within the same
 * tier nothing else about the existing order (date, alphabetical, ...)
 * is disturbed.
 */
export const sortByFuzzyRank = (items, getRank) => {
  return items
    .map((item, index) => ({ item, index, rank: getRank(item) }))
    .filter((x) => x.rank !== Infinity)
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((x) => x.item)
}

/**
 * Same relevance ordering as sortByFuzzyRank, but never drops anything -
 * a non-match (rank Infinity) sorts to the END instead of being removed.
 * For the handful of screens (Admin/Visitor Monitoring's AI/SIA, Milling,
 * NFA lists) that deliberately keep every row mounted while searching and
 * let a non-matching one shrink itself away via its own CSS animation
 * (ShrinkFilterRow) rather than being unmounted outright - reordering the
 * array those screens map() over still needs every row present, just in
 * relevance order, so the exact/best match rises to the top instead of
 * wherever the list's default sort (ref number, date, ...) happened to
 * put it.
 */
export const rankSortKeepingAll = (items, getRank) => {
  return items
    .map((item, index) => ({ item, index, rank: getRank(item) }))
    .sort((a, b) => {
      const ra = a.rank === Infinity ? Number.MAX_SAFE_INTEGER : a.rank
      const rb = b.rank === Infinity ? Number.MAX_SAFE_INTEGER : b.rank
      return (ra - rb) || (a.index - b.index)
    })
    .map((x) => x.item)
}
