// Explicit "a new version is available" notice - shown from TWO
// independent triggers, since neither alone was reliable enough on its
// own (confirmed live): comparing the running bundle's own APP_VERSION
// (src/version.js, baked in at build time) against public/version.json
// (a tiny static file, fetched with cache: 'no-store' plus a
// cache-busting query param), AND the service worker's own authoritative
// "I found a real waiting update" signal (appUpdate.js's
// onUpdateAvailable, wired to registerSW's onNeedRefresh). Either one
// firing shows the same toast - a version.json mismatch might not be
// reachable/trustworthy on every network, and the service worker's own
// detection can lag behind a fresh deploy on some devices; between the
// two, whichever notices first tells the user.
//
// sync-version.cjs (see package.json's predev/prebuild) regenerates
// version.json from the same src/version.js on every build, so the two
// can never drift apart at the source.

import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { APP_VERSION } from '../../version.js'
import { UpdateAvailableToast } from './AnimatedToast.jsx'
import { checkForUpdate, applyUpdate, onUpdateAvailable, forceRefresh } from '../../services/appUpdate.js'

const UPDATE_TOAST_ID = 'app-update-available'
const POLL_MS = 15 * 60 * 1000 // 15 minutes, while the app stays open

const showUpdateToast = () => {
  toast(
    <UpdateAvailableToast onUpdate={applyUpdate} onForceRefresh={forceRefresh} />,
    { id: UPDATE_TOAST_ID, duration: Infinity }
  )
}

const checkVersionMismatch = async () => {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const { version } = await res.json()
    if (version && version !== APP_VERSION) {
      // Also nudges the service worker itself to fetch the new one now,
      // in the background, so applyUpdate() has a head start once the
      // user actually taps.
      checkForUpdate()
      showUpdateToast()
    }
  } catch {
    // Offline, or version.json genuinely unreachable - not an error
    // worth surfacing, just skip this check and try again next tick.
  }
}

export default function UpdateChecker() {
  const intervalRef = useRef(null)

  useEffect(() => {
    const unsubscribe = onUpdateAvailable(showUpdateToast)
    checkVersionMismatch()
    intervalRef.current = setInterval(checkVersionMismatch, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkVersionMismatch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsubscribe()
      clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
