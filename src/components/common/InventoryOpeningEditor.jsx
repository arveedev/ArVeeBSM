// Opening-balance override for the Daily inventory report (Admin only).
//
// Shows the stock the report computes at the end of the day before the ledger's
// first day, per warehouse, variety and age bracket (in net bags), and lets the
// Admin type the balance that should be used instead. Only the differences are
// saved, as small corrections on the shared report settings.
//
// It changes ONLY what Daily inventory, Summary and Age monitoring show from that
// date onward. No pile, transaction, authority or any other screen is touched,
// and "Clear" removes it again. A correction does not age: it stays in the
// bracket it was typed in. The balance typed is saved as typed, so it always shows.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { liveFormatNumber, parseFormattedNumber } from '../../utils/calculations.js'
import { bracketLabels, warehouseLabel, longDate } from '../../utils/inventoryReport.js'

const KG = 50
const key = (c) => `${c.w}|${c.c}|${c.v}|${c.b}`
const bags = (kilos) => liveFormatNumber((kilos / KG).toFixed(2))

function InventoryOpeningEditor({ date, ageSet, baseCells, existing, warehouses, provinces, varieties, onClose }) {
  const sameDate = existing && existing.date === date && existing.ageSet === ageSet
  const provName = useMemo(() => new Map(provinces.map((p) => [p.provinceId, p.name])), [provinces])
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.warehouseId, w])), [warehouses])

  // every cell that has computed stock or an existing correction
  const initial = useMemo(() => {
    const cells = new Map()
    for (const c of baseCells.values()) cells.set(key(c), { w: c.w, c: c.c, v: c.v, b: c.b, base: c.kilos })
    if (sameDate) for (const e of existing.cells) {
      const k = key(e)
      const cur = cells.get(k) ?? { w: e.w, c: e.c, v: e.v, b: e.b, base: 0 }
      cells.set(k, cur)
    }
    return cells
  }, [baseCells, existing, sameDate])

  const [cells, setCells] = useState(initial)
  const [values, setValues] = useState(() => {
    const out = {}
    for (const [k, c] of initial) {
      const e = sameDate ? existing.cells.find((x) => key(x) === k) : null
      out[k] = bags(e ? (e.t ?? c.base + (e.k ?? 0)) : c.base)
    }
    return out
  })
  const [busy, setBusy] = useState(false)
  const [add, setAdd] = useState({ w: '', varietyId: '', b: '', amount: '' })

  const rows = useMemo(() => [...cells.entries()].map(([k, c]) => {
    const wh = whById.get(c.w)
    return { k, ...c, province: provName.get(wh?.provinceId) ?? '', label: warehouseLabel(wh?.name, false) }
  }).sort((a, b) => a.province.localeCompare(b.province) || a.label.localeCompare(b.label, undefined, { numeric: true })
    || a.c.localeCompare(b.c) || a.v.localeCompare(b.v, undefined, { numeric: true }) || a.b.localeCompare(b.b, undefined, { numeric: true })), [cells, whById, provName])

  const commodityOfVariety = (id) => { const cat = varieties.find((v) => v.varietyId === id)?.category; return cat === 'Rice' || cat === 'Palay' ? cat : 'By Products' }
  const addVariety = varieties.find((v) => v.varietyId === add.varietyId)
  const addBuckets = addVariety ? bracketLabels(commodityOfVariety(add.varietyId), ageSet) : []

  const addLine = () => {
    const amt = parseFormattedNumber(add.amount)
    if (!add.w || !add.varietyId || !add.b || !(amt >= 0)) { toast.error('Choose a warehouse, variety, bracket and amount'); return }
    const c = { w: add.w, c: commodityOfVariety(add.varietyId), v: addVariety.name, b: add.b }
    const k = key(c)
    setCells((prev) => (prev.has(k) ? prev : new Map(prev).set(k, { ...c, base: 0 })))
    setValues((prev) => ({ ...prev, [k]: liveFormatNumber(amt.toFixed(2)) }))
    setAdd({ w: '', varietyId: '', b: '', amount: '' })
  }

  const persist = async (next) => {
    const cur = await db.reportConfig.get('global')
    if (cur) await db.reportConfig.update('global', { inventoryOpening: next })
    else await db.reportConfig.put({ id: 'global', inventoryOpening: next })
  }

  const save = async () => {
    setBusy(true)
    try {
      const out = []
      for (const [k, c] of cells) {
        const entered = parseFormattedNumber(values[k] ?? '')
        const delta = Math.round((entered * KG - c.base) * 1000) / 1000
        // `t` is the balance typed; the report works out the correction from it, so the typed
        // value is what shows. `k` (the correction when saved) is kept for reference only.
        if (Math.abs(delta) >= 0.5) out.push({ w: c.w, c: c.c, v: c.v, b: c.b, t: Math.round(entered * KG * 1000) / 1000, k: delta })
      }
      await persist(out.length ? { date, ageSet, cells: out, updatedAt: new Date().toISOString() } : null)
      toast.success(out.length ? `Opening balance saved (${out.length} change${out.length === 1 ? '' : 's'})` : 'No changes to save')
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Could not save the opening balance')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try { await persist(null); toast.success('Opening balance override cleared'); onClose() } catch (err) { console.error(err); toast.error('Could not clear') } finally { setBusy(false) }
  }

  const selectClass = 'rounded-xl border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
  let lastWh = null
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end bg-black/70 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:max-w-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-app-text">Opening balance</h3>
            <p className="text-xs text-neutral-400">End of {longDate(date)} · net bags</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-950 p-1.5 text-neutral-400"><X size={16} /></button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Type the balance that Daily inventory should start from. This changes only Daily inventory, Summary and Age monitoring from this
          date on; piles, transactions and every other screen stay as they are. Only the cells you change are saved. Clear removes the override.
        </p>
        {existing && !sameDate && (
          <p className="mt-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-300">
            An override for {longDate(existing.date)} already exists. Saving here replaces it.
          </p>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-neutral-500"><th className="pb-1">Warehouse · variety · bracket</th><th className="pb-1 text-right">Computed</th><th className="pb-1 pl-3 text-right">Opening balance</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const head = r.label !== lastWh ? r.label : null
                lastWh = r.label
                return (
                  <tr key={r.k} className="border-t border-neutral-800 align-middle">
                    <td className="py-1 pr-2 text-neutral-300">
                      {head && <span className="block text-xs font-semibold text-brand-neon">{r.province} · {head}</span>}
                      <span className="break-words">{r.v} · {r.b}</span>
                    </td>
                    <td className="py-1 text-right tabular-nums text-neutral-500">{bags(r.base)}</td>
                    <td className="py-1 pl-3 text-right">
                      <input
                        type="text" inputMode="decimal" value={values[r.k] ?? ''} aria-label={`Opening balance ${r.label} ${r.v} ${r.b}`}
                        onChange={(e) => setValues({ ...values, [r.k]: liveFormatNumber(e.target.value) })}
                        className="w-28 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-right tabular-nums text-app-text outline-none focus:border-brand-neon"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-4 text-center text-sm text-neutral-500">No stock at this date. Add a line below.</p>}

          <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-400">Add a line</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className={selectClass} value={add.w} onChange={(e) => setAdd({ ...add, w: e.target.value })} aria-label="Warehouse">
                <option value="">Warehouse…</option>
                {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
              </select>
              <select className={selectClass} value={add.varietyId} onChange={(e) => setAdd({ ...add, varietyId: e.target.value, b: '' })} aria-label="Variety">
                <option value="">Variety…</option>
                {varieties.map((v) => <option key={v.varietyId} value={v.varietyId}>{v.name} ({v.category})</option>)}
              </select>
              <select className={selectClass} value={add.b} onChange={(e) => setAdd({ ...add, b: e.target.value })} aria-label="Age bracket" disabled={!addVariety}>
                <option value="">Age bracket…</option>
                {addBuckets.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <input
                type="text" inputMode="decimal" placeholder="Net bags" value={add.amount} aria-label="Net bags"
                onChange={(e) => setAdd({ ...add, amount: liveFormatNumber(e.target.value) })}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-right text-sm text-app-text outline-none focus:border-brand-neon"
              />
            </div>
            <button type="button" onClick={addLine} className="mt-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200">Add line</button>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {existing && <button type="button" onClick={clear} disabled={busy} className="rounded-xl border border-brand-crimson/40 bg-neutral-900 px-3 py-2 text-sm font-medium text-brand-crimson disabled:opacity-40">Clear override</button>}
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="flex-1 rounded-xl bg-brand-neon px-3 py-2 text-sm font-semibold text-brand-contrast disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default InventoryOpeningEditor
