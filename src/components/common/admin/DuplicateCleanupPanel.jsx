// Duplicate Cleanup - Admin only. Finds serials held twice in one warehouse
// (old Sheet-import copies). Scan is read-only; Apply removes only bare
// placeholder copies after saving a snapshot file, and never touches the
// Google Sheet. See utils/duplicateCleanup.js for the exact safety rules.

import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { scanDuplicates, applyDuplicateCleanup, restoreSnapshot } from '../../../utils/duplicateCleanup.js'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from './shared.js'

const TRIAL_SIZE = 20

function DuplicateCleanupPanel() {
  const [result, setResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [confirm, setConfirm] = useState(null) // { groups, label }
  const [trialSize, setTrialSize] = useState(TRIAL_SIZE)
  const fileRef = useRef(null)

  const handleScan = async () => {
    setScanning(true)
    try {
      setResult(await scanDuplicates())
    } catch (err) {
      console.error(err)
      toast.error('Scan failed - check console')
    } finally {
      setScanning(false)
    }
  }

  const handleApply = async () => {
    const { groups } = confirm
    setConfirm(null)
    setBusy(true)
    setProgress(0)
    try {
      const { removed } = await applyDuplicateCleanup(groups, setProgress)
      toast.success(`Removed ${removed} duplicate record${removed === 1 ? '' : 's'}. Snapshot file saved to Downloads.`)
      setResult(await scanDuplicates())
    } catch (err) {
      console.error(err)
      toast.error('Stopped part-way - scan again to see what remains. The snapshot file already saved can restore anything removed.')
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const n = await restoreSnapshot(file)
      toast.success(`Restored ${n} record${n === 1 ? '' : 's'} from the snapshot`)
      setResult(null)
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const trialGroups = result ? result.auto.slice(0, Math.max(1, Math.min(Number(trialSize) || TRIAL_SIZE, result.auto.length))) : []

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Duplicate Cleanup</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Finds a serial number held two or more times in the same warehouse. Only empty Sheet-import placeholder
        copies from before the cutoff are ever removed, and only when they conflict with nothing in the copy that
        stays. Everything else is listed for you to review and is never changed here. Before any removal a snapshot
        file of the removed records is saved to your Downloads; Restore puts them back. The Google Sheet is not touched.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={handleScan} disabled={scanning || busy} className={`${secondaryButtonClass} disabled:opacity-40`}>
          {scanning ? 'Scanning…' : 'Scan (read-only)'}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={`${secondaryButtonClass} disabled:opacity-40`}>
          Restore from snapshot file
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleRestore} />
      </div>

      {busy && <p className="mt-3 text-sm text-neutral-300">Working… {progress > 0 ? `${progress} removed so far` : ''} Keep this page open.</p>}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-app-text">
            <p><span className="font-semibold">{result.totals.auto}</span> serials are safe to clean ({result.totals.autoRemove} extra copies).</p>
            <p><span className="font-semibold">{result.totals.manual}</span> serials need your review and will not be touched.</p>
          </div>

          {result.auto.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-app-text">Safe to clean</h3>
              <label className={`${labelClass} mt-2 block`}>
                Trial size (groups)
                <input type="number" min="1" value={trialSize} onChange={(e) => setTrialSize(e.target.value)} className={inputClass} />
              </label>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs text-neutral-400">
                {trialGroups.map((g) => (
                  <li key={g.key} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5">
                    <span className="font-semibold text-app-text">{g.type} {g.serialNo}</span> · {g.warehouse} · {g.keeper.date} · keeps 1, removes {g.remove.length}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => setConfirm({ groups: trialGroups, label: `the first ${trialGroups.length} listed` })} className={`${primaryButtonClass} disabled:opacity-40`}>
                  Clean {trialGroups.length} (trial)
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm({ groups: result.auto, label: `all ${result.auto.length}` })} className={`${secondaryButtonClass} disabled:opacity-40`}>
                  Clean all {result.auto.length}
                </button>
              </div>
            </div>
          )}

          {result.manual.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-app-text">Needs your review (not changed)</h3>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs text-neutral-400">
                {result.manual.map((g) => (
                  <li key={g.key} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5">
                    <span className="font-semibold text-app-text">{g.type} {g.serialNo}</span> · {g.warehouse} · {g.count} copies
                    <div className="mt-0.5 whitespace-normal break-words">{g.reasons.join('; ')}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={`Clean ${confirm?.label ?? ''}?`}
        description="A snapshot file of the removed records is saved to your Downloads first. Only empty placeholder copies are removed; the fuller copy of each serial stays. This syncs to every device."
        confirmLabel="Clean"
        onConfirm={handleApply}
        onCancel={() => setConfirm(null)}
      />
    </section>
  )
}

export default DuplicateCleanupPanel
