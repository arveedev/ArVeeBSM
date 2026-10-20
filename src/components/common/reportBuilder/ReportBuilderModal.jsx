// Report Builder (Admin, Analyst and warehouse staff): build your own list, table or pivot table from the data the app holds.
// READ-ONLY. It reads a copy of the records (utils/reportBuilder/sources.js), lays them out (utils/reportBuilder/engine.js) and can export
// the result. The only things it ever writes are the user's own saved layout and a small export log (services/reportLayouts.js).
// A staff member sees only their own warehouses; the sources, the scope and the September 1, 2026 floor are enforced in the data layer.
// See docs/superpowers/specs/2026-10-20-report-builder-design.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, X, Loader2, ShieldCheck, Save, Trash2, Share2, RotateCcw } from 'lucide-react'
import useEscapeKey from '../../../hooks/useEscapeKey.js'
import useBodyScrollLock from '../../../hooks/useBodyScrollLock.js'
import { buildFields } from '../../../utils/reportBuilder/fields.js'
import { groupFields } from '../../../utils/reportBuilder/categories.js'
import { blankLayout, buildTable, flatten, filterText, sanitizeLayout, REPORT_FLOOR, clampPeriod } from '../../../utils/reportBuilder/engine.js'
import { loadSource, sourcesFor, sourceById, defaultParams, isWideRole } from '../../../utils/reportBuilder/sources.js'
import { listLayouts, saveLayout, deleteLayout, logReportEvent } from '../../../services/reportLayouts.js'
import { exportXlsx, exportPdf, exportCsv, copyTable } from '../../../services/reportBuilderExport.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { FieldChip, FieldPicker, DropArea, ValueChip, FilterBuilder, FormulaBuilder, ColumnsPanel, FormatPanel, ResultTable, pill, pillOn, input } from './rbParts.jsx'

const todayISO = () => new Date().toISOString().slice(0, 10)
const longDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
const monthStart = (iso) => `${iso.slice(0, 8)}01`
const daysBefore = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10)

// A fresh layout: a plain list of the source's main fields (the rest are one tick away in Columns).
const freshLayout = (sourceId) => blankLayout(sourceId) // the table starts empty: nothing is built until the person picks fields

