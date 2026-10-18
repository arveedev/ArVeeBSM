// System health: turns what the devices and the nightly jobs report into one overall level, four cards and a short
// "needs attention" list. Pure (no database, no clock of its own: `now` is passed in) so every rule is tested.
//
// Levels: 'ok' (green), 'amber' (look at it), 'red' (act), 'unknown' (nothing reported yet, never counted as a problem).
// Every threshold lives in HEALTH_THRESHOLDS so the owner can have one changed in one place.

export const HEALTH_THRESHOLDS = {
  deviceActiveDays: 30,        // a device not seen for longer than this is not listed at all
  deviceSyncAmberHours: 24,    // last successful sync older than this
  deviceSyncRedDays: 7,
  pendingAmberMinutes: 60,     // entries waiting to send for longer than this
  cloudBackupAmberHours: 30,
  cloudBackupRedHours: 48,
  pcBackupAmberHours: 48,      // a PC with no device backup for this long
  pcFolderAmberDays: 3,        // a PC that still has no backup folder after this long
  restoreTestAmberDays: 40,    // the test runs monthly; this much later is late
  countGapMin: 5,              // a device holding fewer records than the best-synced one by more than max(5, 1%)
  countGapFraction: 0.01,
}

const H = 3600 * 1000
const D = 24 * H
const LEVEL_RANK = { unknown: 0, ok: 1, amber: 2, red: 3 }
const worst = (levels) => levels.reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), 'unknown')

const toMs = (iso) => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso ?? '')
  return Number.isFinite(t) ? t : null
}

export const agoText = (ms, now) => {
  if (ms == null) return 'never'
  const d = Math.max(0, now - ms)
  if (d < 90 * 1000) return 'just now'
  if (d < 90 * 60 * 1000) return `${Math.round(d / 60000)} min ago`
  if (d < 36 * H) return `${Math.round(d / H)} h ago`
  return `${Math.round(d / D)} days ago`
}

const KEY_TABLES = ['transactions', 'purchaseReceipts', 'piles', 'authorities', 'customers']

const byId = (systemStatus) => Object.fromEntries((systemStatus ?? []).map((r) => [r.id, r]))

const evalBackups = (sys, inAppBackupAt, now, T) => {
  const cb = sys.cloudBackup
  const items = []
  let level = 'unknown'
  if (cb) {
    const at = toMs(cb.at)
    const age = at == null ? Infinity : now - at
    let l = 'ok'
    if (cb.result !== 'PASS') l = 'red'
    else if (age > T.cloudBackupRedHours * H) l = 'red'
    else if (age > T.cloudBackupAmberHours * H) l = 'amber'
    items.push({ level: l, label: 'Cloud backup', value: `${cb.result === 'PASS' ? 'Passed' : 'FAILED'} ${agoText(at, now)}${cb.records ? `, ${cb.records.toLocaleString('en-US')} records` : ''}` })
    if (cb.driveDelivered != null) items.push({ level: cb.driveDelivered ? 'ok' : 'amber', label: 'Google Drive copy', value: cb.driveDelivered ? 'Delivered' : 'NOT delivered' })
    level = worst([l, cb.driveDelivered === false ? 'amber' : 'ok'])
  }
  const inApp = toMs(inAppBackupAt)
  if (inApp != null) items.push({ level: now - inApp > T.cloudBackupRedHours * H ? 'amber' : 'ok', label: 'In-app backup', value: agoText(inApp, now) })
  const days = sys.history?.days ?? []
  const bad = days.filter((d) => d.result && d.result !== 'PASS').length
  const summary = cb ? `${cb.result === 'PASS' ? 'Passed' : 'Failed'} ${agoText(toMs(cb.at), now)}` : 'Not reporting yet'
  return { level, summary, items, history: days, historyBad: bad }
}

const evalRestore = (sys, now, T) => {
  const r = sys.restoreTest
  if (!r) return { level: 'unknown', summary: 'No test yet', items: [] }
  const at = toMs(r.at)
  let level = r.result === 'PASS' ? 'ok' : 'red'
  if (level === 'ok' && (at == null || now - at > T.restoreTestAmberDays * D)) level = 'amber'
  const items = [
    { level, label: 'Monthly restore test', value: `${r.result === 'PASS' ? 'Passed' : 'FAILED'} ${agoText(at, now)}` },
    { level: r.result === 'PASS' ? 'ok' : 'red', label: 'Records restored identically', value: `${(r.identical ?? 0).toLocaleString('en-US')} of ${(r.records ?? 0).toLocaleString('en-US')}` },
  ]
  return { level, summary: `${r.result === 'PASS' ? 'Passed' : 'Failed'} ${agoText(at, now)}`, items }
}

