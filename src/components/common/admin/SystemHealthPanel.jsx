// System health (Admin only): one health bar, four cards (Backups, Restore test, Devices, Data checks), and a detail list
// that slides open under the cards when one is tapped. The device table is inside the Devices detail, folded by default.
// Rules and thresholds: utils/healthRules.js. Animations are in index.css (.sh-*) and switch off for "reduce motion".
import { useState } from 'react'
import { ChevronDown, RefreshCw, Pencil } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { getDeviceId } from '../../../utils/errorLog.js'
import { agoText, SHEET_AUDIT_HELP } from '../../../utils/healthRules.js'
import { DEXIE_CLOUD_DB_URL } from '../../../db/dexie.js'
import { databaseIdOf } from '../../../utils/deviceRestore.js'
import { useSystemHealth } from '../../../hooks/useSystemHealth.js'

const DOT = { ok: 'bg-brand-neon', amber: 'bg-brand-amber sh-pulse', red: 'bg-red-500 sh-pulse', unknown: 'bg-neutral-600' }
const SEG = { ok: 'bg-brand-neon', amber: 'bg-brand-amber', red: 'bg-red-500', unknown: 'bg-neutral-700' }
const CARDS = [
  { id: 'backups', title: 'Backups' },
  { id: 'restore', title: 'Restore test' },
  { id: 'devices', title: 'Devices' },
  { id: 'data', title: 'Data checks' },
]

const Dot = ({ level }) => <span aria-hidden="true" className={`mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[level] ?? DOT.unknown}`} />
const num = (n) => Number(n).toLocaleString('en-US')

function ItemList({ items }) {
  if (!items?.length) return <p className="py-2 text-xs text-neutral-500">Nothing has been reported yet.</p>
  return items.map((it, i) => (
    <div key={i} className="flex items-center gap-2 border-b border-neutral-800 py-2 text-xs last:border-0">
      <Dot level={it.level} />
      <span className="flex-1 text-app-text">{it.label}</span>
      <span className="text-right text-neutral-400">{it.value}</span>
    </div>
  ))
}

function HistoryStrip({ days }) {
  if (!days?.length) return null
  const last = days.slice(-30)
  return (
    <div className="pt-3">
      <div className="mb-1 text-[11px] text-neutral-500">Cloud backups, last {last.length} days</div>
      <div className="flex gap-[3px]">
        {last.map((d) => <span key={d.date} title={`${d.date}: ${d.result}`} className={`h-3 flex-1 rounded-sm ${d.result === 'PASS' ? 'bg-brand-neon' : 'bg-brand-amber'}`} />)}
      </div>
    </div>
  )
}

