// A one-time banner on office PCs that have no backup folder yet (or whose folder needs permission again).
// Browsers never let a website pick a folder by itself, so each PC needs this single click once, and the banner gives the
// complete steps. Until then the PC keeps its newest backup in the browser's private storage, and the Admin sees
// "no folder yet" in System health.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FolderOpen } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { deviceKind } from '../../services/deviceStatusWorker.js'
import { useConfirm } from '../../hooks/useConfirm.jsx'
import { chooseBackupFolder, getFolderState } from '../../services/deviceBackup.js'
import BackupFolderSteps, { BackupFolderNote, BACKUP_FOLDER_PATH } from './BackupFolderSteps.jsx'
import { isViewerRole } from '../../utils/roles.js'

const DeviceBackupBanner = () => {
  const { user } = useAuth()
  const [state, setState] = useState('ok')
  const [later, setLater] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ask, confirmDialog] = useConfirm()
  const askAdopt = (name) => ask({ title: 'Use this folder for this PC?', description: `This folder already holds backups of "${name}". Use it for this PC and take over that device's identity?`, confirmLabel: 'Use this folder' })

  useEffect(() => {
    let alive = true
    const refresh = () => getFolderState().then((s) => { if (alive) setState(s) }).catch(() => {})
    refresh()
    window.addEventListener('bsm:device-backup-folder', refresh)
    window.addEventListener('focus', refresh)
    const poll = setInterval(() => setFormOpen(Boolean(window.__bsmFormOpen)), 1500)
    return () => { alive = false; clearInterval(poll); window.removeEventListener('bsm:device-backup-folder', refresh); window.removeEventListener('focus', refresh) }
  }, [])

  if (!user || isViewerRole(user.role) || deviceKind() !== 'pc' || later || formOpen) return null
  if (state !== 'none' && state !== 'needs-permission') return null
  const renew = state === 'needs-permission'

  const click = async () => {
    setBusy(true)
    const r = await chooseBackupFolder({ askAdopt })
    setBusy(false)
    if (r.ok) { toast.success(r.message); setState('ok') } else if (r.message) toast(r.message)
  }

  return (
    <div role="status" className="animate-popover-in fixed bottom-4 left-1/2 z-[55] w-[min(94vw,36rem)] -translate-x-1/2 rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl shadow-black/50">
      <div className="flex items-start gap-3">
        <FolderOpen size={20} className="mt-0.5 shrink-0 text-brand-neon" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-medium text-app-text">{renew ? 'Allow this PC’s backup folder again' : `Choose this PC’s backup folder (${BACKUP_FOLDER_PATH})`}</div>
          {!renew && <p className="text-xs text-neutral-400">This PC saves its own automatic backup file in a folder, so it can repair itself even with no internet. You do this once.</p>}
          <BackupFolderSteps renew={renew} />
          {!renew && <BackupFolderNote />}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        <button type="button" onClick={() => setLater(true)} className="text-xs text-neutral-400 hover:text-app-text">Later</button>
        <button type="button" onClick={click} disabled={busy} className="rounded-lg bg-brand-neon px-4 py-1.5 text-sm font-semibold text-brand-contrast hover:brightness-110 active:scale-95 disabled:opacity-60">
          {renew ? 'Allow' : 'Choose folder'}
        </button>
      </div>
      {confirmDialog}
    </div>
  )
}

export default DeviceBackupBanner
