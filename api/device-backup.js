// Vercel serverless function - receives ONE PC's daily device backup file (the gzip file src/utils/deviceFile.js builds)
// and passes it to the Google Drive receiver (apps-script in the bsm-backups repository, device mode), which keeps the newest
// 45 per device. The Drive address and password live ONLY in this function's environment (DRIVE_SCRIPT_URL,
// DRIVE_SCRIPT_TOKEN); a PC never sees them.
//
// Same shared-key gate as backup-to-github.js and dexie-cloud-tokens.js. On top of that the file is checked here, so a stray or
// forged request cannot put anything but a valid, self-consistent BSM device file in the Drive folder: it must gunzip, pass
// verifyDeviceFile (checksum, counts, database id), and its own device id must match the request's.
//
// Not configured (no DRIVE_* variables) answers 503 and the app simply reports "Drive copy not set up"; nothing else breaks.

import zlib from 'node:zlib'
import { verifyDeviceFile } from '../src/utils/deviceFile.js'

export const config = { api: { bodyParser: false } }

const APP_SHARED_KEY = process.env.VITE_APP_SHARED_KEY
const DRIVE_SCRIPT_URL = process.env.DRIVE_SCRIPT_URL
const DRIVE_SCRIPT_TOKEN = process.env.DRIVE_SCRIPT_TOKEN
const MAX_BYTES = 4 * 1024 * 1024 // Vercel's own request limit is 4.5 MB

const readBody = async (req) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BYTES) throw Object.assign(new Error('file too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (APP_SHARED_KEY && req.headers['x-bsm-app-key'] !== APP_SHARED_KEY) { res.status(401).json({ error: 'Unauthorized' }); return }
  if (!DRIVE_SCRIPT_URL || !DRIVE_SCRIPT_TOKEN) { res.status(503).json({ error: 'not-configured' }); return }

  try {
    const gz = await readBody(req)
    if (gz.length < 20 || gz[0] !== 0x1f || gz[1] !== 0x8b) { res.status(400).json({ error: 'not a gzip file' }); return }
    let text
    try { text = zlib.gunzipSync(gz).toString('utf8') } catch { res.status(400).json({ error: 'gzip cannot be read' }); return }
    const v = await verifyDeviceFile(text)
    if (!v.ok) { res.status(422).json({ error: 'file did not verify', problems: v.problems.slice(0, 5) }); return }
    const deviceId = String(req.headers['x-device-id'] ?? '')
    if (!deviceId || deviceId !== v.meta.deviceId) { res.status(422).json({ error: 'device id mismatch' }); return }
    const date = String(req.headers['x-file-date'] ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'bad date' }); return }

    const sha256 = (await import('node:crypto')).createHash('sha256').update(gz).digest('hex')
    const body = JSON.stringify({
      token: DRIVE_SCRIPT_TOKEN,
      kind: 'device',
      deviceId,
      deviceName: String(v.meta.deviceName ?? '').slice(0, 60),
      date,
      sha256,
      dataBase64: gz.toString('base64'),
    })
    // Apps Script answers a POST with a redirect to the result; fetch follows it with GET, which is what is needed.
    const r = await fetch(DRIVE_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' })
    const reply = await r.json().catch(() => null)
    if (!reply?.ok) { res.status(502).json({ error: 'drive refused', detail: String(reply?.error ?? r.status).slice(0, 200) }); return }
    if (reply.sha256 !== sha256) { res.status(502).json({ error: 'drive copy differs from the file' }); return }
    res.status(200).json({ ok: true, name: reply.name })
  } catch (e) {
    res.status(e.status ?? 500).json({ error: String(e.message ?? e).slice(0, 200) })
  }
}
