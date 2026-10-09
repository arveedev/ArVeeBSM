// Stock Desk (Admin and Visitor; Admin decides which screens a Visitor sees). Google Sheet export is Admin only. Opened from the quiet icon on the
// Home > Stocks title row. READ-ONLY: every figure is computed from the pile
// and transaction records already in the app (see utils/inventoryLots.js and
// utils/inventoryReport.js); nothing here adds, changes or deletes data.
//
// Views: Daily inventory (per day, ADD / LESS by type, ending stock) and
// Summary (stock per warehouse x variety x age bracket, province subtotals).
// Wide screens get the table; phones get cards. Filters and sort live behind
// one "Filter and sort" button to keep the screen clean.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { ArrowLeft, X, SlidersHorizontal, FileSpreadsheet, ChevronRight, Sheet, ClipboardList, Table, Hourglass, Wheat, Factory, FlaskConical, ShieldCheck, Boxes } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { todayLocalISO } from '../../utils/calculations.js'
import {
  makeContext, buildSummary, buildLedger, summaryModel, ledgerModel, summaryCards, ledgerCards, longDate,
  buildAgeLists, buildChecks, checksModel, computeOpeningBase, toUnit,
} from '../../utils/inventoryReport.js'
import { buildProcurementStatus, monthOptions, monthLabel } from '../../utils/procurementStatus.js'
import { buildEndingStockData, endingStockModels } from '../../utils/endingStockReport.js'
import { canViewReport } from '../../utils/inventoryReportsAccess.js'
import { modelToSheet, postInventorySheet } from '../../services/inventorySheetExport.js'
import { buildCpfHistory } from '../../utils/cpfHistory.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'
import LiquidationReport from './LiquidationReport.jsx'
import InventoryOpeningEditor from './InventoryOpeningEditor.jsx'
import PillToggle from './PillToggle.jsx'
import useCrosshair from '../../hooks/useCrosshair.js'
import useEscapeKey from '../../hooks/useEscapeKey.js'
import useBodyScrollLock from '../../hooks/useBodyScrollLock.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import { SdOverlay, ExpandCard } from './StockDeskUi.jsx'

const BANK_KEY = 'inv.bankProvince'
const readBank = () => { try { return localStorage.getItem(BANK_KEY) ?? 'Albay' } catch { return 'Albay' } }
const DEFAULT_FILTERS = { combine: false, provinceId: '', commodity: '', warehouseIds: null, sort: 'name', ageSet: 'coarse', bank: 'Albay', showByProducts: false }
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
  day: 'bg-emerald-950/70 text-sm font-bold text-emerald-300',
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
const ROW_BORDER = { total: 'border-t-2 border-neutral-500', end: 'border-y border-neutral-500', day: 'border-t-[6px] border-emerald-700' }

// Left edge of a column: a strong line where a new warehouse/commodity starts,
// a lighter one where a new variety starts.
const edgeClass = (e) => (e === 'wh' ? 'border-l-2 border-l-emerald-500/70' : e === 'var' ? 'border-l border-l-neutral-500' : '')
const headTone = (t) => (t === 1 ? 'bg-sky-950 text-sky-300' : 'bg-emerald-950 text-emerald-300')

const COUNT_MS = 550
const closeButtonClass = 'rounded-lg border border-brand-crimson/40 bg-neutral-900 p-1.5 text-brand-crimson transition-colors hover:bg-brand-crimson/10'
const backButtonClass = 'rounded-lg border border-brand-amber/40 bg-neutral-900 p-1.5 text-brand-amber transition-colors hover:bg-brand-amber/10'

