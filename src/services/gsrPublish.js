// Sends a prepared GSR (and its audit file) to the GSR Google Drive receiver through /api/gsr-publish, reads both files back
// and verifies every value. Admin only (the screen that calls this is Admin only). Nothing here touches the database.

import { verifyReadback } from '../utils/gsr/verify.js'
import { AUDIT_READBACK_REF, AUDIT_STATUS_REF } from '../utils/gsr/audit.js'

const call = async (action, body = {}) => {
  const r = await fetch('/api/gsr-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bsm-app-key': import.meta.env.VITE_APP_SHARED_KEY ?? '' },
    body: JSON.stringify({ action, ...body }),
  })
  const reply = await r.json().catch(() => ({}))
  if (r.status === 503) throw Object.assign(new Error('GSR Drive is not set up yet (see docs/gsr-drive-setup.md).'), { code: 'not-configured' })
  if (!r.ok) throw new Error(`${reply.error ?? 'failed'}${reply.detail ? `: ${reply.detail}` : ''}`)
  return reply
}

/** Is the receiver reachable? Returns the designated folder's name. */
export const pingGsrDrive = async () => (await call('ping')).folder

/**
 * Create the GSR and its audit file in Drive, read both back and compare.
 * @param res  the result of prepareGsr()
 * @returns { files: [{ name, id, url }], checked, bad, verified }
 */
export const createGsrInDrive = async (res) => {
  const files = [
    { name: res.fileName, sheets: res.sheets.map((s) => s.toPayload()) },
    { name: res.audit.name, sheets: res.audit.sheets.map((s) => s.toPayload()) },
  ]
  const made = await call('create', { path: res.folder.slice(1), files })
  const [gsrFile, auditFile] = made.files
  const gsrRead = await call('read', { fileId: gsrFile.id })
  const auditRead = await call('read', { fileId: auditFile.id })
  const a = verifyReadback(res.sheets, gsrRead.sheets)
  const b = verifyReadback(res.audit.sheets, auditRead.sheets)
  const checked = a.checked + b.checked
  const bad = [...a.bad, ...b.bad]
  const verified = bad.length === 0
  const note = verified ? `${checked} of ${checked} values match` : `${bad.length} of ${checked} values DIFFER - NOT VERIFIED`
  await call('setCells', { fileId: auditFile.id, sheet: 'Summary', cells: [{ ref: AUDIT_READBACK_REF, value: note }] })
  if (!verified) {
    await call('rename', { fileId: gsrFile.id, name: `${gsrFile.name} - NOT VERIFIED` })
    await call('rename', { fileId: auditFile.id, name: `${auditFile.name} - NOT VERIFIED` })
    await call('setCells', { fileId: auditFile.id, sheet: 'Summary', cells: [{ ref: AUDIT_STATUS_REF, value: 'NOT VERIFIED' }] })
  }
  return { files: made.files, checked, bad, verified }
}
