// Milling and Issuances (Stock Desk, Admin only) - READ-ONLY, pure functions.
//
// Every figure is in net bags (net kilos / 50). Issuances are taken from the AUTHORITIES (what the authority
// authorizes), never from the WSI documents, and are counted in the period
// the authority is dated. Recoveries are the rice WSRs of milling (no by-products).
//  - Milling (private millers): authorities of a milling transaction type (MILLING, REMILLING, TEST MILLING, ...)
//    that do not belong to an NFA-owned ricemill; recoveries are the rice WSRs of milling (an MO / TMO number or
//    a milling transaction type) that did not come from an NFA-owned ricemill.
//  - NFA-owned: the ricemill processes a fixed amount of palay every day it hands out rice (100 net bags, or the daily
//    input set in Admin > Miller Allocations). On a day when the rice it handed out is under 60% of that input it
//    only processed half (50 bags). Those daily amounts are the issuances; the rice the ricemill hands out (TRANSFER
//    authorities of that Regional Authority Number, rice only) are its recoveries. Milling authorities of an
//    NFA-owned ricemill are NOT counted as issuances (the daily amounts replace them).
//  - Issuances to LGU: authorities of type SALES whose customer name contains "LGU".
//  - Issuances to FTI: authorities of type SALES (CONSIGNMENT).
// A warehouse's reporting start (override) date is respected like everywhere else.

import { effectiveCutoffDate, dedupeAuthoritiesByRef } from './calculations.js'
import { millerKey } from './millingLiquidation.js'

const NET_BAG_KG = 50
// NFA-owned ricemill: bags processed per day, and the rule for a poor day (owner, 2026-10-20)
export const NFA_DAILY_BAGS_DEFAULT = 100
export const NFA_LOW_RECOVERY_PCT = 60
export const NFA_LOW_RECOVERY_FACTOR = 0.5
const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

export const netBags = (kilos) => (kilos ?? 0) / NET_BAG_KG