function ReportBuilderModal({ user, onClose }) {
  const role = user?.role
  const sources = useMemo(() => sourcesFor(role), [role])
  const [sourceId, setSourceId] = useState('docs')
  const src = sourceById(sourceId)
  const [params, setParams] = useState(() => defaultParams(sourceById('docs')))
  const [period, setPeriodRaw] = useState(() => clampPeriod({ from: REPORT_FLOOR, to: todayISO() }))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [layout, setLayout] = useState(() => blankLayout('docs'))
  const [pop, setPop] = useState(null) // 'filter' | 'cols' | 'fmt' | 'calc' | null
  const [filterField, setFilterField] = useState(null)
  const [editingCalc, setEditingCalc] = useState(null)
  const [menu, setMenu] = useState(null)
  const [drill, setDrill] = useState(null)
  const [layouts, setLayouts] = useState([])
  const [saveName, setSaveName] = useState('')
  const [share, setShare] = useState({ admin: false, analysts: false, staff: false })
  const [editingId, setEditingId] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [fieldQuery, setFieldQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024) // on a phone the table comes first
  const pendingLayout = useRef(null)
  const needsInit = useRef(true)
  useBodyScrollLock(true)
  useEscapeKey(true, (e) => {
    if (document.querySelector('[data-sd-overlay]')) return
    const t = e?.target
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
    if (drill) setDrill(null); else onClose()
  })

  // the period: never before September 1, 2026 (the data of this app is complete from then)
  const floor = REPORT_FLOOR
  const setPeriod = (p) => {
    if ((p.from && p.from < floor) || (p.to && p.to < floor)) toast(`The reports start on ${longDay(floor)}`)
    setPeriodRaw(clampPeriod(p))
  }
  const periodKey = `${period.from}|${period.to}`

  // ---- load the chosen source (read-only) whenever the source, its options or the period change
  const paramKey = JSON.stringify(params)
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    loadSource(sourceId, { user, params, period })
      .then((d) => {
        if (!live) return
        setData(d)
        const pend = pendingLayout.current
        pendingLayout.current = null
        if (pend) {
          const { layout: L, dropped } = sanitizeLayout(pend, buildFields(d.fields, pend.calc ?? []).map)
          setLayout(L); setSearchText(L.search ?? '')
          if (dropped.length) toast(`Opened. Left out: ${dropped.join(', ')} (no longer in the data).`)
          needsInit.current = false
        } else if (needsInit.current) {
          setLayout(freshLayout(sourceId)); setSearchText('')
          needsInit.current = false
        }
      })
      .catch((e) => { if (live) { setError(String(e.message ?? e)); setData(null) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, paramKey, periodKey, user?.uid])

  const refreshLayouts = useCallback(() => listLayouts(user).then(setLayouts).catch(() => setLayouts([])), [user])
  useEffect(() => { refreshLayouts() }, [refreshLayouts])

  const chooseSource = (id) => {
    needsInit.current = true
    setSourceId(id); setDrill(null); setPop(null); setEditingId(null); setSaveName(''); setFieldQuery('')
    setParams(defaultParams(sourceById(id)))
    setLayout(blankLayout(id)); setSearchText('')
  }
  const startOver = () => { if (data) { setLayout(freshLayout(sourceId)); setSearchText(''); setEditingId(null); setSaveName(''); setDrill(null); setPop(null) } }

  const fields = useMemo(() => (data ? buildFields(data.fields, layout.calc) : { list: [], map: {} }), [data, layout.calc])
  const table = useMemo(() => (data ? buildTable(layout, data.fields, data.rows) : null), [data, layout])
  const groups = useMemo(() => groupFields(fields.list.filter((f) => layout.mode === 'pivot' || !f.d), data?.main ?? []), [fields, data, layout.mode])

  const patch = (o) => setLayout((l) => ({ ...l, ...o }))
  const isBlank = layout.mode === 'pivot' && !layout.rows.length && !layout.cols.length && !layout.vals.length
  // the list shows the source's main fields first; the rest are one tick away in Columns
  const setMode = (k) => setLayout((l) => (k === 'list' && !l.hidden.length && !l.order.length && data?.main?.length ? { ...l, mode: k, hidden: data.fields.filter((f) => !data.main.includes(f.id)).map((f) => f.id) } : { ...l, mode: k }))
  const addTo = (area, id) => {
    const f = fields.map[id]
    if (!f) return
    if (area === 'filt') { setFilterField(id); setPop('filter'); return }
    if (layout.mode !== 'pivot') setLayout((l) => ({ ...l, mode: 'pivot' }))
    if (area === 'vals') { if (!layout.vals.some((v) => v.f === id)) patch({ vals: [...layout.vals, { f: id, a: f.kind === 'num' ? 'sum' : 'count' }] }); return }
    if (!layout[area].includes(id)) patch({ [area]: [...layout[area], id] })
  }
  useEffect(() => { const t = setTimeout(() => setLayout((l) => (l.search === searchText ? l : { ...l, search: searchText })), 220); return () => clearTimeout(t) }, [searchText])

  const onSort = (id) => {
    if (id === '__tot') { patch({ sortTot: !layout.sortTot }); return }
    const i = layout.sort.findIndex((s) => s.f === id)
    patch({ sort: i >= 0 && layout.sort.length === 1 ? (layout.sort[0].dir === 1 ? [{ f: id, dir: -1 }] : []) : [{ f: id, dir: 1 }] })
  }
  const openDrill = (cellId) => { const c = table?.cells.get(cellId); if (c && c.recs.length) setDrill(c) }

  // ---- exports (everything exported is logged for the Admin)
  const sourceDated = data?.dated !== false
  const periodText = `${longDay(period.from)} to ${longDay(period.to)}`
  const meta = () => ({ title: `${src.name}${layout.mode === 'pivot' && layout.rows.length ? ` by ${layout.rows.filter((f) => fields.map[f]).map((f) => fields.map[f].label).join(' / ')}` : ''}`, sourceName: `${src.name}${sourceDated ? `, ${periodText}` : ''}`, filters: filterText(layout, fields), who: user?.name })
  const scopeText = isWideRole(role) ? 'All warehouses' : 'Own warehouses'
  const doExport = async (kind, t = null, title = null) => {
    if (!data) return
    setBusy(kind)
    try {
      const flat = t ?? flatten(layout, buildTable(layout, data.fields, data.rows, { full: true }))
      const m = meta()
      if (title) m.title = title
      const base = m.title
      if (kind === 'xlsx') await exportXlsx(flat, m, base)
      else if (kind === 'pdf') await exportPdf(flat, m, base)
      else if (kind === 'csv') exportCsv(flat, base)
      else { toast((await copyTable(flat)) ? 'Copied. Paste it into a Sheet or Excel.' : 'Could not copy here'); setBusy(''); return }
      logReportEvent(user, { action: title ? 'export records' : 'export', source: src.name, layout: layouts.find((l) => l.id === editingId)?.name ?? '', format: kind, rows: flat.body.length, filters: [...m.filters, sourceDated ? periodText : ''].filter(Boolean).join('; '), scope: scopeText })
      toast.success(kind === 'xlsx' ? 'Excel file made' : kind === 'pdf' ? 'PDF made' : 'CSV made')
    } catch (e) {
      console.error(e)
      toast.error('Could not make the file')
    } finally { setBusy('') }
  }
  const drillCols = () => fields.list.filter((f) => !f.d && (!data?.main?.length || data.main.includes(f.id) || f.calc))
  const drillFlat = () => {
    const cols = fields.list.filter((f) => !f.d)
    return { hr: null, head: cols.map((f) => f.label), body: drill.recs.map((r) => cols.map((f) => { const v = f.calc ? null : (f.get ? f.get(r) : r[f.id]); return f.kind === 'num' ? Number(v) || 0 : String(v ?? '') })), foot: null }
  }

  // ---- saved layouts
  const doSave = async () => {
    if (!saveName.trim()) { toast('Give the layout a name first'); return }
    try {
      const keepParams = Object.fromEntries(Object.entries(params).filter(([k]) => !['asOf', 'from', 'to'].includes(k)))
      const row = await saveLayout(user, { id: editingId && layouts.find((l) => l.id === editingId)?.name === saveName.trim() ? editingId : null, name: saveName, source: sourceId, layout, params: keepParams, share })
      setEditingId(row.id); setSaveName(''); refreshLayouts()
      toast.success(`Saved: ${row.name}`)
      if (row.share.admin || row.share.analysts || row.share.staff) logReportEvent(user, { action: 'share layout', source: src.name, layout: row.name, filters: Object.entries(row.share).filter(([, v]) => v).map(([k]) => k).join(', '), scope: scopeText })
    } catch (e) { toast.error(String(e.message ?? e)) }
  }
  const openLayout = (l) => {
    const s = sourceById(l.source)
    if (!s || !sourcesFor(role).some((x) => x.id === s.id)) { toast('This layout uses data your role cannot open.'); return }
    setEditingId(l.id); setShare(l.share ?? { admin: false, analysts: false, staff: false }); setSaveName(l.name)
    setDrill(null); setPop(null)
    if (l.source === sourceId && data) {
      const { layout: L, dropped } = sanitizeLayout(l.layout, buildFields(data.fields, l.layout.calc ?? []).map)
      setLayout(L); setSearchText(L.search ?? '')
      if (dropped.length) toast(`Opened. Left out: ${dropped.join(', ')}`)
    } else { pendingLayout.current = l.layout; needsInit.current = false; setSourceId(l.source); setParams({ ...defaultParams(s), ...(l.params ?? {}) }) }
  }
  const removeLayout = async (l) => { try { await deleteLayout(user, l.id); if (editingId === l.id) setEditingId(null); refreshLayouts(); toast('Layout deleted') } catch (e) { toast.error(String(e.message ?? e)) } }

  // field menu
  const openMenu = (e, f) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ f, x: Math.min(r.left, window.innerWidth - 220), y: Math.min(r.bottom + 4, window.innerHeight - 240) }) }
  const used = useMemo(() => new Set([...layout.rows, ...layout.cols, ...layout.vals.map((v) => v.f), ...layout.filters.map((f) => f.f)]), [layout])
  const grouped = useMemo(() => { const g = new Map(); for (const s of sources) { if (!g.has(s.group)) g.set(s.group, []); g.get(s.group).push(s) } return [...g.entries()] }, [sources])
  const stats = table?.stats
  const today = todayISO()
  const quick = [['Since Sept 1', floor, today], ['This month', monthStart(today) < floor ? floor : monthStart(today), today], ['Last 7 days', daysBefore(today, 6) < floor ? floor : daysBefore(today, 6), today]]

  return createPortal(
    <div className="sd-pop-in fixed inset-0 z-[80] flex flex-col bg-neutral-950" onClick={() => setMenu(null)}>
      <div className="mx-auto flex w-full max-w-[110rem] items-center justify-between gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onClose} aria-label="Back" className="rounded-lg border border-brand-amber/40 bg-neutral-900 p-1.5 text-brand-amber transition-colors hover:bg-brand-amber/10"><ArrowLeft size={18} /></button>
          <h2 className="truncate text-base font-semibold text-app-text">Report Builder</h2>
          <span className="hidden items-center gap-1 rounded-full border border-brand-neon/40 bg-brand-neon/10 px-2.5 py-0.5 text-[11px] font-bold text-brand-neon sm:inline-flex"><ShieldCheck size={12} /> Read-only copy of the records</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-brand-crimson/40 bg-neutral-900 p-1.5 text-brand-crimson transition-colors hover:bg-brand-crimson/10"><X size={18} /></button>
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* ---------------- the period, and saving the layout ---------------- */}
        <div className="rb-fade mb-2 space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-2.5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">From</p><CalendarDatePicker value={period.from} label="From" onChange={(iso) => setPeriod({ from: iso, to: period.to < iso ? iso : period.to })} /></div>
              <div className="w-40"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">To</p><CalendarDatePicker value={period.to} label="To" onChange={(iso) => setPeriod({ from: period.from > iso ? iso : period.from, to: iso })} /></div>
              <div className="flex flex-wrap gap-1.5 pb-0.5">
                {quick.map(([n, f, t]) => <button key={n} type="button" onClick={() => setPeriod({ from: f, to: t })} className={`${pill} ${period.from === f && period.to === t ? pillOn : ''}`}>{n}</button>)}
              </div>
            </div>
            <div className="min-w-[16rem] flex-1">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Save this layout</p>
              <div className="flex gap-1.5">
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this layout" className={`${input} min-w-0 flex-1`} />
                <button type="button" onClick={doSave} disabled={isBlank} className="inline-flex items-center gap-1 rounded-lg bg-brand-neon px-3 py-1.5 text-sm font-semibold text-brand-contrast transition-transform active:scale-95 disabled:opacity-40"><Save size={14} />Save</button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-300">
                <span className="inline-flex items-center gap-1 text-neutral-500"><Share2 size={12} />Share with</span>
                {[['admin', 'Admin'], ['analysts', 'Analysts'], ['staff', 'Warehouse staff']].map(([k, n]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!share[k]} onChange={(e) => setShare({ ...share, [k]: e.target.checked })} />{n}</label>)}
              </div>
            </div>
          </div>
          {layouts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-800 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Saved</span>
              {layouts.map((l) => (
                <span key={l.id} className={`rb-pop inline-flex items-center gap-1.5 rounded-full border bg-neutral-950 py-0.5 pl-1 pr-2 text-xs ${editingId === l.id ? 'border-brand-neon/60' : 'border-neutral-800'}`}>
                  <button type="button" onClick={() => openLayout(l)} className="rounded-full px-2 py-0.5 text-neutral-200 transition-colors hover:text-brand-neon" title={sourceById(l.source)?.name ?? l.source}>{l.name}{l.ownerUid !== user?.uid ? <span className="text-neutral-500"> &middot; by {l.ownerName || 'someone'}</span> : null}</button>
                  {(l.ownerUid === user?.uid || role === 'Admin') && <button type="button" onClick={() => removeLayout(l)} aria-label="Delete layout" className="text-neutral-500 transition-colors hover:text-red-400"><Trash2 size={12} /></button>}
                </span>
              ))}
            </div>
          )}
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-500" htmlFor="rb-source">Data</label>
              <select id="rb-source" value={sourceId} onChange={(e) => chooseSource(e.target.value)} className={`${input} max-w-full`}>
                {grouped.map(([g, list]) => <optgroup key={g} label={g}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
              </select>
              {(src?.params ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-xs text-neutral-400">{p.label}
                  {p.type === 'select'
                    ? <select value={params[p.id] ?? p.def} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })} className={input}>{p.options.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
                    : <input type="number" value={params[p.id] ?? ''} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })} className={`${input} w-20`} />}
                </label>
              ))}
              <button type="button" onClick={startOver} className={pill}><RotateCcw size={13} />Start over</button>
              {loading && <Loader2 size={16} className="animate-spin text-brand-neon" />}
            </div>
          <p className="mt-1.5 text-[11px] text-neutral-500">
            {sourceDated
              ? `Records dated ${longDay(period.from)} to ${longDay(period.to)}. Nothing before ${longDay(floor)} is ever shown.`
              : 'This source has no dates (it lists what exists now), so the period does not cut it.'}
            {!isWideRole(role) && ' You see only the records of your own warehouses.'}
          </p>
        </div>

        <>
            {error && <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

            {/* ---------------- the builder: fields, and the boxes to drop them in ---------------- */}
            <button type="button" onClick={() => setPanelOpen((v) => !v)} className={`${pill} mb-3 lg:hidden`}>{panelOpen ? 'Hide' : 'Show'} fields, rows, columns and values</button>
            <div className={`mb-3 gap-2 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] ${panelOpen ? 'grid' : 'hidden'}`}>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-2.5">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Fields <span className="font-normal normal-case tracking-normal text-neutral-500">drag one into a box, or tap it</span></p>
                <FieldPicker key={sourceId + layout.mode} groups={groups} used={used} query={fieldQuery} setQuery={setFieldQuery} onPick={(e, f) => openMenu(e, f)} />
                <button type="button" onClick={() => { setEditingCalc(null); setPop('calc') }} className={`${pill} mt-2`}>+ Calculated field (a formula)</button>
              </div>
              <div className="mt-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-2.5 lg:mt-0">
                <p className="mb-1.5 text-[11px] leading-snug text-neutral-500">Drag fields into the boxes: Rows down the side, Columns across the top, Values added up. Or choose &quot;List of records&quot; to see the records.</p>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div><p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Rows</p><DropArea area="rows" onDropField={addTo} hint="Drop fields to group down the side">{layout.rows.filter((id) => fields.map[id]).map((id) => <FieldChip key={id} f={fields.map[id]} onRemove={() => patch({ rows: layout.rows.filter((x) => x !== id) })} />)}</DropArea></div>
                  <div><p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Columns</p><DropArea area="cols" onDropField={addTo} hint="Drop fields to spread across the top">{layout.cols.filter((id) => fields.map[id]).map((id) => <FieldChip key={id} f={fields.map[id]} onRemove={() => patch({ cols: layout.cols.filter((x) => x !== id) })} />)}</DropArea></div>
                  <div><p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Values</p><DropArea area="vals" onDropField={addTo} hint="Drop numbers to add up (none = count of records)">{layout.vals.filter((v) => fields.map[v.f]).map((v, i) => <ValueChip key={v.f} f={fields.map[v.f]} v={v} onAgg={(a) => patch({ vals: layout.vals.map((x, k) => (k === i ? { ...x, a } : x)) })} onRemove={() => patch({ vals: layout.vals.filter((x) => x.f !== v.f) })} />)}</DropArea></div>
                  <div><p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Filter</p><DropArea area="filt" onDropField={addTo} hint="Drop a field here to keep only some records" /></div>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search every field (name, serial, warehouse, number)" className={`${input} min-w-[12rem] flex-1`} />
                  <div className="inline-flex overflow-hidden rounded-lg border border-neutral-700">
                    {[['list', 'List of records'], ['pivot', 'Pivot table']].map(([k, n]) => <button key={k} type="button" onClick={() => setMode(k)} className={`px-3 py-1.5 text-sm transition-colors ${layout.mode === k ? 'bg-brand-neon/10 text-brand-neon' : 'bg-neutral-900 text-neutral-300 hover:text-app-text'}`}>{n}</button>)}
                  </div>
                  <button type="button" onClick={() => { setFilterField(null); setPop(pop === 'filter' ? null : 'filter') }} className={`${pill} ${pop === 'filter' ? pillOn : ''}`}>+ Filter</button>
                  {layout.mode === 'list' && <button type="button" onClick={() => setPop(pop === 'cols' ? null : 'cols')} className={`${pill} ${pop === 'cols' ? pillOn : ''}`}>Columns</button>}
                  <button type="button" onClick={() => setPop(pop === 'fmt' ? null : 'fmt')} className={`${pill} ${pop === 'fmt' ? pillOn : ''}`}>Format</button>
                </div>

                {pop === 'filter' && <FilterBuilder key={filterField ?? 'x'} fields={fields} rows={data?.rows ?? []} initialField={filterField} onAdd={(ft) => { patch({ filters: [...layout.filters, ft] }); setPop(null) }} onCancel={() => setPop(null)} />}
                {pop === 'calc' && data && <FormulaBuilder key={editingCalc?.id ?? 'new'} baseFields={data.fields} rows={data.rows} fields={fields} calc={layout.calc} editing={editingCalc} onSave={(c) => { patch({ calc: editingCalc ? layout.calc.map((x) => (x.id === c.id ? c : x)) : [...layout.calc, c] }); setPop(null); setEditingCalc(null); toast.success(editingCalc ? 'Calculated field changed' : `Calculated field added: ${c.label}`) }} onCancel={() => { setPop(null); setEditingCalc(null) }} />}
                {pop === 'cols' && layout.mode === 'list' && <ColumnsPanel fields={fields} layout={layout} onChange={patch} />}
                {pop === 'fmt' && <FormatPanel layout={layout} onChange={patch} />}

                {(layout.filters.length > 0 || layout.search) && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {layout.filters.map((ft, i) => { const f = fields.map[ft.f]; if (!f) return null; return <span key={i} className="rb-pop inline-flex items-center gap-1.5 rounded-full border border-brand-neon/35 bg-brand-neon/10 py-0.5 pl-3 pr-1.5 text-xs text-app-text">{filterText({ filters: [ft], search: '' }, fields)[0]}<button type="button" onClick={() => patch({ filters: layout.filters.filter((_, k) => k !== i) })} aria-label="Remove filter" className="text-neutral-400 hover:text-red-400"><X size={12} /></button></span> })}
                    {layout.search && <span className="rb-pop inline-flex items-center gap-1.5 rounded-full border border-brand-neon/35 bg-brand-neon/10 py-0.5 pl-3 pr-1.5 text-xs">Search &quot;{layout.search}&quot;<button type="button" onClick={() => { setSearchText(''); patch({ search: '' }) }} aria-label="Clear search" className="text-neutral-400 hover:text-red-400"><X size={12} /></button></span>}
                  </div>
                )}

                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">{src.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={!table || isBlank || !!busy} onClick={() => doExport('xlsx')} className={pill}>{busy === 'xlsx' ? 'Making…' : 'Excel (.xlsx)'}</button>
                    <button type="button" disabled={!table || isBlank || !!busy} onClick={() => doExport('pdf')} className={pill}>{busy === 'pdf' ? 'Making…' : 'PDF to print'}</button>
                    <button type="button" disabled={!table || isBlank || !!busy} onClick={() => doExport('csv')} className={pill}>CSV</button>
                    <button type="button" disabled={!table || isBlank || !!busy} onClick={() => doExport('copy')} className={pill}>Copy</button>
                  </div>
                </div>
                <div className="max-h-[62vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950">
                  {isBlank ? <div className="p-10 text-center"><p className="text-sm font-semibold text-neutral-300">The table is empty</p><p className="mx-auto mt-1 max-w-md text-xs text-neutral-500">Drag fields into Rows, Columns or Values above to build a pivot table, or choose &quot;List of records&quot; to see the records themselves.</p></div> : loading && !table ? <div className="p-10 text-center text-sm text-neutral-500">Loading&hellip;</div> : table ? <div key={`${sourceId}-${periodKey}-${layout.mode}`} className="rb-fade"><ResultTable table={table} layout={layout} onSort={onSort} onCell={openDrill} /></div> : <div className="p-10 text-center text-sm text-neutral-500">Nothing to show.</div>}
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-neutral-500">
                  <span>
                    {stats && !isBlank && layout.mode === 'list' && `${stats.records.toLocaleString('en-US')} records${stats.more > 0 ? ` (first ${stats.shown} shown; the exports have all ${stats.records.toLocaleString('en-US')})` : ''}`}
                    {stats && !isBlank && layout.mode === 'pivot' && `${stats.records.toLocaleString('en-US')} records counted, ${stats.rows} rows${stats.cols ? `, ${stats.cols} columns` : ''}. Click any number to see the records behind it.`}
                  </span>
                  <span>Read from this device&apos;s copy of the records</span>
                </div>

                {drill && (
                  <div className="rb-drop mt-3 rounded-xl border border-brand-neon/40 bg-neutral-900 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <b className="text-sm text-app-text">{drill.recs.length.toLocaleString('en-US')} records behind: {drill.label}</b>
                      <span className="flex gap-1.5">
                        <button type="button" onClick={() => doExport('xlsx', drillFlat(), `Records behind ${drill.label}`)} className={pill}>Excel</button>
                        <button type="button" onClick={() => doExport('pdf', drillFlat(), `Records behind ${drill.label}`)} className={pill}>PDF</button>
                        <button type="button" onClick={() => setDrill(null)} className={pill}>Close</button>
                      </span>
                    </div>
                    <div className="max-h-[34vh] overflow-auto rounded-lg border border-neutral-800 bg-neutral-950">
                      <table className="w-full border-separate border-spacing-0 text-xs">
                        <thead><tr>{drillCols().map((f) => <th key={f.id} className={`sticky top-0 whitespace-nowrap border-b border-neutral-800 bg-neutral-900 px-2.5 py-1 font-bold text-neutral-400 ${f.kind === 'num' ? 'text-right' : 'text-left'}`}>{f.label}</th>)}</tr></thead>
                        <tbody>
                          {drill.recs.slice(0, 200).map((r, i) => <tr key={i} className="hover:bg-neutral-900/60">{drillCols().map((f) => { const v = f.calc ? '' : (f.get ? f.get(r) : r[f.id]); return <td key={f.id} className={`whitespace-nowrap border-b border-neutral-900 px-2.5 py-1 tabular-nums ${f.kind === 'num' ? 'text-right' : ''}`}>{f.kind === 'num' && typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v ?? '')}</td> })}</tr>)}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">{drill.recs.length > 200 ? 'First 200 shown. ' : ''}The Excel and PDF contain every field of all {drill.recs.length.toLocaleString('en-US')} records.</p>
                  </div>
                )}
              </div>
            </div>
        </>
      </div>

      {menu && (
        <div style={{ left: menu.x, top: menu.y }} className="rb-drop fixed z-[90] min-w-[12rem] rounded-xl border border-neutral-700 bg-neutral-900 p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <p className="break-words px-3 pb-1 pt-0.5 text-[11px] font-bold text-neutral-500">{menu.f.label}</p>
          {[
            ['rows', 'Add to Rows (pivot)'], ['cols', 'Add to Columns (pivot)'], ['vals', 'Add to Values (pivot)'], ['filt', 'Filter by this field'], ...(layout.mode === 'list' ? [['sort', 'Sort by this field']] : []),
            ...(menu.f.calc ? [['edit', 'Change this formula'], ['del', 'Delete this field']] : []),
          ].map(([a, n]) => (
            <button key={a} type="button" onClick={() => {
              if (a === 'sort') patch({ sort: [{ f: menu.f.id, dir: 1 }] })
              else if (a === 'edit') { setEditingCalc(layout.calc.find((c) => c.id === menu.f.id) ?? null); setPop('calc') }
              else if (a === 'del') patch({ calc: layout.calc.filter((c) => c.id !== menu.f.id), rows: layout.rows.filter((x) => x !== menu.f.id), cols: layout.cols.filter((x) => x !== menu.f.id), vals: layout.vals.filter((v) => v.f !== menu.f.id), filters: layout.filters.filter((x) => x.f !== menu.f.id) })
              else addTo(a, menu.f.id)
              setMenu(null)
            }} className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-brand-neon/10 hover:text-brand-neon ${a === 'del' ? 'text-red-300' : 'text-neutral-200'}`}>{n}</button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

export default ReportBuilderModal
