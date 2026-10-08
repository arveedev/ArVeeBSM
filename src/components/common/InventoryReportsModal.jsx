// Inventory Reports (Admin and Visitor). Opened from the quiet icon on the
// Home > Stocks title row. READ-ONLY: every figure is computed from the pile
// and transaction records already in the app (see utils/inventoryLots.js and
// utils/inventoryReport.js); nothing here adds, changes or deletes data.
//
// Views: Daily inventory (per day, ADD / LESS by type, ending stock) and
// Summary (stock per warehouse x variety x age bracket, province subtotals).
// Wide screens get the table; phones get cards. Filters and sort live behind
// one "Filter and sort" button to keep the screen clean.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { ArrowLeft, X, SlidersHorizontal, FileSpreadsheet, ChevronRight } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { todayLocalISO } from '../../utils/calculations.js'
import {
  makeContext, buildSummary, buildLedger, summaryModel, ledgerModel, summaryCards, ledgerCards, longDate,
} from '../../utils/inventoryReport.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'
import PillToggle from './PillToggle.jsx'

const DEFAULT_FILTERS = { combine: false, provinceId: '', commodity: '', warehouseIds: null, sort: 'name', ageSet: 'coarse' }
const fmtNum = (n) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CONTROL_H = 'h-[46px]'

