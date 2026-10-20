// Stock Desk > GSR report (Admin only). Prepare the Grains Situationer Report for a period, see the checks and the tally against the
// warehouses' totals, and create the Google Sheet and its audit file in the designated Drive folder.
// Nothing here writes to the app's data; "Create" only sends the finished numbers to Drive (see utils/gsr/*, services/gsrPublish.js).
// Step 1 of the build: PALAY INVENTORY. The other ten sheets are listed as "not built yet".

import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink, Loader2, Plug } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { DEXIE_CLOUD_DB_URL } from '../../../db/dexie.js'
import { APP_VERSION } from '../../../version.js'
import { todayLocalISO } from '../../../utils/calculations.js'
import { longDate } from '../../../utils/inventoryReport.js'
import { defaultPeriod, periodTitle, gsrFileName } from '../../../utils/gsr/period.js'
import { prepareGsr, SHEET_PLAN } from '../../../utils/gsr/prepare.js'
import { createGsrInDrive, pingGsrDrive } from '../../../services/gsrPublish.js'
import { databaseIdOf } from '../../../utils/deviceRestore.js'
import CalendarDatePicker from '../CalendarDatePicker.jsx'

const bagsText = (n) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The sheet as a table: formulas show their computed value, zero and empty show blank.
const displayRows = (sheet) => {
  const R = sheet.rowCount
  const C = sheet.colCount
  const rows = []
  for (let r = 0; r < R; r++) {
    const row = []
    for (let c = 0; c < C; c++) {
      const x = sheet.get(r, c)
      const v = x != null && typeof x === 'object' ? x.v : x
      row.push(v === null || v === undefined || v === 0 || v === '' ? '' : v)
    }
    rows.push(row)
  }
  return rows
}

