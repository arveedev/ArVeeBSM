// Report Builder (Admin, Analyst and warehouse staff): build your own list, table or pivot table from the data the app holds.
// READ-ONLY. It reads a copy of the records (utils/reportBuilder/sources.js), lays them out (utils/reportBuilder/engine.js) and can export
// the result. The only things it ever writes are the user's own saved layout and a small export log (services/reportLayouts.js).
// A staff member sees only their own warehouses; the sources and the scope are enforced in the data layer, not only on this screen.
// See docs/superpowers/specs/2026-10-20-report-builder-design.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, X, Loader2, ShieldCheck, Save, Trash2, Share2 } from 'lucide-react'
import useEscapeKey from '../../../hooks/useEscapeKey.js'
import useBodyScrollLock from '../../../hooks/useBodyScrollLock.js'
import { buildFields } from '../../../utils/reportBuilder/fields.js'
import { blankLayout, buildTable, flatten, filterText, sanitizeLayout } from '../../../utils/reportBuilder/engine.js'
import { loadSource, sourcesFor, sourceById, defaultParams, isWideRole } from '../../../utils/reportBuilder/sources.js'
import { listLayouts, saveLayout, deleteLayout, logReportEvent } from '../../../services/reportLayouts.js'
import { exportXlsx, exportPdf, exportCsv, copyTable } from '../../../services/reportBuilderExport.js'
import { FieldChip, DropArea, ValueChip, FilterBuilder, CalcBuilder, ColumnsPanel, FormatPanel, ResultTable, pill, pillOn, input } from './rbParts.jsx'
import CompareView from './CompareView.jsx'

const todayISO = () => new Date().toISOString().slice(0, 10)

// ready-made starting points; a field a source does not have is simply dropped when one is opened
const PRESETS = {
  docs: {
    'Received, per warehouse and month': { rows: ['warehouse'], cols: ['date_mo'], vals: [{ f: 'netBags', a: 'sum' }], filters: [{ f: 'type', op: 'is', v: ['WSR'] }, { f: 'status', op: 'is', v: ['Active'] }] },
    'What went out, by customer': { rows: ['customerName'], cols: ['cereal'], vals: [{ f: 'netBags', a: 'sum' }], filters: [{ f: 'type', op: 'is', v: ['WSI'] }, { f: 'status', op: 'is', v: ['Active'] }], sortTot: true },
    'Documents per person': { rows: ['createdByName'], cols: ['type'], vals: [{ f: 'serialNo', a: 'count' }] },
    'Cancelled documents': { mode: 'list', filters: [{ f: 'status', op: 'is', v: ['Cancelled'] }], sort: [{ f: 'date', dir: -1 }] },
  },
  auth: {
    'Authorized vs issued, per customer': { rows: ['customerName'], vals: [{ f: 'totalAllocationBags', a: 'sum' }, { f: 'totalIssuedBags', a: 'sum' }, { f: 'balanceBags', a: 'sum' }] },
    'Authorities with a balance left': { mode: 'list', filters: [{ f: 'balanceBags', op: 'gt', v: '0' }], sort: [{ f: 'balanceBags', dir: -1 }] },
  },
  pr: {
    'Paid per farmer (top 10)': { rows: ['payeeName'], vals: [{ f: 'totalAmount', a: 'sum' }, { f: 'prNo', a: 'count' }], sortTot: true, topn: 10 },
    'Amount per week and payment': { rows: ['date_wk'], cols: ['paymentMethod'], vals: [{ f: 'totalAmount', a: 'sum' }] },
    'PRs whose amount does not match the WSR': { mode: 'list', filters: [{ f: 'amountVsWsr', op: 'ne', v: '0' }, { f: 'status', op: 'is', v: ['Active'] }] },
  },
  piles: { 'Piles by warehouse and state': { rows: ['warehouse'], cols: ['state'], vals: [{ f: 'currentNetBags', a: 'sum' }], subt: true } },
  sd_summary: { 'Stock by age bracket': { rows: ['warehouse'], cols: ['age'], vals: [{ f: 'netBags', a: 'sum' }], heat: true }, 'Per variety, % of total': { rows: ['cereal', 'variety'], vals: [{ f: 'netBags', a: 'sum' }], pct: 'total' } },
  sd_daily: { 'Movement per warehouse': { rows: ['warehouse'], cols: ['movement'], vals: [{ f: 'netBags', a: 'sum' }] } },
  sd_milling: { 'By group and province': { rows: ['group'], cols: ['province'], vals: [{ f: 'netBags', a: 'sum' }], subt: false } },
  cash: { 'Cash movement per month': { rows: ['date_mo'], cols: ['type'], vals: [{ f: 'amount', a: 'sum' }] }, 'Largest entries': { mode: 'list', sort: [{ f: 'amount', dir: -1 }] } },
}

