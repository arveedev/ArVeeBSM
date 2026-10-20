// Report Builder > Compare two sources: totals of a number on each side, grouped by a key, with the differences flagged.
// Read-only: both sides are loaded through the same read-only sources, so a staff member only ever compares their own warehouses.

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import { buildFields } from '../../../utils/reportBuilder/fields.js'
import { selectRows, blankLayout, filterText } from '../../../utils/reportBuilder/engine.js'
import { reconcile, reconcileTable, STATUS } from '../../../utils/reportBuilder/reconcile.js'
import { loadSource, sourcesFor, sourceById, defaultParams } from '../../../utils/reportBuilder/sources.js'
import { exportXlsx, exportPdf, exportCsv, copyTable } from '../../../services/reportBuilderExport.js'
import { logReportEvent } from '../../../services/reportLayouts.js'
import { FilterBuilder, input, pill } from './rbParts.jsx'

const PRESETS = [
  { name: 'Authority: issued vs the withdrawal slips on it', a: { source: 'auth', key: ['aiNumber'], value: 'totalIssuedKilos', filters: [{ f: 'type', op: 'is', v: ['AI'] }] }, b: { source: 'docs', key: ['aiNumber'], value: 'netKilos', filters: [{ f: 'type', op: 'is', v: ['WSI'] }, { f: 'status', op: 'is', v: ['Active'] }, { f: 'aiNumber', op: 'filled' }] }, tolerance: 1 },
  { name: 'WSR net kg vs its Purchase Receipt', a: { source: 'docs', key: ['serialNo'], value: 'netKilos', filters: [{ f: 'type', op: 'is', v: ['WSR'] }, { f: 'status', op: 'is', v: ['Active'] }, { f: 'transactionType', op: 'has', v: 'PROCUREMENT' }] }, b: { source: 'pr', key: ['wsrSerial'], value: 'netKilos', filters: [{ f: 'status', op: 'is', v: ['Active'] }] }, tolerance: 1 },
  { name: 'Stock Desk stock vs the piles\' stored balance (per warehouse)', a: { source: 'sd_summary', key: ['warehouse'], value: 'netKilos', filters: [] }, b: { source: 'piles', key: ['warehouseShort'], value: 'currentKilos', filters: [] }, tolerance: 50 },
]

