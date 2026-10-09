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
import { ArrowLeft, X, SlidersHorizontal, FileSpreadsheet, ChevronRight, Sheet, ClipboardList, Table, Hourglass, Wheat, Factory, FlaskConical, ShieldCheck } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { todayLocalISO } from '../../utils/calculations.js'
import {
  makeContext, buildSummary, buildLedger, summaryModel, ledgerModel, summaryCards, ledgerCards, longDate,
  buildAgeLists, buildChecks, checksModel, computeOpeningBase, toUnit,
} from '../../utils/inventoryReport.js'
import { buildProcurementStatus, monthOptions, monthLabel } from '../../utils/procurementStatus.js'
import { modelToSheet, postInventorySheet } from '../../services/inventorySheetExport.js'
import { buildCpfHistory } from '../../utils/cpfHistory.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'
import LiquidationReport from './LiquidationReport.jsx'
import InventoryOpeningEditor from './InventoryOpeningEditor.jsx'
import PillToggle from './PillToggle.jsx'
import useCrosshair from '../../hooks/useCrosshair.js'

const BANK_KEY = 'inv.bankProvince'
const readBank = () => { try { return localStorage.getItem(BANK_KEY) ?? 'Albay' } catch { return 'Albay' } }
const DEFAULT_FILTERS = { combine: false, provinceId: '', commodity: '', warehouseIds: null, sort: 'name', ageSet: 'coarse', bank: 'Albay', lessSource: 'authority' }
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
  week: 'bg-neutral-900 font-semibold text-app-text',
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

