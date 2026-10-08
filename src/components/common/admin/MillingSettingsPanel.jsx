// Milling Prices and Signatories - Admin only. Settings behind the Milling and
// Test Milling Liquidation reports (Inventory Reports): the signatories printed
// on every liquidation (shared by all ricemills), and, per ricemill, the miller
// contractor and the unit prices (rice per bag of 50 kg, by-products per kilo).
// Stored on the shared reportConfig record. A price edited directly on a
// liquidation is the same stored value shown here.

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { liveFormatNumber, parseFormattedNumber } from '../../../utils/calculations.js'
import { buildMillingBatches, listMillers, millerStoreKey, SIGNATORY_FIELDS } from '../../../utils/millingLiquidation.js'
import { inputClass, labelClass, primaryButtonClass, byAlpha } from './shared.js'

const fmtMoney = (n) => liveFormatNumber(Number(n ?? 0).toFixed(2))

const saveConfig = async (patch) => {
  const cur = await db.reportConfig.get('global')
  if (cur) await db.reportConfig.update('global', patch)
  else await db.reportConfig.put({ id: 'global', ...patch })
}

function MillingSettingsPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const transactions = useLiveQuery(() => db.transactions.toArray(), [])
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []

  const millers = useMemo(() => (transactions ? listMillers(buildMillingBatches({ transactions })) : []), [transactions])
  const products = useMemo(() => ({
    rice: varieties.filter((v) => v.category === 'Rice').map((v) => v.name).sort(byAlpha),
    byp: varieties.filter((v) => v.category === 'By Products').map((v) => v.name).sort(byAlpha),
  }), [varieties])

  // ---- signatories (shared)
  const [sig, setSig] = useState({})
  useEffect(() => { setSig(config?.millingSignatories ?? {}) }, [config?.millingSignatories])
  const [savingSig, setSavingSig] = useState(false)
  const saveSig = async () => {
    setSavingSig(true)
    try { await saveConfig({ millingSignatories: sig }); toast.success('Signatories saved') } catch (err) { console.error(err); toast.error('Could not save') } finally { setSavingSig(false) }
  }

  // ---- per ricemill
  const [millerKey, setMillerKey] = useState('')
  const key = millerStoreKey(millerKey)
  const mill = config?.millingMills?.[key]
  const [contractor, setContractor] = useState('')
  const [prices, setPrices] = useState({})
  useEffect(() => {
    setContractor(mill?.contractor ?? '')
    setPrices(Object.fromEntries(Object.entries(mill?.prices ?? {}).map(([k, v]) => [k, fmtMoney(v)])))
  }, [millerKey, mill?.contractor, JSON.stringify(mill?.prices ?? {})]) // eslint-disable-line react-hooks/exhaustive-deps
  const [savingMill, setSavingMill] = useState(false)
  const saveMill = async () => {
    if (!millerKey) return
    setSavingMill(true)
    try {
      const all = { ...(config?.millingMills ?? {}) }
      all[key] = { contractor: contractor.trim(), prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, parseFormattedNumber(v)])) }
      await saveConfig({ millingMills: all })
      toast.success('Ricemill prices saved')
    } catch (err) { console.error(err); toast.error('Could not save') } finally { setSavingMill(false) }
  }

  const priceField = (p, unit) => (
    <label key={p} className={labelClass}>{p} <span className="text-neutral-600">({unit})</span>
      <input
        type="text" inputMode="decimal" value={prices[p] ?? ''} placeholder="0.00" className={inputClass}
        onChange={(e) => setPrices({ ...prices, [p]: liveFormatNumber(e.target.value) })}
      />
    </label>
  )

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-base font-semibold text-app-text">Signatories</h2>
        <p className="mt-1 text-xs text-neutral-400">Printed at the bottom of every Milling and Test Milling Liquidation. Shared by all ricemills.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {SIGNATORY_FIELDS.map((f) => (
            <label key={f.key} className={labelClass}>{f.title}
              <input type="text" value={sig[f.key] ?? ''} onChange={(e) => setSig({ ...sig, [f.key]: e.target.value })} className={inputClass} placeholder="Full name" />
            </label>
          ))}
        </div>
        <button type="button" onClick={saveSig} disabled={savingSig} className={`mt-3 w-full ${primaryButtonClass} disabled:opacity-40`}>{savingSig ? 'Saving…' : 'Save signatories'}</button>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-base font-semibold text-app-text">Ricemill prices</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Set once per ricemill; every liquidation for that ricemill uses these until you change them. A price edited on a liquidation
          updates the same value. Local rice is priced per bag of 50 kg, by-products per kilo.
        </p>
        <label className={`mt-3 block ${labelClass}`}>Ricemill
          <select value={millerKey} onChange={(e) => setMillerKey(e.target.value)} className={inputClass}>
            <option value="">Select a ricemill…</option>
            {millers.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        </label>
        {millerKey && (
          <>
            <label className={`mt-3 block ${labelClass}`}>Miller contractor
              <input type="text" value={contractor} onChange={(e) => setContractor(e.target.value)} className={inputClass} placeholder="Full name" />
            </label>
            <p className="mt-3 text-xs font-bold uppercase tracking-wide text-neutral-400">Local rice, per bag</p>
            <div className="grid gap-3 sm:grid-cols-3">{products.rice.map((p) => priceField(p, 'per bag'))}</div>
            <p className="mt-3 text-xs font-bold uppercase tracking-wide text-neutral-400">By-products, per kilo</p>
            <div className="grid gap-3 sm:grid-cols-3">{products.byp.map((p) => priceField(p, 'per kg'))}</div>
            <button type="button" onClick={saveMill} disabled={savingMill} className={`mt-3 w-full ${primaryButtonClass} disabled:opacity-40`}>{savingMill ? 'Saving…' : 'Save ricemill prices'}</button>
          </>
        )}
      </div>
    </section>
  )
}

export default MillingSettingsPanel
