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
import ConfirmDialog from './ConfirmDialog.jsx'
import { SdOverlay } from './StockDeskUi.jsx'
import useCrosshair from '../../hooks/useCrosshair.js'

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

/** A price shown as a label. Admin only: a pencil turns it into a field for one edit. */
function PriceCell({ value, isAdmin, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const doneRef = useRef(false)
  const start = () => { doneRef.current = false; setText(liveFormatNumber(Number(value ?? 0).toFixed(2))); setEditing(true) }
  const finish = (commit) => {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    const n = parseFormattedNumber(text)
    if (commit && n !== Number(value ?? 0)) onCommit(n)
  }
  if (editing) {
    return (
      <input
        autoFocus type="text" inputMode="decimal" value={text} aria-label="Unit price"
        onChange={(e) => setText(liveFormatNumber(e.target.value))} onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true) }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false) }
        }}
        className="w-24 rounded-lg border border-brand-neon bg-neutral-950 px-2 py-0.5 text-right text-sm tabular-nums text-app-text outline-none"
      />
    )
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums text-neutral-300">
      {fmt2(Number(value ?? 0))}
      {isAdmin && <button type="button" onClick={start} aria-label="Change unit price" title="Change unit price" className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-brand-neon"><Pencil size={14} /></button>}
    </span>
  )
}

const cellClass = (c) => `border border-neutral-700 px-1.5 py-0.5 align-middle ${c.a === 'r' ? 'whitespace-nowrap text-right tabular-nums' : c.a === 'c' ? 'text-center' : 'text-left'} ${c.b ? 'font-semibold' : ''}`

/**
 * The printed layout, always as a table. It is drawn at its natural width and then
 * scaled down to fit the window, so the whole form is visible without sideways
 * scrolling (it only scrolls if the window is far narrower than the form).
 */
