// Opens the Stock Desk from anywhere in the app: the quiet clipboard icon on the admin Home, or the secret
// shortcut Ctrl + Alt + D on any page. Only an Admin, or a Visitor who has at least one screen shared, can open it.
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { REPORT_SCREENS, canViewReport } from '../../utils/inventoryReportsAccess.js'
import InventoryReportsModal from './InventoryReportsModal.jsx'

export const OPEN_STOCK_DESK_EVENT = 'bsm:open-stock-desk'
export const openStockDesk = () => window.dispatchEvent(new Event(OPEN_STOCK_DESK_EVENT))

function StockDeskHost() {
  const { user } = useAuth()
  const reportAccess = useLiveQuery(() => db.reportConfig.get('global').then((c) => c?.inventoryReportsAccess ?? null), [])
  const isAdmin = user?.role === 'Admin'
  const canOpen = isAdmin || (user?.role === 'Visitor' && REPORT_SCREENS.some((s) => canViewReport(s.id, false, reportAccess)))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!canOpen) { setOpen(false); return undefined }
    const show = () => setOpen(true)
    const onKey = (e) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyD') { e.preventDefault(); show() }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_STOCK_DESK_EVENT, show)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_STOCK_DESK_EVENT, show) }
  }, [canOpen])

  return open && canOpen ? <InventoryReportsModal isAdmin={isAdmin} onClose={() => setOpen(false)} /> : null
}

export default StockDeskHost
