// Rendered instead of the whole app when the local Dexie database
// itself fails to open (a corrupted IndexedDB, a browser storage quota
// issue, or a schema-migration upgrade function throwing partway
// through). Without this, main.jsx had no recovery path at all - a
// user hitting this would see a permanently blank/white screen on
// every reload, with no way to know what's wrong or what to do, since
// the failure happens before any React component (and its own error
// boundaries) ever gets to render.
import { AlertTriangle } from 'lucide-react'
import { db } from '../../db/dexie.js'

const DbOpenErrorScreen = ({ error }) => {
  const handleReset = async () => {
    const confirmed = window.confirm(
      'This clears this device\'s local app data and reloads. Data already ' +
      'backed up to the cloud (anything that finished syncing before) will ' +
      're-download automatically. Any change made on this device that never ' +
      'finished syncing will be lost. Continue?'
    )
    if (!confirmed) return
    try {
      await db.delete()
    } catch (deleteErr) {
      console.error('[DbOpenErrorScreen] Failed to delete local database:', deleteErr)
    }
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center text-app-text">
      <AlertTriangle size={32} className="text-brand-crimson" />
      <div className="max-w-sm">
        <p className="text-sm font-medium">The app's local database couldn't open.</p>
        <p className="mt-2 text-xs text-neutral-400">
          This usually clears up after a reset. Your warehouse data isn't lost -
          most of it already lives in the cloud and will re-download.
        </p>
        {error?.message && (
          <p className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-[11px] text-neutral-500">
            {error.message}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-xs text-neutral-300"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg bg-brand-crimson px-4 py-2 text-xs font-medium text-brand-contrast"
        >
          Reset local data &amp; reload
        </button>
      </div>
    </div>
  )
}

export default DbOpenErrorScreen