function GridTable({ section }) {
  const boxRef = useRef(null)
  const innerRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState('100%')
  useCrosshair(boxRef)
  useLayoutEffect(() => {
    const fit = () => {
      const box = boxRef.current
      const inner = innerRef.current
      if (!box || !inner) return
      // the narrowest the form can be (text wrapped, numbers whole); scale only if the room is less
      inner.style.zoom = '1'
      inner.style.width = 'min-content'
      const natural = inner.scrollWidth
      inner.style.width = ''
      const room = box.clientWidth
      const z = natural > room ? Math.max(0.4, (room / natural) * 0.98) : 1
      setZoom(z)
      setWidth(z < 1 ? `${Math.floor(room / z)}px` : '100%')
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [section])
  return (
    <div ref={boxRef} className="sd-table overflow-clip rounded-xl border border-neutral-800">
      <div ref={innerRef} style={{ zoom, width }}>
        <table className="w-full border-collapse text-[11px] leading-tight">
          <thead className="sticky top-0 z-10">
            {section.head.map((row, ri) => (
              <tr key={ri} className="bg-emerald-950 text-emerald-300">
                {row.map((c, ci) => <th key={ci} colSpan={c.cs ?? 1} rowSpan={c.rs ?? 1} className="border border-neutral-700 bg-emerald-950 px-1.5 py-0.5 text-center font-semibold">{c.t}</th>)}
              </tr>
            ))}
          </thead>
          <tbody>
            {section.rows.map((r, ri) => (
              <tr key={ri} className={r.batchStart ? 'border-t-2 border-t-neutral-500' : ''}>
                {r.cells.map((c, ci) => <td key={ci} colSpan={c.cs ?? 1} rowSpan={c.rs ?? 1} className={`${cellClass(c)} whitespace-pre-line text-neutral-200`}>{c.t}</td>)}
              </tr>
            ))}
            <tr className="border-t-2 border-t-neutral-500 bg-neutral-900">
              {section.totalCells.map((c, ci) => <td key={ci} colSpan={c.cs ?? 1} className={`${cellClass(c)} text-app-text`}>{c.t}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// These pieces live at module level on purpose: defined inside Summary they were a new component type on
// every render, so a price being edited was torn down and rebuilt (the field flashed and vanished).
function PriceRow({ l, qty, isKilos, mk, isAdmin, onPrice }) {
  return (
    <tr>
      <td className="py-0.5 pr-4 font-semibold text-app-text">{l.product}</td>
      <td className="py-0.5 pr-4 text-right tabular-nums text-neutral-300">{isKilos ? fmt3(qty) : fmt2(qty)}</td>
      <td className="py-0.5 pr-4 text-right"><PriceCell key={`${mk}|${l.product}`} value={l.price} isAdmin={isAdmin} onCommit={(n) => onPrice(mk, l.product, n)} /></td>
      <td className="py-0.5 text-right tabular-nums text-app-text">{fmt3(l.amount)}</td>
    </tr>
  )
}
function SummaryHead({ first, qty, price, top }) {
  return (
    <thead><tr className="text-[11px] uppercase text-neutral-500">
      <th className={`pr-4 text-left ${top ? 'pt-3' : ''}`}>{first}</th><th className={`pr-4 text-right ${top ? 'pt-3' : ''}`}>{qty}</th>
      <th className={`pr-4 text-right ${top ? 'pt-3' : ''}`}>{price}</th><th className={`text-right ${top ? 'pt-3' : ''}`}>Amount</th>
    </tr></thead>
  )
}
function SummaryTotal({ label, value }) {
  return <tr className="border-t border-neutral-700"><td className="pt-1 font-bold text-app-text" colSpan={3}>{label}</td><td className="pt-1 text-right font-bold tabular-nums text-app-text">{fmt3(value)}</td></tr>
}

function Summary({ section, isAdmin, onPrice, savedKey }) {
  const mk = section.millerKey
  const row = (l, qty, isKilos) => <PriceRow key={l.product} l={l} qty={qty} isKilos={isKilos} mk={mk} isAdmin={isAdmin} onPrice={onPrice} />
  const sm = section.summary
  return (
    <div className="sd-table mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">Summary</p>
        {savedKey === mk && <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] text-emerald-300">Price updated, saved for this ricemill</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm">
          {sm.palay.length > 0 && (
            <>
              <SummaryHead first="Palay issued · milling fee" qty="Net bags" price="Milling fee" />
              <tbody>{sm.palay.map((l) => row(l, l.bags))}<SummaryTotal label="TOTAL MILLING FEE" value={sm.palayTotal} /></tbody>
            </>
          )}
          <SummaryHead first="Local rice · trucking fee" qty="Bags @ 50 kg" price="Trucking fee" top={sm.palay.length > 0} />
          <tbody>
            {sm.rice.map((l) => row(l, l.bags))}
            {sm.rice.length === 0 && <tr><td colSpan={4} className="py-1 text-neutral-500">No local rice received.</td></tr>}
            {sm.rice.length > 0 && <SummaryTotal label="TOTAL TRUCKING FEE" value={sm.riceTotal} />}
          </tbody>
          {sm.byProducts.length > 0 && (
            <>
              <SummaryHead first="Less: by-products" qty="Net kg" price="U.P." top />
              <tbody>
                {sm.byProducts.map((l) => row(l, l.kilos, true))}
                <SummaryTotal label="TOTAL BY-PRODUCTS" value={sm.byTotal} />
              </tbody>
            </>
          )}
        </table>
      </div>
      {!isAdmin && <p className="mt-2 text-[11px] text-neutral-500">Prices are set by the Admin (Admin Dashboard, Milling Prices).</p>}
    </div>
  )
}

function FilterSheet({ open, draft, setDraft, warehouses, batchValues, kind, onApply, onReset, onClose }) {
  const selectClass = 'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
  const labelClass = 'mt-3 block text-xs text-neutral-400'
  const word = kind === 'TMO' ? 'trial' : 'batch'
  const opts = batchValues.map((b) => <option key={b} value={b}>{b === '' ? '(none)' : b}</option>)
  return (
    <SdOverlay open={open} onClose={onClose} align="sheet" z="z-[90]" panelClassName="sd-table flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 sm:mt-14 sm:w-80 sm:rounded-2xl">
      <>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-app-text">Filter and sort</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-brand-crimson/40 bg-neutral-900 p-1.5 text-brand-crimson transition-colors hover:bg-brand-crimson/10"><X size={16} /></button>
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
      </>
    </SdOverlay>
  )
}

const DEFAULTS = { warehouseId: '', batchFrom: '', batchTo: '' }

function LiquidationReport({ kind, transactions, warehouses, varieties, sackTypes, config, branch, isAdmin, today }) {
  // the earliest day is the day after the Data Start Date
  const startISO = config?.dataStartDate ? new Date(Date.parse(`${config.dataStartDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null
  const [from, setFromRaw] = useState(startISO ?? `${today.slice(0, 4)}-01-01`)
  const [to, setToRaw] = useState(today)
  const setFrom = (iso) => setFromRaw(startISO && iso < startISO ? startISO : iso)
  const setTo = (iso) => setToRaw(startISO && iso < startISO ? startISO : iso)
  useEffect(() => {
    if (!startISO) return
    setFromRaw((v) => (v < startISO ? startISO : v))
    setToRaw((v) => (v < startISO ? startISO : v))
  }, [startISO])
  const [filters, setFilters] = useState(DEFAULTS)
  const [draft, setDraft] = useState(DEFAULTS)
  const [showFilters, setShowFilters] = useState(false)
  const [tab, setTab] = useState('')
  const [tabLeaving, setTabLeaving] = useState(false)
  const [tabDir, setTabDir] = useState(1)
  const [busy, setBusy] = useState('')
  const [confirmXlsx, setConfirmXlsx] = useState(false)
  const [savedKey, setSavedKey] = useState('')
  const toRef = useRef(null)
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
  // The ricemill's liquidation slides out the way the tab pills run and the next one slides in.
  const goTab = (key) => {
    if (key === activeKey || tabLeaving) return
    setTabDir(tabs.findIndex((t) => t.key === key) > tabs.findIndex((t) => t.key === activeKey) ? 1 : -1)
    setTabLeaving(true)
    setTimeout(() => { setTab(key); setTabLeaving(false) }, 170)
  }

  const sections = useMemo(
    () => buildLiquidationSections({ batches: periodBatches.filter((b) => b.millerKey === activeKey), kind, warehouses, varieties, sackTypes, config, branch, from, to: end }),
    [periodBatches, activeKey, kind, warehouses, varieties, sackTypes, config, branch, from, end],
  )
  const section = sections[0] ?? null

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
    if (!isAdmin) return
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
          <button type="button" onClick={() => setConfirmXlsx(true)} disabled={!!busy || !section} className={pillButton}><FileSpreadsheet size={14} /> {busy === 'xlsx' ? 'Creating…' : 'Excel'}</button>
          <button type="button" onClick={() => run('pdf')} disabled={!!busy || !section} className={pillButton}><FileText size={14} /> {busy === 'pdf' ? 'Creating…' : 'PDF'}</button>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Ricemills">
          {tabs.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={t.key === activeKey} onClick={() => goTab(t.key)}
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
          <section key={activeKey} className={tabLeaving ? (tabDir > 0 ? 'sd-slide-out-left' : 'sd-slide-out') : (tabDir > 0 ? 'sd-slide-in' : 'sd-slide-in-left')}>
            <div className="mb-2 text-center">
              {section.heading.map((h) => <p key={h} className="text-[11px] text-neutral-400">{h}</p>)}
              <h3 className="text-sm font-bold text-app-text">{section.title}</h3>
              <p className="text-xs text-neutral-400">{section.subtitle}</p>
            </div>
            <GridTable section={section} />
            <Summary section={section} isAdmin={isAdmin} onPrice={onPrice} savedKey={savedKey} />
          </section>
        )}
      </div>

      <FilterSheet
        open={showFilters}
        draft={draft} setDraft={setDraft} warehouses={warehouses} batchValues={batchValues} kind={kind}
        onApply={() => { setFilters(draft); setShowFilters(false) }} onReset={() => setDraft(DEFAULTS)} onClose={() => setShowFilters(false)}
      />
      <ConfirmDialog
        open={confirmXlsx} title="Export to Excel?" description="This liquidation is saved as an Excel file."
        confirmLabel="Export" icon={FileSpreadsheet} destructive={false}
        onConfirm={() => { setConfirmXlsx(false); run('xlsx') }} onCancel={() => setConfirmXlsx(false)}
      />
    </>
  )
}

export default LiquidationReport
