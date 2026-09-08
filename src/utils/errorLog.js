// Records caught errors (form save/update/delete/void failures, and
// whole-page crashes caught by SectionErrorBoundary) to db.errorLogs,
// so an admin can actually see what went wrong after the fact, on which
// device, and by whom - the user just sees a plain "Save failed" toast;
// the real technical detail (message, stack, which context, which user,
// which device) previously only ever went to console.error, invisible
// to anyone not standing at that exact device with DevTools open.
// errorLogs is a synced table (see dexie.js's own comment), so this is
// visible from any device, not just the one the error happened on.

import { db } from '../db/dexie.js'

// Keeps the table from growing without bound over the life of the app -
// old entries are pruned as new ones come in, well past what anyone
// would realistically need to scroll through in the admin viewer.
const MAX_ENTRIES = 300

const DEVICE_ID_KEY = 'bsm-device-id'
const DEVICE_LABEL_KEY = 'bsm-device-label'

/**
 * A persistent per-browser/device identifier - generated once and kept
 * in localStorage forever after, so every error logged from this same
 * install (regardless of which staff PIN is logged in at the time)
 * shows the same deviceId, letting an admin tell "the same tablet kept
 * erroring" apart from "five different devices each hit it once".
 * localStorage (not IndexedDB) deliberately - this needs to be
 * synchronous and trivial to read on every single log call, and never
 * needs to sync anywhere itself.
 */
const getDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return 'unknown-device'
  }
}

/**
 * A short, human-readable device label an admin can actually recognize
 * at a glance (e.g. "Chrome on Android") without decoding a UUID or a
 * raw user-agent string - derived once from the user agent and cached
 * alongside the device id, since parsing it fresh on every error is
 * unnecessary work for a value that never changes for a given install.
 */
const getDeviceLabel = () => {
  try {
    const cached = localStorage.getItem(DEVICE_LABEL_KEY)
    if (cached) return cached

    const ua = navigator.userAgent ?? ''
    const os = /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Windows/.test(ua) ? 'Windows'
      : /Macintosh/.test(ua) ? 'Mac'
      : /Linux/.test(ua) ? 'Linux'
      : 'Unknown OS'
    const browser = /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari'
      : 'Unknown browser'
    const label = `${browser} on ${os}`
    localStorage.setItem(DEVICE_LABEL_KEY, label)
    return label
  } catch {
    return 'Unknown device'
  }
}

/**
 * Records one caught error. Never throws itself - a logging failure
 * must never mask or replace the real error being reported, so this
 * swallows its own errors (with a console.error, the same fallback
 * every call site already had before this existed).
 *
 * @param {string} context - where this happened, e.g. "WSI save",
 *   "Reports page crash" - shown as the headline in the admin viewer.
 * @param {unknown} error - the caught error/exception.
 * @param {{name?: string, role?: string}} [user] - the currently logged-
 *   in staff user, if known at the call site (the PIN-based session
 *   lives only in React state - see AuthContext.jsx's own comment on
 *   why - so this must be passed in explicitly, it can't be read from
 *   anywhere global). Omitted (e.g. a crash before login) shows as
 *   "Not logged in" rather than blank, so it's still an answer, not a
 *   gap that looks like a bug in the log itself.
 */
export const logError = async (context, error, user) => {
  try {
    await db.errorLogs.add({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      context,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      userName: user?.nickname ?? user?.name ?? null,
      userRole: user?.role ?? null,
      deviceId: getDeviceId(),
      deviceLabel: getDeviceLabel(),
    })

    const count = await db.errorLogs.count()
    if (count > MAX_ENTRIES) {
      const oldest = await db.errorLogs.orderBy('timestamp').limit(count - MAX_ENTRIES).toArray()
      await db.errorLogs.bulkDelete(oldest.map((e) => e.id))
    }
  } catch (loggingErr) {
    console.error('[errorLog] failed to record error:', loggingErr)
  }
}
