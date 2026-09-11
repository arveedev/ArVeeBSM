// Explicit "is the deployed version newer than what I'm running" check -
// a backstop on top of main.jsx's registerSW()/visibilitychange update
// mechanism, per direct request after a reported case where a device was
// still showing v1.9-103 after "a few tries" even with that mechanism in
// place (service worker update timing can genuinely still get stuck on
// some devices/browsers - this gives the user a visible, actionable
// notice instead of silently hoping the SW sorts itself out).
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

const UPDATE_TOAST_ID = 'app-update-available'
const POLL_MS = 15 * 60 * 1000 // 15 minutes, while the app stays open

const checkForUpdate = async () => {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const { version } = await res.json()
    if (version && version !== APP_VERSION) {
      toast(
        <UpdateAvailableToast onUpdate={() => window.location.reload()} />,
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
    checkForUpdate()
    intervalRef.current = setInterval(checkForUpdate, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
