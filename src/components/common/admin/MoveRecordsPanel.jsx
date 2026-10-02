// Move Records - Admin only. Moves selected transactions that were
// encoded under the wrong warehouse to the right one (literal move; see
// utils/warehouseMove.js for the full rules). Preview first, move only on
// confirmation.

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { loadMovableTransactions, planWarehouseMove, executeWarehouseMove } from '../../../utils/warehouseMove.js'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from './shared.js'

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 })

function MoveRecordsPanel() {
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [rows, setRows] = useState([])
  const [typeFilter, setTypeFilter] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [plan, setPlan] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const nameOf = (id) => warehouses.find((w) => w.warehouseId === id)?.name ?? id

  const reload = async (wid) => {
    setRows(await loadMovableTransactions(wid))
    setSelected(new Set())
    setPlan(null)
  }

  useEffect(() => { reload(sourceId) }, [sourceId])
  useEffect(() => { setPlan(null) }, [destId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((t) => (!typeFilter || t.type === typeFilter) &&
      (!q || String(t.serialNo).toLowerCase().includes(q) || String(t.date ?? '').includes(q)))
  }, [rows, typeFilter, query])

  const types = useMemo(() => [...new Set(rows.map((t) => t.type))].sort(), [rows])

  const toggle = (id) => {
    setPlan(null)
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleAllVisible = () => {
    setPlan(null)
    setSelected((prev) => {
      const n = new Set(prev)
      const allOn = visible.every((t) => n.has(t.id))
      visible.forEach((t) => (allOn ? n.delete(t.id) : n.add(t.id)))
      return n
    })
  }

  const handlePreview = async () => {
    setBusy(true)
    try { setPlan(await planWarehouseMove([...selected], sourceId, destId)) }
    catch (err) { console.error(err); toast.error('Preview failed - check console') }
    finally { setBusy(false) }
  }

  const handleMove = async () => {
    setConfirming(false)
    setBusy(true)
    try {
      const res = await executeWarehouseMove(plan, sourceId, destId)
      toast.success(`Moved ${res.moved} record${res.moved === 1 ? '' : 's'}${res.createdPiles ? `, created ${res.createdPiles} pile${res.createdPiles === 1 ? '' : 's'}` : ''}`)
      await reload(sourceId)
    } catch (err) {
      console.error(err)
      toast.error('Move failed - check console')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Move Records Between Warehouses</h2>
      <p className="mt-1 text-xs text-neutral-400">
        For records encoded under the wrong warehouse. Selected records leave the source completely and land in the
        destination under the same pile name (the pile is created there if missing, merged into if it exists).
        Serial numbers stay the same, the Google Sheet row only has its warehouse updated, and authorities are not
        touched - re-assign the authority on the record afterward.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>From warehouse
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>To warehouse
          <select value={destId} onChange={(e) => setDestId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {warehouses.filter((w) => w.warehouseId !== sourceId).map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
          </select>
        </label>
      </div>

      {sourceId && (
        <>
          <div className="mt-3 flex gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${inputClass} !mt-0 w-28`}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Serial or date…" className={`${inputClass} !mt-0 flex-1`} />
            <button type="button" onClick={toggleAllVisible} className={secondaryButtonClass}>Toggle all</button>
          </div>

          <p className="mt-2 text-xs text-neutral-500">{visible.length} shown · {selected.size} selected</p>
          <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto">
            {visible.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-400">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                  <span className="font-semibold text-app-text">{t.type} {t.serialNo}</span>
                  <span>· {t.date}</span>
                  {t.numberOfBags != null && <span>· {fmt(t.numberOfBags)} bags</span>}
                  {t.status !== 'Active' && <span className="text-brand-crimson">· {t.status}</span>}
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex gap-2">
            <button type="button" onClick={handlePreview} disabled={busy || !destId || selected.size === 0} className={`flex-1 ${secondaryButtonClass} disabled:opacity-40`}>
              Preview move
            </button>
            {plan && plan.blockers.length === 0 && (
              <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={`flex-1 ${primaryButtonClass} disabled:opacity-40`}>
                {busy ? 'Moving…' : `Move ${plan.records.length}`}
              </button>
            )}
          </div>
        </>
      )}

      {plan && (
        <div className="mt-3 space-y-2 text-xs">
          <p className="text-sm font-medium text-app-text">
            {plan.records.length} record{plan.records.length === 1 ? '' : 's'} to move
            {plan.siblingsAdded > 0 && ` (${plan.siblingsAdded} grouped sibling${plan.siblingsAdded === 1 ? '' : 's'} added automatically)`}
          </p>
          {plan.blockers.map((b, i) => <p key={i} className="rounded-lg border border-brand-crimson/40 px-3 py-1.5 text-brand-crimson">⛔ {b}</p>)}
          {plan.warnings.map((w, i) => <p key={i} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300">⚠ {w}</p>)}
          {plan.piles.map((p) => (
            <div key={p.sourcePileId} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-400">
              <span className="font-semibold text-app-text">{p.pileName}</span> ({p.cerealType}) →{' '}
              {p.destPileId ? 'merges into existing pile' : <span className="text-brand-neon">new pile created</span>}
              {' '}in {nameOf(destId)} · net {fmt(p.bags)} bags / {fmt(p.kilos)} kg
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Move ${plan?.records.length ?? 0} record${plan?.records.length === 1 ? '' : 's'}?`}
        description={`These records leave ${nameOf(sourceId)} and move to ${nameOf(destId)}. Pile balances are recomputed on both sides and the Google Sheet rows are updated. This syncs to every device.`}
        confirmLabel="Move"
        onConfirm={handleMove}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}

export default MoveRecordsPanel
