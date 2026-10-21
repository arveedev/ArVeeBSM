// Report Builder (Admin, Analyst and warehouse staff): build your own list, table or pivot table from the data the app holds.
// READ-ONLY. It reads a copy of the records (utils/reportBuilder/sources.js), lays them out (utils/reportBuilder/engine.js) and can export
// the result. The only things it ever writes are the user's own saved layout and a small export log (services/reportLayouts.js).
// A staff member sees only their own warehouses; the sources, the scope and the September 1, 2026 floor are enforced in the data layer.
// REACTIVE: the field list follows the filters (a field that nothing in the filtered records has is not offered), and a formula can only
// use the fields that are part of the table being built.
// See docs/superpowers/specs/2026-10-20-report-builder-design.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, X, Loader2, ShieldCheck, Save, Trash2, Share2, RotateCcw } from 'lucide-react'
import useEscapeKey from '../../../hooks/useEscapeKey.js'
import useBodyScrollLock from '../../../hooks/useBodyScrollLock.js'
import { buildFields, readValue } from '../../../utils/reportBuilder/fields.js'
import { groupFields, isHiddenField } from '../../../utils/reportBuilder/categories.js'
import { blankLayout, buildTable, flatten, filterText, selectRows, sanitizeLayout, REPORT_FLOOR, clampPeriod } from '../../../utils/reportBuilder/engine.js'
import { loadSource, sourcesFor, sourceById, defaultParams, isWideRole } from '../../../utils/reportBuilder/sources.js'
import { listLayouts, saveLayout, deleteLayout, logReportEvent } from '../../../services/reportLayouts.js'
import { exportXlsx, exportPdf } from '../../../services/reportBuilderExport.js'
import { db } from '../../../db/dexie.js'
import { isStaffRole } from '../../../utils/roles.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
import { FieldChip, FieldPicker, DropArea, ValueChip, FilterBuilder, FormulaBuilder, ColumnsPanel, FormatPanel, ResultTable, btnGhost, pill, pillOn, input } from './rbParts.jsx'

const todayISO = () => new Date().toISOString().slice(0, 10)
const longDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
const monthStart = (iso) => `${iso.slice(0, 8)}01`
const daysBefore = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10)
const label = 'text-[10px] font-bold uppercase tracking-wider text-neutral-500'
const emptyVal = (v, f) => v == null || String(v).trim() === '' || (f.kind === 'num' && Number(v) === 0)

// the table starts empty: nothing is built until the person puts fields in the boxes
const freshLayout = (sourceId) => blankLayout(sourceId)

// one box of the builder: its name, then the box the fields are dropped in
function BoxRow({ name, children }) {
  return (
    <div>
      <p className={`${label} mb-0.5`}>{name}</p>
      {children}
    </div>
  )
}

