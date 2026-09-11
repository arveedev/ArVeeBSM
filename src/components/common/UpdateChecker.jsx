// Explicit "is the deployed version newer than what I'm running" check -
// the ONE visible notice for an available update. Deliberately not tied
// to whatever the service worker itself is doing (see appUpdate.js/
// vite.config.js) - registerType is 'prompt', so nothing ever reloads on
// its own; this is what tells the user an update exists at all, and its
// button (applyUpdate) is what actually applies it, only on their own tap.
//
// Compares the running bundle's own APP_VERSION (src/version.js, baked
// in at build time) against public/version.json - a tiny static file
// with no cache headers relied on, fetched with cache: 'no-store' plus a
// cache-busting query param so it always reflects what's actually
// deployed right now, not a stale HTTP-cached copy. sync-version.cjs
// (see package.json's predev/prebuild) regenerates version.json from the
// same src/version.js on every build, so the two can never drift apart
// at the source - only "what's currently deployed vs what THIS device
// has loaded" can differ, which is exactly the case this checks for.

import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { APP_VERSION } from '../../version.js'
import { UpdateAvailableToast } from './AnimatedToast.jsx'
import { checkForUpdate as checkServiceWorkerForUpdate, applyUpdate } from '../../services/appUpdate.js'

const UPDATE_TOAST_ID = 'app-update-available'
const POLL_MS = 15 * 60 * 1000 // 15 minutes, while the app stays open

const checkVersionMismatch = async () => {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const { version } = await res.json()
    if (version && version !== APP_VERSION) {
      // Also nudges the service worker itself to fetch the new one now,
      // in the background - so by the time the user actually taps
      // "Update now" (maybe minutes from now), applyUpdate() has a
      // waiting worker ready to activate immediately instead of only
      // starting the download at that moment.
      checkServiceWorkerForUpdate()
      // Reported, real bug: a fallback timer here (a blind
      // window.location.reload() a few seconds after tapping, in case
      // applyUpdate() had nothing to act on yet) raced against the real
      // skipWaiting -> activate -> controlling sequence on a real
      // device - downloading + installing the new service worker
      // legitimately took longer than the timer, so the fallback fired
      // FIRST, reloading back into the still-old, still-controlling
      // service worker before it had finished taking over. That looked
      // like the app "restarting" on every tap while staying stuck on
      // the old version - confirmed live (stuck on 1.9-109 through
      // repeated taps, only a full close of the app let the
      // already-waiting worker actually activate). No timer-based
      // fallback now - applyUpdate() alone drives the reload, whenever
      // the real activation actually completes, however long that
      // takes on a given connection.
      toast(
        <UpdateAvailableToast onUpdate={applyUpdate} />,
        { id: UPDATE_TOAST_ID, duration: Infinity }
      )
    }
  } catch {
    // Offline, or version.json genuinely unreachable - not an error
    // worth surfacing, just skip this check and try again next tick.
  }
}

export default function UpdateChecker() {
  const intervalRef = useRef(null)

  useEffect(() => {
    checkVersionMismatch()
    intervalRef.current = setInterval(checkVersionMismatch, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkVersionMismatch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
