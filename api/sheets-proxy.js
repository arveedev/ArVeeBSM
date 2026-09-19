// Vercel serverless function - forwards a GET request to this app's
// Google Apps Script Web App server-to-server, instead of the browser
// calling it directly.
//
// Reported, real bug: fetchTransactionsBulk/fetchAuthorityRows/
// fetchMillingOrderRows kept 404ing intermittently - the SAME request,
// sometimes failing, sometimes succeeding, with no code or data change
// in between. Traced (Network tab) to Apps Script Web Apps routing
// EVERY GET response through a 302 redirect to a
// script.googleusercontent.com/macros/echo?... content-hosting URL when
// called via a plain browser fetch() - and that echo step is what's
// unreliable, not the Apps Script script itself (its own Executions log
// showed every doGet completing successfully). A direct top-level
// browser navigation to the same URL never showed this redirect at all,
// pointing at something specific to how a browser-issued fetch() is
// handled versus a server-to-server request. Client-side retry
// (googleSheetsBridge.js's fetchWithRetry) helped but didn't eliminate
// it - some sheets failed often enough to exhaust three retries.
//
// This function is the actual fix: it runs the fetch from Vercel's
// Node runtime, not a browser, so it should never hit whatever
// browser-fetch()-specific behavior triggers the echo-redirect
// flakiness in the first place. The client now calls THIS endpoint
// instead of script.google.com directly for every GET (read-only)
// Apps Script action.
//
// Restricted to script.google.com Apps Script Web App URLs only - never
// an open proxy to an arbitrary destination.
const ALLOWED_TARGET = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?.*)?$/

// Confirmed, reported real bug: this was originally set to 25000
// (defensively guessed low, assuming a 10s Hobby-plan function limit)
// - but this project's actual Vercel function budget is 5 MINUTES
// (confirmed directly in the Function Invocation panel of a failed
// request's logs), and the client itself was already willing to wait
// 45s (googleSheetsBridge.js's BULK_FETCH_TIMEOUT_MS). A 25s internal
// timeout here meant this function was aborting itself and returning a
// 502 BEFORE the client's own, more generous timeout ever had a chance
// to matter - the actual logged error was a plain AbortError from this
// file's own controller, not anything Apps Script or Google returned.
// Raised well above the client's own timeout (see that constant's
// comment for why they need to stay in this order) so this proxy is
// never the tighter constraint.
const UPSTREAM_TIMEOUT_MS = 60000

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ status: 'ERROR', message: 'Method not allowed' })
    return
  }

  const target = req.query.url
  if (typeof target !== 'string' || !ALLOWED_TARGET.test(target)) {
    res.status(400).json({ status: 'ERROR', message: 'Invalid or missing target URL' })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const upstream = await fetch(target, { signal: controller.signal })
    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    res.send(text)
  } catch (err) {
    console.error('[sheets-proxy] Upstream request failed:', err)
    res.status(502).json({ status: 'ERROR', message: 'Upstream Apps Script request failed', detail: err.message })
  } finally {
    clearTimeout(timer)
  }
}
