// A quiet one-click banner on office PCs that have no backup folder yet (or whose folder needs permission again).
// Browsers never let a website pick a folder by itself, so each PC needs this single click once. Until then the PC keeps
// its newest backup in the browser's private storage, and the Admin sees "no folder yet" in System health.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FolderOpen } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { deviceKind } from '../../services/deviceStatusWorker.js'
import { chooseBackupFolder, getFolderState } from '../../services/deviceBackup.js'

const DeviceBackupBanner = () => {
  const { user } = useAuth()
  const [state, setState] = useState('ok')
  const [later, setLater] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const refresh = () => getFolderState().then((s) => { if (alive) setState(s) }).catch(() => {})
    refresh()
    window.addEventListener('bsm:device-backup-folder', refresh)
    window.addEventListener('focus', refresh)
    const poll = setInterval(() => setFormOpen(Boolean(window.__bsmFormOpen)), 1500)
    return () => { alive = false; clearInterval(poll); window.removeEventListener('bsm:device-backup-folder', refresh); window.removeEventListener('focus', refresh) }
  }, [])

  if (!user || user.role === 'Visitor' || deviceKind() !== 'pc' || later || formOpen) return null
  if (state !== 'none' && state !== 'needs-permission') return null

  const click = async () => {
    setBusy(true)
    const r = await chooseBackupFolder()
    setBusy(false)
    if (r.ok) { toast.success(r.message); setState('ok') } else if (r.message) toast(r.message)
  }

  return (
    <div role="status" className="animate-popover-in fixed bottom-4 left-1/2 z-[55] flex w-[min(92vw,34rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 shadow-2xl shadow-black/50">
      <FolderOpen size={20} className="shrink-0 text-brand-neon" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-app-text">{state === 'needs-permission' ? 'Allow the backup folder again' : 'Choose this PC\u2019s backup folder'}</div>
        <div className="text-xs text-neutral-400">{state === 'needs-permission' ? 'One click, then backups continue.' : 'Pick the same folder name on every PC, for example C:\BSM-Backup. One click, once.'}</div>
      </div>
      <button type="button" onClick={click} disabled={busy} className="shrink-0 rounded-lg bg-brand-neon px-3 py-1.5 text-sm font-semibold text-brand-contrast hover:brightness-110 active:scale-95 disabled:opacity-60">
        {state === 'needs-permission' ? 'Allow' : 'Choose folder'}
      </button>
      <button type="button" onClick={() => setLater(true)} className="shrink-0 text-xs text-neutral-400 hover:text-app-text">Later</button>
    </div>
  )
}

export default DeviceBackupBanner
