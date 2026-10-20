// Report Builder: the small pieces of the screen (field chips, filter builder, column chooser, format panel, result table, saved layouts).
// Presentational only: they show and edit the LAYOUT (a few choices). Nothing here touches a record.

import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { AGG, OPS } from '../../../utils/reportBuilder/engine.js'
import { readValue, buildFields } from '../../../utils/reportBuilder/fields.js'
import { parseFormula, unknownRefs } from '../../../utils/reportBuilder/formula.js'

export const pill = 'flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-brand-neon/60 disabled:opacity-40'
export const pillOn = 'border-brand-neon bg-brand-neon/10 text-brand-neon'
export const input = 'rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon/70'
const kindMark = { num: ['#', 'text-sky-400'], txt: ['Aa', 'text-brand-neon'], date: ['▦', 'text-amber-300'] }

export function FieldChip({ f, extra, onRemove, draggable, used, onClick, dashed, from }) {
  const [m, c] = kindMark[f.kind]
  return (
    <span
      draggable={draggable || !!from} data-field={f.id} data-rb-from={from || undefined}
      onDragStart={draggable || from ? (e) => { e.dataTransfer.setData('text/plain', f.id); if (from) e.dataTransfer.setData('application/x-rb-from', from); e.dataTransfer.effectAllowed = from ? 'move' : 'copy' } : undefined}
      onClick={onClick}
      className={`rb-pop inline-flex select-none items-center gap-1.5 rounded-lg border bg-neutral-900 px-2 py-1 text-xs text-app-text transition-colors hover:border-brand-neon/50 ${dashed ? 'border-dashed' : ''} border-neutral-700 ${draggable || from ? 'cursor-grab active:cursor-grabbing' : ''} ${used ? 'opacity-50' : ''}`}
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
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-rb-from') ? 'move' : 'copy'; setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const id = e.dataTransfer.getData('text/plain'); const from = e.dataTransfer.getData('application/x-rb-from') || null; if (id) onDropField(area, id, from) }}
      className={`flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-xl border-[1.5px] border-dashed p-1 transition-all duration-200 ${over ? 'scale-[1.01] border-brand-neon bg-brand-neon/10' : 'border-neutral-700'}`}
    >
      {children}{!children?.length && <span className="px-1 text-xs text-neutral-500">{hint}</span>}
    </div>
  )
}