// Narrow screens (phones) use cards instead of a wide table.
const useIsNarrow = () => {
  const query = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

const ROW_STYLE = {
  section: 'bg-neutral-900 text-[11px] font-bold uppercase tracking-wide text-neutral-400',
  sub: 'bg-neutral-900 font-semibold text-app-text',
  total: 'bg-neutral-800 font-bold text-app-text',
  beg: 'bg-amber-500/10 font-semibold text-app-text',
  end: 'font-semibold text-app-text',
  'add-label': 'font-semibold text-blue-400',
  'less-label': 'font-semibold text-brand-crimson',
  add: 'text-blue-400',
  less: 'text-brand-crimson',
  row: 'text-neutral-200',
}
const ROW_BORDER = { total: 'border-t-2 border-neutral-500', end: 'border-y border-neutral-500' }

// Left edge of a column: a strong line where a new warehouse/commodity starts,
// a lighter one where a new variety starts.
const edgeClass = (e) => (e === 'wh' ? 'border-l-2 border-l-emerald-500/70' : e === 'var' ? 'border-l border-l-neutral-500' : '')
const headTone = (t) => (t === 1 ? 'bg-sky-950 text-sky-300' : 'bg-emerald-950 text-emerald-300')

function ModelTable({ model }) {
  if (model.empty) return <p className="py-10 text-center text-sm text-neutral-500">{model.empty}</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-neutral-800">
      <table className="min-w-full border-separate border-spacing-0 text-xs tabular-nums">
        <thead>
          {model.head.map((row, ri) => {
            let col = 0
            return (
              <tr key={ri}>
                {row.map((h, ci) => {
                  if (ci === 0 && ri > 0) return null
                  const idx = col
                  if (ci > 0) col += h.span
                  const first = ci === 0
                  return (
                    <th
                      key={ci}
                      colSpan={h.span}
                      rowSpan={first ? model.head.length : 1}
                      className={`sticky h-7 whitespace-nowrap border-b border-r border-neutral-800 px-2 font-semibold ${first ? 'left-0 z-30 min-w-[11rem] bg-emerald-950 text-left text-emerald-300' : `z-20 min-w-[4.75rem] text-center ${headTone(h.tone)} ${edgeClass(model.edges[idx])}`}`}
                      style={{ top: `${ri * 1.75}rem` }}
                    >
                      {h.t}
                    </th>
                  )
                })}
              </tr>
            )
          })}
        </thead>
        <tbody>
          {model.rows.map((r, i) => (
            <tr key={i} className={`${ROW_STYLE[r.kind] ?? ''} ${ROW_BORDER[r.kind] ?? ''}`}>
              <td className={`sticky left-0 z-[5] min-w-[11rem] max-w-[18rem] whitespace-normal break-words border-b border-r border-neutral-800 bg-neutral-950 px-2 py-1 text-left ${r.kind === 'add' || r.kind === 'less' ? 'pl-5' : ''}`}>
                {r.first}
              </td>
              {r.kind === 'section' || r.kind === 'add-label' || r.kind === 'less-label'
                ? <td colSpan={model.edges.length} className="border-b border-neutral-800" />
                : r.cells.map((v, ci) => (
                  <td key={ci} className={`whitespace-nowrap border-b border-r border-neutral-800 px-2 py-1 text-right ${model.tones[ci] === 1 ? 'bg-white/[0.04]' : ''} ${edgeClass(model.edges[ci])}`}>
                    {v == null ? (r.dash ? '-' : '') : fmtNum(v)}
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Card = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-neutral-800 bg-neutral-900 p-3 ${className}`}>{children}</div>
)

function Lines({ lines }) {
  let last = null
  return lines.map((l, i) => {
    const head = l.commodity && l.commodity !== last ? l.commodity : null
    last = l.commodity ?? last
    return (
      <div key={i}>
        {head && <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500 first:mt-0">{head === 'By Products' ? 'By-products' : head}</p>}
        <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
          <span className="min-w-0 break-words text-neutral-300">{l.label}</span>
          <span className="shrink-0 tabular-nums text-app-text">{fmtNum(l.value)}</span>
        </div>
      </div>
    )
  })
}

function SummaryCardList({ cards }) {
  if (cards.provinces.length === 0) return <p className="py-10 text-center text-sm text-neutral-500">No stock found for these filters.</p>
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
      {cards.provinces.map((p) => (
        <div key={p.name} className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">{p.name}</p>
          {p.warehouses.map((w) => (
            <Card key={w.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-neutral-800 pb-1.5">
                <span className="font-semibold text-app-text">{w.label}</span>
                <span className="font-semibold tabular-nums text-app-text">{fmtNum(w.total)}</span>
              </div>
              <Lines lines={w.lines} />
            </Card>
          ))}
          <Card className="border-neutral-600">
            <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-neutral-700 pb-1.5">
              <span className="font-bold uppercase text-app-text">Subtotal {p.name}</span>
              <span className="font-bold tabular-nums text-app-text">{fmtNum(p.subtotal.total)}</span>
            </div>
            <Lines lines={p.subtotal.lines} />
          </Card>
        </div>
      ))}
      <Card className="border-brand-neon/50">
        <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-neutral-700 pb-1.5">
          <span className="font-bold uppercase text-brand-neon">Total branch</span>
          <span className="font-bold tabular-nums text-app-text">{fmtNum(cards.total.total)}</span>
        </div>
        <Lines lines={cards.total.lines} />
      </Card>
    </div>
  )
}

function LedgerCardList({ days }) {
  if (days.length === 0) return <p className="py-10 text-center text-sm text-neutral-500">No movement in this period for these filters.</p>
  const part = (label, v, tone) => <span key={label} className={tone}>{label} {fmtNum(Math.abs(v))}</span>
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
      {days.map((d) => (
        <div key={d.date} className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">{longDate(d.date)}</p>
          {d.warehouses.map((w) => (
            <Card key={w.label}>
              <p className="mb-1 border-b border-neutral-800 pb-1.5 font-semibold text-app-text">{w.label}</p>
              {w.lines.map((l, i) => (
                <div key={i} className="border-b border-neutral-800/60 py-1.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words text-neutral-200">{l.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-app-text">{l.end == null ? '-' : fmtNum(l.end)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-neutral-500">
                    {l.beg != null && <span>Beginning {fmtNum(l.beg)}</span>}
                    {l.shift != null && <span>Age shift {l.shift < 0 ? '-' : '+'}{fmtNum(Math.abs(l.shift))}</span>}
                    {l.adj != null && <span>Adjustment {l.adj < 0 ? '-' : '+'}{fmtNum(Math.abs(l.adj))}</span>}
                  </div>
                  {(l.adds.length > 0 || l.lesses.length > 0) && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums">
                      {l.adds.map((a) => part(`+ ${a.label}`, a.v, 'text-blue-400'))}
                      {l.lesses.map((a) => part(`- ${a.label}`, a.v, 'text-brand-crimson'))}
                    </div>
                  )}
                </div>
              ))}
            </Card>
          ))}
        </div>
      ))}
    </div>
  )
}

function FilterSheet({ draft, setDraft, provinces, warehouses, view, onApply, onReset, onClose }) {
  const all = draft.warehouseIds == null
  const toggleWh = (id) => {
    const set = new Set(all ? warehouses.map((w) => w.warehouseId) : draft.warehouseIds)
    if (set.has(id)) set.delete(id); else set.add(id)
    setDraft({ ...draft, warehouseIds: set.size === warehouses.length ? null : set })
  }
  const selectClass = 'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
  const labelClass = 'mt-3 block text-xs text-neutral-400'
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/60 sm:items-start sm:justify-end sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:mt-14 sm:w-80 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-app-text">Filter and sort</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-950 p-1.5 text-neutral-400"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <label className={labelClass}>Warehouse names
            <select className={selectClass} value={draft.combine ? 'c' : 's'} onChange={(e) => setDraft({ ...draft, combine: e.target.value === 'c' })}>
              <option value="s">Separate</option>
              <option value="c">Combined</option>
            </select>
          </label>
          <label className={labelClass}>Province
            <select className={selectClass} value={draft.provinceId} onChange={(e) => setDraft({ ...draft, provinceId: e.target.value })}>
              <option value="">All provinces</option>
              {provinces.map((p) => <option key={p.provinceId} value={p.provinceId}>{p.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>Commodity
            <select className={selectClass} value={draft.commodity} onChange={(e) => setDraft({ ...draft, commodity: e.target.value })}>
              <option value="">All</option><option value="Palay">Palay</option><option value="Rice">Rice</option><option value="By Products">By-products</option>
            </select>
          </label>
          <label className={labelClass}>Rice age brackets
            <select className={selectClass} value={draft.ageSet} onChange={(e) => setDraft({ ...draft, ageSet: e.target.value })}>
              <option value="coarse">0-3 and over 3 months</option>
              <option value="fine">0-3, 3.1-6, 6.1-9, 9.1-12, over 12</option>
            </select>
          </label>
          {view === 'summary' && (
            <label className={labelClass}>Sort warehouses
              <select className={selectClass} value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value })}>
                <option value="name">Name A-Z</option><option value="stock">Most stock first</option>
              </select>
            </label>
          )}
          <div className={`${labelClass} flex items-center justify-between`}>
            <span>Warehouses</span>
            <button type="button" className="text-brand-neon" onClick={() => setDraft({ ...draft, warehouseIds: all ? new Set() : null })}>{all ? 'Clear all' : 'Select all'}</button>
          </div>
          <div className="mt-1 space-y-1">
            {warehouses.map((w) => (
              <label key={w.warehouseId} className="flex items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" checked={all || draft.warehouseIds.has(w.warehouseId)} onChange={() => toggleWh(w.warehouseId)} />
                <span className="break-words">{w.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onReset} className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300">Reset</button>
          <button type="button" onClick={onApply} className="flex-1 rounded-xl bg-brand-neon px-3 py-2 text-sm font-semibold text-brand-contrast">Apply</button>
        </div>
      </div>
    </div>
  )
}

function InventoryReportsModal({ onClose }) {
  const [entered, setEntered] = useState(false)
  const [view, setView] = useState('hub')
  const today = todayLocalISO()
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const [asOf, setAsOf] = useState(today)
  const [unit, setUnit] = useState('b')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [draft, setDraft] = useState(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [exporting, setExporting] = useState(false)
  const toRef = useRef(null)
  const narrow = useIsNarrow()

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const piles = useLiveQuery(() => db.piles.toArray(), [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [])
  const warehousesRaw = useLiveQuery(() => db.warehouses.toArray(), [])
  const provinces = useLiveQuery(() => db.provinces.toArray(), [])
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), [])
  const transactionTypes = useLiveQuery(() => db.transactionTypes.toArray(), [])
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const loading = [piles, transactions, warehousesRaw, provinces, varieties, transactionTypes].some((x) => x === undefined)
  const warehouses = useMemo(() => [...(warehousesRaw ?? [])].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [warehousesRaw])

  const built = useMemo(() => {
    if (loading || (view !== 'summary' && view !== 'ledger')) return null
    const ctx = makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: filters.combine, ageSet: filters.ageSet })
    const inputs = { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null }
    const f = { warehouseIds: filters.warehouseIds, provinceId: filters.provinceId || null, commodity: filters.commodity || null }
    const scope = filters.provinceId ? (provinces.find((p) => p.provinceId === filters.provinceId)?.name ?? '').toUpperCase() : 'ALBAY BRANCH'
    const end = to < from ? from : to
    try {
      if (view === 'summary') {
        const summary = buildSummary(ctx, inputs, { asOf, filters: f, sort: filters.sort })
        return { model: summaryModel(summary, unit, { asOf, scope }), cards: narrow ? summaryCards(summary, unit) : null }
      }
      const ledger = buildLedger(ctx, inputs, { from, to: end, filters: f })
      return { model: ledgerModel(ledger, unit, { from, to: end, scope }), cards: narrow ? ledgerCards(ledger, unit) : null }
    } catch (err) {
      console.error(err)
      return { model: { title: '', subtitle: '', head: [], rows: [], edges: [], tones: [], empty: 'Could not build this report.' }, cards: null }
    }
  }, [loading, view, piles, transactions, warehouses, provinces, varieties, transactionTypes, config, filters, from, to, asOf, unit, narrow])
  const model = built?.model ?? null

  const activeFilters = [filters.combine, filters.provinceId, filters.commodity, filters.warehouseIds, filters.sort !== 'name', filters.ageSet !== 'coarse'].filter(Boolean).length

  const handleExport = async () => {
    if (!model || model.empty) return
    setExporting(true)
    try {
      const { exportModelToExcel } = await import('../../utils/inventoryExcel.js')
      const stamp = view === 'summary' ? asOf : `${from}_to_${to}`
      await exportModelToExcel(model, { fileName: `${view === 'summary' ? 'inventory-summary' : 'daily-inventory'}-${stamp}`, sheetName: view === 'summary' ? 'Summary' : 'Daily inventory' })
    } catch (err) {
      console.error(err)
      toast.error('Could not create the Excel file')
    } finally {
      setExporting(false)
    }
  }

  const title = view === 'ledger' ? 'Daily inventory' : view === 'summary' ? 'Summary' : 'Inventory reports'
  const back = () => (view === 'hub' ? onClose() : setView('hub'))
  const pillButton = 'flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 disabled:opacity-40'

  return createPortal(
    <div className={`fixed inset-0 z-[80] flex flex-col bg-neutral-950 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}>
      <div className="mx-auto flex w-full max-w-[110rem] items-center justify-between gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={back} aria-label="Back" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-300"><ArrowLeft size={18} /></button>
          <h2 className="truncate text-base font-semibold text-app-text">{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {view === 'hub' && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[['ledger', 'Daily inventory', 'Per day: ADD and LESS by type, ending stock, by warehouse and variety'],
              ['summary', 'Summary', 'Stock by warehouse, variety and age bracket with province subtotals']].map(([id, name, desc]) => (
              <button key={id} type="button" onClick={() => setView(id)} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left transition-colors hover:border-neutral-600">
                <span className="min-w-0"><span className="block text-sm font-semibold text-app-text">{name}</span><span className="block text-xs text-neutral-500">{desc}</span></span>
                <ChevronRight size={16} className="shrink-0 text-neutral-500" />
              </button>
            ))}
          </div>
        )}

        {(view === 'ledger' || view === 'summary') && (
          <>
            <div className="mb-2 flex flex-wrap items-end gap-x-2 gap-y-2">
              {view === 'ledger' ? (
                <>
                  <div className="w-[calc(50%-0.25rem)] sm:w-40"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">From</p><CalendarDatePicker value={from} label="Start Date" onChange={(iso) => { setFrom(iso); toRef.current?.open() }} /></div>
                  <div className="w-[calc(50%-0.25rem)] sm:w-40"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">To</p><CalendarDatePicker ref={toRef} value={to} label="End Date" onChange={setTo} /></div>
                </>
              ) : (
                <div className="w-full sm:w-44"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">As of</p><CalendarDatePicker value={asOf} label="As of" onChange={setAsOf} /></div>
              )}
              <div className={`flex items-center ${CONTROL_H}`}>
                <PillToggle options={[{ value: 'b', label: 'Net bags' }, { value: 'mt', label: 'MT' }]} value={unit} onChange={setUnit} />
              </div>
              <div className={`flex items-center ${CONTROL_H}`}>
                <button type="button" onClick={() => { setDraft(filters); setShowFilters(true) }} className={pillButton}>
                  <SlidersHorizontal size={14} /> Filter and sort{activeFilters > 0 && <span className="rounded-full bg-brand-neon px-1.5 text-[10px] font-bold text-brand-contrast">{activeFilters}</span>}
                </button>
              </div>
              <span className="hidden flex-1 sm:block" />
              <div className={`flex items-center ${CONTROL_H}`}>
                <button type="button" onClick={handleExport} disabled={exporting || !model || !!model.empty} className={pillButton}>
                  <FileSpreadsheet size={14} /> {exporting ? 'Creating…' : 'Excel'}
                </button>
              </div>
            </div>
            {loading || !built ? <p className="py-10 text-center text-sm text-neutral-500">Loading…</p> : (
              <>
                <p className="mb-2 text-xs text-neutral-400">{model.subtitle}</p>
                {narrow && built.cards
                  ? (view === 'summary' ? <SummaryCardList cards={built.cards} /> : <LedgerCardList days={built.cards} />)
                  : <ModelTable model={model} />}
              </>
            )}
            {showFilters && (
              <FilterSheet
                draft={draft} setDraft={setDraft} provinces={provinces ?? []} warehouses={warehouses} view={view}
                onApply={() => { setFilters(draft); setShowFilters(false) }}
                onReset={() => setDraft(DEFAULT_FILTERS)}
                onClose={() => setShowFilters(false)}
              />
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

export default InventoryReportsModal
