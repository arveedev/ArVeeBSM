// Sends the inventory report tables to a Google Sheet through its OWN Apps
// Script web app (see docs/inventory-sheet-export-script.js and
// docs/inventory-sheet-export-setup.md).
//
// Deliberately separate from googleSheetsBridge.js: that bridge has a write
// allowlist so this app can never write to the AI/SIA sheets; this export only
// ever posts to the one URL an Admin saved for it, and that script only writes
// to the one reporting spreadsheet it is attached to. Nothing here reads or
// writes any BSM record.

const TIMEOUT_MS = 60000

/** A report table model -> plain rows, merges and style hints for the Apps Script. */
export const modelToSheet = (model, name) => {
  const width = Math.max(model.head[0].reduce((s, c) => s + c.span, 0), 2)
  const pad = (arr) => { while (arr.length < width) arr.push(''); return arr }
  const values = []
  const merges = []
  values.push(pad([model.title]))
  merges.push([1, 1, 1, width])
  values.push(pad([model.subtitle]))
  merges.push([2, 1, 2, width])
  values.push(pad([]))
  const headStart = values.length + 1
  model.head.forEach((row, ri) => {
    const out = []
    row.forEach((h, ci) => {
      if (ci === 0 && ri > 0) { out.push(''); return }
      const startCol = out.length + 1
      out.push(h.t)
      for (let k = 1; k < h.span; k++) out.push('')
      if (h.span > 1) merges.push([headStart + ri, startCol, headStart + ri, startCol + h.span - 1])
    })
    values.push(pad(out))
  })
  merges.push([headStart, 1, headStart + model.head.length - 1, 1])
  const bodyStart = values.length + 1
  const kinds = []
  const notes = []
  for (const r of model.rows) {
    values.push(pad([r.first, ...r.cells.map((v) => (v == null ? (r.dash ? '-' : '') : v))]))
    kinds.push(r.kind)
    r.notes?.forEach((n, i) => {
      if (n) notes.push({ r: values.length, c: 2 + i, t: n.map((l) => `${l.doc}${l.customer ? ` - ${l.customer}` : ''}${l.pile ? ` - ${l.pile}` : ''}: ${l.value.toFixed(2)}`).join('\n') })
    })
  }
  return { name, values, merges, headStart, headRows: model.head.length, bodyStart, kinds, width, notes }
}

const fetchWithTimeout = (url, options) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

/**
 * action: 'ping' (test the connection) or 'writeInventoryReport' (send tabs).
 * Content-Type is text/plain on purpose: Apps Script web apps cannot answer a
 * CORS preflight, and application/json would trigger one.
 */
export const postInventorySheet = async (settings, action, extra = {}) => {
  const url = settings?.webAppUrl?.trim()
  if (!url) return { ok: false, reason: 'not_configured' }
  let last = { ok: false, reason: 'request_failed' }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: settings.token ?? '', ...extra }),
      })
      if (!res.ok) { last = { ok: false, reason: 'request_failed', httpStatus: res.status } } else {
        const payload = await res.json()
        if (payload.status === 'SUCCESS') return { ok: true, ...payload }
        return { ok: false, reason: 'bad_response', message: payload.message ?? null }
      }
    } catch (err) {
      last = { ok: false, reason: 'request_failed', error: err.message }
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600))
  }
  return last
}
