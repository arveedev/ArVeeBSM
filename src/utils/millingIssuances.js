// Milling and Issuances (Stock Desk, Admin only) - READ-ONLY, pure functions.
//
// Three groups, every figure in net bags (net kilos / 50) and totalled per province. Issuances are taken
// from the AUTHORITIES (what the authority authorizes, or what it issued once complete), never from the
// WSI documents, and are counted in the period the authority is dated:
//  - Milling: authorities of a milling transaction type (MILLING, REMILLING, TEST MILLING, ...), listed per
//    authority, and the rice recovered from milling (WSR with an MO / TMO number, listed per WSR; rice only,
//    no by-products).
//  - Issuances to LGU: authorities of type SALES whose customer name contains "LGU".
//  - Issuances to FTI: authorities of type SALES (CONSIGNMENT).
// A warehouse's reporting start (override) date is respected like everywhere else.

import { effectiveCutoffDate, dedupeAuthoritiesByRef, isAuthorityComplete } from './calculations.js'

const NET_BAG_KG = 50
const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

export const netBags = (kilos) => (kilos ?? 0) / NET_BAG_KG

export const buildMillingIssuances = ({ transactions, authorities, warehouses, provinces, varieties, globalDataStartDate = null, from, to }) => {
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const provById = new Map(provinces.map((p) => [p.provinceId, p]))
  const varById = new Map(varieties.map((v) => [v.varietyId, v]))
  const inCutoff = (wh, date) => { const cut = effectiveCutoffDate(wh?.reportingCutoffDate, globalDataStartDate); return !(cut && date <= cut) }
  const place = (warehouseId) => {
    const wh = whById.get(warehouseId)
    return { wh, province: provById.get(wh?.provinceId)?.name ?? 'No province', warehouse: wh?.name ?? '' }
  }

  // recoveries: one row per WSR, rice only
  const recoveries = []
  for (const t of transactions) {
    if (t.status !== 'Active' || t.type !== 'WSR' || t.isInitialBalance || !(t.moNumber || t.tmoNumber)) continue
    if (t.date < from || t.date > to || varById.get(t.varietyId)?.category !== 'Rice') continue
    const pl = place(t.warehouseId)
    if (!inCutoff(pl.wh, t.date)) continue
    recoveries.push({
      id: t.id, date: t.date, serialNo: t.serialNo ?? '', province: pl.province, warehouse: pl.warehouse, customer: t.customerName ?? '',
      moNo: t.moNumber ?? t.tmoNumber ?? '', variety: varById.get(t.varietyId)?.name ?? '', kilos: t.netKilos ?? 0, bags: netBags(t.netKilos),
    })
  }

  // issuances: one row per authority, by the authority's own figures
  const milling = []
  const lgu = []
  const fti = []
  for (const a of dedupeAuthoritiesByRef((authorities ?? []).filter((x) => x.type === 'AI'))) {
    if (!a.date || a.date < from || a.date > to) continue
    const pl = place(a.assignedWarehouse)
    if (!inCutoff(pl.wh, a.date)) continue
    const alloc = a.totalAllocationKilos || (a.totalAllocationBags ?? 0) * NET_BAG_KG
    const issued = a.totalIssuedKilos ?? 0
    const kilos = isAuthorityComplete(a) ? issued : Math.max(alloc, issued)
    if (!(kilos > 0)) continue
    const type = norm(a.transactionTypeName)
    const row = {
      id: a.authId ?? a.aiNumber, date: a.date, aiNumber: a.aiNumber ?? '', province: pl.province, warehouse: pl.warehouse, customer: a.customerName ?? '',
      kilos, bags: netBags(kilos), withdrawn: netBags(issued),
    }
    if (type.includes('MILLING')) milling.push(row)
    else if (type === 'SALES' && /LGU/i.test(a.customerName ?? '')) lgu.push(row)
    else if (type === 'SALES (CONSIGNMENT)') fti.push(row)
  }

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : natural(a.aiNumber ?? a.serialNo, b.aiNumber ?? b.serialNo))
  for (const l of [milling, recoveries, lgu, fti]) l.sort(byDate)

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

  return {
    milling: { perProvince: perProvince({ issued: milling, recovered: recoveries }), issuedTotal: sum(milling), recoveredTotal: sum(recoveries), issues: milling, recoveries },
    lgu: { perProvince: perProvince({ bags: lgu }), total: sum(lgu), rows: lgu },
    fti: { perProvince: perProvince({ bags: fti }), total: sum(fti), rows: fti },
  }
}