export const buildMillingIssuances = ({ transactions, authorities, warehouses, provinces, varieties, transactionTypes = [], ricemillAllocations = [], globalDataStartDate = null, from, to, filters = {} }) => {
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const provById = new Map(provinces.map((p) => [p.provinceId, p]))
  const varById = new Map(varieties.map((v) => [v.varietyId, v]))
  const typeName = new Map(transactionTypes.map((t) => [t.transactionTypeId, norm(t.name)]))
  const nfaRans = new Set(ricemillAllocations.map((r) => r.regionalAuthorityNumber))
  const capacityOf = new Map(ricemillAllocations.map((r) => [r.regionalAuthorityNumber, r.millingInputCapacityBags > 0 ? r.millingInputCapacityBags : NFA_DAILY_BAGS_DEFAULT]))
  const inCutoff = (wh, date) => { const cut = effectiveCutoffDate(wh?.reportingCutoffDate, globalDataStartDate); return !(cut && date <= cut) }
  // Filter and sort (Stock Desk): a province, a set of warehouses, a ricemill / customer. Applied to every row, so the
  // per-province totals and the copied text follow it. `customers` lists every customer before filtering.
  // (the same miller is written several ways: Borromeo Ricemill, BORROMEO RM; they count as one)
  const customers = new Map()
  const keep = (row, warehouseId) => {
    if (row.customer) {
      const k = millerKey(row.customer)
      const names = customers.get(k) ?? []
      names.push(row.customer)
      customers.set(k, names)
    }
    if (filters.provinceId && whById.get(warehouseId)?.provinceId !== filters.provinceId) return false
    if (filters.warehouseIds && !filters.warehouseIds.has(warehouseId)) return false
    if (filters.customer && millerKey(row.customer) !== filters.customer) return false
    return true
  }
  const place = (warehouseId) => {
    const wh = whById.get(warehouseId)
    return { wh, province: provById.get(wh?.provinceId)?.name ?? 'No province', warehouse: wh?.name ?? '' }
  }

  // recoveries: one row per WSR, rice only
  const recoveries = []
  for (const t of transactions) {
    if (t.status !== 'Active' || t.type !== 'WSR' || t.isInitialBalance) continue
    if (t.date < from || t.date > to || varById.get(t.varietyId)?.category !== 'Rice') continue
    if (!(t.moNumber || t.tmoNumber || typeName.get(t.transactionTypeId)?.includes('MILLING'))) continue
    const pl = place(t.warehouseId)
    if (!inCutoff(pl.wh, t.date)) continue
    const row = {
      id: t.id, date: t.date, serialNo: t.serialNo ?? '', province: pl.province, warehouse: pl.warehouse, customer: t.customerName ?? '',
      moNo: t.moNumber ?? t.tmoNumber ?? '', variety: varById.get(t.varietyId)?.name ?? '', kilos: t.netKilos ?? 0, bags: netBags(t.netKilos),
    }
    if (keep(row, t.warehouseId)) recoveries.push(row)
  }

  // issuances: one row per authority, by the authority's own figures
  const milling = []
  const nfa = []
  const nfaRecoveries = []
  const nfaOut = [] // every rice hand-out of an NFA-owned ricemill in the period, before any filter (a day's recovery is judged on all of it)
  const lgu = []
  const fti = []
  for (const a of dedupeAuthoritiesByRef((authorities ?? []).filter((x) => x.type === 'AI'))) {
    if (!a.date || a.date < from || a.date > to) continue
    const pl = place(a.assignedWarehouse)
    if (!inCutoff(pl.wh, a.date)) continue
    const alloc = a.totalAllocationKilos || (a.totalAllocationBags ?? 0) * NET_BAG_KG
    const issued = a.totalIssuedKilos ?? 0
    // exactly what the authority authorizes (even when it was marked complete with nothing issued, and whatever the
    // slips issued against it weigh); an authority with no authorized amount falls back to what it issued
    const kilos = alloc > 0 ? alloc : issued
    if (!(kilos > 0)) continue
    const type = norm(a.transactionTypeName)
    const row = {
      id: a.authId ?? a.aiNumber, date: a.date, aiNumber: a.aiNumber ?? '', province: pl.province, warehouse: pl.warehouse, customer: a.customerName ?? '',
      kilos, bags: netBags(kilos), withdrawn: netBags(issued), ran: a.regionalAuthorityNumber ?? '', note: a.note1 ?? '', source: a.sourceWarehouse ?? '',
    }
    const isNfa = nfaRans.has(a.regionalAuthorityNumber)
    let target = null
    if (type.includes('MILLING')) target = isNfa ? null : milling
    else if (isNfa && type === 'TRANSFER' && varById.get(a.varietyId)?.category === 'Rice') {
      target = nfaRecoveries
      nfaOut.push({ ran: a.regionalAuthorityNumber, date: a.date, bags: row.bags, warehouseId: a.assignedWarehouse })
    }
    else if (type === 'SALES' && /LGU/i.test(a.customerName ?? '')) target = lgu
    else if (type === 'SALES (CONSIGNMENT)') target = fti
    if (target && keep(row, a.assignedWarehouse)) target.push(row)
  }

  // NFA-owned issuances: one row per ricemill day = the daily input, or half of it when that day's rice is under 60% of the input
  const days = new Map()
  for (const o of nfaOut) {
    const k = `${o.ran}|${o.date}`
    const d = days.get(k) ?? { ran: o.ran, date: o.date, rice: 0, warehouseId: o.warehouseId }
    d.rice += o.bags
    days.set(k, d)
  }
  for (const d of days.values()) {
    const capacity = capacityOf.get(d.ran) ?? NFA_DAILY_BAGS_DEFAULT
    const pct = capacity > 0 ? (d.rice / capacity) * 100 : 0
    const low = pct < NFA_LOW_RECOVERY_PCT
    const bags = low ? capacity * NFA_LOW_RECOVERY_FACTOR : capacity
    const pl = place(d.warehouseId)
    const row = {
      id: `mill-day-${d.ran}-${d.date}`, date: d.date, aiNumber: 'MILL DAY', province: pl.province, warehouse: pl.warehouse,
      customer: `${bags.toLocaleString('en-US', { maximumFractionDigits: 2 })} bags${low ? ` only (rice out ${d.rice.toLocaleString('en-US', { maximumFractionDigits: 2 })} bags = ${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%, under ${NFA_LOW_RECOVERY_PCT}%)` : ` (rice out ${d.rice.toLocaleString('en-US', { maximumFractionDigits: 2 })} bags = ${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%)`}`,
      kilos: bags * NET_BAG_KG, bags, withdrawn: 0, ran: d.ran, derived: true,
    }
    if (keep(row, d.warehouseId)) nfa.push(row)
  }

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : natural(a.aiNumber ?? a.serialNo, b.aiNumber ?? b.serialNo))
  for (const l of [milling, recoveries, nfa, nfaRecoveries, lgu, fti]) l.sort(byDate)

  const perProvince = (lists) => {
    const m = new Map()
    for (const [key, list] of Object.entries(lists)) {
      for (const r of list) {
        const e = m.get(r.province) ?? { province: r.province }
        e[key] = (e[key] ?? 0) + r.bags
        m.set(r.province, e)
      }
    }
    return [...m.values()].sort((a, b) => natural(a.province, b.province))
  }
  const sum = (list) => list.reduce((s, r) => s + r.bags, 0)
  const group = (issues, recs) => ({
    perProvince: perProvince({ issued: issues, recovered: recs }), issuedTotal: sum(issues), recoveredTotal: sum(recs), issues, recoveries: recs,
  })

  return {
    milling: group(milling, recoveries),
    nfa: group(nfa, nfaRecoveries),
    lgu: { perProvince: perProvince({ bags: lgu }), total: sum(lgu), rows: lgu },
    fti: { perProvince: perProvince({ bags: fti }), total: sum(fti), rows: fti },
    // per province (for the pasted text, every province is listed, even with nothing)
    customers: [...customers].map(([key, names]) => ({ key, name: names.find((n) => /rice\s*mill/i.test(n) && n !== n.toUpperCase()) ?? names[0] })).sort((a, b) => natural(a.name, b.name)),
    provinces: provinces.map((p) => ({ name: p.name, code: p.code ?? p.name })).sort((a, b) => natural(a.code, b.code)),
  }
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const periodLabel = (from, to) => {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  if (from === to) return `${MONTH_ABBR[fm - 1]} ${fd}`
  if (fy === ty && fm === tm) return `${MONTH_ABBR[fm - 1]} ${fd}-${td}`
  return `${MONTH_ABBR[fm - 1]} ${fd} - ${MONTH_ABBR[tm - 1]} ${td}`
}
const num = (n) => (Math.round((n ?? 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })

/** The main values only (no lists), as plain text for pasting into a chat. */
export const issuancesText = (data, from, to) => {
  const byProv = (rows, key) => data.provinces.map((p) => `${p.code} - ${num(rows.find((r) => r.province === p.name)?.[key])}`)
  const { milling, nfa, lgu, fti } = data
  return [
    'Milling per Province',
    '',
    periodLabel(from, to),
    'MILLING',
    `ISSUANCE - ${num(milling.issuedTotal)}`,
    `RECOVERIES - ${num(milling.recoveredTotal)}`,
    '',
    'NFA-OWNED',
    `ISSUANCE - ${num(nfa.issuedTotal)}`,
    `RECOVERIES - ${num(nfa.recoveredTotal)}`,
    '',
    'ISSUANCE TO LGU',
    ...byProv(lgu.perProvince, 'bags'),
    '',
    'ISSUANCE TO FTI',
    ...byProv(fti.perProvince, 'bags'),
    '',
  ].join('\n')
}

/**
 * Milling per ricemill: for each ricemill the net bags issued to it (its milling authorities) and the net bags of
 * rice recovered from it (its milling WSRs), plus the recovery %. Different spellings of one miller (Borromeo
 * Ricemill, BORROMEO RM) are one row. The NFA-owned ricemill follows, grouped by authority (Regional Authority Number). Follows the report's period and
 * filters because it is built from the same data.
 */
export const perRicemill = (data) => {
  const m = new Map()
  const row = (r) => {
    const key = millerKey(r.customer)
    if (!m.has(key)) m.set(key, { key, names: [], issued: 0, recovered: 0 })
    const e = m.get(key)
    if (r.customer) e.names.push(r.customer)
    return e
  }
  for (const r of data.milling.issues) row(r).issued += r.bags
  for (const r of data.milling.recoveries) row(r).recovered += r.bags
  const rows = [...m.values()].map((e) => ({
    key: e.key,
    name: e.names.find((n) => /rice\s*mill/i.test(n) && n !== n.toUpperCase()) ?? e.names[0] ?? '(no name)',
    issued: e.issued, recovered: e.recovered, pct: e.issued > 0 ? (e.recovered / e.issued) * 100 : null,
  })).sort((a, b) => natural(a.name, b.name))
  // the NFA-owned ricemill, grouped by authority (its Regional Authority Number)
  const g = new Map()
  const grp = (ran) => { if (!g.has(ran)) g.set(ran, { key: `nfa-${ran}`, name: ran || 'No Regional Authority Number', issued: 0, recovered: 0 }); return g.get(ran) }
  for (const r of data.nfa.issues) grp(r.ran ?? '').issued += r.bags
  for (const r of data.nfa.recoveries) grp(r.ran ?? '').recovered += r.bags
  const nfaRows = [...g.values()].sort((a, b) => natural(a.name, b.name)).map((r) => ({ ...r, pct: r.issued > 0 ? (r.recovered / r.issued) * 100 : null }))
  const subtotal = (list) => {
    const issued = list.reduce((s, r) => s + r.issued, 0)
    const recovered = list.reduce((s, r) => s + r.recovered, 0)
    return { issued, recovered, pct: issued > 0 ? (recovered / issued) * 100 : null }
  }
  const privateTotal = subtotal(rows)
  const nfaTotal = subtotal(nfaRows)
  return { rows, nfaRows, privateTotal, nfaTotal, total: subtotal([...rows, ...nfaRows]) }
}
