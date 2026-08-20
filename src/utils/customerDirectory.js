// Customer directory — powers autocomplete + auto-fill on EVERY Customer
// Name field across WSR, WSI, WTS, ESR, and ESI forms. Built up
// automatically as forms are saved (no separate admin UI). Keyed by a
// normalized version of the name (trimmed, lowercased, collapsed
// whitespace). Records: name, RSBSA, gender, address (new), and whether
// the customer was last entered as an individual or farmer cooperative.
//
// Special case, explicitly scoped - NOT a general mechanism: "Various
// Farmers" (used on Procurement transactions as shorthand for
// "whichever farmers sold to this specific warehouse today") gets a
// different address per warehouse, stored separately. This is
// deliberately hardcoded to this one name, not applied to every
// customer - a normal customer has exactly one address, and typing a
// different one at a different warehouse should simply update it, the
// same as it always has. Confirmed directly: applying this to all
// customers was explicitly rejected as bad UX.

import { db } from '../db/dexie.js'
import { stripWarehouseCodePrefix } from '../services/googleSheetsBridge.js'

// Prefixes a warehouse's own name/GID onto its address so a WS/MPO
// suggestion's address reads e.g. "Tabaco GID, Tabaco City, Albay"
// instead of just "Tabaco City, Albay" - without this, the address
// alone gives no clue which specific warehouse it belongs to.
const withWarehouseLabel = (w) => (w.address ? `${stripWarehouseCodePrefix(w.name)}, ${w.address}` : null)

export const normalizeCustomerName = (name = '') =>
  name.trim().toLowerCase().replace(/\s+/g, ' ')

const VARIOUS_FARMERS_NAME = 'various farmers'

/**
 * Miller/customer nicknames - same exact shape and purpose as
 * warehouseAliases (see WarehousesPanel.jsx/dexie.js), for the case
 * where the AI/SIA sheet uses a short nickname ("Dens RM") that isn't
 * the customer's real/full name ("Dens Marketing Corp"). Resolving at
 * the sync boundary (see googleSheetsBridge.js's authority sync) and
 * here, in the customer-name field's own auto-fill, covers every
 * downstream use with no separate change needed anywhere else -
 * reports, exports, and the backup-sheet writes all just read whatever
 * ends up stored as the transaction's customerName, which is already
 * the real name by the time it's saved.
 */

/** Fetches every alias as a normalized-alias -> real-name Map, for
 * batch resolution (e.g. an authority sync processing many rows) -
 * one query instead of one per row. */
export const buildCustomerAliasMap = async () => {
  const [aliases, customers] = await Promise.all([
    db.customerAliases.toArray(),
    db.customers.toArray(),
  ])
  const customerById = new Map(customers.map((c) => [c.customerId, c]))
  const map = new Map()
  for (const a of aliases) {
    const real = customerById.get(a.customerId)
    if (real) map.set(a.alias, real.name)
  }
  return map
}

/** Resolves a single typed/incoming name to its real name if it
 * matches a known alias, otherwise returns the name unchanged
 * (trimmed). For one-off lookups (e.g. the customer name field as the
 * user types) - use buildCustomerAliasMap instead when resolving many
 * names in a loop. */
export const resolveCustomerAlias = async (name) => {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return trimmed
  const alias = await db.customerAliases.get(normalizeCustomerName(trimmed))
  if (!alias) return trimmed
  const real = await db.customers.get(alias.customerId)
  return real?.name ?? trimmed
}

/** Resolves the address to actually use for a given warehouse. Only
 * "Various Farmers" ever has a per-warehouse override - and for this
 * one name specifically, there is no shared fallback address at all:
 * a warehouse with no saved entry yet gets a blank address (so the
 * user enters a new one for THIS warehouse), never the generic
 * top-level field, which would otherwise leak whatever address a
 * DIFFERENT warehouse most recently saved. Every other customer still
 * uses the single generic address regardless of warehouse. */
const resolveAddress = (customer, warehouseId) => {
  const isVariousFarmers = customer?.normalizedName === VARIOUS_FARMERS_NAME
  if (isVariousFarmers) {
    return (warehouseId && customer?.addressesByWarehouse?.[warehouseId]) || null
  }
  return customer?.address ?? null
}

