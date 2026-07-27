// Vercel serverless function - the ONLY place the Dexie Cloud
// client_id/client_secret are ever used. They live as Vercel
// environment variables (set in the Vercel dashboard, never committed
// to git), and this function is the only thing that reads them.
//
// Every device in the app calls this endpoint (via fetchTokens in
// src/db/dexie.js) to get a token, always for the SAME fixed shared
// service account - PIN login remains the app's real, user-facing
// authentication; this is invisible infrastructure underneath it that
// lets writes actually reach Dexie Cloud (the built-in email-OTP login
// is intentionally never shown to warehouse staff).

const DB_URL = process.env.DEXIE_CLOUD_DB_URL
const CLIENT_ID = process.env.DEXIE_CLOUD_CLIENT_ID
const CLIENT_SECRET = process.env.DEXIE_CLOUD_CLIENT_SECRET

// Arbitrary, fixed identifier for the shared service account - every
// device authenticates as this same identity, so they all share one
// Dexie Cloud "user" and its private realm.
const SERVICE_ACCOUNT_SUB = 'bsm-app-service@system.local'

async function readJsonBody(req) {
  // Vercel's automatic req.body parsing can be unreliable in some dev
  // configurations (silently undefined instead of throwing) - reading
  // and parsing the raw request stream ourselves is more robust.
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  console.log('[dexie-cloud-tokens] Request received, method:', req.method)

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  console.log('[dexie-cloud-tokens] Env check - DB_URL set:', Boolean(DB_URL), 'CLIENT_ID set:', Boolean(CLIENT_ID), 'CLIENT_SECRET set:', Boolean(CLIENT_SECRET))

  if (!DB_URL || !CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'Server is missing DEXIE_CLOUD_DB_URL / DEXIE_CLOUD_CLIENT_ID / DEXIE_CLOUD_CLIENT_SECRET environment variables' })
    return
  }

  try {
    const body = await readJsonBody(req)
    console.log('[dexie-cloud-tokens] Parsed request body:', JSON.stringify(body))
    const publicKey = body?.public_key

    console.log('[dexie-cloud-tokens] Calling Dexie Cloud token endpoint...')
    const tokenResponse = await fetch(`${DB_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        scopes: ['ACCESS_DB'],
        public_key: publicKey,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        claims: {
          sub: SERVICE_ACCOUNT_SUB,
          name: 'BSM App',
        },
      }),
    })

    console.log('[dexie-cloud-tokens] Dexie Cloud responded with status:', tokenResponse.status)

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('[dexie-cloud-tokens] Dexie Cloud /token endpoint rejected the request:', tokenResponse.status, errorText)
      res.status(502).json({ error: 'Failed to retrieve token from Dexie Cloud', detail: errorText })
      return
    }

    const tokenBody = await tokenResponse.json()
    console.log('[dexie-cloud-tokens] Success - returning token to client.')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json(tokenBody)
  } catch (err) {
    console.error('[dexie-cloud-tokens] Unexpected error:', err)
    res.status(500).json({ error: 'Unexpected server error', detail: err.message })
  }
}
