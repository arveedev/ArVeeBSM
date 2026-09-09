// Backup Panel — exports every local Dexie table's full contents to a
// single downloadable JSON file. Built specifically as a safety net
// before reconnecting Dexie Cloud: whatever happens with that
// connection, this gives a recovery path independent of it.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Download } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { logError } from '../../../utils/errorLog.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { primaryButtonClass } from './shared.js'

function BackupPanel() {
  const { user } = useAuth()
  const [isExporting, setIsExporting] = useState(false)
  const [lastExportInfo, setLastExportInfo] = useState(null)

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
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-sm font-semibold text-app-text">Backup &amp; Export</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Downloads every table's full contents as a single JSON file - a complete,
        independent copy of everything currently in this device's local database.
        Since almost every table syncs to the cloud, this device's copy is normally
        as complete as the cloud's own - worth doing before any risky change, or on
        a regular schedule if you want your own offline copy independent of both.
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
  )
}

export default BackupPanel
