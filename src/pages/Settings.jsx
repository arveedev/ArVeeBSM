// Settings — client configuration toggles, session profile, logout, and
// per-warehouse sack beginning balance entry.

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery, useObservable } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, ShieldCheck, User, Clock, Check, X, Trash2, Wallet, History } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { db, lastSyncErrorDetail } from '../db/dexie.js'
import { fmtBags, fmtWeight } from '../utils/calculations.js'
import { fuzzyContains } from '../utils/fuzzySearch.js'
import { computeCashOnHand } from '../utils/sdoCalculations.js'
import { recalculatePileCurrentState } from '../utils/pileLedger.js'
import useDelayedUnmount from '../hooks/useDelayedUnmount.js'
import { inputClass, labelClass, primaryButtonClass, byAlpha, editIconClass, deleteIconClass } from '../components/common/admin/shared.js'
import { SacksBeginningBalances } from '../components/common/admin/BeginningBalancesPanel.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'
import Avatar from '../components/common/Avatar.jsx'
import AvatarPickerModal from '../components/common/AvatarPickerModal.jsx'
import CreateEditPileModal from '../components/common/CreateEditPileModal.jsx'
import EditBeginningBalanceModal from '../components/common/EditBeginningBalanceModal.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import DenominationModal from '../components/common/sdo/DenominationModal.jsx'
import CashHistoryModal from '../components/common/sdo/CashHistoryModal.jsx'
import CancelPrModal from '../components/common/sdo/CancelPrModal.jsx'
import CashOnBankModal from '../components/common/sdo/CashOnBankModal.jsx'

const initialsOf = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

// Same category colors used elsewhere (HomePiles.jsx's own
// varietyBadgeClass/accentBarClass) - duplicated locally per this
// codebase's established convention for this small lookup.
const varietyBadgeClass = (category) => {
  if (category === 'Rice') return 'bg-blue-500/15 text-blue-400'
  if (category === 'Palay') return 'bg-brand-neon/15 text-brand-neon'
  if (category === 'By Products') return 'bg-brand-byproduct/15 text-brand-byproduct'
  return 'bg-neutral-800 text-neutral-300'
}

// A pile tile's own "NET KG" label already says what the value is -
// fmtWeight always appends a trailing "kg"/"MT" unit word, which is
// redundant directly under that label, so it's stripped back off here.
const fmtWeightValue = (kilos, unit) => fmtWeight(kilos, unit).replace(/\s*(kg|MT)$/, '')

function Toggle({ label, description, value, onChange, icon: Icon }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-neon/10 text-brand-neon">
            <Icon size={15} />
          </div>
        )}
        <div>
          <p className="text-base font-medium text-app-text">{label}</p>
          {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-brand-neon' : 'bg-neutral-700'
        }`}
      >
        <span
          // Concept K (picked) - the same spring overshoot curve used
          // elsewhere in the app (toast pop-in, the bottom-nav active
          // pill) instead of Tailwind's plain default ease, so the
          // thumb settles with a little life rather than a flat slide.
          className={`inline-block h-4 w-4 rounded-full bg-neutral-950 shadow transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

// SDO's own position/role (e.g. "Disbursing Officer II") - printed as
// the "Prepared By" position on the Abstract of Cereal Purchases export
// (AbstractExportModal.jsx), which always reads it live from this
// user's own record rather than a hardcoded label, so a person who
// holds a different title than the generic default sees their actual
// one on the document.
function SdoPositionSection({ userRecord, uid }) {
  const [position, setPosition] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setPosition(userRecord?.position ?? '')
  }, [userRecord?.position])

  const handleBlur = async () => {
    if (position === (userRecord?.position ?? '')) return
    setIsSaving(true)
    try {
      await db.users.update(uid, { position: position.trim() })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Position / Role</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Printed as your position on the Abstract of Cereal Purchases export.
      </p>
      <input
        type="text"
        value={position}
        onChange={(e) => setPosition(e.target.value)}
        onBlur={handleBlur}
        placeholder="Disbursing Officer"
        className={`${inputClass} mt-3`}
        disabled={isSaving}
      />
    </section>
  )
}

// Per explicit request: an SDO-personal toggle for how the exported
// Abstract's own Cash Reconciliation box reads. ON (default) keeps
// today's shape unchanged (COH — Fund Balance, each checked
// replenishment as its own line, a running TOTAL, then "This period's
// disbursements" and a final TOTAL). OFF collapses the whole COH/
// replenishment breakdown into one combined "Fund Balance" figure
// (same underlying math, just not broken out line by line), and
// relabels "This period's disbursements" to "This Period's
// Replenishment" - both figures unchanged either way, only what's
// shown/labeled differs. Stored directly on this SDO's own user
// record (db.users), the same pattern as Position/Role just above -
// each SDO's own preference for their own exports, not a global
// setting.
function SdoAbstractDisplaySection({ userRecord, uid }) {
  const showReplenishmentDetails = userRecord?.showReplenishmentDetails !== false

  const toggle = async () => {
    await db.users.update(uid, { showReplenishmentDetails: !showReplenishmentDetails })
  }

  return (
    <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-app-text">Abstract Cash Details</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Show the COH/replenishment breakdown on the exported Abstract, or collapse it into one Fund Balance figure.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={showReplenishmentDetails}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            showReplenishmentDetails ? 'bg-brand-neon' : 'bg-neutral-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-neutral-950 shadow transition-transform ${
              showReplenishmentDetails ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p className="mt-2 text-xs font-medium text-neutral-400">
        {showReplenishmentDetails ? 'Showing full breakdown' : 'Showing combined Fund Balance only'}
      </p>
    </section>
  )
}

