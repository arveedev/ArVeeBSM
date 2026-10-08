// Inventory lots - READ-ONLY calculation behind the planned Daily Inventory /
// Age Monitoring reports (see docs/daily-inventory-age-monitoring-plan.md).
//
// Pure functions: they take plain arrays and return plain objects. Nothing in
// this file touches the database, so it cannot add, change or delete data.
//
// A "lot" is one receipt into one pile (a WSR, a beginning-balance line, or
// the receiving side of a WTS) with its own receipt date. Issues (WSI, the
// issuing side of a WTS) take from the OLDEST lot of the pile they were issued
// from. A transfer carries the lots' original dates to the destination pile.
//
// The same inclusion rules as pileLedger.computeHistoricalPileState apply:
//   - only Active transactions dated on or before `asOf`
//   - a beginning-balance seed always counts; any other transaction counts only
//     after the pile's warehouse Reports Start Date (or the global Data Start
//     Date, whichever is later)
//   - a pile closed on or before `asOf` holds nothing

import { effectiveCutoffDate } from './calculations.js'

// Same month length the Google Sheet age script uses.
export const DAYS_PER_MONTH = 30.44

const MONTH_INDEX = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

const toISO = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/**
 * Reads the free-text "Date Received / Date Procured" field and returns the
 * FIRST date it names as YYYY-MM-DD, or null when it can't be read.
 *   "MAR 24 TO APR 4, 2025" -> 2025-03-24 (first delivery)
 *   "AUGUST 17-18, 2026"    -> 2026-08-17
 *   "May, 2026"             -> 2026-05-01 (month only: the 1st)
 */
export const parseReceivedText = (text) => {
  if (!text || typeof text !== 'string') return null
  const s = text.toUpperCase()
  const years = [...s.matchAll(/\b((?:19|20)\d{2})\b/g)]
  if (years.length === 0) return null
  const year = Number(years[years.length - 1][1])

  const hits = [...s.matchAll(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?(?:\s+(\d{1,2})(?!\d))?/g)]
  if (hits.length === 0) return null
  const first = hits[0]
  const month = MONTH_INDEX[first[1]]
  const day = first[2] ? Number(first[2]) : 1
  // "DEC 28 TO JAN 3, 2026": the first date belongs to the year before the
  // one written at the end.
  const lastMonth = MONTH_INDEX[hits[hits.length - 1][1]]
  const y = hits.length > 1 && month > lastMonth ? year - 1 : year
  return toISO(y, month, day)
}

/** Age in months (30.44-day months) of a lot received on `fromISO`, as of `asOfISO`. */
export const lotAgeMonths = (fromISO, asOfISO) => {
  if (!fromISO || !asOfISO) return null
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${asOfISO.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, (b - a) / 86400000) / DAYS_PER_MONTH
}

const round3 = (n) => Math.round(n * 1000) / 1000

// Anchor sources - how a lot's age date was obtained. Lots anchored on
// 'pile-date' are approximate and are listed on the Check panel.
export const ANCHOR = { TRANSACTION: 'transaction', TEXT: 'text', PILE_DATE: 'pile-date' }

const seedAnchor = (tx, pile) => {
  const fromText = parseReceivedText(tx.dateProcured) ?? parseReceivedText(pile?.dateProcured)
  if (fromText) return { date: fromText, anchor: ANCHOR.TEXT }
  return { date: pile?.dateOfReceipt ?? tx.date, anchor: ANCHOR.PILE_DATE }
}

/**
 * @param {object} args
 * @param {object[]} args.piles
 * @param {object[]} args.transactions   any transactions; non-Active / other types are ignored
 * @param {object[]} args.warehouses
 * @param {string|null} args.globalDataStartDate
 * @param {string} args.asOf             YYYY-MM-DD, inclusive
 * @returns {Map<string, {lots: object[], shortBags: number, shortKilos: number}>} keyed by pileId
 */
