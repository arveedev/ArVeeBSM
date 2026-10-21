// Live System health for the Admin: what the devices and the nightly jobs reported (synced tables deviceStatus and
// systemStatus), turned into levels by utils/healthRules.js. Does nothing (no queries) unless `enabled`.
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import { evaluateHealth } from '../utils/healthRules.js'

export const useSystemHealth = (enabled) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    const t = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(t)
  }, [enabled])

  const systemStatus = useLiveQuery(() => (enabled ? db.systemStatus.toArray() : []), [enabled], [])
  const devices = useLiveQuery(() => (enabled ? db.deviceStatus.toArray() : []), [enabled], [])
  const inAppBackupAt = useLiveQuery(() => (enabled ? db.reportConfig.get('global').then((c) => c?.lastAutoBackupAt ?? null) : null), [enabled], null)
  const errorLogNew = useLiveQuery(
    () => (enabled ? db.errorLogs.where('timestamp').above(new Date(Date.now() - 24 * 3600 * 1000).toISOString()).filter((e) => !e.resolved).count() : null),
    [enabled, Math.floor(now / 60000)],
    null,
  )

  // the sync records its own result on the sheet source (see googleSheetsBridge.js); the newest report of any source counts
  const authoritySync = useLiveQuery(async () => {
    if (!enabled) return null
    const sources = await db.sheetSources.toArray()
    const withOk = sources.map((x) => x.lastAuthoritySyncOkAt).filter(Boolean).sort()
    const err = sources.find((x) => x.authoritySyncError)
    return { okAt: withOk.length ? withOk[withOk.length - 1] : null, error: err?.authoritySyncError ?? null }
  }, [enabled, Math.floor(now / 60000)], null)

  const health = evaluateHealth({ systemStatus, devices, inAppBackupAt, checks: { errorLogNew, authoritySync }, now })
  return { ...health, now, checkedAt: now }
}