function Preview({ sheet }) {
  const rows = useMemo(() => displayRows(sheet), [sheet])
  const bold = useMemo(() => {
    const s = new Set()
    for (const [r1, , r2] of sheet.bold) for (let r = r1; r <= r2; r++) s.add(r)
    return s
  }, [sheet])
  return (
    <div className="max-h-[60vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-950">
      <table className="min-w-full border-collapse text-xs tabular-nums">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={bold.has(r) ? 'font-semibold text-app-text' : 'text-neutral-300'}>
              {row.map((v, c) => (
                <td key={c} className={`border border-neutral-800/70 px-1.5 py-0.5 ${typeof v === 'number' ? 'text-right' : 'whitespace-nowrap text-left'}`}>
                  {typeof v === 'number' ? bagsText(v) : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Pill = ({ tone = 'ok', children }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : tone === 'warn' ? 'bg-amber-500/15 text-amber-300' : tone === 'bad' ? 'bg-red-500/15 text-red-300' : 'bg-neutral-800 text-neutral-300'}`}>{children}</span>
)

export default function GsrReportPanel({ tables, config, startISO }) {
  const today = todayLocalISO()
  const [memo, setMemo] = useState(today)
  const [period, setPeriod] = useState(() => defaultPeriod(today))
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState('')
  const [res, setRes] = useState(null)
  const [done, setDone] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [tab, setTab] = useState('checks')
  const toRef = useRef(null)
  const firstRun = config?.gsrFirstRun !== false

  const clamp = (iso) => (startISO && iso < startISO ? startISO : iso)
  const changeMemo = (iso) => {
    setMemo(iso)
    if (!edited) setPeriod(defaultPeriod(iso))
    setRes(null); setDone(null)
  }
  const changeFrom = (iso) => { setEdited(true); setPeriod((p) => ({ from: clamp(iso), to: p.to < iso ? iso : p.to })); setRes(null); setDone(null) }
  const changeTo = (iso) => { setEdited(true); setPeriod((p) => ({ from: p.from > iso ? clamp(iso) : p.from, to: clamp(iso) })); setRes(null); setDone(null) }
  const resetPeriod = () => { setEdited(false); setPeriod(defaultPeriod(memo)); setRes(null); setDone(null) }

  const prepare = () => {
    setBusy('prepare'); setDone(null); setConfirming(false)
    // a moment so the button can show "Preparing" before the page works through the data
    setTimeout(() => {
      try {
        const r = prepareGsr({ ...tables, config, storedSettings: config?.gsrSettings ?? null }, {
          memoISO: memo, from: period.from, to: period.to, firstRun,
          appInfo: { version: APP_VERSION, databaseId: databaseIdOf(DEXIE_CLOUD_DB_URL), createdBy: 'Admin', createdAt: new Date().toLocaleString('en-PH') },
        })
        setRes(r); setTab(r.canCreate ? 'sheet' : 'checks')
      } catch (e) {
        toast.error(`Could not prepare the GSR: ${e.message ?? e}`)
      } finally { setBusy('') }
    }, 30)
  }

  const create = async () => {
    setBusy('create'); setConfirming(false)
    try {
      const out = await createGsrInDrive(res)
      setDone(out)
      if (out.verified) toast.success('GSR created and verified in Google Drive')
      else toast.error('Created, but some values do not match: see the result')
    } catch (e) {
      toast.error(String(e.message ?? e))
    } finally { setBusy('') }
  }

  const test = async () => {
    setBusy('ping')
    try { const name = await pingGsrDrive(); toast.success(`Google Drive reached. Designated folder: ${name}`) } catch (e) { toast.error(String(e.message ?? e)) } finally { setBusy('') }
  }

  const setFirstRun = async (on) => {
    try {
      const cur = await db.reportConfig.get('global')
      if (cur) await db.reportConfig.update('global', { gsrFirstRun: on })
      else await db.reportConfig.put({ id: 'global', gsrFirstRun: on })
      setRes(null); setDone(null)
    } catch { toast.error('Could not save the setting') }
  }

  const c = res?.checks

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <div className="w-[calc(50%-0.375rem)] sm:w-44"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">Memo date (report made on)</p><CalendarDatePicker value={memo} label="Memo date" onChange={changeMemo} /></div>
          <div className="w-[calc(50%-0.375rem)] sm:w-44"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">Period: from</p><CalendarDatePicker value={period.from} label="First day" onChange={(iso) => { changeFrom(iso); toRef.current?.open() }} /></div>
          <div className="w-[calc(50%-0.375rem)] sm:w-44"><p className="mb-0.5 text-[10px] uppercase text-neutral-500">to</p><CalendarDatePicker ref={toRef} value={period.to} label="Last day" onChange={changeTo} /></div>
          {edited && <button type="button" onClick={resetPeriod} className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300">Use the usual period</button>}
        </div>
        <p className="mt-3 text-sm text-neutral-300">GRAINS SITUATIONER REPORT FOR <b>{periodTitle(period.from, period.to)}</b> &nbsp;·&nbsp; file <b>{gsrFileName(period.from, period.to)}</b> in <b>NEWGSR / {memo.slice(0, 4)}</b></p>
        <p className="mt-1 text-xs text-neutral-500">Monday reports Friday to Sunday, any other day reports yesterday; change the dates when needed. The GSR counts from {startISO ? longDate(startISO) : 'the data start'} forward.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={prepare} disabled={busy !== ''} className="flex items-center gap-2 rounded-xl bg-brand-neon px-4 py-2 text-sm font-semibold text-brand-contrast disabled:opacity-50">
            {busy === 'prepare' && <Loader2 size={16} className="animate-spin" />} {busy === 'prepare' ? 'Preparing…' : 'Prepare'}
          </button>
          <button type="button" onClick={test} disabled={busy !== ''} className="flex items-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50"><Plug size={15} /> Test the Drive connection</button>
          <label className="ml-auto flex items-center gap-2 text-xs text-neutral-300">
            <input id="gsr-first-run" type="checkbox" checked={firstRun} onChange={(e) => setFirstRun(e.target.checked)} />
            Label files "FIRST RUN - HAND CHECK"
          </label>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <p className="mb-2 text-xs font-semibold uppercase text-neutral-500">Sheets</p>
        <div className="flex flex-wrap gap-1.5">
          {SHEET_PLAN.map((s) => <Pill key={s.name} tone={s.built ? 'ok' : 'idle'}>{s.name}{s.built ? '' : ' · not built yet'}</Pill>)}
        </div>
      </div>

      {res && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {[['checks', 'Checks and tally'], ['sheet', 'PALAY INVENTORY'], ['audit', 'Audit file']].map(([id, name]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${tab === id ? 'border-brand-neon bg-brand-neon/15 text-brand-neon' : 'border-neutral-700 text-neutral-300'}`}>{name}</button>
            ))}
            <span className="ml-auto flex items-center gap-2">
              {c.blocking.length > 0 ? <Pill tone="bad"><XCircle size={12} /> {c.blocking.length} must be fixed</Pill> : <Pill><CheckCircle2 size={12} /> everything ties</Pill>}
              {c.warnings.length > 0 && <Pill tone="warn"><AlertTriangle size={12} /> {c.warnings.length} to look at</Pill>}
            </span>
          </div>

          {tab === 'checks' && (
            <div className="mt-3 space-y-3">
              {c.blocking.length > 0 && (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
                  <p className="mb-2 text-sm font-semibold text-red-300">Must be fixed before the file can be created</p>
                  <ul className="space-y-1 text-sm text-red-200">{c.blocking.map((b, i) => <li key={i}>{b.text}</li>)}</ul>
                </div>
              )}
              {c.warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <p className="mb-2 text-sm font-semibold text-amber-300">Warnings (information, they do not stop the file)</p>
                  <ul className="space-y-1 text-sm text-amber-100">{c.warnings.map((w, i) => <li key={i}>{w.text}</li>)}</ul>
                </div>
              )}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <p className="mb-1 text-sm font-semibold text-app-text">Tally against the warehouses (net bags)</p>
                <p className="mb-2 text-xs text-neutral-500">Opening stock + received - issued (+ the corrections the Stock Desk applies) must equal the warehouse's ending stock, and the sheet must print that ending stock.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead><tr className="text-left text-neutral-500"><th className="py-1 pr-3">Column</th><th className="px-2 text-right">Opening</th><th className="px-2 text-right">Received</th><th className="px-2 text-right">Issued</th><th className="px-2 text-right">Corrections</th><th className="px-2 text-right">Ending</th><th className="px-2 text-right">Printed</th><th className="px-2">Ties</th></tr></thead>
                    <tbody>
                      {c.movement.map((m) => (
                        <tr key={m.column} className="border-t border-neutral-800 text-neutral-200">
                          <td className="py-1 pr-3">{m.column}</td>
                          {[m.opening, m.received, m.issued, m.corrections, m.ending, m.printed].map((v, i) => <td key={i} className="px-2 text-right">{Math.abs(v) < 0.005 ? '' : bagsText(v)}</td>)}
                          <td className="px-2">{m.okWalk && m.okSheet ? <Pill>yes</Pill> : <Pill tone="bad">NO</Pill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <p className="mb-2 text-sm font-semibold text-app-text">Ties between sheets</p>
                <ul className="space-y-1 text-sm text-neutral-200">
                  {c.ties.map((t, i) => <li key={i} className="flex flex-wrap items-center gap-2">{t.ok ? <Pill>match</Pill> : <Pill tone="bad">different</Pill>} {t.label} <span className="text-neutral-500">({bagsText(t.a)} / {bagsText(t.b)})</span></li>)}
                </ul>
              </div>
            </div>
          )}

          {tab === 'sheet' && <div className="mt-3"><Preview sheet={res.sheets[0]} /><p className="mt-2 text-xs text-neutral-500">Preview of the sheet that will be written. An empty cell means no stock; the file shows the same.</p></div>}

          {tab === 'audit' && (
            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-200">
              <p className="font-semibold text-app-text">{res.audit.name}</p>
              <p className="mt-1 text-neutral-400">Saved next to the GSR with five tabs: Summary (run details and the tally), Cells ({res.sheets[0].expected().size} figures, each with where it comes from), Documents ({res.lots.length} stock lines, {bagsText(res.lotsTotal)} net bags), Excluded ({res.outside.length} facilities that are not warehouses) and Settings used.</p>
            </div>
          )}

          <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            {!confirming ? (
              <button type="button" onClick={() => setConfirming(true)} disabled={!res.canCreate || busy !== ''} className="rounded-xl bg-brand-neon px-4 py-2 text-sm font-semibold text-brand-contrast disabled:opacity-40">
                Create in Google Drive
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-neutral-200">Create <b>{res.fileName}</b> and <b>{res.audit.name}</b> in <b>{res.folder.join(' / ')}</b>?</p>
                <button type="button" onClick={create} className="rounded-xl bg-brand-neon px-4 py-2 text-sm font-semibold text-brand-contrast">Yes, create</button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-xl border border-neutral-700 px-3 py-2 text-sm text-neutral-300">Cancel</button>
              </div>
            )}
            {!res.canCreate && <p className="mt-2 text-xs text-red-300">The Create button stays off until every item under "Must be fixed" is gone.</p>}
            {busy === 'create' && <p className="mt-2 flex items-center gap-2 text-sm text-neutral-300"><Loader2 size={15} className="animate-spin" /> Creating the files, reading them back and checking every value…</p>}
            {done && (
              <div className="mt-3 space-y-1 text-sm">
                {done.verified ? <Pill><CheckCircle2 size={12} /> Created and verified: {done.checked} of {done.checked} values match</Pill> : <Pill tone="bad"><XCircle size={12} /> {done.bad.length} of {done.checked} values differ - the files are marked NOT VERIFIED</Pill>}
                <ul className="mt-2 space-y-1">
                  {done.files.map((f) => <li key={f.id}><a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-neon underline">{f.name} <ExternalLink size={13} /></a></li>)}
                </ul>
                {!done.verified && <ul className="mt-2 list-disc pl-5 text-xs text-red-200">{done.bad.slice(0, 8).map((b, i) => <li key={i}>{b.sheet} {b.ref}: expected {String(b.expected)}, Drive has {String(b.got)}</li>)}</ul>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
