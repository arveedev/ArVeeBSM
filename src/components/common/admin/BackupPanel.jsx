// Backup Panel — exports every local Dexie table's full contents to a
// single downloadable JSON file. Built specifically as a safety net
// before reconnecting Dexie Cloud: whatever happens with that
// connection, this gives a recovery path independent of it.

import { useState } from 'react'
import { Download } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { primaryButtonClass } from './shared.js'

// Every table currently defined in the local schema (see db/dexie.js).
const ALL_TABLES = [
  'authorities', 'branches', 'customers', 'googleSheetsConfig',
  'millingOrders', 'pendingSheetDeletions', 'pileLayoutBoxes', 'piles', 'provinces',
  'privateMillerAllocations', 'reportConfig', 'ricemillAllocations',
  'sackInventory', 'sackTypes', 'serialCounterCache', 'settings',
  'sheetSources', 'signatories', 'transactionTypes', 'transactions',
  'users', 'varietyTypes', 'warehouseAliases', 'warehouses',
]

function BackupPanel() {
  const [isExporting, setIsExporting] = useState(false)
  const [lastExportInfo, setLastExportInfo] = useState(null)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const dump = {}
      let totalRecords = 0
      for (const tableName of ALL_TABLES) {
        const rows = await db.table(tableName).toArray()
        dump[tableName] = rows
        totalRecords += rows.length
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        databaseName: db.name,
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

      setLastExportInfo({ time: new Date(), tableCount: ALL_TABLES.length, recordCount: totalRecords })
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
