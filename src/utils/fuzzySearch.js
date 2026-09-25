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

/**
 * True if `text` contains `query`, tolerant of small typos. Always tries
 * a plain exact substring match first (the common case, and strictly
 * correct - never rejects a real match) before falling back to the
 * typo-tolerant check.
 */
export const fuzzyContains = (text, query) => {
  const t = (text ?? '').toString().toLowerCase()
  const q = (query ?? '').toString().trim().toLowerCase()
  if (!q) return true
  if (t.includes(q)) return true
  const maxDist = allowedDistance(q.length)
  if (maxDist === 0) return false
  return approxContainsDistance(t, q) <= maxDist
}

/**
 * True if `query` fuzzy-matches ANY of `candidates` (each coerced to a
 * string; nullish entries are skipped) - a drop-in replacement for a
 * chain of `.toLowerCase().includes(q)` checks across several fields.
 */
export const fuzzyMatchesAny = (query, candidates) => {
  const q = (query ?? '').toString().trim()
  if (!q) return true
  return candidates.some((c) => c != null && fuzzyContains(String(c), q))
}