/**
 * Returns up to `limit` customers whose name starts with or contains
 * `query` (case-insensitive). Only searches once `query` is at least 3
 * characters. When warehouseId is provided, each result's address is
 * resolved for that specific warehouse (only actually differs for
 * "Various Farmers" - see resolveAddress above).
 */
export const searchCustomers = async (query, limit = 6, warehouseId = null) => {
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

  return matches.slice(0, limit).map((c) => ({ ...c, address: resolveAddress(c, warehouseId) }))
}

/**
 * Detects a "WS" / "Acting WS" prefix on a partially-typed customer name
 * and, if found, returns matching Warehouse Supervisor users formatted as
 * full suggestion strings. The "Acting WS" vs "WS" label is derived from
 * each supervisor's actual capacity (set in the Signatories admin tab),
 * not from what prefix was typed - typing just "WS" is enough, the app
 * knows if that supervisor is currently acting.
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

  const [, , nameFragment] = match

  const users = await db.users.where('role').anyOf(['Warehouse Supervisor', 'Acting Warehouse Supervisor']).toArray()
  const warehouses = await db.warehouses.toArray()
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))

  const fragment = nameFragment.trim().toLowerCase()
  const matches = users.filter((u) => !fragment || u.name.toLowerCase().includes(fragment))

  matches.sort((a, b) => a.name.localeCompare(b.name))

  const suggestions = []
  for (const u of matches) {
    const prefixLabel = u.role === 'Acting Warehouse Supervisor' ? 'Acting WS' : 'WS'

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
        warehouseLabel: `${w.code} — ${w.name}`,
        address: withWarehouseLabel(w),
        isWarehouseSupervisorSuggestion: true,
      })
    }
  }

  return suggestions
}

/**
 * Same pattern as searchWarehouseSupervisors above, for MPO III /
 * Acting MPO III - triggered by typing "MPO". Matches a user either
 * by role (MPO III / Acting MPO III) OR by being assigned to a
 * Mechanical Dryer / Ricemill facility regardless of their specific
 * role label, since a user could be assigned to one of these
 * facilities without necessarily having an MPO-specific role set.
 * Label format "MPO III [Name]" / "Acting MPO III [Name]" - always
 * includes the warehouse/facility name beside it, same reasoning as
 * the WS suggestions: makes clear where stock is actually going or
 * coming from.
 */
// Must also strip a leading "acting" and the "III" rank suffix, not just
// "mpo" - the generated suggestion label is always "MPO III [Name]" or
// "Acting MPO III [Name]" (see prefixLabel below), and re-typing/re-
// selecting that exact label has to reduce back to just [Name] for this
// pattern to recognize its own suggestion. Failing to strip "III" left
// it stuck in front of the name, breaking the self-match - which in turn
// meant CustomerNameAutocomplete's WS/MPO-suggestion guard against a
// stale db.customers record silently never engaged for MPO.
const MPO_PREFIX_PATTERN = /^(acting\s+)?mpo(?:\s*iii)?\.?\s*(.*)$/i

