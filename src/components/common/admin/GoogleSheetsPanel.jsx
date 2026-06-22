// Google Sheets — Phase 6 bridge configuration. One Apps Script Web App
// URL (the user's EXISTING script — this app does not deploy its own)
// fronts a spreadsheet with separate named sheets for AI allocations, SIA
// allocations, and four backup logs (Receipts/WSR, Issues/WSI, Sacks
// Receipts/ESR, Sacks Issues/ESI). The admin can change the URL or any
// sheet name at any time; a manual "Sync Now" button pulls fresh AI/SIA
// data immediately (the app also retries this automatically in the
// background — see src/services/syncWorker.js).

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { saveSheetsConfig, syncAuthoritiesFromSheets } from '../../../services/googleSheetsBridge.js'
import { inputClass, labelClass, primaryButtonClass } from './shared.js'

const emptyForm = {
  webAppUrl: '',
  aiSheetName: 'AI',
  siaSheetName: 'SIA',
  receiptsSheetName: 'DATA_ENTRY',
  issuesSheetName: 'Issues Backup',
  sacksReceiptsSheetName: 'Sacks Receipts Backup',
  sacksIssuesSheetName: 'Sacks Issues Backup',
}

function GoogleSheetsPanel() {
  const [form, setForm] = useState(emptyForm)
  const [isSyncing, setIsSyncing] = useState(false)

  const config = useLiveQuery(() => db.googleSheetsConfig.get('global'), [])

  useEffect(() => {
    if (!config) return
    setForm({
      webAppUrl: config.webAppUrl ?? '',
      aiSheetName: config.aiSheetName ?? 'AI',
      siaSheetName: config.siaSheetName ?? 'SIA',
      receiptsSheetName: config.receiptsSheetName ?? 'DATA_ENTRY',
      issuesSheetName: config.issuesSheetName ?? 'Issues Backup',
      sacksReceiptsSheetName: config.sacksReceiptsSheetName ?? 'Sacks Receipts Backup',
      sacksIssuesSheetName: config.sacksIssuesSheetName ?? 'Sacks Issues Backup',
    })
  }, [config])

  const updateField = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const handleSave = async () => {
    if (form.webAppUrl.trim()) {
      try {
        new URL(form.webAppUrl.trim())
      } catch {
        toast.error('Enter a valid URL')
        return
      }
    }

    await saveSheetsConfig({
      webAppUrl: form.webAppUrl.trim(),
      aiSheetName: form.aiSheetName.trim() || 'AI',
      siaSheetName: form.siaSheetName.trim() || 'SIA',
      receiptsSheetName: form.receiptsSheetName.trim() || 'DATA_ENTRY',
      issuesSheetName: form.issuesSheetName.trim() || 'Issues Backup',
      sacksReceiptsSheetName: form.sacksReceiptsSheetName.trim() || 'Sacks Receipts Backup',
      sacksIssuesSheetName: form.sacksIssuesSheetName.trim() || 'Sacks Issues Backup',
    })
    toast.success('Google Sheets configuration saved')
  }

  const handleSyncNow = async () => {
    if (!form.webAppUrl.trim()) {
      toast.error('Set a Web App URL first')
      return
    }

    setIsSyncing(true)
    const result = await syncAuthoritiesFromSheets()
    setIsSyncing(false)

    if (result.ok) {
      toast.success(`Synced ${result.aiCount} AI and ${result.siaCount} SIA record(s)`)
    } else if (result.reason === 'offline') {
      toast.error('No connection — will retry automatically once online')
    } else if (result.reason === 'not_configured') {
      toast.error('Save a Web App URL first')
    } else {
      toast.error('Sync failed — check the Web App URL and try again')
    }
  }

  const lastSyncedLabel = config?.lastSyncedAt
    ? new Date(config.lastSyncedAt).toLocaleString()
    : 'Never'

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-white">Google Sheets</h2>
      <p className="mt-1 text-xs text-neutral-400">
        This points at your EXISTING Apps Script Web App — the app does not
        deploy or generate its own script. One URL fronts a spreadsheet
        with separate sheets for AI allocations, SIA allocations, and four
        backup logs (one per document type). The URL and every sheet name
        can be changed at any time.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Apps Script Web App URL</label>
          <input
            type="text"
            value={form.webAppUrl}
            onChange={(e) => updateField('webAppUrl', e.target.value)}
            className={inputClass}
            placeholder="https://script.google.com/macros/s/…/exec"
          />
        </div>

        <div>
          <label className={labelClass}>AI Sheet Name</label>
          <input
            type="text"
            value={form.aiSheetName}
            onChange={(e) => updateField('aiSheetName', e.target.value)}
            className={inputClass}
            placeholder="AI"
          />
        </div>

        <div>
          <label className={labelClass}>SIA Sheet Name</label>
          <input
            type="text"
            value={form.siaSheetName}
            onChange={(e) => updateField('siaSheetName', e.target.value)}
            className={inputClass}
            placeholder="SIA"
          />
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <p className="text-xs font-semibold uppercase text-neutral-500">Backup Logs</p>
          <p className="mt-1 text-xs text-neutral-500">
            One row appended per saved transaction, split by document type.
          </p>
        </div>

        <div>
          <label className={labelClass}>Receipts Sheet Name (WSR)</label>
          <input
            type="text"
            value={form.receiptsSheetName}
            onChange={(e) => updateField('receiptsSheetName', e.target.value)}
            className={inputClass}
            placeholder="DATA_ENTRY"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Your existing receipts sheet — rows are appended in its current
            column shape, nothing is restructured.
          </p>
        </div>

        <div>
          <label className={labelClass}>Issues Sheet Name (WSI)</label>
          <input
            type="text"
            value={form.issuesSheetName}
            onChange={(e) => updateField('issuesSheetName', e.target.value)}
            className={inputClass}
            placeholder="Issues Backup"
          />
        </div>

        <div>
          <label className={labelClass}>Sacks Receipts Sheet Name (ESR)</label>
          <input
            type="text"
            value={form.sacksReceiptsSheetName}
            onChange={(e) => updateField('sacksReceiptsSheetName', e.target.value)}
            className={inputClass}
            placeholder="Sacks Receipts Backup"
          />
        </div>

        <div>
          <label className={labelClass}>Sacks Issues Sheet Name (ESI)</label>
          <input
            type="text"
            value={form.sacksIssuesSheetName}
            onChange={(e) => updateField('sacksIssuesSheetName', e.target.value)}
            className={inputClass}
            placeholder="Sacks Issues Backup"
          />
        </div>

        <button type="button" onClick={handleSave} className={`w-full ${primaryButtonClass}`}>
          Save
        </button>

        <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          <div>
            <p className="text-xs text-neutral-400">Last synced (AI/SIA)</p>
            <p className="text-xs text-neutral-500">{lastSyncedLabel}</p>
          </div>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={isSyncing}
            className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-white active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>
    </section>
  )
}

export default GoogleSheetsPanel