function ModelTable({ model, short = false, onNote }) {
  const boxRef = useRef(null)
  useCrosshair(boxRef)
  if (model.empty) return <p className="py-10 text-center text-sm text-neutral-500">{model.empty}</p>
  return (
    <div ref={boxRef} className={`overflow-auto rounded-xl border border-neutral-800 ${short ? "max-h-[60vh]" : "min-h-0 flex-1"}`}>
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
                  <td
                    key={ci}
                    onClick={r.notes?.[ci] ? () => onNote?.({ title: `${r.first} · ${model.colTitles?.[ci] ?? ''}`, sub: r.day ? longDate(r.day) : '', lines: r.notes[ci] }) : undefined}
                    className={`whitespace-nowrap border-b border-r border-neutral-800 px-2 py-1 text-right ${model.tones[ci] === 1 ? 'bg-white/[0.04]' : ''} ${edgeClass(model.edges[ci])} ${r.notes?.[ci] ? 'cursor-pointer underline decoration-dotted underline-offset-2 hover:bg-white/10' : ''}`}
                    title={r.notes?.[ci] ? 'Tap to see the transactions' : undefined}
                  >
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

function LedgerCardList({ days, onNote }) {
  if (days.length === 0) return <p className="py-10 text-center text-sm text-neutral-500">No movement in this period for these filters.</p>
  const part = (label, v, tone, lines, title, day) => (lines
    ? <button key={label} type="button" onClick={() => onNote?.({ title, sub: longDate(day), lines })} className={`${tone} underline decoration-dotted underline-offset-2`}>{label} {fmtNum(Math.abs(v))}</button>
    : <span key={label} className={tone}>{label} {fmtNum(Math.abs(v))}</span>)
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
                    {l.adj != null && <span>Adjustment {l.adj < 0 ? '-' : '+'}{fmtNum(Math.abs(l.adj))}</span>}
                  </div>
                  {(l.adds.length > 0 || l.lesses.length > 0) && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums">
                      {l.adds.map((a) => part(`+ ${a.label}`, a.v, 'text-blue-400', a.lines, `${w.label} · ${l.label} · ${a.label}`, d.date))}
                      {l.lesses.map((a) => part(`- ${a.label}`, a.v, 'text-brand-crimson', a.lines, `${w.label} · ${l.label} · ${a.label}`, d.date))}
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

const fmtDay = (iso) => longDate(iso)

// The documents behind one ADD / LESS value (what the old sheet showed as a cell note).
function NoteModal({ note, unit, onClose }) {
  const total = note.lines.reduce((s, l) => s + l.value, 0)
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end bg-black/70 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold text-app-text">{note.title}</h3>
            {note.sub && <p className="text-xs text-neutral-500">{note.sub}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-950 p-1.5 text-neutral-400"><X size={16} /></button>
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {note.lines.map((l, i) => (
            <div key={i} className="flex items-start justify-between gap-3 border-b border-neutral-800 py-1.5 text-sm last:border-0">
              <div className="min-w-0">
                <p className="break-words font-medium text-neutral-200">{l.doc}</p>
                <p className="break-words text-[11px] text-neutral-500">{[l.customer, l.pile].filter(Boolean).join(' · ')}</p>
              </div>
              <span className="shrink-0 tabular-nums text-app-text">{fmtNum(l.value)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-neutral-700 pt-2 text-sm font-semibold text-app-text">
          <span>Total {unit === 'mt' ? '(MT)' : '(net bags)'}</span><span className="tabular-nums">{fmtNum(total)}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

function AgeLists({ lists, unit }) {
  const row = (l, i, moving) => (
    <div key={i} className="border-b border-neutral-800 py-1.5 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm text-neutral-200">{l.warehouse} · {l.variety} · {l.pile}</p>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-app-text">{fmtNum(toUnit(l.kilos, unit))}</span>
      </div>
      <p className="text-[11px] text-neutral-500">Received {fmtDay(l.lotDate)}{l.approx ? ' (approximate)' : ''} · {l.months.toFixed(1)} months</p>
      {moving && (
        <p className="mt-0.5 text-xs">
          <span className="text-neutral-400">Moving to </span>
          <span className="rounded bg-sky-950 px-1.5 py-0.5 font-semibold text-sky-300">{l.nextLabel}</span>
          <span className="text-neutral-500"> on {fmtDay(l.crossDate)}</span>
        </p>
      )}
    </div>
  )
  const part = (list, byProducts) => list.filter((l) => (l.commodity === 'By Products') === byProducts)
  const section = (title, tone, list, empty, moving) => (
    <Card key={title}>
      <p className={`mb-1 text-xs font-bold uppercase tracking-wide ${tone}`}>{title}</p>
      {list.length === 0 && <p className="py-3 text-sm text-neutral-500">{empty}</p>}
      {list.map((l, i) => row(l, i, moving))}
    </Card>
  )
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {section('Moving to the next bracket soon · palay and rice', 'text-brand-neon', part(lists.crossing, false), 'Nothing moves to the next bracket in this window.', true)}
        {section('Moving to the next bracket soon · by-products', 'text-brand-neon', part(lists.crossing, true), 'Nothing moves to the next bracket in this window.', true)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {section('Oldest stock on hand · palay and rice', 'text-neutral-400', part(lists.oldest, false), 'No stock found.', false)}
        {section('Oldest stock on hand · by-products', 'text-neutral-400', part(lists.oldest, true), 'No stock found.', false)}
      </div>
    </div>
  )
}

const CheckSection = ({ title, tone, items, render, ok }) => (
  <Card>
    <p className={`mb-1 text-xs font-bold uppercase tracking-wide ${items.length ? tone : 'text-brand-neon'}`}>{title}</p>
    {items.length === 0 ? <p className="py-1 text-sm text-neutral-400">{ok}</p> : items.map(render)}
  </Card>
)
const checkLine = (left, right, key) => (
  <div key={key} className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
    <span className="min-w-0 break-words text-neutral-300">{left}</span><span className="shrink-0 tabular-nums text-app-text">{right}</span>
  </div>
)

function CheckView({ checks, unit }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-6">
      <CheckSection title="Warehouses using a start-date override" tone="text-amber-400" items={checks.overrides} ok="None. Every warehouse follows the Data Start Date."
        render={(o, i) => checkLine(o.warehouse, `starts after ${fmtDay(o.date)}`, i)} />
      <CheckSection title="Authorized more than the stock available" tone="text-brand-crimson" items={checks.overAuthorized ?? []} ok="No authority reserves more than the warehouse had."
        render={(o, i) => checkLine(`AI ${o.aiNumber} · ${o.warehouse} · ${o.variety} · ${fmtDay(o.date)}`, `${fmtNum(toUnit(o.kilos, unit))} short`, i)} />
      <CheckSection title="Issued more than was received" tone="text-brand-crimson" items={checks.shortages} ok="No pile has issued more than it received."
        render={(o, i) => (
          <div key={i} className="border-b border-neutral-800 py-1 last:border-0">
            {checkLine(o.name, `${fmtNum(o.bags)} bags over`, `h${i}`)}
            {o.events.map((e, k) => (
              <p key={k} className="text-[11px] text-neutral-500">{e.kind} {e.serial} · <span className="font-semibold text-neutral-300">{e.type}</span> · {e.date ? fmtDay(e.date) : ''} · {fmtNum(e.bags)} bags over</p>
            ))}
          </div>
        )} />
      <CheckSection title="Rebuilt stock differs from the pile balance (today)" tone="text-brand-crimson" items={checks.mismatches} ok="Every open pile matches its stored balance."
        render={(o, i) => (
          <div key={i} className="border-b border-neutral-800 py-1 last:border-0">
            {checkLine(o.name, `${fmtNum(toUnit(o.rebuilt, unit))} vs ${fmtNum(toUnit(o.stored, unit))}`, `m${i}`)}
            {o.note && <p className="text-[11px] font-semibold text-amber-400">{o.note}</p>}
          </div>
        )} />
      <CheckSection title="Age is approximate (no readable Date Received)" tone="text-amber-400" items={checks.approx} ok="Every lot has a readable receipt date."
        render={(o, i) => checkLine(`${o.name} · from ${fmtDay(o.date)}`, fmtNum(toUnit(o.kilos, unit)), i)} />
      <CheckSection title="Documents not assigned to a pile" tone="text-amber-400" items={checks.unassigned} ok="No receipt or issue is waiting for a pile."
        render={(o, i) => checkLine(`${o.type} ${o.serial} · ${o.warehouse} · ${fmtDay(o.date)}`, `${fmtNum(o.bags)} bags`, i)} />
    </div>
  )
}

function ProcurementCardList({ lines }) {
  const shown = lines.filter((l) => l.kind !== 'row' || l.groups.some((g) => g.total > 0))
  if (shown.length === 0) return <p className="py-10 text-center text-sm text-neutral-500">No procurement in this month yet.</p>
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-6">
      {shown.map((l, i) => (
        <Card key={i} className={l.kind === 'total' ? 'border-brand-neon/50' : l.kind === 'week' ? 'border-neutral-600' : ''}>
          <p className={`mb-1 border-b border-neutral-800 pb-1.5 ${l.kind === 'row' ? 'font-semibold text-app-text' : 'font-bold uppercase text-brand-neon'}`}>{l.label}</p>
          {l.groups.map((g) => (
            <div key={g.name} className="py-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-neutral-200">{g.name}</span>
                <span className="font-semibold tabular-nums text-app-text">{fmtNum(g.total)}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-[11px] tabular-nums text-neutral-500">
                <span>PD {fmtNum(g.pd)}</span><span>PW {fmtNum(g.pw)}</span>{g.cpf != null && <span>CPF balance {fmtNum(g.cpf)}</span>}
              </div>
            </div>
          ))}
        </Card>
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
          {view === 'procurement' ? (
            <label className={labelClass}>Add Cash in Bank to
              <select className={selectClass} value={draft.bank ?? ''} onChange={(e) => setDraft({ ...draft, bank: e.target.value })}>
                <option value="">Not added to any province</option>
                {provinces.map((p) => <option key={p.provinceId} value={p.name}>{p.name}</option>)}
              </select>
            </label>
          ) : (<>
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
          <label className={labelClass}>Age brackets
            <select className={selectClass} value={draft.ageSet} onChange={(e) => setDraft({ ...draft, ageSet: e.target.value })}>
              <option value="coarse">Rice 0-3 and over 3; palay 0-6, 6.1-12, over 12</option>
              <option value="fine">Rice 0-3, 3.1-6, 6.1-9, 9.1-12, over 12</option>
              <option value="monthly">Monthly (0.1-1.0, 1.1-2.0, ...)</option>
            </select>
          </label>
          {['ledger', 'summary', 'age'].includes(view) && (
            <label className={labelClass}>LESS is taken from
              <select className={selectClass} value={draft.lessSource} onChange={(e) => setDraft({ ...draft, lessSource: e.target.value })}>
                <option value="authority">Authorities (reserved stock)</option>
                <option value="wsi">WSI (stock actually issued)</option>
              </select>
            </label>
          )}
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
          </>)}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onReset} className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300">Reset</button>
          <button type="button" onClick={onApply} className="flex-1 rounded-xl bg-brand-neon px-3 py-2 text-sm font-semibold text-brand-contrast">Apply</button>
        </div>
      </div>
    </div>
  )
}

function InventoryReportsModal({ onClose, isAdmin = false }) {
  const [entered, setEntered] = useState(false)
  const [view, setView] = useState('hub')
  const today = todayLocalISO()
  const [from, setFromRaw] = useState(`${today.slice(0, 8)}01`)
  const [to, setToRaw] = useState(today)
  const [asOf, setAsOfRaw] = useState(today)
  const [unit, setUnit] = useState('b')
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, bank: readBank() }))
  const [draft, setDraft] = useState(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [openingEditor, setOpeningEditor] = useState(null)
  const [noteView, setNoteView] = useState(null)
  const [sheetResult, setSheetResult] = useState(null)
  const [windowDays, setWindowDays] = useState(30)
  const [month, setMonth] = useState(today.slice(0, 7))
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
  // Reports start the day after the Data Start Date (September 1, 2026): no earlier date can be chosen.
  const startISO = config?.dataStartDate ? new Date(Date.parse(`${config.dataStartDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null
  const clampStart = (iso) => (startISO && iso < startISO ? startISO : iso)
  const setFrom = (iso) => { if (startISO && iso < startISO) toast(`Reports start on ${longDate(startISO)}`); setFromRaw(clampStart(iso)) }
  const setTo = (iso) => { if (startISO && iso < startISO) toast(`Reports start on ${longDate(startISO)}`); setToRaw(clampStart(iso)) }
  const setAsOf = (iso) => { if (startISO && iso < startISO) toast(`Reports start on ${longDate(startISO)}`); setAsOfRaw(clampStart(iso)) }
  useEffect(() => {
    if (!startISO) return
    setFromRaw((v) => (v < startISO ? startISO : v))
    setToRaw((v) => (v < startISO ? startISO : v))
    setAsOfRaw((v) => (v < startISO ? startISO : v))
  }, [startISO])
  const sdoUsers = useLiveQuery(() => db.users.where('role').equals('SDO').toArray(), [])
  const ledgerRows = useLiveQuery(() => db.cashLedgerV2.toArray(), [])
  const activePrs = useLiveQuery(() => db.purchaseReceipts.where('status').equals('Active').toArray(), [])
  const branches = useLiveQuery(() => db.branches.toArray(), [])
  const authorities = useLiveQuery(() => db.authorities.toArray(), [])
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), [])
  const loading = [piles, transactions, warehousesRaw, provinces, varieties, transactionTypes, authorities].some((x) => x === undefined)
  const warehouses = useMemo(() => [...(warehousesRaw ?? [])].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [warehousesRaw])

  const built = useMemo(() => {
    if (loading || !['summary', 'ledger', 'age', 'check', 'procurement'].includes(view) || (view === 'check' && !isAdmin)) return null
    const ctx = makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: filters.combine, ageSet: filters.ageSet, opening: config?.inventoryOpening ?? null })
    const inputs = { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, authorities, reserve: filters.lessSource !== 'wsi' }
    const f = { warehouseIds: filters.warehouseIds, provinceId: filters.provinceId || null, commodity: filters.commodity || null }
    const scope = filters.provinceId ? (provinces.find((p) => p.provinceId === filters.provinceId)?.name ?? '').toUpperCase() : 'ALBAY BRANCH'
    const end = to < from ? from : to
    try {
      if (view === 'procurement') {
        if (!sdoUsers || !ledgerRows || !activePrs) return null
        const cpfEvents = buildCpfHistory({ sdoUsers, ledger: ledgerRows, activePrs, config, warehouses, provinces })
        const r = buildProcurementStatus({
          transactions, warehouses, provinces, varieties, transactionTypes, globalDataStartDate: config?.dataStartDate ?? null,
          cpfEvents, month, todayISO: today, startISO, bankProvinceName: filters.bank || null, branchName: branches?.[0]?.name ?? 'ALBAY BRANCH',
        })
        return { model: r.model, cards: narrow ? r.cards : null }
      }
      if (view === 'check') return { checks: buildChecks(ctx, inputs, { asOf, todayISO: today }), model: null }
      if (view === 'summary' || view === 'age') {
        const summary = buildSummary(ctx, inputs, { asOf, filters: f, sort: filters.sort })
        const model = summaryModel(summary, unit, { asOf, scope })
        if (view === 'age') model.title = 'AGE MONITORING'
        return {
          model, cards: narrow ? summaryCards(summary, unit) : null,
          lists: view === 'age' ? buildAgeLists(ctx, inputs, { asOf, filters: f, windowDays }) : null,
        }
      }
      const ledger = buildLedger(ctx, inputs, { from, to: end, filters: f })
      return { model: ledgerModel(ledger, unit, { from, to: end, scope }), cards: narrow ? ledgerCards(ledger, unit) : null }
    } catch (err) {
      console.error(err)
      return { model: { title: '', subtitle: '', head: [], rows: [], edges: [], tones: [], empty: 'Could not build this report.' }, cards: null }
    }
  }, [loading, view, piles, transactions, warehouses, provinces, varieties, transactionTypes, config, filters, from, to, asOf, unit, narrow, windowDays, today, month, startISO, authorities, isAdmin, sdoUsers, ledgerRows, activePrs, branches])
  const model = built?.model ?? null

  const activeFilters = [filters.combine, filters.provinceId, filters.commodity, filters.warehouseIds, filters.sort !== 'name', filters.ageSet !== 'coarse', filters.lessSource === 'wsi'].filter(Boolean).length

  const handleExport = async () => {
    if (!model || model.empty) return
    setExporting(true)
    try {
      const { exportModelToExcel } = await import('../../utils/inventoryExcel.js')
      const stamp = view === 'ledger' ? `${from}_to_${to}` : asOf
      await exportModelToExcel(model, { fileName: `${{ summary: 'inventory-summary', age: 'age-monitoring', ledger: 'daily-inventory' }[view]}-${stamp}`, sheetName: { summary: 'Summary', age: 'Age monitoring', ledger: 'Daily inventory' }[view] })
    } catch (err) {
      console.error(err)
      toast.error('Could not create the Excel file')
    } finally {
      setExporting(false)
    }
  }

  // One tap sends the four report tabs: SUMMARY, the month's daily ledger,
  // WAREHOUSE_AGE_MT and DATA_CHECK. Reads only; the Apps Script writes the sheet.
  const openOpeningEditor = () => {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    const ctx = makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: false, ageSet: filters.ageSet })
    const baseCells = computeOpeningBase(ctx, { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, authorities, reserve: filters.lessSource !== 'wsi' }, date)
    setOpeningEditor({ date, baseCells })
  }

  const handleSheet = async () => {
    const settings = config?.inventorySheet
    if (!settings?.webAppUrl) { toast.error('Set up Sheet Export first (Admin Dashboard > System > Sheet Export)'); return }
    if (loading) return
    setSheetBusy(true)
    setSheetResult(null)
    try {
      const ref = view === 'ledger' ? (to < from ? from : to) : asOf
      const monthStart = clampStart(`${ref.slice(0, 8)}01`)
      const f = { warehouseIds: filters.warehouseIds, provinceId: filters.provinceId || null, commodity: filters.commodity || null }
      const scope = filters.provinceId ? (provinces.find((p) => p.provinceId === filters.provinceId)?.name ?? '').toUpperCase() : 'ALBAY BRANCH'
      const inputs = { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, authorities, reserve: filters.lessSource !== 'wsi' }
      const mk = (ageSet) => makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: filters.combine, ageSet, opening: config?.inventoryOpening ?? null })
      const ctx = mk(filters.ageSet)
      const sheets = [
        modelToSheet(summaryModel(buildSummary(ctx, inputs, { asOf: ref, filters: f, sort: filters.sort }), 'b', { asOf: ref, scope }), 'SUMMARY'),
        modelToSheet(ledgerModel(buildLedger(ctx, inputs, { from: monthStart, to: ref, filters: f }), 'b', { from: monthStart, to: ref, scope }), ref.slice(0, 7)),
        modelToSheet(summaryModel(buildSummary(mk('fine'), inputs, { asOf: ref, filters: f, sort: filters.sort }), 'mt', { asOf: ref, scope }), 'WAREHOUSE_AGE_MT'),
        ...(isAdmin ? [modelToSheet(checksModel(buildChecks(ctx, inputs, { asOf: ref, todayISO: today }), 'b', { asOf: ref }), 'DATA_CHECK')] : []),
      ]
      sheets[2].values[0][0] = 'WAREHOUSE AGE (MT)'
      const res = await postInventorySheet(settings, 'writeInventoryReport', { sheets })
      if (res.ok) { setSheetResult({ written: res.written, url: res.spreadsheetUrl }); toast.success('Google Sheet updated') }
      else toast.error(res.message ?? 'Could not reach the Google Sheet. Check Sheet Export in the Admin Dashboard.')
    } catch (err) {
      console.error(err)
      toast.error('Could not send to the Google Sheet')
    } finally {
      setSheetBusy(false)
    }
  }

  const title = { ledger: 'Daily inventory', summary: 'Summary', age: 'Age monitoring', check: 'Data check', procurement: 'Daily procurement status', milling: 'Milling liquidation', test: 'Test milling liquidation' }[view] ?? 'Inventory reports'
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
            {[
              { id: 'ledger', name: 'Daily inventory', desc: 'Per day: ADD and LESS by type, ending stock, by warehouse and variety', Icon: ClipboardList },
              { id: 'summary', name: 'Summary', desc: 'Stock by warehouse, variety and age bracket with province subtotals', Icon: Table },
              { id: 'age', name: 'Age monitoring', desc: 'Age brackets per variety, stock moving to the next bracket, oldest stock', Icon: Hourglass },
              { id: 'procurement', name: 'Daily procurement status', desc: 'PD and PW bags per day, per province, with the CPF balance', Icon: Wheat },
              { id: 'milling', name: 'Milling liquidation', desc: 'Regular milling per ricemill: issues, receipts, by-products, summary', Icon: Factory },
              { id: 'test', name: 'Test milling liquidation', desc: 'Test milling per ricemill: TMO and trials, by-products, summary', Icon: FlaskConical },
              ...(isAdmin ? [{ id: 'check', name: 'Data check', desc: 'Overrides in use, shortages, over-authorized stock, approximate ages, unassigned documents', Icon: ShieldCheck }] : []),
            ].map(({ id, name, desc, Icon }) => (
              <button key={id} type="button" onClick={() => setView(id)} className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left transition-colors hover:border-neutral-600">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-brand-neon"><Icon size={18} /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-app-text">{name}</span><span className="block text-xs text-neutral-500">{desc}</span></span>
                <ChevronRight size={16} className="shrink-0 text-neutral-500" />
              </button>
            ))}
          </div>
        )}

        {(view === 'milling' || view === 'test') && (loading || !sackTypes
          ? <p className="py-10 text-center text-sm text-neutral-500">Loading…</p>
          : (
            <LiquidationReport
              key={view} kind={view === 'test' ? 'TMO' : 'MO'} transactions={transactions} warehouses={warehouses} varieties={varieties}
              sackTypes={sackTypes} config={config} branch={branches?.[0] ?? null} isAdmin={isAdmin} narrow={narrow} today={today}
            />
          ))}

        {['ledger', 'summary', 'age', 'check', 'procurement'].includes(view) && (
          <>
            <div className="mb-2 flex flex-wrap items-end gap-x-2 gap-y-2">
              {view === 'procurement' ? (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200">
                    {monthOptions(startISO ?? config?.dataStartDate, today).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </div>
              ) : view === 'ledger' ? (
                <>
                  <div className="w-[calc(50%-0.25rem)] sm:w-40"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">From</p><CalendarDatePicker value={from} label="Start Date" onChange={(iso) => { setFrom(iso); toRef.current?.open() }} /></div>
                  <div className="w-[calc(50%-0.25rem)] sm:w-40"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">To</p><CalendarDatePicker ref={toRef} value={to} label="End Date" onChange={setTo} /></div>
                </>
              ) : (
                <div className="w-full sm:w-44"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">As of</p><CalendarDatePicker value={asOf} label="As of" onChange={setAsOf} /></div>
              )}
              {view === 'age' && (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200">
                    {[14, 30, 60, 90].map((d) => <option key={d} value={d}>Next {d} days</option>)}
                  </select>
                </div>
              )}
              {view !== 'procurement' && <div className={`flex items-center ${CONTROL_H}`}>
                <PillToggle options={[{ value: 'b', label: 'Net bags' }, { value: 'mt', label: 'MT' }]} value={unit} onChange={setUnit} />
              </div>}
              <div className={`flex items-center ${CONTROL_H}`}>
                <button type="button" onClick={() => { setDraft(filters); setShowFilters(true) }} className={pillButton}>
                  <SlidersHorizontal size={14} /> Filter and sort{activeFilters > 0 && <span className="rounded-full bg-brand-neon px-1.5 text-[10px] font-bold text-brand-contrast">{activeFilters}</span>}
                </button>
              </div>
              <span className="hidden flex-1 sm:block" />
              {view === 'ledger' && isAdmin && (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <button type="button" onClick={openOpeningEditor} disabled={loading} className={pillButton}>
                    Opening balance{config?.inventoryOpening && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Override active" />}
                  </button>
                </div>
              )}
              {(view === 'ledger' || view === 'summary' || view === 'age') && (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <button type="button" onClick={handleSheet} disabled={sheetBusy || loading} className={pillButton}>
                    <Sheet size={14} /> {sheetBusy ? 'Sending…' : 'Google Sheet'}
                  </button>
                </div>
              )}
              <div className={`flex items-center ${CONTROL_H}`}>
                <button type="button" onClick={handleExport} disabled={exporting || !model || !!model.empty || view === 'check'} className={pillButton}>
                  <FileSpreadsheet size={14} /> {exporting ? 'Creating…' : 'Excel'}
                </button>
              </div>
            </div>
            {sheetResult && (
              <p className="mb-2 text-xs text-emerald-300">
                Updated {sheetResult.written.join(', ')}. {sheetResult.url && <a className="underline" href={sheetResult.url} target="_blank" rel="noreferrer">Open the Google Sheet</a>}
              </p>
            )}
            {loading || !built ? <p className="py-10 text-center text-sm text-neutral-500">Loading…</p> : (
              <>
                {view === 'check' ? <CheckView checks={built.checks} unit={unit} /> : (
                  <>
                    <p className="mb-2 text-xs text-neutral-400">{model.subtitle}</p>
                    {['ledger', 'summary', 'age'].includes(view) && (
                      <p className="mb-2 text-xs text-neutral-500">
                        {filters.lessSource === 'wsi'
                          ? 'LESS shows stock actually issued (WSI).'
                          : 'LESS shows authorized stock (AI) from the day it is authorized: that stock is reserved, so it is no longer available.'}
                      </p>
                    )}
                    {config?.inventoryOpening && config.inventoryOpening.ageSet === filters.ageSet && ['ledger', 'summary', 'age'].includes(view) && (
                      <p className="mb-2 text-xs text-amber-400">Opening balance override applied from {longDate(config.inventoryOpening.date)} (Daily inventory, Summary and Age monitoring only).</p>
                    )}
                    {view === 'age' ? (
                      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                        {narrow && built.cards ? <SummaryCardList cards={built.cards} /> : <ModelTable model={model} short onNote={setNoteView} />}
                        {built.lists && <AgeLists lists={built.lists} unit={unit} />}
                      </div>
                    ) : narrow && built.cards
                      ? (view === 'summary' ? <SummaryCardList cards={built.cards} /> : view === 'procurement' ? <ProcurementCardList lines={built.cards} /> : <LedgerCardList days={built.cards} onNote={setNoteView} />)
                      : <ModelTable model={model} onNote={setNoteView} />}
                  </>
                )}
              </>
            )}
            {noteView && <NoteModal note={noteView} unit={unit} onClose={() => setNoteView(null)} />}
            {openingEditor && (
              <InventoryOpeningEditor
                date={openingEditor.date} ageSet={filters.ageSet} baseCells={openingEditor.baseCells} existing={config?.inventoryOpening ?? null}
                warehouses={warehouses} provinces={provinces ?? []} varieties={varieties} onClose={() => setOpeningEditor(null)}
              />
            )}
            {showFilters && (
              <FilterSheet
                draft={draft} setDraft={setDraft} provinces={provinces ?? []} warehouses={warehouses} view={view}
                onApply={() => { setFilters(draft); try { localStorage.setItem(BANK_KEY, draft.bank ?? '') } catch { /* optional */ } setShowFilters(false) }}
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
