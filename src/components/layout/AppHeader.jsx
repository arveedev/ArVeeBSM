// App Header — persistent, always-visible bar (sticky, not scrolling
// away with page content). Houses the current page's title/subtitle
// (set by each page via PageHeaderContext, so it stays visible without
// scrolling back up), the dark/light theme toggle, the KG/MT weight
// unit toggle, and logout - all in one place instead of requiring a
// trip into Settings. Theme defaults to dark, weight unit defaults to
// KG; both persisted via SettingsContext. Hidden entirely while a
// transaction form is open (App.jsx skips rendering it), since those
// are their own full-screen overlays with their own close control.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useObservable, useLiveQuery } from 'dexie-react-hooks'
import { Moon, Sun, LogOut, AlertTriangle, Cloud, CloudOff, Check, Bell } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import { usePageHeader } from '../../context/PageHeaderContext.jsx'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import toast from 'react-hot-toast'
import { db } from '../../db/dexie.js'
import { fmtBags, isProcurementTypeName, effectiveCutoffDate } from '../../utils/calculations.js'
import ConfirmDialog from '../common/ConfirmDialog.jsx'
import Avatar from '../common/Avatar.jsx'
import AvatarPickerModal from '../common/AvatarPickerModal.jsx'
import { REGULAR_NAV_COLUMN } from './BottomNav.jsx'

// Same phases treated as "caught up" in isCloudSyncCaughtUp (dexie.js) -
// kept as a separate, purely-display copy here rather than importing
// that helper, since this only needs the phase label/color, never the
// gating decision itself.
const SYNC_LABELS = {
  initial: 'Loading your data from the cloud…',
  pulling: 'Loading your data from the cloud…',
  'not-in-sync': 'Loading your data from the cloud…',
  pushing: 'Syncing your changes…',
  'in-sync': 'Up to date',
  offline: 'Offline — working from local data only',
  error: 'Sync error — some data may be out of date',
}

// Formats the date range of the receipts behind an accumulated
// procurement-notification total - "Sep 12" for a single day,
// "Sep 12 - Sep 20" for a real span. Returns '' (not shown at all) when
// there's no date to report, rather than a placeholder like "—".
const fmtNotifDate = (iso) => new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
const fmtDateRange = (minDate, maxDate) => {
  if (!minDate) return ''
  if (!maxDate || minDate === maxDate) return fmtNotifDate(minDate)
  return `${fmtNotifDate(minDate)} - ${fmtNotifDate(maxDate)}`
}

// Must match the fade transition duration used on the overlay below.
const LOGOUT_FADE_MS = 500