const evalDevices = (devices, now, T) => {
  const active = (devices ?? []).filter((d) => {
    const seen = toMs(d.lastSeen)
    return seen != null && now - seen <= T.deviceActiveDays * D
  })
  // the reference for "matches cloud": the best counts among devices that are in sync right now
  const reference = {}
  for (const d of active) {
    const seen = toMs(d.lastSeen)
    if (seen != null && now - seen <= 24 * H && !(d.pending > 0)) for (const t of KEY_TABLES) reference[t] = Math.max(reference[t] ?? 0, d.counts?.[t] ?? 0)
  }
  const rows = active.map((d) => {
    const seen = toMs(d.lastSeen)
    const sync = toMs(d.lastSyncAt)
    const syncAge = sync == null ? null : now - sync
    const pending = d.pending ?? 0
    const reasons = []
    let level = 'ok'
    const bump = (l, why) => { if (LEVEL_RANK[l] > LEVEL_RANK[level]) level = l; reasons.push(why) }
    if (syncAge == null) bump('amber', 'has not synced yet')
    else if (syncAge > T.deviceSyncRedDays * D) bump('red', `last sync ${agoText(sync, now)}`)
    else if (syncAge > T.deviceSyncAmberHours * H) bump('amber', `last sync ${agoText(sync, now)}`)
    if (pending > 0 && d.pendingSince != null && now - toMs(d.pendingSince) > T.pendingAmberMinutes * 60000) bump('amber', `${pending} entries waiting to send`)
    else if (pending > 0 && syncAge != null && syncAge > T.pendingAmberMinutes * 60000) bump('amber', `${pending} entries waiting to send`)
    let matches = 'unknown'
    if (d.counts && Object.keys(reference).length && now - (seen ?? 0) <= 24 * H) {
      matches = 'yes'
      for (const t of KEY_TABLES) {
        const ref = reference[t] ?? 0
        const mine = d.counts[t] ?? 0
        if (ref - mine > Math.max(T.countGapMin, ref * T.countGapFraction)) { matches = 'behind'; bump('amber', `holds fewer ${t} than the best-synced device`); break }
      }
    }
    let backup = null
    if (d.kind === 'pc') {
      const b = d.backup ?? {}
      const at = toMs(b.at)
      const first = toMs(d.firstSeen) ?? seen
      const folder = b.folder ?? 'unknown'
      backup = { at, ok: b.ok !== false, folder, driveAt: toMs(b.driveAt), driveOk: b.driveOk }
      if (folder === 'none' && first != null && now - first > T.pcFolderAmberDays * D) bump('amber', 'no backup folder chosen yet')
      else if (folder === 'needs-permission') bump('amber', 'backup folder needs a click to allow it again')
      else if (b.ok === false) bump('amber', 'last device backup did not verify')
      else if (at != null && now - at > T.pcBackupAmberHours * H) bump('amber', `no device backup ${agoText(at, now)}`)
      else if (at == null && first != null && now - first > T.pcBackupAmberHours * H && folder !== 'none') bump('amber', 'no device backup yet')
    }
    return {
      id: d.id, name: d.name || 'Unnamed device', user: d.user ?? '', warehouse: d.warehouse ?? '', kind: d.kind ?? 'pc', appVersion: d.appVersion ?? '',
      lastSeen: seen, lastSync: sync, pending, matches, backup, level, reasons,
    }
  }).sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
  const behind = rows.filter((r) => r.level !== 'ok')
  const level = rows.length ? worst(rows.map((r) => r.level)) : 'unknown'
  const summary = rows.length ? `${rows.length - behind.length} of ${rows.length} up to date` : 'No devices reporting yet'
  return { level, summary, rows, items: behind.map((r) => ({ level: r.level, label: r.name, value: r.reasons.join('; ') })) }
}

const evalData = (sys, checks, now, T) => {
  const items = []
  const a = sys.sheetAudit
  if (a) items.push({ level: a.errors > 0 ? 'red' : a.warnings > 0 ? 'amber' : 'ok', label: 'Google Sheet audit', value: `${a.errors ?? 0} errors, ${a.warnings ?? 0} warnings (${agoText(toMs(a.at), now)})`, lines: a.lines ?? [] })
  const c = checks ?? {}
  if (c.stockNotes != null) items.push({ level: c.stockNotes > 0 ? 'amber' : 'ok', label: 'Stock check', value: c.stockNotes > 0 ? `${c.stockNotes} notes` : 'no problems' })
  if (c.errorLogNew != null) items.push({ level: c.errorLogNew > 0 ? 'amber' : 'ok', label: 'Error log (last 24 h)', value: `${c.errorLogNew} new` })
  const level = items.length ? worst(items.map((i) => i.level)) : 'unknown'
  const summary = a ? `${a.errors ?? 0} errors, ${a.warnings ?? 0} warnings` : items.length ? 'See details' : 'Not reporting yet'
  return { level, summary, items }
}

/** @returns {{ overall, cards: {backups, restore, devices, data}, attention: {level, text, card}[] }} */
export const evaluateHealth = ({ systemStatus = [], devices = [], inAppBackupAt = null, checks = null, now = Date.now(), thresholds = HEALTH_THRESHOLDS } = {}) => {
  const sys = byId(systemStatus)
  const cards = {
    backups: evalBackups(sys, inAppBackupAt, now, thresholds),
    restore: evalRestore(sys, now, thresholds),
    devices: evalDevices(devices, now, thresholds),
    data: evalData(sys, checks, now, thresholds),
  }
  const attention = []
  for (const [card, c] of Object.entries(cards)) {
    for (const it of c.items ?? []) if (it.level === 'amber' || it.level === 'red') attention.push({ level: it.level, text: `${it.label}: ${it.value}`, card })
  }
  attention.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])
  const levels = Object.values(cards).map((c) => c.level)
  const overall = levels.every((l) => l === 'unknown') ? 'unknown' : worst(levels.filter((l) => l !== 'unknown'))
  return { overall, cards, attention }
}
