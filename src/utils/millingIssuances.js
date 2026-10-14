// Milling and Issuances (Stock Desk, Admin only) - READ-ONLY, pure functions.
//
// Every figure is in net bags (net kilos / 50). Issuances are taken from the AUTHORITIES (what the authority
// authorizes), never from the WSI documents, and are counted in the period
// the authority is dated. Recoveries are the rice WSRs of milling (no by-products).
//  - Milling (private millers): authorities of a milling transaction type (MILLING, REMILLING, TEST MILLING, ...)
//    that do not belong to an NFA-owned ricemill; recoveries are the rice WSRs of milling (an MO / TMO number or
//    a milling transaction type) that did not come from an NFA-owned ricemill.
//  - NFA-owned: milling authorities whose Regional Authority Number is set up for an NFA-owned ricemill
//    (Admin > Miller Allocations) are the issuances; the rice the ricemill hands out (TRANSFER authorities of
//    that Regional Authority Number, rice only) are its recoveries - both from the authorities.
//  - Issuances to LGU: authorities of type SALES whose customer name contains "LGU".
//  - Issuances to FTI: authorities of type SALES (CONSIGNMENT).
// A warehouse's reporting start (override) date is respected like everywhere else.

import { effectiveCutoffDate, dedupeAuthoritiesByRef } from './calculations.js'
import { millerKey } from './millingLiquidation.js'

const NET_BAG_KG = 50
const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

export const netBags = (kilos) => (kilos ?? 0) / NET_BAG_KG

export const buildMillingIssuances = ({ transactions, authorities, warehouses, provinces, varieties, transactionTypes = [], ricemillAllocations = [], globalDataStartDate = null, from, to, filters = {} }) => {
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const provById = new Map(provinces.map((p) => [p.provinceId, p]))
  const varById = new Map(varieties.map((v) => [v.varietyId, v]))
  const typeName = new Map(transactionTypes.map((t) => [t.transactionTypeId, norm(t.name)]))
  const nfaRans = new Set(ricemillAllocations.map((r) => r.regionalAuthorityNumber))
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
  const lgu = []
  const fti = []
  for (const a of dedupeAuthoritiesByRef((authorities ?? []).filter((x) => x.type === 'AI'))) {
    if (!a.date || a.date < from || a.date > to) continue
    const pl = place(a.assignedWarehouse)
    if (!inCutoff(pl.wh, a.date)) continue
    const alloc = a.totalAllocationKilos || (a.totalAllocationBags ?? 0) * NET_BAG_KG
    const issued = a.totalIssuedKilos ?? 0
    // what the authority authorizes, even when it was marked complete with nothing issued
    const kilos = Math.max(alloc, issued)
    if (!(kilos > 0)) continue
    const type = norm(a.transactionTypeName)
    const row = {
      id: a.authId ?? a.aiNumber, date: a.date, aiNumber: a.aiNumber ?? '', province: pl.province, warehouse: pl.warehouse, customer: a.customerName ?? '',
      kilos, bags: netBags(kilos), withdrawn: netBags(issued),
    }
    const isNfa = nfaRans.has(a.regionalAuthorityNumber)
    let target = null
    if (type.includes('MILLING')) target = isNfa ? nfa : milling
    else if (isNfa && type === 'TRANSFER' && varById.get(a.varietyId)?.category === 'Rice') target = nfaRecoveries
    else if (type === 'SALES' && /LGU/i.test(a.customerName ?? '')) target = lgu
    else if (type === 'SALES (CONSIGNMENT)') target = fti
    if (target && keep(row, a.assignedWarehouse)) target.push(row)
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
