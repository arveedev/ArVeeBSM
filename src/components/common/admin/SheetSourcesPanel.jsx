// Sheet Sources — supports more than one Google Sheets spreadsheet at
// once, each authoritative for a specific date range. The user creates a
// fresh spreadsheet copy every year rather than letting one sheet grow
// unbounded forever, so a single fixed URL/date-range config can't work -
// a sync or report spanning a year boundary (e.g. Dec 20 - Jan 10) needs
// to query every source whose range overlaps and merge the results.
//
// Each source has its own Web App URL and sheet names, since a fresh
// yearly spreadsheet may use different sheet names or even a different
// Apps Script deployment entirely.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { todayLocalISO } from '../../../utils/calculations.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  listItemClass,
  editIconClass,
  deleteIconClass,
  byAlpha,
} from './shared.js'

const emptyForm = {
  label: '',
  webAppUrl: '',
  aiSheetName: 'AI',
  siaSheetName: 'SIA',
  receiptsSheetName: 'DATA_ENTRY',
  issuesSheetName: 'Issues Backup',
  sacksReceiptsSheetName: 'Sacks Receipts Backup',
  sacksIssuesSheetName: 'Sacks Issues Backup',
  dateFrom: '',
  dateTo: '',
}

function SheetSourcesPanel() {
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const sources = useLiveQuery(() => db.sheetSources.toArray(), []) ?? []
  const sortedSources = [...sources].sort((a, b) => byAlpha(b.dateFrom, a.dateFrom))

  const updateField = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!form.label.trim() || !form.webAppUrl.trim() || !form.dateFrom) {
      toast.error('Label and Web App URL are required, and a start date')
      return
    }
    if (form.dateTo && form.dateFrom > form.dateTo) {
      toast.error('Date From must be before Date To')
      return
    }
    try {
      new URL(form.webAppUrl.trim())
    } catch {
      toast.error('Enter a valid URL')
      return
    }

    // Overlapping date ranges would make "which source covers this date"
    // ambiguous - block it rather than let a sync silently pick one
    // arbitrarily or double-query. A blank Date To means "open-ended,
    // still current" - treated as extending indefinitely for this check.
    const OPEN_ENDED = '9999-12-31'
    const newDateTo = form.dateTo || OPEN_ENDED
    const overlapping = sources.find((s) => {
      if (s.id === editingId) return false
      const existingDateTo = s.dateTo || OPEN_ENDED
      return form.dateFrom <= existingDateTo && s.dateFrom <= newDateTo
    })
    if (overlapping) {
      toast.error(`Date range overlaps with "${overlapping.label}" - give the older source an end date first`)
      return
    }

    const payload = {
      id: editingId ?? crypto.randomUUID(),
      label: form.label.trim(),
      webAppUrl: form.webAppUrl.trim(),
      aiSheetName: form.aiSheetName.trim() || 'AI',
      siaSheetName: form.siaSheetName.trim() || 'SIA',
      receiptsSheetName: form.receiptsSheetName.trim() || 'DATA_ENTRY',
      issuesSheetName: form.issuesSheetName.trim() || 'Issues Backup',
      sacksReceiptsSheetName: form.sacksReceiptsSheetName.trim() || 'Sacks Receipts Backup',
      sacksIssuesSheetName: form.sacksIssuesSheetName.trim() || 'Sacks Issues Backup',
      dateFrom: form.dateFrom,
      dateTo: form.dateTo || null,
      lastSyncedAt: editingId ? sources.find((s) => s.id === editingId)?.lastSyncedAt ?? null : null,
    }

    await db.sheetSources.put(payload)
    toast.success(editingId ? 'Sheet source updated' : 'Sheet source added')
    resetForm()
  }

  const handleEdit = (source) => {
    setEditingId(source.id)
    setForm({
      label: source.label,
      webAppUrl: source.webAppUrl,
      aiSheetName: source.aiSheetName,
      siaSheetName: source.siaSheetName,
      receiptsSheetName: source.receiptsSheetName,
      issuesSheetName: source.issuesSheetName,
      sacksReceiptsSheetName: source.sacksReceiptsSheetName,
      sacksIssuesSheetName: source.sacksIssuesSheetName,
      dateFrom: source.dateFrom,
      dateTo: source.dateTo,
    })
  }

  const confirmDelete = async () => {
    await db.sheetSources.delete(pendingDelete)
    if (editingId === pendingDelete) resetForm()
    setPendingDelete(null)
    toast.success('Sheet source deleted')
  }

  const isActiveToday = (source) => {
    const today = todayLocalISO()
    return source.dateFrom <= today && (!source.dateTo || today <= source.dateTo)
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Sheet Sources</h2>
      <p className="mt-1 text-xs text-neutral-400">
        One entry per spreadsheet year (or however your Sheets are split).
        A sync or report automatically uses whichever source(s) actually
        cover the date range it needs - date ranges must not overlap.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Label</label>
          <input
            type="text"
            value={form.label}
            onChange={(e) => updateField('label', e.target.value)}
            className={inputClass}
            placeholder="Just a name for you, e.g. 2026 Ledger"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Date From</label>
            <input
              type="date"
              value={form.dateFrom}
              onChange={(e) => updateField('dateFrom', e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className={`${inputClass} cursor-pointer`}
            />
            <p className="mt-1 text-xs text-neutral-500">
              Data before this date is ignored - use this to skip old
              tests/experiments in the sheet.
            </p>
          </div>
          <div>
            <label className={labelClass}>Date To (optional)</label>
            <input
              type="date"
              value={form.dateTo}
              onChange={(e) => updateField('dateTo', e.target.value)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className={`${inputClass} cursor-pointer`}
            />
            <p className="mt-1 text-xs text-neutral-500">
              Leave blank for your current, ongoing sheet - only set this
              when archiving a past year after adding its replacement.
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass}>Apps Script Web App URL</label>
          <input
            type="text"
            value={form.webAppUrl}
            onChange={(e) => updateField('webAppUrl', e.target.value)}
            className={inputClass}
            placeholder="https://script.google.com/macros/s/…/exec"
          />
          <p className="mt-1 text-xs text-neutral-500">
            The deployed Apps Script URL, not the spreadsheet's own link -
            this is what actually lets the app read/write the sheet.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>AI Sheet Name</label>
            <input type="text" value={form.aiSheetName} onChange={(e) => updateField('aiSheetName', e.target.value)} className={inputClass} placeholder="AI" />
          </div>
          <div>
            <label className={labelClass}>SIA Sheet Name</label>
            <input type="text" value={form.siaSheetName} onChange={(e) => updateField('siaSheetName', e.target.value)} className={inputClass} placeholder="SIA" />
          </div>
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <p className="text-xs font-semibold uppercase text-neutral-500">Backup Log Sheet Names</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Receipts (WSR)</label>
            <input type="text" value={form.receiptsSheetName} onChange={(e) => updateField('receiptsSheetName', e.target.value)} className={inputClass} placeholder="DATA_ENTRY" />
          </div>
          <div>
            <label className={labelClass}>Issues (WSI)</label>
            <input type="text" value={form.issuesSheetName} onChange={(e) => updateField('issuesSheetName', e.target.value)} className={inputClass} placeholder="Issues Backup" />
          </div>
          <div>
            <label className={labelClass}>Sacks Receipts (ESR)</label>
            <input type="text" value={form.sacksReceiptsSheetName} onChange={(e) => updateField('sacksReceiptsSheetName', e.target.value)} className={inputClass} placeholder="Sacks Receipts Backup" />
          </div>
          <div>
            <label className={labelClass}>Sacks Issues (ESI)</label>
            <input type="text" value={form.sacksIssuesSheetName} onChange={(e) => updateField('sacksIssuesSheetName', e.target.value)} className={inputClass} placeholder="Sacks Issues Backup" />
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
            {editingId ? 'Update' : 'Add Source'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {sortedSources.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sortedSources.map((s) => (
            <li key={s.id} className={listItemClass}>
              <div>
                <p className="flex items-center gap-2 font-medium text-app-text">
                  {s.label}
                  {isActiveToday(s) && (
                    <span className="rounded-full bg-brand-neon/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand-neon">
                      Active
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-400">{s.dateFrom} to {s.dateTo || 'onward'}</p>
                <p className="text-xs text-neutral-500">
                  Last synced: {s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'Never'}
                </p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => handleEdit(s)} aria-label="Edit" className={editIconClass}>
                  <Pencil size={18} />
                </button>
                <button type="button" onClick={() => setPendingDelete(s.id)} aria-label="Delete" className={deleteIconClass}>
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this sheet source?"
        description="This cannot be undone. Authority data already synced from it stays in the app."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default SheetSourcesPanel
