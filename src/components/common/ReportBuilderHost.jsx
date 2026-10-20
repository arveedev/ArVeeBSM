// Opens the Report Builder from anywhere: the Reports card in Settings, or Ctrl + Alt + R.
// Only an Admin, an Analyst or warehouse staff can open it (and the Admin can switch it off for staff or Analysts). A Visitor and the
// SDO never can. The Builder reads a copy of the records and writes nothing but the person's own saved layouts and an export log.
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { canUseReportBuilder } from '../../utils/roles.js'
import ReportBuilderModal from './reportBuilder/ReportBuilderModal.jsx'

export const OPEN_REPORT_BUILDER_EVENT = 'bsm:open-report-builder'
export const openReportBuilder = () => window.dispatchEvent(new Event(OPEN_REPORT_BUILDER_EVENT))

/** Can this user open the Builder? (for showing or hiding an entry point) */
export function useCanUseReportBuilder() {
  const { user } = useAuth() ?? {}
  const toolsAccess = useLiveQuery(() => db.reportConfig.get('global').then((c) => c?.toolsAccess ?? null), [])
  return canUseReportBuilder(user, toolsAccess)
}

function ReportBuilderHost() {
  const { user } = useAuth() ?? {}
  const can = useCanUseReportBuilder()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!can) { setOpen(false); return undefined }
    const show = () => setOpen(true)
    const onKey = (e) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (e.code === 'KeyR' || String(e.key).toLowerCase() === 'r')) { e.preventDefault(); show() }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(OPEN_REPORT_BUILDER_EVENT, show)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener(OPEN_REPORT_BUILDER_EVENT, show) }
  }, [can])

  return open && can ? <ReportBuilderModal user={user} onClose={() => setOpen(false)} /> : null
}

export default ReportBuilderHost
