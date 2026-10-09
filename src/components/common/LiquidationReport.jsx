// Milling Liquidation / Test Milling Liquidation per ricemill (Admin and Visitor),
// opened from Inventory Reports. One tab per ricemill. READ-ONLY on screen; the
// signatories appear only on the Excel and PDF files. Unit prices are shown as
// plain labels (the value from Admin > Milling Prices); only an Admin sees a small
// pencil to change one, and a change is the same stored value the settings show.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { SlidersHorizontal, FileSpreadsheet, FileText, X, Pencil } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { liveFormatNumber, parseFormattedNumber } from '../../utils/calculations.js'
import {
  buildMillingBatches, filterBatches, listMillers, buildLiquidationSections, millerStoreKey, summaryLineText,
} from '../../utils/millingLiquidation.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'

const { fmt2, fmt3, fmtInt } = summaryLineText
const CONTROL_H = 'h-[46px]'
const pillButton = 'flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 disabled:opacity-40'

// The wide printed layout only fits comfortably on large screens; below this the
// same figures are shown as cards, so nothing ever needs a horizontal scroll.
const useIsCompact = () => {
  const query = '(max-width: 1279px)'
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setCompact(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return compact
}

/** Saves one price for one ricemill on the shared settings record. */
export const saveMillingPrice = async (mk, product, value) => {
  const cur = await db.reportConfig.get('global')
  const key = millerStoreKey(mk)
  const mills = { ...(cur?.millingMills ?? {}) }
  mills[key] = { ...(mills[key] ?? {}), prices: { ...(mills[key]?.prices ?? {}), [millerStoreKey(product)]: value } }
  if (cur) await db.reportConfig.update('global', { millingMills: mills })
  else await db.reportConfig.put({ id: 'global', millingMills: mills })
}

/** A price shown as a label. Admin only: a pencil turns it into a field for one edit. */
function PriceCell({ value, isAdmin, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const start = () => { setText(liveFormatNumber(Number(value ?? 0).toFixed(2))); setEditing(true) }
  const finish = () => {
    const n = parseFormattedNumber(text)
    setEditing(false)
    if (n !== Number(value ?? 0)) onCommit(n)
  }
  if (editing) {
    return (
      <input
        autoFocus type="text" inputMode="decimal" value={text} aria-label="Unit price"
        onChange={(e) => setText(liveFormatNumber(e.target.value))} onBlur={finish}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false) }}
        className="w-24 rounded-lg border border-brand-neon bg-neutral-950 px-2 py-0.5 text-right text-sm tabular-nums text-app-text outline-none"
      />
    )
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums text-neutral-300">
      {fmt2(Number(value ?? 0))}
      {isAdmin && <button type="button" onClick={start} aria-label="Change unit price" className="rounded p-0.5 text-neutral-600 hover:text-neutral-300"><Pencil size={12} /></button>}
    </span>
  )
}

const cellClass = (c) => `border border-neutral-700 px-1 py-0.5 align-middle ${c.a === 'r' ? 'whitespace-nowrap text-right tabular-nums' : c.a === 'c' ? 'text-center' : 'text-left'} ${c.b ? 'font-semibold' : ''}`

