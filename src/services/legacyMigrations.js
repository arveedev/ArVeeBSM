// One-time copies of data that older versions kept only on the device into tables that sync, so nothing the admin
// entered before is lost when a table moves.
import { db } from '../db/dexie.js'

/** privateMillerAllocations (compound key, never synced) -> privateMillerShares (synced). Safe to run on every start. */
export const uploadLegacyPrivateMillerShares = async () => {
  const [old, have] = await Promise.all([db.privateMillerAllocations.toArray(), db.privateMillerShares.toArray()])
  if (old.length === 0) return
  const known = new Set(have.map((r) => r.id))
  const rows = old
    .map((o) => ({ id: `${o.regionalAuthorityNumber}::${o.ricemillName}`, regionalAuthorityNumber: o.regionalAuthorityNumber, ricemillName: o.ricemillName, totalNetKgs: o.totalNetKgs, updatedAt: new Date().toISOString() }))
    .filter((r) => !known.has(r.id))
  if (rows.length) await db.privateMillerShares.bulkPut(rows)
}
