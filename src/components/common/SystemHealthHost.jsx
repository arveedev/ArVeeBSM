// Opens System health from anywhere: the secret shortcut Ctrl + Alt + Q (never shown in the app), only for a signed-in
// Admin. Also reachable as the first tab of Admin > Data Care. The shortcut sits next to Ctrl+Alt+A (Admin) and
// Ctrl+Alt+D (Stock Desk) so one hand reaches all three.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useEscapeClose } from '../../utils/useEscapeClose.js'
import SystemHealthPanel from './admin/SystemHealthPanel.jsx'

export const OPEN_SYSTEM_HEALTH_EVENT = 'bsm:open-system-health'

function SystemHealthHost() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin'
  const [open, setOpen] = useState(false)
  useEscapeClose(() => setOpen(false), open)

  useEffect(() => {
    if (!isAdmin) { setOpen(false); return undefined }
    const show = () => { if (!window.__bsmFormOpen) setOpen(true) }
    const onKey = (e) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyQ') { e.preventDefault(); show() }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_SYSTEM_HEALTH_EVENT, show)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_SYSTEM_HEALTH_EVENT, show) }
  }, [isAdmin])

  if (!open || !isAdmin) return null
  return (
    <div className="animate-popover-in fixed inset-0 z-[60] overflow-y-auto bg-neutral-950/95 px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm" role="dialog" aria-label="System health">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-2 text-neutral-400 hover:text-app-text"><X size={20} /></button>
        </div>
        <SystemHealthPanel />
      </div>
    </div>
  )
}

export default SystemHealthHost
