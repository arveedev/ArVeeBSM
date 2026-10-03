// Authority Links - Admin only, read-only. Two lists:
//  1. Orphaned linked documents: Active transactions whose AI/SIA number
//     matches no authority record at all.
//  2. Authorities flagged by the sync as changed or gone from the Sheet,
//     with how many transactions still await review (all warehouses).
// The users themselves are notified through the bell (AuthorityReviewModal);
// this is the admin's overview of the same problem.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { computeReviewGroups, scanOrphanTransactions } from '../../../utils/authorityReview.js'
import { secondaryButtonClass } from './shared.js'

function AuthorityLinksPanel() {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null) // { orphans, groups, warehouses }

  const handleScan = async () => {
    setScanning(true)
    try {
      const [orphans, groups, warehouses] = await Promise.all([
        scanOrphanTransactions(),
        computeReviewGroups({ isAdmin: true, warehouseIds: [] }),
        db.warehouses.toArray(),
      ])
      setResult({ orphans, groups, warehouses })
    } catch (err) {
      console.error(err)
      toast.error('Scan failed - check console')
    } finally {
      setScanning(false)
    }
  }

  const whName = (id) => result?.warehouses.find((w) => w.warehouseId === id)?.name ?? '—'

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Authority Links</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Finds transactions tied to an AI/SIA number that no longer matches any authority, and authorities that changed
        or left the Sheet after transactions were issued against them. Read-only - affected warehouse users are
        notified through the bell and fix their own transactions one by one. A renumber is only noticed after a full
        Sheet pull (Force Resync).
      </p>
      <button type="button" onClick={handleScan} disabled={scanning} className={`mt-3 w-full ${secondaryButtonClass} disabled:opacity-40`}>
        {scanning ? 'Scanning…' : 'Scan authority links'}
      </button>

      {result && (
        <div className="mt-3 space-y-4 text-xs">
          <div>
            <p className="text-sm font-medium text-app-text">
              {result.groups.length === 0 ? 'No authorities awaiting review.' : `${result.groups.length} authorit${result.groups.length === 1 ? 'y' : 'ies'} awaiting review`}
            </p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-neutral-400">
              {result.groups.map((g) => (
                <li key={g.key} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5">
                  <span className="font-semibold text-app-text">{g.authority.type} {g.number}</span>
                  {' '}· {g.kind === 'missing' ? 'no longer in the Sheet' : 'changed'} · {g.transactions.length} transaction{g.transactions.length === 1 ? '' : 's'} unreviewed
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium text-app-text">
              {result.orphans.length === 0 ? 'No orphaned linked documents.' : `${result.orphans.length} orphaned linked document${result.orphans.length === 1 ? '' : 's'}`}
            </p>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-neutral-400">
              {result.orphans.map(({ tx, kind, number }) => (
                <li key={tx.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5">
                  <span className="font-semibold text-app-text">{tx.type} {tx.serialNo}</span> · {tx.date} · {whName(tx.warehouseId)} · stale {kind} {number}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

export default AuthorityLinksPanel
