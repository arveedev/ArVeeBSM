// Copy Layout - Admin only. Copies the BOX shapes and positions of one
// warehouse's pile layout to another warehouse so nobody has to redraw
// them. Only geometry (and, optionally, the box names) is copied: no piles,
// no assignments, no dates. Boxes arrive vacant. Nothing is ever deleted
// or changed in the destination - a copied box that would overlap one the
// destination already has is skipped and reported.

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { byAlpha, labelClass, primaryButtonClass } from './shared.js'

const overlaps = (a, b) =>
  a.colStart < b.colStart + b.colSpan && b.colStart < a.colStart + a.colSpan &&
  a.rowStart < b.rowStart + b.rowSpan && b.rowStart < a.rowStart + a.rowSpan

function CopyLayoutPanel() {
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const sorted = useMemo(() => [...warehouses].sort((a, b) => byAlpha(a.name, b.name)), [warehouses])
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [copyLabels, setCopyLabels] = useState(true)
  const [source, setSource] = useState([])
  const [dest, setDest] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let off = false
    ;(async () => {
      const [s, d] = await Promise.all([
        sourceId ? db.pileLayoutBoxes.where('warehouseId').equals(sourceId).toArray() : [],
        destId ? db.pileLayoutBoxes.where('warehouseId').equals(destId).toArray() : [],
      ])
      if (!off) { setSource(s); setDest(d) }
    })()
    return () => { off = true }
  }, [sourceId, destId, busy])

  const plan = useMemo(() => {
    const toAdd = []
    const skipped = []
    for (const b of source) {
      const clash = [...dest, ...toAdd].some((d) => overlaps(b, d))
      ;(clash ? skipped : toAdd).push(b)
    }
    return { toAdd, skipped }
  }, [source, dest])

  const nameOf = (id) => sorted.find((w) => w.warehouseId === id)?.name ?? ''
  const ready = sourceId && destId && sourceId !== destId && plan.toAdd.length > 0

  const handleCopy = async () => {
    setBusy(true)
    try {
      const rows = plan.toAdd.map((b) => ({
        id: crypto.randomUUID(),
        warehouseId: destId,
        rowStart: b.rowStart, colStart: b.colStart, rowSpan: b.rowSpan, colSpan: b.colSpan,
        pileId: null,
        label: copyLabels ? (b.label ?? null) : null,
      }))
      await db.pileLayoutBoxes.bulkAdd(rows)
      toast.success(`Copied ${rows.length} box${rows.length === 1 ? '' : 'es'} to ${nameOf(destId)}`)
    } catch (err) {
      console.error(err)
      toast.error('Copy failed - nothing was changed or only part was added; check the destination layout')
    } finally {
      setBusy(false)
    }
  }

  const select = (value, onChange, other) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-app-text outline-none focus:border-brand-neon">
      <option value="">Select warehouse…</option>
      {sorted.filter((w) => w.warehouseId !== other).map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
    </select>
  )

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Copy Layout</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Copies the boxes (position and size) of one warehouse's pile layout to another, so they don't have to be
        drawn again. Piles and assignments are not copied: every new box starts vacant. Boxes already in the
        destination are never changed or removed; a copied box that would overlap one of them is skipped.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>Copy from{select(sourceId, setSourceId, destId)}</label>
        <label className={labelClass}>Copy to{select(destId, setDestId, sourceId)}</label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" checked={copyLabels} onChange={(e) => setCopyLabels(e.target.checked)} />
        Also copy box names (e.g. "PILE 2A")
      </label>

      {sourceId && destId && (
        <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-app-text">
          <p>{source.length} box{source.length === 1 ? '' : 'es'} in {nameOf(sourceId)}; {dest.length} already in {nameOf(destId)}.</p>
          <p><span className="font-semibold">{plan.toAdd.length}</span> will be added{plan.skipped.length > 0 && <>, <span className="font-semibold">{plan.skipped.length}</span> skipped because they overlap an existing box</>}.</p>
        </div>
      )}

      <button type="button" onClick={handleCopy} disabled={!ready || busy} className={`mt-3 w-full ${primaryButtonClass} disabled:opacity-40`}>
        {busy ? 'Copying…' : `Copy ${plan.toAdd.length || ''} box${plan.toAdd.length === 1 ? '' : 'es'}`}
      </button>
    </section>
  )
}

export default CopyLayoutPanel
