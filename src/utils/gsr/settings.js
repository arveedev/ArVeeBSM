// GSR settings: the defaults, and the helpers that read the app's own data into the report's terms (pure, no database).
// Stored (when the Admin changes something) in the shared `reportConfig` record with id 'gsr'; anything not stored falls back to
// the defaults below, which reproduce the real report.

import { warehouseLabel } from '../inventoryReport.js'

export const DEFAULT_GSR_SETTINGS = {
  // The memo header (settings 7)
  memo: {
    forName: 'RODRIGO O. EMBATE JR.',
    forTitle: 'REGIONAL MANAGER II',
    forOffice: 'NFA RO5, LEGAZPI CITY',
    refPrefix: 'ALB-BSM',
    preparedBy: 'RON VINCENT D. JOCSON',
    preparedByTitle: 'GOO I',
  },
  // Palay rows of PALAY INVENTORY (settings 2): which app varieties land in which report variety.
  // A name matches exactly (case-insensitive) or, when it ends with *, by its beginning. The app's m / s marks after PD1, PD2 ...
  // (PD1m-A, PD1s-A) are ignored before matching, like the combined view of the Stock Desk.
  palayBlocks: [
    { name: 'PDm', match: ['PDm'] },
    { name: 'PDs', match: ['PDs'] },
    { name: 'PD1-A', match: ['PD1-A'] },
    { name: 'PD1-B', match: ['PD1-B'] },
    { name: 'PD2-A', match: ['PD2-A'] },
  ],
  pwBlock: { name: 'PW', match: ['PW*'] },
  // Grade letter printed beside the month row, by the row's upper month edge (settings 3). '' prints nothing.
  grades: { 1: 'A', 2: 'A', 3: 'B', 4: 'B', 5: 'C', 7: 'D', 9: 'E' },
  // Warehouse columns (settings 1): per warehouse code an optional title and an optional hide flag; order = list order.
  // Order = the real report's (Legazpi, Abacorp, Tabaco, VRT, BSI, Kinale; Catanduanes after Albay). NFA OWNED (050521) and SY (050583) hold no
  // palay and are not columns of the real report, so they start hidden; a hidden column that ever holds stock stops the run and says so.
  columns: { titles: {}, hidden: ['050521', '050583'], order: ['050502', '050520', '050501', '050563', '050522', '050555', '052011'] },
}

export const mergeSettings = (stored) => {
  const s = stored && typeof stored === 'object' ? stored : {}
  return {
    ...DEFAULT_GSR_SETTINGS,
    ...s,
    memo: { ...DEFAULT_GSR_SETTINGS.memo, ...(s.memo ?? {}) },
    columns: { ...DEFAULT_GSR_SETTINGS.columns, ...(s.columns ?? {}) },
    grades: { ...DEFAULT_GSR_SETTINGS.grades, ...(s.grades ?? {}) },
  }
}

/** PD1m-A / PD1s-A -> PD1-A (PDm, PDs and PW stay as they are). */
export const normalizeVariety = (name) => String(name ?? '').trim().replace(/^(PD\d+)[ms](?=-|$)/i, '$1')

const matches = (patterns, name) => {
  const n = name.toLowerCase()
  return patterns.some((p) => {
    const q = String(p).toLowerCase()
    return q.endsWith('*') ? n.startsWith(q.slice(0, -1)) : n === q
  })
}

/** The report variety (block name) of an app variety name, or null when no block takes it. */
export const blockOfVariety = (settings, appName) => {
  const n = normalizeVariety(appName)
  for (const b of settings.palayBlocks) if (matches(b.match, n)) return b.name
  if (matches(settings.pwBlock.match, n)) return settings.pwBlock.name
  return null
}

/**
 * One column per warehouse CODE: lettered variants share a code (BSI + BSI B + BSI C = 050522) and are merged.
 * Only facility type "Warehouse" counts (dryers, ricemills and gyms are left out).
 * Returns [{ code, title, provinceName, warehouseIds: Set, labels: [] }] in report order (province, then settings order, then title).
 */
export const warehouseColumns = (warehouses, provinces, settings) => {
  const provName = new Map((provinces ?? []).map((p) => [p.provinceId ?? p.id, p.name]))
  const groups = new Map()
  for (const w of warehouses ?? []) {
    if ((w.facilityType ?? 'Warehouse') !== 'Warehouse') continue
    const province = provName.get(w.provinceId) ?? '(no province)'
    const code = String(w.code ?? '').trim()
    const key = `${province}|${code || `id:${w.warehouseId}`}`
    let g = groups.get(key)
    if (!g) {
      g = { code, key, provinceName: province, warehouseIds: new Set(), labels: [], baseTitle: warehouseLabel(w.name, true) }
      groups.set(key, g)
    }
    g.warehouseIds.add(w.warehouseId)
    g.labels.push(warehouseLabel(w.name, false))
    // the shortest merged name is the cleanest title (BSI rather than BSI B)
    const t = warehouseLabel(w.name, true)
    if (t.length < g.baseTitle.length) g.baseTitle = t
  }
  const order = settings.columns?.order ?? []
  const hidden = new Set(settings.columns?.hidden ?? [])
  const rank = (g) => { const i = order.indexOf(g.code); return i < 0 ? 1e6 : i }
  return [...groups.values()]
    .filter((g) => !hidden.has(g.code))
    .map((g) => ({ ...g, title: settings.columns?.titles?.[g.code] ?? g.baseTitle }))
    .sort((a, b) => a.provinceName.localeCompare(b.provinceName) || rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { numeric: true }))
}
