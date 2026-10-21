// Report Builder: the small pieces of the screen (field chips, filter builder, column chooser, format panel, result table, saved layouts).
// Presentational only: they show and edit the LAYOUT (a few choices). Nothing here touches a record.

import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { AGG, OPS, inkOn } from '../../../utils/reportBuilder/engine.js'
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
// shared look of the pop-up panels
export const fieldLabel = 'text-[11px] font-bold uppercase tracking-wider text-neutral-500'
export const ctl = 'w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-app-text outline-none transition-colors focus:border-brand-neon/70'
export const btnPrimary = 'rounded-xl bg-brand-neon px-5 py-2 text-sm font-semibold text-brand-contrast transition-transform active:scale-95 disabled:opacity-40'
export const btnGhost = 'rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500'

export function FilterBuilder({ fields, rows, initialField, onAdd, onCancel }) {
  const list = fields.list
  const [fid, setFid] = useState(initialField && fields.map[initialField] ? initialField : list.find((f) => !f.d)?.id ?? list[0].id)
  const f = fields.map[fid]
  const [op, setOp] = useState(OPS[f.kind][0][0])
  const [v, setV] = useState('')
  const [v2, setV2] = useState('')
  const [multi, setMulti] = useState([])
  const [find, setFind] = useState('')
  const choose = (id) => { setFid(id); setOp(OPS[fields.map[id].kind][0][0]); setV(''); setV2(''); setMulti([]); setFind('') }
  const values = useMemo(() => (f.kind === 'txt' ? [...new Set(rows.map((r) => String(readValue(r, f, fields.map) ?? '')))].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 300) : []), [f, rows, fields])
  const shownVals = find.trim() ? values.filter((x) => x.toLowerCase().includes(find.trim().toLowerCase())) : values
  const noValue = ['blank', 'filled'].includes(op)
  const isList = f.kind === 'txt' && (op === 'is' || op === 'isnot')
  const type = f.kind === 'date' ? 'date' : f.kind === 'num' ? 'number' : 'text'
  const ok = noValue || (isList ? multi.length > 0 : v !== '')
  const toggle = (x) => setMulti((m) => (m.includes(x) ? m.filter((y) => y !== x) : [...m, x]))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1"><span className={fieldLabel}>Field</span><select value={fid} onChange={(e) => choose(e.target.value)} className={ctl}>{list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="grid gap-1"><span className={fieldLabel}>Keep the records where it</span><select value={op} onChange={(e) => { setOp(e.target.value); setV(''); setMulti([]) }} className={ctl}>{OPS[f.kind].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      </div>
      {!noValue && (isList ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={fieldLabel}>Pick one or more <span className="font-normal normal-case tracking-normal text-neutral-400">&middot; {multi.length} picked</span></span>
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search the choices" className={`${ctl} !w-52 !py-1.5`} />
          </div>
          <div className="flex max-h-60 flex-wrap content-start gap-1.5 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-2.5">
            {shownVals.map((x) => <button key={x} type="button" onClick={() => toggle(x)} className={`rounded-full border px-3 py-1 text-sm transition-colors ${multi.includes(x) ? 'border-brand-neon bg-brand-neon/15 text-brand-neon' : 'border-neutral-700 text-neutral-200 hover:border-neutral-500'}`}>{x}</button>)}
            {!shownVals.length && <span className="p-1 text-sm text-neutral-500">Nothing to choose.</span>}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1"><span className={fieldLabel}>{op === 'btw' ? 'From' : 'Value'}</span><input type={type} value={v} onChange={(e) => setV(e.target.value)} className={ctl} /></label>
          {op === 'btw' && <label className="grid gap-1"><span className={fieldLabel}>To</span><input type={type} value={v2} onChange={(e) => setV2(e.target.value)} className={ctl} /></label>}
        </div>
      ))}
      <div className="flex justify-end gap-2 border-t border-neutral-800 pt-4">
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
        <button type="button" disabled={!ok} onClick={() => onAdd({ f: fid, op, v: isList ? multi : v, v2 })} className={btnPrimary}>Add filter</button>
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
const FN_CHIPS = [['AVERAGE', 'Average of the values'], ['SUM', 'Add the values'], ['COUNT', 'How many are not 0'], ['MEDIAN', 'Middle value'], ['ROUND', 'ROUND(number, decimals)'], ['IF', 'IF(condition, then, otherwise)'], ['ABS', 'Without the minus sign'], ['MAX', 'Largest'], ['MIN', 'Smallest'], ['SQRT', 'Square root'], ['POWER', 'POWER(number, exponent)'], ['MOD', 'Remainder'], ['FLOOR', 'Round down'], ['CEIL', 'Round up']]

