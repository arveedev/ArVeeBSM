// Inventory Reports (Admin and Visitor). Opened from the quiet icon on the
// Home > Stocks title row. READ-ONLY: every figure is computed from the pile
// and transaction records already in the app (see utils/inventoryLots.js and
// utils/inventoryReport.js); nothing here adds, changes or deletes data.
//
// Views: Daily ledger (per day, ADD / LESS by type, ending stock) and Summary
// (stock per warehouse x variety x age bracket, province subtotals). Filters
// and sort live behind one "Filter and sort" button to keep the screen clean.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { ArrowLeft, X, SlidersHorizontal, FileSpreadsheet, ChevronRight } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { todayLocalISO } from '../../utils/calculations.js'
import { makeContext, buildSummary, buildLedger, summaryModel, ledgerModel } from '../../utils/inventoryReport.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'
import PillToggle from './PillToggle.jsx'

const DEFAULT_FILTERS = { combine: false, provinceId: '', commodity: '', warehouseIds: null, sort: 'name', ageSet: 'coarse' }
const fmtNum = (n) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ROW_STYLE = {
  section: 'bg-neutral-900 text-[11px] font-bold uppercase tracking-wide text-neutral-400',
  sub: 'bg-neutral-900 font-semibold text-app-text',
  total: 'border-t-2 border-neutral-600 bg-neutral-800 font-bold text-app-text',
  beg: 'bg-amber-500/10 text-app-text',
  end: 'border-y border-neutral-600 font-semibold text-app-text',
  'add-label': 'font-semibold text-blue-400',
  'less-label': 'font-semibold text-brand-crimson',
  add: 'text-blue-400',
  less: 'text-brand-crimson',
  row: 'text-neutral-200',
}

function ModelTable({ model }) {
  if (model.empty) return <p className="py-10 text-center text-sm text-neutral-500">{model.empty}</p>
  return (
    <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-xl border border-neutral-800">
      <table className="min-w-full border-separate border-spacing-0 text-xs tabular-nums">
        <thead>
          {model.head.map((row, ri) => (
            <tr key={ri}>
              {row.map((h, ci) => (
                <th
                  key={ci}
                  colSpan={h.span}
                  className={`sticky z-10 h-7 border-b border-r border-neutral-800 bg-emerald-950 px-2 text-center font-semibold text-emerald-300 ${ci === 0 ? 'left-0 z-20 min-w-[11rem] text-left' : ''}`}
                  style={{ top: `${ri * 1.75}rem` }}
                >
                  {h.t}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {model.rows.map((r, i) => {
            const style = ROW_STYLE[r.kind] ?? ''
            return (
              <tr key={i} className={style}>
                <td className={`sticky left-0 z-[5] min-w-[11rem] max-w-[18rem] whitespace-normal break-words border-b border-r border-neutral-800 bg-neutral-950 px-2 py-1 text-left ${r.kind === 'add' || r.kind === 'less' ? 'pl-5' : ''}`}>
                  {r.first}
                </td>
                {r.cells.map((v, ci) => (
                  <td key={ci} className="whitespace-nowrap border-b border-r border-neutral-800 px-2 py-1 text-right">
                    {v == null ? (r.dash ? '-' : '') : fmtNum(v)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
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
              <option value="s">Separate (BSI, BSI B, BSI C)</option>
              <option value="c">Combined (all shown as BSI)</option>
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
          <p className={`${labelClass} flex items-center justify-between`}>
            <span>Warehouses</span>
            <button type="button" className="text-brand-neon" onClick={() => setDraft({ ...draft, warehouseIds: all ? new Set() : null })}>{all ? 'Clear all' : 'Select all'}</button>
          </p>
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

  const model = useMemo(() => {
    if (loading || (view !== 'summary' && view !== 'ledger')) return null
    const ctx = makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: filters.combine, ageSet: filters.ageSet })
    const inputs = { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null }
    const f = {
      warehouseIds: filters.warehouseIds, provinceId: filters.provinceId || null, commodity: filters.commodity || null,
    }
    const scope = filters.provinceId ? (provinces.find((p) => p.provinceId === filters.provinceId)?.name ?? '').toUpperCase() : 'ALBAY BRANCH'
    try {
      if (view === 'summary') return summaryModel(buildSummary(ctx, inputs, { asOf, filters: f, sort: filters.sort }), unit, { asOf, scope })
      return ledgerModel(buildLedger(ctx, inputs, { from, to: to < from ? from : to, filters: f }), unit, { from, to: to < from ? from : to, scope })
    } catch (err) {
      console.error(err)
      return { title: '', subtitle: '', head: [], rows: [], empty: 'Could not build this report.' }
    }
  }, [loading, view, piles, transactions, warehouses, provinces, varieties, transactionTypes, config, filters, from, to, asOf, unit])

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

  return createPortal(
    <div className={`fixed inset-0 z-[80] flex flex-col bg-neutral-950 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}>
      <div className="mx-auto flex w-full max-w-[110rem] items-center justify-between gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={back} aria-label="Back" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-300"><ArrowLeft size={18} /></button>
          <h2 className="truncate text-base font-semibold text-app-text">{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col px-4 pb-4">
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
            <div className="mb-2 flex flex-wrap items-end gap-2">
              {view === 'ledger' ? (
                <>
                  <div className="w-36"><p className="text-[10px] uppercase text-neutral-500">From</p><CalendarDatePicker value={from} label="Start Date" onChange={(iso) => { setFrom(iso); toRef.current?.open() }} /></div>
                  <div className="w-36"><p className="text-[10px] uppercase text-neutral-500">To</p><CalendarDatePicker ref={toRef} value={to} label="End Date" onChange={setTo} /></div>
                </>
              ) : (
                <div className="w-40"><p className="text-[10px] uppercase text-neutral-500">As of</p><CalendarDatePicker value={asOf} onChange={setAsOf} /></div>
              )}
              <PillToggle options={[{ value: 'b', label: 'Net bags' }, { value: 'mt', label: 'MT' }]} value={unit} onChange={setUnit} />
              <button type="button" onClick={() => { setDraft(filters); setShowFilters(true) }} className="flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200">
                <SlidersHorizontal size={14} /> Filter and sort{activeFilters > 0 && <span className="rounded-full bg-brand-neon px-1.5 text-[10px] font-bold text-brand-contrast">{activeFilters}</span>}
              </button>
              <span className="flex-1" />
              <button type="button" onClick={handleExport} disabled={exporting || !model || !!model.empty} className="flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 disabled:opacity-40">
                <FileSpreadsheet size={14} /> {exporting ? 'Creating…' : 'Excel'}
              </button>
            </div>
            {loading || !model ? <p className="py-10 text-center text-sm text-neutral-500">Loading…</p> : (
              <>
                <p className="mb-2 text-xs text-neutral-400">{model.subtitle}</p>
                <ModelTable model={model} />
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
