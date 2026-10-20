// Vercel serverless function - passes the GSR (and its audit file) from the app to the GSR Google Drive receiver
// (tools/gsr/gsr-drive.gs.js, a SEPARATE Apps Script from the backup receiver). The Drive address and password live ONLY in this
// function's environment (GSR_SCRIPT_URL, GSR_SCRIPT_TOKEN); a browser never sees them.
//
// Same shared-key gate as the other functions. Only the five actions the receiver knows are forwarded. Not configured answers
// 503 and the app says "GSR Drive is not set up"; nothing else breaks.

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

const APP_SHARED_KEY = process.env.VITE_APP_SHARED_KEY
const GSR_SCRIPT_URL = process.env.GSR_SCRIPT_URL
const GSR_SCRIPT_TOKEN = process.env.GSR_SCRIPT_TOKEN
const ACTIONS = new Set(['ping', 'create', 'read', 'setCells', 'rename'])

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (APP_SHARED_KEY && req.headers['x-bsm-app-key'] !== APP_SHARED_KEY) { res.status(401).json({ error: 'Unauthorized' }); return }
  if (!GSR_SCRIPT_URL || !GSR_SCRIPT_TOKEN) { res.status(503).json({ error: 'not-configured' }); return }
  const body = req.body && typeof req.body === 'object' ? req.body : null
  if (!body || !ACTIONS.has(body.action)) { res.status(400).json({ error: 'unknown action' }); return }
  try {
    const r = await fetch(GSR_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, token: GSR_SCRIPT_TOKEN }),
      redirect: 'follow',
    })
    const reply = await r.json().catch(() => null)
    if (!reply) { res.status(502).json({ error: 'drive did not answer', detail: `HTTP ${r.status}` }); return }
    if (!reply.ok) { res.status(502).json({ error: 'drive refused', detail: String(reply.error ?? '').slice(0, 200) }); return }
    res.status(200).json(reply)
  } catch (e) {
    res.status(500).json({ error: String(e.message ?? e).slice(0, 200) })
  }
}