/** The printed layout; wraps its text so it fits the width without scrolling. */
function GridTable({ section, boxRef }) {
  return (
    <div ref={boxRef} className="overflow-hidden rounded-xl border border-neutral-800">
      <table className="w-full border-collapse text-[10px] leading-tight">
        <thead>
          {section.head.map((row, ri) => (
            <tr key={ri} className="bg-emerald-950 text-emerald-300">
              {row.map((c, ci) => <th key={ci} colSpan={c.cs ?? 1} rowSpan={c.rs ?? 1} className="break-words border border-neutral-700 px-1 py-0.5 text-center font-semibold">{c.t}</th>)}
            </tr>
          ))}
        </thead>
        <tbody>
          {section.rows.map((r, ri) => (
            <tr key={ri} className={r.batchStart ? 'border-t-2 border-t-neutral-500' : ''}>
              {r.cells.map((c, ci) => <td key={ci} colSpan={c.cs ?? 1} rowSpan={c.rs ?? 1} className={`${cellClass(c)} whitespace-pre-line break-words text-neutral-200`}>{c.t}</td>)}
            </tr>
          ))}
          <tr className="border-t-2 border-t-neutral-500 bg-neutral-900">
            {section.totalCells.map((c, ci) => <td key={ci} colSpan={c.cs ?? 1} className={`${cellClass(c)} text-app-text`}>{c.t}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Summary({ section, isAdmin, onPrice, savedKey }) {
  const mk = section.millerKey
  const Row = ({ l, qty, isKilos }) => (
    <tr>
      <td className="py-0.5 pr-4 font-semibold text-app-text">{l.product}</td>
      <td className="py-0.5 pr-4 text-right tabular-nums text-neutral-300">{isKilos ? fmt3(qty) : fmt2(qty)}</td>
      <td className="py-0.5 pr-4 text-right"><PriceCell value={l.price} isAdmin={isAdmin} onCommit={(n) => onPrice(mk, l.product, n)} /></td>
      <td className="py-0.5 text-right tabular-nums text-app-text">{fmt3(l.amount)}</td>
    </tr>
  )
  return (
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">Summary</p>
        {savedKey === mk && <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] text-emerald-300">Price updated, saved for this ricemill</span>}
      </div>
      <table className="text-sm">
        <thead><tr className="text-[11px] uppercase text-neutral-500"><th className="pr-4 text-left">Local rice</th><th className="pr-4 text-right">Bags @ 50 kg</th><th className="pr-4 text-right">U.P.</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{section.summary.rice.map((l) => <Row key={l.product} l={l} qty={l.bags} />)}
          {section.summary.rice.length === 0 && <tr><td colSpan={4} className="py-1 text-neutral-500">No local rice received.</td></tr>}</tbody>
        {section.summary.byProducts.length > 0 && (
          <>
            <thead><tr className="text-[11px] uppercase text-neutral-500"><th className="pr-4 pt-3 text-left">Less: by-products</th><th className="pr-4 pt-3 text-right">Net kg</th><th className="pr-4 pt-3 text-right">U.P.</th><th className="pt-3 text-right">Amount</th></tr></thead>
            <tbody>
              {section.summary.byProducts.map((l) => <Row key={l.product} l={l} qty={l.kilos} isKilos />)}
              <tr className="border-t border-neutral-700"><td className="pt-1 font-bold text-app-text" colSpan={3}>TOTAL</td><td className="pt-1 text-right font-bold tabular-nums text-app-text">{fmt3(section.summary.byTotal)}</td></tr>
            </tbody>
          </>
        )}
      </table>
      {!isAdmin && <p className="mt-2 text-[11px] text-neutral-500">Prices are set by the Admin (Admin Dashboard, Milling Prices).</p>}
    </div>
  )
}

function BatchCards({ section }) {
  const Row = ({ left, right }) => (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm"><span className="min-w-0 break-words text-neutral-300">{left}</span><span className="shrink-0 tabular-nums text-app-text">{right}</span></div>
  )
  return (
    <div className="space-y-2">
      {section.cards.map((c, i) => (
        <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <p className="border-b border-neutral-800 pb-1.5 font-semibold text-app-text">{c.no} · {section.kind === 'TMO' ? 'Trial' : 'Batch'} {c.batch || '-'} <span className="font-normal text-neutral-500">· {c.date}</span></p>
          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Issued (palay)</p>
          {c.issues.map((x, k) => <Row key={k} left={`WSI ${x.serial} · ${x.whse} · ${x.variety}`} right={`${fmtInt(x.bags)} bags · ${fmt3(x.kilos)} kg`} />)}
          {(c.esi.no || c.esi.pcs > 0) && <p className="text-[11px] text-neutral-500">ESI {c.esi.no || '-'}{c.esi.sia ? ` · SIA ${c.esi.sia}` : ''} · {fmtInt(c.esi.pcs)} pcs</p>}
          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Received</p>
          {c.receipts.map((x, k) => <Row key={k} left={`WSR ${x.serial} · ${x.product} · ${x.date}`} right={`${fmtInt(x.bags)} bags · ${fmt3(x.kilos)} kg`} />)}
          {(c.esr.no || c.esr.pcs > 0) && <p className="text-[11px] text-neutral-500">ESR {c.esr.no || '-'} · {fmtInt(c.esr.pcs)} pcs</p>}
        </div>
      ))}
      <div className="rounded-xl border border-neutral-600 bg-neutral-900 p-3">
        <p className="font-bold uppercase text-app-text">Total</p>
        <Row left="Palay issued" right={`${fmtInt(section.totals.bags)} bags · ${fmt3(section.totals.kilos)} kg`} />
        {Object.entries(section.totals.prod).map(([p, t]) => <Row key={p} left={p} right={`${fmtInt(t.bags)} bags · ${fmt3(t.kilos)} kg`} />)}
      </div>
    </div>
  )
}

function FilterSheet({ draft, setDraft, warehouses, batchValues, kind, onApply, onReset, onClose }) {
  const selectClass = 'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
  const labelClass = 'mt-3 block text-xs text-neutral-400'
  const word = kind === 'TMO' ? 'trial' : 'batch'
  const opts = batchValues.map((b) => <option key={b} value={b}>{b === '' ? '(none)' : b}</option>)
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/60 sm:items-start sm:justify-end sm:p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:mt-14 sm:w-80 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-app-text">Filter and sort</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-950 p-1.5 text-neutral-400"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <label className={labelClass}>Warehouse
            <select className={selectClass} value={draft.warehouseId} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })}>
              <option value="">All warehouses</option>
              {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
            </select>
          </label>
          <p className={`${labelClass} font-semibold`}>{kind === 'TMO' ? 'Trial' : 'Batch'} range</p>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelClass}>From {word}
              <select className={selectClass} value={draft.batchFrom} onChange={(e) => setDraft({ ...draft, batchFrom: e.target.value })}><option value="">First</option>{opts}</select>
            </label>
            <label className={labelClass}>To {word}
              <select className={selectClass} value={draft.batchTo} onChange={(e) => setDraft({ ...draft, batchTo: e.target.value })}><option value="">Last</option>{opts}</select>
            </label>
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

const DEFAULTS = { warehouseId: '', batchFrom: '', batchTo: '' }

function LiquidationReport({ kind, transactions, warehouses, varieties, sackTypes, config, branch, isAdmin, today }) {
  const [from, setFrom] = useState(config?.dataStartDate ?? `${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [filters, setFilters] = useState(DEFAULTS)
  const [draft, setDraft] = useState(DEFAULTS)
  const [showFilters, setShowFilters] = useState(false)
  const [tab, setTab] = useState('')
  const [busy, setBusy] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const toRef = useRef(null)
  const compact = useIsCompact()
  // Even on a large screen, a layout with many product columns can be wider than the
  // window. Measure it; if it does not fit, show the cards instead of ever scrolling.
  const boxRef = useRef(null)
  const [overflow, setOverflow] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const on = () => { setOverflow(false); setTick((t) => t + 1) }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const all = useMemo(() => buildMillingBatches({ transactions }), [transactions])
  const ofKind = useMemo(() => all.filter((b) => b.kind === kind), [all, kind])
  const batchValues = useMemo(() => [...new Set(ofKind.map((b) => b.batch))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [ofKind])
  const end = to < from ? from : to

  // batches in the period (any ricemill) -> one tab per ricemill that has some
  const periodBatches = useMemo(
    () => filterBatches(all, { kind, warehouseId: filters.warehouseId, from, to: end, batchFrom: filters.batchFrom, batchTo: filters.batchTo }),
    [all, kind, filters, from, end],
  )
  const tabs = useMemo(() => listMillers(periodBatches), [periodBatches])
  const activeKey = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key ?? ''

  const sections = useMemo(
    () => buildLiquidationSections({ batches: periodBatches.filter((b) => b.millerKey === activeKey), kind, warehouses, varieties, sackTypes, config, branch, from, to: end }),
    [periodBatches, activeKey, kind, warehouses, varieties, sackTypes, config, branch, from, end],
  )
  const section = sections[0] ?? null
  useLayoutEffect(() => {
    const t = boxRef.current?.querySelector('table')
    if (!compact && t && t.scrollWidth > boxRef.current.clientWidth + 1) setOverflow(true)
  }, [section, compact, tick, overflow])
  // a different ricemill or filter gets a fresh chance to fit
  useEffect(() => { setOverflow(false) }, [activeKey, from, end, filters])

  const activeFilters = [filters.warehouseId, filters.batchFrom, filters.batchTo].filter(Boolean).length
  const slug = (tabs.find((t) => t.key === activeKey)?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const fileBase = `${kind === 'TMO' ? 'test-milling' : 'milling'}-liquidation-${slug}-${from}_to_${end}`

  const run = async (type) => {
    if (!section) return
    setBusy(type)
    try {
      const lib = await import('../../utils/liquidationExport.js')
      if (type === 'xlsx') await lib.exportLiquidationExcel(sections, { fileName: fileBase, config })
      else await lib.exportLiquidationPdf(sections, { fileName: fileBase, config })
    } catch (err) {
      console.error(err)
      toast.error('Could not create the file')
    } finally {
      setBusy('')
    }
  }

  const onPrice = async (mk, product, value) => {
    try {
      await saveMillingPrice(mk, product, value)
      setSavedKey(mk)
      setTimeout(() => setSavedKey(''), 4000)
    } catch (err) {
      console.error(err)
      toast.error('Could not save the price')
    }
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-end gap-x-2 gap-y-2">
        <div className="w-[calc(50%-0.25rem)] sm:w-40"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">From</p><CalendarDatePicker value={from} label="Start Date" onChange={(iso) => { setFrom(iso); toRef.current?.open() }} /></div>
        <div className="w-[calc(50%-0.25rem)] sm:w-40"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">To</p><CalendarDatePicker ref={toRef} value={to} label="End Date" onChange={setTo} /></div>
        <div className={`flex items-center ${CONTROL_H}`}>
          <button type="button" onClick={() => { setDraft(filters); setShowFilters(true) }} className={pillButton}>
            <SlidersHorizontal size={14} /> Filter and sort{activeFilters > 0 && <span className="rounded-full bg-brand-neon px-1.5 text-[10px] font-bold text-brand-contrast">{activeFilters}</span>}
          </button>
        </div>
        <span className="hidden flex-1 sm:block" />
        <div className={`flex items-center gap-2 ${CONTROL_H}`}>
          <button type="button" onClick={() => run('xlsx')} disabled={!!busy || !section} className={pillButton}><FileSpreadsheet size={14} /> {busy === 'xlsx' ? 'Creating…' : 'Excel'}</button>
          <button type="button" onClick={() => run('pdf')} disabled={!!busy || !section} className={pillButton}><FileText size={14} /> {busy === 'pdf' ? 'Creating…' : 'PDF'}</button>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Ricemills">
          {tabs.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={t.key === activeKey} onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${t.key === activeKey ? 'border-brand-neon bg-brand-neon text-brand-contrast' : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500'}`}
            >
              {t.name} <span className={t.key === activeKey ? 'text-brand-contrast/70' : 'text-neutral-500'}>{t.batches}</span>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6">
        {!section && <p className="py-10 text-center text-sm text-neutral-500">No {kind === 'TMO' ? 'test milling trials' : 'milling batches'} in this period for these filters.</p>}
        {section && (
          <section>
            <div className="mb-2 text-center">
              {section.heading.map((h) => <p key={h} className="text-[11px] text-neutral-400">{h}</p>)}
              <h3 className="text-sm font-bold text-app-text">{section.title}</h3>
              <p className="text-xs text-neutral-400">{section.subtitle}</p>
            </div>
            {compact || overflow ? <BatchCards section={section} /> : <GridTable section={section} boxRef={boxRef} />}
            <Summary section={section} isAdmin={isAdmin} onPrice={onPrice} savedKey={savedKey} />
          </section>
        )}
      </div>

      {showFilters && (
        <FilterSheet
          draft={draft} setDraft={setDraft} warehouses={warehouses} batchValues={batchValues} kind={kind}
          onApply={() => { setFilters(draft); setShowFilters(false) }} onReset={() => setDraft(DEFAULTS)} onClose={() => setShowFilters(false)}
        />
      )}
    </>
  )
}

export default LiquidationReport
