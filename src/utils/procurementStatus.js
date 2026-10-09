// Daily Procurement Status Report - READ-ONLY, pure functions (no database).
//
// Per day of a month: net bags (kilos / 50) procured, split PD (dry palay) and
// PW (wet palay) by the FIRST TWO LETTERS of the variety name, per province and
// for the whole branch, with the CPF balance at the end of that day, and a
// subtotal row after every week (Monday to Sunday) plus a month total.
//
// CPF balance of a province = the sum of its SDOs' Cash on Hand (as already
// computed for the Total CPF history) plus, for ONE chosen province, the Cash
// in Bank. Branch CPF = the sum over provinces.

import { effectiveCutoffDate } from './calculations.js'

const NET_BAG_KG = 50
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th']
const round2 = (n) => Math.round(n * 100) / 100

const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}` }
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const weekdayMonFirst = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0

/** "PD1s-A" -> "PD", "PW1-B" -> "PW", anything else -> null. */
export const palayGroup = (varietyName) => {
  const two = String(varietyName ?? '').slice(0, 2).toUpperCase()
  return two === 'PD' || two === 'PW' ? two : null
}

/** Months (YYYY-MM) from the data start month up to the current month, newest first. */
export const monthOptions = (dataStartDate, todayISO) => {
  const start = (dataStartDate ?? todayISO).slice(0, 7)
  const out = []
  let [y, m] = todayISO.slice(0, 7).split('-').map(Number)
  for (let i = 0; i < 36; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key <= start) break
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return out
}
export const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}` }

/** CPF snapshot (province subtotals + cash in bank) in force at the end of `day`. cpfEvents are newest first. */
const snapshotAt = (cpfEvents, day) => cpfEvents.find((e) => (e.date ?? '') <= day)?.snapshot ?? null