export const searchMpoUsers = async (query) => {
  const match = MPO_PREFIX_PATTERN.exec(query.trim())
  if (!match) return []

  const [, , nameFragment] = match

  const warehouses = await db.warehouses.toArray()
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const accountabilityFacilityIds = new Set(
    warehouses.filter((w) => w.facilityType === 'Mechanical Dryer' || w.facilityType === 'Ricemill').map((w) => w.warehouseId)
  )

  const allUsers = await db.users.toArray()
  const fragment = nameFragment.trim().toLowerCase()
  const matches = allUsers.filter((u) => {
    if (fragment && !u.name.toLowerCase().includes(fragment)) return false
    const isMpoRole = u.role === 'MPO III' || u.role === 'Acting MPO III'
    const isAtAccountabilityFacility = (u.assignedWarehouses ?? []).some((id) => accountabilityFacilityIds.has(id))
    return isMpoRole || isAtAccountabilityFacility
  })

  matches.sort((a, b) => a.name.localeCompare(b.name))

  const suggestions = []
  for (const u of matches) {
    const prefixLabel = u.role === 'Acting MPO III' ? 'Acting MPO III' : 'MPO III'

    const assignedWarehouses = (u.assignedWarehouses ?? [])
      .map((id) => warehouseMap.get(id))
      .filter(Boolean)

    if (assignedWarehouses.length === 0) {
      suggestions.push({
        customerId: `mpo-suggestion-${u.uid}`,
        name: `${prefixLabel} ${u.name}`,
        address: null,
        isWarehouseSupervisorSuggestion: true,
      })
      continue
    }

    const sortedAssigned = [...assignedWarehouses].sort((a, b) => a.name.localeCompare(b.name))
    for (const w of sortedAssigned) {
      suggestions.push({
        customerId: `mpo-suggestion-${u.uid}-${w.warehouseId}`,
        name: `${prefixLabel} ${u.name}`,
        warehouseLabel: `${w.code} — ${w.name}`,
        address: withWarehouseLabel(w),
        isWarehouseSupervisorSuggestion: true,
      })
    }
  }

  return suggestions
}

/**
 * Looks up a customer by exact (normalized) name match — used to
 * auto-fill all known fields when the user types or selects a name.
 * When warehouseId is provided, the returned address is resolved for
 * that specific warehouse - but only actually differs for "Various
 * Farmers" (see resolveAddress above); every other customer's address
 * is the same regardless of warehouse.
 *
 * Checks a known nickname/alias FIRST - typing "Dens RM" resolves
 * straight to whatever customer "Dens Marketing Corp" actually is,
 * same as if the real name had been typed directly. Falls through to
 * the plain name lookup when nothing matches an alias.
 */
export const findCustomerByName = async (name, warehouseId = null) => {
  const normalizedName = normalizeCustomerName(name)
  if (!normalizedName) return null

  const alias = await db.customerAliases.get(normalizedName)
  if (alias) {
    const aliased = await db.customers.get(alias.customerId)
    if (aliased) return { ...aliased, address: resolveAddress(aliased, warehouseId) }
  }

  const customer = await db.customers.where('normalizedName').equals(normalizedName).first()
  if (!customer) return null
  return { ...customer, address: resolveAddress(customer, warehouseId) }
}

/**
 * Upserts a customer record from whatever a form just saved. Preserves
 * existing fields if newer save doesn't supply them (e.g. an ESR form
 * that doesn't collect RSBSA won't clear an RSBSA set from a prior WSR).
 *
 * Only "Various Farmers" ever gets a per-warehouse address override
 * (addressesByWarehouse) - explicitly scoped to this one name, not a
 * general mechanism. Every other customer's address is just the single
 * top-level field, overwritten on each save exactly as it always has
 * been - entering a different address for the same normal customer at
 * a different warehouse simply updates it, it does not start tracking
 * multiple addresses for that person.
 */
export const rememberCustomer = async ({
  name,
  rsbsa = null,
  gender = null,
  address = null,
  isFarmerOrg = false,
  farmerCoopMembers = null,
  warehouseId = null,
}) => {
  const normalizedName = normalizeCustomerName(name)
  if (!normalizedName) return

  const existing = await db.customers.where('normalizedName').equals(normalizedName).first()

  const addressesByWarehouse = { ...(existing?.addressesByWarehouse ?? {}) }
  if (normalizedName === VARIOUS_FARMERS_NAME && warehouseId && address) {
    addressesByWarehouse[warehouseId] = address
  }

  const record = {
    customerId: existing?.customerId ?? crypto.randomUUID(),
    name: name.trim(),
    normalizedName,
    rsbsa: rsbsa || existing?.rsbsa || null,
    gender: gender || existing?.gender || null,
    address: address || existing?.address || null,
    addressesByWarehouse,
    isFarmerOrg,
    farmerCoopMembers: isFarmerOrg
      ? farmerCoopMembers
      : existing?.farmerCoopMembers ?? null,
  }

  await db.customers.put(record)
}