export function ValueChip({ f, v, onAgg, onRemove }) {
  return (
    <FieldChip
      f={f} onRemove={onRemove} from="vals"
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
    <div className="rb-drop mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
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

// ------------------------------------------------------------------------------------------------ collapsible block (animated)
export function Collapse({ open, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 260ms cubic-bezier(.22,1,.36,1)' }}>
      <div className="min-h-0 overflow-hidden"><div style={{ opacity: open ? 1 : 0, transition: 'opacity 200ms ease' }}>{children}</div></div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the field list, in plain groups
export function FieldPicker({ groups, used, onPick, query, setQuery, extra }) {
  const [open, setOpen] = useState(() => Object.fromEntries(groups.map((g) => [g.id, g.open])))
  const q = query.trim().toLowerCase()
  const shown = groups.map((g) => ({ ...g, fields: q ? g.fields.filter((f) => f.label.toLowerCase().includes(q)) : g.fields })).filter((g) => g.fields.length)
  return (
    <div>
      <div className="mb-1.5 flex gap-1.5"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a field, then drag it into a box" className={`${input} min-w-0 flex-1`} />{extra}</div>
      <div className="max-h-[12.5rem] space-y-1 overflow-y-auto pr-1">
        {shown.length === 0 && <p className="py-3 text-center text-xs text-neutral-500">No field has that name.</p>}
        {shown.map((g) => {
          const isOpen = q ? true : !!open[g.id]
          return (
            <div key={g.id} className="rounded-xl border border-neutral-800 bg-neutral-950/60">
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs font-semibold text-neutral-300 transition-colors hover:text-brand-neon" aria-expanded={isOpen}>
                <span>{g.label} <span className="font-normal text-neutral-500">{g.fields.length}</span></span>
                <span className="text-neutral-500 transition-transform duration-200" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>&#9656;</span>
              </button>
              <Collapse open={isOpen}>
                <div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5">
                  {g.fields.map((f) => <FieldChip key={f.id} f={f} draggable used={used.has(f.id)} dashed={!!f.calc} onClick={(e) => { e.stopPropagation(); onPick(e, f) }} />)}
                </div>
              </Collapse>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ calculated field: a formula
export function FormulaBuilder({ baseFields, rows, fields, calc, editing, onSave, onCancel }) {
  const [name, setName] = useState(editing?.label ?? '')
  const [text, setText] = useState(editing?.formula ?? '')
  const ref = useRef(null)
  const parsed = parseFormula(text)
  const labels = fields.list.filter((f) => !f.d && f.id !== editing?.id).map((f) => f.label)
  const unknown = parsed.ok ? unknownRefs(text, labels) : []
  const error = !text.trim() ? '' : !parsed.ok ? parsed.error : unknown.length ? `${unknown.map((u) => `[${u}]`).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not part of your table. Put ${unknown.length > 1 ? 'them' : 'it'} in the table first, or use a field that is.` : ''
  const ok = text.trim() && parsed.ok && !unknown.length
  const example = useMemo(() => {
    if (!ok || !rows.length) return null
    const tmp = { id: '__try', label: '__try', formula: text }
    const f2 = buildFields(baseFields, [...calc.filter((c) => c.id !== editing?.id), tmp])
    try { return readValue(rows[0], f2.map.__try, f2.map) } catch { return null }
  }, [ok, text, rows, baseFields, calc, editing])
  const insert = (str) => {
    const el = ref.current
    const a = el?.selectionStart ?? text.length
    const z = el?.selectionEnd ?? text.length
    setText(`${text.slice(0, a)}${str}${text.slice(z)}`)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + str.length, a + str.length) })
  }
  const numFields = fields.list.filter((f) => !f.d && f.kind === 'num' && f.id !== editing?.id)
  return (
    <div className="rb-drop mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">{editing ? 'Change the calculated field' : 'New calculated field'}</p>
      <div className="grid gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, for example Weight difference" className={`${input} w-full sm:w-72`} />
        <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={2} spellCheck={false} placeholder="[Net kg] * [Net bags] - [Gross kg]" className={`${input} w-full font-mono`} />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-neutral-500">Put in:</span>
          <select value="" onChange={(e) => { if (e.target.value) insert(`[${e.target.value}]`) }} className={input}>
            <option value="">a field&hellip;</option>
            {numFields.length > 0 && <optgroup label="Numbers">{numFields.map((f) => <option key={f.id} value={f.label}>{f.label}</option>)}</optgroup>}
            <optgroup label="Everything else">{fields.list.filter((f) => !f.d && f.kind !== 'num').map((f) => <option key={f.id} value={f.label}>{f.label}</option>)}</optgroup>
          </select>
          {['+', '-', '*', '/', '(', ')'].map((o) => <button key={o} type="button" onClick={() => insert(` ${o} `)} className="h-8 w-8 rounded-lg border border-neutral-700 bg-neutral-950 text-sm text-neutral-200 transition-colors hover:border-brand-neon/60">{o === '*' ? '×' : o === '/' ? '÷' : o}</button>)}
          <select value="" onChange={(e) => { if (e.target.value) insert(e.target.value) }} className={input}>
            <option value="">a function&hellip;</option>
            <option value="AVERAGE(, )">AVERAGE(a, b, ...)</option><option value="SUM(, )">SUM(a, b, ...)</option><option value="COUNT(, )">COUNT(a, b, ...) numbers that are not 0</option><option value="MEDIAN(, , )">MEDIAN(a, b, ...)</option>
            <option value="ROUND(, 2)">ROUND(number, decimals)</option><option value="IF(, , )">IF(condition, then, otherwise)</option><option value="ABS()">ABS(number)</option><option value="MAX(, )">MAX(a, b, ...)</option><option value="MIN(, )">MIN(a, b, ...)</option>
            <option value="SQRT()">SQRT(number)</option><option value="POWER(, 2)">POWER(number, exponent)</option><option value="MOD(, )">MOD(number, divisor)</option><option value="FLOOR()">FLOOR(number)</option><option value="CEIL()">CEIL(number)</option>
          </select>
        </div>
        <div className="min-h-[1.25rem] text-xs">
          {error ? <span className="text-red-300">{error}</span> : ok ? <span className="text-emerald-300">Looks right.{example != null && <> The first record gives <b className="tabular-nums">{Number(example).toLocaleString('en-US', { maximumFractionDigits: 4 })}</b>.</>}</span> : <span className="text-neutral-500">Write a field name in [square brackets]. You can use + &minus; &times; &divide; ( ), numbers, and conditions such as IF([Net kg] &gt; 5000, [Net kg], 0).</span>}
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!ok} onClick={() => onSave({ id: editing?.id ?? `c_${Math.random().toString(36).slice(2, 8)}`, label: name.trim() || text.trim().slice(0, 40), formula: text.trim() })} className="rounded-lg bg-brand-neon px-3 py-1.5 text-sm font-semibold text-brand-contrast transition-transform active:scale-95 disabled:opacity-40">{editing ? 'Save changes' : 'Add field'}</button>
          <button type="button" onClick={onCancel} className={pill}>Cancel</button>
        </div>
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
    <div className="rb-drop mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
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
    <div className="rb-drop mb-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={layout.heat} onChange={(e) => set({ heat: e.target.checked })} />Shade by size</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={layout.totCol !== false} onChange={(e) => set({ totCol: e.target.checked })} />Total column (at the right)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={layout.totRow !== false} onChange={(e) => set({ totRow: e.target.checked })} />Total row (at the bottom)</label>
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
  const td = (c, key) => {
    const k = c.cls || ''
    const st = /\bst\b/.test(k)
    const rh = /\brh\b/.test(k)
    const tc = /\btc\b/.test(k)
    const bg = st ? (rh ? 'bg-emerald-950' : 'bg-emerald-950/80') : rh ? 'bg-neutral-950' : tc ? 'bg-emerald-950/40' : ''
    return (
      <td
        key={key} colSpan={c.span > 1 ? c.span : undefined} onClick={c.id && /\bcl\b/.test(k) ? () => onCell(c.id) : undefined}
        style={c.heat ? { background: `rgba(0,255,163,${c.heat.toFixed(2)})` } : undefined}
        className={cls(c, `whitespace-nowrap border-b px-4 py-2 tabular-nums ${st ? 'border-y border-brand-neon/40 font-extrabold text-brand-neon' : 'border-neutral-900'} ${bg} ${/\bl\b/.test(k) ? 'text-left' : 'text-right'} ${rh ? `sticky left-0 z-[1] ${st ? '' : 'font-semibold text-app-text'}` : st ? '' : 'text-neutral-200'} ${/\bsb\b/.test(k) ? 'text-transparent' : ''} ${tc && !st ? 'font-bold' : ''} ${/\bcl\b/.test(k) ? 'cursor-pointer hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-brand-neon' : ''}`)}
      >{c.t}</td>
    )
  }
  return (
    <table className="w-full border-separate border-spacing-0 text-[15px]">
      <thead>
        {head.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, i) => (
              <th
                key={i} colSpan={c.span > 1 ? c.span : undefined} rowSpan={c.rs > 1 ? c.rs : undefined} onClick={c.id ? () => onSort(c.id) : undefined}
                className={`sticky top-0 z-[2] whitespace-nowrap border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-[13px] font-bold text-neutral-300 ${/\bl\b/.test(c.cls || '') ? 'text-left' : 'text-right'} ${/\brh\b/.test(c.cls || '') ? 'left-0 z-[3]' : ''} ${/\btc\b/.test(c.cls || '') ? 'bg-emerald-950' : ''} ${c.id ? 'cursor-pointer hover:text-brand-neon' : ''}`}
              >{c.t}{c.id && c.id !== '__tot' ? sortMark(c.id) : null}</th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {layout.mode === 'list'
          ? body.map((r, ri) => <tr key={ri} style={ri < 24 ? { animationDelay: `${ri * 14}ms` } : undefined} className={`hover:bg-neutral-900/60 ${ri < 24 ? 'rb-fade' : ''}`}>{r.map((c, i) => td(c, i))}</tr>)
          : body.map((r, ri) => <tr key={ri} style={ri < 24 ? { animationDelay: `${ri * 14}ms` } : undefined} className={`${ri < 24 ? 'rb-fade' : ''} ${r.cls === 'subt' ? 'bg-neutral-900 font-bold' : ''}`}>{r.cells.map((c, i) => td(c, i))}</tr>)}
      </tbody>
      {foot && <tfoot><tr className="sticky bottom-0 bg-neutral-900 font-extrabold text-brand-neon">{foot.map((c, i) => <td key={i} colSpan={c.span > 1 ? c.span : undefined} onClick={c.id ? () => onCell(c.id) : undefined} className={`sticky bottom-0 cursor-pointer whitespace-nowrap bg-neutral-900 px-4 py-2 tabular-nums ${/\bl\b/.test(c.cls || '') ? 'text-left' : 'text-right'}`}>{c.t}</td>)}</tr></tfoot>}
    </table>
  )
}
