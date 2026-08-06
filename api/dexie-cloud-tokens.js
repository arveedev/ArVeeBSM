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
  // DB_URL is not a secret - logging its actual value (not just
  // whether it's set) directly settles whether this specific
  // serverless function invocation is using the new database's URL
  // or still the old one, via Vercel's own function logs. Also logs
  // just the first 8 characters of CLIENT_ID (enough to distinguish
  // old vs new without exposing the full value in logs).
  console.log('[dexie-cloud-tokens] *** Actual DB_URL:', DB_URL, '***')
  console.log('[dexie-cloud-tokens] *** CLIENT_ID starts with:', CLIENT_ID?.slice(0, 8), '***')

  if (!DB_URL || !CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'Server is missing DEXIE_CLOUD_DB_URL / DEXIE_CLOUD_CLIENT_ID / DEXIE_CLOUD_CLIENT_SECRET environment variables' })
    return
  }

  try {
    const body = await readJsonBody(req)
    console.log('[dexie-cloud-tokens] Parsed request body:', JSON.stringify(body))

    // Per Dexie Cloud's token refresh mechanism, fetchTokens may be
    // called with { grant_type: 'refresh_token', refresh_token: '...' }
    // instead of a public_key, once a device's access token has
    // expired (roughly hourly) rather than on true initial login. This
    // branch is purely additive - it only ever changes behavior when
    // grant_type is actually 'refresh_token', which has not yet been
    // directly observed in this app's own logs, but cannot be ruled
    // out without a long-running session actually reaching that point.
    // The existing, confirmed-working client_credentials path below is
    // completely unchanged for every other case.
    const isRefreshTokenRequest = body?.grant_type === 'refresh_token'
    const publicKey = body?.public_key

    const tokenPayload = isRefreshTokenRequest
      ? {
          grant_type: 'refresh_token',
          refresh_token: body.refresh_token,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }
      : {
          grant_type: 'client_credentials',
          // IMPERSONATE is REQUIRED to supply the claims property below -
          // per Dexie Cloud's own documentation: "A client must be given
          // the IMPERSONATE scope in order to supply claims property to
          // this endpoint." This was previously missing entirely, which
          // very likely meant claims.sub (the fixed shared identity every
          // device is supposed to authenticate as) was being silently
          // ignored - each device may have been getting its own separate,
          // unlinked identity instead of genuinely sharing one, which
          // would fully explain data only ever appearing on the device
          // that created it. NOTE: this also requires the Dexie Cloud
          // client_id/client_secret itself to have been GRANTED the
          // IMPERSONATE scope at the account level (the default client
          // has every scope; a custom client created via
          // `npx dexie-cloud authorize` needs it explicitly included) -
          // adding it to this request alone is not sufficient if the
          // client itself was never granted it.
          scopes: ['ACCESS_DB', 'IMPERSONATE'],
          public_key: publicKey,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          claims: {
            sub: SERVICE_ACCOUNT_SUB,
            name: 'BSM App',
          },
        }

    console.log(`[dexie-cloud-tokens] Calling Dexie Cloud token endpoint (grant_type: ${tokenPayload.grant_type})...`)
    const tokenResponse = await fetch(`${DB_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokenPayload),
    })

    console.log('[dexie-cloud-tokens] Dexie Cloud responded with status:', tokenResponse.status)

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('[dexie-cloud-tokens] Dexie Cloud /token endpoint rejected the request:', tokenResponse.status, errorText)
      res.status(502).json({ error: 'Failed to retrieve token from Dexie Cloud', detail: errorText })
      return
    }

    const tokenBody = await tokenResponse.json()
    // Decode (not verify - just base64, no signing key needed here)
    // the returned access token's actual sub claim, so this can be
    // directly confirmed rather than assumed: every device's token
    // should show the exact same value (SERVICE_ACCOUNT_SUB) if the
    // shared-identity fix above is actually working.
    try {
      const payload = JSON.parse(Buffer.from(tokenBody.accessToken.split('.')[1], 'base64').toString('utf8'))
      console.log('[dexie-cloud-tokens] Issued token sub claim:', payload.sub, '(expected:', SERVICE_ACCOUNT_SUB, ')')
    } catch (decodeErr) {
      console.log('[dexie-cloud-tokens] Could not decode token for logging:', decodeErr.message)
    }
    console.log('[dexie-cloud-tokens] Success - returning token to client.')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json(tokenBody)
  } catch (err) {
    console.error('[dexie-cloud-tokens] Unexpected error:', err)
    res.status(500).json({ error: 'Unexpected server error', detail: err.message })
  }
}