// a panel (filter, formula, columns, format) opens over the screen, so nothing below it has to be scrolled to
function Dialog({ title, onClose, children, width = 'max-w-xl' }) {
  return (
    <div className="rb-bd fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-black/65 px-3 pb-6 pt-[8vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className={`rb-pop w-full ${width} rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-3.5">
          <h3 className="text-base font-semibold text-app-text">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-app-text"><X size={18} /></button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// a saved layout: click its name to open it. The delete icon only appears after the pointer rests on it a moment (or a long press), and
// asks before anything is deleted, so it cannot be hit by accident.
function SavedChip({ l, src, active, byOther, canDelete, onOpen, onAsk }) {
  const [show, setShow] = useState(false)
  const t = useRef(null)
  const arm = (ms) => { clearTimeout(t.current); if (canDelete) t.current = setTimeout(() => setShow(true), ms) }
  const disarm = () => { clearTimeout(t.current); setShow(false) }
  useEffect(() => { if (!show) return undefined; const x = setTimeout(() => setShow(false), 5000); return () => clearTimeout(x) }, [show])
  useEffect(() => () => clearTimeout(t.current), [])
  return (
    <span
      onMouseEnter={() => arm(900)} onMouseLeave={disarm} onTouchStart={() => arm(550)} onTouchEnd={() => clearTimeout(t.current)} onTouchMove={() => clearTimeout(t.current)}
      className={`rb-pop inline-flex items-center rounded-full border bg-neutral-950 py-0.5 pl-1 pr-1 text-xs ${active ? 'border-brand-neon/60' : 'border-neutral-800'}`}
    >
      <button type="button" onClick={onOpen} className="rounded-full px-2 py-0.5 text-neutral-200 transition-colors hover:text-brand-neon" title={src?.name ?? l.source}>{l.name}{byOther ? <span className="text-neutral-500"> &middot; by {l.ownerName || 'someone'}</span> : null}</button>
      {canDelete && (
        <button
          type="button" onClick={onAsk} aria-label="Delete layout" tabIndex={show ? 0 : -1}
          className={`overflow-hidden rounded-full text-neutral-500 transition-all duration-300 hover:text-red-400 ${show ? 'ml-1.5 max-w-[1.6rem] p-1 opacity-100' : 'pointer-events-none max-w-0 opacity-0'}`}
        ><Trash2 size={12} /></button>
      )}
    </span>
  )
}

const removeFrom = (l, from, id) => (from === 'vals' ? { ...l, vals: l.vals.filter((v) => v.f !== id) } : { ...l, [from]: l[from].filter((x) => x !== id) })

function ReportBuilderModal({ user, onClose, open = true }) {
  const role = user?.role
  const sources = useMemo(() => sourcesFor(role), [role])
  const [sourceId, setSourceId] = useState('docs')
  // a warehouse staff member picks all of their warehouses or just one; the data layer also cuts to their own (this is only the picker)
  const [whNames, setWhNames] = useState([])
  const [whSel, setWhSel] = useState('')
  const isStaff = isStaffRole(user?.role)
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
  const [confirm, setConfirm] = useState(null) // { title, body, ok, run }: asks before something is thrown away
  const titleRef = useRef(null)
  const [dragging, setDragging] = useState(false) // a field that is already in a box is being dragged
  const [panelOpen, setPanelOpen] = useState(true)
  const pendingLayout = useRef(null)
  const needsInit = useRef(true)
  useBodyScrollLock(true)
  useEscapeKey(open, (e) => {
    if (document.querySelector('[data-sd-overlay]')) return
    const t = e?.target
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
    if (confirm) setConfirm(null); else if (pop) setPop(null); else if (drill) setDrill(null); else onClose()
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
    loadSource(sourceId, { user, params: whSel ? { ...params, warehouseIds: [whSel] } : params, period })
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
  }, [sourceId, paramKey, periodKey, whSel, user?.uid])

  useEffect(() => {
    if (!isStaff) return
    const mine = new Set(user?.assignedWarehouses ?? [])
    db.warehouses.toArray().then((all) => setWhNames(all.filter((w) => mine.has(w.id)).map((w) => ({ id: w.id, name: w.name })).sort((x, y) => String(x.name).localeCompare(String(y.name))))).catch(() => setWhNames([]))
  }, [isStaff, user?.assignedWarehouses])
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
  const isBlank = layout.mode === 'pivot' && !layout.rows.length && !layout.cols.length && !layout.vals.length

  // ---- reactive: what the filters and the search leave, and which fields that still has any value in
  const used = useMemo(() => new Set([...layout.rows, ...layout.cols, ...layout.vals.map((v) => v.f), ...layout.filters.map((f) => f.f)]), [layout])
  const keptRows = useMemo(() => (data ? selectRows(data.rows, { filters: layout.filters, search: layout.search }, fields) : []), [data, layout.filters, layout.search, fields])
  const liveIds = useMemo(() => {
    const s = new Set()
    for (const f of fields.list) {
      if (f.calc) { s.add(f.id); continue }
      for (const r of keptRows) { if (!emptyVal(readValue(r, f, fields.map), f)) { s.add(f.id); break } }
    }
    return s
  }, [fields, keptRows])
  // the fields on offer: not the ones nobody wants, and not the ones empty in what is being looked at
  const offered = useMemo(() => ({ list: fields.list.filter((f) => !isHiddenField(f) && (f.calc || used.has(f.id) || liveIds.has(f.id))), map: fields.map }), [fields, liveIds, used])
  const groups = useMemo(() => groupFields(offered.list, data?.main ?? []), [offered, data])
  // a formula may only use what is part of the table
  const tableIds = useMemo(() => {
    if (layout.mode === 'pivot') return new Set([...layout.rows, ...layout.cols, ...layout.vals.map((v) => v.f)])
    const base = fields.list.filter((f) => !f.d).map((f) => f.id)
    const order = [...new Set([...layout.order.filter((id) => fields.map[id]), ...base])]
    return new Set(order.filter((id) => !layout.hidden.includes(id)))
  }, [layout, fields])
  const formulaFields = useMemo(() => ({ list: offered.list.filter((f) => !f.d && tableIds.has(f.id)), map: fields.map }), [offered, tableIds, fields])
  const listFields = useMemo(() => ({ list: offered.list.filter((f) => !f.d), map: fields.map }), [offered, fields])

  const patch = (o) => setLayout((l) => ({ ...l, ...o }))
  // the headings that can be renamed: the fields of the table (the column field's values are the data, not a heading)
  const nameItems = useMemo(() => {
    const ids = layout.mode === 'pivot' ? [...new Set([...layout.rows, ...layout.vals.map((v) => v.f)])] : fields.list.filter((f) => !f.d && tableIds.has(f.id)).map((f) => f.id)
    return ids.filter((id) => fields.map[id]).map((id) => ({ id, label: fields.map[id].label }))
  }, [layout, fields, tableIds])
  // the list shows the source's main fields first; the rest are one tick away in Columns
  const setMode = (k) => setLayout((l) => (k === 'list' && !l.hidden.length && !l.order.length && data?.main?.length ? { ...l, mode: k, hidden: data.fields.filter((f) => !data.main.includes(f.id)).map((f) => f.id) } : { ...l, mode: k }))
  // put a field in a box; `from` is the box it was dragged out of (it leaves that one)
  const place = (area, id, from = null) => {
    const f = fields.map[id]
    if (!f || from === area) return
    if (area === 'filt') { setFilterField(id); setPop('filter'); return }
    setLayout((l) => {
      let n = { ...l, mode: 'pivot' }
      if (from) n = removeFrom(n, from, id)
      if (area === 'vals') { if (!n.vals.some((v) => v.f === id)) n.vals = [...n.vals, { f: id, a: f.kind === 'num' ? 'sum' : 'count' }] } else if (!n[area].includes(id)) n[area] = [...n[area], id]
      return n
    })
  }
  const dropOutside = (e) => {
    const from = e.dataTransfer.getData('application/x-rb-from')
    const id = e.dataTransfer.getData('text/plain')
    if (!from || !id) return
    e.preventDefault()
    setLayout((l) => removeFrom(l, from, id))
  }
  useEffect(() => { const t = setTimeout(() => setLayout((l) => (l.search === searchText ? l : { ...l, search: searchText })), 220); return () => clearTimeout(t) }, [searchText])

  const onSort = (id) => {
    if (id === '__tot') { patch({ sortTot: !layout.sortTot }); return }
    const i = layout.sort.findIndex((s) => s.f === id)
    patch({ sort: i >= 0 && layout.sort.length === 1 ? (layout.sort[0].dir === 1 ? [{ f: id, dir: -1 }] : []) : [{ f: id, dir: 1 }] })
  }
  const openDrill = (cellId) => { const c = table?.cells.get(cellId); if (c && c.recs.length) setDrill(c) }

  // ---- exports (Excel and PDF; everything exported is logged for the Admin)
  const sourceDated = data?.dated !== false
  const periodText = `${longDay(period.from)} to ${longDay(period.to)}`
  const meta = () => ({ title: `${src.name}${layout.mode === 'pivot' && layout.rows.length ? ` by ${layout.rows.filter((f) => fields.map[f]).map((f) => fields.map[f].label).join(' / ')}` : ''}`, sourceName: `${src.name}${sourceDated ? `, ${periodText}` : ''}`, filters: filterText(layout, fields), who: user?.name })
  const scopeText = isWideRole(role) ? 'All warehouses' : 'Own warehouses'
  const doExport = async (kind, t = null, title = null) => {
    if (!data) return
    const ttl = title ?? (layout.title ?? '').trim()
    if (!ttl) { toast('Type a title for the report first. It also becomes the file name.'); titleRef.current?.focus(); return }
    setBusy(kind)
    try {
      const flat = t ?? flatten(layout, buildTable(layout, data.fields, data.rows, { full: true }))
      const m = meta()
      m.title = ttl
      m.headBg = layout.headBg
      const base = m.title
      if (kind === 'xlsx') await exportXlsx(flat, m, base)
      else await exportPdf(flat, m, base)
      logReportEvent(user, { action: title ? 'export records' : 'export', source: src.name, layout: layouts.find((l) => l.id === editingId)?.name ?? '', format: kind, rows: flat.body.length, filters: [...m.filters, sourceDated ? periodText : ''].filter(Boolean).join('; '), scope: scopeText })
      toast.success(kind === 'xlsx' ? 'Excel file made' : 'PDF made')
    } catch (e) {
      console.error(e)
      toast.error('Could not make the file')
    } finally { setBusy('') }
  }
  const drillCols = () => offered.list.filter((f) => !f.d && (!data?.main?.length || data.main.includes(f.id) || f.calc))
  const drillFlat = () => {
    const cols = offered.list.filter((f) => !f.d)
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
  const grouped = useMemo(() => { const g = new Map(); for (const s of sources) { if (!g.has(s.group)) g.set(s.group, []); g.get(s.group).push(s) } return [...g.entries()] }, [sources])
  const stats = table?.stats
  const today = todayISO()
  const quick = [['Since Sept 1', floor, today], ['This month', monthStart(today) < floor ? floor : monthStart(today), today], ['Last 7 days', daysBefore(today, 6) < floor ? floor : daysBefore(today, 6), today]]
  const tableKey = `${sourceId}|${periodKey}|${layout.mode}|${JSON.stringify([layout.rows, layout.cols, layout.vals, layout.filters.length, layout.hidden.length, layout.search])}`
  const calcOpen = () => { if (tableIds.size === 0) { toast('Put some fields in the table first. A formula can only use the fields of the table.'); return } setEditingCalc(null); setPop('calc') }

  return createPortal(
    <div className={`fixed inset-0 z-[80] flex flex-col bg-neutral-950 ${open ? 'sd-pop-in' : 'sd-pop-out'}`} onClick={() => setMenu(null)}>
      <div className="mx-auto flex w-full max-w-[110rem] items-center justify-between gap-2 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onClose} aria-label="Back" className="rounded-lg border border-brand-amber/40 bg-neutral-900 p-1.5 text-brand-amber transition-colors hover:bg-brand-amber/10"><ArrowLeft size={18} /></button>
          <h2 className="truncate text-base font-semibold text-app-text">Report Builder</h2>
          <span className="hidden items-center gap-1 rounded-full border border-brand-neon/40 bg-brand-neon/10 px-2.5 py-0.5 text-[11px] font-bold text-brand-neon sm:inline-flex"><ShieldCheck size={12} /> Read-only copy of the records</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-brand-crimson/40 bg-neutral-900 p-1.5 text-brand-crimson transition-colors hover:bg-brand-crimson/10"><X size={18} /></button>
      </div>

      <div
        className="mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col overflow-y-auto px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:overflow-hidden"
        onDragStartCapture={(e) => { if (e.target?.dataset?.rbFrom) setDragging(true) }}
        onDragEnd={() => setDragging(false)}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-rb-from')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
        onDrop={(e) => { setDragging(false); dropOutside(e) }}
      >
        {/* ---------------- one compact bar: period, data, save ---------------- */}
        <div className="rb-fade mb-2 shrink-0 rounded-2xl border border-neutral-800 bg-neutral-900 p-2.5">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5">
            <div>
              <p className={`${label} mb-1`}>Period</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="w-36"><CalendarDatePicker value={period.from} label="From" onChange={(iso) => setPeriod({ from: iso, to: period.to < iso ? iso : period.to })} /></div>
                <span className="text-xs text-neutral-500">to</span>
                <div className="w-36"><CalendarDatePicker value={period.to} label="To" onChange={(iso) => setPeriod({ from: period.from > iso ? iso : period.from, to: iso })} /></div>
                {quick.map(([n, f, t]) => <button key={n} type="button" onClick={() => setPeriod({ from: f, to: t })} className={`${pill} !px-2.5 !py-1 ${period.from === f && period.to === t ? pillOn : ''}`}>{n}</button>)}
              </div>
            </div>
            <div className="min-w-[15rem] flex-1">
              <label className={`${label} mb-1 block`} htmlFor="rb-source">Data</label>
              <div className="flex flex-wrap items-center gap-1.5">
                <select id="rb-source" value={sourceId} onChange={(e) => chooseSource(e.target.value)} className={`${input} min-w-0 flex-1`}>
                  {grouped.map(([g, list]) => <optgroup key={g} label={g}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
                </select>
                {isStaff && whNames.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-neutral-400">Warehouse
                    <select value={whSel} onChange={(e) => setWhSel(e.target.value)} className={input}>
                      <option value="">{whNames.length > 1 ? 'All my warehouses' : whNames[0].name}</option>
                      {whNames.length > 1 && whNames.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </label>
                )}
                {(src?.params ?? []).map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-xs text-neutral-400">{p.label}
                    {p.type === 'select'
                      ? <select value={params[p.id] ?? p.def} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })} className={input}>{p.options.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
                      : <input type="number" value={params[p.id] ?? ''} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })} className={`${input} w-20`} />}
                  </label>
                ))}
                <button type="button" onClick={() => (isBlank ? startOver() : setConfirm({ title: 'Start over?', body: 'The table you are building, with its filters and formulas, will be cleared. Your saved layouts are not touched.', ok: 'Start over', run: startOver }))} className={`${pill} !px-2.5 !py-1.5`}><RotateCcw size={12} />Start over</button>
                {loading && <Loader2 size={15} className="animate-spin text-brand-neon" />}
              </div>
            </div>
            <div className="min-w-[17rem] flex-1 lg:max-w-md">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className={label}>Save this layout</p>
                <div className="flex flex-wrap items-center gap-x-2.5 text-[11px] text-neutral-400">
                  <span className="inline-flex items-center gap-1 text-neutral-500"><Share2 size={11} />Share</span>
                  {[['admin', 'Admin'], ['analysts', 'Analysts'], ['staff', 'Staff']].map(([k, n]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={!!share[k]} onChange={(e) => setShare({ ...share, [k]: e.target.checked })} />{n}</label>)}
                </div>
              </div>
              <div className="flex gap-1.5">
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this layout" className={`${input} min-w-0 flex-1`} />
                <button type="button" onClick={doSave} disabled={isBlank} className="inline-flex items-center gap-1 rounded-lg bg-brand-neon px-3 py-1.5 text-sm font-semibold text-brand-contrast transition-transform active:scale-95 disabled:opacity-40"><Save size={14} />Save</button>
              </div>
            </div>
          </div>
          {layouts.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-neutral-800 pt-2">
              <span className={label}>Saved</span>
              {layouts.map((l) => <SavedChip key={l.id} l={l} src={sourceById(l.source)} active={editingId === l.id} byOther={l.ownerUid !== user?.uid} canDelete={l.ownerUid === user?.uid || role === 'Admin'} onOpen={() => openLayout(l)} onAsk={() => setConfirm({ title: 'Delete this saved layout?', body: `\u201C${l.name}\u201D will be deleted for good${l.share && (l.share.admin || l.share.analysts || l.share.staff) ? ', for everyone it was shared with too' : ''}. The records are not touched.`, ok: 'Delete', run: () => removeLayout(l) })} />)}
            </div>
          )}
        </div>
        {error && <p className="mb-2 shrink-0 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

        {/* ---------------- the builder on the left, the table taking the rest ---------------- */}
        <div className={`grid transition-[grid-template-columns,gap] duration-300 ease-out lg:min-h-0 lg:flex-1 lg:grid-cols-[var(--bw)_minmax(0,1fr)] ${panelOpen ? 'gap-3' : 'gap-0'}`} style={{ '--bw': panelOpen ? '23rem' : '0rem' }}>
          <div className={`min-w-0 overflow-hidden transition-all duration-300 ease-out ${panelOpen ? 'opacity-100 max-lg:max-h-[300vh]' : 'pointer-events-none opacity-0 max-lg:max-h-0'}`}>
            <div className="space-y-2.5 lg:h-full lg:w-[23rem] lg:overflow-y-auto lg:pr-1">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-2.5">
                <FieldPicker
                  key={sourceId} groups={groups} used={used} query={fieldQuery} setQuery={setFieldQuery} onPick={(e, f) => openMenu(e, f)}
                  extra={<button type="button" onClick={calcOpen} className={`${pill} shrink-0 !px-2.5`}>+ Formula</button>}
                />
              </div>
              <div className="space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-2.5">
                <BoxRow name="Rows"><DropArea area="rows" onDropField={place} hint="Drop fields to group down the side">{layout.rows.filter((id) => fields.map[id]).map((id) => <FieldChip key={id} f={fields.map[id]} from="rows" onRemove={() => patch({ rows: layout.rows.filter((x) => x !== id) })} />)}</DropArea></BoxRow>
                <BoxRow name="Columns"><DropArea area="cols" onDropField={place} hint="Drop fields to spread across the top">{layout.cols.filter((id) => fields.map[id]).map((id) => <FieldChip key={id} f={fields.map[id]} from="cols" onRemove={() => patch({ cols: layout.cols.filter((x) => x !== id) })} />)}</DropArea></BoxRow>
                <BoxRow name="Values"><DropArea area="vals" onDropField={place} hint="Drop numbers to add up">{layout.vals.filter((v) => fields.map[v.f]).map((v, i) => <ValueChip key={v.f} f={fields.map[v.f]} v={v} onAgg={(a) => patch({ vals: layout.vals.map((x, k) => (k === i ? { ...x, a } : x)) })} onRemove={() => patch({ vals: layout.vals.filter((x) => x.f !== v.f) })} />)}</DropArea></BoxRow>
                <BoxRow name="Filter">
                  <DropArea area="filt" onDropField={place} hint="Drop a field to keep only some records">
                    {layout.filters.map((ft, i) => { const f = fields.map[ft.f]; if (!f) return null; return <span key={`${ft.f}${i}`} className="rb-pop inline-flex items-center gap-1.5 rounded-full border border-brand-neon/35 bg-brand-neon/10 py-0.5 pl-2.5 pr-1.5 text-xs text-app-text">{filterText({ filters: [ft], search: '' }, fields)[0]}<button type="button" onClick={() => patch({ filters: layout.filters.filter((_, k) => k !== i) })} aria-label="Remove filter" className="text-neutral-400 hover:text-red-400"><X size={12} /></button></span> })}
                  </DropArea>
                </BoxRow>
                {dragging && <p className="rb-pop rounded-lg bg-red-500/15 px-2.5 py-1 text-center text-[11px] text-red-300">Let go outside the boxes to remove it</p>}
              </div>
            </div>
          </div>

          {/* ---------------- the table ---------------- */}
          <div className="flex min-w-0 flex-col lg:min-h-0">
            <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
              <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search every field" className={`${input} min-w-[10rem] flex-1`} />
              <div className="inline-flex overflow-hidden rounded-lg border border-neutral-700">
                {[['list', 'List of records'], ['pivot', 'Pivot table']].map(([k, n]) => <button key={k} type="button" onClick={() => setMode(k)} className={`px-3 py-1.5 text-sm transition-colors ${layout.mode === k ? 'bg-brand-neon/10 text-brand-neon' : 'bg-neutral-900 text-neutral-300 hover:text-app-text'}`}>{n}</button>)}
              </div>
              {layout.mode === 'list' && <button type="button" onClick={() => setPop('cols')} className={pill}>Columns</button>}
              <button type="button" onClick={() => setPop('fmt')} className={pill}>Format</button>
              <button type="button" onClick={() => setPanelOpen((v) => !v)} className={`${pill} ${panelOpen ? '' : pillOn}`}>{panelOpen ? 'Hide builder' : 'Show builder'}</button>
            </div>

            <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
              <input ref={titleRef} value={layout.title ?? ''} onChange={(e) => patch({ title: e.target.value })} placeholder="Report title (needed to export; it becomes the file name)" className={`${input} min-w-[12rem] flex-1`} />
              <div className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 py-1 pl-3 pr-1">
                <span className={label}>Export</span>
                <button type="button" disabled={!table || isBlank || !!busy} onClick={() => doExport('xlsx')} className={pill}>{busy === 'xlsx' ? 'Making…' : 'Excel'}</button>
                <button type="button" disabled={!table || isBlank || !!busy} onClick={() => doExport('pdf')} className={pill}>{busy === 'pdf' ? 'Making…' : 'PDF'}</button>
              </div>
            </div>

            <div className="sd-table max-h-[70vh] min-h-[16rem] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 lg:max-h-none lg:flex-1">
              {isBlank
                ? <div className="p-10 text-center"><p className="text-sm font-semibold text-neutral-300">The table is empty</p><p className="mx-auto mt-1 max-w-md text-xs text-neutral-500">Drag fields into Rows, Columns or Values to build a pivot table, or choose &quot;List of records&quot; to see the records themselves.</p></div>
                : loading && !table
                  ? <div className="p-10 text-center text-sm text-neutral-500">Loading&hellip;</div>
                  : table ? <div key={tableKey} className="rb-fade"><ResultTable table={table} layout={layout} onSort={onSort} onCell={openDrill} /></div> : <div className="p-10 text-center text-sm text-neutral-500">Nothing to show.</div>}
            </div>
            <div className="mt-1.5 flex shrink-0 flex-wrap justify-between gap-2 text-xs text-neutral-500">
              <span>
                {stats && !isBlank && layout.mode === 'list' && `${stats.records.toLocaleString('en-US')} records${stats.more > 0 ? ` (first ${stats.shown} shown; the exports have all ${stats.records.toLocaleString('en-US')})` : ''}`}
                {stats && !isBlank && layout.mode === 'pivot' && `${stats.records.toLocaleString('en-US')} records counted, ${stats.rows} rows${stats.cols ? `, ${stats.cols} columns` : ''}. Click any number to see the records behind it.`}
              </span>
              <span>Read from this device&apos;s copy of the records</span>
            </div>

            {drill && (
              <div className="rb-drop mt-2 shrink-0 rounded-xl border border-brand-neon/40 bg-neutral-900 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <b className="text-sm text-app-text">{drill.recs.length.toLocaleString('en-US')} records behind: {drill.label}</b>
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => doExport('xlsx', drillFlat(), `Records behind ${drill.label}`)} className={pill}>Excel</button>
                    <button type="button" onClick={() => doExport('pdf', drillFlat(), `Records behind ${drill.label}`)} className={pill}>PDF</button>
                    <button type="button" onClick={() => setDrill(null)} className={pill}>Close</button>
                  </span>
                </div>
                <div className="sd-table max-h-[28vh] overflow-auto rounded-lg border border-neutral-800 bg-neutral-950">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead><tr>{drillCols().map((f) => <th key={f.id} className={`sticky top-0 whitespace-nowrap border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 font-bold text-neutral-400 ${f.kind === 'num' ? 'text-right' : 'text-left'}`}>{f.label}</th>)}</tr></thead>
                    <tbody>
                      {drill.recs.slice(0, 200).map((r, i) => <tr key={i} className="hover:bg-neutral-900/60">{drillCols().map((f) => { const v = f.calc ? '' : (f.get ? f.get(r) : r[f.id]); return <td key={f.id} className={`whitespace-nowrap border-b border-neutral-900 px-3 py-1.5 tabular-nums ${f.kind === 'num' ? 'text-right' : ''}`}>{f.kind === 'num' && typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v ?? '')}</td> })}</tr>)}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-neutral-500">{drill.recs.length > 200 ? 'First 200 shown. ' : ''}The Excel and PDF contain every field of all {drill.recs.length.toLocaleString('en-US')} records.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {pop === 'filter' && data && <Dialog title="Keep only some records" onClose={() => setPop(null)}><FilterBuilder key={filterField ?? 'x'} fields={listFields} rows={keptRows} initialField={filterField} onAdd={(ft) => { patch({ filters: [...layout.filters, ft] }); setPop(null) }} onCancel={() => setPop(null)} /></Dialog>}
      {pop === 'calc' && data && (
        <Dialog title={editingCalc ? 'Change the calculated column' : 'New calculated column'} width="max-w-2xl" onClose={() => { setPop(null); setEditingCalc(null) }}>
          <FormulaBuilder key={editingCalc?.id ?? 'new'} baseFields={data.fields} rows={keptRows} fields={formulaFields} calc={layout.calc} editing={editingCalc} onSave={(c) => { patch({ calc: editingCalc ? layout.calc.map((x) => (x.id === c.id ? c : x)) : [...layout.calc, c], ...(!editingCalc && layout.mode === 'pivot' ? { vals: [...layout.vals, { f: c.id, a: 'sum' }] } : {}) }); setPop(null); setEditingCalc(null); toast.success(editingCalc ? 'Calculated column changed' : `Calculated column added: ${c.label}`) }} onCancel={() => { setPop(null); setEditingCalc(null) }} />
        </Dialog>
      )}
      {pop === 'cols' && data && layout.mode === 'list' && <Dialog title="Columns of the list" onClose={() => setPop(null)}><ColumnsPanel fields={listFields} layout={layout} onChange={patch} onDone={() => setPop(null)} /></Dialog>}
      {pop === 'fmt' && data && <Dialog title="Format the table" width="max-w-3xl" onClose={() => setPop(null)}><FormatPanel layout={layout} onChange={patch} names={nameItems} onDone={() => setPop(null)} /></Dialog>}

      {confirm && (
        <Dialog title={confirm.title} width="max-w-md" onClose={() => setConfirm(null)}>
          <p className="break-words text-sm leading-relaxed text-neutral-300">{confirm.body}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} className={btnGhost}>Keep it as it is</button>
            <button type="button" onClick={() => { const run = confirm.run; setConfirm(null); run() }} className="rounded-xl bg-red-500/90 px-5 py-2 text-sm font-semibold text-white transition-transform active:scale-95">{confirm.ok}</button>
          </div>
        </Dialog>
      )}

      {menu && (
        <div style={{ left: menu.x, top: menu.y }} className="rb-drop fixed z-[90] min-w-[12rem] rounded-xl border border-neutral-700 bg-neutral-900 p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <p className="break-words px-3 pb-1 pt-0.5 text-[11px] font-bold text-neutral-500">{menu.f.label}</p>
          {[
            ['rows', 'Add to Rows'], ['cols', 'Add to Columns'], ['vals', 'Add to Values'], ['filt', 'Filter by this field'], ...(layout.mode === 'list' ? [['sort', 'Sort by this field']] : []),
            ...(menu.f.calc ? [['edit', 'Change this formula'], ['del', 'Delete this field']] : []),
          ].map(([a, n]) => (
            <button key={a} type="button" onClick={() => {
              if (a === 'sort') patch({ sort: [{ f: menu.f.id, dir: 1 }] })
              else if (a === 'edit') { setEditingCalc(layout.calc.find((c) => c.id === menu.f.id) ?? null); setPop('calc') }
              else if (a === 'del') patch({ calc: layout.calc.filter((c) => c.id !== menu.f.id), rows: layout.rows.filter((x) => x !== menu.f.id), cols: layout.cols.filter((x) => x !== menu.f.id), vals: layout.vals.filter((v) => v.f !== menu.f.id), filters: layout.filters.filter((x) => x.f !== menu.f.id) })
              else place(a, menu.f.id)
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
