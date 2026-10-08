// Inventory Lots Check - Admin only, READ-ONLY. First step of the planned
// Daily Inventory / Age Monitoring reports (docs/daily-inventory-age-
// monitoring-plan.md). Rebuilds every pile's stock lot by lot (one lot per
// receipt, oldest issued first) and compares the result with the app's own
// pile balances. Nothing is added, changed or deleted: this panel only reads.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { computeHistoricalPileState } from '../../../utils/pileLedger.js'
import { buildLots, sumLots, lotAgeMonths, ANCHOR } from '../../../utils/inventoryLots.js'
import { todayLocalISO } from '../../../utils/calculations.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { byAlpha, labelClass, primaryButtonClass } from './shared.js'

const fmt = (n) => (n ?? 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })

// Coarse age brackets per cereal, months (upper edge inclusive).
const BRACKETS = {
  Rice: [{ label: '0-3', max: 3 }, { label: 'Over 3', max: Infinity }],
  Palay: [{ label: '0-6', max: 6 }, { label: '6.1-12', max: 12 }, { label: 'Over 12', max: Infinity }],
}

function InventoryLotsCheckPanel() {
  const [asOf, setAsOf] = useState(todayLocalISO())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    setBusy(true)
    try {
      const [piles, transactions, warehouses, config] = await Promise.all([
        db.piles.toArray(),
        db.transactions.toArray(),
        db.warehouses.toArray(),
        db.reportConfig.get('global'),
      ])
      const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
      const lots = buildLots({
        piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, asOf,
      })

      const rows = []
      const ages = {}
      for (const pile of piles) {
        const st = lots.get(pile.pileId)
        const mine = sumLots(st.lots)
        const app = await computeHistoricalPileState(pile.pileId, asOf, whById.get(pile.warehouseId) ?? null)
        const whName = whById.get(pile.warehouseId)?.name ?? '?'
        rows.push({
          pile, whName, lots: st.lots, shortBags: st.shortBags,
          lotBags: mine.bags, lotKilos: mine.kilos, appBags: app.bags, appKilos: app.kilos,
          match: Math.abs(mine.bags - app.bags) < 0.5 && Math.abs(mine.kilos - app.kilos) < 1,
        })
        const set = BRACKETS[pile.cerealType]
        for (const lot of st.lots) {
          const key = pile.cerealType
          ages[key] ??= {}
          const m = lotAgeMonths(lot.date, asOf) ?? 0
          const label = set ? set.find((b) => m <= b.max).label : 'All'
          ages[key][label] ??= { bags: 0, kilos: 0 }
          ages[key][label].bags += lot.bags
          ages[key][label].kilos += lot.kilos
        }
      }
      rows.sort((a, b) => byAlpha(a.whName, b.whName) || byAlpha(a.pile.pileName, b.pile.pileName))
      setResult({ rows, ages, asOf })
    } catch (err) {
      console.error(err)
      toast.error('Check failed - nothing was changed')
    } finally {
      setBusy(false)
    }
  }

  const mismatches = result?.rows.filter((r) => !r.match) ?? []
  const short = result?.rows.filter((r) => r.shortBags > 0) ?? []
  const approx = (result?.rows ?? []).flatMap((r) => r.lots.filter((l) => l.anchor === ANCHOR.PILE_DATE).map((l) => ({ r, l })))
  const lotCount = (result?.rows ?? []).reduce((s, r) => s + r.lots.length, 0)

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Inventory Lots Check</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Rebuilds every pile lot by lot (one lot per receipt, oldest issued first) and compares it with the
        pile balances the app already shows. Read-only: nothing is added, changed or deleted.
      </p>

      <label className={`mt-3 block ${labelClass}`}>Stock as of
        <div className="mt-1"><CalendarDatePicker value={asOf} onChange={setAsOf} /></div>
      </label>
      <button type="button" onClick={run} disabled={busy || !asOf} className={`mt-3 w-full ${primaryButtonClass} disabled:opacity-40`}>
        {busy ? 'Checking…' : 'Run check'}
      </button>

      {result && (
        <div className="mt-4 space-y-3 text-sm text-app-text">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <p>{result.rows.length} piles, {lotCount} lots as of {result.asOf}.</p>
            <p className={mismatches.length ? 'text-brand-crimson' : 'text-brand-neon'}>
              {result.rows.length - mismatches.length} of {result.rows.length} piles match the app's pile balance
              {mismatches.length ? `; ${mismatches.length} differ` : ''}.
            </p>
          </div>

          {mismatches.length > 0 && (
            <Group title="Differs from the app's pile balance">
              {mismatches.map((r) => (
                <Line key={r.pile.pileId} left={`${r.whName} · ${r.pile.pileName}`}
                  right={`lots ${fmt(r.lotBags)} bags / ${fmt(r.lotKilos)} kg  vs  app ${fmt(r.appBags)} / ${fmt(r.appKilos)}`} />
              ))}
            </Group>
          )}

          {short.length > 0 && (
            <Group title="Issued more than was received (the app floors these to zero)">
              {short.map((r) => (
                <Line key={r.pile.pileId} left={`${r.whName} · ${r.pile.pileName}`} right={`${fmt(r.shortBags)} bags over`} />
              ))}
            </Group>
          )}

          {approx.length > 0 && (
            <Group title="Age is approximate (no readable Date Received, pile date used)">
              {approx.map(({ r, l }) => (
                <Line key={`${r.pile.pileId}-${l.lotId}`} left={`${r.whName} · ${r.pile.pileName}`} right={`${fmt(l.bags)} bags from ${l.date}`} />
              ))}
            </Group>
          )}

          <Group title="Stock by age (net bags)">
            {Object.entries(result.ages).map(([cereal, buckets]) => (
              <Line key={cereal} left={cereal}
                right={Object.entries(buckets).map(([label, v]) => `${label}: ${fmt(v.bags)}`).join('   ')} />
            ))}
          </Group>
        </div>
      )}
    </section>
  )
}

function Group({ title, children }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-400">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Line({ left, right }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="min-w-0 break-words text-neutral-300">{left}</span>
      <span className="break-words tabular-nums text-app-text">{right}</span>
    </div>
  )
}

export default InventoryLotsCheckPanel
