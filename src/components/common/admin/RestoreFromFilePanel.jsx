// Admin > Data Care > Backup > "Restore this PC from a backup file". Works with no internet.
// Insert-only: adds the records this PC is missing; never deletes or overwrites (see utils/deviceRestore.js).
import { useState } from 'react'
import toast from 'react-hot-toast'
import { RotateCcw, FileCheck2, TriangleAlert } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { logError } from '../../../utils/errorLog.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import { checkAnyBackup, planRestore, applyRestore, restorePhrase, databaseIdOf } from '../../../utils/deviceRestore.js'
import { listLocalBackupFiles, readLocalBackupText } from '../../../services/deviceBackup.js'
import { primaryButtonClass } from './shared.js'

const readFileText = async (file) => {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (head[0] === 0x1f && head[1] === 0x8b) return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return file.text()
}

const num = (n) => Number(n).toLocaleString('en-US')

function RestoreFromFilePanel() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState('')
  const [check, setCheck] = useState(null)   // { parsed, plan }
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [localFiles, setLocalFiles] = useState(null)

  const thisDbId = databaseIdOf(db.cloud?.options?.databaseUrl)

  const reset = () => { setCheck(null); setError(''); setTyped(''); setProgress(null); setResult(null) }

  const loadText = async (label, getText) => {
    reset(); setBusy(true); setSource(label)
    try {
      const parsed = await checkAnyBackup(await getText())
      if (!parsed.ok) { setError(`This file cannot be used: ${parsed.problems.join('; ')}`); return }
      setCheck({ parsed, plan: await planRestore(db, parsed, thisDbId) })
    } catch (e) {
      setError(`Could not read the file: ${e?.message ?? e}`)
      logError('Restore from file (read)', e, user)
    } finally { setBusy(false) }
  }

  const pickFile = (e) => { const f = e.target.files?.[0]; if (f) loadText(f.name, () => readFileText(f)); e.target.value = '' }

  const showLocal = async () => {
    try { setLocalFiles(await listLocalBackupFiles()) } catch (e) { setLocalFiles([]); setError(`Could not open this PC's backup folder: ${e?.message ?? e}`) }
  }

  const plan = check?.plan
  const meta = check?.parsed?.meta
  const total = plan?.diff?.totalMissing ?? 0
  const phrase = restorePhrase(total)
  const tablesWithMissing = plan ? Object.entries(plan.diff.perTable).filter(([, r]) => r.missing > 0 || r.different > 0) : []
  const waiting = meta?.pending ? Object.values(meta.pending).reduce((a, b) => a + b, 0) : 0

  const doRestore = async () => {
    if (typed.trim() !== phrase) { setError(`Type exactly: ${phrase}`); return }
    setError(''); setBusy(true)
    try {
      const res = await applyRestore(db, plan.diff.missing, (done, all) => setProgress({ done, all }))
      setResult(res)
      toast.success(`${num(res.added)} records restored on this PC`)
    } catch (e) {
      setError(`The restore stopped: ${e?.message ?? e}. Nothing was deleted.`)
      logError('Restore from file (apply)', e, user)
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-app-text"><RotateCcw size={16} className="text-brand-neon" /> Restore this PC from a backup file</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Use this when this PC lost or damaged its data, or when it is a replacement PC. It works with no internet. It only ADDS the records this PC is missing,
        it never deletes anything, and a record that differs from the file is listed and left alone. When the PC is back online it syncs normally.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-app-text hover:border-neutral-500">
          Choose a backup file
          <input type="file" accept=".gz,.json,application/json,application/gzip" className="hidden" onChange={pickFile} disabled={busy} />
        </label>
        <button type="button" onClick={showLocal} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-app-text hover:border-neutral-500">
          Use a file from this PC&rsquo;s backup folder
        </button>
      </div>

      {localFiles && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-800">
          {localFiles.length === 0 ? <p className="p-2 text-xs text-neutral-500">No backup files found in this PC&rsquo;s backup folder.</p> : localFiles.slice(0, 45).map((f) => (
            <button key={f.name} type="button" onClick={() => loadText(f.name, () => readLocalBackupText(f.handle))} className="block w-full border-b border-neutral-800 px-2 py-1.5 text-left text-xs text-app-text last:border-0 hover:bg-neutral-800">{f.name}</button>
          ))}
        </div>
      )}

      {busy && !progress && <p className="mt-3 text-xs text-neutral-400">Checking the file&hellip;</p>}
      {error && <p className="mt-3 flex items-start gap-2 text-xs text-brand-amber"><TriangleAlert size={14} className="mt-0.5 shrink-0" /> {error}</p>}

      {check && !result && (
        <div className="mt-3 space-y-3 text-xs">
          <div className="rounded-lg bg-neutral-950 p-3 text-neutral-300">
            <div className="flex items-center gap-2 font-medium text-brand-neon"><FileCheck2 size={14} /> File check passed{check.parsed.kind === 'export' ? ' (older export: it has no checksum)' : ''}</div>
            <div className="mt-1 text-neutral-400">
              {source}{meta?.deviceName ? ` · from ${meta.deviceName}` : ''}{meta?.user ? ` · ${meta.user}` : ''}{meta?.exportedAt ? ` · saved ${new Date(meta.exportedAt).toLocaleString()}` : ''}{meta?.appVersion ? ` · app ${meta.appVersion}` : ''}
            </div>
            {waiting > 0 && <div className="mt-1 text-brand-amber">That device still had {num(waiting)} entries waiting to send when this file was saved, so this file may hold entries the cloud never received.</div>}
          </div>

          {plan.blocked ? (
            <p className="flex items-start gap-2 text-brand-amber"><TriangleAlert size={14} className="mt-0.5 shrink-0" /> {plan.blocked}</p>
          ) : (
            <>
              <div className="text-neutral-300">
                <span className="font-medium text-app-text">{num(total)}</span> records are in the file but missing on this PC.{' '}
                {plan.diff.totalDifferent > 0 && <>{num(plan.diff.totalDifferent)} records exist on both but differ; they will be left exactly as they are. </>}
                {plan.unknownTables.length > 0 && <>Tables this app version does not have are skipped: {plan.unknownTables.join(', ')}.</>}
              </div>
              {tablesWithMissing.length > 0 && (
                <div className="max-h-44 overflow-y-auto rounded-lg border border-neutral-800">
                  {tablesWithMissing.map(([t, r]) => (
                    <div key={t} className="flex justify-between gap-3 border-b border-neutral-800 px-2 py-1.5 last:border-0"><span className="text-app-text">{t}</span><span className="text-neutral-400">{num(r.missing)} to add{r.different ? `, ${num(r.different)} differ` : ''}</span></div>
                  ))}
                </div>
              )}
              {total === 0 ? <p className="text-neutral-400">This PC already has everything in the file. Nothing to restore.</p> : (
                <div>
                  <label className="text-neutral-400">To confirm, type exactly: <span className="font-mono text-app-text">{phrase}</span></label>
                  <input value={typed} onChange={(e) => { setTyped(e.target.value); setError('') }} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-app-text" placeholder={phrase} autoComplete="off" />
                  <button type="button" onClick={doRestore} disabled={busy} className={`mt-3 ${primaryButtonClass} disabled:opacity-50`}>{busy ? 'Restoring…' : `Restore ${num(total)} records`}</button>
                  {progress && <p className="mt-2 text-neutral-400">{num(progress.done)} of {num(progress.all)} records processed</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">
          <div className="font-medium text-brand-neon">Restore finished</div>
          <div className="mt-1">{num(result.added)} records added{result.failed ? `; ${num(result.failed)} were already present (they appeared while restoring) and were left as they are` : ''}. Nothing was deleted or changed. Totals are recalculated by the app now.</div>
          <button type="button" onClick={reset} className="mt-2 text-brand-neon underline">Done</button>
        </div>
      )}
    </div>
  )
}

export default RestoreFromFilePanel
