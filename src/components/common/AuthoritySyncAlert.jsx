// A warning that shows only while the AI/SIA authorities cannot be brought in from the Google Sheet (the sync keeps failing), so a
// missing authority is never a silent mystery: the person sees that the list may be out of date, why, and since when.
// Reads the status the sync itself writes on the sheet source; writes nothing.
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle } from 'lucide-react'
import { db } from '../../db/dexie.js'

const QUIET_MS = 20 * 60 * 1000 // a single failed try is normal; it only matters once it has lasted this long

const ago = (iso, now) => {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return 'a while ago'
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 60) return `${m} min ago`
  if (m < 36 * 60) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} days ago`
}

function AuthoritySyncAlert() {
  const sources = useLiveQuery(() => db.sheetSources.toArray(), []) ?? []
  const now = Date.now()
  const bad = sources.filter((s) => {
    if (!s.authoritySyncError) return false
    const ok = Date.parse(s.lastAuthoritySyncOkAt ?? '')
    return !Number.isFinite(ok) || now - ok > QUIET_MS
  })
  if (bad.length === 0) return null
  const s = bad[0]
  return (
    <div role="alert" className="rb-fade mb-3 flex items-start gap-3 rounded-2xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-100">
      <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-300" />
      <div className="min-w-0">
        <p className="font-semibold">The authority list may be out of date</p>
        <p className="mt-0.5 break-words text-red-200/90">{s.authoritySyncError}</p>
        <p className="mt-1 text-xs text-red-200/70">Last fully updated {s.lastAuthoritySyncOkAt ? ago(s.lastAuthoritySyncOkAt, now) : 'never on this record'}. It tries again every few minutes. If it stays, tell the Admin.</p>
      </div>
    </div>
  )
}

export default AuthoritySyncAlert
