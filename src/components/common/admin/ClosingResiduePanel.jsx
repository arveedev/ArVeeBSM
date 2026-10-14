// Closing Residue - Admin only. Finds closed piles that still held net kilos (with no bags) when they
// were closed and moves those kilos to a pile of the same variety in the same warehouse, so every
// pile-level view, the Stock Desk and the exported stock statement tally. Scan first, move only on
// confirmation. The move is an ordinary 0-bag transfer record dated the day the pile was closed (see
// utils/closingResidue.js), shown on both BIN Cards and on the Stock Report.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../../context/AuthContext.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { findClosingResidues, moveResidue, refreshResidueRecords } from '../../../utils/closingResidue.js'
import { labelClass, primaryButtonClass, secondaryButtonClass } from './shared.js'

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 })

function ClosingResiduePanel() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null) // null = not scanned yet
  const [dest, setDest] = useState({}) // closed pileId -> chosen destination pileId
  const [picked, setPicked] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const scan = async () => {
    setBusy(true)
    try {
      await refreshResidueRecords()
      const found = await findClosingResidues()
      setRows(found)
      setDest(Object.fromEntries(found.map((r) => [r.pile.pileId, r.destinations[0]?.pileId ?? ''])))
      setPicked(new Set(found.filter((r) => r.destinations.length > 0).map((r) => r.pile.pileId)))
    } catch (err) {
      console.error(err)
      toast.error('Scan failed - check console')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const chosen = (rows ?? []).filter((r) => picked.has(r.pile.pileId) && dest[r.pile.pileId])

  const run = async () => {
    setConfirming(false)
    setBusy(true)
    try {
      let moved = 0
      // oldest closing first: a destination that was itself closed later is handled by a second scan
      for (const r of chosen) {
        const to = r.destinations.find((p) => p.pileId === dest[r.pile.pileId])
        if (!to) continue
        const rec = await moveResidue({ source: r.pile, dest: to, kilos: r.kilos, date: r.date, createdByName: user?.name ?? null })
        if (rec) moved += 1
      }
      toast.success(`Moved the net kilos of ${moved} closed pile${moved === 1 ? '' : 's'}`)
      await scan()
    } catch (err) {
      console.error(err)
      toast.error('Move failed - check console')
    } finally {
      setBusy(false)
    }
  }

  const total = chosen.reduce((s, r) => s + r.kilos, 0)

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Closing Residue</h2>
      <p className="mt-1 text-xs text-neutral-400">
        A pile closed with no bags left can still hold net kilos. Those kilos are moved to a pile of the same variety in the
        same warehouse as a 0-bag transfer dated the day the pile was closed, keeping the original age of the stock. It shows
        on the BIN Card of both piles and on the Stock Report. A warehouse's reporting start date is respected: piles closed
        on or before it are left alone.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={scan} disabled={busy} className={`${secondaryButtonClass} disabled:opacity-40`}>
          {busy ? 'Working…' : rows ? 'Scan again' : 'Scan closed piles'}
        </button>
        {chosen.length > 0 && (
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={`${primaryButtonClass} disabled:opacity-40`}>
            Move {chosen.length} ({fmt(total)} kg)
          </button>
        )}
      </div>

      {rows && rows.length === 0 && <p className="mt-3 text-xs text-neutral-400">Every closed pile is clean: no net kilos are left behind.</p>}

      {rows && rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => {
            const id = r.pile.pileId
            return (
              <li key={id} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={picked.has(id)} disabled={r.destinations.length === 0} onChange={() => toggle(id)} />
                  <span className="min-w-0 break-words">
                    <span className="font-semibold text-app-text">{r.pile.pileName}</span>
                    {' '}({r.varietyName}) in {r.warehouse?.name ?? '?'}, closed {r.date}:{' '}
                    <span className="font-semibold text-brand-neon">{fmt(r.kilos)} kg</span> net, 0 bags
                  </span>
                </label>
                {r.destinations.length === 0 ? (
                  <p className="mt-1 text-brand-crimson">No open pile of this variety in this warehouse. Open or create one, then scan again.</p>
                ) : (
                  <label className={`${labelClass} mt-2 block`}>Move the kilos into
                    <select value={dest[id] ?? ''} onChange={(e) => setDest((d) => ({ ...d, [id]: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-app-text outline-none focus:border-brand-neon">
                      {r.destinations.map((p) => (
                        <option key={p.pileId} value={p.pileId}>{p.pileName} ({fmt(p.currentBags)} bags / {fmt(p.currentKilos)} kg now)</option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Move the net kilos of ${chosen.length} closed pile${chosen.length === 1 ? '' : 's'}?`}
        description={`${fmt(total)} kg move to open piles of the same variety as 0-bag transfers dated the day each pile was closed. Pile balances are recomputed and this syncs to every device.`}
        confirmLabel="Move"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}

export default ClosingResiduePanel