export const buildProcurementStatus = ({
  transactions, warehouses, provinces, varieties, transactionTypes, globalDataStartDate = null,
  cpfEvents = [], month, todayISO, bankProvinceName = null, branchName = 'ALBAY BRANCH', startISO = null,
}) => {
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const provById = new Map(provinces.map((p) => [p.provinceId, p]))
  const varName = new Map(varieties.map((v) => [v.varietyId, v.name]))
  const varCategory = new Map(varieties.map((v) => [v.varietyId, v.category]))
  const typeName = new Map(transactionTypes.map((t) => [t.transactionTypeId, t.name]))
  const provNames = [...provinces].map((p) => p.name).sort((a, b) => a.localeCompare(b))

  // the first day shown is never before the data start date (the day after it)
  const monthFirst = `${month}-01`
  const first = startISO && startISO > monthFirst ? startISO : monthFirst
  const [y, m] = month.split('-').map(Number)
  const lastOfMonth = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  const last = lastOfMonth < todayISO ? lastOfMonth : todayISO

  // kilos per day -> province -> PD/PW
  const byDay = new Map()
  for (const t of transactions) {
    if (t.type !== 'WSR' || t.status !== 'Active' || t.isInitialBalance) continue
    if (t.date < first || t.date > last) continue
    if (typeName.get(t.transactionTypeId) !== 'PROCUREMENT') continue
    if (varCategory.get(t.varietyId) !== 'Palay') continue
    const g = palayGroup(varName.get(t.varietyId))
    if (!g) continue
    const wh = whById.get(t.warehouseId)
    const cut = effectiveCutoffDate(wh?.reportingCutoffDate, globalDataStartDate)
    if (cut && t.date <= cut) continue
    const prov = provById.get(wh?.provinceId)?.name
    if (!prov) continue
    let day = byDay.get(t.date)
    if (!day) { day = new Map(); byDay.set(t.date, day) }
    const cell = day.get(prov) ?? { PD: 0, PW: 0 }
    cell[g] += (t.netKilos ?? 0) / NET_BAG_KG
    day.set(prov, cell)
  }

  const cpfOf = (day, prov) => {
    const snap = snapshotAt(cpfEvents, day)
    if (!snap) return null
    const p = snap.provinces.find((x) => x.name === prov)
    return round2((p?.subtotal ?? 0) + (bankProvinceName === prov ? (snap.cashInBank ?? 0) : 0))
  }

  // rows
  const days = []
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const per = provNames.map((name) => {
      const c = byDay.get(d)?.get(name) ?? { PD: 0, PW: 0 }
      return { PD: c.PD, PW: c.PW, cpf: cpfOf(d, name) }
    })
    days.push({ date: d, per })
  }

  const sum = (rows) => provNames.map((_, i) => ({
    PD: rows.reduce((s, r) => s + r.per[i].PD, 0), PW: rows.reduce((s, r) => s + r.per[i].PW, 0), cpf: null,
  }))

  const lines = []
  let weekRows = []
  let weekNo = 0
  const flush = () => {
    if (weekRows.length === 0) return
    lines.push({ kind: 'week', label: `${ORDINAL[weekNo - 1] ?? `${weekNo}th`} Week`, per: sum(weekRows) })
    weekRows = []
  }
  for (const d of days) {
    if (weekRows.length === 0 || weekdayMonFirst(d.date) === 0) {
      if (weekRows.length > 0) flush()
      weekNo += 1
    }
    lines.push({ kind: 'row', label: longDate(d.date), per: d.per, date: d.date })
    weekRows.push(d)
  }
  flush()
  if (days.length > 0) lines.push({ kind: 'total', label: 'TOTAL', per: sum(days) })

  // -------- model (table) --------
  const groups = [...provNames, branchName.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')]
  const head = [
    [{ t: 'DATE', span: 1 }, ...groups.map((g, i) => ({ t: g, span: 4, tone: i % 2 }))],
    [{ t: '', span: 1 }, ...groups.flatMap((_, i) => ['PD', 'PW', 'TOTAL', 'CPF BALANCE'].map((t) => ({ t, span: 1, tone: i % 2 })))],
  ]
  const edges = []
  const tones = []
  groups.forEach((_, gi) => { for (let k = 0; k < 4; k++) { edges.push(k === 0 && gi > 0 ? 'wh' : null); tones.push(gi % 2) } })

  const cells = (per) => {
    const out = []
    let bd = 0; let bw = 0; let bc = null
    per.forEach((c) => {
      out.push(c.PD || null, c.PW || null, c.PD + c.PW, c.cpf)
      bd += c.PD; bw += c.PW; if (c.cpf != null) bc = (bc ?? 0) + c.cpf
    })
    out.push(bd || null, bw || null, bd + bw, bc)
    return out.map((v) => (v == null ? null : round2(v)))
  }
  const rows = lines.map((l) => ({ kind: l.kind === 'row' ? 'row' : l.kind, first: l.label, cells: cells(l.per), dash: false, zeroTotal: true }))
  const model = {
    title: 'DAILY PROCUREMENT STATUS REPORT',
    subtitle: `(in bags of 50kg) · Month: ${MONTHS[m - 1]} ${y} · PD = dry palay, PW = wet palay`,
    head, edges, tones, rows, empty: days.length === 0 ? 'This month has not started yet.' : null,
  }

  // -------- cards (phones) --------
  const cards = lines.map((l) => ({
    kind: l.kind, label: l.label,
    groups: [...provNames, 'Branch'].map((name, gi) => {
      const c = gi < provNames.length ? l.per[gi] : {
        PD: l.per.reduce((s, x) => s + x.PD, 0), PW: l.per.reduce((s, x) => s + x.PW, 0),
        cpf: l.per.every((x) => x.cpf == null) ? null : l.per.reduce((s, x) => s + (x.cpf ?? 0), 0),
      }
      return { name, pd: round2(c.PD), pw: round2(c.PW), total: round2(c.PD + c.PW), cpf: c.cpf == null ? null : round2(c.cpf) }
    }),
  }))
  return { model, cards, provinces: provNames }
}
