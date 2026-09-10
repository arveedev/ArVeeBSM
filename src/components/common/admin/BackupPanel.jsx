// Backup Panel — two ways to get a full copy of every local Dexie
// table's contents, both a safety net independent of Dexie Cloud
// itself: an automatic daily commit to GitHub (see backupWorker.js /
// api/backup-to-github.js), and an on-demand download to this device.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Download, Cloud } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { logError } from '../../../utils/errorLog.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { primaryButtonClass } from './shared.js'

const GITHUB_BACKUPS_URL = 'https://github.com/arveedev/ArVeeBSM/tree/backups/backups'

function BackupPanel() {
  const { user } = useAuth()
  const [isExporting, setIsExporting] = useState(false)
  const [lastExportInfo, setLastExportInfo] = useState(null)
  const globalConfig = useLiveQuery(() => db.reportConfig.get('global'), [])
  const lastAutoBackupAt = globalConfig?.lastAutoBackupAt ?? null

  const handleExport = async () => {
    setIsExporting(true)
    try {
      // Reads the table list off `db.tables` itself instead of a
      // hardcoded array - a hardcoded list already went stale once
      // (customerAliases, userAliases, and errorLogs were all added to
      // the schema in later versions but never added here, so this
      // "full" export silently excluded them for a while without
      // anyone noticing, since the button still worked and still
      // produced a file). Reading it live means a future new table is
      // included automatically, with nothing to remember to update.
      const allTables = db.tables.map((t) => t.name)
      const dump = {}
      let totalRecords = 0
      for (const tableName of allTables) {
        const rows = await db.table(tableName).toArray()
        dump[tableName] = rows
        totalRecords += rows.length
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        databaseName: db.name,
        schemaVersion: db.verno,
        tables: dump,
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `bsm-backup-${stamp}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setLastExportInfo({ time: new Date(), tableCount: allTables.length, recordCount: totalRecords })
    } catch (err) {
      toast.error('Export failed — please try again')
      logError('Full database export', err, user)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-app-text">
          <Cloud size={16} className="text-brand-neon" /> Automatic Backup
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          A full copy of the database is committed automatically, about once a day, to
          this app's own GitHub repository (on its own dedicated "backups" branch, kept
          separate from the actual app code) - a copy that lives completely outside Dexie
          Cloud, so a serious problem there wouldn't be the only place the data exists.
          Runs quietly on any logged-in device; nobody needs to remember to do anything.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          {lastAutoBackupAt
            ? `Last automatic backup: ${new Date(lastAutoBackupAt).toLocaleString()}`
            : 'No automatic backup has run yet - the first one runs shortly after any user is logged in.'}
        </p>
        <a
          href={GITHUB_BACKUPS_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-brand-neon underline"
        >
          View backups on GitHub
        </a>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-app-text">Manual Export</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Downloads every table's full contents as a single JSON file right now, straight
          to this device - useful right before a risky change, without waiting for the
          automatic backup's own schedule.
        </p>

        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className={`mt-4 flex items-center justify-center gap-2 ${primaryButtonClass} disabled:opacity-50`}
        >
          <Download size={16} />
          {isExporting ? 'Exporting…' : 'Export All Data'}
        </button>

        {lastExportInfo && (
          <p className="mt-2 text-xs text-neutral-500">
            Last export: {lastExportInfo.tableCount} tables, {lastExportInfo.recordCount} total records,
            at {lastExportInfo.time.toLocaleTimeString()}.
          </p>
        )}
      </div>
    </div>
  )
}

export default BackupPanel
