// Visitor Access — a single shared 6-digit PIN (matching the login
// keypad) that logs anyone who enters it into a view-only session,
// restricted to Home and Monitor with no create/edit/delete capability
// anywhere. Its own dedicated panel, separate from Signatories, per
// explicit request.
//
// PINs are never stored or compared in plain text (see utils/pinHash.js)
// - the field here always starts blank, both because the stored value is
// a hash (not the real PIN, so there's nothing meaningful to pre-fill)
// and so no one can see the current PIN just by opening this panel.
// Leaving it blank and saving means "no change" - use the separate
// Disable button to actually turn visitor access off, so a blank field
// can't be misread as "disable".

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { hashPin } from '../../../utils/pinHash.js'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from '../../forms/shared.js'

function VisitorAccessPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const [visitorAccessCode, setVisitorAccessCode] = useState('')

  const handleSave = async () => {
    if (!visitorAccessCode) {
      toast.error('Enter a 6-digit PIN, or use Disable Visitor Access to turn it off')
      return
    }
    if (!/^\d{6}$/.test(visitorAccessCode)) {
      toast.error('Visitor PIN must be exactly 6 digits, matching the login keypad')
      return
    }

    const hashed = await hashPin(visitorAccessCode)

    // Spread the existing config first so this save never destroys
    // fields owned by other panels (Signatories, BSQAO, etc) - put()
    // fully replaces the record, it doesn't merge.
    await db.reportConfig.put({ ...config, id: 'global', visitorAccessCode: hashed })
    setVisitorAccessCode('')
    toast.success('Visitor PIN saved')
  }

  const handleDisable = async () => {
    await db.reportConfig.put({ ...config, id: 'global', visitorAccessCode: null })
    setVisitorAccessCode('')
    toast.success('Visitor access disabled')
  }

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div>
        <h2 className="text-sm font-semibold text-app-text">Visitor Access</h2>
        <p className="mt-1 text-xs text-neutral-500">
          A shared 6-digit PIN for view-only access - Home and Monitor
          only, no editing anywhere.
        </p>
        <p className="mt-1 text-xs text-neutral-600">
          {config?.visitorAccessCode ? 'Currently enabled.' : 'Currently disabled.'} For
          security, the current PIN is never shown here — enter a new
          one to change it.
        </p>
      </div>

      <div>
        <label className={labelClass}>New Visitor PIN</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={visitorAccessCode}
          onChange={(e) => setVisitorAccessCode(e.target.value.replace(/[^0-9]/g, ''))}
          className={inputClass}
          placeholder="6-digit PIN"
        />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
          Save
        </button>
        {config?.visitorAccessCode && (
          <button type="button" onClick={handleDisable} className={secondaryButtonClass}>
            Disable Visitor Access
          </button>
        )}
      </div>
    </div>
  )
}

export default VisitorAccessPanel
