// Admin > Data Care > Backup: this PC's own automatic backup (folder, last file, Drive copy) with the same complete steps as
// the one-time banner, and a button to choose or change the folder. Only shown on a PC (phones make no backup files).
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { HardDrive } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { deviceKind } from '../../../services/deviceStatusWorker.js'
import { useConfirm } from '../../../hooks/useConfirm.jsx'
import { chooseBackupFolder, getFolderState, runDeviceBackup } from '../../../services/deviceBackup.js'
import { useAuth } from '../../../context/AuthContext.jsx'
import BackupFolderSteps, { BackupFolderNote, BACKUP_FOLDER_PATH } from '../BackupFolderSteps.jsx'

const FOLDER_TEXT = {
  ok: 'Saving to the chosen folder',
  none: 'No folder chosen yet (the newest file is kept inside the browser meanwhile)',
  'needs-permission': 'The browser needs one click to allow the folder again',
  unsupported: 'This browser cannot save to a folder (use Chrome or Edge)',
}

function PcBackupCard() {
  const { user } = useAuth()
  const [state, setState] = useState('none')
  const [busy, setBusy] = useState(false)
  const [ask, confirmDialog] = useConfirm()
  const askAdopt = (name) => ask({ title: 'Use this folder for this PC?', description: `This folder already holds backups of "${name}". Use it for this PC and take over that device's identity?`, confirmLabel: 'Use this folder' })
  const folder = useLiveQuery(() => db.deviceInfo.get('folder'), [])
  const info = useLiveQuery(() => db.deviceInfo.get('backupState'), [])

  useEffect(() => {
    let alive = true
    const refresh = () => getFolderState().then((s) => { if (alive) setState(s) }).catch(() => {})
    refresh()
    window.addEventListener('bsm:device-backup-folder', refresh)
    window.addEventListener('bsm:device-backup-done', refresh)
    return () => { alive = false; window.removeEventListener('bsm:device-backup-folder', refresh); window.removeEventListener('bsm:device-backup-done', refresh) }
  }, [])

  if (deviceKind() !== 'pc') return null

  const choose = async () => {
    setBusy(true)
    const r = await chooseBackupFolder({ askAdopt })
    setBusy(false)
    if (r.ok) toast.success(r.message); else if (r.message) toast(r.message)
  }
  const backupNow = async () => {
    setBusy(true)
    const r = await runDeviceBackup(user)
    setBusy(false)
    if (r?.ok) toast.success('Backup file saved and checked'); else toast.error('The backup could not be saved. See the problem line below.')
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-app-text"><HardDrive size={16} className="text-brand-neon" /> This PC&rsquo;s automatic backup</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Every office PC keeps its own backup file of its data, in two independent places: a folder on this PC ({BACKUP_FOLDER_PATH}) and the Admin&rsquo;s Google Drive. Either one alone can restore this PC.
      </p>
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-neutral-500">Folder</dt><dd className="text-right text-neutral-300">{folder?.name ? `${folder.name} · ` : ''}{FOLDER_TEXT[state] ?? state}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-neutral-500">Last backup file</dt><dd className="text-right text-neutral-300">{info?.at ? new Date(info.at).toLocaleString() : 'none yet'}{info?.savedTo === 'private' ? ' (inside the browser)' : ''}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-neutral-500">Google Drive copy</dt><dd className="text-right text-neutral-300">{info?.driveOk === true ? `delivered ${info.driveAt ? new Date(info.driveAt).toLocaleString() : ''}` : info?.driveOk === false ? 'did not arrive (will retry tomorrow)' : 'not set up yet or not sent yet'}</dd></div>
        {info?.problem && <div className="text-brand-amber">Problem: {info.problem}</div>}
      </dl>

      {state !== 'unsupported' && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-app-text">{state === 'ok' ? 'To change the folder' : state === 'needs-permission' ? 'To allow the folder again' : 'To choose the folder'}</div>
          <BackupFolderSteps renew={state === 'needs-permission'} />
          <BackupFolderNote />
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={choose} disabled={busy} className="rounded-lg bg-brand-neon px-4 py-1.5 text-sm font-semibold text-brand-contrast hover:brightness-110 active:scale-95 disabled:opacity-60">
              {state === 'needs-permission' ? 'Allow' : state === 'ok' ? 'Change folder' : 'Choose folder'}
            </button>
            <button type="button" onClick={backupNow} disabled={busy} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-app-text hover:border-neutral-500 disabled:opacity-60">Back up this PC now</button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}

export default PcBackupCard