// Cash Balance (denomination count) + Cash History - moved here from
// SdoHome.jsx per explicit request: Home stays focused on today's
// actions (Replenish/Liquidate against a live Cash on Hand figure),
// while reviewing/correcting past entries is an account-settings
// concern, same as everything else on this page. Needs its own Cash on
// Hand figure (not passed down from Home, which no longer renders this)
// - computed the same way SdoHome.jsx does, from this SDO's own ledger
// and Active Purchase Receipts.
function SdoCashSection({ uid }) {
  const [openModal, setOpenModal] = useState(null) // 'denomination' | 'history' | 'cancelPr' | null

  const activePrs = useLiveQuery(
    () => db.purchaseReceipts.where('[sdoUid+status]').equals([uid, 'Active']).toArray(),
    [uid]
  ) ?? []
  const ledgerEntries = useLiveQuery(() => db.cashLedgerV2.where('sdoUid').equals(uid).toArray(), [uid]) ?? []
  const cashOnHand = computeCashOnHand(ledgerEntries, activePrs.map((pr) => pr.totalAmount ?? 0))

  // Confirmed real correction: Cash on Bank is NOT per-SDO - it's one
  // shared, branch-wide figure every SDO is jointly responsible for
  // monitoring, any of them can update it, and it should read the same
  // for all of them. Lives on db.reportConfig's 'global' singleton
  // (same place purityDisplayFormat/dataStartDate/signatories already
  // do), not on the individual user record. cashOnBankUpdatedAt/
  // cashOnBankUpdatedBy record who last touched it and when, so both
  // this screen and the Admin/Visitor Procurement tab's
  // SdoCashOverviewPanel.jsx can show that alongside the amount.
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const cashOnBank = config?.cashOnBank ?? 0
  const [editingBank, setEditingBank] = useState(false)

  const cashOnBankUpdatedLabel = config?.cashOnBankUpdatedAt
    ? `Updated by ${config.cashOnBankUpdatedBy || 'Unknown'} on ${new Date(config.cashOnBankUpdatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Not set yet'

  return (
    <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Cash Balance</h2>
      <p className="mt-1 text-xs text-neutral-500">Current Cash on Hand and every Replenish/Liquidate entry behind it.</p>
      <p className="mt-2 text-2xl font-bold text-app-text">₱{cashOnHand.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>

      {/* Per explicit request, edited the same way Buying Price is - its
          own modal (CashOnBankModal.jsx), opened by tapping this card,
          not an inline pencil-edit row. */}
      <button
        type="button"
        onClick={() => setEditingBank(true)}
        className="mt-4 w-full rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-left transition-all hover:border-brand-neon/50 active:scale-[0.98]"
      >
        <p className="text-[10px] font-bold uppercase text-neutral-500">Cash on Bank</p>
        <p className="mt-1.5 text-xl font-bold tabular-nums text-app-text">₱{cashOnBank.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        <p className="mt-1 text-xs text-neutral-500">{cashOnBankUpdatedLabel}</p>
      </button>

      {editingBank && <CashOnBankModal current={config} onClose={() => setEditingBank(false)} />}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOpenModal('denomination')}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-app-text transition-all hover:border-brand-neon/50 active:scale-[0.97]"
        >
          <Wallet size={20} className="text-brand-neon" />
          <span className="text-xs font-semibold">Denomination Count</span>
        </button>
        <button
          type="button"
          onClick={() => setOpenModal('history')}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-app-text transition-all hover:border-brand-neon/50 active:scale-[0.97]"
        >
          <History size={20} className="text-brand-neon" />
          <span className="text-xs font-semibold">Cash History</span>
        </button>
      </div>

      {/* Per explicit request, moved here from SdoHome.jsx - cancels a
          PR by number alone, no reason required: an issued PR is
          cancelled in place, a never-issued number is reserved straight
          as cancelled. Either way it prints on the Abstract as CANCELLED. */}
      <button
        type="button"
        onClick={() => setOpenModal('cancelPr')}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-brand-crimson transition-all hover:border-brand-crimson/50 active:scale-[0.97]"
      >
        <Trash2 size={20} />
        <span className="text-xs font-semibold">Cancel PR</span>
      </button>

      {openModal === 'denomination' && <DenominationModal currentCashOnHand={cashOnHand} onClose={() => setOpenModal(null)} />}
      {openModal === 'history' && <CashHistoryModal onClose={() => setOpenModal(null)} />}
      {openModal === 'cancelPr' && <CancelPrModal onClose={() => setOpenModal(null)} />}
    </section>
  )
}

// Classifier is a signatory-only name (not a login user) shown as
// "Prepared by" on the Pile Layout report. Any user with access to this
// warehouse can set it, not just admins.
function ClassifierSection({ warehouseId }) {
  const [name, setName] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  // Briefly true right after a successful save - the Update/Save button
  // morphs into a checkmark for a moment (same spring-overshoot pop
  // already used elsewhere, e.g. toast pop-in) before the row switches
  // back to its read-only display, instead of vanishing instantly.
  const [justSaved, setJustSaved] = useState(false)
  const containerRef = useRef(null)

  const warehouse = useLiveQuery(() => db.warehouses.get(warehouseId), [warehouseId])
  const savedName = warehouse?.classifierName ?? ''

  // Same "already used elsewhere" name-suggestion pattern as
  // CustomerNameAutocomplete.jsx, reused here so a classifier name
  // already saved on another warehouse doesn't get re-typed as a
  // slightly different variant by accident. db.warehouses is small
  // (one row per warehouse) - a live query over the whole table plus an
  // inline filter is cheap, no need for the debounced async search
  // customerDirectory.js's db.customers lookups use for a much bigger
  // table.
  const allWarehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const classifierSuggestions = (() => {
    const q = name.trim().toLowerCase()
    if (q.length < 2) return []
    const seen = new Set()
    const results = []
    for (const w of allWarehouses) {
      const cn = w.classifierName
      if (!cn || w.warehouseId === warehouseId) continue
      const key = cn.toLowerCase()
      if (key === q || seen.has(key) || !fuzzyContains(key, q)) continue
      seen.add(key)
      results.push(cn)
      if (results.length >= 6) break
    }
    return results
  })()

  useEffect(() => {
    setName(savedName)
    // A saved name displays as a read-only row (with Edit/Delete); an
    // empty one always shows the input directly, so there's no
    // reason to sit in "edit mode" once a name is actually present.
    setIsEditing(!savedName)
  }, [savedName])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const showInputTarget = isEditing || !savedName
  // Keeps the input+buttons block mounted for one beat after
  // showInputTarget flips false, so its own exit animation (below) has
  // time to actually play before the read-only label+pencil row takes
  // its place - without this the block would just vanish instantly.
  // Same animate-flow-down/animate-flow-up-exit pair (paired with this
  // exact hook) already used elsewhere in the app (e.g. AuthorityMonitor
  // used to use it) - a plain CSS `animation`, not a two-frame
  // JS-driven transition, so it can't silently fail to ever start the
  // way the grid-template-rows version this replaced sometimes did.
  const shouldRenderInputBlock = useDelayedUnmount(showInputTarget, 250)

  const handleSave = async () => {
    setIsSaving(true)
    await db.warehouses.update(warehouseId, { classifierName: name.trim() || null })
    toast.success(savedName ? 'Classifier updated' : 'Classifier saved')
    setIsSaving(false)
    // Cancel shrinks away (its own maxWidth/opacity transition below)
    // while Update/Save grows to fill the row (it's flex-1, so this
    // happens automatically as Cancel's width collapses) and morphs
    // into a checkmark - held on screen for one beat, then the whole
    // block plays its exit animation (isEditing -> false) before
    // finally swapping back to the read-only label+pencil row.
    setJustSaved(true)
    setTimeout(() => {
      setIsEditing(false)
      setJustSaved(false)
    }, 550)
  }

  // Reverts to the last saved name and exits edit mode without saving -
  // only shown once there's actually a saved name to go back to (a
  // brand-new, never-saved classifier has nothing for Cancel to
  // restore, so Save is the only real option there).
  const handleCancel = () => {
    setName(savedName)
    setShowSuggestions(false)
    setIsEditing(false)
  }

  return (
    <div className="mt-6">
      <h2 className="text-base font-semibold text-app-text">Classifier</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Shown as "Prepared by" on this warehouse's Pile Layout report.
      </p>

      {shouldRenderInputBlock && (
        <div className={showInputTarget ? 'animate-flow-down' : 'animate-flow-up-exit'}>
            <div ref={containerRef} className="relative mt-3">
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                className={`w-full ${inputClass} ${name ? 'pr-9' : ''} ${!name.trim() ? '!border-brand-amber' : ''}`}
                placeholder="Full name"
                autoComplete="off"
              />
              {/* Clears the field back to blank in one tap - a quicker
                  way to retype the name than selecting/backspacing it
                  by hand, per explicit request. */}
              {name && (
                <button
                  type="button"
                  onClick={() => setName('')}
                  aria-label="Clear"
                  className="absolute bottom-2.5 right-3 text-brand-crimson"
                >
                  <X size={16} />
                </button>
              )}
              {showSuggestions && classifierSuggestions.length > 0 && (
                <ul className="absolute z-10 mt-1.5 max-h-72 w-full divide-y divide-neutral-800 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/50">
                  {classifierSuggestions.map((cn) => (
                    <li key={cn}>
                      <button
                        type="button"
                        onClick={() => {
                          setName(cn)
                          setShowSuggestions(false)
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-800 active:bg-neutral-800"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-neutral-300">
                          {initialsOf(cn) || <User size={14} />}
                        </span>
                        <span className="truncate text-sm text-app-text">{cn}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!name.trim() && (
              <p className="mt-1 text-xs text-brand-amber">A classifier name is needed.</p>
            )}

            {/* Update/Cancel row plays its own entrance animation
                staggered ~150ms behind the input above (via
                animationDelay), so the input appears first and the
                buttons grow in beneath it a beat later, rather than
                everything appearing at once. Only on entrance - it
                doesn't need its own separate exit, since the OUTER
                block's animate-flow-up-exit already carries everything
                (input + this row) out together when editing ends. */}
            <div className={`mt-2 flex gap-2 ${showInputTarget ? 'animate-flow-down' : ''}`} style={showInputTarget ? { animationDelay: '150ms' } : undefined}>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !name.trim() || justSaved}
                className={`flex flex-1 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-all ${
                  justSaved
                    ? 'border border-brand-neon bg-brand-neon/10 text-brand-neon'
                    : name.trim() ? 'border border-brand-neon text-brand-neon' : 'border border-brand-neon/40 text-brand-neon/40'
                }`}
              >
                {justSaved ? <Check size={18} className="animate-pop-in" /> : (savedName ? 'Update' : 'Save')}
              </button>
              {/* Only shown once there's a saved name to revert to
                  (handleCancel's own comment) - shrinks to nothing as
                  justSaved flips true, with Update/Save (flex-1)
                  growing to fill the row it leaves behind. */}
              {savedName && (
                <div
                  className="overflow-hidden transition-all duration-300 ease-out"
                  style={{ maxWidth: justSaved ? '0px' : '96px', opacity: justSaved ? 0 : 1 }}
                >
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="whitespace-nowrap rounded-xl border border-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-400 transition-all hover:border-neutral-600 hover:text-app-text"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
        </div>
      )}

      {!shouldRenderInputBlock && (
        <div className="animate-fade-in mt-3 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
          <span className="text-base text-app-text">{savedName}</span>
          {/* Delete removed - the only real action here is edit (which
              already shows an editable, clearable input pre-filled with
              the current name), so a separate destructive button next
              to it added a second control for what's really one action. */}
          <button type="button" onClick={() => setIsEditing(true)} aria-label="Edit" className="rounded-lg p-2 text-brand-neon transition-all hover:text-app-text active:scale-90">
            <Pencil size={20} />
          </button>
        </div>
      )}
    </div>
  )
}

// Existing piles list - tapping "+ Create Pile" opens CreateEditPileModal
// in create mode, tapping a row opens the same modal pre-filled to edit
// that pile's metadata (name/category/variety/purity/condition/dates).
// Bags/kilos/age stay exclusively owned by Beginning Balances - see
// CreateEditPileModal.jsx's own top comment for why editing here never
// touches them.
function PileListSection({ warehouseId, onCreatePile, onEditPile }) {
  const { weightUnit } = useSettings() ?? {}
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const piles = useLiveQuery(
    () => (warehouseId ? db.piles.where('warehouseId').equals(warehouseId).toArray() : []),
    [warehouseId]
  ) ?? []
  // Closed piles are excluded here - per explicit request, this list is
  // for renaming/editing piles still in use, and would otherwise only
  // ever grow longer over time as more piles get closed. Closing and
  // re-opening a pile already live elsewhere (Piles.jsx, Beginning
  // Balances), where a closed pile IS still shown.
  const sortedPiles = [...piles].filter((p) => !p.closedDate).sort((a, b) => byAlpha(a.pileName, b.pileName))

  // Delete was reported missing from this list entirely (it only lived
  // inside CreateEditPileModal's own kebab menu, one extra tap away) -
  // added back here as its own icon, always with a confirmation first,
  // same check-for-real-history + ConfirmDialog pattern already used
  // there and everywhere else a pile can be deleted from.
  const [pendingDelete, setPendingDelete] = useState(null)
  // Same guard as CreateEditPileModal.jsx/BeginningBalancesPanel.jsx's own
  // confirmDelete - a pile with real stock left must be Closed (writes
  // off the balance correctly, on the still-existing record) before it
  // can be deleted, never deleted outright.
  const confirmDelete = async (pile) => {
    const { bags, kilos } = await recalculatePileCurrentState(pile.pileId)
    if (bags > 0 || kilos > 0.01) {
      toast.error('This pile still has stock on hand - Close it first (writes off the remaining balance correctly), then delete it.')
      return
    }
    const others = await db.transactions
      .where('pileId').equals(pile.pileId)
      .and((t) => !t.isInitialBalance)
      .count()
    setPendingDelete({ ...pile, hasHistory: others > 0 })
  }
  const handleDeleteConfirmed = async () => {
    const pile = pendingDelete
    setPendingDelete(null)
    const linkedBox = await db.pileLayoutBoxes.where('pileId').equals(pile.pileId).first()
    if (linkedBox) await db.pileLayoutBoxes.update(linkedBox.id, { pileId: null, label: null })
    await db.piles.delete(pile.pileId)
    toast.success(`Pile "${pile.pileName}" deleted - its transactions were kept`)
  }

  return (
    <div className="mt-6">
      <button type="button" onClick={onCreatePile} className={`w-full ${primaryButtonClass}`}>
        + Create Pile
      </button>

      {/* Renaming an existing pile (or fixing its variety/purity/dates)
          is only ever exposed here, not on Piles.jsx or Beginning
          Balances - those cover the pile's balance and layout
          placement, not its identity. Close still lives in the Edit
          Pile modal's own kebab menu; Delete is repeated here too (see
          confirmDelete above) since it was reported missing from this
          list. Each row is a card (name/variety + edit/delete icons up
          top, current Bags/Net Kg as their own stacked tiles below)
          rather than a single plain text line, so the figures
          Beginning Balances' own now-removed list used to show are
          still visible at a glance here. */}
      <ul className="mt-3 space-y-2">
        {sortedPiles.length === 0 && <p className="py-3 text-center text-sm text-neutral-500">No piles in this warehouse yet.</p>}
        {sortedPiles.map((p) => {
          const category = varietyMap.get(p.varietyId)?.category ?? p.cerealType
          const varietyLabel = varietyMap.get(p.varietyId)?.name ?? category
          return (
          <li key={p.pileId} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex items-center gap-2">
              {/* Tapping the name/variety or the tiles below both open
                  Edit Pile - only the trailing icons are their own
                  distinct buttons now, so Delete has room to exist
                  alongside Edit without nesting a button inside one. */}
              <button
                type="button"
                onClick={() => onEditPile(p)}
                aria-label={`Edit ${p.pileName}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <p className="truncate text-lg font-medium text-app-text">{p.pileName}</p>
                {varietyLabel && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-semibold ${varietyBadgeClass(category)}`}>
                    {varietyLabel}
                  </span>
                )}
              </button>
              <button type="button" onClick={() => onEditPile(p)} aria-label={`Edit ${p.pileName}`} className={editIconClass}>
                <Pencil size={22} />
              </button>
              <button type="button" onClick={() => confirmDelete(p)} aria-label={`Delete ${p.pileName}`} className={deleteIconClass}>
                <Trash2 size={22} />
              </button>
            </div>
            <button type="button" onClick={() => onEditPile(p)} aria-label={`Edit ${p.pileName}`} className="mt-2 grid w-full grid-cols-2 gap-2 text-left">
              <div className="rounded-lg bg-neutral-950 py-2 text-center">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Bags</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtBags(p.currentBags ?? 0)}</p>
              </div>
              <div className="rounded-lg bg-neutral-950 py-2 text-center">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Net Kg</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtWeightValue(p.currentKilos ?? 0, weightUnit)}</p>
              </div>
            </button>
          </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete pile "${pendingDelete?.pileName}"?`}
        description={
          pendingDelete?.hasHistory
            ? 'This pile has real transactions beyond its beginning balance - those transactions are NOT deleted and stay in the system permanently, still linked to this pile ID. Only the pile record itself (and its layout box, if any) is removed. This cannot be undone.'
            : 'This cannot be undone.'
        }
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function Settings() {
  const { user } = useAuth()
  const { autoAgeMonitoring, updateSetting } = useSettings() ?? {}
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } = useWarehouse() ?? {}
  const { setPageHeader, headerHeight, stickyIndicatorHeight } = usePageHeader() ?? {}
  const warehouseSectionRef = useRef(null)
  const pileCardRef = useRef(null)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const userRecord = useLiveQuery(() => (user?.uid ? db.users.get(user.uid) : null), [user?.uid])
  // 'stocks' | 'sacks' - Create Pile only ever lives under Stocks.
  const [stockTab, setStockTab] = useState('stocks')
  // null | { mode: 'create' } | { mode: 'edit', pile }
  const [pileModal, setPileModal] = useState(null)
  // The pile whose beginning balance is being edited, if any - set by
  // CreateEditPileModal's own "Edit balance ->" link, which closes
  // that modal and opens EditBeginningBalanceModal for this pile.
  const [balancePile, setBalancePile] = useState(null)
  const cloudUser = useObservable(db.cloud.currentUser)
  const cloudSyncState = useObservable(db.cloud.syncState)
  // Green: genuinely connected and in-sync. Red: disconnected or
  // erroring outright. Amber: anything transient/in-progress in
  // Green: status is genuinely connected, regardless of phase -
  // pushing/pulling is normal, healthy, active work, not a problem to
  // alarm a field user over. Red: disconnected or erroring outright.
  // Amber: state not yet established at all.
  const syncStatusColor = (() => {
    if (!cloudSyncState) return 'amber'
    if (cloudSyncState.phase === 'error' || cloudSyncState.status === 'disconnected' || cloudSyncState.status === 'error') return 'red'
    if (cloudSyncState.status === 'connected') return 'green'
    return 'amber'
  })()
  const syncBorderClass = {
    green: 'border-brand-neon/40',
    red: 'border-brand-crimson/40',
    amber: 'border-brand-amber/40',
  }[syncStatusColor]
  const syncBgClass = {
    green: 'bg-brand-neon/10',
    red: 'bg-brand-crimson/10',
    amber: 'bg-brand-amber/10',
  }[syncStatusColor]
  const localUsersCount = useLiveQuery(() => db.users.count(), [])
  const localPilesCount = useLiveQuery(() => db.piles.count(), [])
  const localVarietiesCount = useLiveQuery(() => db.varietyTypes.count(), [])
  // Read-only count of this device's own not-yet-pushed authority writes.
  // dexie-cloud-addon keeps them in an internal `$authorities_mutations`
  // table (confirmed against its own source - getMutationTable() returns
  // `$${tableName}_mutations`) and, per that same source, always pushes
  // the ENTIRE backlog in one request with no chunking - so a device that
  // ever queues more than the server's per-request size allows gets stuck
  // retrying that same oversized push forever ("HTTP 413: request entity
  // too large", first seen right after 1.10-55's legitimate ~1000-record
  // date backfill). This number is what actually explains that error,
  // instead of guessing at it again from the outside.
  const pendingAuthorityMutations = useLiveQuery(async () => {
    try {
      return await db.table('$authorities_mutations').count()
    } catch {
      return null
    }
  }, [])
  // These are the only fields our own sync code never overwrites from
  // the Sheet - a real local write (a WSI/ESI form recording issuance,
  // or an authority manually marked complete) touches one of these with
  // a value that genuinely differs from what's already there. Everything
  // else on an authority is purely re-derived from the Sheet, so losing
  // a QUEUED (not yet pushed) copy of a Sheet-derived value costs
  // nothing - the Sheet is still there and every device, including this
  // one, re-arrives at the same value on its own.
  //
  // First pass at this classifier (1.10-59) checked only whether a
  // patch's KEYS included one of these fields - and found 0 of 22,470
  // entries safe. Root cause: the code that generated this backlog (any
  // pass before 1.10-56) always included totalIssuedBags/
  // totalIssuedKilos/manuallyCompleted in EVERY update call, unconditionally
  // re-echoing whatever `existing` already held - so every single old
  // entry LOOKED like it touched a business field, even though none of
  // them ever changed the actual value. Fixed by comparing the patch's
  // VALUE for each business field against the authority's CURRENT local
  // value (passed in as `authorityMap`, built once from a single
  // bulkGet rather than one lookup per mutation) - only a genuine value
  // difference counts as a real write now.
  const AUTHORITY_BUSINESS_FIELDS = ['totalIssuedBags', 'totalIssuedKilos', 'manuallyCompleted', 'status']
  const sackLineKey = (l) => `${l?.sackTypeId}::${l?.condition}`
  const sackLinesUnchanged = (patchLines, currentLines) => {
    if (!Array.isArray(patchLines)) return false
    const currentByKey = new Map((currentLines ?? []).map((l) => [sackLineKey(l), l]))
    return patchLines.every((line) => {
      const match = currentByKey.get(sackLineKey(line))
      return match && match.totalIssuedBags === line.totalIssuedBags
    })
  }
  // 1.10-60's value-comparison fix still reported 0/22,470 safe, and
  // this version's own first attempt (assuming a canonicalized
  // `{type: 'update', keys, changeSpecs}` shape, matching what
  // dexie-cloud-addon's PUSH-time code builds) reported 22,470
  // "unrecognized" - every single entry. That was the real tell: this
  // reads the RAW table, not what gets built transiently at push time.
  // Traced into Dexie CORE's own source (not the addon) to find the
  // actual mechanism: `Table.prototype.update(key, changes)` is
  // implemented as `this.where(':id').equals(key).modify(changes)` -
  // ALWAYS a criteria-based `modify`, never a plain `update`/`put`. The
  // addon's mutation tracker records that as
  // `{ type: 'modify', keys, criteria, changeSpec }` - `changeSpec`
  // SINGULAR (one shared patch, not one per key) and `criteria` present
  // (canonicalized to `index: null` when it's on the primary key, exactly
  // what `.where(':id').equals(key)` produces). Every
  // upsertAuthority/upsertSiaAuthority write in this codebase uses this
  // exact `.update(authId, patch)` form, so this is the one shape that
  // actually matters here.
  //
  // classifyMutation returns WHY, not just yes/no: 'safe' (every
  // business field unchanged from the authority's current value),
  // 'orphaned' (the row no longer exists locally at all - most likely
  // deleted later as a stale duplicate by pickCanonicalAuthority +
  // bulkDelete, which ran on every pass across this incident; a mutation
  // for an already-deleted row can never be actionable, since dedup
  // already decided a different record holds the real state),
  // 'business-differs' (a real write - always kept), or 'unrecognized'
  // (anything that doesn't match the one confirmed shape - always kept,
  // fail closed).
  const classifyMutation = (mut, authorityMap) => {
    if (mut?.type !== 'modify' || !Array.isArray(mut.keys) || !mut.changeSpec || typeof mut.changeSpec !== 'object') {
      return 'unrecognized'
    }
    const spec = mut.changeSpec
    let anyOrphaned = false
    for (const key of mut.keys) {
      const current = authorityMap.get(key)
      if (!current) {
        anyOrphaned = true
        continue
      }
      for (const field of AUTHORITY_BUSINESS_FIELDS) {
        if (field in spec && spec[field] !== current[field]) return 'business-differs'
      }
      if ('sackLines' in spec && !sackLinesUnchanged(spec.sackLines, current.sackLines)) return 'business-differs'
    }
    return anyOrphaned ? 'orphaned' : 'safe'
  }
  const [backlogReport, setBacklogReport] = useState(null)
  const [inspectingBacklog, setInspectingBacklog] = useState(false)
  const [confirmClearBacklog, setConfirmClearBacklog] = useState(false)
  const [clearingBacklog, setClearingBacklog] = useState(false)
  const buildAuthorityMap = async (mutations) => {
    const uniqueKeys = new Set()
    for (const mut of mutations) {
      if (Array.isArray(mut?.keys)) mut.keys.forEach((k) => uniqueKeys.add(k))
    }
    const keyList = [...uniqueKeys]
    const rows = await db.authorities.bulkGet(keyList)
    const map = new Map()
    keyList.forEach((key, i) => { if (rows[i]) map.set(key, rows[i]) })
    return map
  }
  const inspectBacklog = async () => {
    setInspectingBacklog(true)
    try {
      const all = await db.table('$authorities_mutations').toArray()
      const authorityMap = await buildAuthorityMap(all)
      const counts = { safe: 0, orphaned: 0, 'business-differs': 0, unrecognized: 0 }
      for (const mut of all) {
        counts[classifyMutation(mut, authorityMap)] += 1
      }
      setBacklogReport({
        total: all.length,
        safeToClear: counts.safe,
        orphaned: counts.orphaned,
        mustKeep: counts['business-differs'],
        unrecognized: counts.unrecognized,
      })
    } finally {
      setInspectingBacklog(false)
    }
  }
  // Orphaned entries clear alongside safe ones: a mutation whose row no
  // longer exists locally at all can never be actionable business data -
  // pickCanonicalAuthority already decided a DIFFERENT record holds the
  // real merged state when it deleted this one as a stale duplicate.
  const clearSafeBacklog = async () => {
    setClearingBacklog(true)
    try {
      const all = await db.table('$authorities_mutations').toArray()
      const authorityMap = await buildAuthorityMap(all)
      const removed = await db.table('$authorities_mutations')
        .filter((mut) => {
          const verdict = classifyMutation(mut, authorityMap)
          return verdict === 'safe' || verdict === 'orphaned'
        })
        .delete()
      toast.success(`Cleared ${removed} sync-noise entries. Real pending writes were left untouched.`)
      await inspectBacklog()
    } catch (err) {
      toast.error(`Could not clear backlog: ${err.message}`)
    } finally {
      setClearingBacklog(false)
      setConfirmClearBacklog(false)
    }
  }
  const [syncErrorDetail, setSyncErrorDetail] = useState(lastSyncErrorDetail.value)
  useEffect(() => {
    const interval = setInterval(() => setSyncErrorDetail(lastSyncErrorDetail.value), 1000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    setPageHeader?.({ title: 'Settings', subtitle: '' })
  }, [])

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  // SDO has no warehouse-operations work here - no pile/sack beginning
  // balances to enter, no per-warehouse Classifier, no age-monitoring
  // preference (that's a Home dashboard concern for warehouse roles).
  // This screen for them is just the profile card + sync status above.
  const isSdo = user?.role === 'SDO'

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
      {user && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <Avatar
            avatarBg={userRecord?.avatarBg}
            avatarFace={userRecord?.avatarFace}
            avatarAnim={userRecord?.avatarAnim}
            name={user.name}
            size={64}
            onClick={user.uid ? () => setAvatarPickerOpen(true) : undefined}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-app-text">{user.name}</p>
            <p className="text-xs text-neutral-400">{user.nickname} · {user.role}</p>
          </div>
          {/* Sync status folded in here as a small pill for ordinary
              users/visitors, instead of its own separate card below -
              admins keep the full diagnostic panel further down
              untouched, since that one carries real troubleshooting
              data a status pill can't replace. */}
          {user.role !== 'Admin' && (
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${syncBorderClass} ${syncBgClass} text-app-text`}>
              {!cloudSyncState
                ? 'Checking…'
                : cloudSyncState.status !== 'connected'
                  ? 'Offline'
                  : cloudSyncState.phase === 'in-sync'
                    ? 'Connected'
                    : 'Syncing…'}
            </span>
          )}
        </div>
      )}

      {user?.uid && (
        <AvatarPickerModal
          open={avatarPickerOpen}
          current={userRecord}
          name={user.name}
          onClose={() => setAvatarPickerOpen(false)}
          onSave={(avatar) => db.users.update(user.uid, avatar)}
        />
      )}

      {user?.role === 'Admin' && (
        <Link
          to="/admin"
          className="mt-4 flex items-center gap-3 rounded-2xl border-2 border-brand-neon bg-brand-neon/10 px-4 py-4 text-brand-neon shadow-[0_0_20px_-4px_rgba(0,255,163,0.4)] transition-transform active:scale-[0.98]"
        >
          <ShieldCheck size={28} className="shrink-0" />
          <div>
            <p className="text-base font-bold">Admin Dashboard</p>
            <p className="text-xs text-brand-neon/70">Warehouses, users, sheet sources, and more</p>
          </div>
        </Link>
      )}

      {user?.role === 'Admin' && (
        <div className={`mt-4 rounded-xl border ${syncBorderClass} ${syncBgClass} p-3`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-amber">Sync Identity (Diagnostic)</p>
          <p className="mt-1 text-xs text-neutral-400">
            Open this same screen on a different device and compare the values below - if they
            differ, that's why data isn't syncing between devices. Tap and hold any value to copy.
          </p>
          <div className="mt-2 space-y-1.5">
            <div>
              <p className="text-xs uppercase text-neutral-600">Local Users Count (read-only, no risk to check)</p>
              <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-app-text">
                {localUsersCount ?? '(loading)'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-600">Local Piles Count</p>
              <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-app-text">
                {localPilesCount ?? '(loading)'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-600">Local Varieties Count</p>
              <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-app-text">
                {localVarietiesCount ?? '(loading)'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-600">Database URL (should be the SAME on every device)</p>
              <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-app-text">
                {db.cloud.options?.databaseUrl ?? '(not configured)'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-600">Local Schema Version (should be 27 or higher)</p>
              <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-app-text">
                {db.verno}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-600">Sync Status</p>
              <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-app-text">
                {cloudSyncState ? `${cloudSyncState.phase} / ${cloudSyncState.status}` : '(not yet available)'}
              </p>
            </div>
            {pendingAuthorityMutations != null && (
              <div>
                <p className="text-xs uppercase text-neutral-600">
                  Pending Unsynced Authority Writes (large + stuck = the actual cause of a 413)
                </p>
                <p className={`select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm ${pendingAuthorityMutations > 300 ? 'text-brand-crimson' : 'text-app-text'}`}>
                  {pendingAuthorityMutations}
                </p>
              </div>
            )}
            {pendingAuthorityMutations > 300 && (
              <div className="rounded-lg border border-brand-crimson/30 bg-neutral-950 p-2.5">
                <p className="text-xs uppercase text-neutral-600">Stuck Backlog Cleanup</p>
                <p className="mt-1 text-xs text-neutral-400">
                  Inspects every pending entry and separates real local writes (issuance progress,
                  manually-completed authorities) from pure Sheet-sync noise. Only the noise can be
                  cleared - anything touching real data is always left alone. Clearing forgets this
                  device's copy of those sync corrections, not the data itself; the next sync pass
                  re-derives them from the Sheet the same way it already did once.
                </p>
                <button
                  type="button"
                  onClick={inspectBacklog}
                  disabled={inspectingBacklog}
                  className="mt-2 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-app-text active:scale-[0.98]"
                >
                  {inspectingBacklog ? 'Inspecting…' : 'Inspect Backlog'}
                </button>
                {backlogReport && (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-neutral-400">Total pending: <span className="font-mono text-app-text">{backlogReport.total}</span></p>
                    <p className="text-neutral-400">Safe sync noise (clearable): <span className="font-mono text-brand-neon">{backlogReport.safeToClear}</span></p>
                    <p className="text-neutral-400">Orphaned - row already deleted (clearable): <span className="font-mono text-brand-neon">{backlogReport.orphaned}</span></p>
                    <p className="text-neutral-400">Real writes (always kept): <span className="font-mono text-brand-amber">{backlogReport.mustKeep}</span></p>
                    {backlogReport.unrecognized > 0 && (
                      <p className="text-neutral-400">Unrecognized shape (always kept): <span className="font-mono text-brand-amber">{backlogReport.unrecognized}</span></p>
                    )}
                    {(backlogReport.safeToClear + backlogReport.orphaned) > 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmClearBacklog(true)}
                        disabled={clearingBacklog}
                        className="mt-1 rounded-lg bg-brand-crimson/20 px-3 py-1.5 text-xs font-semibold text-brand-crimson active:scale-[0.98]"
                      >
                        Clear {backlogReport.safeToClear + backlogReport.orphaned} Safe Entries
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {syncErrorDetail && (
              <div>
                <p className="text-xs uppercase text-neutral-600">Last Captured Sync Error (the actual reason, not just "error")</p>
                <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-brand-crimson">
                  {syncErrorDetail}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase text-neutral-600">userId</p>
              <p className="select-all break-all rounded-lg bg-neutral-950 px-2 py-1.5 font-mono text-sm text-app-text">
                {cloudUser?.userId ?? '(not yet connected)'}
              </p>
            </div>
          </div>
        </div>
      )}

      {isSdo && <SdoPositionSection userRecord={userRecord} uid={user.uid} />}
      {isSdo && <SdoAbstractDisplaySection userRecord={userRecord} uid={user.uid} />}
      {isSdo && <SdoCashSection uid={user.uid} />}

      {!isSdo && (
        <>
      <div ref={warehouseSectionRef}>
        {sortedWarehouses.length > 1 ? (
          <div className="mt-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-neon">Active Warehouse</label>
            <select
              value={currentWarehouseId ?? ''}
              onChange={(e) => setCurrentWarehouseId(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-3 text-lg font-semibold text-app-text outline-none focus:border-brand-neon"
            >
              {sortedWarehouses.map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>
        ) : currentWarehouse ? (
          <div className="mt-4 rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-neon">Active Warehouse</p>
            <p className="text-lg font-bold text-app-text">{currentWarehouse.code} — {currentWarehouse.name}</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">No warehouse assigned</p>
        )}
      </div>
      <StickyWarehouseIndicator targetRef={warehouseSectionRef} warehouse={currentWarehouse} />

      <div key={currentWarehouseId} className="animate-flow-down">
      <div className="mt-6 space-y-3">
        <h2 className="text-base font-semibold text-app-text">Preferences</h2>

        <Toggle
          label="Auto Age Monitoring"
          value={autoAgeMonitoring ?? true}
          onChange={(val) => updateSetting?.('autoAgeMonitoring', val)}
          icon={Clock}
        />
      </div>

      {currentWarehouseId && <ClassifierSection warehouseId={currentWarehouseId} />}

      {currentWarehouseId && (
        <div
          ref={pileCardRef}
          className="mt-6"
          style={{ scrollMarginTop: `${(headerHeight ?? 60) + (stickyIndicatorHeight ?? 0) + 24}px` }}
        >
          {/* Stocks/Sacks stay two separate tabs - Create Pile only ever
              lives under Stocks. Piles used to also duplicate a second
              full list under a "Beginning Balances" tab here; that's
              gone now (see PileListSection's own comment) - Stocks IS
              the one pile list, and balance editing is reached through
              CreateEditPileModal's own "Edit balance ->" link instead. */}
          <h2 className="text-lg font-semibold text-app-text">Beginning Balances</h2>
          <div className="relative mt-3 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
            <div
              className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
              style={{ transform: stockTab === 'stocks' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
            />
            <button
              type="button"
              onClick={() => setStockTab('stocks')}
              className={`relative z-10 flex-1 rounded-lg py-2 text-base transition-colors ${stockTab === 'stocks' ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400'}`}
            >
              Stocks
            </button>
            <button
              type="button"
              onClick={() => setStockTab('sacks')}
              className={`relative z-10 flex-1 rounded-lg py-2 text-base transition-colors ${stockTab === 'sacks' ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400'}`}
            >
              Sacks
            </button>
          </div>

          {/* Both stay mounted, toggled via a plain class rather than a
              key-based remount - remounting on every switch would
              restart each panel's useLiveQuery from undefined, flashing
              its empty state before real data replaced it. */}
          <div className={stockTab === 'stocks' ? '' : 'hidden'}>
            <PileListSection
              warehouseId={currentWarehouseId}
              onCreatePile={() => setPileModal({ mode: 'create' })}
              onEditPile={(pile) => setPileModal({ mode: 'edit', pile })}
            />
          </div>
          <div className={stockTab === 'sacks' ? 'mt-6' : 'hidden'}>
            <SacksBeginningBalances warehouseId={currentWarehouseId} />
          </div>
        </div>
      )}
      </div>

      {pileModal && (
        <CreateEditPileModal
          open
          warehouseId={currentWarehouseId}
          pile={pileModal.mode === 'edit' ? pileModal.pile : null}
          onClose={() => setPileModal(null)}
          onGoToBalance={(pile) => setBalancePile(pile)}
        />
      )}

      <EditBeginningBalanceModal
        open={Boolean(balancePile)}
        pile={balancePile}
        warehouseId={currentWarehouseId}
        onClose={() => setBalancePile(null)}
      />
        </>
      )}

      <ConfirmDialog
        open={confirmClearBacklog}
        title={`Clear ${(backlogReport?.safeToClear ?? 0) + (backlogReport?.orphaned ?? 0)} safe sync-noise entries?`}
        description="These entries never carried any real local write that's still actionable - either only Sheet-derived fields that will simply be re-fetched and re-written the next time this device syncs, or a row that's already been deleted locally as a duplicate. Real writes (issuance progress, manually-completed authorities) were already excluded and stay queued. This only affects this device's local sync queue - no other device is touched."
        onConfirm={clearSafeBacklog}
        onCancel={() => setConfirmClearBacklog(false)}
      />
    </div>
  )
}

export default Settings
