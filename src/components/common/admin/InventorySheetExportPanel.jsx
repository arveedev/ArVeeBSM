// Sheet Export - Admin only. Where the Inventory Reports' "Google Sheet" button
// sends its tables: the web app URL of the separate Apps Script attached to the
// NEW reporting spreadsheet (see docs/inventory-sheet-export-setup.md). It never
// points at the AI/SIA or backup sheets. Stored on the shared reportConfig record.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { postInventorySheet } from '../../../services/inventorySheetExport.js'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from './shared.js'

function InventorySheetExportPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const saved = config?.inventorySheet
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [info, setInfo] = useState(null)

  useEffect(() => { setUrl(saved?.webAppUrl ?? ''); setToken(saved?.token ?? '') }, [saved?.webAppUrl, saved?.token])

  const persist = async (extra = {}) => {
    const next = { webAppUrl: url.trim(), token: token.trim(), spreadsheetUrl: saved?.spreadsheetUrl ?? '', ...extra }
    const cur = await db.reportConfig.get('global')
    if (cur) await db.reportConfig.update('global', { inventorySheet: next })
    else await db.reportConfig.put({ id: 'global', inventorySheet: next })
  }

  const save = async () => {
    setBusy('save')
    try { await persist(); toast.success('Saved') } catch (err) { console.error(err); toast.error('Could not save') } finally { setBusy('') }
  }

  const test = async () => {
    setBusy('test')
    setInfo(null)
    try {
      const res = await postInventorySheet({ webAppUrl: url, token }, 'ping')
      if (res.ok) {
        setInfo({ ok: true, name: res.name, spreadsheetUrl: res.spreadsheetUrl })
        await persist({ spreadsheetUrl: res.spreadsheetUrl ?? '' })
        toast.success('Connected')
      } else {
        setInfo({ ok: false, message: res.message ?? (res.reason === 'not_configured' ? 'Paste the web app URL first.' : 'Could not reach the web app. Check the URL and that access is set to Anyone.') })
      }
    } finally { setBusy('') }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Sheet Export</h2>
      <p className="mt-1 text-xs text-neutral-400">
        The Inventory Reports "Google Sheet" button sends its tables to a separate reporting spreadsheet through its own Apps Script.
        Setup steps are in docs/inventory-sheet-export-setup.md. Try it on a copy of the spreadsheet first.
      </p>
      <label className={`mt-3 block ${labelClass}`}>Web app URL
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} placeholder="https://script.google.com/macros/s/.../exec" />
      </label>
      <label className={`mt-3 block ${labelClass}`}>Token (only if you set EXPORT_TOKEN in the script)
        <input type="text" value={token} onChange={(e) => setToken(e.target.value)} className={inputClass} placeholder="Optional" />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={test} disabled={!!busy || !url.trim()} className={`flex-1 ${secondaryButtonClass} disabled:opacity-40`}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        <button type="button" onClick={save} disabled={!!busy} className={`flex-1 ${primaryButtonClass} disabled:opacity-40`}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>
      {info && (
        <p className={`mt-3 break-words rounded-xl border p-3 text-sm ${info.ok ? 'border-emerald-700 text-emerald-300' : 'border-brand-crimson/50 text-brand-crimson'}`}>
          {info.ok ? <>Connected to "{info.name}". <a className="underline" href={info.spreadsheetUrl} target="_blank" rel="noreferrer">Open the spreadsheet</a></> : info.message}
        </p>
      )}
      {!info && saved?.spreadsheetUrl && (
        <p className="mt-3 text-xs text-neutral-500">Reporting spreadsheet: <a className="underline" href={saved.spreadsheetUrl} target="_blank" rel="noreferrer">open</a></p>
      )}
    </section>
  )
}

export default InventorySheetExportPanel
