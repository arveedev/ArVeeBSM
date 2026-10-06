// Total CPF history - one snapshot per UPDATE, for the Admin/Visitor Monitoring
// "Total CPF" history view.
//
// An update is any of: a cash ledger entry (replenishment / liquidation, voided
// ones excluded) or a Cash in Bank update. After each one, the snapshot shows
// every SDO's Cash on Hand grouped by province (with a province subtotal), then
// the Cash in Bank, then the Total CPF - the same figure Total CPF - All SDOs
// shows today, computed with the same computeCashOnHand, only "as of" that update.
//
// Cash in Bank is a single value saved in place, so the app only has its history
// from the moment it started keeping one (reportConfig.cashOnBankHistory); before
// that only the current value exists. A snapshot older than the first known Cash
// in Bank value shows it as not recorded (0).

import { computeCashOnHand } from './sdoCalculations.js'

// (date, createdAt) ordering key; a missing createdAt sorts as the end of its day
// for purchase receipts (so a same-day PR counts) and as 0 for ledger entries.
const after = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1])

const UNASSIGNED_PROVINCE = 'No province'

/** The province an SDO is grouped under: their priority warehouse's, else the most common among their warehouses. */
export const sdoProvinceName = (user, warehouseById, provinceById) => {
  const provinceOf = (wid) => provinceById.get(warehouseById.get(wid)?.provinceId)?.name
  const priority = provinceOf(user.priorityWarehouseId)
  if (priority) return priority
  const counts = new Map()
  for (const wid of user.assignedWarehouses ?? []) {
    const name = provinceOf(wid)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return best ? best[0] : UNASSIGNED_PROVINCE
}

/** Cash in Bank updates as [{at (ISO), amount, by}], oldest first, including the current value when no history exists yet. */
export const bankHistoryOf = (config) => {
  const list = [...(config?.cashOnBankHistory ?? [])]
  if (list.length === 0 && config?.cashOnBankUpdatedAt) {
    list.push({ at: config.cashOnBankUpdatedAt, amount: config.cashOnBank ?? 0, by: config.cashOnBankUpdatedBy })
  }
  return list.sort((a, b) => (a.at < b.at ? -1 : 1))
}

export const buildCpfHistory = ({ sdoUsers, ledger, activePrs, config, warehouses, provinces }) => {
  const warehouseById = new Map((warehouses ?? []).map((w) => [w.warehouseId, w]))
  const provinceById = new Map((provinces ?? []).map((p) => [p.provinceId, p]))
  const sdoName = (uid) => sdoUsers.find((u) => u.uid === uid)?.name ?? 'Unknown SDO'
  const liveLedger = (ledger ?? []).filter((e) => !e.voided)
  const bank = bankHistoryOf(config)

  const ledgerKey = (e) => [e.date ?? '', e.createdAt ?? 0]
  const prKey = (pr) => [pr.date ?? '', pr.createdAt ?? Number.MAX_SAFE_INTEGER]
  const bankKey = (b) => [String(b.at).slice(0, 10), Date.parse(b.at) || 0]

  const events = [
    ...liveLedger.map((e) => ({
      kind: 'ledger', key: ledgerKey(e), date: e.date,
      title: `${e.type === 'replenish' ? 'Replenishment' : 'Liquidation'} — ${sdoName(e.sdoUid)}`,
      amount: e.type === 'replenish' ? (e.amount ?? 0) : -(e.amount ?? 0),
      detail: [e.refNo && e.refNo !== 'Opening balance' ? `Ref ${e.refNo}` : e.refNo, e.dvNo ? `DV ${e.dvNo}` : ''].filter(Boolean).join(' · '),
    })),
    ...bank.map((b) => ({
      kind: 'bank', key: bankKey(b), date: String(b.at).slice(0, 10),
      title: 'Cash in Bank updated', amount: null, detail: b.by ? `by ${b.by}` : '',
    })),
  ]

  const snapshotAt = (key) => {
    const byProvince = new Map()
    for (const u of sdoUsers) {
      const myLedger = liveLedger.filter((e) => e.sdoUid === u.uid && !after(ledgerKey(e), key))
      const myPrs = (activePrs ?? []).filter((pr) => pr.sdoUid === u.uid && !after(prKey(pr), key))
      const cash = computeCashOnHand(myLedger, myPrs)
      const province = sdoProvinceName(u, warehouseById, provinceById)
      if (!byProvince.has(province)) byProvince.set(province, [])
      byProvince.get(province).push({ uid: u.uid, name: u.name || u.accessCode || 'Unnamed SDO', cash })
    }
    const provincesOut = [...byProvince.entries()]
      .map(([name, sdos]) => ({
        name,
        sdos: sdos.sort((a, b) => a.name.localeCompare(b.name)),
        subtotal: Math.round(sdos.reduce((s, x) => s + x.cash, 0) * 100) / 100,
      }))
      .sort((a, b) => (a.name === UNASSIGNED_PROVINCE) - (b.name === UNASSIGNED_PROVINCE) || a.name.localeCompare(b.name))
    const bankNow = [...bank].reverse().find((b) => !after(bankKey(b), key))
    const cashInBank = bankNow ? bankNow.amount ?? 0 : null
    const total = Math.round((provincesOut.reduce((s, p) => s + p.subtotal, 0) + (cashInBank ?? 0)) * 100) / 100
    return { provinces: provincesOut, cashInBank, total }
  }

  return events
    .sort((a, b) => (after(a.key, b.key) ? -1 : after(b.key, a.key) ? 1 : 0))
    .map((e, i) => ({ ...e, id: `${e.kind}-${i}`, snapshot: snapshotAt(e.key) }))
}
