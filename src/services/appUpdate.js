// Wraps vite-plugin-pwa's registerSW() as a small singleton other
// modules can use without each holding their own reference to the
// service worker registration - main.jsx calls initAppUpdate() once at
// startup; UpdateChecker.jsx (the user-visible "a new version is
// available" toast) calls applyUpdate() only when the user actually
// taps its own button.
//
// registerType is 'prompt' (vite.config.js), specifically so NOTHING
// here ever reloads the page on its own - see that file's own comment
// for the reported bug this fixes (an unsolicited mid-work reload, and
// the "Update now" toast never getting a chance to show because the
// silent auto-reload had already happened). registerSW() below only
// installs a new service worker and lets it sit WAITING; applyUpdate()
// is the one and only thing that ever tells it to take over.

import { registerSW } from 'virtual:pwa-register'

let applyUpdateFn = null
let registration = null

export const initAppUpdate = () => {
  applyUpdateFn = registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg
    },
  })
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
export const applyUpdate = () => {
  applyUpdateFn?.(true)
}
