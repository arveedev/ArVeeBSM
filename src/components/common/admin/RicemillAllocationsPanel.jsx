// NFA Ricemill Allocations - admin sets the total net kg authorized by
// the regional office, per Regional Authority Number. This is the
// ONLY reference NFA-owned Ricemills use - no MO/TMO tracking, per
// the confirmed "different rule" for this facility type.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { fmtWeight, fmtBags, liveFormatNumber, parseFormattedNumber, isMillingTypeName, isTestMillingTypeName } from '../../../utils/calculations.js'
import { useSettings } from '../../../context/SettingsContext.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, listItemClass, editIconClass, deleteIconClass, byAlpha } from './shared.js'

function RicemillAllocationsPanel() {
  const { weightUnit } = useSettings() ?? {}
  const [regionalAuthorityNumber, setRegionalAuthorityNumber] = useState('')
  const [totalNetKgs, setTotalNetKgs] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [expandedNumber, setExpandedNumber] = useState(null)

  const allocations = useLiveQuery(() => db.ricemillAllocations.toArray(), []) ?? []
  const sortedAllocations = [...allocations].sort((a, b) => byAlpha(a.regionalAuthorityNumber, b.regionalAuthorityNumber))

  // Actual usage - net kg moved through Ricemill-type warehouses under
  // this Regional Authority Number, so the admin can see allocation vs
  // actual side by side.
  //
  // "Used" is specifically the WSI issuance to the mill, under an AI
  // with transaction type Milling/Remilling/Test Milling/Test
  // Remilling - confirmed as the one step that actually draws against
  // the Regional Authority allocation. Everything else in the full
  // flow (MPO III receiving stock, receiving the recovery back,
  // transferring it onward) is the same physical stock moving through
  // custody, not additional usage of the authorization - summing
  // every WSR/WSI together (the previous approach) would have counted
  // the same stock multiple times across its different legs.
  const usageByNumber = useLiveQuery(async () => {
    const ricemillWarehouses = await db.warehouses.where('facilityType').equals('Ricemill').toArray()
    const ricemillIds = ricemillWarehouses.map((w) => w.warehouseId)
    if (ricemillIds.length === 0) return new Map()

    const authorities = await db.authorities.where('type').equals('AI').toArray()
    const millingAuthorities = authorities.filter((a) =>
      a.regionalAuthorityNumber && (isMillingTypeName(a.transactionTypeName) || isTestMillingTypeName(a.transactionTypeName))
    )
    if (millingAuthorities.length === 0) return new Map()
    const regionalNumByAiNumber = new Map(millingAuthorities.map((a) => [a.aiNumber, a.regionalAuthorityNumber]))

    const tx = await db.transactions
      .where('warehouseId').anyOf(ricemillIds)
      .and((t) => t.status === 'Active' && t.type === 'WSI' && regionalNumByAiNumber.has(t.aiNumber))
      .toArray()

    const usage = new Map()
    for (const t of tx) {
      const regionalNum = regionalNumByAiNumber.get(t.aiNumber)
      usage.set(regionalNum, (usage.get(regionalNum) ?? 0) + (t.netKilos ?? 0))
    }
    return usage
  }, []) ?? new Map()

  // Recovery% detail, per Regional Authority Number - for each actual
  // Milling/Remilling/Test Milling/Test Remilling issuance, finds the
  // matching recovery receipt (linked via linkedDocNo, the same field
  // fixed earlier for the Weekly Receipts report) and computes
  // recovery% as recovered kilos over issued kilos. Separate from
  // usageByNumber above (which tracks allocation vs total activity) -
  // this is specifically about how much came BACK out of what went IN
  // to the mill.
  const millingDetailsByNumber = useLiveQuery(async () => {
    const ricemillWarehouses = await db.warehouses.where('facilityType').equals('Ricemill').toArray()
    if (ricemillWarehouses.length === 0) return new Map()
    const ricemillIds = ricemillWarehouses.map((w) => w.warehouseId)

    const authorities = await db.authorities.where('type').equals('AI').toArray()
    const millingAuthorities = authorities.filter((a) =>
      a.regionalAuthorityNumber && (isMillingTypeName(a.transactionTypeName) || isTestMillingTypeName(a.transactionTypeName))
    )
    if (millingAuthorities.length === 0) return new Map()

    const warehouseTx = await db.transactions
      .where('warehouseId').anyOf(ricemillIds)
      .and((t) => t.status === 'Active')
      .toArray()
    const varietyList = await db.varietyTypes.toArray()
    const varietyMap = new Map(varietyList.map((v) => [v.varietyId, v]))
    const warehouseMap = new Map(ricemillWarehouses.map((w) => [w.warehouseId, w]))

    const details = new Map()
    for (const auth of millingAuthorities) {
      const millingTx = warehouseTx.filter((t) => t.type === 'WSI' && t.aiNumber === auth.aiNumber)
      for (const tx of millingTx) {
        const recoveryTx = warehouseTx.filter((t) => t.type === 'WSR' && t.linkedDocNo === auth.aiNumber)
        const recoveredKilos = recoveryTx.reduce((sum, r) => sum + (r.netKilos ?? 0), 0)
        const issuedKilos = tx.netKilos ?? 0
        const recoveryPct = issuedKilos > 0 ? (recoveredKilos / issuedKilos) * 100 : null

        const key = auth.regionalAuthorityNumber
        if (!details.has(key)) details.set(key, [])
        details.get(key).push({
          id: tx.id,
          date: tx.date,
          warehouseName: warehouseMap.get(tx.warehouseId)?.name ?? tx.warehouseId,
          varietyName: varietyMap.get(tx.varietyId)?.name ?? '',
          bags: tx.numberOfBags ?? 0,
          issuedKilos,
          recoveredKilos,
          recoveryPct,
        })
      }
    }
    return details
  }, []) ?? new Map()

  const resetForm = () => {
    setRegionalAuthorityNumber('')
    setTotalNetKgs('')
    setEditingId(null)
  }

  const handleEdit = (alloc) => {
    setEditingId(alloc.regionalAuthorityNumber)
    setRegionalAuthorityNumber(alloc.regionalAuthorityNumber)
    setTotalNetKgs(liveFormatNumber(String(alloc.totalNetKgs), 3))
  }

  const handleSave = async () => {
    if (!regionalAuthorityNumber.trim()) { toast.error('Regional Authority Number is required'); return }
    if (totalNetKgs === '') { toast.error('Total Net Kgs is required'); return }

    const existing = allocations.find((a) => a.regionalAuthorityNumber === regionalAuthorityNumber.trim() && a.regionalAuthorityNumber !== editingId)
    if (existing) {
      toast.error('An allocation for that Regional Authority Number already exists')
      return
    }

    if (editingId && editingId !== regionalAuthorityNumber.trim()) {
      await db.ricemillAllocations.delete(editingId)
    }
    await db.ricemillAllocations.put({
      regionalAuthorityNumber: regionalAuthorityNumber.trim(),
      totalNetKgs: parseFormattedNumber(totalNetKgs),
    })
    toast.success(editingId ? 'Allocation updated' : 'Allocation saved')
    resetForm()
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">NFA Ricemill Allocations</h2>
      <p className="mt-1 text-xs text-neutral-500">
        The total net kg authorized by the regional office, per Regional Authority Number -
        the only reference NFA-owned Ricemills use.
      </p>

      <div className="mt-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <div>
          <label className={labelClass}>Regional Authority Number</label>
          <input
            type="text"
            value={regionalAuthorityNumber}
            onChange={(e) => setRegionalAuthorityNumber(e.target.value)}
            className={inputClass}
            placeholder="e.g. RAN-2026-045"
          />
        </div>
        <div>
          <label className={labelClass}>Total Net Kgs Authorized</label>
          <input
            type="text"
            inputMode="decimal"
            value={totalNetKgs}
            onChange={(e) => setTotalNetKgs(liveFormatNumber(e.target.value, 3))}
            className={inputClass}
            placeholder="0.000"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
            {editingId ? 'Update' : 'Save'}
          </button>
          {editingId && <button type="button" onClick={resetForm} className={secondaryButtonClass}>Cancel</button>}
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {sortedAllocations.length === 0 && <p className="py-3 text-center text-xs text-neutral-500">No ricemill allocations set yet.</p>}
        {sortedAllocations.map((a) => {
          const used = usageByNumber.get(a.regionalAuthorityNumber) ?? 0
          const remaining = a.totalNetKgs - used
          const millingDetails = millingDetailsByNumber.get(a.regionalAuthorityNumber) ?? []
          const isExpanded = expandedNumber === a.regionalAuthorityNumber
          return (
            <li key={a.regionalAuthorityNumber} className={`${listItemClass} flex-col items-stretch`}>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedNumber(isExpanded ? null : a.regionalAuthorityNumber)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-app-text">{a.regionalAuthorityNumber}</p>
                  <p className="text-xs text-neutral-500">
                    {fmtWeight(used, weightUnit)} used of {fmtWeight(a.totalNetKgs, weightUnit)}
                    {' · '}
                    <span className={remaining < 0 ? 'text-brand-crimson' : 'text-brand-neon'}>
                      {fmtWeight(Math.abs(remaining), weightUnit)} {remaining < 0 ? 'over' : 'remaining'}
                    </span>
                    {millingDetails.length > 0 && ` · ${millingDetails.length} milling record(s)`}
                  </p>
                </button>
                <div className="flex gap-1">
                  <button type="button" onClick={() => handleEdit(a)} aria-label="Edit" className={editIconClass}><Pencil size={20} /></button>
                  <button type="button" onClick={() => setPendingDelete(a)} aria-label="Delete" className={deleteIconClass}><Trash2 size={20} /></button>
                </div>
              </div>
              {isExpanded && (
                <div className="mt-2 space-y-1.5 border-t border-neutral-800 pt-2">
                  {millingDetails.length === 0 && (
                    <p className="text-xs text-neutral-500">No milling activity recorded yet for this Regional Authority Number.</p>
                  )}
                  {millingDetails.map((d) => (
                    <div key={d.id} className="rounded-lg bg-neutral-950 p-2 text-xs">
                      <div className="flex items-center justify-between text-neutral-400">
                        <span>{d.date} · {d.warehouseName}</span>
                        <span className="font-medium text-app-text">{d.varietyName}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-neutral-500">{fmtBags(d.bags)} bags · {fmtWeight(d.issuedKilos, weightUnit)} issued → {fmtWeight(d.recoveredKilos, weightUnit)} recovered</span>
                        <span className={`font-semibold ${d.recoveryPct == null ? 'text-neutral-500' : 'text-brand-neon'}`}>
                          {d.recoveryPct == null ? '—' : `${d.recoveryPct.toFixed(1)}%`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this allocation?"
        description="This cannot be undone."
        onConfirm={async () => {
          await db.ricemillAllocations.delete(pendingDelete.regionalAuthorityNumber)
          setPendingDelete(null)
          toast.success('Deleted')
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

function PrivateMillerAllocationsPanel() {
  const { weightUnit } = useSettings() ?? {}
  const [regionalAuthorityNumber, setRegionalAuthorityNumber] = useState('')
  const [ricemillName, setRicemillName] = useState('')
  const [totalNetKgs, setTotalNetKgs] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const allocations = useLiveQuery(() => db.privateMillerAllocations.toArray(), []) ?? []
  const sortedAllocations = [...allocations].sort((a, b) =>
    byAlpha(a.regionalAuthorityNumber, b.regionalAuthorityNumber) || byAlpha(a.ricemillName, b.ricemillName)
  )

  // Actual usage per (regionalAuthorityNumber, ricemillName) pair -
  // traced via millingOrders (which already carries ricemillName and
  // aiNumber/siaNumber per MO/TMO), same tracing pattern as the
  // ricemill-side computation, just one level more specific.
  const usageByKey = useLiveQuery(async () => {
    const orders = await db.millingOrders.toArray()
    const authorities = await db.authorities.toArray()
    const authByAiOrSia = new Map()
    for (const a of authorities) {
      if (a.aiNumber) authByAiOrSia.set(a.aiNumber, a.regionalAuthorityNumber)
      if (a.siaNumber) authByAiOrSia.set(a.siaNumber, a.regionalAuthorityNumber)
    }

    const orderToRegionalNum = new Map()
    for (const o of orders) {
      const regionalNum = (o.aiNumber && authByAiOrSia.get(o.aiNumber)) || (o.siaNumber && authByAiOrSia.get(o.siaNumber))
      if (regionalNum) orderToRegionalNum.set(`${o.type}::${o.number}`, { regionalNum, ricemillName: o.ricemillName })
    }

    const tx = await db.transactions
      .where('moNumber').anyOf(orders.filter((o) => o.type === 'MO').map((o) => o.number))
      .and((t) => t.status === 'Active' && (t.type === 'WSR' || t.type === 'WSI'))
      .toArray()
    const tmoTx = await db.transactions
      .where('tmoNumber').anyOf(orders.filter((o) => o.type === 'TMO').map((o) => o.number))
      .and((t) => t.status === 'Active' && (t.type === 'WSR' || t.type === 'WSI'))
      .toArray()

    const usage = new Map()
    for (const t of [...tx, ...tmoTx]) {
      const orderKey = t.moNumber ? `MO::${t.moNumber}` : `TMO::${t.tmoNumber}`
      const info = orderToRegionalNum.get(orderKey)
      if (!info) continue
      const key = `${info.regionalNum}::${info.ricemillName}`
      usage.set(key, (usage.get(key) ?? 0) + (t.netKilos ?? 0))
    }
    return usage
  }, []) ?? new Map()

  const resetForm = () => {
    setRegionalAuthorityNumber('')
    setRicemillName('')
    setTotalNetKgs('')
    setEditingKey(null)
  }

  const handleEdit = (alloc) => {
    setEditingKey(`${alloc.regionalAuthorityNumber}::${alloc.ricemillName}`)
    setRegionalAuthorityNumber(alloc.regionalAuthorityNumber)
    setRicemillName(alloc.ricemillName)
    setTotalNetKgs(liveFormatNumber(String(alloc.totalNetKgs), 3))
  }

  const handleSave = async () => {
    if (!regionalAuthorityNumber.trim() || !ricemillName.trim()) {
      toast.error('Regional Authority Number and Ricemill Name are both required')
      return
    }
    if (totalNetKgs === '') { toast.error('Total Net Kgs is required'); return }

    await db.privateMillerAllocations.put({
      regionalAuthorityNumber: regionalAuthorityNumber.trim(),
      ricemillName: ricemillName.trim(),
      totalNetKgs: parseFormattedNumber(totalNetKgs),
    })
    toast.success(editingKey ? 'Allocation updated' : 'Allocation saved')
    resetForm()
  }

  return (
    <section className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Private Miller Allocations</h2>
      <p className="mt-1 text-xs text-neutral-500">
        A Regional Authority Number shared across several private millers divides UNEQUALLY between
        them - set each miller's own share here.
      </p>

      <div className="mt-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <div>
          <label className={labelClass}>Regional Authority Number</label>
          <input type="text" value={regionalAuthorityNumber} onChange={(e) => setRegionalAuthorityNumber(e.target.value)} className={inputClass} placeholder="e.g. RAN-2026-045" />
        </div>
        <div>
          <label className={labelClass}>Ricemill Name</label>
          <input type="text" value={ricemillName} onChange={(e) => setRicemillName(e.target.value)} className={inputClass} placeholder="Matches the MO/TMO sheet's ricemill name" />
        </div>
        <div>
          <label className={labelClass}>Total Net Kgs Authorized (this miller's share)</label>
          <input type="text" inputMode="decimal" value={totalNetKgs} onChange={(e) => setTotalNetKgs(liveFormatNumber(e.target.value, 3))} className={inputClass} placeholder="0.000" />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>{editingKey ? 'Update' : 'Save'}</button>
          {editingKey && <button type="button" onClick={resetForm} className={secondaryButtonClass}>Cancel</button>}
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {sortedAllocations.length === 0 && <p className="py-3 text-center text-xs text-neutral-500">No private miller allocations set yet.</p>}
        {sortedAllocations.map((a) => {
          const key = `${a.regionalAuthorityNumber}::${a.ricemillName}`
          const used = usageByKey.get(key) ?? 0
          const remaining = a.totalNetKgs - used
          return (
            <li key={key} className={listItemClass}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-app-text">{a.ricemillName}</p>
                <p className="truncate text-xs text-neutral-500">{a.regionalAuthorityNumber}</p>
                <p className="text-xs text-neutral-500">
                  {fmtWeight(used, weightUnit)} used of {fmtWeight(a.totalNetKgs, weightUnit)}
                  {' · '}
                  <span className={remaining < 0 ? 'text-brand-crimson' : 'text-brand-neon'}>
                    {fmtWeight(Math.abs(remaining), weightUnit)} {remaining < 0 ? 'over' : 'remaining'}
                  </span>
                </p>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => handleEdit(a)} aria-label="Edit" className={editIconClass}><Pencil size={20} /></button>
                <button type="button" onClick={() => setPendingDelete(a)} aria-label="Delete" className={deleteIconClass}><Trash2 size={20} /></button>
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this allocation?"
        description="This cannot be undone."
        onConfirm={async () => {
          await db.privateMillerAllocations.delete([pendingDelete.regionalAuthorityNumber, pendingDelete.ricemillName])
          setPendingDelete(null)
          toast.success('Deleted')
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

function MillerAllocationsPanel() {
  return (
    <>
      <RicemillAllocationsPanel />
      <PrivateMillerAllocationsPanel />
    </>
  )
}

export default MillerAllocationsPanel
