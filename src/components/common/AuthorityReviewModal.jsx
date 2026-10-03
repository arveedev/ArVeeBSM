// Authority Review - opened from the notification bell when an authority
// that transactions rely on has changed (or disappeared from the Sheet,
// usually a renumber). Lists every affected transaction for this user's
// warehouses. Every action is one transaction at a time, user-initiated:
//   Open     - the normal entry form for that transaction (edit as usual)
//   Verify   - "I checked it, the issuance still stands" (stamps an ack)
//   Re-link  - suggestions for the authority this probably became
//   Move     - to the authority's new warehouse, if the user may use it
// Nothing is changed automatically; see utils/authorityReview.js.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { computeReviewGroups, acknowledgeTransactions } from '../../utils/authorityReview.js'
import { FIELD_LABELS } from '../../utils/authorityChanges.js'
import { findReplacementCandidates, applyReplacementAuthority, moveTransactionForAuthority } from '../../utils/authorityActions.js'
import ConfirmDialog from './ConfirmDialog.jsx'

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 })
const btn = 'rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-all hover:border-neutral-500 active:scale-95 disabled:opacity-40'
const btnPrimary = 'rounded-lg bg-brand-neon px-2.5 py-1.5 text-xs font-bold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40'

function AuthorityReviewModal({ authId, onClose }) {
  const { user } = useAuth()
  const { accessibleWarehouses, setCurrentWarehouseId } = useWarehouse() ?? {}
  const isAdmin = user?.role === 'Admin'
  const warehouseIds = (accessibleWarehouses ?? []).map((w) => w.warehouseId)

  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const groups = useLiveQuery(
    () => computeReviewGroups({ isAdmin, warehouseIds }),
    [isAdmin, warehouseIds.join(',')]
  )
  const group = groups?.find((g) => g.key === authId) ?? null

  const [entered, setEntered] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [suggestFor, setSuggestFor] = useState(null) // tx id
  const [candidates, setCandidates] = useState([])
  const [moveFor, setMoveFor] = useState(null) // { tx, destId }
  const [changeSerial, setChangeSerial] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Everything handled (or resolved elsewhere) - close on its own.
  useEffect(() => {
    if (groups && !group) onClose()
  }, [groups, group])

  const whName = (id) => warehouses.find((w) => w.warehouseId === id)?.name ?? '—'
  const varietyName = (id) => varieties.find((v) => v.varietyId === id)?.name ?? '—'
  const sackCode = (id) => sackTypes.find((s) => s.sackTypeId === id)?.code ?? '—'

  const valueText = (change, v) => {
    if (v == null) return '—'
    if (change.field === 'assignedWarehouse') return whName(v)
    if (change.field === 'varietyId') return varietyName(v)
    if (typeof v === 'number') return fmt(v)
    return String(v)
  }
  const describeChange = (c) => {
    if (c.field === 'sackLine') {
      const label = `${sackCode(c.sackTypeId)} ${c.condition ?? ''}`.trim()
      return c.removed ? `${label} line removed (was ${fmt(c.from)} bags)` : `${label}: ${fmt(c.from)} → ${fmt(c.to)} bags`
    }
    return `${FIELD_LABELS[c.field] ?? c.field}: ${valueText(c, c.from)} → ${valueText(c, c.to)}`
  }

  const handleOpen = (tx) => {
    if (typeof window.openTransactionForm !== 'function') return
    if (tx.warehouseId) setCurrentWarehouseId?.(tx.warehouseId)
    onClose()
    // Small delay so the warehouse switch lands before the form loads the serial.
    setTimeout(() => window.openTransactionForm(tx.type, { serialNo: tx.serialNo }), 150)
  }

  const handleVerify = async (tx) => {
    setBusyId(tx.id)
    try {
      await acknowledgeTransactions([tx.id], group?.kind === 'missing' ? 'Kept as is' : 'Verified')
      toast.success(`${tx.type} ${tx.serialNo} marked as reviewed`)
    } finally { setBusyId(null) }
  }

  const handleSuggest = async (tx) => {
    if (suggestFor === tx.id) { setSuggestFor(null); return }
    setBusyId(tx.id)
    try {
      setCandidates(await findReplacementCandidates(group.authority, tx, warehouseIds))
      setSuggestFor(tx.id)
    } finally { setBusyId(null) }
  }

  const handleRelink = async (tx, candidate) => {
    setBusyId(tx.id)
    try {
      await applyReplacementAuthority(tx, candidate)
      toast.success(`${tx.type} ${tx.serialNo} re-linked to ${candidate.aiNumber ?? candidate.siaNumber}`)
      setSuggestFor(null)
    } catch (err) {
      console.error(err)
      toast.error('Re-link failed - check console')
    } finally { setBusyId(null) }
  }

  const handleMove = async () => {
    const { tx, destId } = moveFor
    setMoveFor(null)
    setBusyId(tx.id)
    try {
      const res = await moveTransactionForAuthority(tx, destId, { changeSerial, actor: user?.uid ?? null })
      toast.success(`Moved to ${whName(destId)}${res.newSerial ? ` as ${res.newSerial}` : ''}`)
    } catch (err) {
      toast.error(err.message || 'Move failed')
    } finally { setBusyId(null); setChangeSerial(false) }
  }

  const authorityWarehouse = group?.authority?.assignedWarehouse ?? null
  const userCanUse = (id) => id && (isAdmin || warehouseIds.includes(id))

  return createPortal(
    <div
      className={`fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-app-text">
              {group ? `${group.authority.type} ${group.number}` : 'Authority review'} {group?.kind === 'missing' ? 'no longer in the Sheet' : 'was changed'}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">Review each transaction below. Nothing changes until you act on it.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400 active:scale-90"><X size={18} /></button>
        </div>

        {group && (
          <div className="overflow-y-auto px-4 py-3">
            {group.kind === 'missing' ? (
              <p className="rounded-lg border border-brand-amber/40 bg-brand-amber/5 px-3 py-2 text-xs text-neutral-300">
                This authority number can no longer be found in the Google Sheet - it was probably renumbered or replaced.
                Use <b>Find replacement</b> on each transaction to link it to the new authority, or <b>Verify</b> if it should stay as is.
              </p>
            ) : (
              <ul className="space-y-1 rounded-lg border border-brand-amber/40 bg-brand-amber/5 px-3 py-2 text-xs text-neutral-300">
                {group.changes.map((c, i) => <li key={i}>• {describeChange(c)}</li>)}
              </ul>
            )}

            <p className="mt-3 text-xs font-semibold uppercase text-neutral-500">{group.transactions.length} transaction{group.transactions.length === 1 ? '' : 's'} to review</p>
            <ul className="mt-1 space-y-2">
              {group.transactions.map((tx) => {
                const canMove = tx.type !== 'ESR' && tx.type !== 'ESI' && authorityWarehouse && authorityWarehouse !== tx.warehouseId && userCanUse(tx.warehouseId) && userCanUse(authorityWarehouse)
                return (
                  <li key={tx.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                    <p className="text-sm font-semibold text-app-text">{tx.type} {tx.serialNo}</p>
                    <p className="text-xs text-neutral-500">
                      {tx.date} · {whName(tx.warehouseId)}
                      {tx.numberOfBags != null && ` · ${fmt(tx.numberOfBags)} bags`}
                      {tx.netKilos != null && ` · ${fmt(tx.netKilos)} kg`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" className={btn} onClick={() => handleOpen(tx)}>Open</button>
                      <button type="button" className={btnPrimary} disabled={busyId === tx.id} onClick={() => handleVerify(tx)}>
                        {group.kind === 'missing' ? 'Keep as is' : 'Verify OK'}
                      </button>
                      <button type="button" className={btn} disabled={busyId === tx.id} onClick={() => handleSuggest(tx)}>Find replacement</button>
                      {canMove && (
                        <button type="button" className={btn} disabled={busyId === tx.id} onClick={() => { setChangeSerial(false); setMoveFor({ tx, destId: authorityWarehouse }) }}>
                          Move to {whName(authorityWarehouse)}
                        </button>
                      )}
                    </div>

                    {suggestFor === tx.id && (
                      <div className="mt-2 space-y-1.5 border-t border-neutral-800 pt-2">
                        {candidates.length === 0 ? (
                          <p className="text-xs text-neutral-500">No close match found among recent authorities. Ask the admin which authority this became.</p>
                        ) : candidates.map((c) => (
                          <div key={c.authority.authId} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-app-text">{c.authority.type} {c.authority.aiNumber ?? c.authority.siaNumber} · {whName(c.authority.assignedWarehouse)}</span>
                              <button type="button" className={btnPrimary} disabled={busyId === tx.id} onClick={() => handleRelink(tx, c.authority)}>Link</button>
                            </div>
                            <p className="mt-1 text-neutral-500">{c.authority.customerName ?? ''} · match {c.score}: {c.reasons.join(', ')}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(moveFor)}
        title={moveFor ? `Move ${moveFor.tx.type} ${moveFor.tx.serialNo} to ${whName(moveFor.destId)}?` : ''}
        description="The transaction leaves its current warehouse; pile balances are recomputed on both sides and the Google Sheet row's warehouse is updated. The pile keeps the same name (created at the destination if missing)."
        confirmLabel="Move"
        destructive={false}
        onConfirm={handleMove}
        onCancel={() => setMoveFor(null)}
      >
        <label className="mt-3 flex items-start gap-2 text-xs text-neutral-400">
          <input type="checkbox" checked={changeSerial} onChange={(e) => setChangeSerial(e.target.checked)} className="mt-0.5 accent-brand-neon" />
          <span>Give it the next serial number of that warehouse's own series. Keep this off to keep the current serial. If on, the paper document must be reissued and the old Sheet row needs manual cleanup.</span>
        </label>
      </ConfirmDialog>
    </div>,
    document.body
  )
}

export default AuthorityReviewModal
