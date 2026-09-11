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
      const handleUpdate = () => {
        applyUpdate()
        // Fallback: version.json said there's an update, but if the
        // service worker itself somehow never got a waiting worker
        // ready (checkServiceWorkerForUpdate above is best-effort, not
        // guaranteed to finish in time), applyUpdate() has nothing to
        // act on and never reloads - the button would silently do
        // nothing. Falls back to a plain reload after a short grace
        // period so tapping it always does SOMETHING; moot if
        // applyUpdate() already triggered a real reload first, since
        // the page is gone by the time this timer would fire.
        setTimeout(() => window.location.reload(), 4000)
      }
      toast(
        <UpdateAvailableToast onUpdate={handleUpdate} />,
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