function DeviceTable({ rows, now }) {
  const me = getDeviceId()
  const [editing, setEditing] = useState(null) // { id, text }
  const saveName = async () => {
    const name = editing?.text.trim()
    if (name) await db.deviceStatus.update(editing.id, { name, nameSetByAdmin: true })
    setEditing(null)
  }
  const backupText = (b) => {
    if (!b) return 'phone: status only'
    const where = b.folder === 'ok' ? 'folder' : b.folder === 'none' ? 'no folder yet' : b.folder === 'needs-permission' ? 'folder needs a click' : b.folder === 'unsupported' ? 'browser cannot save' : 'unknown'
    return `${b.at ? agoText(b.at, now) : 'none yet'} · ${where}${b.driveOk === true ? ' · Drive ok' : b.driveOk === false ? ' · Drive failed' : ''}`
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[640px] w-full text-left text-xs">
        <thead className="text-neutral-500">
          <tr>{['Device', 'User', 'Last sync', 'App', 'Waiting', 'Matches cloud', 'Device backup', ''].map((h) => <th key={h} className="px-1.5 py-1.5 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-neutral-800 align-top">
              <td className="px-1.5 py-2 text-app-text">
                {editing?.id === r.id ? (
                  <span className="flex items-center gap-1">
                    <input autoFocus value={editing.text} onChange={(e) => setEditing({ id: r.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(null) }} className="w-36 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-app-text" aria-label="Device name" />
                    <button type="button" onClick={saveName} className="text-xs text-brand-neon">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className="text-xs text-neutral-500">Cancel</button>
                  </span>
                ) : (<><Dot level={r.level} />{r.name}{r.id === me ? <span className="ml-1 text-neutral-500">(this device)</span> : null}</>)}
              </td>
              <td className="px-1.5 py-2 text-neutral-300">{r.user || '-'}{r.warehouse ? <div className="text-neutral-500">{r.warehouse}</div> : null}</td>
              <td className="px-1.5 py-2 text-neutral-300">{agoText(r.lastSync, now)}</td>
              <td className="px-1.5 py-2 text-neutral-300">{r.appVersion || '-'}</td>
              <td className="px-1.5 py-2 text-neutral-300">{num(r.pending)}</td>
              <td className="px-1.5 py-2 text-neutral-300">{r.matches === 'yes' ? 'Yes' : r.matches === 'behind' ? 'Behind' : 'Unknown'}</td>
              <td className="px-1.5 py-2 text-neutral-300">{backupText(r.backup)}</td>
              <td className="px-1.5 py-2"><button type="button" aria-label={`Rename ${r.name}`} onClick={() => setEditing({ id: r.id, text: r.name })} className="text-neutral-500 hover:text-brand-neon"><Pencil size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Detail({ id, health }) {
  const [showTable, setShowTable] = useState(false)
  const c = health.cards[id]
  if (id === 'backups') return (<><ItemList items={c.items} /><HistoryStrip days={c.history} /></>)
  if (id === 'restore') return <ItemList items={c.items} />
  if (id === 'devices') return (
    <>
      {c.rows.length === 0 ? <p className="py-2 text-xs text-neutral-500">No device has reported yet. Devices report once they run the newest app version.</p> : c.rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 border-b border-neutral-800 py-2 text-xs last:border-0">
          <Dot level={r.level} />
          <span className="flex-1 text-app-text">{r.name}<span className="text-neutral-500">{r.user ? ` · ${r.user}` : ''}</span></span>
          <span className="text-right text-neutral-400">{r.reasons.length ? r.reasons.join('; ') : `synced ${agoText(r.lastSync, health.now)}`}</span>
        </div>
      ))}
      {c.rows.length > 0 && (
        <div className="pt-2">
          <button type="button" onClick={() => setShowTable((v) => !v)} className="rounded-lg border border-neutral-700 px-3 py-1 text-xs text-app-text hover:border-neutral-500">{showTable ? 'Hide device data' : 'Show device data'}</button>
          <span className="ml-2 text-[11px] text-neutral-500">Only devices seen in the last 30 days</span>
          <div className={`sh-collapse ${showTable ? 'sh-open' : ''}`}><div><div className="pt-2"><DeviceTable rows={c.rows} now={health.now} /></div></div></div>
        </div>
      )}
    </>
  )
  return (
    <>
      <ItemList items={c.items} />
      {c.items.find((i) => i.lines?.length) && (
        <div className="mt-1 rounded-lg bg-neutral-950 p-2 text-[11px] text-neutral-400">
          {c.items.find((i) => i.lines?.length).lines.slice(0, 6).map((l, i) => { const help = SHEET_AUDIT_HELP[/\[([a-z-]+)\]/.exec(l)?.[1]]; return <div key={i} className="py-0.5">{l}{help && <div className="text-neutral-500">What to do: {help}</div>}</div> })}
        </div>
      )}
      <p className="pt-2 text-[11px] text-neutral-500">The Stock check is run on demand: Admin &gt; Data Care &gt; Inventory Lots Check.</p>
    </>
  )
}

function SystemHealthPanel() {
  const health = useSystemHealth(true)
  const [open, setOpen] = useState(null)
  const [tick, setTick] = useState(0)

  const toggle = (id) => setOpen((cur) => (cur === id ? null : id))
  const top = health.attention[0]
  const headline = health.overall === 'ok' ? 'All healthy' : health.overall === 'unknown' ? 'Waiting for the first reports' : `${health.attention.length} thing${health.attention.length === 1 ? '' : 's'} need${health.attention.length === 1 ? 's' : ''} attention`

  return (
    <div className="space-y-3" data-suppress-form-shortcuts>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-app-text">System health</h2>
        <button type="button" onClick={() => setTick((t) => t + 1)} className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-app-text" aria-label="Refresh">
          Database {databaseIdOf(DEXIE_CLOUD_DB_URL)} · checked {new Date(health.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} <RefreshCw key={tick} size={13} className="sh-spin-once" />
        </button>
      </div>

      <div key={tick} className="flex gap-1" aria-hidden="true">
        {CARDS.map((c, i) => (
          <div key={c.id} className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
            <div className={`sh-fill h-full w-full ${SEG[health.cards[c.id].level]}`} style={{ animationDelay: `${i * 90}ms` }} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <Dot level={health.overall} />
        <span className="font-medium text-app-text">{headline}</span>
        {top && <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">{top.text}</span>}
        {top && <button type="button" onClick={() => setOpen(top.card)} className="ml-auto shrink-0 rounded-lg border border-neutral-700 px-3 py-1 text-xs text-app-text hover:border-neutral-500">Show</button>}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2.5">
        {CARDS.map((c, i) => {
          const cd = health.cards[c.id]
          const on = open === c.id
          return (
            <button
              key={c.id}
              type="button"
              aria-expanded={on}
              onClick={() => toggle(c.id)}
              style={{ animationDelay: `${60 + i * 70}ms` }}
              className={`sh-card rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? (cd.level === 'ok' ? 'border-brand-neon bg-brand-neon/10' : 'border-brand-amber bg-brand-amber/10') : (cd.level === 'amber' || cd.level === 'red' ? 'border-brand-amber/50 bg-neutral-900 hover:border-brand-amber' : 'border-neutral-800 bg-neutral-900 hover:border-neutral-600')}`}
            >
              <div className="flex items-center text-sm font-medium text-app-text"><Dot level={cd.level} />{c.title}<ChevronDown size={15} className={`ml-auto text-neutral-500 transition-transform duration-200 ${on ? 'rotate-180' : ''}`} /></div>
              <div className="mt-1.5 text-xs text-neutral-400">{cd.summary}</div>
            </button>
          )
        })}
      </div>

      {CARDS.map((c) => (
        <div key={c.id} className={`sh-collapse ${open === c.id ? 'sh-open' : ''}`}>
          <div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5">
              <div className="pt-1 text-[11px] uppercase tracking-wide text-neutral-500">{c.title}</div>
              <Detail id={c.id} health={health} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default SystemHealthPanel
