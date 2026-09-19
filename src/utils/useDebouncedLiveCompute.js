// Shared implementation of the pattern documented in
// docs/technical-design-document.md §2.12: an expensive async
// computation that reads tables beyond the one it's conceptually
// about (a rollup walking every pile's transaction history, an
// admin-wide MO/TMO fulfillment scan) must not be left to re-run
// directly off Dexie's automatic per-write useLiveQuery tracking once
// it's expensive enough to matter - EVERY incoming Dexie Cloud sync
// write retriggers it, sometimes dozens of times in a row during a
// sync burst, and useLiveQuery keeps rendering its previous result
// while a new one computes, so a legitimately-still-settling page
// looks frozen instead.
//
// First shipped inline in AdminHomeStocks.jsx (1.10-31/1.10-32),
// extracted here once the exact same bug was confirmed a second time
// in MillingMonitor.jsx's admin-wide order-fulfillment computation
// (1.10-34) - the lesson is a named, reusable pattern now, not a
// one-off fix.
//
// `computeFn` is called with no arguments whenever the debounced
// trigger fires; it should read whatever live data it needs via
// closures over the calling component's own render-scope values
// (warehouses, topTab, etc.) - this hook re-captures the LATEST
// closure every render (via computeFnRef, updated unconditionally,
// not inside an effect), so the caller never needs its own manual
// "keep this fresh in a ref" plumbing, only the change-detection
// signal below does.
//
// `changeSignal` is a cheap, stable primitive (a template-string
// combination of row counts is the established convention - see
// AdminHomeStocks.jsx/MillingMonitor.jsx) that changes whenever the
// underlying data genuinely might have changed. A burst of signal
// changes collapses into one recompute after `debounceMs` of quiet;
// `maxWaitMs` guarantees a recompute on a bounded schedule regardless
// of how continuous the underlying write traffic is, so the debounce
// can never fully starve under real sync load - but keep this
// generous (tens of seconds, not single-digit seconds): a device with
// genuinely continuous sync traffic will hit maxWaitMs on a steady
// cadence for as long as that page stays open, and an aggressively
// short maxWaitMs turns into a perpetual background recompute loop
// that can make the whole page (not just this one value) feel
// sluggish - confirmed, reported real regression from an earlier
// 5000ms maxWaitMs on AdminHomeStocks.jsx.
//
// Returns `undefined` while the very first computation (or a
// recompute triggered by a signal change) is in flight, matching the
// undefined-vs-empty-result loading convention already used
// throughout this app - the caller defaults it with `?? <empty
// value>` for rendering, and uses `=== undefined` for its own loading
// state, exactly as a plain useLiveQuery result already would.
import { useEffect, useRef, useState } from 'react'

export function useDebouncedLiveCompute(computeFn, changeSignal, errorFallback, { debounceMs = 700, maxWaitMs = 30000 } = {}) {
  const [trigger, setTrigger] = useState(0)
  const debounceTimerRef = useRef(null)
  const maxWaitTimerRef = useRef(null)
  useEffect(() => {
    const fire = () => {
      setTrigger((v) => v + 1)
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current)
        maxWaitTimerRef.current = null
      }
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(fire, debounceMs)
    // Only armed once per burst (not re-armed on every quiet-window
    // reset above) - see this file's own top comment for why this
    // needs to stay generous rather than tight.
    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(fire, maxWaitMs)
    }
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [changeSignal, debounceMs, maxWaitMs])

  // Updated unconditionally every render (not inside an effect) so it
  // always holds the most recent render's closure by the time the
  // effect below actually invokes it - see this file's own top
  // comment for why callers don't need their own "latest ref" for the
  // data computeFn closes over.
  const computeFnRef = useRef(computeFn)
  computeFnRef.current = computeFn
  const errorFallbackRef = useRef(errorFallback)
  errorFallbackRef.current = errorFallback

  const [result, setResult] = useState(undefined)
  useEffect(() => {
    let cancelled = false
    setResult(undefined)
    ;(async () => {
      try {
        const value = await computeFnRef.current()
        if (!cancelled) setResult(value)
      } catch (err) {
        console.error('[useDebouncedLiveCompute] computation failed:', err)
        // Surface something rather than leaving the caller's loading
        // state stuck forever on an unexplained failure - see
        // AdminHomeStocks.jsx's original comment on this same choice.
        if (!cancelled) setResult(errorFallbackRef.current)
      }
    })()
    return () => { cancelled = true }
    // Deliberately depends ONLY on the trigger - see this file's own
    // top comment for why the live data computeFn reads is captured
    // via computeFnRef instead of as a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])

  return result
}
