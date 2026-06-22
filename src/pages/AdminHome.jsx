// Admin Home — executive summary across ALL warehouses.
// Three sections:
//  1. Net bags per province, per category (Rice/Palay).
//  2. Breakdown: per warehouse, per category, net bags.
//  3. Age grouping: per province > warehouse > category:
//       Rice:  0–3 months | >3 months
//       Palay: 0–6 months | 6.1–12 months | >12 months
//
// "Net bags" here = pile.currentKilos / 50, summed across the relevant
// piles — these are the LIVE running totals on each pile (updated by
// src/utils/pileLedger.js whenever a WSR/WSI saves), not a re-derivation
// from transaction history. This is why mock/seeded pile data shows up
// immediately, even before any transaction has touched that pile.
// Rounded to 2 decimals everywhere it's displayed.

import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../context/AuthContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge } from '../utils/calculations.js'

const CATEGORIES = ['Rice', 'Palay']

const AGE_BUCKETS = {
  Rice: [
    { label: '0–3 months', test: (d) => d <= 90 },
    { label: '>3 months',  test: (d) => d > 90 },
  ],
  Palay: [
    { label: '0–6 months',    test: (d) => d <= 180 },
    { label: '6.1–12 months', test: (d) => d > 180 && d <= 365 },
    { label: '>12 months',    test: (d) => d > 365 },
  ],
}

const fmt = (n) => (n ?? 0).toFixed(2)

function AdminHome() {
  const { user } = useAuth()
  const { autoAgeMonitoring } = useSettings() ?? {}

  const provinces  = useLiveQuery(() => db.provinces.toArray(), []) ?? []
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const piles      = useLiveQuery(() => db.piles.toArray(), []) ?? []

  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const provinceMap  = new Map(provinces.map((p) => [p.provinceId, p]))

  const enrichedPiles = piles.map((p) => ({
    ...p,
    age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
    netBags: (p.currentKilos ?? 0) / 50,
  }))

  const sortedProvinces  = [...provinces].sort((a, b) => a.code.localeCompare(b.code))
  const sortedWarehouses = [...warehouses].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="min-h-screen px-4 pb-24 pt-6">
      <h1 className="text-xl font-semibold text-white">Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-400">Welcome back, {user?.nickname}.</p>

      {/* ── 1. Province sub-totals ──────────────────────────────────────── */}
      <Section title="Net Bags by Province & Category">
        {sortedProvinces.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800">
                <Th>Province</Th>
                {CATEGORIES.map((c) => <Th key={c} right>{c}</Th>)}
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {sortedProvinces.map((province) => {
                const wIds = new Set(
                  warehouses
                    .filter((w) => w.provinceId === province.provinceId)
                    .map((w) => w.warehouseId)
                )
                const pp = enrichedPiles.filter((p) => wIds.has(p.warehouseId))
                const catTotals = Object.fromEntries(
                  CATEGORIES.map((c) => [c, pp.filter((p) => p.cerealType === c)
                    .reduce((s, p) => s + p.netBags, 0)])
                )
                const total = Object.values(catTotals).reduce((a, b) => a + b, 0)
                return (
                  <tr key={province.provinceId} className="border-b border-neutral-800/50">
                    <Td>
                      <span className="font-medium text-white">{province.code}</span>
                      <span className="ml-1 text-xs text-neutral-500">{province.name}</span>
                    </Td>
                    {CATEGORIES.map((c) => <Td key={c} right>{fmt(catTotals[c])}</Td>)}
                    <Td right><span className="font-semibold text-brand-neon">{fmt(total)}</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── 2. Per warehouse, per category breakdown ───────────────────── */}
      <Section title="Stock Breakdown — Warehouse & Category">
        {sortedWarehouses.length === 0 ? <Empty /> : (
          <div className="space-y-4">
            {sortedWarehouses.map((warehouse) => {
              const wPiles = enrichedPiles.filter((p) => p.warehouseId === warehouse.warehouseId)
              if (wPiles.length === 0) return null
              const province = provinceMap.get(warehouse.provinceId)
              return (
                <div key={warehouse.warehouseId}>
                  <p className="text-xs font-semibold uppercase text-neutral-500">
                    {province?.code} · {warehouse.name}
                  </p>
                  <table className="mt-1 w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800">
                        <Th>Category</Th>
                        <Th right>Net Bags</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {CATEGORIES.map((cat) => {
                        const sum = wPiles.filter((p) => p.cerealType === cat)
                          .reduce((s, p) => s + p.netBags, 0)
                        if (sum === 0) return null
                        return (
                          <tr key={cat} className="border-b border-neutral-800/50">
                            <Td>{cat}</Td>
                            <Td right>{fmt(sum)}</Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ── 3. Age grouping ────────────────────────────────────────────── */}
      <Section title="Stock Age Grouping">
        {sortedProvinces.length === 0 ? <Empty /> : (
          <div className="space-y-6">
            {sortedProvinces.map((province) => {
              const provinceWarehouses = sortedWarehouses.filter(
                (w) => w.provinceId === province.provinceId
              )
              if (provinceWarehouses.length === 0) return null
              return (
                <div key={province.provinceId}>
                  <p className="mb-2 text-sm font-semibold text-white">
                    {province.code} — {province.name}
                  </p>
                  {CATEGORIES.map((cat) => {
                    const buckets = AGE_BUCKETS[cat]
                    const hasData = provinceWarehouses.some((w) =>
                      enrichedPiles.some(
                        (p) => p.warehouseId === w.warehouseId && p.cerealType === cat
                      )
                    )
                    if (!hasData) return null
                    return (
                      <div key={cat} className="mt-3">
                        <p className="text-xs font-semibold uppercase text-neutral-500 mb-1">
                          {cat}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-neutral-800">
                                <Th>Warehouse</Th>
                                {buckets.map((b) => <Th key={b.label} right>{b.label}</Th>)}
                                <Th right>Total</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {provinceWarehouses.map((warehouse) => {
                                const wCatPiles = enrichedPiles.filter(
                                  (p) => p.warehouseId === warehouse.warehouseId &&
                                         p.cerealType === cat
                                )
                                if (wCatPiles.length === 0) return null
                                const bucketTotals = buckets.map((b) =>
                                  wCatPiles.filter((p) => b.test(p.age))
                                    .reduce((s, p) => s + p.netBags, 0)
                                )
                                const total = bucketTotals.reduce((a, b) => a + b, 0)
                                return (
                                  <tr key={warehouse.warehouseId} className="border-b border-neutral-800/50">
                                    <Td>{warehouse.name}</Td>
                                    {bucketTotals.map((val, i) => <Td key={i} right>{fmt(val)}</Td>)}
                                    <Td right>
                                      <span className="font-semibold text-brand-neon">
                                        {fmt(total)}
                                      </span>
                                    </Td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-sm font-semibold text-neutral-300">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        {children}
      </div>
    </div>
  )
}

function Th({ children, right }) {
  return (
    <th className={`pb-2 text-xs font-semibold uppercase text-neutral-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right }) {
  return (
    <td className={`py-1.5 text-xs text-neutral-300 ${right ? 'text-right' : ''}`}>
      {children}
    </td>
  )
}

function Empty() {
  return <p className="text-xs text-neutral-500">No data available yet.</p>
}

export default AdminHome
