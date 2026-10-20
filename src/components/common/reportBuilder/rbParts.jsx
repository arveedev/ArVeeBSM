// Report Builder: the small pieces of the screen (field chips, filter builder, column chooser, format panel, result table, saved layouts).
// Presentational only: they show and edit the LAYOUT (a few choices). Nothing here touches a record.

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { AGG, OPS } from '../../../utils/reportBuilder/engine.js'
import { readValue } from '../../../utils/reportBuilder/fields.js'

export const pill = 'flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-brand-neon/60 disabled:opacity-40'
export const pillOn = 'border-brand-neon bg-brand-neon/10 text-brand-neon'
export const input = 'rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon/70'
const kindMark = { num: ['#', 'text-sky-400'], txt: ['Aa', 'text-brand-neon'], date: ['▦', 'text-amber-300'] }

export function FieldChip({ f, extra, onRemove, draggable, used, onClick, dashed }) {
  const [m, c] = kindMark[f.kind]
  return (
    <span
      draggable={draggable} data-field={f.id}
      onDragStart={draggable ? (e) => { e.dataTransfer.setData('text/plain', f.id); e.dataTransfer.effectAllowed = 'copy' } : undefined}
      onClick={onClick}
      className={`inline-flex select-none items-center gap-1.5 rounded-lg border bg-neutral-900 px-2 py-1 text-xs text-app-text ${dashed ? 'border-dashed' : ''} border-neutral-700 ${draggable ? 'cursor-grab' : ''} ${used ? 'opacity-50' : ''}`}
    >
      <b className={`${c} text-[10px] font-extrabold`}>{m}</b>{f.label}{extra}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${f.label}`} className="text-neutral-500 hover:text-red-400"><X size={12} /></button>}
    </span>
  )
}

export function DropArea({ area, onDropField, children, hint }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/plain'); if (id) onDropField(area, id) }}
      className={`flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-xl border-[1.5px] border-dashed p-1.5 transition-colors ${over ? 'border-brand-neon bg-brand-neon/10' : 'border-neutral-700'}`}
    >
      {children}{!children?.length && <span className="px-1 text-xs text-neutral-500">{hint}</span>}
    </div>
  )
}

export function ValueChip({ f, v, onAgg, onRemove }) {
  return (
    <FieldChip
      f={f} onRemove={onRemove}
      extra={(
        <select value={v.a} onChange={(e) => onAgg(e.target.value)} className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-[11px] text-brand-neon">
          {Object.entries(AGG).filter(([k]) => f.kind === 'num' || k === 'count' || k === 'distinct').map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
      )}
    />
  )
}

// ------------------------------------------------------------------------------------------------ filter builder
export function FilterBuilder({ fields, rows, initialField, onAdd, onCancel }) {
  const list = fields.list
  const [fid, setFid] = useState(initialField && fields.map[initialField] ? initialField : list.find((f) => !f.d)?.id ?? list[0].id)
  const f = fields.map[fid]
  const [op, setOp] = useState(OPS[f.kind][0][0])
  const [v, setV] = useState('')
  const [v2, setV2] = useState('')
  const [multi, setMulti] = useState([])
  const choose = (id) => { setFid(id); setOp(OPS[fields.map[id].kind][0][0]); setV(''); setV2(''); setMulti([]) }
  const values = useMemo(() => (f.kind === 'txt' ? [...new Set(rows.map((r) => String(readValue(r, f, fields.map) ?? '')))].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 200) : []), [f, rows, fields])
  const noValue = ['blank', 'filled'].includes(op)
  const isList = f.kind === 'txt' && (op === 'is' || op === 'isnot')
  const type = f.kind === 'date' ? 'date' : f.kind === 'num' ? 'number' : 'text'
  const ok = noValue || (isList ? multi.length > 0 : v !== '')
  return (
    <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Keep only records where&hellip;</p>
      <div className="flex flex-wrap items-start gap-2">
        <select value={fid} onChange={(e) => choose(e.target.value)} className={input}>{list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <select value={op} onChange={(e) => { setOp(e.target.value); setV(''); setMulti([]) }} className={input}>{OPS[f.kind].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        {!noValue && (isList
          ? <select multiple size={4} value={multi} onChange={(e) => setMulti([...e.target.selectedOptions].map((o) => o.value))} className={`${input} min-w-[11rem]`}>{values.map((x) => <option key={x}>{x}</option>)}</select>
          : <><input type={type} value={v} onChange={(e) => setV(e.target.value)} placeholder="value" className={`${input} w-40`} />{op === 'btw' && <><span className="py-1.5 text-sm text-neutral-400">and</span><input type={type} value={v2} onChange={(e) => setV2(e.target.value)} className={`${input} w-40`} /></>}</>)}
        <button type="button" disabled={!ok} onClick={() => onAdd({ f: fid, op, v: isList ? multi : v, v2 })} className="rounded-lg bg-brand-neon px-3 py-1.5 text-sm font-semibold text-brand-contrast disabled:opacity-40">Add filter</button>
        <button type="button" onClick={onCancel} className={pill}>Cancel</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ calculated field
export function CalcBuilder({ fields, onAdd, onCancel }) {
  const nums = fields.list.filter((f) => f.kind === 'num')
  const [a, setA] = useState(nums[0]?.id ?? '')
  const [op, setOp] = useState('-')
  const [b, setB] = useState(nums[1]?.id ?? '#')
  const [k, setK] = useState('1')
  const [name, setName] = useState('')
  if (!nums.length) return <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-400">This source has no numbers to calculate with. <button type="button" onClick={onCancel} className={pill}>Close</button></div>
  const sym = { '-': 'minus', '+': 'plus', '*': 'times', '/': 'divided by' }[op]
  const label = name.trim() || `${fields.map[a]?.label} ${sym} ${b === '#' ? k : fields.map[b]?.label}`
  return (
    <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">New calculated field, to check one number against another</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={a} onChange={(e) => setA(e.target.value)} className={input}>{nums.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <select value={op} onChange={(e) => setOp(e.target.value)} className={input}><option value="-">minus</option><option value="+">plus</option><option value="*">times</option><option value="/">divided by</option></select>
        <select value={b} onChange={(e) => setB(e.target.value)} className={input}>{nums.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}<option value="#">a fixed number</option></select>
        {b === '#' && <input type="number" value={k} onChange={(e) => setK(e.target.value)} className={`${input} w-24`} />}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Difference" className={`${input} w-52`} />
        <button type="button" onClick={() => onAdd({ id: `c_${Math.random().toString(36).slice(2, 8)}`, label, a, op, b, k: Number(k) || 0 })} className="rounded-lg bg-brand-neon px-3 py-1.5 text-sm font-semibold text-brand-contrast">Add field</button>
        <button type="button" onClick={onCancel} className={pill}>Cancel</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ columns and format
export function ColumnsPanel({ fields, layout, onChange }) {
  const base = fields.list.filter((f) => !f.d).map((f) => f.id)
  const order = [...new Set([...layout.order.filter((id) => fields.map[id]), ...base])]
  const move = (id, d) => { const i = order.indexOf(id); const j = i + d; if (j < 0 || j >= order.length) return; const o = order.slice(); [o[i], o[j]] = [o[j], o[i]]; onChange({ order: o }) }
  const toggle = (id) => onChange({ order, hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })
  return (
    <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Columns of the list: tick to show, arrows to reorder</p>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {order.map((id) => (
          <div key={id} className="flex items-center gap-1.5 text-sm">
            <label className="flex flex-1 items-center gap-2 text-neutral-200"><input type="checkbox" checked={!layout.hidden.includes(id)} onChange={() => toggle(id)} />{fields.map[id].label}</label>
            <button type="button" onClick={() => move(id, -1)} className="rounded border border-neutral-700 px-1.5 text-xs" aria-label="Move up">&#9650;</button>
            <button type="button" onClick={() => move(id, 1)} className="rounded border border-neutral-700 px-1.5 text-xs" aria-label="Move down">&#9660;</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FormatPanel({ layout, onChange }) {
  const set = (o) => onChange(o)
  return (
    <div className="mb-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={layout.heat} onChange={(e) => set({ heat: e.target.checked })} />Shade by size</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={layout.subt} onChange={(e) => set({ subt: e.target.checked })} />Subtotals</label>
        <label className="flex items-center gap-2">Show as
          <select value={layout.pct} onChange={(e) => set({ pct: e.target.value })} className={input}><option value="none">Numbers</option><option value="total">% of grand total</option><option value="row">% of row</option><option value="col">% of column</option></select>
        </label>
        <label className="flex items-center gap-2">Top
          <select value={layout.topn} onChange={(e) => set({ topn: +e.target.value })} className={input}><option value={0}>All rows</option><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={layout.sortTot} onChange={(e) => set({ sortTot: e.target.checked })} />Biggest first</label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Highlight cells</span>
        <select value={layout.hl.op} onChange={(e) => set({ hl: { ...layout.hl, op: e.target.value } })} className={input}><option value="">off</option><option value=">">greater than</option><option value="<">less than</option><option value="=">equal to</option><option value="!">not equal to</option></select>
        <input type="number" value={layout.hl.val} onChange={(e) => set({ hl: { ...layout.hl, val: e.target.value } })} className={`${input} w-24`} />
        <select value={layout.hl.col} onChange={(e) => set({ hl: { ...layout.hl, col: e.target.value } })} className={input}><option value="red">red</option><option value="amber">amber</option><option value="green">green</option></select>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ result table
const hlStyle = { 'hl-red': 'bg-red-500/30 text-red-100', 'hl-amber': 'bg-amber-500/30', 'hl-green': 'bg-emerald-400/25' }
export function ResultTable({ table, layout, onSort, onCell }) {
  const { head, body, foot } = table
  if (!body.length) return <div className="p-10 text-center text-sm text-neutral-500">No records match the search and filters.</div>
  const cls = (c, base = '') => `${base} ${(c.cls || '').split(' ').map((x) => hlStyle[x] ?? '').join(' ')}`
  const sortMark = (id) => { const i = layout.sort.findIndex((s) => s.f === id); return i < 0 ? null : <span className="text-brand-neon"> {layout.sort[i].dir > 0 ? '▲' : '▼'}{layout.sort.length > 1 ? i + 1 : ''}</span> }
  const td = (c, key) => (
    <td
      key={key} colSpan={c.span > 1 ? c.span : undefined} onClick={c.id && /\bcl\b/.test(c.cls || '') ? () => onCell(c.id) : undefined}
      style={c.heat ? { background: `rgba(0,255,163,${c.heat.toFixed(2)})` } : undefined}
      className={cls(c, `whitespace-nowrap border-b border-neutral-900 px-3 py-1.5 tabular-nums ${/\bl\b/.test(c.cls || '') ? 'text-left' : 'text-right'} ${/\brh\b/.test(c.cls || '') ? 'sticky left-0 z-[1] bg-neutral-950 font-semibold text-app-text' : 'text-neutral-200'} ${/\bsb\b/.test(c.cls || '') ? 'text-transparent' : ''} ${/\btc\b/.test(c.cls || '') ? 'bg-emerald-950/40 font-bold' : ''} ${/\bcl\b/.test(c.cls || '') ? 'cursor-pointer hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-brand-neon' : ''}`)}
    >{c.t}</td>
  )
  return (
    <table className="w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        {head.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, i) => (
              <th
                key={i} colSpan={c.span > 1 ? c.span : undefined} rowSpan={c.rs > 1 ? c.rs : undefined} onClick={c.id ? () => onSort(c.id) : undefined}
                className={`sticky top-0 z-[2] whitespace-nowrap border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-bold text-neutral-400 ${/\bl\b/.test(c.cls || '') ? 'text-left' : 'text-right'} ${/\brh\b/.test(c.cls || '') ? 'left-0 z-[3]' : ''} ${/\btc\b/.test(c.cls || '') ? 'bg-emerald-950' : ''} ${c.id ? 'cursor-pointer hover:text-brand-neon' : ''}`}
              >{c.t}{c.id && c.id !== '__tot' ? sortMark(c.id) : null}</th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {layout.mode === 'list'
          ? body.map((r, ri) => <tr key={ri} className="hover:bg-neutral-900/60">{r.map((c, i) => td(c, i))}</tr>)
          : body.map((r, ri) => <tr key={ri} className={r.cls === 'subt' ? 'bg-neutral-900 font-bold' : ''}>{r.cells.map((c, i) => td(c, i))}</tr>)}
      </tbody>
      {foot && <tfoot><tr className="sticky bottom-0 bg-neutral-900 font-extrabold text-brand-neon">{foot.map((c, i) => <td key={i} colSpan={c.span > 1 ? c.span : undefined} onClick={c.id ? () => onCell(c.id) : undefined} className={`sticky bottom-0 cursor-pointer whitespace-nowrap bg-neutral-900 px-3 py-1.5 tabular-nums ${/\bl\b/.test(c.cls || '') ? 'text-left' : 'text-right'}`}>{c.t}</td>)}</tr></tfoot>}
    </table>
  )
}