function Side({ title, st, setSt, user, sources, rows, fields, loading }) {
  const [adding, setAdding] = useState(false)
  const src = sourceById(st.source)
  const key = st.key
  const real = fields ? fields.list.filter((f) => !f.d) : []
  const nums = real.filter((f) => f.kind === 'num')
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neutral-400">{title}{loading && <Loader2 size={13} className="animate-spin text-brand-neon" />}</p>
      <div className="grid gap-2">
        <select value={st.source} onChange={(e) => setSt({ source: e.target.value, key: [], value: '', filters: [], params: defaultParams(sourceById(e.target.value), new Date().toISOString().slice(0, 10)) })} className={input}>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.group}: {s.name}</option>)}
        </select>
        {(src?.params ?? []).map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-xs text-neutral-400">{p.label}
            {p.type === 'select'
              ? <select value={st.params?.[p.id] ?? p.def} onChange={(e) => setSt({ params: { ...st.params, [p.id]: e.target.value } })} className={input}>{p.options.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
              : <input type={p.type === 'date' ? 'date' : 'number'} value={st.params?.[p.id] ?? ''} onChange={(e) => setSt({ params: { ...st.params, [p.id]: e.target.value } })} className={input} />}
          </label>
        ))}
        <label className="grid gap-1 text-xs text-neutral-400">Match records by (one or more fields)
          <select multiple size={4} value={key} onChange={(e) => setSt({ key: [...e.target.selectedOptions].map((o) => o.value) })} className={input}>{real.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">Number to total
          <select value={st.value} onChange={(e) => setSt({ value: e.target.value })} className={input}><option value="">Count of records</option>{nums.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {st.filters.map((ft, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full border border-brand-neon/40 bg-brand-neon/10 px-2.5 py-0.5 text-xs">{filterText({ filters: [ft], search: '' }, fields ?? { map: {} })[0] ?? ft.f}<button type="button" onClick={() => setSt({ filters: st.filters.filter((_, k) => k !== i) })} className="text-neutral-400 hover:text-red-400">&times;</button></span>)}
          <button type="button" onClick={() => setAdding(true)} className={pill} disabled={!fields}>+ Filter</button>
        </div>
        {adding && fields && <FilterBuilder fields={fields} rows={rows} onAdd={(ft) => { setSt({ filters: [...st.filters, ft] }); setAdding(false) }} onCancel={() => setAdding(false)} />}
        <p className="text-[11px] text-neutral-500">{rows ? `${rows.length.toLocaleString('en-US')} records loaded` : ''}</p>
      </div>
    </div>
  )
}

export default function CompareView({ user }) {
  const sources = useMemo(() => sourcesFor(user?.role), [user])
  const today = new Date().toISOString().slice(0, 10)
  const mk = (s) => ({ source: s.source, key: s.key, value: s.value, filters: s.filters, params: defaultParams(sourceById(s.source), today) })
  const [A, setA] = useState(() => mk(PRESETS[0].a))
  const [B, setB] = useState(() => mk(PRESETS[0].b))
  const [tol, setTol] = useState(PRESETS[0].tolerance)
  const [dataA, setDataA] = useState(null)
  const [dataB, setDataB] = useState(null)
  const [loading, setLoading] = useState(false)
  const [only, setOnly] = useState(true)
  const [drill, setDrill] = useState(null)
  const patch = (set) => (o) => set((s) => ({ ...s, ...o }))
  const apply = (p) => { setA(mk(p.a)); setB(mk(p.b)); setTol(p.tolerance); setDrill(null) }

  useEffect(() => {
    let live = true
    setLoading(true)
    const prm = (s) => JSON.stringify(s.params)
    Promise.all([loadSource(A.source, { user, params: A.params }), loadSource(B.source, { user, params: B.params })])
      .then(([a, b]) => { if (live) { setDataA(a); setDataB(b) } })
      .catch((e) => { if (live) toast.error(String(e.message ?? e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [A.source, B.source, JSON.stringify(A.params), JSON.stringify(B.params), user?.uid])

  const fa = useMemo(() => (dataA ? buildFields(dataA.fields) : null), [dataA])
  const fb = useMemo(() => (dataB ? buildFields(dataB.fields) : null), [dataB])
  const result = useMemo(() => {
    if (!fa || !fb || !A.key.length || !B.key.length) return null
    const ra = selectRows(dataA.rows, { ...blankLayout(A.source), filters: A.filters }, fa)
    const rb = selectRows(dataB.rows, { ...blankLayout(B.source), filters: B.filters }, fb)
    return reconcile({ rows: ra, baseFields: dataA.fields, key: A.key, value: A.value || null }, { rows: rb, baseFields: dataB.fields, key: B.key, value: B.value || null }, { tolerance: Number(tol) || 0 })
  }, [fa, fb, dataA, dataB, A, B, tol])

  const labels = { key: A.key.map((k) => fa?.map[k]?.label ?? k), a: `A: ${fa?.map[A.value]?.label ?? 'records'}`, b: `B: ${fb?.map[B.value]?.label ?? 'records'}` }
  const shown = result ? result.rows.filter((r) => !only || r.status !== 'match') : []
  const flat = () => { const t = reconcileTable({ ...result, rows: shown }, labels); return { head: t.head, hr: null, body: t.body, foot: null } }
  const meta = () => ({ title: `Compare: ${sourceById(A.source)?.name} with ${sourceById(B.source)?.name}`, sourceName: `${sourceById(A.source)?.name} (A) and ${sourceById(B.source)?.name} (B)`, filters: [`Match by ${labels.key.join(' + ')}`, `Tolerance ${tol}`, only ? 'Only the differences' : 'Every key'], who: user?.name })
  const out = async (kind) => {
    if (!result) return
    const t = flat()
    try {
      if (kind === 'xlsx') await exportXlsx(t, meta(), 'compare')
      else if (kind === 'pdf') await exportPdf(t, meta(), 'compare')
      else if (kind === 'csv') exportCsv(t, 'compare')
      else { toast((await copyTable(t)) ? 'Copied' : 'Could not copy'); return }
      logReportEvent(user, { action: 'export', source: `Compare ${A.source} / ${B.source}`, format: kind, rows: t.body.length, filters: meta().filters.join('; '), scope: user?.role })
    } catch (e) { toast.error('Could not make the file') }
  }
  const fmt = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }))
  const tone = { match: 'text-emerald-300', differs: 'text-amber-300', onlyA: 'text-sky-300', onlyB: 'text-fuchsia-300' }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-6">
      <p className="text-xs text-neutral-400">Pick two sources and what identifies a record on each side. Every key is totalled on both sides and the differences are listed. Click a row to see the records behind it.</p>
      <div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.name} type="button" onClick={() => apply(p)} className={pill}>{p.name}</button>)}</div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Side title="A" st={A} setSt={patch(setA)} user={user} sources={sources} rows={dataA?.rows} fields={fa} loading={loading} />
        <Side title="B" st={B} setSt={patch(setB)} user={user} sources={sources} rows={dataB?.rows} fields={fb} loading={loading} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-300">
        <label className="flex items-center gap-2">Count as a match when they differ by no more than <input type="number" value={tol} onChange={(e) => setTol(e.target.value)} className={`${input} w-24`} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Show only the differences</label>
        <span className="ml-auto flex flex-wrap gap-1.5"><button type="button" disabled={!result} onClick={() => out('xlsx')} className={pill}>Excel</button><button type="button" disabled={!result} onClick={() => out('pdf')} className={pill}>PDF</button><button type="button" disabled={!result} onClick={() => out('csv')} className={pill}>CSV</button><button type="button" disabled={!result} onClick={() => out('copy')} className={pill}>Copy</button></span>
      </div>
      {!result && <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-500">Choose at least one matching field on each side to see the comparison.</p>}
      {result && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {[['match', 'Match'], ['differs', 'Differ'], ['onlyA', 'Only in A'], ['onlyB', 'Only in B']].map(([k, n]) => <span key={k} className={`rounded-full border border-neutral-700 px-3 py-1 ${tone[k]}`}>{n}: <b>{result.summary[k]}</b></span>)}
            <span className="rounded-full border border-neutral-700 px-3 py-1 text-neutral-300">Total A {fmt(result.summary.totalA)} &middot; Total B {fmt(result.summary.totalB)} &middot; Difference {fmt(result.summary.totalA - result.summary.totalB)}</span>
          </div>
          <div className="max-h-[52vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead><tr>{[...labels.key, labels.a, labels.b, 'Difference', 'Result', 'Records A', 'Records B'].map((h, i) => <th key={i} className={`sticky top-0 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-bold text-neutral-400 ${i < labels.key.length ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-neutral-500">Nothing differs.</td></tr>}
                {shown.map((r, i) => (
                  <tr key={i} onClick={() => setDrill(r)} className="cursor-pointer hover:bg-neutral-900/60">
                    {r.key.map((k, j) => <td key={j} className="whitespace-nowrap border-b border-neutral-900 px-3 py-1.5 text-left font-semibold text-app-text">{k}</td>)}
                    <td className="border-b border-neutral-900 px-3 py-1.5 text-right tabular-nums">{fmt(r.a)}</td><td className="border-b border-neutral-900 px-3 py-1.5 text-right tabular-nums">{fmt(r.b)}</td>
                    <td className={`border-b border-neutral-900 px-3 py-1.5 text-right font-semibold tabular-nums ${r.status === 'match' ? '' : 'text-amber-300'}`}>{fmt(r.diff)}</td>
                    <td className={`border-b border-neutral-900 px-3 py-1.5 text-right ${tone[r.status]}`}>{STATUS[r.status]}</td>
                    <td className="border-b border-neutral-900 px-3 py-1.5 text-right tabular-nums">{r.countA}</td><td className="border-b border-neutral-900 px-3 py-1.5 text-right tabular-nums">{r.countB}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {drill && (
        <div className="rounded-xl border border-brand-neon/40 bg-neutral-900 p-3 text-sm">
          <div className="mb-2 flex items-center justify-between gap-2"><b className="text-app-text">Records behind: {drill.key.join(' / ')}</b><button type="button" onClick={() => setDrill(null)} className={pill}>Close</button></div>
          <div className="grid gap-3 lg:grid-cols-2">
            {[['A', drill.recsA, fa], ['B', drill.recsB, fb]].map(([n, recs, f]) => (
              <div key={n} className="max-h-60 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <p className="mb-1 text-xs font-bold text-neutral-400">{n}: {recs.length} record{recs.length === 1 ? '' : 's'}</p>
                {recs.slice(0, 60).map((r, i) => <p key={i} className="truncate text-xs text-neutral-300">{f ? f.list.filter((x) => !x.d).slice(0, 8).map((x) => String(r[x.id] ?? x.get?.(r) ?? '')).filter(Boolean).join(' | ') : ''}</p>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