const run = ({ piles, transactions, warehouses, globalDataStartDate = null, asOf }, movements) => {
  const pileById = new Map(piles.map((p) => [p.pileId, p]))
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const state = new Map(piles.map((p) => [p.pileId, { lots: [], shortBags: 0, shortKilos: 0 }]))

  const cutoffFor = (pileId) => {
    const wh = whById.get(pileById.get(pileId)?.warehouseId)
    return effectiveCutoffDate(wh?.reportingCutoffDate, globalDataStartDate)
  }
  const counts = (tx, pileId) => {
    if (!pileById.has(pileId) || tx.date > asOf) return false
    const cut = cutoffFor(pileId)
    return tx.isInitialBalance || !cut || tx.date > cut
  }

  // One event per transaction, ordered by date; on the same date receipts
  // come before issues, then by creation order. A beginning-balance seed is
  // the pile's OPENING stock, so it always goes first: a pile whose balance
  // was typed in after some of its issues were already dated (e.g. balance
  // entered Sep 22, issues dated Sep 3-9) must not report those issues as
  // shortages.
  const events = []
  for (const tx of transactions) {
    if (tx.status !== 'Active') continue
    if (tx.type === 'WSR' && tx.pileId && counts(tx, tx.pileId)) events.push({ rank: tx.isInitialBalance ? -1 : 0, tx })
    else if (tx.type === 'WSI' && tx.pileId && counts(tx, tx.pileId)) events.push({ rank: 1, tx })
    else if (tx.type === 'WTS' && tx.date <= asOf) events.push({ rank: 1, tx })
  }
  const when = (e) => (e.rank === -1 ? '' : e.tx.date)
  events.sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : a.rank - b.rank || (a.tx.createdAt ?? 0) - (b.tx.createdAt ?? 0)))

  // Takes `bags` from the oldest lots of a pile. Returns the lots taken
  // (portions, original dates kept) and records any shortfall.
  const take = (pileId, bags, kilos) => {
    const st = state.get(pileId)
    const taken = []
    let needBags = bags
    while (needBags > 1e-9 && st.lots.length > 0) {
      const lot = st.lots[0]
      const useBags = Math.min(lot.bags, needBags)
      // The issue's own recorded net kilos are split across the lots it
      // takes from, by bags, so total kilos always agree with the pile
      // ledger (a lot's weight is not assumed to be the average).
      const useKilos = bags > 0 ? kilos * (useBags / bags) : 0
      taken.push({ ...lot, bags: useBags, kilos: round3(useKilos) })
      lot.bags -= useBags
      lot.kilos = round3(lot.kilos - useKilos)
      needBags -= useBags
      if (lot.bags <= 1e-9) {
        st.lots.shift()
        // Whatever kilos are left over (either sign) move to the next
        // oldest lot, so nothing is lost or invented.
        if (st.lots.length > 0) st.lots[0].kilos = round3(st.lots[0].kilos + lot.kilos)
      }
    }
    if (needBags > 1e-9) { st.shortBags += needBags; st.shortKilos += bags > 0 ? kilos * (needBags / bags) : 0 }
    return taken
  }

  // Movement log (only when asked for): what each event added to / took
  // from a pile, with the original lot dates, for the daily ledger.
  const note = (kind, tx, pileId, portions, label) => {
    if (!movements) return
    for (const l of portions) {
      if (l.bags === 0 && l.kilos === 0) continue
      movements.push({
        date: tx.date, pileId, kind, label: label ?? null, typeId: tx.transactionTypeId ?? null,
        lotDate: l.date, varietyId: l.varietyId ?? null, bags: l.bags, kilos: l.kilos,
      })
    }
  }

  const addLot = (pileId, lot) => {
    const st = state.get(pileId)
    if (!st || !(lot.bags > 0 || lot.kilos > 0)) return
    // Kept oldest-first so issues always take the oldest lot, even when a
    // transfer puts older lots back behind newer ones.
    st.lots.push(lot)
    st.lots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }

  for (const { tx } of events) {
    if (tx.type === 'WSR') {
      const pile = pileById.get(tx.pileId)
      const a = tx.isInitialBalance ? seedAnchor(tx, pile) : { date: tx.date, anchor: ANCHOR.TRANSACTION }
      const lot = {
        lotId: tx.id, date: a.date, anchor: a.anchor, source: tx.isInitialBalance ? 'seed' : 'WSR',
        varietyId: tx.varietyId ?? pile?.varietyId ?? null,
        sackTypeId: tx.mtsSackTypeId ?? null, mtsCondition: tx.mtsCondition ?? null,
        bags: tx.numberOfBags ?? 0, kilos: tx.netKilos ?? 0,
      }
      addLot(tx.pileId, lot)
      note('add', tx, tx.pileId, [lot], tx.isInitialBalance ? 'BEGINNING BALANCE' : null)
    } else if (tx.type === 'WSI') {
      note('less', tx, tx.pileId, take(tx.pileId, tx.numberOfBags ?? 0, tx.netKilos ?? 0))
    } else if (tx.type === 'WTS') {
      const from = tx.issuedPileId
      const to = tx.receivedPileId
      const outCounts = from && counts(tx, from)
      const inCounts = to && counts(tx, to)
      const taken = outCounts ? take(from, tx.issuedBags ?? 0, tx.issuedNetKilos ?? 0) : []
      if (!inCounts) { note('less', tx, from, taken, 'TRANSFER'); continue }
      const recBags = tx.receivedBags ?? 0
      const recKilos = tx.receivedNetKilos ?? 0
      if (taken.length === 0) {
        // Nothing to carry (issuing side outside the report window or empty):
        // the received stock is dated at the transfer itself.
        const lot = {
          lotId: tx.id, date: tx.date, anchor: ANCHOR.TRANSACTION, source: 'WTS',
          varietyId: tx.receivedVarietyId ?? null, sackTypeId: tx.receivedSackTypeId ?? null,
          mtsCondition: tx.receivedCondition ?? null, bags: recBags, kilos: recKilos,
        }
        addLot(to, lot)
        note('add', tx, to, [lot], 'TRANSFER')
        continue
      }
      // Carry the original lot dates, scaled to what was actually received
      // (bags can change, e.g. rebagging 40 -> 21).
      const takenBags = taken.reduce((s, l) => s + l.bags, 0)
      const takenKilos = taken.reduce((s, l) => s + l.kilos, 0)
      const carried = taken.map((l) => ({
        ...l, source: 'WTS',
        varietyId: tx.receivedVarietyId ?? l.varietyId,
        sackTypeId: tx.receivedSackTypeId ?? l.sackTypeId,
        mtsCondition: tx.receivedCondition ?? l.mtsCondition,
        bags: takenBags > 0 ? (recBags * l.bags) / takenBags : 0,
        kilos: takenKilos > 0 ? round3((recKilos * l.kilos) / takenKilos) : 0,
      }))
      carried.forEach((l) => addLot(to, l))
      if (from === to) {
        // Same pile (repiling / rebagging): only the net change is a movement.
        note('less', tx, from, taken.map((l, i) => ({ ...l, bags: Math.max(0, l.bags - carried[i].bags), kilos: Math.max(0, round3(l.kilos - carried[i].kilos)) })), 'TRANSFER')
        note('add', tx, to, carried.map((l, i) => ({ ...l, bags: Math.max(0, l.bags - taken[i].bags), kilos: Math.max(0, round3(l.kilos - taken[i].kilos)) })), 'TRANSFER')
      } else {
        note('less', tx, from, taken, 'TRANSFER')
        note('add', tx, to, carried, 'TRANSFER')
      }
    }
  }

  // A pile closed on or before asOf holds nothing (closePile zeroes it).
  for (const [pileId, st] of state) {
    const closed = pileById.get(pileId)?.closedDate
    if (closed && asOf >= closed) st.lots = []
  }
  return state
}

export const buildLots = (args) => run(args, null)

/** Same as buildLots, plus the dated movement log (adds and issues, with lot dates). */
export const buildLotsDetailed = (args) => {
  const movements = []
  const state = run(args, movements)
  return { state, movements }
}

/** Total bags / kilos left in a pile's lots. */
export const sumLots = (lots) => ({
  bags: lots.reduce((s, l) => s + l.bags, 0),
  kilos: round3(lots.reduce((s, l) => s + l.kilos, 0)),
})
