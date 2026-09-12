// Settings — client configuration toggles, session profile, logout, and
// per-warehouse sack beginning balance entry.

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery, useObservable } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, ShieldCheck, User, Clock, Check, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { db, lastSyncErrorDetail } from '../db/dexie.js'
import { fmtBags, fmtWeight } from '../utils/calculations.js'
import { inputClass, labelClass, primaryButtonClass, byAlpha, editIconClass } from '../components/common/admin/shared.js'
import { SacksBeginningBalances } from '../components/common/admin/BeginningBalancesPanel.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'
import Avatar from '../components/common/Avatar.jsx'
import AvatarPickerModal from '../components/common/AvatarPickerModal.jsx'
import CreateEditPileModal from '../components/common/CreateEditPileModal.jsx'
import EditBeginningBalanceModal from '../components/common/EditBeginningBalanceModal.jsx'

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
      if (key === q || seen.has(key) || !key.includes(q)) continue
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

  const handleSave = async () => {
    setIsSaving(true)
    await db.warehouses.update(warehouseId, { classifierName: name.trim() || null })
    toast.success(savedName ? 'Classifier updated' : 'Classifier saved')
    setIsSaving(false)
    setJustSaved(true)
    // Hold the checkmark on screen for one beat before switching to the
    // read-only row - immediately swapping would cut the morph off
    // before it's visible at all.
    setTimeout(() => {
      setJustSaved(false)
      setIsEditing(false)
    }, 500)
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

  const showInput = isEditing || !savedName

  return (
    <div className="mt-6">
      <h2 className="text-base font-semibold text-app-text">Classifier</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Shown as "Prepared by" on this warehouse's Pile Layout report.
      </p>

      {showInput ? (
        <div className="animate-fade-in">
          <div ref={containerRef} className="relative mt-3 flex gap-2">
            <div className="relative flex-1">
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
                <ul className="absolute z-10 mt-1.5 w-full divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/50">
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
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !name.trim() || justSaved}
              className={`flex items-center justify-center rounded-xl px-4 text-sm font-semibold transition-all ${
                justSaved
                  ? 'border border-brand-neon bg-brand-neon/10 text-brand-neon'
                  : name.trim() ? 'border border-brand-neon text-brand-neon' : 'border border-brand-neon/40 text-brand-neon/40'
              }`}
            >
              {justSaved ? <Check size={18} className="animate-pop-in" /> : (savedName ? 'Update' : 'Save')}
            </button>
            {/* Only shown once there's a saved name to revert to - see
                handleCancel's own comment. */}
            {savedName && !justSaved && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={isSaving}
                className="rounded-xl border border-neutral-800 px-4 text-sm font-medium text-neutral-400 transition-all hover:border-neutral-600 hover:text-app-text"
              >
                Cancel
              </button>
            )}
          </div>
          {!name.trim() && (
            <p className="mt-1 text-xs text-brand-amber">A classifier name is needed.</p>
          )}
        </div>
      ) : (
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

  return (
    <div className="mt-6">
      <button type="button" onClick={onCreatePile} className={`w-full ${primaryButtonClass}`}>
        + Create Pile
      </button>

      {/* Renaming an existing pile (or fixing its variety/purity/dates)
          is only ever exposed here, not on Piles.jsx or Beginning
          Balances - those cover the pile's balance and layout
          placement, not its identity. Edit only - Close/Delete live in
          the Edit Pile modal's own kebab menu now. Each row is a card
          (name/variety + edit pencil up top, current Bags/Net Kg as
          their own stacked tiles below) rather than a single plain
          text line, so the figures Beginning Balances' own now-removed
          list used to show are still visible at a glance here. */}
      <ul className="mt-3 space-y-2">
        {sortedPiles.length === 0 && <p className="py-3 text-center text-xs text-neutral-500">No piles in this warehouse yet.</p>}
        {sortedPiles.map((p) => {
          const category = varietyMap.get(p.varietyId)?.category ?? p.cerealType
          const varietyLabel = varietyMap.get(p.varietyId)?.name ?? category
          return (
          <li key={p.pileId}>
            <button
              type="button"
              onClick={() => onEditPile(p)}
              aria-label={`Edit ${p.pileName}`}
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left transition-colors hover:border-neutral-700"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                {/* Variety now shares the name's row as a colored pill
                    (same cereal-type color convention as the Pile
                    List's own accent bars - HomePiles.jsx's
                    varietyBadgeClass) instead of sitting on its own
                    plain-text line below. */}
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-base font-medium text-app-text">{p.pileName}</p>
                  {varietyLabel && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${varietyBadgeClass(category)}`}>
                      {varietyLabel}
                    </span>
                  )}
                </div>
                <span className={editIconClass}><Pencil size={20} /></span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-neutral-950 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-neutral-500">Bags</p>
                  <p className="mt-0.5 text-base font-bold tabular-nums text-app-text">{fmtBags(p.currentBags ?? 0)}</p>
                </div>
                <div className="rounded-lg bg-neutral-950 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-neutral-500">Net Kg</p>
                  <p className="mt-0.5 text-base font-bold tabular-nums text-app-text">{fmtWeightValue(p.currentKilos ?? 0, weightUnit)}</p>
                </div>
              </div>
            </button>
          </li>
          )
        })}
      </ul>
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
  const [syncErrorDetail, setSyncErrorDetail] = useState(lastSyncErrorDetail.value)
  useEffect(() => {
    const interval = setInterval(() => setSyncErrorDetail(lastSyncErrorDetail.value), 1000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    setPageHeader?.({ title: 'Settings', subtitle: '' })
  }, [])

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

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
          <div className="relative flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
            <div
              className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
              style={{ transform: stockTab === 'stocks' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
            />
            <button
              type="button"
              onClick={() => setStockTab('stocks')}
              className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${stockTab === 'stocks' ? 'text-brand-contrast' : 'text-neutral-400'}`}
            >
              Stocks
            </button>
            <button
              type="button"
              onClick={() => setStockTab('sacks')}
              className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${stockTab === 'sacks' ? 'text-brand-contrast' : 'text-neutral-400'}`}
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
    </div>
  )
}

export default Settings
