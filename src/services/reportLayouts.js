// Report Builder: the ONLY things this feature ever writes - a person's own saved layout (their choices, never records) and a small
// log of what was exported or shared. Every business table is untouched.

import { db } from '../db/dexie.js'

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
const group = (role) => (role === 'Admin' ? 'admin' : role === 'Analyst' ? 'analysts' : 'staff')

/** Layouts this person may open: their own, and those shared with their group. */
export async function listLayouts(user) {
  const all = await db.reportLayouts.toArray()
  const g = group(user?.role)
  return all
    .filter((l) => l.ownerUid === user?.uid || (l.share && l.share[g]))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function saveLayout(user, { id, name, source, layout, params, share }) {
  const now = Date.now()
  const prev = id ? await db.reportLayouts.get(id) : null
  if (prev && prev.ownerUid !== user.uid && user.role !== 'Admin') throw new Error('Only the owner or the Admin can change this layout.')
  const row = {
    id: prev?.id ?? uid(), ownerUid: prev?.ownerUid ?? user.uid, ownerName: prev?.ownerName ?? (user.name ?? user.nickname ?? ''), name: String(name).trim(), source,
    layout: JSON.parse(JSON.stringify(layout)), params: params ?? {}, share: { admin: !!share?.admin, analysts: !!share?.analysts, staff: !!share?.staff }, createdAt: prev?.createdAt ?? now, updatedAt: now,
  }
  await db.reportLayouts.put(row)
  return row
}

export async function deleteLayout(user, id) {
  const l = await db.reportLayouts.get(id)
  if (!l) return
  if (l.ownerUid !== user.uid && user.role !== 'Admin') throw new Error('Only the owner or the Admin can delete this layout.')
  await db.reportLayouts.delete(id)
}

/** One row per export or share. Never blocks the export: a failure to log is swallowed. */
export async function logReportEvent(user, { action, source, layout = '', format = '', rows = 0, filters = '', scope = '' }) {
  try {
    await db.reportExportLog.add({ id: uid(), uid: user?.uid ?? '', userName: user?.name ?? user?.nickname ?? '', role: user?.role ?? '', at: Date.now(), action, source, layout, format, rows, filters: String(filters).slice(0, 400), scope })
  } catch { /* the log is a record for the Admin, not a gate */ }
}
