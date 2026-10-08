// Milling Liquidation / Test Milling Liquidation per ricemill (Admin and Visitor),
// opened from Inventory Reports. READ-ONLY except the unit prices in the
// SUMMARY, which only an Admin can edit; an edit is saved for that ricemill and
// is the same value the Admin settings show (one source of truth).

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { SlidersHorizontal, FileSpreadsheet, FileText, X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { liveFormatNumber, parseFormattedNumber } from '../../utils/calculations.js'
import {
  buildMillingBatches, filterBatches, listMillers, buildLiquidationSections, signatoryBlocks, millerStoreKey, summaryLineText,
} from '../../utils/millingLiquidation.js'
import CalendarDatePicker from './CalendarDatePicker.jsx'

const { fmt2, fmt3, fmtInt } = summaryLineText
const CONTROL_H = 'h-[46px]'
const pillButton = 'flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 disabled:opacity-40'

/** Saves one price for one ricemill on the shared settings record. */
export const saveMillingPrice = async (mk, product, value) => {
  const cur = await db.reportConfig.get('global')
  const key = millerStoreKey(mk)
  const mills = { ...(cur?.millingMills ?? {}) }
  mills[key] = { ...(mills[key] ?? {}), prices: { ...(mills[key]?.prices ?? {}), [millerStoreKey(product)]: value } }
  if (cur) await db.reportConfig.update('global', { millingMills: mills })
  else await db.reportConfig.put({ id: 'global', millingMills: mills })
}

function PriceInput({ value, disabled, onCommit }) {
  const [text, setText] = useState(() => liveFormatNumber(Number(value ?? 0).toFixed(2)))
  useEffect(() => { setText(liveFormatNumber(Number(value ?? 0).toFixed(2))) }, [value])
  return (
    <input
      type="text" inputMode="decimal" value={text} disabled={disabled}
      onChange={(e) => setText(liveFormatNumber(e.target.value))}
      onBlur={() => { const n = parseFormattedNumber(text); setText(liveFormatNumber(Number(n).toFixed(2))); if (n !== Number(value ?? 0)) onCommit(n) }}
      className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-sm tabular-nums text-app-text outline-none focus:border-brand-neon disabled:border-transparent disabled:bg-transparent"
      aria-label="Unit price"
    />
  )
}

const cellClass = (c) => `border border-neutral-700 px-1.5 py-1 align-middle whitespace-pre-line ${c.a === 'r' ? 'text-right tabular-nums' : c.a === 'c' ? 'text-center' : 'text-left'} ${c.b ? 'font-semibold' : ''}`

function GridTable({ section }) {
  return (
    <div className="overflow-auto rounded-xl border border-neutral-800">
      <table className="min-w-full border-collapse text-[11px]">
        <thead>
          {section.head.map((row, ri) => (
            <tr key={ri} className="bg-emerald-950 text-emerald-300">
              {row.map((c, ci) => <th key={ci} colSpan={c.cs ?? 1} rowSpan={c.rs ?? 1} className="whitespace-nowrap border border-neutral-700 px-1.5 py-1 text-center font-semibold">{c.t}</th>)}
            </tr>
          ))}
        </thead>
        <tbody>
          {section.rows.map((r, ri) => (
            <tr key={ri} className={r.batchStart ? 'border-t-2 border-t-neutral-500' : ''}>
              {r.cells.map((c, ci) => <td key={ci} colSpan={c.cs ?? 1} rowSpan={c.rs ?? 1} className={`${cellClass(c)} text-neutral-200`}>{c.t}</td>)}
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
      <td className="py-0.5 pr-4 text-right"><PriceInput value={l.price} disabled={!isAdmin} onCommit={(n) => onPrice(mk, l.product, n)} /></td>
      <td className="py-0.5 text-right tabular-nums text-app-text">{fmt3(l.amount)}</td>
    </tr>
  )
  return (
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">Summary</p>
        {savedKey === mk && <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] text-emerald-300">Price updated, saved for this ricemill</span>}
      </div>
      <div className="overflow-x-auto">
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
      </div>
      {!isAdmin && <p className="mt-2 text-[11px] text-neutral-500">Prices are set by the Admin (Admin Dashboard, Milling Prices).</p>}
    </div>
  )
}

function Signatories({ config, contractor }) {
  const sig = signatoryBlocks(config, contractor)
  const block = (s, i) => (
    <div key={i} className="min-w-0">
      <p className="break-words text-sm font-bold text-app-text">{s.name || <span className="font-normal text-neutral-600">(name not set)</span>}</p>
      <p className="text-[11px] text-neutral-500">{s.title}</p>
    </div>
  )
  return (
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <p className="mb-2 text-xs text-neutral-400">Certified correct:</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{sig.top.map(block)}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{sig.bottom.map(block)}</div>
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

function FilterSheet({ draft, setDraft, millers, warehouses, batchValues, kind, onApply, onReset, onClose }) {
  const selectClass = 'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
  const labelClass = 'mt-3 block text-xs text-neutral-400'
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/60 sm:items-start sm:justify-end sm:p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:mt-14 sm:w-80 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-app-text">Filter and sort</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-950 p-1.5 text-neutral-400"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <label className={labelClass}>Ricemill
            <select className={selectClass} value={draft.millerKey} onChange={(e) => setDraft({ ...draft, millerKey: e.target.value })}>
              <option value="">All ricemills</option>
              {millers.map((m) => <option key={m.key} value={m.key}>{m.name} ({m.batches})</option>)}
            </select>
          </label>
          <label className={labelClass}>Warehouse
            <select className={selectClass} value={draft.warehouseId} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })}>
              <option value="">All warehouses</option>
              {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>{kind === 'TMO' ? 'Trial' : 'Batch'}
            <select className={selectClass} value={draft.batch} onChange={(e) => setDraft({ ...draft, batch: e.target.value })}>
              <option value="">All</option>
              {batchValues.map((b) => <option key={b} value={b}>{b === '' ? '(none)' : b}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onReset} className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300">Reset</button>
          <button type="button" onClick={onApply} className="flex-1 rounded-xl bg-brand-neon px-3 py-2 text-sm font-semibold text-brand-contrast">Apply</button>
        </div>
      </div>
    </div>
  )
}

const DEFAULTS = { millerKey: '', warehouseId: '', batch: '' }

function LiquidationReport({ kind, transactions, warehouses, varieties, sackTypes, config, branch, isAdmin, narrow, today }) {
  const [from, setFrom] = useState(config?.dataStartDate ?? `${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [filters, setFilters] = useState(DEFAULTS)
  const [draft, setDraft] = useState(DEFAULTS)
  const [showFilters, setShowFilters] = useState(false)
  const [busy, setBusy] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const toRef = useRef(null)

  const all = useMemo(() => buildMillingBatches({ transactions }), [transactions])
  const ofKind = useMemo(() => all.filter((b) => b.kind === kind), [all, kind])
  const millers = useMemo(() => listMillers(ofKind), [ofKind])
  const batchValues = useMemo(() => [...new Set(ofKind.filter((b) => !filters.millerKey || b.millerKey === filters.millerKey).map((b) => b.batch))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [ofKind, filters.millerKey])
  const end = to < from ? from : to

  const sections = useMemo(() => {
    const list = filterBatches(all, { kind, millerKey: filters.millerKey, warehouseId: filters.warehouseId, from, to: end, batch: filters.batch })
    return buildLiquidationSections({ batches: list, kind, warehouses, varieties, sackTypes, config, branch, from, to: end })
  }, [all, kind, filters, from, end, warehouses, varieties, sackTypes, config, branch])

  const activeFilters = [filters.millerKey, filters.warehouseId, filters.batch].filter(Boolean).length
  const fileBase = `${kind === 'TMO' ? 'test-milling' : 'milling'}-liquidation-${from}_to_${end}`

  const run = async (type) => {
    if (sections.length === 0) return
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
          <button type="button" onClick={() => run('xlsx')} disabled={!!busy || sections.length === 0} className={pillButton}><FileSpreadsheet size={14} /> {busy === 'xlsx' ? 'Creating…' : 'Excel'}</button>
          <button type="button" onClick={() => run('pdf')} disabled={!!busy || sections.length === 0} className={pillButton}><FileText size={14} /> {busy === 'pdf' ? 'Creating…' : 'PDF'}</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {sections.length === 0 && <p className="py-10 text-center text-sm text-neutral-500">No {kind === 'TMO' ? 'test milling trials' : 'milling batches'} in this period for these filters.</p>}
        {sections.map((s) => (
          <section key={s.millerKey} className="mb-8">
            <div className="mb-2 text-center">
              {s.heading.map((h) => <p key={h} className="text-[11px] text-neutral-400">{h}</p>)}
              <h3 className="text-sm font-bold text-app-text">{s.title}</h3>
              <p className="text-xs text-neutral-400">{s.subtitle}</p>
            </div>
            {narrow ? <BatchCards section={s} /> : <GridTable section={s} />}
            <Summary section={s} isAdmin={isAdmin} onPrice={onPrice} savedKey={savedKey} />
            <Signatories config={config} contractor={s.contractor} />
          </section>
        ))}
      </div>

      {showFilters && (
        <FilterSheet
          draft={draft} setDraft={setDraft} millers={millers} warehouses={warehouses} batchValues={batchValues} kind={kind}
          onApply={() => { setFilters(draft); setShowFilters(false) }} onReset={() => setDraft(DEFAULTS)} onClose={() => setShowFilters(false)}
        />
      )}
    </>
  )
}

export default LiquidationReport