function ModelTable({ model, short = false, onNote }) {
  const boxRef = useRef(null)
  const wrapRef = useRef(null)
  const prevRef = useRef(null)
  const widthRef = useRef(0)
  const rafRef = useRef(0)
  const runningRef = useRef(null)
  const bodyRef = useRef(null)
  const [entering, setEntering] = useState(null)
  useCrosshair(boxRef)

  // What happens when the model changes, using only transform, opacity and text changes (nothing that makes
  // the browser lay the table out again on every frame, which is what made it stutter):
  //  - columns appear or disappear (Combined, By-products, a bracket set): the table eases from its old width
  //    to the new one and the new columns fade in;
  //  - same rows and columns with other numbers (another as-of date, another month, net bags to MT): the
  //    numbers that changed run from the old value to the new one, like the Home totals;
  //  - other rows (another date range, another month's weeks): the rows rise in.
  useLayoutEffect(() => {
    const prev = prevRef.current
    prevRef.current = model
    const wrap = wrapRef.current
    const width = wrap ? wrap.offsetWidth : 0
    const before = widthRef.current
    widthRef.current = width
    // a running count is finished first, so no number is ever left half way
    cancelAnimationFrame(rafRef.current)
    if (runningRef.current) {
      for (const it of runningRef.current.items) { it.node.nodeValue = fmtNum(it.to); it.td.style.minWidth = '' }
      runningRef.current = null
    }
    if (!prev || !wrap || model.empty || prev.empty) return undefined
    const colsSame = Boolean(model.colKeys && prev.colKeys) && prev.colKeys.length === model.colKeys.length && prev.colKeys.every((k, i) => k === model.colKeys[i])
    if (model.colKeys && prev.colKeys && !colsSame) {
      const added = new Set(model.colKeys.filter((k) => !prev.colKeys.includes(k)))
      if (added.size > 0) { setEntering(added); setTimeout(() => setEntering(null), 800) }
      if (before && width && before !== width && wrap.animate) {
        wrap.animate(
          [{ transform: `scaleX(${Math.max(0.5, Math.min(2, before / width))})`, opacity: 0.55 }, { transform: 'scaleX(1)', opacity: 1 }],
          { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        )
      }
      return undefined
    }
    const sameRows = prev.rows.length === model.rows.length && prev.rows.every((r, i) => r.first === model.rows[i].first)
    if (colsSame && sameRows) {
      const items = [...(boxRef.current?.querySelectorAll('td[data-r]') ?? [])].map((td) => {
        const from = prev.rows[Number(td.dataset.r)]?.cells[Number(td.dataset.c)]
        const to = model.rows[Number(td.dataset.r)]?.cells[Number(td.dataset.c)]
        return from != null && to != null && from !== to && td.firstChild ? { td, node: td.firstChild, from, to } : null
      }).filter(Boolean)
      if (items.length === 0) return undefined
      // each cell keeps the room its widest figure needs while the numbers run, so the columns do not move
      for (const it of items) it.td.style.minWidth = `${Math.max(fmtNum(it.from).length, fmtNum(it.to).length) + 1.5}ch`
      const start = performance.now()
      const tick = (now) => {
        const t = Math.min(1, (now - start) / COUNT_MS)
        const eased = 1 - Math.pow(1 - t, 3)
        for (const it of items) it.node.nodeValue = fmtNum(t < 1 ? it.from + (it.to - it.from) * eased : it.to)
        if (t < 1) rafRef.current = requestAnimationFrame(tick)
        else { for (const it of items) it.td.style.minWidth = ''; runningRef.current = null }
      }
      runningRef.current = { items }
      for (const it of items) it.node.nodeValue = fmtNum(it.from)
      rafRef.current = requestAnimationFrame(tick)
      return undefined
    }
    const body = bodyRef.current
    if (body?.animate) body.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    return undefined
  }, [model])
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  if (model.empty) return <p className="py-10 text-center text-sm text-neutral-500">{model.empty}</p>
  const isNew = (key) => Boolean(entering && key != null && entering.has(key))
  return (
    <div ref={boxRef} className={`sd-table overflow-auto rounded-xl border border-neutral-800 ${short ? 'max-h-[60vh]' : 'min-h-0 flex-1'}`}>
      <div ref={wrapRef} className="w-max min-w-full">
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
                    const grows = !first && h.span === 1 && isNew(model.colKeys?.[idx])
                    const fades = !first && h.span > 1 && model.colKeys?.slice(idx, idx + h.span).some(isNew)
                    return (
                      <th
                        key={ci}
                        colSpan={h.span}
                        rowSpan={first ? model.head.length : 1}
                        className={`sticky h-7 whitespace-nowrap border-b border-r border-neutral-800 px-2 font-semibold ${first ? 'left-0 z-30 min-w-[11rem] bg-emerald-950 text-left text-emerald-300' : `z-20 text-center min-w-[4.75rem] ${grows || fades ? 'sd-col-in' : ''} ${headTone(h.tone)} ${edgeClass(model.edges[idx])}`}`}
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
          <tbody ref={bodyRef}>
            {model.rows.map((r, i) => (
              <tr key={i} className={`${ROW_STYLE[r.kind] ?? ''} ${ROW_BORDER[r.kind] ?? ''}`}>
                <td className={`sticky left-0 z-[5] min-w-[11rem] max-w-[18rem] whitespace-normal break-words border-b border-r border-neutral-800 bg-neutral-950 px-2 py-1 text-left ${r.kind === 'add' || r.kind === 'less' ? 'pl-5' : ''}`}>
                  {r.first}
                </td>
                {r.kind === 'section' || r.kind === 'day' || r.kind === 'add-label' || r.kind === 'less-label'
                  ? <td colSpan={model.edges.length} className="border-b border-neutral-800" />
                  : r.cells.map((v, ci) => (
                    <td
                      key={ci}
                      {...(v != null ? { 'data-r': i, 'data-c': ci } : {})}
                      onClick={r.notes?.[ci] ? () => onNote?.({ title: `${r.first} · ${model.colTitles?.[ci] ?? ''}`, sub: r.day ? longDate(r.day) : '', lines: r.notes[ci] }) : undefined}
                      className={`whitespace-nowrap border-b border-r border-neutral-800 px-2 py-1 text-right ${isNew(model.colKeys?.[ci]) ? 'sd-col-in' : ''} ${model.tones[ci] === 1 ? 'bg-white/[0.04]' : ''} ${edgeClass(model.edges[ci])} ${r.notes?.[ci] ? 'cursor-pointer underline decoration-dotted underline-offset-2 hover:bg-white/10' : ''}`}
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
          <span className={`min-w-0 break-words ${l.total ? 'font-bold uppercase text-app-text' : 'text-neutral-300'}`}>{l.label}</span>
          <span className={`shrink-0 tabular-nums text-app-text ${l.total ? 'font-bold' : ''}`}>{fmtNum(l.value)}</span>
        </div>
      </div>
    )
  })
}

function SummaryCardList({ cards }) {
  if (cards.provinces.length === 0) return <p className="py-10 text-center text-sm text-neutral-500">No stock found for these filters.</p>
  return (
    <div className="sd-fade-in min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
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
    <div className="sd-fade-in min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
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
                    {l.adj != null && <span>Pile closed {l.adj < 0 ? '-' : '+'}{fmtNum(Math.abs(l.adj))}</span>}
                    {l.move != null && <span>Age move {l.move < 0 ? '-' : '+'}{fmtNum(Math.abs(l.move))}</span>}
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
function NoteModal({ note, open, unit, onClose }) {
  const total = note.lines.reduce((sum, l) => sum + l.value, 0)
  return (
    <SdOverlay open={open} onClose={onClose} z="z-[95]" panelClassName="sd-table flex max-h-[80vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:max-w-xl sm:rounded-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-app-text">{note.title}</h3>
          {note.sub && <p className="text-sm text-neutral-400">{note.sub}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={closeButtonClass}><X size={16} /></button>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {note.lines.map((l, i) => (
          <div key={i} className="flex items-start justify-between gap-3 border-b border-neutral-800 py-2 last:border-0">
            <div className="min-w-0">
              <p className="break-words text-base font-semibold text-neutral-100">{l.doc}</p>
              <p className="break-words text-sm leading-snug text-neutral-300">{[l.customer, l.pile].filter(Boolean).join(' · ')}</p>
            </div>
            <span className="shrink-0 text-base tabular-nums text-app-text">{fmtNum(l.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between border-t border-neutral-700 pt-2 text-base font-semibold text-app-text">
        <span>Total {unit === 'mt' ? '(MT)' : '(net bags)'}</span><span className="tabular-nums">{fmtNum(total)}</span>
      </div>
    </SdOverlay>
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
  <ExpandCard title={title} tone={tone} count={items.length}>
    {items.length === 0 ? <p className="py-1 text-sm text-neutral-400">{ok}</p> : items.map(render)}
  </ExpandCard>
)
const checkLine = (left, right, key) => (
  <div key={key} className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
    <span className="min-w-0 break-words text-neutral-300">{left}</span><span className="shrink-0 tabular-nums text-app-text">{right}</span>
  </div>
)

// The stock book proves itself against itself each time Data check opens (see buildSelfCheck).
function SelfCheckCard({ results }) {
  if (results.length === 0) return null
  const failing = results.filter((r) => !r.ok).length
  return (
    <ExpandCard title={`Stock book self-check · ${failing === 0 ? 'every check passed' : 'something does not add up'}`} tone="text-brand-crimson" count={failing}>
      {results.map((r, i) => (
        <div key={i} className="border-b border-neutral-800 py-1 last:border-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words text-neutral-300">{r.title}</span>
            <span className={`shrink-0 text-xs font-bold ${r.ok ? 'text-brand-neon' : 'text-brand-crimson'}`}>{r.ok ? 'OK' : 'CHECK'}</span>
          </div>
          {!r.ok && r.detail.map((d, k) => <p key={k} className="break-words text-[11px] text-amber-400">{d}</p>)}
          {!r.ok && r.more > 0 && <p className="text-[11px] text-neutral-500">and {r.more} more.</p>}
        </div>
      ))}
    </ExpandCard>
  )
}

// Month-end stock per province from the Stock Book (so an opening-balance override shows here too).
function EndingStockView({ data, setMonth, unit, setUnit }) {
  const [exporting, setExporting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const exportExcel = async () => {
    setExporting(true)
    try {
      const { exportModelsToExcel } = await import('../../utils/inventoryExcel.js')
      await exportModelsToExcel(data.tables.map((model, i) => ({ model, sheetName: i === 0 ? 'Paddy' : 'Local rice' })), { fileName: `ending-stock-per-variety-${data.month}` })
    } catch (err) {
      console.error(err)
      toast.error('Could not create the Excel file')
    } finally {
      setExporting(false)
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <div className="mb-2 flex flex-wrap items-end gap-x-2 gap-y-2">
        <div className={`flex items-center ${CONTROL_H}`}>
          <select value={data.month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200">
            {data.options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div className={`flex items-center ${CONTROL_H}`}>
          <PillToggle options={[{ value: 'b', label: 'Net bags' }, { value: 'mt', label: 'MT' }]} value={unit} onChange={setUnit} />
        </div>
        <span className="hidden flex-1 sm:block" />
        <div className={`flex items-center ${CONTROL_H}`}>
          <button type="button" onClick={() => setConfirming(true)} disabled={exporting} className="flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 disabled:opacity-40">
            <FileSpreadsheet size={14} /> {exporting ? 'Creating…' : 'Excel'}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming} title="Export to Excel?" description="The two ending stock tables are saved as one Excel file with a sheet each."
        confirmLabel="Export" icon={FileSpreadsheet} destructive={false}
        onConfirm={() => { setConfirming(false); exportExcel() }} onCancel={() => setConfirming(false)}
      />
      <h3 className="text-sm font-bold text-app-text">{data.heading}</h3>
      <p className="mb-3 text-xs text-neutral-500">
        Stock as of {longDate(data.asOf)}, from the Stock Book (an opening balance an Admin saved is included). By-products are not part of this form.
      </p>
      {data.tables.map((model) => (
        <div key={model.title} className="mb-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-300">{model.title}</p>
          <ModelTable model={model} short />
        </div>
      ))}
    </div>
  )
}

function CheckView({ checks, unit }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-6">
      <SelfCheckCard results={checks.selfCheck ?? []} />
      <CheckSection title="Warehouses using a start-date override" tone="text-amber-400" items={checks.overrides} ok="None. Every warehouse follows the Data Start Date."
        render={(o, i) => checkLine(o.warehouse, `starts after ${fmtDay(o.date)}`, i)} />
      <CheckSection title="Authorized more than the stock available" tone="text-brand-crimson" items={checks.overAuthorized ?? []} ok="No authority reserves more than the warehouse had."
        render={(o, i) => checkLine(`AI ${o.aiNumber} · ${o.warehouse} · ${o.variety} · ${fmtDay(o.date)}${o.ageGroup ? ` · age ${o.ageGroup}` : ''}`, `${fmtNum(toUnit(o.kilos, unit))} short`, i)} />
      <CheckSection title="Authority age group blank or unreadable (deducted from the oldest stock)" tone="text-amber-400" items={checks.noAgeGroup ?? []} ok="Every authority names a readable age group."
        render={(o, i) => checkLine(`AI ${o.aiNumber} · ${o.warehouse} · ${o.variety} · ${fmtDay(o.date)}${o.ageGroup ? ` · "${o.ageGroup}"` : ''}`, fmtNum(toUnit(o.kilos, unit)), i)} />
      <ExpandCard title="WSI not covered by an authority (not deducted from the inventory)" tone="text-amber-400" count={(checks.uncoveredWsi ?? []).length}>
        {(checks.uncoveredWsi ?? []).length === 0 ? <p className="py-1 text-sm text-neutral-400">Every WSI belongs to an authority that reserves stock.</p> : (checks.uncoveredWsi ?? []).slice(0, 80).map((o, i) => checkLine(`WSI ${o.serial} · ${o.warehouse}${o.aiNumber ? ` · AI ${o.aiNumber}` : ' · no AI'} · ${fmtDay(o.date)}`, fmtNum(toUnit(o.kilos, unit)), i))}
        {(checks.uncoveredWsi ?? []).length > 80 && <p className="pt-1 text-xs text-neutral-500">and {(checks.uncoveredWsi ?? []).length - 80} more.</p>}
      </ExpandCard>
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
    <div className="sd-fade-in min-h-0 flex-1 space-y-2 overflow-y-auto pb-6">
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

function FilterSheet({ open, draft, setDraft, provinces, warehouses, view, onApply, onReset, onClose }) {
  const all = draft.warehouseIds == null
  const toggleWh = (id) => {
    const set = new Set(all ? warehouses.map((w) => w.warehouseId) : draft.warehouseIds)
    if (set.has(id)) set.delete(id); else set.add(id)
    setDraft({ ...draft, warehouseIds: set.size === warehouses.length ? null : set })
  }
  const selectClass = 'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
  const labelClass = 'mt-3 block text-xs text-neutral-400'
  return (
    <SdOverlay open={open} onClose={onClose} align="sheet" z="z-[90]" panelClassName="sd-table flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:mt-14 sm:w-80 sm:rounded-2xl">
      <>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-app-text">Filter and sort</h3>
          <button type="button" onClick={onClose} aria-label="Close" className={closeButtonClass}><X size={16} /></button>
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
      </>
    </SdOverlay>
  )
}

function InventoryReportsModal({ onClose, isAdmin = false }) {
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
  const [endingMonth, setEndingMonth] = useState(null)
  const [closing, setClosing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [openingOpen, setOpeningOpen] = useState(false)
  const [confirmExport, setConfirmExport] = useState(null)
  const toRef = useRef(null)
  const narrow = useIsNarrow()

  useBodyScrollLock(true)

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

  // a screen an Admin has made Admin only is closed for a Visitor even if it was open when the setting changed
  const mayOpen = (id) => canViewReport(id, isAdmin, config?.inventoryReportsAccess)
  useEffect(() => { if (view !== 'hub' && !mayOpen(view)) setView('hub') }, [view, isAdmin, config?.inventoryReportsAccess])

  // The heavy part (stock, ledger, checks) does not depend on the unit, so changing net bags / MT only
  // re-lays the tables out and never recomputes any stock.
  const data = useMemo(() => {
    if (loading || !['summary', 'ledger', 'age', 'check', 'procurement', 'ending'].includes(view) || (view === 'check' && !canViewReport('check', isAdmin, config?.inventoryReportsAccess))) return null
    const ctx = makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: filters.combine, ageSet: filters.ageSet, opening: config?.inventoryOpening ?? null, ageBasis: view === 'age' ? 'exact' : 'month' })
    const inputs = { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, authorities, reserve: true }
    const f = { warehouseIds: filters.warehouseIds, provinceId: filters.provinceId || null, commodity: filters.commodity || null, byProducts: filters.showByProducts || filters.commodity === 'By Products' }
    const scope = filters.provinceId ? (provinces.find((p) => p.provinceId === filters.provinceId)?.name ?? '').toUpperCase() : 'ALBAY BRANCH'
    const end = to < from ? from : to
    try {
      if (view === 'ending') {
        const options = monthOptions(startISO ?? config?.dataStartDate, today)
        const chosen = endingMonth && options.includes(endingMonth) ? endingMonth : (options[1] ?? options[0])
        return { kind: 'ending', ending: buildEndingStockData(ctx, inputs, { month: chosen, todayISO: today, provinceNames: provinces.map((p) => p.name) }), month: chosen, options }
      }
      if (view === 'procurement') {
        if (!sdoUsers || !ledgerRows || !activePrs) return null
        const cpfEvents = buildCpfHistory({ sdoUsers, ledger: ledgerRows, activePrs, config, warehouses, provinces })
        const r = buildProcurementStatus({
          transactions, warehouses, provinces, varieties, transactionTypes, globalDataStartDate: config?.dataStartDate ?? null,
          cpfEvents, month, todayISO: today, startISO, bankProvinceName: filters.bank || null, branchName: branches?.[0]?.name ?? 'ALBAY BRANCH',
        })
        return { kind: 'procurement', model: r.model, cards: narrow ? r.cards : null }
      }
      if (view === 'check') return { kind: 'check', checks: buildChecks(ctx, inputs, { asOf, todayISO: today }) }
      if (view === 'summary' || view === 'age') {
        return {
          kind: 'summary', summary: buildSummary(ctx, inputs, { asOf, filters: f, sort: filters.sort }), scope,
          lists: view === 'age' ? buildAgeLists(ctx, inputs, { asOf, filters: f, windowDays }) : null,
        }
      }
      return { kind: 'ledger', ledger: buildLedger(ctx, inputs, { from, to: end, filters: f }), scope, end }
    } catch (err) {
      console.error(err)
      return { kind: 'error' }
    }
  }, [loading, view, piles, transactions, warehouses, provinces, varieties, transactionTypes, config, filters, from, to, asOf, narrow, windowDays, today, month, endingMonth, startISO, authorities, isAdmin, sdoUsers, ledgerRows, activePrs, branches])

  const built = useMemo(() => {
    if (!data) return null
    if (data.kind === 'ending') return { ending: { ...endingStockModels(data.ending, unit), month: data.month, options: data.options } }
    if (data.kind === 'procurement') return { model: data.model, cards: data.cards }
    if (data.kind === 'check') return { checks: data.checks, model: null }
    if (data.kind === 'summary') {
      const model = summaryModel(data.summary, unit, { asOf, scope: data.scope })
      if (view === 'age') model.title = 'AGE MONITORING'
      return { model, cards: narrow ? summaryCards(data.summary, unit) : null, lists: data.lists }
    }
    if (data.kind === 'ledger') return { model: ledgerModel(data.ledger, unit, { from, to: data.end, scope: data.scope }), cards: narrow ? ledgerCards(data.ledger, unit) : null }
    return { model: { title: '', subtitle: '', head: [], rows: [], edges: [], tones: [], empty: 'Could not build this report.' }, cards: null }
  }, [data, unit, narrow, asOf, from, view])
  const model = built?.model ?? null

  const activeFilters = [filters.provinceId, filters.commodity, filters.warehouseIds, filters.sort !== 'name', filters.ageSet !== 'coarse'].filter(Boolean).length

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
    const baseCells = computeOpeningBase(ctx, { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, authorities, reserve: true }, date)
    setOpeningEditor({ date, baseCells })
    setOpeningOpen(true)
  }
  const closeOpeningEditor = () => { setOpeningOpen(false); setTimeout(() => setOpeningEditor(null), 220) }
  const openNote = (n) => { setNoteView(n); setNoteOpen(true) }
  const closeNote = () => { setNoteOpen(false); setTimeout(() => setNoteView(null), 220) }

  const handleSheet = async () => {
    const settings = config?.inventorySheet
    if (!settings?.webAppUrl) { toast.error('Set up Sheet Export first (Admin Dashboard > System > Sheet Export)'); return }
    if (loading || !isAdmin) return
    setSheetBusy(true)
    setSheetResult(null)
    try {
      const ref = view === 'ledger' ? (to < from ? from : to) : asOf
      const monthStart = clampStart(`${ref.slice(0, 8)}01`)
      const f = { warehouseIds: filters.warehouseIds, provinceId: filters.provinceId || null, commodity: filters.commodity || null, byProducts: filters.showByProducts || filters.commodity === 'By Products' }
      const scope = filters.provinceId ? (provinces.find((p) => p.provinceId === filters.provinceId)?.name ?? '').toUpperCase() : 'ALBAY BRANCH'
      const inputs = { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, authorities, reserve: true }
      const mk = (ageSet, ageBasis = 'month') => makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: filters.combine, ageSet, opening: config?.inventoryOpening ?? null, ageBasis })
      const ctx = mk(filters.ageSet)
      const sheets = [
        modelToSheet(summaryModel(buildSummary(ctx, inputs, { asOf: ref, filters: f, sort: filters.sort }), 'b', { asOf: ref, scope }), 'SUMMARY'),
        modelToSheet(ledgerModel(buildLedger(ctx, inputs, { from: monthStart, to: ref, filters: f }), 'b', { from: monthStart, to: ref, scope }), ref.slice(0, 7)),
        modelToSheet(summaryModel(buildSummary(mk('fine', 'exact'), inputs, { asOf: ref, filters: f, sort: filters.sort }), 'mt', { asOf: ref, scope }), 'WAREHOUSE_AGE_MT'),
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

  const title = { ledger: 'Daily inventory', summary: 'Summary', age: 'Age monitoring', check: 'Data check', procurement: 'Daily procurement status', ending: 'Ending stock per variety', milling: 'Milling liquidation', test: 'Test milling liquidation' }[view] ?? 'Stock Desk'
  // Leaving plays an exit animation before the next screen enters.
  const requestClose = () => { if (closing) return; setClosing(true); setTimeout(onClose, 200) }
  const navigate = (next) => { if (leaving || next === view) return; setLeaving(true); setTimeout(() => { setView(next); setLeaving(false) }, 190) }
  const back = () => (view === 'hub' ? requestClose() : navigate('hub'))
  // Escape goes back one step: to the menu, then out of the Stock Desk. A sheet or dialog that is open closes first
  // (it handles Escape itself), and Escape in a text field only leaves the field.
  useEscapeKey(true, (e) => {
    if (document.querySelector('[data-sd-overlay]')) return
    const t = e?.target
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
    back()
  })
  const pillButton = 'flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 disabled:opacity-40'

  return createPortal(
    <div className={`fixed inset-0 z-[80] flex flex-col bg-neutral-950 ${closing ? 'sd-pop-out' : 'sd-pop-in'}`}>
      <div className="mx-auto flex w-full max-w-[110rem] items-center justify-between gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={back} aria-label="Back" className={backButtonClass}><ArrowLeft size={18} /></button>
          <h2 className="truncate text-base font-semibold text-app-text">{title}</h2>
        </div>
        <button type="button" onClick={requestClose} aria-label="Close" className={closeButtonClass}><X size={18} /></button>
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {view === 'hub' && (
          <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pb-6 sm:grid-cols-2 lg:grid-cols-3">
            {!isAdmin && !['ledger', 'summary', 'age', 'ending', 'procurement', 'milling', 'test', 'check'].some(mayOpen) && <p className="col-span-full py-6 text-center text-sm text-neutral-500">No reports are shared with you yet.</p>}
            {[
              { id: 'ledger', name: 'Daily inventory', desc: 'Per day: ADD and LESS by type, ending stock, by warehouse and variety', Icon: ClipboardList },
              { id: 'summary', name: 'Summary', desc: 'Stock by warehouse, variety and age bracket with province subtotals', Icon: Table },
              { id: 'age', name: 'Age monitoring', desc: 'Age brackets per variety, stock moving to the next bracket, oldest stock', Icon: Hourglass },
              { id: 'ending', name: 'Ending stock per variety', desc: 'Month-end stock per province: paddy by variety and local rice (the NFA ending stock balance form)', Icon: Boxes },
              { id: 'procurement', name: 'Daily procurement status', desc: 'PD and PW bags per day, per province, with the CPF balance', Icon: Wheat },
              { id: 'milling', name: 'Milling liquidation', desc: 'Regular milling per ricemill: issues, receipts, by-products, summary', Icon: Factory },
              { id: 'test', name: 'Test milling liquidation', desc: 'Test milling per ricemill: TMO and trials, by-products, summary', Icon: FlaskConical },
              { id: 'check', name: 'Data check', desc: 'Overrides in use, shortages, over-authorized stock, approximate ages, unassigned documents', Icon: ShieldCheck },
            ].filter((t) => canViewReport(t.id, isAdmin, config?.inventoryReportsAccess)).map(({ id, name, desc, Icon }, n) => (
              <button
                key={id} type="button" onClick={() => navigate(id)} style={{ animationDelay: leaving ? `${n * 15}ms` : `${n * 50}ms` }}
                className={`flex min-h-[68px] items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-left sm:min-h-[116px] sm:gap-4 sm:p-5 transition-colors hover:border-brand-neon/60 hover:bg-neutral-800/60 ${leaving ? 'sd-tile-out' : 'sd-tile-in'}`}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-brand-neon sm:h-14 sm:w-14"><Icon size={24} /></span>
                <span className="min-w-0 flex-1"><span className="block text-base font-semibold text-app-text sm:text-lg">{name}</span><span className="mt-0.5 hidden text-sm leading-snug text-neutral-400 sm:block">{desc}</span></span>
                <ChevronRight size={20} className="shrink-0 text-neutral-500" />
              </button>
            ))}
          </div>
        )}

        <div className={`flex min-h-0 flex-1 flex-col ${view === 'hub' ? 'hidden' : leaving ? 'sd-slide-out' : 'sd-slide-in'}`} key={view}>
        {view === 'ending' && (loading || !built?.ending
          ? <p className="py-10 text-center text-sm text-neutral-500">Loading…</p>
          : <EndingStockView data={built.ending} setMonth={setEndingMonth} unit={unit} setUnit={setUnit} narrow={narrow} />)}

        {(view === 'milling' || view === 'test') && narrow && (
          <div className="sd-fade-in mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-950 text-brand-neon"><Factory size={24} /></span>
            <p className="text-base font-semibold text-app-text">{view === 'test' ? 'Test milling liquidation' : 'Milling liquidation'} needs a larger screen</p>
            <p className="text-sm leading-snug text-neutral-400">The liquidation is a wide form with many columns and cannot be read on a phone. Open it on a tablet or a computer.</p>
          </div>
        )}
        {(view === 'milling' || view === 'test') && !narrow && (loading || !sackTypes
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
              {['ledger', 'summary', 'age'].includes(view) && (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <PillToggle options={[{ value: false, label: 'Separate' }, { value: true, label: 'Combined' }]} value={filters.combine} onChange={(v) => setFilters({ ...filters, combine: v })} />
                </div>
              )}
              <div className={`flex items-center ${CONTROL_H}`}>
                <button type="button" onClick={() => { setDraft(filters); setShowFilters(true) }} className={pillButton}>
                  <SlidersHorizontal size={14} /> Filter and sort{activeFilters > 0 && <span className="rounded-full bg-brand-neon px-1.5 text-[10px] font-bold text-brand-contrast">{activeFilters}</span>}
                </button>
              </div>
              <span className="hidden flex-1 sm:block" />
              {['ledger', 'summary', 'age'].includes(view) && (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <button
                    type="button" role="switch" aria-checked={filters.showByProducts}
                    onClick={() => setFilters({ ...filters, showByProducts: !filters.showByProducts })}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${filters.showByProducts ? 'border-brand-neon text-brand-neon' : 'border-neutral-700 bg-neutral-900 text-neutral-400'}`}
                  >
                    <span className={`relative h-3.5 w-6 rounded-full ${filters.showByProducts ? 'bg-brand-neon' : 'bg-neutral-700'}`}><span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-neutral-950 transition-all ${filters.showByProducts ? 'left-3' : 'left-0.5'}`} /></span>
                    By-products
                  </button>
                </div>
              )}
              {view === 'ledger' && isAdmin && (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <button type="button" onClick={openOpeningEditor} disabled={loading} className={pillButton}>
                    Opening balance{config?.inventoryOpening && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Override active" />}
                  </button>
                </div>
              )}
              {isAdmin && (view === 'ledger' || view === 'summary' || view === 'age') && (
                <div className={`flex items-center ${CONTROL_H}`}>
                  <button type="button" onClick={handleSheet} disabled={sheetBusy || loading} className={pillButton}>
                    <Sheet size={14} /> {sheetBusy ? 'Sending…' : 'Google Sheet'}
                  </button>
                </div>
              )}
              <div className={`flex items-center ${CONTROL_H}`}>
                <button type="button" onClick={() => setConfirmExport({ what: title, run: handleExport })} disabled={exporting || !model || !!model.empty || view === 'check'} className={pillButton}>
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
                    {view === 'procurement' && <p className="mb-2 text-xs text-neutral-400">{model.subtitle}</p>}
                    {view === 'age' ? (
                      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                        {narrow && built.cards ? <SummaryCardList key={asOf} cards={built.cards} /> : <ModelTable model={model} short onNote={openNote} />}
                        {built.lists && <AgeLists lists={built.lists} unit={unit} />}
                      </div>
                    ) : narrow && built.cards
                      ? (view === 'summary' ? <SummaryCardList key={asOf} cards={built.cards} /> : view === 'procurement' ? <ProcurementCardList key={month} lines={built.cards} /> : <LedgerCardList key={`${from}|${to}`} days={built.cards} onNote={openNote} />)
                      : <ModelTable model={model} onNote={openNote} />}
                  </>
                )}
              </>
            )}
            {noteView && <NoteModal note={noteView} open={noteOpen} unit={unit} onClose={closeNote} />}
            {openingEditor && (
              <InventoryOpeningEditor
                open={openingOpen}
                date={openingEditor.date} ageSet={filters.ageSet} baseCells={openingEditor.baseCells} existing={config?.inventoryOpening ?? null}
                warehouses={warehouses} provinces={provinces ?? []} varieties={varieties} onClose={closeOpeningEditor}
              />
            )}
            <FilterSheet
              open={showFilters}
              draft={draft} setDraft={setDraft} provinces={provinces ?? []} warehouses={warehouses} view={view}
              onApply={() => { setFilters(draft); try { localStorage.setItem(BANK_KEY, draft.bank ?? '') } catch { /* optional */ } setShowFilters(false) }}
              onReset={() => setDraft({ ...DEFAULT_FILTERS, bank: draft.bank, combine: draft.combine, showByProducts: draft.showByProducts })}
              onClose={() => setShowFilters(false)}
            />
          </>
        )}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirmExport)} title="Export to Excel?" description={confirmExport ? `${confirmExport.what} will be saved as an Excel file.` : ''}
        confirmLabel="Export" icon={FileSpreadsheet} destructive={false}
        onConfirm={() => { const run = confirmExport?.run; setConfirmExport(null); run?.() }} onCancel={() => setConfirmExport(null)}
      />
    </div>,
    document.body
  )
}

export default InventoryReportsModal