function ReportBuilderModal({ user, onClose }) {
  const role = user?.role
  const sources = useMemo(() => sourcesFor(role), [role])
  const [tab, setTab] = useState('table')
  const [sourceId, setSourceId] = useState('docs')
  const src = sourceById(sourceId)
  const [params, setParams] = useState({})
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [layout, setLayout] = useState(() => blankLayout('docs'))
  const [pop, setPop] = useState(null) // 'filter' | 'cols' | 'fmt' | 'calc' | null
  const [filterField, setFilterField] = useState(null)
  const [menu, setMenu] = useState(null)
  const [drill, setDrill] = useState(null)
  const [layouts, setLayouts] = useState([])
  const [saveName, setSaveName] = useState('')
  const [share, setShare] = useState({ admin: false, analysts: false, staff: false })
  const [editingId, setEditingId] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [busy, setBusy] = useState('')
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024) // on a phone the table comes first
  const pendingLayout = useRef(null)
  useBodyScrollLock(true)
  useEscapeKey(true, (e) => {
    if (document.querySelector('[data-sd-overlay]')) return
    const t = e?.target
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
    if (drill) setDrill(null); else onClose()
  })

  // ---- load the chosen source (read-only) whenever the source or its dates change
  const paramKey = JSON.stringify(params)
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    loadSource(sourceId, { user, params })
      .then((d) => {
        if (!live) return
        setData(d)
        const pend = pendingLayout.current
        pendingLayout.current = null
        if (pend) {
          const { layout: L, dropped } = sanitizeLayout(pend, buildFields(d.fields, pend.calc ?? []).map)
          setLayout(L); setSearchText(L.search ?? '')
          if (dropped.length) toast(`Opened. Left out: ${dropped.join(', ')} (no longer in the data).`)
        }
      })
      .catch((e) => { if (live) { setError(String(e.message ?? e)); setData(null) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, paramKey, user?.uid])

  const refreshLayouts = useCallback(() => listLayouts(user).then(setLayouts).catch(() => setLayouts([])), [user])
  useEffect(() => { refreshLayouts() }, [refreshLayouts])

  const chooseSource = (id) => {
    const s = sourceById(id)
    setSourceId(id); setDrill(null); setPop(null); setEditingId(null)
    setParams(defaultParams(s, todayISO()))
    setLayout(blankLayout(id)); setSearchText('')
  }
  useEffect(() => { setParams(defaultParams(sourceById('docs'), todayISO())) }, [])

  // a quick-start for the source, or a sensible default
  useEffect(() => {
    if (!data || layout.source !== sourceId || layout.rows.length || layout.vals.length || layout.mode !== 'pivot' || layout.filters.length || layout.calc.length) return
    const first = Object.values(PRESETS[sourceId] ?? {})[0]
    if (first) applyPreset(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const fields = useMemo(() => (data ? buildFields(data.fields, layout.calc) : { list: [], map: {} }), [data, layout.calc])
  const table = useMemo(() => (data ? buildTable(layout, data.fields, data.rows) : null), [data, layout])

  const patch = (o) => setLayout((l) => ({ ...l, ...o }))
  const applyPreset = (p) => {
    const { layout: L } = sanitizeLayout({ ...blankLayout(sourceId), ...JSON.parse(JSON.stringify(p)), source: sourceId, calc: layout.calc }, fields.map)
    setLayout(L); setSearchText(L.search ?? ''); setDrill(null)
  }
  const addTo = (area, id) => {
    const f = fields.map[id]
    if (!f) return
    if (area === 'filt') { setFilterField(id); setPop('filter'); return }
    if (area === 'vals') { if (!layout.vals.some((v) => v.f === id)) patch({ vals: [...layout.vals, { f: id, a: f.kind === 'num' ? 'sum' : 'count' }] }); return }
    if (!layout[area].includes(id)) patch({ [area]: [...layout[area], id] })
  }
  // search box: wait a moment after typing
  useEffect(() => { const t = setTimeout(() => setLayout((l) => (l.search === searchText ? l : { ...l, search: searchText })), 220); return () => clearTimeout(t) }, [searchText])

  const onSort = (id) => {
    if (id === '__tot') { patch({ sortTot: !layout.sortTot }); return }
    const i = layout.sort.findIndex((s) => s.f === id)
    patch({ sort: i >= 0 && layout.sort.length === 1 ? (layout.sort[0].dir === 1 ? [{ f: id, dir: -1 }] : []) : [{ f: id, dir: 1 }] })
  }
  const openDrill = (cellId) => { const c = table?.cells.get(cellId); if (c && c.recs.length) setDrill(c) }

  // ---- exports (everything exported is logged for the Admin)
  const meta = () => ({ title: `${src.name}${layout.mode === 'pivot' && layout.rows.length ? ` by ${layout.rows.filter((f) => fields.map[f]).map((f) => fields.map[f].label).join(' / ')}` : ''}`, sourceName: `${src.name}${Object.keys(params).length ? ` (${Object.entries(params).filter(([, v]) => v !== '').map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`, filters: filterText(layout, fields), who: user?.name })
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
      logReportEvent(user, { action: title ? 'export records' : 'export', source: src.name, layout: layouts.find((l) => l.id === editingId)?.name ?? '', format: kind, rows: flat.body.length, filters: m.filters.join('; '), scope: scopeText })
      toast.success(kind === 'xlsx' ? 'Excel file made' : kind === 'pdf' ? 'PDF made' : 'CSV made')
    } catch (e) {
      console.error(e)
      toast.error('Could not make the file')
    } finally { setBusy('') }
  }
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
    pendingLayout.current = l.layout
    setEditingId(l.id); setShare(l.share ?? { admin: false, analysts: false, staff: false }); setSaveName(l.name)
    setDrill(null)
    if (l.source === sourceId) { // same source: no reload needed
      const { layout: L, dropped } = sanitizeLayout(l.layout, buildFields(data.fields, l.layout.calc ?? []).map)
      pendingLayout.current = null
      setLayout(L); setSearchText(L.search ?? '')
      if (dropped.length) toast(`Opened. Left out: ${dropped.join(', ')}`)
    } else { setSourceId(l.source); setParams({ ...defaultParams(s, todayISO()), ...(l.params ?? {}) }) }
  }
  const removeLayout = async (l) => { try { await deleteLayout(user, l.id); if (editingId === l.id) setEditingId(null); refreshLayouts(); toast('Layout deleted') } catch (e) { toast.error(String(e.message ?? e)) } }

  // field menu
  const openMenu = (e, id) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ id, x: Math.min(r.left, window.innerWidth - 210), y: r.bottom + 4 }) }
  const usedIds = new Set([...layout.rows, ...layout.cols, ...layout.vals.map((v) => v.f), ...layout.filters.map((f) => f.f)])
  const visibleFields = fields.list.filter((f) => layout.mode === 'pivot' || !f.d)
  const grouped = useMemo(() => { const g = new Map(); for (const s of sources) { if (!g.has(s.group)) g.set(s.group, []); g.get(s.group).push(s) } return [...g.entries()] }, [sources])
  const presets = PRESETS[sourceId] ?? {}
  const stats = table?.stats

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-neutral-950" onClick={() => setMenu(null)}>
      <div className="mx-auto flex w-full max-w-[110rem] items-center justify-between gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onClose} aria-label="Back" className="rounded-lg border border-brand-amber/40 bg-neutral-900 p-1.5 text-brand-amber hover:bg-brand-amber/10"><ArrowLeft size={18} /></button>
          <h2 className="truncate text-base font-semibold text-app-text">Report Builder</h2>
          <span className="hidden items-center gap-1 rounded-full border border-brand-neon/40 bg-brand-neon/10 px-2.5 py-0.5 text-[11px] font-bold text-brand-neon sm:inline-flex"><ShieldCheck size={12} /> Read-only copy of the records</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-brand-crimson/40 bg-neutral-900 p-1.5 text-brand-crimson hover:bg-brand-crimson/10"><X size={18} /></button>
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-neutral-700">
            {[['table', 'Tables'], ['compare', 'Compare two sources']].map(([k, n]) => <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-1.5 text-sm ${tab === k ? 'bg-brand-neon/10 text-brand-neon' : 'bg-neutral-900 text-neutral-300'}`}>{n}</button>)}
          </div>
          {!isWideRole(role) && <span className="text-xs text-neutral-400">You see only the records of your own warehouses.</span>}
        </div>

        {tab === 'compare' ? <CompareView user={user} /> : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Data source</label>
              <select value={sourceId} onChange={(e) => chooseSource(e.target.value)} className={`${input} max-w-full`}>
                {grouped.map(([g, list]) => <optgroup key={g} label={g}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
              </select>
              {(src?.params ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-xs text-neutral-400">{p.label}
                  {p.type === 'select'
                    ? <select value={params[p.id] ?? p.def} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })} className={input}>{p.options.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
                    : <input type={p.type === 'date' ? 'date' : 'number'} value={params[p.id] ?? ''} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })} className={input} />}
                </label>
              ))}
              {loading && <Loader2 size={16} className="animate-spin text-brand-neon" />}
            </div>
            {Object.keys(presets).length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Ready-made</span>
                {Object.entries(presets).map(([n, p]) => <button key={n} type="button" onClick={() => applyPreset(p)} className={pill}>{n}</button>)}
              </div>
            )}
            {error && <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

            <button type="button" onClick={() => setPanelOpen((v) => !v)} className={`${pill} mb-3 lg:hidden`}>{panelOpen ? 'Hide' : 'Show'} fields, rows, columns and saved layouts</button>
            <div className="grid gap-4 lg:grid-cols-[19.5rem_minmax(0,1fr)]">
              {/* ---------------- left: fields and boxes ---------------- */}
              <div className={`space-y-3 ${panelOpen ? '' : 'hidden lg:block'}`}>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Fields <span className="font-normal normal-case tracking-normal text-neutral-500">drag, or tap one</span></p>
                  <div className="flex max-h-56 flex-wrap gap-1.5 overflow-auto">
                    {visibleFields.map((f) => <FieldChip key={f.id} f={f} draggable used={usedIds.has(f.id)} dashed={!!f.calc} onClick={(e) => { e.stopPropagation(); openMenu(e, f.id) }} />)}
                  </div>
                  <button type="button" onClick={() => setPop('calc')} className={`${pill} mt-2`}>+ Calculated field</button>
                  {layout.mode === 'pivot' && (
                    <div className="mt-3 space-y-2.5">
                      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Rows</p><DropArea area="rows" onDropField={addTo} hint="Drop fields to group down the side">{layout.rows.filter((id) => fields.map[id]).map((id) => <FieldChip key={id} f={fields.map[id]} onRemove={() => patch({ rows: layout.rows.filter((x) => x !== id) })} />)}</DropArea></div>
                      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Columns</p><DropArea area="cols" onDropField={addTo} hint="Drop fields to spread across the top">{layout.cols.filter((id) => fields.map[id]).map((id) => <FieldChip key={id} f={fields.map[id]} onRemove={() => patch({ cols: layout.cols.filter((x) => x !== id) })} />)}</DropArea></div>
                      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Values</p><DropArea area="vals" onDropField={addTo} hint="Drop numbers to total (none = count of records)">{layout.vals.filter((v) => fields.map[v.f]).map((v, i) => <ValueChip key={v.f} f={fields.map[v.f]} v={v} onAgg={(a) => patch({ vals: layout.vals.map((x, k) => (k === i ? { ...x, a } : x)) })} onRemove={() => patch({ vals: layout.vals.filter((x) => x.f !== v.f) })} />)}</DropArea></div>
                      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Filter by a field</p><DropArea area="filt" onDropField={addTo} hint="Drop a field here, or use + Filter" /></div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-400">Saved layouts</p>
                  <div className="flex gap-1.5">
                    <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this layout" className={`${input} min-w-0 flex-1`} />
                    <button type="button" onClick={doSave} className="inline-flex items-center gap-1 rounded-lg bg-brand-neon px-3 py-1.5 text-sm font-semibold text-brand-contrast"><Save size={14} />Save</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-300">
                    <span className="inline-flex items-center gap-1 text-neutral-500"><Share2 size={12} />Share with</span>
                    {[['admin', 'Admin'], ['analysts', 'Analysts'], ['staff', 'Warehouse staff']].map(([k, n]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!share[k]} onChange={(e) => setShare({ ...share, [k]: e.target.checked })} />{n}</label>)}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {layouts.length === 0 && <p className="text-xs text-neutral-500">Nothing saved yet. Only the layout is saved, never the records.</p>}
                    {layouts.map((l) => (
                      <div key={l.id} className={`flex items-center gap-1.5 rounded-lg border bg-neutral-950 px-2 py-1.5 text-xs ${editingId === l.id ? 'border-brand-neon/60' : 'border-neutral-800'}`}>
                        <span className="min-w-0 flex-1 truncate text-neutral-200" title={l.name}>{l.name}<span className="text-neutral-500"> &middot; {sourceById(l.source)?.name.split(' (')[0] ?? l.source}{l.ownerUid !== user?.uid ? ` &middot; by ${l.ownerName || 'someone'}` : ''}</span></span>
                        <button type="button" onClick={() => openLayout(l)} className={pill}>Open</button>
                        {(l.ownerUid === user?.uid || role === 'Admin') && <button type="button" onClick={() => removeLayout(l)} aria-label="Delete layout" className="text-neutral-500 hover:text-red-400"><Trash2 size={14} /></button>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ---------------- right: the table ---------------- */}
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search every field (name, serial, warehouse, number)" className={`${input} min-w-[12rem] flex-1`} />
                  <div className="inline-flex overflow-hidden rounded-lg border border-neutral-700">
                    {[['pivot', 'Pivot table'], ['list', 'List of records']].map(([k, n]) => <button key={k} type="button" onClick={() => patch({ mode: k })} className={`px-3 py-1.5 text-sm ${layout.mode === k ? 'bg-brand-neon/10 text-brand-neon' : 'bg-neutral-900 text-neutral-300'}`}>{n}</button>)}
                  </div>
                  <button type="button" onClick={() => { setFilterField(null); setPop(pop === 'filter' ? null : 'filter') }} className={`${pill} ${pop === 'filter' ? pillOn : ''}`}>+ Filter</button>
                  {layout.mode === 'list' && <button type="button" onClick={() => setPop(pop === 'cols' ? null : 'cols')} className={`${pill} ${pop === 'cols' ? pillOn : ''}`}>Columns</button>}
                  <button type="button" onClick={() => setPop(pop === 'fmt' ? null : 'fmt')} className={`${pill} ${pop === 'fmt' ? pillOn : ''}`}>Format</button>
                </div>

                {pop === 'filter' && <FilterBuilder key={filterField ?? 'x'} fields={fields} rows={data?.rows ?? []} initialField={filterField} onAdd={(ft) => { patch({ filters: [...layout.filters, ft] }); setPop(null) }} onCancel={() => setPop(null)} />}
                {pop === 'calc' && <CalcBuilder fields={fields} onAdd={(c) => { patch({ calc: [...layout.calc, c] }); setPop(null); toast.success(`Calculated field added: ${c.label}`) }} onCancel={() => setPop(null)} />}
                {pop === 'cols' && layout.mode === 'list' && <ColumnsPanel fields={fields} layout={layout} onChange={patch} />}
                {pop === 'fmt' && <FormatPanel layout={layout} onChange={patch} />}

                {(layout.filters.length > 0 || layout.search) && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {layout.filters.map((ft, i) => { const f = fields.map[ft.f]; if (!f) return null; return <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-brand-neon/35 bg-brand-neon/10 py-0.5 pl-3 pr-1.5 text-xs text-app-text">{filterText({ filters: [ft], search: '' }, fields)[0]}<button type="button" onClick={() => patch({ filters: layout.filters.filter((_, k) => k !== i) })} aria-label="Remove filter" className="text-neutral-400 hover:text-red-400"><X size={12} /></button></span> })}
                    {layout.search && <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-neon/35 bg-brand-neon/10 py-0.5 pl-3 pr-1.5 text-xs">Search &quot;{layout.search}&quot;<button type="button" onClick={() => { setSearchText(''); patch({ search: '' }) }} aria-label="Clear search" className="text-neutral-400 hover:text-red-400"><X size={12} /></button></span>}
                  </div>
                )}

                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">{src.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={!table || busy} onClick={() => doExport('xlsx')} className={pill}>{busy === 'xlsx' ? 'Making…' : 'Excel (.xlsx)'}</button>
                    <button type="button" disabled={!table || busy} onClick={() => doExport('pdf')} className={pill}>{busy === 'pdf' ? 'Making…' : 'PDF to print'}</button>
                    <button type="button" disabled={!table || busy} onClick={() => doExport('csv')} className={pill}>CSV</button>
                    <button type="button" disabled={!table || busy} onClick={() => doExport('copy')} className={pill}>Copy</button>
                  </div>
                </div>
                <div className="max-h-[62vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950">
                  {loading && !table ? <div className="p-10 text-center text-sm text-neutral-500">Loading…</div> : table ? <ResultTable table={table} layout={layout} onSort={onSort} onCell={openDrill} /> : <div className="p-10 text-center text-sm text-neutral-500">Nothing to show.</div>}
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-neutral-500">
                  <span>
                    {stats && layout.mode === 'list' && `${stats.records.toLocaleString('en-US')} records${stats.more > 0 ? ` (first ${stats.shown} shown; the exports have all ${stats.records.toLocaleString('en-US')})` : ''}`}
                    {stats && layout.mode === 'pivot' && `${stats.records.toLocaleString('en-US')} records counted, ${stats.rows} rows${stats.cols ? `, ${stats.cols} columns` : ''}. Click any number to see the records behind it.`}
                  </span>
                  <span>Read from this device&apos;s copy of the records</span>
                </div>

                {drill && (
                  <div className="mt-3 rounded-xl border border-brand-neon/40 bg-neutral-900 p-3">
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
                        <thead><tr>{fields.list.filter((f) => !f.d).map((f) => <th key={f.id} className={`sticky top-0 whitespace-nowrap border-b border-neutral-800 bg-neutral-900 px-2.5 py-1 font-bold text-neutral-400 ${f.kind === 'num' ? 'text-right' : 'text-left'}`}>{f.label}</th>)}</tr></thead>
                        <tbody>
                          {drill.recs.slice(0, 200).map((r, i) => <tr key={i} className="hover:bg-neutral-900/60">{fields.list.filter((f) => !f.d).map((f) => { const v = f.calc ? '' : (f.get ? f.get(r) : r[f.id]); return <td key={f.id} className={`whitespace-nowrap border-b border-neutral-900 px-2.5 py-1 tabular-nums ${f.kind === 'num' ? 'text-right' : ''}`}>{f.kind === 'num' && typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v ?? '')}</td> })}</tr>)}
                        </tbody>
                      </table>
                    </div>
                    {drill.recs.length > 200 && <p className="mt-1 text-xs text-neutral-500">First 200 shown; the exports have all {drill.recs.length.toLocaleString('en-US')}.</p>}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {menu && (
        <div style={{ left: menu.x, top: menu.y }} className="fixed z-[90] min-w-[11rem] rounded-xl border border-neutral-700 bg-neutral-900 p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          {(layout.mode === 'list' ? [['filt', 'Filter by this field'], ['sort', 'Sort by this field']] : [['rows', 'Add to Rows'], ['cols', 'Add to Columns'], ['vals', 'Add to Values'], ['filt', 'Filter by this field']]).map(([a, n]) => (
            <button key={a} type="button" onClick={() => { if (a === 'sort') patch({ sort: [{ f: menu.id, dir: 1 }] }); else addTo(a, menu.id); setMenu(null) }} className="block w-full rounded-lg px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-brand-neon/10 hover:text-brand-neon">{n}</button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

export default ReportBuilderModal
