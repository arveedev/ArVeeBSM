// Customer directory — powers autocomplete + auto-fill on EVERY Customer
// Name field across WSR, WSI, WTS, ESR, and ESI forms. Built up
// automatically as forms are saved (no separate admin UI). Keyed by a
// normalized version of the name (trimmed, lowercased, collapsed
// whitespace). Records: name, RSBSA, gender, address (new), and whether
// the customer was last entered as an individual or farmer cooperative.

import { db } from '../db/dexie.js'

export const normalizeCustomerName = (name = '') =>
  name.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Returns up to `limit` customers whose name starts with or contains
 * `query` (case-insensitive). Only searches once `query` is at least 3
 * characters.
 */
export const searchCustomers = async (query, limit = 6) => {
  const normalizedQuery = normalizeCustomerName(query)
  if (normalizedQuery.length < 3) return []

  const all = await db.customers.toArray()
  const matches = all.filter((c) => c.normalizedName.includes(normalizedQuery))

  matches.sort((a, b) => {
    const aStarts = a.normalizedName.startsWith(normalizedQuery)
    const bStarts = b.normalizedName.startsWith(normalizedQuery)
    if (aStarts !== bStarts) return aStarts ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return matches.slice(0, limit)
}

/**
 * Detects a "WS" / "Acting WS" prefix on a partially-typed customer name
 * and, if found, returns matching Warehouse Supervisor users formatted as
 * full suggestion strings (e.g. "WS John Jones", "Acting WS John Jones").
 * Used when a transaction moves stock between warehouses and the
 * "customer" is really another warehouse's supervisor.
 *
 * If a supervisor is assigned to more than one warehouse, one suggestion
 * row is returned PER assigned warehouse (e.g. "WS John Jones — ABACORP
 * A" and "WS John Jones — ABACORP B") rather than silently joining every
 * address together — the user needs to pick which warehouse this specific
 * transaction is actually for, so the right address gets written.
 *
 * Returns [] if the typed text doesn't start with a recognized prefix, or
 * once a name has been typed past the prefix with no matching supervisor.
 */
const WS_PREFIX_PATTERN = /^(acting\s+)?ws\s*(.*)$/i

export const searchWarehouseSupervisors = async (query) => {
  const match = WS_PREFIX_PATTERN.exec(query.trim())
  if (!match) return []

  const [, actingPrefix, nameFragment] = match
  const prefixLabel = actingPrefix ? 'Acting WS' : 'WS'

  const users = await db.users.where('role').equals('Warehouse Supervisor').toArray()
  const warehouses = await db.warehouses.toArray()
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))

  const fragment = nameFragment.trim().toLowerCase()
  const matches = users.filter((u) => !fragment || u.name.toLowerCase().includes(fragment))

  matches.sort((a, b) => a.name.localeCompare(b.name))

  const suggestions = []
  for (const u of matches) {
    const assignedWarehouses = (u.assignedWarehouses ?? [])
      .map((id) => warehouseMap.get(id))
      .filter(Boolean)

    if (assignedWarehouses.length === 0) {
      // No assigned warehouse on record — still suggest the name, just
      // with no address to auto-fill.
      suggestions.push({
        customerId: `ws-suggestion-${u.uid}`,
        name: `${prefixLabel} ${u.name}`,
        address: null,
        isWarehouseSupervisorSuggestion: true,
      })
      continue
    }

    // One row per assigned warehouse, sorted so the picker is predictable.
    const sortedAssigned = [...assignedWarehouses].sort((a, b) => a.name.localeCompare(b.name))
    for (const w of sortedAssigned) {
      suggestions.push({
        customerId: `ws-suggestion-${u.uid}-${w.warehouseId}`,
        name: `${prefixLabel} ${u.name}`,
        warehouseLabel: sortedAssigned.length > 1 ? `${w.code} — ${w.name}` : null,
        address: w.address ?? null,
        isWarehouseSupervisorSuggestion: true,
      })
    }
  }

  return suggestions
}

/**
 * Looks up a customer by exact (normalized) name match — used to
 * auto-fill all known fields when the user types or selects a name.
 */
export const findCustomerByName = async (name) => {
  const normalizedName = normalizeCustomerName(name)
  if (!normalizedName) return null
  return db.customers.where('normalizedName').equals(normalizedName).first()
}

/**
 * Upserts a customer record from whatever a form just saved. Preserves
 * existing fields if newer save doesn't supply them (e.g. an ESR form
 * that doesn't collect RSBSA won't clear an RSBSA set from a prior WSR).
 */
export const rememberCustomer = async ({
  name,
  rsbsa = null,
  gender = null,
  address = null,
  isFarmerOrg = false,
  farmerCoopMembers = null,
}) => {
  const normalizedName = normalizeCustomerName(name)
  if (!normalizedName) return

  const existing = await db.customers.where('normalizedName').equals(normalizedName).first()

  const record = {
    customerId: existing?.customerId ?? crypto.randomUUID(),
    name: name.trim(),
    normalizedName,
    rsbsa: rsbsa || existing?.rsbsa || null,
    gender: gender || existing?.gender || null,
    address: address || existing?.address || null,
    isFarmerOrg,
    farmerCoopMembers: isFarmerOrg
      ? farmerCoopMembers
      : existing?.farmerCoopMembers ?? null,
  }

  await db.customers.put(record)
}