function AppHeader({ hidden = false }) {
  const { user, logout } = useAuth() ?? {}
  const { theme, weightUnit, updateSetting } = useSettings() ?? {}
  const { title, subtitle, setHeaderHeight } = usePageHeader() ?? {}
  const { currentWarehouseId, accessibleWarehouses, setCurrentWarehouseId } = useWarehouse() ?? {}
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [hasEntered, setHasEntered] = useState(false)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const headerRef = useRef(null)

  // Title/subtitle change animation - direction follows where the new
  // page actually sits relative to the old one (same left-to-right
  // column order as the bottom nav), per explicit request, rather than
  // a single fixed direction: navigating "forward" (Home -> Settings)
  // slides the old text out to the left and the new text in from the
  // right; navigating "backward" slides the opposite way. The title and
  // its subtitle move together as one block, so a subtitle appearing or
  // disappearing (e.g. Home's "Welcome back" vs a page with none) is
  // just part of that same block's exit/enter rather than a separate
  // effect. `displayed` is what's actually rendered - it lags behind
  // the real title/subtitle props until the exit animation finishes,
  // the same "swap content only once the old element is actually gone"
  // technique used by CreateEditPileModal's handleClose.
  const [displayed, setDisplayed] = useState({ title, subtitle })
  const [textMotion, setTextMotion] = useState({ transform: 'translateX(0)', opacity: 1, transition: 'none' })
  const prevColumnRef = useRef(REGULAR_NAV_COLUMN[pathname] ?? 0)
  const isFirstHeaderRender = useRef(true)
  const HEADER_EXIT_MS = 170
  const HEADER_ENTER_MS = 220
  useEffect(() => {
    if (isFirstHeaderRender.current) {
      isFirstHeaderRender.current = false
      prevColumnRef.current = REGULAR_NAV_COLUMN[pathname] ?? 0
      setDisplayed({ title, subtitle })
      return
    }
    if (displayed.title === title && displayed.subtitle === subtitle) return
    const column = REGULAR_NAV_COLUMN[pathname] ?? 0
    const forward = column >= prevColumnRef.current
    prevColumnRef.current = column
    const exitX = forward ? -16 : 16
    const enterX = forward ? 16 : -16
    setTextMotion({ transform: `translateX(${exitX}px)`, opacity: 0, transition: `transform ${HEADER_EXIT_MS}ms ease-in, opacity ${HEADER_EXIT_MS}ms ease-in` })
    const exitTimer = setTimeout(() => {
      setDisplayed({ title, subtitle })
      setTextMotion({ transform: `translateX(${enterX}px)`, opacity: 0, transition: 'none' })
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTextMotion({ transform: 'translateX(0)', opacity: 1, transition: `transform ${HEADER_ENTER_MS}ms ease-out, opacity ${HEADER_ENTER_MS}ms ease-out` })
        })
      })
    }, HEADER_EXIT_MS)
    return () => clearTimeout(exitTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle])

  // Live, not read off the in-memory `user` object from AuthContext -
  // that object is a one-time snapshot from login and intentionally
  // never persisted/refreshed (see AuthContext's own top comment), so a
  // saved avatar change wouldn't show up here until the next login
  // without querying the real record directly. Visitor sessions have no
  // uid (synthetic, not a real db.users row) and just get the default,
  // non-editable avatar.
  const userRecord = useLiveQuery(() => (user?.uid ? db.users.get(user.uid) : null), [user?.uid])
  const canEditAvatar = Boolean(user?.uid)

  // General notification bell, per explicit request - available to
  // every logged-in (non-Visitor) user now, not just Admin. Two
  // independent sources feed into one shared, source-agnostic
  // {id, resolved, title, detail, onClick} shape (`notifEntries`), so
  // either can be extended or a third source added later without
  // reshaping what the dropdown itself renders:
  //
  // 1. db.errorLogs (admin-only, same table ErrorLogPanel.jsx reads).
  //    Tapping an entry deep-links into Admin Dashboard's Error Log tab
  //    and scrolls/expands/highlights that exact row (see
  //    ErrorLogPanel.jsx's focusEntryId handling) - since a sync
  //    failure updates the SAME log row in place once it resolves
  //    rather than creating a second entry, a notification for an
  //    error that's since resolved still correctly lands on that row
  //    now showing its own green Resolved banner.
  //
  // 2. Procurement sacks still needing a matching SIA, for the
  //    currently selected warehouse - the exact same query
  //    ProcurementBagsNotification.jsx already ran (see its own
  //    comment for the full scenario), moved here per explicit request
  //    ("we can show that as a notification instead of the alert") -
  //    that component's usage in AlertsPanel.jsx is removed to match,
  //    so this is a move, not a duplicate. Available to every user with
  //    a warehouse in context, not just Admin - a Warehouse Supervisor
  //    is exactly who needs to act on this. These entries have no
  //    persistent id of their own (a live-computed set, not stored
  //    rows) - `resolved` is always false while shown (the moment it's
  //    actually resolved, the entry disappears from the query result
  //    entirely rather than flipping a flag), and they're excluded from
  //    Clear All below, which only ever clears db.errorLogs rows.
  const isAdmin = user?.role === 'Admin'
  const isVisitor = user?.role === 'Visitor'
  const errorEntries = useLiveQuery(
    () => (isAdmin ? db.errorLogs.orderBy('timestamp').reverse().toArray() : []),
    [isAdmin]
  ) ?? []

  // Confirmed, reported real bug: this used to scope only to
  // currentWarehouseId, silently going quiet the instant the user
  // switched away from the ONE warehouse a notification happened to be
  // about - per explicit correction, a notification is for whichever
  // warehouse it's actually about, not whichever one happens to be
  // selected right now, so it must stay visible regardless of the
  // current selection. Now scoped across every warehouse this user is
  // actually assigned to (accessibleWarehouses, the same list the
  // picker itself offers). Internally still tracked per (warehouseId,
  // sackTypeId, condition) - two different warehouses, or two different
  // sack type/conditions, must never net against each other - but per
  // explicit request the still-outstanding (positive) amounts are now
  // summed into ONE accumulated total per warehouse for the
  // notification itself, rather than one alert per sack type/
  // condition, with the date range of the contributing receipts shown
  // alongside it. An over-issuance (SIA-backed issuance exceeding
  // Procurement - negative amount) is a genuinely different kind of
  // signal - something's actually wrong, not just "still pending" - so
  // those stay their own specific per-sack-type/condition entries
  // rather than being folded into the accumulated total.
  const warehouseIds = (accessibleWarehouses ?? []).map((w) => w.warehouseId)
  const warehouseNameById = new Map((accessibleWarehouses ?? []).map((w) => [w.warehouseId, w.name]))
  const warehouseById = new Map((accessibleWarehouses ?? []).map((w) => [w.warehouseId, w]))
  const procurementOutstanding = useLiveQuery(async () => {
    if (warehouseIds.length === 0) return []
    const transactionTypes = await db.transactionTypes.toArray()
    const procurementTypeId = transactionTypes.find((t) => isProcurementTypeName(t.name))?.transactionTypeId
    if (!procurementTypeId) return []

    const sackTypes = await db.sackTypes.toArray()
    const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

    // Reported, confirmed real bug: this never applied the same
    // reporting-cutoff-date rule every other view (Reports.jsx,
    // SdoHome.jsx, ProcurementMonitor.jsx) already respects - a
    // warehouse's own override, or the global Data Start Date,
    // whichever is later. A Procurement receipt dated before that
    // cutoff is deliberately out of scope everywhere else in the app
    // (superseded by a beginning balance), so it must be excluded here
    // too instead of still surfacing as "still needs a matching SIA".
    const globalDataStartDate = (await db.reportConfig.get('global'))?.dataStartDate || null
    const isWithinCutoff = (t) => {
      const cutoff = effectiveCutoffDate(warehouseById.get(t.warehouseId)?.reportingCutoffDate, globalDataStartDate)
      return !cutoff || t.date > cutoff
    }

    // Bags aren't lot/batch-tracked - a (warehouse, sackType, condition)
    // group is one fungible pool, so there's no record of which specific
    // WSR's physical bags a later SIA/ESI actually drew from. Reported,
    // confirmed real bug: naively taking the min/max date across EVERY
    // contributing WSR (regardless of whether it was since fully matched)
    // kept a fully-covered receipt's date in the displayed range - e.g. a
    // Sept 7 receipt fully consumed by a same-day SIA still showed up as
    // "procured Sep 7" alongside genuinely-outstanding later receipts.
    // Fixed with a FIFO simulation per key: consume the OLDEST receipts
    // first against the total ESI deduction, so only the receipts whose
    // bags plausibly remain unconsumed - the same assumption a warehouse
    // worker would naturally make (oldest stock gets matched first) -
    // contribute their date to the range.
    const receiptsByKey = new Map()
    const procurementWsr = await db.transactions
      .where('warehouseId').anyOf(warehouseIds)
      .and((t) => t.type === 'WSR' && t.status === 'Active' && t.transactionTypeId === procurementTypeId && isWithinCutoff(t))
      .toArray()
    for (const t of procurementWsr) {
      if (!t.mtsSackTypeId || !t.mtsCondition) continue
      const key = `${t.warehouseId}::${t.mtsSackTypeId}::${t.mtsCondition}`
      const list = receiptsByKey.get(key) ?? []
      list.push({ date: t.date ?? '', amount: t.numberOfBags ?? 0 })
      receiptsByKey.set(key, list)
    }
    const consumedByKey = new Map()
    const procurementEsi = await db.transactions
      .where('warehouseId').anyOf(warehouseIds)
      .and((t) => t.type === 'ESI' && t.status === 'Active' && t.transactionTypeId === procurementTypeId && isWithinCutoff(t))
      .toArray()
    for (const t of procurementEsi) {
      for (const line of t.sackLines ?? []) {
        const key = `${t.warehouseId}::${line.sackTypeId}::${line.condition}`
        consumedByKey.set(key, (consumedByKey.get(key) ?? 0) + (line.pieces ?? 0))
      }
    }

    // { amount, minDate, maxDate } per key - amount is the plain net
    // total (unaffected by FIFO, which only narrows which dates count);
    // minDate/maxDate only reflect receipts that still have unconsumed
    // bags after FIFO-matching the oldest receipts against total ESI
    // consumption for that key.
    const byKey = new Map()
    for (const [key, list] of receiptsByKey) {
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
      let remaining = consumedByKey.get(key) ?? 0
      const entry = { amount: 0, minDate: null, maxDate: null }
      for (const r of sorted) {
        entry.amount += r.amount
        let outstanding = r.amount
        if (remaining > 0) {
          const consumedFromThis = Math.min(remaining, r.amount)
          outstanding -= consumedFromThis
          remaining -= consumedFromThis
        }
        if (outstanding > 0 && r.date) {
          if (!entry.minDate || r.date < entry.minDate) entry.minDate = r.date
          if (!entry.maxDate || r.date > entry.maxDate) entry.maxDate = r.date
        }
      }
      entry.amount -= consumedByKey.get(key) ?? 0
      byKey.set(key, entry)
    }
    for (const [key, consumed] of consumedByKey) {
      if (receiptsByKey.has(key)) continue
      byKey.set(key, { amount: -consumed, minDate: null, maxDate: null })
    }

    // Accumulate every still-positive key into one total per warehouse,
    // spanning the full date range of every receipt that contributed to
    // it - this is the "accumulated number of bags... with the period"
    // notification per explicit request. Negative (over-issuance) keys
    // stay their own specific entries, named by warehouse AND sack
    // type/condition, since that's a real discrepancy worth pinpointing
    // exactly, not folding into a total.
    const accumulatedByWarehouse = new Map()
    const overIssuanceEntries = []
    for (const [key, { amount, minDate, maxDate }] of byKey) {
      if (amount === 0) continue
      const [warehouseId, sackTypeId, condition] = key.split('::')
      if (amount > 0) {
        const acc = accumulatedByWarehouse.get(warehouseId) ?? { amount: 0, minDate: null, maxDate: null }
        acc.amount += amount
        if (minDate && (!acc.minDate || minDate < acc.minDate)) acc.minDate = minDate
        if (maxDate && (!acc.maxDate || maxDate > acc.maxDate)) acc.maxDate = maxDate
        accumulatedByWarehouse.set(warehouseId, acc)
      } else {
        overIssuanceEntries.push({
          key,
          warehouseId,
          warehouseName: warehouseNameById.get(warehouseId) ?? 'Unknown warehouse',
          code: sackTypeMap.get(sackTypeId)?.code ?? sackTypeId,
          condition,
          amount,
        })
      }
    }

    const accumulatedEntries = [...accumulatedByWarehouse.entries()].map(([warehouseId, { amount, minDate, maxDate }]) => ({
      key: `accumulated:${warehouseId}`,
      warehouseId,
      warehouseName: warehouseNameById.get(warehouseId) ?? 'Unknown warehouse',
      amount,
      minDate,
      maxDate,
    }))

    return [...accumulatedEntries, ...overIssuanceEntries]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseIds.join(',')]) ?? []

  const [notifOpen, setNotifOpen] = useState(false)
  const [confirmingClearNotifs, setConfirmingClearNotifs] = useState(false)
  const notifRef = useRef(null)
  useEffect(() => {
    if (!notifOpen) return
    const handleOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [notifOpen])

  const notifEntries = [
    ...errorEntries.map((entry) => ({
      id: `error:${entry.id}`,
      resolved: Boolean(entry.resolved),
      title: entry.context,
      detail: entry.message,
      onClick: () => {
        setNotifOpen(false)
        navigate('/admin', { state: { groupId: 'system', tabId: 'errorLog', focusEntryId: entry.id } })
      },
    })),
    // title carries the warehouse name (bold, the first thing read) -
    // per explicit correction, with entries now spanning every
    // accessible warehouse rather than just the currently selected one,
    // which warehouse a given line is about is no longer implied by
    // context and must be explicit on every entry. Two shapes coming
    // out of procurementOutstanding now: an accumulated total per
    // warehouse (amount > 0, minDate/maxDate set, no code/condition -
    // the common case) and a specific over-issuance entry (amount < 0,
    // code/condition set, no dates - see procurementOutstanding's own
    // comment for why that one stays granular).
    ...procurementOutstanding.map(({ key, warehouseId, warehouseName, code, condition, amount, minDate, maxDate }) => ({
      id: `procurement:${key}`,
      resolved: false,
      title: `${warehouseName} — sacks need matching SIA`,
      detail: amount > 0
        ? `${fmtBags(amount)} bag${amount === 1 ? '' : 's'} still need${amount === 1 ? 's' : ''} a matching SIA${fmtDateRange(minDate, maxDate) ? ` (procured ${fmtDateRange(minDate, maxDate)})` : ''}`
        : `${code} (${condition}): SIA-backed issuance exceeds Procurement by ${fmtBags(Math.abs(amount))} - check for an over-issuance`,
      onClick: () => {
        setNotifOpen(false)
        // Switches the app's own current-warehouse context to the one
        // this notification is actually about before navigating, so
        // Home lands showing the relevant warehouse rather than
        // whatever happened to be selected before the bell was opened.
        if (warehouseId !== currentWarehouseId) setCurrentWarehouseId?.(warehouseId)
        navigate('/')
      },
    })),
  ]
  const unresolvedNotifCount = notifEntries.filter((n) => !n.resolved).length

  // Same table this bell's error source reads from - clearing here is
  // exactly ErrorLogPanel's own "Clear All" action, just reachable
  // without opening Admin Dashboard first. Confirmed first (same as
  // that panel's own Clear All), since this is destructive and shared
  // across every device. Procurement entries aren't stored rows, so
  // there's nothing for this to clear there - they resolve themselves
  // the moment a matching SIA is actually issued.
  const handleClearAllNotifs = async () => {
    setConfirmingClearNotifs(false)
    await db.errorLogs.clear()
  }

  // Slides down from above on mount - needs a tick of delay
  // (requestAnimationFrame) so the browser actually paints the
  // off-screen starting position first, before the transition to the
  // settled position is applied.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Reports the header's actual rendered height (not a guess) so
  // anything elsewhere positioned "just below the header" - like the
  // sticky warehouse indicator - uses the real number for this specific
  // page, since a page with no subtitle renders a shorter header than
  // one with a long "Welcome back..." line.
  useEffect(() => {
    const el = headerRef.current
    if (!el || !setHeaderHeight) return
    const observer = new ResizeObserver(([entry]) => setHeaderHeight(entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [setHeaderHeight])

  const isLight = theme === 'light'
  const isMt = weightUnit === 'mt'

  // Whether local data is still catching up with the cloud - the same
  // question users asked directly ("how would they know if loading up
  // is done??") when a stale-local-data race left a duplicate record
  // behind. Rather than expecting anyone to guess, this makes the
  // state visible everywhere, all the time, not just buried in Settings.
  const cloudSyncState = useObservable(db.cloud.syncState)
  const syncPhase = cloudSyncState?.phase
  const isSyncError = syncPhase === 'error' || cloudSyncState?.status === 'error'
  const isOffline = syncPhase === 'offline' || cloudSyncState?.status === 'disconnected'
  // Matches Settings.jsx's own "Syncing..." definition: anything other
  // than 'in-sync' while connected counts as active syncing, including
  // 'pushing' (uploading local changes) - previously only 'initial' /
  // 'pulling' / 'not-in-sync' animated, so a real push-in-progress (the
  // exact moment users were seeing a "syncing" notification elsewhere)
  // showed a perfectly static badge instead, which read as broken.
  const isSyncing = !isSyncError && !isOffline && syncPhase != null && syncPhase !== 'in-sync'
  const isCaughtUp = !isSyncing && !isSyncError && !isOffline
  // The icon itself (cloud, with a checkmark drawn inside it once
  // caught up) stays perfectly solid/static - scaling or fading it in
  // place read as a connection dropping, not activity. The motion
  // instead comes from a ring that expands outward from around the
  // WHOLE icon and fades (Tailwind's "ping" keyframes: scale up +
  // opacity to 0), the same sonar-ping pattern used for "live" status
  // dots elsewhere - fast (0.8s) while actively syncing, slow (2.5s)
  // once caught up.
  const SyncIcon = isSyncError || isOffline ? CloudOff : Cloud
  const syncIconClass = isSyncError
    ? 'text-brand-crimson'
    : isOffline
      ? 'text-neutral-500'
      : isSyncing
        ? 'text-brand-amber'
        : 'text-brand-neon'
  const rippleColorClass = isSyncing ? 'border-brand-amber' : 'border-brand-neon'
  const rippleSpeedClass = isSyncing
    ? 'animate-[ping_0.8s_cubic-bezier(0,0,0.2,1)_infinite]'
    : 'animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite]'
  const showRipple = !isSyncError && !isOffline
  const handleSyncIconTap = () => {
    toast(SYNC_LABELS[syncPhase] ?? 'Checking sync status…', { icon: '☁️', duration: 4000 })
  }

  const handleLogoutConfirmed = () => {
    setConfirmingLogout(false)
    // Fade the whole screen to black first (the reverse counterpart to
    // Login's own exit animation), THEN actually log out and navigate -
    // reads as one continuous transition rather than an abrupt jump
    // straight to the login screen.
    document.body.style.overflow = 'hidden'
    setIsLoggingOut(true)
    setTimeout(() => {
      document.body.style.overflow = ''
      logout?.()
      navigate('/login', { replace: true })
    }, LOGOUT_FADE_MS)
  }

  return (
    <>
      <div
        ref={headerRef}
        style={{
          // hidden - previously a transaction form opening simply
          // unmounted this component outright (App.jsx conditionally
          // rendered it on !activeFormType), so it vanished instantly
          // with no exit motion at all, and reappeared the same way -
          // abrupt in both directions, and never coordinated with the
          // form's own fade timing. Now it stays mounted and slides up
          // out of view instead, matching hasEntered's own transition
          // so opening a form reads as one combined motion (header
          // slides up, nav bar slides down, form fades in) rather than
          // a jump cut plus a separate animation.
          transform: (hasEntered && !hidden) ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 350ms ease-out',
        }}
        className="sticky top-0 z-50 border-b border-neutral-800 bg-neutral-950"
      >
        <div className="flex items-start justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar
              avatarBg={userRecord?.avatarBg}
              avatarFace={userRecord?.avatarFace}
              avatarAnim={userRecord?.avatarAnim}
              name={user?.name}
              size={40}
              onClick={canEditAvatar ? () => setAvatarPickerOpen(true) : undefined}
            />
            <div className="min-w-0 overflow-hidden">
              <div style={textMotion}>
                {/* Reported, real bug: on a narrow phone the pill (below)
                    left so little room for the title that a single long
                    word like "Dashboard"/"Monitoring" had nowhere to
                    wrap at a space, so break-words split it mid-word
                    ("Dashboa"/"rd") - unreadable. Fixed on both ends: the
                    pill itself shrank (see its own comment below) to
                    leave more room here, and the title dropped to
                    text-base so more of it fits on the first line before
                    any wrap is needed at all. */}
                {displayed.title && <h1 className="break-words text-base font-semibold text-app-text">{displayed.title}</h1>}
                {/* Reported, real bug: truncate clipped a short subtitle
                    like "Welcome back, JP." down to "Welcome…" on a narrow
                    phone, since this column only gets whatever width is
                    left after the icon row on the right. break-words wraps
                    onto a second line instead of cutting text off - the
                    header's own height is already computed dynamically
                    (see headerRef/setHeaderHeight above) so a taller header
                    here doesn't overlap the page content below it. */}
                {displayed.subtitle && <p className="break-words text-sm font-medium text-neutral-300">{displayed.subtitle}</p>}
              </div>
            </div>
          </div>

          {/* One shared pill instead of four individually bordered
              circles - reads as one "session controls" cluster rather
              than loose icons scattered across the header. shrink-0 so
              it never shrinks or wraps onto its own row even when the
              title/greeting above does - it stays pinned to this exact
              top-right spot at this exact size on every page. Icons
              sized down from an earlier 44px to 40px (still a real tap
              target, just tighter) specifically to free up room for
              the title next to it - see the title's own comment for
              the actual reported breakage this fixes on a narrow phone. */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-neutral-900 p-1">
            {/* Sync status - tap for a plain-language explanation. The
                icon itself stays solid/static (scaling or fading it in
                place reads as a dropped connection, not activity) - a
                checkmark is drawn INSIDE the cloud once caught up, and
                a ring expands outward around the whole icon and fades,
                the standard "live" sonar-ping pattern. Fast amber ring
                while actively loading/pushing data (the one window
                where opening a form on an old serial risks the
                duplicate-record race described in its own fix), slow
                steady green ring once caught up. No ring, gray/red
                static icon, offline or on a real error. */}
            <button
              type="button"
              onClick={handleSyncIconTap}
              aria-label="Sync status"
              className="relative flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-90"
            >
              {showRipple && (
                <span className={`pointer-events-none absolute h-8 w-8 rounded-full border-2 ${rippleColorClass} ${rippleSpeedClass}`} />
              )}
              <span className="relative inline-flex h-5 w-5 items-center justify-center">
                <SyncIcon size={20} className={syncIconClass} />
                {isCaughtUp && (
                  <Check
                    size={10}
                    strokeWidth={3.5}
                    className="absolute text-brand-neon"
                    style={{ top: '58%', left: '50%', transform: 'translate(-50%, -50%)' }}
                  />
                )}
              </span>
            </button>

            {/* Per explicit request, no longer Admin-only - every real
                (non-Visitor) user gets the bell now, since the
                procurement-sacks source above is relevant to whoever is
                actually working a warehouse, not just Admin. */}
            {!isVisitor && (
              <div ref={notifRef} className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  aria-label="Notifications"
                  className="relative flex h-10 w-10 items-center justify-center rounded-full text-neutral-300 transition-all hover:text-brand-neon active:scale-90"
                >
                  <Bell size={20} />
                  {unresolvedNotifCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-crimson px-1 text-[10px] font-bold text-app-text">
                      {unresolvedNotifCount > 9 ? '9+' : unresolvedNotifCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 top-full z-[106] mt-2 max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/50">
                    <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        {unresolvedNotifCount > 0
                          ? `${unresolvedNotifCount} unresolved`
                          : 'Notifications'}
                      </p>
                      {/* errorEntries, not notifEntries - Clear All only
                          ever clears db.errorLogs rows (see
                          handleClearAllNotifs), so it has nothing to do
                          and shouldn't show at all when the only
                          entries present are procurement notifications,
                          which aren't stored rows to clear. */}
                      {errorEntries.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmingClearNotifs(true)}
                          className="shrink-0 text-xs font-medium text-neutral-500 transition-colors hover:text-brand-crimson"
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                    {notifEntries.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-neutral-500">Nothing to show.</p>
                    ) : (
                      <ul className="divide-y divide-neutral-800">
                        {notifEntries.slice(0, 8).map((notif) => (
                          <li key={notif.id}>
                            <button
                              type="button"
                              onClick={notif.onClick}
                              className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-neutral-800"
                            >
                              {notif.resolved
                                ? <Check size={14} className="mt-0.5 shrink-0 text-brand-neon" />
                                : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-crimson" />}
                              <span className="min-w-0 flex-1">
                                {/* break-words, not truncate - per
                                    explicit request, the detail must be
                                    fully readable, especially now that
                                    it spans multiple warehouses and
                                    truncating away the amount/warehouse
                                    would defeat the whole point. */}
                                <span className="block break-words text-xs font-medium text-app-text">{notif.title}</span>
                                <span className="block break-words text-xs text-neutral-500">{notif.detail}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* KG/MT weight unit toggle - shows both labels at once with
                the active one highlighted, so the current state is
                unambiguous at a glance rather than relying on a single
                icon. The highlight itself slides between the two
                halves (same sliding-pill technique as the app's other
                tab pairs) instead of each label just snapping its own
                background color on/off in place.
                Hidden for SDO - that role's whole world is pesos and
                bags/kilos of palay bought, not warehouse stock weight
                unit preference; the toggle has nothing there to affect. */}
            {user?.role !== 'SDO' && (
              <button
                type="button"
                onClick={() => updateSetting?.('weightUnit', isMt ? 'kg' : 'mt')}
                aria-label="Toggle KG/MT weight unit"
                className="relative flex items-center overflow-hidden rounded-full bg-neutral-950 text-xs font-bold"
              >
                <span
                  className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-brand-neon transition-transform duration-300 ease-out"
                  style={{ transform: isMt ? 'translateX(100%)' : 'translateX(0%)' }}
                />
                <span className={`relative z-10 px-2 py-2.5 transition-colors ${!isMt ? 'text-brand-contrast' : 'text-neutral-400'}`}>
                  KG
                </span>
                <span className={`relative z-10 px-2 py-2.5 transition-colors ${isMt ? 'text-brand-contrast' : 'text-neutral-400'}`}>
                  MT
                </span>
              </button>
            )}

            {/* Dark/light theme toggle - glows when light mode is active,
                as a clear visual cue of the current state. */}
            <button
              type="button"
              onClick={() => updateSetting?.('theme', isLight ? 'dark' : 'light')}
              aria-label="Toggle dark/light mode"
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-90 ${
                isLight
                  ? 'text-brand-neon shadow-[0_0_12px_rgba(0,255,163,0.6)]'
                  : 'text-neutral-300 hover:text-brand-neon'
              }`}
            >
              {isLight ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <button
              type="button"
              onClick={() => setConfirmingLogout(true)}
              aria-label="Logout"
              className="flex h-10 w-10 items-center justify-center rounded-full text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {/* Fade attached to the header's own bottom edge (not a fixed
            pixel offset) so content scrolling underneath fades smoothly
            rather than being cut off abruptly - works regardless of the
            header's actual height, since this moves with it. */}
        <div className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-neutral-950 to-transparent" />
      </div>

      {canEditAvatar && (
        <AvatarPickerModal
          open={avatarPickerOpen}
          current={userRecord}
          name={user?.name}
          onClose={() => setAvatarPickerOpen(false)}
          onSave={(avatar) => db.users.update(user.uid, avatar)}
        />
      )}

      <ConfirmDialog
        open={confirmingLogout}
        title="Are you sure you want to log out?"
        confirmLabel="Logout"
        icon={AlertTriangle}
        onConfirm={handleLogoutConfirmed}
        onCancel={() => setConfirmingLogout(false)}
      />

      {isAdmin && (
        <ConfirmDialog
          open={confirmingClearNotifs}
          icon={AlertTriangle}
          title="Clear all notifications?"
          description={`This deletes all ${errorEntries.length} recorded error log entr${errorEntries.length === 1 ? 'y' : 'ies'} on every device - it doesn't undo whatever originally went wrong, only the record of it. Same as Error Log's own Clear All in Admin Dashboard.`}
          confirmLabel="Clear All"
          onConfirm={handleClearAllNotifs}
          onCancel={() => setConfirmingClearNotifs(false)}
        />
      )}

      {/* Fades the whole screen to black on logout - the reverse
          counterpart to Login's own fade-out, so this reads as one
          continuous transition rather than an abrupt jump. */}
      <div
        className={`fixed inset-0 z-[100] bg-neutral-950 transition-opacity duration-500 ${
          isLoggingOut ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
    </>
  )
}

export default AppHeader
