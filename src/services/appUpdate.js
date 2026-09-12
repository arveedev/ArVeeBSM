// Wraps vite-plugin-pwa's registerSW() as a small singleton other
// modules can use without each holding their own reference to the
// service worker registration - main.jsx calls initAppUpdate() once at
// startup; UpdateChecker.jsx (the user-visible "a new version is
// available" toast) subscribes via onUpdateAvailable() and calls
// applyUpdate() only when the user actually taps its own button.
//
// registerType is 'prompt' (vite.config.js), specifically so NOTHING
// here ever reloads the page on its own - see that file's own comment
// for the reported bug this fixes (an unsolicited mid-work reload, and
// the "Update now" toast never getting a chance to show because the
// silent auto-reload had already happened). registerSW() below only
// installs a new service worker and lets it sit WAITING; applyUpdate()
// is the one and only thing that ever tells it to take over.

import { registerSW } from 'virtual:pwa-register'

let registration = null
const listeners = new Set()
// initAppUpdate() runs in main.jsx before React even mounts - if
// onNeedRefresh fires before UpdateChecker.jsx's own useEffect has had
// a chance to subscribe (a real possible race, not just a theoretical
// one), that signal must not be lost. Remembered here so a late
// subscriber still gets notified immediately.
let needRefreshFired = false

export const initAppUpdate = () => {
  registerSW({
    immediate: true,
    // Authoritative "a new service worker is genuinely ready" signal -
    // workbox-window itself detected a real waiting worker. This is a
    // SEPARATE, independent path from UpdateChecker.jsx's own
    // public/version.json poll (a plain static file fetch) - added
    // after a reported case where the update toast never showed on a
    // real phone at all, which a bare version.json comparison can't
    // explain away (both paths now trigger the same visible notice, so
    // either one succeeding is enough).
    onNeedRefresh() {
      needRefreshFired = true
      listeners.forEach((fn) => fn())
    },
    onRegisteredSW(_url, reg) {
      registration = reg
    },
  })

  // Reported, confirmed real bug: on PC, the toast kept reappearing
  // even after a tap on "Update now", which itself silently did
  // nothing. Root cause (found by reading vite-plugin-pwa's own
  // register.js): registerSW()'s returned update function calls
  // workbox-window's OWN internal messageSkipWaiting(), which only
  // knows about a waiting worker if ITS OWN 'waiting' event already
  // fired and populated its own internal reference - a separate,
  // independently-tracked value from the raw registration.waiting this
  // module polls in applyUpdate() below. The two can desync (e.g. a tab
  // that didn't itself observe workbox-window's 'waiting' event live),
  // making that call a silent no-op even though registration.waiting is
  // genuinely populated - exactly matching "tap does nothing, no
  // reload, no error", with the toast then correctly reappearing next
  // poll since the update genuinely never applied.
  //
  // Fixed by never going through that wrapper again: applyUpdate()
  // posts the skip-waiting message directly to registration.waiting
  // itself (the generated sw.js's own message listener - confirmed via
  // dist/sw.js - only ever checks for { type: 'SKIP_WAITING' }, the
  // exact same message workbox-window sends), and this listener reloads
  // the page itself the moment that produces a real new controller,
  // instead of relying on workbox-window's own 'controlling' listener
  // (which is registered only inside its internal showSkipWaitingPrompt
  // - i.e. only when ITS 'waiting' event fired, the same desync as
  // above).
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    window.location.reload()
  })
}

// Lets a component (UpdateChecker.jsx) know the moment the service
// worker itself confirms an update is ready, independent of the
// version.json poll. Returns an unsubscribe function.
export const onUpdateAvailable = (fn) => {
  listeners.add(fn)
  if (needRefreshFired) fn()
  return () => listeners.delete(fn)
}

// Asks the browser to check the real sw.js on the server right now -
// call whenever the app becomes visible again, or a periodic poll wants
// a fresher check. workbox-window does NOT do this on its own
// (confirmed by reading its source) - nothing else in this app
// triggers a real update check without this being called explicitly.
export const checkForUpdate = () => {
  registration?.update()
}

// The only path that ever actually reloads the page - only ever called
// from the user's own tap on "Update now" (UpdateAvailableToast).
//
// Reported, confirmed real bug: calling this immediately on tap could
// silently do nothing (desktop) - public/version.json (a small static
// file) can report a mismatch well before the ACTUAL new service worker
// - a much bigger download that has to fetch, parse, and precache
// everything - has finished installing, so `registration.waiting` often
// isn't populated yet at the exact moment the toast first appears and
// gets tapped. A second version of this fix used a short fallback timer
// to force a reload either way - that raced the real install on a real
// device and made things WORSE (confirmed live: stuck reloading into
// the still-old service worker on every tap). This version instead
// actually WAITS for a real waiting worker to exist (checking every
// 300ms, up to 20s - comfortably longer than a normal install takes)
// before sending skip-waiting, and only falls back to a plain reload if
// that genuinely never happens within the wait window.
export const applyUpdate = async () => {
  checkForUpdate()
  const deadline = Date.now() + 20000
  while (!registration?.waiting && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  if (registration?.waiting) {
    // Sent straight to the raw waiting worker, not through
    // workbox-window's own wrapper - see initAppUpdate()'s comment for
    // why that wrapper can silently no-op on PC. This module's own
    // 'controllerchange' listener (registered in initAppUpdate) reloads
    // the page once this genuinely takes effect.
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  } else {
    // Genuinely timed out with nothing to activate - 20s is well beyond
    // a normal install, so a plain reload is safe here (unlike the
    // earlier short-timer version): it can't be interrupting a real
    // in-progress installation that was ever going to finish in time.
    window.location.reload()
  }
}

// Confirmed, reported real trap: a user stuck on a build from BEFORE
// this file's own update-mechanism fixes has no way to receive those
// fixes through the normal "Update now" flow, because the code running
// that flow IS the broken code - a chicken-and-egg problem no future
// JS fix can self-heal (the fix only exists in the new bundle the old
// bundle is failing to fetch). That specific trap needed a one-time
// manual browser fix (clearing site data). This is the escape hatch so
// nobody has to do that by hand again: unregister every service worker
// this origin has (there should only ever be one, but a leftover from
// an old dev/preview registration is possible) and delete every Cache
// Storage entry, THEN reload - a completely clean slate that forces a
// genuinely fresh fetch of everything, bypassing any stuck registration
// or precache regardless of what state it's in.
export const forceRefresh = async () => {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    const keys = await caches?.keys?.() ?? []
    await Promise.all(keys.map((k) => caches.delete(k)))
  } finally {
    // Cache-busting query param, not just reload() - the DOCUMENT
    // request itself (index.html) could otherwise still be served from
    // the browser's own plain HTTP cache even with every service
    // worker/Cache Storage entry gone.
    window.location.href = `${window.location.pathname}?refresh=${Date.now()}`
  }
}