export function FormulaBuilder({ baseFields, rows, fields, calc, editing, onSave, onCancel }) {
  const [name, setName] = useState(editing?.label ?? '')
  const [text, setText] = useState(editing?.formula ?? '')
  const ref = useRef(null)
  const parsed = parseFormula(text)
  const usable = fields.list.filter((f) => !f.d && f.id !== editing?.id)
  const labels = usable.map((f) => f.label)
  const unknown = parsed.ok ? unknownRefs(text, labels) : []
  const error = !text.trim() ? '' : !parsed.ok ? parsed.error : unknown.length ? `${unknown.map((u) => `[${u}]`).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not part of your table. Put ${unknown.length > 1 ? 'them' : 'it'} in the table first, or use a field that is.` : ''
  const ok = text.trim() && parsed.ok && !unknown.length
  const example = useMemo(() => {
    if (!ok || !rows.length) return null
    const tmp = { id: '__try', label: '__try', formula: text }
    const f2 = buildFields(baseFields, [...calc.filter((c) => c.id !== editing?.id), tmp])
    try { return readValue(rows[0], f2.map.__try, f2.map) } catch { return null }
  }, [ok, text, rows, baseFields, calc, editing])
  const insert = (str, back = 0) => {
    const el = ref.current
    const a = el?.selectionStart ?? text.length
    const z = el?.selectionEnd ?? text.length
    setText(`${text.slice(0, a)}${str}${text.slice(z)}`)
    requestAnimationFrame(() => { el?.focus(); const p = a + str.length - back; el?.setSelectionRange(p, p) })
  }
  return (
    <div className="space-y-4">
      <label className="grid gap-1"><span className={fieldLabel}>Name of the new column</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Weight difference" className={ctl} /></label>
      <div className="grid gap-1">
        <span className={fieldLabel}>Formula</span>
        <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={3} spellCheck={false} placeholder="[Net kg] * [Net bags] - [Gross kg]" className={`${ctl} font-mono leading-relaxed`} />
      </div>
      <div className="grid gap-1.5">
        <span className={fieldLabel}>Fields of your table <span className="font-normal normal-case tracking-normal text-neutral-500">&middot; tap to put one in</span></span>
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {usable.length === 0 && <span className="text-sm text-neutral-500">Put some fields in the table first.</span>}
          {usable.map((f) => <button key={f.id} type="button" onClick={() => insert(`[${f.label}]`)} className={`rounded-lg border px-2.5 py-1 text-sm transition-colors hover:border-brand-neon/60 ${f.kind === 'num' ? 'border-sky-500/30 bg-sky-500/10 text-sky-200' : 'border-neutral-700 bg-neutral-950 text-neutral-200'}`}>{f.label}</button>)}
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className={fieldLabel}>Signs and functions</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {['+', '-', '*', '/', '(', ')'].map((o) => <button key={o} type="button" onClick={() => insert(` ${o} `)} className="h-9 w-9 rounded-lg border border-neutral-700 bg-neutral-950 text-base text-neutral-100 transition-colors hover:border-brand-neon/60">{o === '*' ? '×' : o === '/' ? '÷' : o}</button>)}
          <span className="mx-1 h-6 w-px bg-neutral-700" />
          {FN_CHIPS.map(([n, tip]) => <button key={n} type="button" title={tip} onClick={() => insert(`${n}()`, 1)} className="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs font-semibold text-brand-neon transition-colors hover:border-brand-neon/60">{n}</button>)}
        </div>
      </div>
      <div className={`min-h-[2.75rem] rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-500/40 bg-red-500/10 text-red-200' : ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-neutral-800 bg-neutral-950 text-neutral-500'}`}>
        {error || (ok ? <>Looks right.{example != null && <> The first record gives <b className="tabular-nums">{Number(example).toLocaleString('en-US', { maximumFractionDigits: 4 })}</b>.</>}</> : 'Write the field names in [square brackets]. For example IF([Net kg] > 5000, [Net kg], 0).')}
      </div>
      <div className="flex justify-end gap-2 border-t border-neutral-800 pt-4">
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
        <button type="button" disabled={!ok} onClick={() => onSave({ id: editing?.id ?? `c_${Math.random().toString(36).slice(2, 8)}`, label: name.trim() || text.trim().slice(0, 40), formula: text.trim() })} className={btnPrimary}>{editing ? 'Save changes' : 'Add the column'}</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ columns and format
export function ColumnsPanel({ fields, layout, onChange, onDone }) {
  const base = fields.list.filter((f) => !f.d).map((f) => f.id)
  const order = [...new Set([...layout.order.filter((id) => fields.map[id]), ...base])]
  const move = (id, d) => { const i = order.indexOf(id); const j = i + d; if (j < 0 || j >= order.length) return; const o = order.slice(); [o[i], o[j]] = [o[j], o[i]]; onChange({ order: o }) }
  const toggle = (id) => onChange({ order, hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">Tick the columns to show. Use the arrows to move one left or right.</p>
      <div className="grid max-h-[55vh] gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
        {order.map((id) => {
          const on = !layout.hidden.includes(id)
          return (
            <div key={id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${on ? 'border-brand-neon/40 bg-brand-neon/5 text-app-text' : 'border-neutral-800 bg-neutral-950 text-neutral-400'}`}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"><input type="checkbox" checked={on} onChange={() => toggle(id)} /><span className="truncate">{fields.map[id].label}</span></label>
              <button type="button" onClick={() => move(id, -1)} className="rounded-lg border border-neutral-700 px-2 py-0.5 text-xs hover:border-brand-neon/60" aria-label="Move left">&#9650;</button>
              <button type="button" onClick={() => move(id, 1)} className="rounded-lg border border-neutral-700 px-2 py-0.5 text-xs hover:border-brand-neon/60" aria-label="Move right">&#9660;</button>
            </div>
          )
        })}
      </div>
      <div className="flex justify-end border-t border-neutral-800 pt-4"><button type="button" onClick={onDone} className={btnPrimary}>Done</button></div>
    </div>
  )
}

const SWATCHES = ['#1e293b', '#0f5a42', '#1d4ed8', '#7c2d12', '#4c1d95', '#111827', '#0e7490', '#9f1239']
export const DEFAULT_HEAD = '#1e293b'

function Section({ title, hint, children }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
      <p className={fieldLabel}>{title}{hint ? <span className="ml-2 font-normal normal-case tracking-normal text-neutral-500">{hint}</span> : null}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm text-neutral-200">
      <span>{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-brand-neon' : 'bg-neutral-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${checked ? 'left-[1.1rem]' : 'left-0.5'}`} />
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function FormatPanel({ layout, onChange, names = [], onDone }) {
  const set = (o) => onChange(o)
  const bg = layout.headBg || DEFAULT_HEAD
  const heads = layout.headers ?? {}
  const rename = (id, val) => { const h = { ...heads }; if (val.trim()) h[id] = val; else delete h[id]; set({ headers: h }) }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Totals">
          <Toggle label="Total column (at the right)" checked={layout.totCol !== false} onChange={(v) => set({ totCol: v })} />
          <Toggle label="Total row (at the bottom)" checked={layout.totRow !== false} onChange={(v) => set({ totRow: v })} />
          <Toggle label="Subtotal rows (one for each group of the first field in Rows)" checked={!!layout.subt} onChange={(v) => set({ subt: v })} />
          <Toggle label="Subtotal columns (one for each group of the first field in Columns)" checked={!!layout.subtCol} onChange={(v) => set({ subtCol: v })} />
          <p className="pt-1 text-[11px] text-neutral-500">Subtotals need two or more fields in Rows (for rows) or in Columns (for columns).</p>
        </Section>
        <Section title="Numbers">
          <label className="flex items-center justify-between gap-3 py-1 text-sm text-neutral-200">Show as
            <select value={layout.pct} onChange={(e) => set({ pct: e.target.value })} className={`${ctl} !w-auto !py-1.5`}><option value="none">Numbers</option><option value="total">% of grand total</option><option value="row">% of row</option><option value="col">% of column</option></select>
          </label>
          <label className="flex items-center justify-between gap-3 py-1 text-sm text-neutral-200">Only the top
            <select value={layout.topn} onChange={(e) => set({ topn: +e.target.value })} className={`${ctl} !w-auto !py-1.5`}><option value={0}>All rows</option><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select>
          </label>
          <Toggle label="Biggest first" checked={!!layout.sortTot} onChange={(v) => set({ sortTot: v })} />
          <Toggle label="Shade by size" checked={!!layout.heat} onChange={(v) => set({ heat: v })} />
        </Section>
      </div>
      <Section title="Highlight cells" hint="paint the numbers that pass a test">
        <div className="flex flex-wrap items-center gap-2">
          <select value={layout.hl.op} onChange={(e) => set({ hl: { ...layout.hl, op: e.target.value } })} className={`${ctl} !w-auto`}><option value="">off</option><option value=">">greater than</option><option value="<">less than</option><option value="=">equal to</option><option value="!">not equal to</option></select>
          <input type="number" value={layout.hl.val} onChange={(e) => set({ hl: { ...layout.hl, val: e.target.value } })} className={`${ctl} !w-28`} />
          <select value={layout.hl.col} onChange={(e) => set({ hl: { ...layout.hl, col: e.target.value } })} className={`${ctl} !w-auto`}><option value="red">red</option><option value="amber">amber</option><option value="green">green</option></select>
        </div>
      </Section>
      <Section title="Header color" hint="shown on screen, in the Excel file and in the PDF">
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => <button key={c} type="button" aria-label={`Header color ${c}`} onClick={() => set({ headBg: c })} style={{ background: c }} className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${bg.toLowerCase() === c ? 'border-white' : 'border-transparent'}`} />)}
          <label className="flex items-center gap-2 pl-2 text-xs text-neutral-400">Other<input type="color" value={bg} onChange={(e) => set({ headBg: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-neutral-700 bg-transparent p-0.5" /></label>
          {layout.headBg && <button type="button" onClick={() => set({ headBg: '' })} className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-500">Reset</button>}
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-neutral-700 text-xs">
          <div className="grid grid-cols-4 px-3 py-2 font-bold transition-colors duration-200" style={{ background: bg, color: inkOn(bg) }}><span>Customer</span><span className="text-right">BIN</span><span className="text-right">DKA</span><span className="text-right">Total</span></div>
          {[['Borromeo', '199.59', '3,343.17', '3,542.76'], ['Buama', '34.9', '2,110.21', '2,145.11']].map((r) => <div key={r[0]} className="grid grid-cols-4 border-t border-neutral-800 px-3 py-1.5 text-neutral-300"><span className="font-semibold">{r[0]}</span>{r.slice(1).map((x, i) => <span key={i} className="text-right tabular-nums">{x}</span>)}</div>)}
        </div>
      </Section>
      {names.length > 0 && (
        <Section title="Header names" hint="only if you want a different name; leave empty to keep the field's own name">
          <div className="grid gap-2 sm:grid-cols-2">
            {names.map((n) => (
              <label key={n.id} className="grid gap-1 text-xs text-neutral-400">{n.label}
                <input value={heads[n.id] ?? ''} onChange={(e) => rename(n.id, e.target.value)} placeholder={n.label} className={`${ctl} !py-2`} />
              </label>
            ))}
          </div>
        </Section>
      )}
      <div className="flex justify-end border-t border-neutral-800 pt-4"><button type="button" onClick={onDone} className={btnPrimary}>Done</button></div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ result table
const hlStyle = { 'hl-red': 'bg-red-500/30 text-red-100', 'hl-amber': 'bg-amber-500/30', 'hl-green': 'bg-emerald-400/25' }
export function ResultTable({ table, layout, onSort, onCell }) {
  const { head, body, foot } = table
  const headBg = layout.headBg || DEFAULT_HEAD
  if (!body.length) return <div className="p-10 text-center text-sm text-neutral-500">No records match the search and filters.</div>
  const cls = (c, base = '') => `${base} ${(c.cls || '').split(' ').map((x) => hlStyle[x] ?? '').join(' ')}`
  const sortMark = (id) => { const i = layout.sort.findIndex((s) => s.f === id); return i < 0 ? null : <span className="text-brand-neon"> {layout.sort[i].dir > 0 ? '▲' : '▼'}{layout.sort.length > 1 ? i + 1 : ''}</span> }
  const td = (c, key) => {
    const k = c.cls || ''
    const st = /\bst\b/.test(k)
    const rh = /\brh\b/.test(k)
    const tc = /\btc\b/.test(k)
    const sc = /\bsc\b/.test(k)
    const bg = st ? (rh ? 'bg-emerald-950' : 'bg-emerald-950/80') : rh ? 'bg-neutral-950' : sc ? 'bg-emerald-950/60' : tc ? 'bg-emerald-950/40' : ''
    return (
      <td
        key={key} colSpan={c.span > 1 ? c.span : undefined} onClick={c.id && /\bcl\b/.test(k) ? () => onCell(c.id) : undefined}
        style={c.heat ? { background: `rgba(0,255,163,${c.heat.toFixed(2)})` } : undefined}
        className={cls(c, `whitespace-nowrap border-b px-4 py-2 tabular-nums ${st ? 'border-y border-brand-neon/40 font-extrabold text-brand-neon' : 'border-neutral-900'} ${bg} ${/\bl\b/.test(k) ? 'text-left' : 'text-right'} ${rh ? `${/\brf\b/.test(k) ? 'sticky left-0 z-[1]' : ''} ${st ? '' : 'font-semibold text-app-text'}` : st ? '' : 'text-neutral-200'} ${/\bsb\b/.test(k) ? 'text-transparent' : ''} ${(tc || sc) && !st ? 'font-bold' : ''} ${sc && !st ? 'text-emerald-200' : ''} ${/\bcl\b/.test(k) ? 'cursor-pointer hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-brand-neon' : ''}`)}
      >{c.t}</td>
    )
  }
  return (
    <table className="w-full border-separate border-spacing-0 text-[15px]">
      <thead className="sticky top-0 z-[2]">
        {head.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, i) => (
              <th
                key={i} colSpan={c.span > 1 ? c.span : undefined} rowSpan={c.rs > 1 ? c.rs : undefined} onClick={c.id ? () => onSort(c.id) : undefined}
                style={/\b(tc|sc)\b/.test(c.cls || '') ? undefined : { background: headBg, color: inkOn(headBg) }}
                className={`whitespace-nowrap border-b border-neutral-800 px-4 py-2 text-[13px] font-bold ${/\bl\b/.test(c.cls || '') ? 'text-left' : 'text-right'} ${/\brf\b/.test(c.cls || '') ? 'sticky left-0 z-[3]' : ''} ${/\btc\b/.test(c.cls || '') ? 'bg-emerald-950 text-emerald-100' : ''} ${/\bsc\b/.test(c.cls || '') ? 'bg-emerald-900 text-emerald-100' : ''} ${c.id ? 'cursor-pointer hover:text-brand-neon' : ''}`}
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
      {foot && <tfoot><tr className="sticky bottom-0 bg-emerald-950 font-extrabold text-brand-neon">{foot.map((c, i) => <td key={i} colSpan={c.span > 1 ? c.span : undefined} onClick={c.id ? () => onCell(c.id) : undefined} className={`sticky bottom-0 cursor-pointer whitespace-nowrap border-t border-brand-neon/40 bg-emerald-950 px-4 py-2 tabular-nums ${/\bl\b/.test(c.cls || '') ? 'text-left' : 'text-right'}`}>{c.t}</td>)}</tr></tfoot>}
    </table>
  )
}
