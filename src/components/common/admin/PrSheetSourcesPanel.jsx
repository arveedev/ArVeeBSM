// PR Sheet Sources — the SDO Purchase Receipt "SUMMARY" backup lives in
// an entirely different set of spreadsheets ("PALAY DELIVERIES") than
// the WSR/WSI/ESR/ESI backups configured in Sheet Sources (those live as
// tabs inside the separate "CONTROL NUMBER" spreadsheet - confirmed
// directly with the user). This panel is deliberately its own table
// (db.prSheetSources), never sharing a record with db.sheetSources, so
// picking a URL here can never also redirect the CONTROL NUMBER backups
// or vice versa.
//
// PALAY DELIVERIES gets a fresh spreadsheet every MONTH (not every year
// like CONTROL NUMBER) - "add another month" is the normal way this
// list grows, so entries are grouped by year for easier scanning as the
// list gets long.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { todayLocalISO } from '../../../utils/calculations.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import CalendarDatePicker from '../CalendarDatePicker.jsx'
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
  summarySheetName: 'SUMMARY',
  dateFrom: '',
  dateTo: '',
}

function PrSheetSourcesPanel() {
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const sources = useLiveQuery(() => db.prSheetSources.toArray(), []) ?? []
  const sortedSources = [...sources].sort((a, b) => byAlpha(b.dateFrom, a.dateFrom))

  // Grouped by year (newest year first) purely for scanability - a
  // year with several months in it reads a lot easier than one long
  // flat list once a few years of PALAY DELIVERIES sources pile up.
  const groupedByYear = sortedSources.reduce((groups, s) => {
    const year = (s.dateFrom || '').slice(0, 4) || 'Undated'
    if (!groups[year]) groups[year] = []
    groups[year].push(s)
    return groups
  }, {})
  const years = Object.keys(groupedByYear).sort((a, b) => byAlpha(b, a))

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

    // Same overlap guard as Sheet Sources - which monthly PALAY
    // DELIVERIES source a PR backup lands in must never be ambiguous.
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
      summarySheetName: form.summarySheetName.trim() || 'SUMMARY',
      dateFrom: form.dateFrom,
      dateTo: form.dateTo || null,
    }

    await db.prSheetSources.put(payload)
    toast.success(editingId ? 'PR Sheet source updated' : 'PR Sheet source added')
    resetForm()
  }

  const handleEdit = (source) => {
    setEditingId(source.id)
    setForm({
      label: source.label,
      webAppUrl: source.webAppUrl,
      summarySheetName: source.summarySheetName ?? 'SUMMARY',
      dateFrom: source.dateFrom,
      dateTo: source.dateTo,
    })
  }

  const confirmDelete = async () => {
    await db.prSheetSources.delete(pendingDelete)
    if (editingId === pendingDelete) resetForm()
    setPendingDelete(null)
    toast.success('PR Sheet source deleted')
  }

  const isActiveToday = (source) => {
    const today = todayLocalISO()
    return source.dateFrom <= today && (!source.dateTo || today <= source.dateTo)
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">PR Sheet Sources (Palay Deliveries)</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Where SDO Purchase Receipts back up to - a different set of
        spreadsheets than Sheet Sources above. A fresh spreadsheet is
        typically created every month; add one entry per month here as
        needed. A Purchase Receipt lands in whichever entry's date range
        covers its underlying WSR's delivery date - ranges must not
        overlap.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Label</label>
          <input
            type="text"
            value={form.label}
            onChange={(e) => updateField('label', e.target.value)}
            className={inputClass}
            placeholder="e.g. 09 PALAY DELIVERIES SEPTEMBER"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Date From</label>
            <CalendarDatePicker value={form.dateFrom} onChange={(v) => updateField('dateFrom', v)} />
          </div>
          <div>
            <label className={labelClass}>Date To (optional)</label>
            <CalendarDatePicker value={form.dateTo} onChange={(v) => updateField('dateTo', v)} required={false} />
            <p className="mt-1 text-xs text-neutral-500">
              Leave blank if this is the current, ongoing month.
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
            The deployed Apps Script URL for THIS month's PALAY DELIVERIES
            spreadsheet - not the CONTROL NUMBER file's URL.
          </p>
        </div>

        <div>
          <label className={labelClass}>SUMMARY Sheet Name</label>
          <input
            type="text"
            value={form.summarySheetName}
            onChange={(e) => updateField('summarySheetName', e.target.value)}
            className={inputClass}
            placeholder="SUMMARY"
          />
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
            {editingId ? 'Update' : 'Add Month'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {years.length > 0 && (
        <div className="mt-4 space-y-4">
          {years.map((year) => (
            <div key={year}>
              <p className="mb-2 text-xs font-semibold uppercase text-neutral-500">{year}</p>
              <ul className="space-y-2">
                {groupedByYear[year].map((s) => (
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
                    </div>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => handleEdit(s)} aria-label="Edit" className={editIconClass}>
                        <Pencil size={20} />
                      </button>
                      <button type="button" onClick={() => setPendingDelete(s.id)} aria-label="Delete" className={deleteIconClass}>
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this PR sheet source?"
        description="This cannot be undone. Purchase Receipts already backed up to it are unaffected."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default PrSheetSourcesPanel
