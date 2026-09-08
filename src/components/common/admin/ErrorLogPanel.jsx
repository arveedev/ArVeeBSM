// Error Log — admin-browsable record of errors the app actually caught
// (form save/update/delete/void failures, and whole-page crashes caught
// by SectionErrorBoundary; see utils/errorLog.js). The user only ever
// sees a plain "Save failed" toast; this is where the real technical
// detail (message, stack, which device/context) actually lives. Synced
// like any other real data, so an entry from any device shows up here
// regardless of which one you're currently on.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { dangerButtonClass } from './shared.js'

function fmtTimestamp(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function ErrorLogPanel() {
  const entries = useLiveQuery(
    () => db.errorLogs.orderBy('timestamp').reverse().toArray(),
    []
  ) ?? []

  const [expandedId, setExpandedId] = useState(null)
  const [pendingClearAll, setPendingClearAll] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)

  const handleConfirmClearAll = async () => {
    setPendingClearAll(false)
    await db.errorLogs.clear()
  }

  const handleConfirmDelete = async () => {
    const id = pendingDeleteId
    setPendingDeleteId(null)
    await db.errorLogs.delete(id)
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-app-text">Error Log</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Every error the app actually caught - a failed save/update/delete/void, or a page that
            crashed - with the real technical detail behind whatever plain message the user saw.
            Shared across every device, not just this one.
          </p>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => setPendingClearAll(true)}
            className={`${dangerButtonClass} shrink-0`}
          >
            Clear All
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="mt-4 text-center text-xs text-neutral-500">
          No errors recorded. This list stays empty as long as nothing goes wrong.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => {
            const isExpanded = expandedId === entry.id
            return (
              <li key={entry.id} className="rounded-xl border border-neutral-800 bg-neutral-950">
                <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="flex flex-1 items-start gap-2 px-3 py-2.5 text-left"
                  >
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-brand-crimson" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-app-text">{entry.context}</span>
                        {isExpanded ? <ChevronDown size={14} className="shrink-0 text-neutral-500" /> : <ChevronRight size={14} className="shrink-0 text-neutral-500" />}
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-500">{fmtTimestamp(entry.timestamp)}</p>
                      <p className="mt-1 break-words text-xs text-neutral-400">{entry.message}</p>
                      {isExpanded && entry.stack && (
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-900 p-2 text-[10px] leading-tight text-neutral-500">
                          {entry.stack}
                        </pre>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(entry.id)}
                    aria-label="Delete this entry"
                    className="flex w-10 shrink-0 items-center justify-center border-l border-neutral-800 text-neutral-600 transition-colors hover:text-brand-crimson"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingClearAll}
        icon={AlertTriangle}
        title="Clear the entire error log?"
        description={`This deletes all ${entries.length} recorded entr${entries.length === 1 ? 'y' : 'ies'} on every device - it doesn't undo whatever originally went wrong, only the record of it.`}
        confirmLabel="Clear All"
        onConfirm={handleConfirmClearAll}
        onCancel={() => setPendingClearAll(false)}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this log entry?"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}

export default ErrorLogPanel
