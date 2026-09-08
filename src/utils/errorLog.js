// Records caught errors (form save/update/delete/void failures, and
// whole-page crashes caught by SectionErrorBoundary) to db.errorLogs,
// so an admin can actually see what went wrong after the fact - the
// user just sees a plain "Save failed" toast; the real technical detail
// (message, stack, which context) previously only ever went to
// console.error, invisible to anyone not standing at that exact device
// with DevTools open. errorLogs is a synced table (see dexie.js's own
// comment), so this is visible from any device, not just the one the
// error happened on.

import { db } from '../db/dexie.js'

// Keeps the table from growing without bound over the life of the app -
// old entries are pruned as new ones come in, well past what anyone
// would realistically need to scroll through in the admin viewer.
const MAX_ENTRIES = 300

/**
 * Records one caught error. Never throws itself - a logging failure
 * must never mask or replace the real error being reported, so this
 * swallows its own errors (with a console.error, the same fallback
 * every call site already had before this existed).
 *
 * @param {string} context - where this happened, e.g. "WSI save",
 *   "Reports page crash" - shown as the headline in the admin viewer.
 * @param {unknown} error - the caught error/exception.
 */
export const logError = async (context, error) => {
  try {
    await db.errorLogs.add({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      context,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
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
