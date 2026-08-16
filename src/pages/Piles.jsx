// Piles — visual warehouse layout editor. Grid-based: each pile occupies
// a rectangular region of a fixed 24x20 grid, defined by row/column
// start + span. A pile box is either linked to a real pile (shows its
// live data) or marked Vacant (shows just its own label).
//
// Adding a pile: tap a starting cell, then move/tap toward an ending
// cell - a live semi-transparent preview rectangle follows, colored
// green while valid or red while it would overlap another box or exceed
// the grid boundary. Tap Confirm to lock it in.
//
// A pile can never be assigned to more than one box at once.
//
// Display: the grid scales to fit the container width, clipped so
// nothing (including the hover-zoom effect) ever renders outside the
// bordered display area. At rest, each box shows pile name, variety,
// net kilos, and bags. On hover (desktop) or long-press (mobile), the
// SAME box's text swaps in place to the full detail list and the box
// itself scales up 1.5x for readability - no separate floating card,
// which was causing layout shift/glitching.

import { useCallback, useEffect, useRef, useState, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Plus, Trash2, X, Move, Pencil, Maximize2, Minimize2, ArrowLeft } from 'lucide-react'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { db } from '../db/dexie.js'
import { fmtBags, fmtWeight, fmtDateForFilename, sanitizeForFilename, calculateCurrentAge, fmtAge, todayLocalISO } from '../utils/calculations.js'
import { generatePileLayoutReport } from '../utils/pileLayoutPdfGenerator.js'
import { generatePileBinCard } from '../utils/pileBinCardGenerator.js'

import { computeHistoricalPileState, vacateBoxForPile } from '../utils/pileLedger.js'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, byAlpha } from '../components/common/admin/shared.js'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import PeriodPresetPicker from '../components/common/PeriodPresetPicker.jsx'
import CalendarDatePicker from '../components/common/CalendarDatePicker.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'
import HomePiles from './HomePiles.jsx'

const GRID_COLS = 24
const GRID_ROWS = 20
const BASE_CELL_PX = 38
const LONG_PRESS_MS = 500

const PALAY_COLOR = '#ADEBB3'
const RICE_COLOR = '#B8E3E9'
const BYPRODUCT_COLOR = '#FBEBCC'

const boxesOverlap = (a, b) => {
  const aRowEnd = a.rowStart + a.rowSpan - 1
  const aColEnd = a.colStart + a.colSpan - 1
  const bRowEnd = b.rowStart + b.rowSpan - 1
  const bColEnd = b.colStart + b.colSpan - 1
  return a.rowStart <= bRowEnd && b.rowStart <= aRowEnd &&
         a.colStart <= bColEnd && b.colStart <= aColEnd
}

const withinBounds = (box) =>
  box.rowStart >= 1 && box.colStart >= 1 &&
  (box.rowStart + box.rowSpan - 1) <= GRID_ROWS &&
  (box.colStart + box.colSpan - 1) <= GRID_COLS

const regionFromCorners = (a, b) => ({
  rowStart: Math.min(a.row, b.row),
  colStart: Math.min(a.col, b.col),
  rowSpan: Math.abs(a.row - b.row) + 1,
  colSpan: Math.abs(a.col - b.col) + 1,
})

/** Counts how many non-blank detail fields a pile has (Variety, Bags, Net Kg, Age, Condition, MC, Purity, Date Procured). */
const countPileFields = (pile, variety) => {
  if (!pile) return 0
  return [
    variety?.name, pile.currentBags != null, pile.currentKilos != null,
    pile.initialAgeValue != null, pile.condition, pile.moistureContent, pile.purity, pile.dateProcured,
  ].filter(Boolean).length
}

// A box's rendered footprint can exceed its drawn size once its content
// needs more room than the drawn span provides (see grow-to-fit in the
// PDF generator, mirrored here for the on-screen editor). Overlap
// validation must use this EFFECTIVE footprint, not the raw drawn one -
// otherwise a new box can be placed right where a grown box will later
// render, silently colliding with it.
const ROWS_PER_FIELD_SLOT = 2.2
const effectiveRowSpan = (box, fieldCount) => {
  const neededRows = Math.ceil((1.5 + fieldCount) / ROWS_PER_FIELD_SLOT)
  return Math.max(box.rowSpan, neededRows)
}

// Defined once at module level (not inside Piles' function body) so
// it is never treated as a "new" component type on every render -
// that would force React to remount its children constantly, losing
// drawing/moving state. Portals to document.body when active,
// guaranteeing the full-screen overlay covers the actual device
// viewport regardless of any ancestor's transform/filter/perspective
// (including transient ones from page-transition animations, which
// would otherwise create a containing block that constrains a plain
// `fixed` element to that ancestor's own bounds instead of the real
// screen).
// overlayRef (a plain callback ref, e.g. useState's setter passed
// directly) exposes the actual rotated DOM node to the parent - so
// content that genuinely needs to LIVE inside the rotated coordinate
// system (the Edit/Assign Pile form, which is tall, variable-height,
// and bottom-anchored on mobile - not a simple small centered dialog)
// can be portaled straight into it instead of guessing a compensating
// rotate() transform of its own. A manually-rotated version of that
// form previously came out badly mispositioned/clipped, since rotating
// a tall, edge-anchored box around its own center swaps its effective
// width/height without correctly compensating for where its edges then
// land - portaling into the already-correctly-rotated ancestor
// sidesteps that math entirely, the same way the pile grid's own boxes
// are already correctly oriented for free, just by being real
// descendants of this rotated container.
// Stays mounted for one extra tick after isFullScreen flips false so the
// exit animation actually gets to play - otherwise the portal would
// vanish instantly on the same render that starts the animation, and no
// animation happens without a screen present to animate on. The actual
// unmount is triggered by the real `animationend` event on the closing
// animation (see onAnimationEnd below), not a guessed timeout - a
// hardcoded duration previously had to be kept in exact sync with the
// CSS animation's own duration by hand, and any mismatch (or a dropped/
// delayed frame on a slower phone) reintroduced the exact DOM-swap-vs-
// still-old-content race this is meant to prevent.
const FullScreenOverlay = forwardRef(function FullScreenOverlay({ isFullScreen, isPortrait, children }, overlayRef) {
  const [shouldRender, setShouldRender] = useState(isFullScreen)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (isFullScreen) {
      setShouldRender(true)
      setIsClosing(false)
    } else if (shouldRender) {
      setIsClosing(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreen])

  const handleExitAnimationEnd = (e) => {
    // Guards against the ENTRANCE animation's own end event (which also
    // fires on this same element) being mistaken for the exit finishing.
    if (!isClosing || e.target !== e.currentTarget) return
    setShouldRender(false)
    setIsClosing(false)
  }

  if (!shouldRender) return children
  return createPortal(
    // Outer node: fixed positioning + the STATIC device-orientation
    // rotation only, never animated - the Edit/Assign Pile form portals
    // directly into this exact DOM node (see overlayRef's usage further
    // down), and it must always sit in the correctly-rotated coordinate
    // system, not a transiently zoomed/rotated one mid-animation.
    // z-[55], deliberately above AppHeader's z-50 (AppHeader.jsx) rather
    // than tied with it - a tie was fine 99% of the time (this portal's
    // DOM position, appended later in <body>, usually won ties), but
    // right when a same-z-index sibling portal (ConfirmDialog, z-60)
    // unmounted with no exit transition of its own, the browser could
    // repaint the tie the other way for a frame, flashing the header
    // through underneath. An explicit, non-tied z-index removes the
    // ambiguity entirely.
    <div
      ref={overlayRef}
      className="fixed z-[55] flex flex-col bg-neutral-950 p-3"
      style={
        isPortrait
          ? {
              top: 0, left: 0,
              // dvh/dvw (dynamic viewport units), not vh/vw - plain vh/vw
              // reflect the LARGEST possible viewport (as if the mobile
              // browser's address/toolbar chrome were always hidden),
              // which on many phones is taller than what's ACTUALLY
              // visible the moment this measures. Sizing this box off
              // that too-large figure while it's rotated into place
              // means part of it - and everything anchored to its far
              // edge, including this row's controls and the grid's own
              // border - can end up genuinely beyond the real visible
              // screen, not just tightly spaced. dvh/dvw track the
              // CURRENT real visible viewport instead.
              width: '100dvh', height: '100dvw',
              transform: 'rotate(90deg) translateY(-100%)',
              transformOrigin: 'top left',
              // This box's PRE-rotation top edge - where the Back/Add
              // Pile controls row sits, being the first thing rendered
              // in the flex column below - becomes the VISUAL RIGHT
              // edge of the real screen once the 90deg rotation is
              // applied (rotating a box swaps which of its own edges
              // ends up where on screen). The plain p-3 above wasn't
              // enough clearance there - phones commonly need MORE room
              // on that specific edge for a rounded corner, camera
              // cutout, or gesture-nav zone (env(safe-area-inset-right)
              // describes exactly that real, visual edge), which is why
              // it was specifically the Add Pile button - sitting at
              // the far end of that row, so also closest to the
              // visual-bottom-right corner - that came out clipped to
              // an unreachable sliver instead of the Back button next
              // to it.
              paddingTop: 'max(1.5rem, calc(0.75rem + env(safe-area-inset-right, 0px)))',
            }
          : { top: 0, left: 0, right: 0, bottom: 0 }
      }
    >
      {/* Inner node: the actual rotate+zoom entrance/exit animation,
          isolated from the outer static rotation above so the two
          transforms never fight each other. min-h-0 keeps this a
          well-behaved flex child (without it, a nested flex column
          defaults to min-height:auto, which refused to shrink below
          its content's natural height and pushed part of the grid
          below the visible screen - the "layout isn't 100% in view"
          bug). Plays immediately on mount rather than waiting on the
          grid's own fit-to-screen measurement, since gating visibility
          on that turned out to be the real bug: on some phones the
          measurement effect never resolved in time, leaving the Add
          Pile/Cancel controls invisible indefinitely. A one-frame
          scale correction happening underneath a 320ms scale-up
          animation is imperceptible; a permanently invisible button
          is not. */}
      <div
        className={`flex min-h-0 flex-1 flex-col ${isClosing ? 'animate-fullscreen-slide-out' : 'animate-fullscreen-zoom-in'}`}
        style={{ transformOrigin: 'center' }}
        onAnimationEnd={handleExitAnimationEnd}
      >
        {children}
      </div>
    </div>,
    document.body
  )
})

function Piles() {
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}
  const { weightUnit, autoAgeMonitoring } = useSettings() ?? {}
  const { setPageHeader } = usePageHeader() ?? {}

  useEffect(() => {
    setPageHeader?.({ title: 'Piles', subtitle: 'Pile list and visual warehouse layout.' })
  }, [])

  const [pilesTab, setPilesTab] = useState('list')
  const [isFullScreen, setIsFullScreen] = useState(false)
  // The full-screen overlay's own rotated DOM node, once mounted - lets
  // the Edit/Assign Pile form portal directly into it (see
  // FullScreenOverlay's comment) instead of needing its own
  // compensating rotation.
  const [overlayNode, setOverlayNode] = useState(null)
  useEffect(() => {
    document.body.style.overflow = isFullScreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isFullScreen])

  // Tracks the physical device orientation while in full-screen mode -
  // drives both the CSS rotation in FullScreenOverlay and the
  // measure() calculation below, which needs to know when the visual
  // width/height axes are swapped relative to window.innerWidth/Height.
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(orientation: portrait)').matches : true
  )
  useEffect(() => {
    if (!isFullScreen) return
    const mq = window.matchMedia('(orientation: portrait)')
    setIsPortrait(mq.matches)
    const handler = (e) => setIsPortrait(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [isFullScreen])

  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const periodToPickerRef = useRef(null)
  const warehouseSectionRef = useRef(null)
  // Defaults to the previous month's presets if we're within the first
  // few days of a new month - a delayed report is more likely for the
  // period that just completed than for the current month, which has
  // barely started. The arrows below let the user override this either way.
  const [isExporting, setIsExporting] = useState(false)

  const [pendingDelete, setPendingDelete] = useState(null)

  // drawing: null (idle) | { start: {row,col}, current: {row,col} }
  const [drawing, setDrawing] = useState(null)
  const [assignForm, setAssignForm] = useState(null)
  const [pileId, setPileId] = useState('')
  const [label, setLabel] = useState('')
  const [editingBoxId, setEditingBoxId] = useState(null)

  // moving: null (idle) | { boxId, rowSpan, colSpan, oldRowStart, oldColStart, current: {row,col}|null }
  const [moving, setMoving] = useState(null)

  const [hoveredBoxId, setHoveredBoxId] = useState(null)
  const [isTouchDevice] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  )
  const longPressTimer = useRef(null)
  // containerRef is a plain ref for all the point-in-time DOM reads
  // elsewhere (querySelector, getBoundingClientRect) - those don't need
  // reactivity. containerVersion exists purely so the measure effect
  // below can react to the DOM node ITSELF being swapped (full-screen
  // toggling re-parents this container between a portal and inline,
  // a real mount/unmount, not just a style change) - a plain ref
  // mutation is invisible to React, so setContainerRef bumps a real
  // state value exactly when that swap actually happens, letting the
  // measurement effect fire at the true right moment instead of
  // guessing a duration to wait.
  const containerRef = useRef(null)
  const [containerVersion, setContainerVersion] = useState(0)
  const setContainerRef = useCallback((node) => {
    containerRef.current = node
    setContainerVersion((v) => v + 1)
  }, [])
  const tapPopupRef = useRef(null)

  // Outside-click closes the tap-opened detail popup - previously the
  // only way to dismiss it was the explicit X button. Checks against
  // the popup's own DOM node (tapPopupRef) so a click actually inside
  // it (its own buttons already stopPropagation, but this is a second,
  // independent safety net) never closes it, and against the tapped
  // box's own button so re-tapping the SAME box doesn't fight with its
  // own onClick handler for who gets to decide the next state.
  useEffect(() => {
    if (!editingBoxId || assignForm) return
    const handleOutside = (e) => {
      const insidePopup = tapPopupRef.current?.contains(e.target)
      const insideBox = e.target.closest?.('[data-box-id]')
      if (!insidePopup && !insideBox) setEditingBoxId(null)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [editingBoxId, assignForm])

  // Both popups' orientation/positioning logic is keyed to isFullScreen
  // (and isPortrait) - closing them on any full-screen toggle avoids a
  // popup computed for one mode lingering, stale, into the other.
  useEffect(() => {
    setEditingBoxId(null)
    setHoveredBoxId(null)
  }, [isFullScreen])
  const [scale, setScale] = useState(1)
  // Pan/zoom, full-screen mode only - the normal view always stays at
  // the auto-fit "see everything" level below, with no manual zoom
  // drift possible. zoomScale is a multiplier on top of the auto-fit
  // scale; panX/panY are pixel offsets. Both reset on every full-
  // screen toggle, so re-entering always starts fresh at the fit-all
  // view, matching the explicit request that full-screen should start
  // by showing everything, with zoom/pan available from there for detail.
  const [zoomScale, setZoomScale] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  useEffect(() => {
    setZoomScale(1)
    setPanOffset({ x: 0, y: 0 })
  }, [isFullScreen])
  const gestureRef = useRef(null) // tracks in-progress pan/pinch state between touch events

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const piles = useLiveQuery(
    () => currentWarehouseId
      ? db.piles.where('warehouseId').equals(currentWarehouseId).and((p) => !p.isAccountabilityPile).toArray()
      : [],
    [currentWarehouseId]
  ) ?? []
  const boxes = useLiveQuery(
    () => currentWarehouseId ? db.pileLayoutBoxes.where('warehouseId').equals(currentWarehouseId).toArray() : [],
    [currentWarehouseId]
  ) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []

  // When a period is selected, every pile's bags/kilos are reconstructed
  // as of periodTo instead of showing today's live running total -
  // without this, "check last month" and "check today" would show
  // identical (today's) figures, since piles.currentBags/currentKilos
  // always reflect the present moment regardless of what the user is
  // actually asking to see.
  const historicalMap = useLiveQuery(async () => {
    if (!periodTo || piles.length === 0) return null
    const entries = await Promise.all(
      piles.map(async (p) => [p.pileId, await computeHistoricalPileState(p.pileId, periodTo)])
    )
    return new Map(entries)
  }, [periodTo, piles]) ?? null

  const effectivePiles = historicalMap
    ? piles.map((p) => {
        const hist = historicalMap.get(p.pileId)
        return hist ? { ...p, currentBags: hist.bags, currentKilos: hist.kilos } : p
      })
    : piles

  const pileMap = new Map(effectivePiles.map((p) => [p.pileId, p]))
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sortedPiles = [...effectivePiles].sort((a, b) => byAlpha(a.pileName, b.pileName))

  // Auto-vacate: a pile that's been at zero bags AND zero kilos since
  // before today (one full calendar day's grace period - it still
  // shows normally, with its 0 values and transactions, for the rest
  // of the day it actually reaches zero) has its box cleared so the
  // layout reflects reality without a user having to remember to
  // manually close it. Runs whenever this page is open for this
  // warehouse - there's no background job in this client-side app, so
  // a pile that never gets its warehouse's layout viewed again simply
  // won't auto-vacate until it is.
  useEffect(() => {
    if (!currentWarehouseId || boxes.length === 0 || piles.length === 0) return
    const today = todayLocalISO()
    const pileById = new Map(piles.map((p) => [p.pileId, p]))
    const eligible = boxes.filter((b) => {
      if (!b.pileId) return false
      const p = pileById.get(b.pileId)
      return p?.zeroedDate && p.zeroedDate < today && !p.closedDate
    })
    if (eligible.length === 0) return
    ;(async () => {
      for (const box of eligible) await vacateBoxForPile(box.pileId, today)
    })()
  }, [currentWarehouseId, boxes, piles])

  // One-time self-heal: boxes assigned before assignedDate was corrected
  // to use the pile's own dateOfReceipt (see handleConfirmAssign) got
  // stamped with the UI-click date instead, which hid them from any
  // historical view predating that click even though their pile's real
  // "as of" date was earlier. Whenever a box's assignedDate is later
  // than its current occupant's dateOfReceipt, back-date it to match -
  // safe to run every time this page loads since it's a no-op once
  // corrected.
  useEffect(() => {
    if (!currentWarehouseId || boxes.length === 0 || piles.length === 0) return
    const pileById = new Map(piles.map((p) => [p.pileId, p]))
    const stale = boxes.filter((b) => {
      if (!b.pileId || !b.assignedDate) return false
      const p = pileById.get(b.pileId)
      return p?.dateOfReceipt && p.dateOfReceipt < b.assignedDate
    })
    if (stale.length === 0) return
    ;(async () => {
      for (const box of stale) {
        const p = pileById.get(box.pileId)
        await db.pileLayoutBoxes.update(box.id, { assignedDate: p.dateOfReceipt })
      }
    })()
  }, [currentWarehouseId, boxes, piles])

  // History-aware box rendering: when periodTo predates a box's current
  // occupancy stint (assignedDate), substitute whichever pileLayoutHistory
  // stint actually covered periodTo for THAT box - position, size, and
  // occupant, not just totals (which historicalMap/effectivePiles above
  // already handles). Boxes never touched since this feature shipped have
  // no assignedDate yet, so they always show their live/current state
  // regardless of periodTo - there's no history to substitute for them.
  const layoutHistory = useLiveQuery(
    () => (periodTo && currentWarehouseId)
      ? db.pileLayoutHistory.where('warehouseId').equals(currentWarehouseId).toArray()
      : [],
    [periodTo, currentWarehouseId]
  ) ?? []

  const effectiveBoxes = !periodTo ? boxes : boxes.map((box) => {
    if (!box.assignedDate || periodTo >= box.assignedDate) return box
    const covering = layoutHistory
      .filter((h) => h.boxId === box.id && h.occupiedTo && periodTo <= h.occupiedTo && (!h.occupiedFrom || periodTo >= h.occupiedFrom))
      .sort((a, b) => (a.occupiedTo < b.occupiedTo ? 1 : -1))[0]
    if (!covering) return { ...box, pileId: null, label: null }
    return { ...box, pileId: covering.pileId, rowStart: covering.rowStart, rowSpan: covering.rowSpan, colStart: covering.colStart, colSpan: covering.colSpan }
  })

  // The DISPLAY crops to only the columns/rows actually in use, so unused
  // grid space isn't wasted as blank margin - this directly makes every
  // cell (and its text) bigger on screen. While actively drawing a new
  // pile, the full nominal grid is shown instead, so the user can still
  // place a box anywhere, including beyond the current used bounds.
  const MIN_VISIBLE_COLS = 8
  const MIN_VISIBLE_ROWS = 6
  const usedCols = boxes.length
    ? Math.max(MIN_VISIBLE_COLS, ...boxes.map((b) => b.colStart + b.colSpan - 1))
    : MIN_VISIBLE_COLS
  const usedRows = boxes.length
    ? Math.max(MIN_VISIBLE_ROWS, ...boxes.map((b) => b.rowStart + b.rowSpan - 1))
    : MIN_VISIBLE_ROWS
  const visibleCols = (drawing || moving) ? GRID_COLS : usedCols
  const visibleRows = (drawing || moving) ? GRID_ROWS : usedRows

  useEffect(() => {
    const CONTAINER_PADDING = 8 // matches p-2 (0.5rem) on containerRef
    const BOTTOM_NAV_HEIGHT = isFullScreen ? 0 : 64
    const BOTTOM_SAFETY_MARGIN = 16 // breathing room below the grid before the nav
    const measure = () => {
      if (!containerRef.current) return
      const naturalW = visibleCols * BASE_CELL_PX
      const naturalH = visibleRows * BASE_CELL_PX
      const availableW = containerRef.current.offsetWidth - CONTAINER_PADDING * 2

      // Available height must be measured against the actual viewport,
      // not the container's own offsetHeight - that's circular here,
      // since the container's height is itself DERIVED from the scale
      // being calculated (it grows/shrinks to fit its scaled child),
      // not an independent, fixed space to measure against. When the
      // CSS forced-landscape rotation is active, the visual "height"
      // after rotation is actually the physical screen's WIDTH
      // dimension, not window.innerHeight - using the wrong one here
      // would measure against the tall (pre-rotation) axis instead of
      // the short one the grid is actually being fit into.
      const containerTop = containerRef.current.getBoundingClientRect().top
      const viewportHeightForFit = (isFullScreen && isPortrait) ? window.innerWidth : window.innerHeight
      const availableH = viewportHeightForFit - containerTop - BOTTOM_NAV_HEIGHT - BOTTOM_SAFETY_MARGIN - CONTAINER_PADDING * 2

      const widthScale = availableW / naturalW
      const heightScale = availableH / naturalH
      // Whichever dimension is more restrictive wins - the grid must
      // fit within BOTH width and height at once, not just whichever
      // was checked.
      setScale(Math.min(1, widthScale, heightScale))
    }
    // Toggling isFullScreen either way swaps FullScreenOverlay between
    // portaling containerRef's subtree to document.body and rendering
    // it inline - a real DOM restructuring (not just a style change),
    // and the two directions settle on very different schedules.
    // ENTERING re-parents the DOM within the same render cascade as
    // isFullScreen flipping true (no artificial delay), so measuring
    // eagerly after a single frame is safe and keeps the entrance
    // prompt. EXITING deliberately does NOT re-parent immediately -
    // FullScreenOverlay keeps the old, still-rotated full-screen DOM
    // mounted until its closing animation's real `animationend` fires,
    // which can be any amount of time later. Eagerly measuring after
    // one frame here would read that stale, still-full-screen DOM
    // combined with this effect's already-updated non-fullscreen math
    // (comparing against window.innerHeight instead of the rotated
    // window.innerWidth) - the mismatch produced a wildly wrong, too-
    // large scale that visibly ballooned the grid right as the exit
    // animation started. So on exit this effect does nothing eager at
    // all - containerVersion (bumped by setContainerRef, only when the
    // DOM node is ACTUALLY swapped - see its own comment) re-runs this
    // whole effect at the real right moment instead, and the fresh
    // ResizeObserver created below reports the new node's real size
    // asynchronously as soon as it starts observing, with no guessed
    // duration involved anywhere.
    let frame
    if (isFullScreen) {
      frame = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', measure)

    let observer
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure())
      observer.observe(containerRef.current)
    }

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [visibleCols, visibleRows, isFullScreen, isPortrait, containerVersion])

  const assignedPileIds = new Set(
    boxes.filter((b) => b.id !== editingBoxId && b.pileId).map((b) => b.pileId)
  )
  const availablePiles = sortedPiles.filter(
    (p) => !assignedPileIds.has(p.pileId) || p.pileId === pileId
  )

  const cancelDrawing = () => {
    setDrawing(null)
    setAssignForm(null)
    setPileId('')
    setLabel('')
    setEditingBoxId(null)
    setMoving(null)
  }

  const startDrawing = () => {
    cancelDrawing()
    setDrawing({ start: null, current: null })
  }

  const regionValid = (region, excludeId) => {
    if (!withinBounds(region)) return false
    return !boxes.some((b) => {
      if (b.id === excludeId) return false
      const pile = b.pileId ? pileMap.get(b.pileId) : null
      const variety = pile ? varietyMap.get(pile.varietyId) : null
      const fieldCount = countPileFields(pile, variety)
      const effective = { ...b, rowSpan: effectiveRowSpan(b, fieldCount) }
      return boxesOverlap(region, effective)
    })
  }

  // Hover only updates the live preview while still choosing the end
  // corner - it never fires after the box is locked in.
  const handleCellHover = (row, col) => {
    if (!drawing?.start || drawing.locked) return
    setDrawing({ start: drawing.start, current: { row, col }, locked: false })
  }

  // A click either sets the starting corner, or - if a start already
  // exists - locks the box in place at the clicked cell immediately.
  // The preview freezes right there instead of continuing to follow the
  // pointer, and the assign-pile modal opens over it.
  const handleCellClick = (row, col) => {
    if (!drawing) return
    if (!drawing.start) {
      setDrawing({ start: { row, col }, current: { row, col }, locked: false })
      return
    }
    const region = regionFromCorners(drawing.start, { row, col })
    if (!regionValid(region, editingBoxId)) {
      toast.error('That area overlaps an existing pile or exceeds the layout boundary')
      return
    }
    setDrawing({ start: drawing.start, current: { row, col }, locked: true })
    setAssignForm({ region })
  }

  const handleEditBox = (box) => {
    setEditingBoxId(box.id)
    setPileId(box.pileId ?? '')
    setLabel(box.label ?? '')
    setAssignForm({ region: { rowStart: box.rowStart, rowSpan: box.rowSpan, colStart: box.colStart, colSpan: box.colSpan } })
  }

  // Tapping/clicking a box now shows a lightweight details+actions popup
  // (Move/Delete, plus an Edit button on desktop only) instead of
  // jumping straight into the full rename/assign form - that form is
  // now reserved for the explicit Edit button. Reuses editingBoxId as
  // the "which box is selected" state (handleStartMove and delete
  // already depend on it); leaving assignForm null is what keeps the
  // popup showing instead of the full form.
  const handleTapBox = (box) => {
    setEditingBoxId((current) => (current === box.id ? null : box.id))
  }

  // Move: reposition an existing box without changing its size. The box
  // stays visible (ghosted) at its old position while a live preview -
  // same span, colored green/red for valid/invalid - follows the
  // pointer/touch at the candidate new position. A single tap on a valid
  // cell confirms the move immediately; no separate confirm step needed
  // since the pile assignment itself never changes during a move.
  const handleStartMove = () => {
    const box = boxes.find((b) => b.id === editingBoxId)
    if (!box) return
    setAssignForm(null)
    setMoving({
      boxId: box.id, rowSpan: box.rowSpan, colSpan: box.colSpan,
      oldRowStart: box.rowStart, oldColStart: box.colStart,
      current: null,
    })
  }

  const cancelMove = () => {
    setMoving(null)
    setEditingBoxId(null)
    setPileId('')
    setLabel('')
  }

  const handleMoveHover = (row, col) => {
    if (!moving) return
    setMoving({ ...moving, current: { row, col } })
  }

  const handleMoveClick = async (row, col) => {
    if (!moving) return
    const candidate = { rowStart: row, rowSpan: moving.rowSpan, colStart: col, colSpan: moving.colSpan }
    if (!regionValid(candidate, moving.boxId)) {
      toast.error('That position overlaps an existing pile or exceeds the layout boundary')
      return
    }
    // pileLayoutHistory tracks GEOMETRY, not just occupant identity - a
    // move repositions the box without changing its pile, but a
    // historical layout view still needs to know where it used to sit.
    // Only log if the box currently holds a pile - a move of an empty/
    // vacant box has no history worth reconstructing.
    const box = boxes.find((b) => b.id === moving.boxId)
    if (box?.pileId) {
      await db.pileLayoutHistory.add({
        id: crypto.randomUUID(), warehouseId: box.warehouseId, boxId: box.id, pileId: box.pileId,
        rowStart: box.rowStart, rowSpan: box.rowSpan, colStart: box.colStart, colSpan: box.colSpan,
        occupiedFrom: box.assignedDate ?? null, occupiedTo: todayLocalISO(),
      })
    }
    await db.pileLayoutBoxes.update(moving.boxId, { rowStart: row, colStart: col, assignedDate: todayLocalISO() })
    toast.success('Pile moved')
    setMoving(null)
    setEditingBoxId(null)
    setPileId('')
    setLabel('')
  }

  const handleConfirmAssign = async () => {
    if (!pileId && !label.trim()) {
      toast.error('Select a pile, or enter a label for a vacant box')
      return
    }
    if (pileId) {
      const alreadyUsed = boxes.some((b) => b.id !== editingBoxId && b.pileId === pileId)
      if (alreadyUsed) {
        toast.error('That pile is already assigned to another box')
        return
      }
    }

    const payload = {
      warehouseId: currentWarehouseId,
      ...assignForm.region,
      pileId: pileId || null,
      label: label.trim() || null,
    }
    // Stamp when this box's CURRENT occupant/geometry stint began -
    // only when pileId is genuinely changing (fresh assignment or
    // reassignment), not on every metadata edit of an unchanged pile.
    // Uses the PILE's own start date (dateOfReceipt - either its
    // beginning-balance "as of" date or its first receipt date), not
    // the date the admin happened to click assign in the layout UI -
    // otherwise a pile backdated to e.g. July 31 would only appear in
    // the layout from today onward instead of from its real as-of date.
    const previousBox = editingBoxId ? boxes.find((b) => b.id === editingBoxId) : null
    if (pileId && pileId !== previousBox?.pileId) {
      const assignedPile = piles.find((p) => p.pileId === pileId)
      payload.assignedDate = assignedPile?.dateOfReceipt || todayLocalISO()
    }

    try {
      if (editingBoxId) {
        await db.pileLayoutBoxes.update(editingBoxId, payload)
        toast.success('Pile updated')
      } else {
        await db.pileLayoutBoxes.add({ id: crypto.randomUUID(), ...payload })
        toast.success('Pile added')
      }
      cancelDrawing()
    } catch (err) {
      // Previously any failure here (e.g. a write error) failed
      // completely silently - matching the reported symptom of
      // "some fields silently fail to save." Now surfaced visibly.
      console.error('Failed to save pile layout box:', err)
      toast.error('Failed to save - see console for details')
    }
  }

  const handleDeleteConfirmed = async () => {
    await db.pileLayoutBoxes.delete(pendingDelete.id)
    toast.success('Box removed')
    setPendingDelete(null)
    cancelDrawing()
  }

  const handleLongPressStart = (boxId) => {
    if (isFullScreen) return // conflicts with pan gestures, which also start from touchstart on a box
    longPressTimer.current = setTimeout(() => setHoveredBoxId(boxId), LONG_PRESS_MS)
  }
  const handleLongPressEnd = () => {
    clearTimeout(longPressTimer.current)
  }

  const handleExportPileBinCard = async (pile) => {
    // Previously had no error handling at all - any failure (a thrown
    // error inside generatePileBinCard, or doc.save() itself) rejected
    // silently with no visible feedback, matching the reported symptom
    // of the button just "not functioning." Same fix already applied
    // to handleSave above.
    try {
      const province = currentWarehouse?.provinceId ? await db.provinces.get(currentWarehouse.provinceId) : null
      const branch = province?.branchId ? await db.branches.get(province.branchId) : null
      const variety = varietyMap.get(pile.varietyId)

      const allPileTransactions = await db.transactions.where('pileId').equals(pile.pileId).toArray()
      const wtsTransfers = await db.transactions
        .where('type').equals('WTS')
        .and((t) => t.issuedPileId === pile.pileId || t.receivedPileId === pile.pileId)
        .toArray()
      const transactionTypes = await db.transactionTypes.toArray()
      const transactionTypeMap = new Map(transactionTypes.map((t) => [t.transactionTypeId, t.name]))

      const doc = generatePileBinCard({
        warehouse: currentWarehouse, branch, pile, variety,
        transactions: [...allPileTransactions, ...wtsTransfers],
        transactionTypeMap,
      })
      doc.save(`${(pile.pileName || 'Pile').replace(/[^a-z0-9]+/gi, '-')}-BIN-Card.pdf`)
      // Was missing entirely - a silent success looked identical to a
      // silent failure, which is exactly why this was reported as "not
      // functioning" even on runs that actually worked.
      toast.success('BIN card exported')
    } catch (err) {
      console.error('Failed to export pile BIN card:', err)
      toast.error('Failed to export BIN card - see console for details')
    }
  }

  const handleExport = async () => {
    if (!periodFrom || !periodTo) {
      toast.error('Set both Period From and Period To before exporting')
      return
    }
    if (boxes.length === 0) {
      toast.error('Add at least one pile to the layout before exporting')
      return
    }

    setIsExporting(true)
    try {
      const province = currentWarehouse?.provinceId ? await db.provinces.get(currentWarehouse.provinceId) : null
      const branch = province?.branchId ? await db.branches.get(province.branchId) : null
      const reportConfig = await db.reportConfig.get('global')

      const supervisors = await db.users
        .where('role').anyOf(['Warehouse Supervisor', 'Acting Warehouse Supervisor'])
        .and((u) => (u.assignedWarehouses ?? []).includes(currentWarehouseId))
        .toArray()
      const supervisor = supervisors[0] ?? null
      const supervisorSignatory = supervisor ? await db.signatories.get(supervisor.uid) : null
      const certifiedCorrectPosition = supervisor?.role === 'Acting Warehouse Supervisor' || supervisorSignatory?.capacity === 'Acting Warehouse Supervisor'
        ? 'Acting Warehouse Supervisor'
        : 'Warehouse Supervisor'

      const enrichedBoxes = effectiveBoxes.map((box) => {
        const pile = box.pileId ? pileMap.get(box.pileId) : null
        const variety = pile ? varietyMap.get(pile.varietyId) : null
        const formattedAge = pile?.initialAgeValue != null
          ? fmtAge(calculateCurrentAge(pile.initialAgeValue, pile.dateOfReceipt, autoAgeMonitoring, periodTo || undefined))
          : null
        return { ...box, pile: pile ? { ...pile, formattedAge } : pile, variety }
      })

      const doc = generatePileLayoutReport({
        warehouse: currentWarehouse,
        branch,
        periodFrom, periodTo,
        gridCols: GRID_COLS, gridRows: GRID_ROWS,
        boxes: enrichedBoxes,
        signatories: {
          preparedByName: currentWarehouse?.classifierName ?? null,
          verifiedCorrect: reportConfig?.bsqao ?? null,
          certifiedCorrectName: supervisor?.name ?? null,
          certifiedCorrectPosition,
          notedByName: reportConfig?.notedByName ?? null,
          notedByPosition: reportConfig?.notedByPosition ?? null,
        },
      })

      doc.save(`${sanitizeForFilename(currentWarehouse?.name) || 'WH'}-PileLayout-${fmtDateForFilename(periodFrom)}-${fmtDateForFilename(periodTo)}.pdf`)
      toast.success('Pile Layout PDF exported')
    } catch (err) {
      console.error(err)
      toast.error('Export failed — check console')
    } finally {
      setIsExporting(false)
    }
  }

  const naturalWidth = visibleCols * BASE_CELL_PX
  const naturalHeight = visibleRows * BASE_CELL_PX

  const PAN_MOVE_THRESHOLD = 8 // px - below this, a touch is treated as a tap, not a pan
  const MIN_ZOOM = 1
  const MAX_ZOOM = 4

  const touchDistance = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)

  const handleGridTouchStart = (e) => {
    if (!isFullScreen || drawing || moving) return // normal view and drawing/moving modes need precise, unmodified tap targeting
    if (e.touches.length === 2) {
      gestureRef.current = {
        type: 'pinch',
        startDistance: touchDistance(e.touches[0], e.touches[1]),
        startZoom: zoomScale,
        startPan: panOffset,
      }
    } else if (e.touches.length === 1) {
      gestureRef.current = {
        type: 'pan-candidate',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startPan: panOffset,
      }
    }
  }

  const handleGridTouchMove = (e) => {
    const gesture = gestureRef.current
    if (!gesture) return

    if (gesture.type === 'pinch' && e.touches.length === 2) {
      e.preventDefault() // stop the browser's own native pinch-to-zoom-the-page from also firing
      const ratio = touchDistance(e.touches[0], e.touches[1]) / gesture.startDistance
      setZoomScale(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.startZoom * ratio)))
    } else if (gesture.type === 'pan-candidate' || gesture.type === 'panning') {
      const screenDX = e.touches[0].clientX - gesture.startX
      const screenDY = e.touches[0].clientY - gesture.startY
      if (gesture.type === 'pan-candidate' && Math.hypot(screenDX, screenDY) < PAN_MOVE_THRESHOLD) return // still within tap tolerance - not a pan yet
      gesture.type = 'panning'
      e.preventDefault()
      // Raw touch coordinates are in real screen space and are NOT
      // auto-adjusted for the CSS rotation applied when forced-
      // landscape is active - the content's local axes are rotated
      // 90 degrees relative to the screen, so a screen-space swipe
      // has to be re-mapped onto the content's own local axes for the
      // pan to move in the direction the user actually swiped.
      const [localDX, localDY] = isPortrait ? [screenDY, -screenDX] : [screenDX, screenDY]
      setPanOffset({ x: gesture.startPan.x + localDX, y: gesture.startPan.y + localDY })
    }
  }

  const handleGridTouchEnd = () => {
    gestureRef.current = null
  }

  const previewRegion = drawing?.start && drawing?.current
    ? regionFromCorners(drawing.start, drawing.current)
    : null
  const previewValid = previewRegion ? regionValid(previewRegion, editingBoxId) : false

  const moveRegion = moving?.current
    ? { rowStart: moving.current.row, rowSpan: moving.rowSpan, colStart: moving.current.col, colSpan: moving.colSpan }
    : null
  const moveValid = moveRegion ? regionValid(moveRegion, moving.boxId) : false

  // Drawing/moving status + its Cancel button, or the idle "Add Pile"
  // button - rendered in two different places (the normal header, and
  // again inside FullScreenOverlay for full-screen mode) since neither
  // is a valid substitute for the other; a closure over drawing/moving/
  // cancelDrawing/cancelMove/startDrawing here keeps both call sites in
  // sync with zero duplicated JSX.
  const PileControlsRow = () => (
    drawing ? (
      <div className="flex items-center gap-2">
        <span className="text-xs text-brand-amber">
          {drawing.start ? 'Tap the ending corner' : 'Tap the starting corner'}
        </span>
        <button type="button" onClick={cancelDrawing}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400">
          Cancel
        </button>
      </div>
    ) : moving ? (
      <div className="flex items-center gap-2">
        <span className="text-xs text-brand-amber">Tap where this pile should go</span>
        <button type="button" onClick={cancelMove}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400">
          Cancel
        </button>
      </div>
    ) : (
      <button type="button" onClick={startDrawing}
        className="flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-brand-neon">
        <Plus size={14} /> Add Pile
      </button>
    )
  )

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
      <div ref={warehouseSectionRef}>
        {sortedWarehouses.length > 1 ? (
          <div className="mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</label>
            <select value={currentWarehouseId ?? ''} onChange={(e) => setCurrentWarehouseId(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-3 text-base font-semibold text-app-text outline-none focus:border-brand-neon">
              {sortedWarehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.code} — {w.name}</option>)}
            </select>
          </div>
        ) : currentWarehouse ? (
          <div className="mt-3 rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</p>
            <p className="text-base font-bold text-app-text">
              {currentWarehouse.code} — {currentWarehouse.name}
            </p>
          </div>
        ) : null}
      </div>
      <StickyWarehouseIndicator targetRef={warehouseSectionRef} warehouse={currentWarehouse} />

      <div className="relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: pilesTab === 'list' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {[['list', 'Pile List'], ['layout', 'Pile Layout']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPilesTab(key)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium transition-colors active:scale-95 ${
              pilesTab === key ? 'text-brand-contrast' : 'text-neutral-400 hover:text-app-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {pilesTab === 'list' && (
        <div key={`list-${currentWarehouseId}`} className="animate-flow-down">
          <HomePiles />
        </div>
      )}

      {pilesTab === 'layout' && (
      <div key={`layout-${currentWarehouseId}`} className="animate-flow-down">
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Period From</label>
          <CalendarDatePicker
            value={periodFrom}
            label="Start Date"
            onChange={(iso) => {
              setPeriodFrom(iso)
              periodToPickerRef.current?.open()
            }}
          />
        </div>
        <div>
          <label className={labelClass}>Period To</label>
          <CalendarDatePicker ref={periodToPickerRef} value={periodTo} label="End Date" onChange={setPeriodTo} />
        </div>
      </div>

      {/* Quick-pick presets for a chosen month's common reporting
          periods - tapping one fills both Period From and Period To at
          once. The month can be navigated (not just assumed as
          "current"), since a delayed report is often filed a few days
          into the next month but is actually for the period that just
          completed. */}
      <PeriodPresetPicker onSelectRange={(from, to) => { setPeriodFrom(from); setPeriodTo(to) }} currentFrom={periodFrom} currentTo={periodTo} />

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-app-text">Layout</h2>
          <button
            type="button"
            onClick={() => setIsFullScreen((v) => !v)}
            aria-label={isFullScreen ? 'Exit full screen' : 'Full screen'}
            className="rounded-lg p-1.5 text-neutral-400 transition-all hover:text-brand-neon active:scale-90"
          >
            {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
        {/* Hidden while full-screen (rendered again below, inside
            FullScreenOverlay, instead) - this row sits outside the
            overlay's own portaled DOM subtree, so while full-screen it
            was completely covered by FullScreenOverlay's opaque
            fixed/z-50 layer: not just visually behind it but genuinely
            unreachable, which is why the Cancel button for an
            in-progress move/draw seemed to vanish entirely once full
            screen was toggled on mid-action. */}
        {!isFullScreen && <PileControlsRow />}
      </div>

      {/* overflow-hidden so nothing ever renders outside this bordered
          display area - including the hover-detail popup below, which is
          explicitly clamped to these same bounds. */}
      <FullScreenOverlay ref={setOverlayNode} isFullScreen={isFullScreen} isPortrait={isPortrait}>
        {isFullScreen && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsFullScreen(false)}
              className="flex w-fit items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-app-text active:scale-95"
            >
              <ArrowLeft size={16} /> Back
            </button>
            <PileControlsRow />
          </div>
        )}
        <div
          ref={setContainerRef}
          // Centering (flex items-center justify-center) previously only
          // applied in full-screen mode - in the normal view the grid
          // just sat at its natural top-left position instead, which is
          // what made the piles look stuck in a corner with a lot of
          // dead space around them whenever the grid's own fit-scale
          // came out smaller than the container. flex-1 (grow to fill
          // the parent flex column) stays full-screen-only, since it
          // has no meaning/effect outside FullScreenOverlay's flex
          // column layout.
          className={`relative mt-2 flex items-center justify-center overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 p-2 ${isFullScreen ? 'flex-1' : ''}`}
          onTouchStart={handleGridTouchStart}
          onTouchMove={handleGridTouchMove}
          onTouchEnd={handleGridTouchEnd}
          onTouchCancel={handleGridTouchEnd}
        >
        <div
          style={{
            width: naturalWidth * scale, height: naturalHeight * scale,
            overflow: isFullScreen ? 'visible' : 'hidden',
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
            transformOrigin: 'center',
          }}
        >
          <div
            className="relative"
            style={{
              width: naturalWidth, height: naturalHeight,
              transform: `scale(${scale})`, transformOrigin: 'top left',
            }}
          >
            {effectiveBoxes.map((box) => {
              if (moving?.boxId === box.id) return null
              const pile = box.pileId ? pileMap.get(box.pileId) : null
              const variety = pile ? varietyMap.get(pile.varietyId) : null
              const isVacant = !pile
              const fillColor = isVacant
                ? undefined
                : variety?.category === 'Palay'
                  ? PALAY_COLOR
                  : variety?.category === 'By Products'
                    ? BYPRODUCT_COLOR
                    : RICE_COLOR
              const isHovered = hoveredBoxId === box.id

              return (
                <button
                  key={box.id}
                  data-box-id={box.id}
                  type="button"
                  disabled={Boolean(drawing || moving)}
                  onClick={() => !drawing && handleTapBox(box)}
                  onMouseEnter={() => setHoveredBoxId(box.id)}
                  onMouseLeave={() => setHoveredBoxId(null)}
                  onTouchStart={() => handleLongPressStart(box.id)}
                  onTouchEnd={handleLongPressEnd}
                  onTouchMove={handleLongPressEnd}
                  style={{
                    position: 'absolute',
                    left: (box.colStart - 1) * BASE_CELL_PX + 1,
                    top: (box.rowStart - 1) * BASE_CELL_PX + 1,
                    width: box.colSpan * BASE_CELL_PX - 2,
                    height: box.rowSpan * BASE_CELL_PX - 2,
                    backgroundColor: fillColor,
                    zIndex: isHovered ? 5 : 1,
                    outline: isHovered ? '2px solid #00FFA3' : 'none',
                  }}
                  className={`overflow-hidden rounded-md border p-1 text-left ${
                    isVacant ? 'border-neutral-700 bg-neutral-900 text-neutral-500' : 'border-neutral-800 text-brand-contrast'
                  } ${(drawing || moving) ? 'pointer-events-none opacity-40' : ''}`}
                >
                  <p className="truncate text-center text-sm font-bold leading-tight">
                    {pile?.pileName ?? box.label ?? 'Box'}
                  </p>
                  {isVacant ? (
                    <p className="text-center text-xs text-neutral-600">VACANT</p>
                  ) : (
                    <div className="mt-0.5 text-center leading-tight">
                      <p className="truncate text-xs">{variety?.name ?? ''}</p>
                      <p className="truncate text-xs font-medium">{fmtBags(pile.currentBags)} bags</p>
                      <p className="truncate text-xs font-medium">{fmtWeight(pile.currentKilos, weightUnit)}</p>
                    </div>
                  )}
                </button>
              )
            })}

            {/* Live semi-transparent drag preview (new pile) */}
            {previewRegion && (
              <div
                className={`pointer-events-none absolute rounded-md border-2 ${
                  previewValid ? 'border-brand-neon bg-brand-neon/30' : 'border-brand-crimson bg-brand-crimson/30'
                }`}
                style={{
                  left: (previewRegion.colStart - 1) * BASE_CELL_PX,
                  top: (previewRegion.rowStart - 1) * BASE_CELL_PX,
                  width: previewRegion.colSpan * BASE_CELL_PX,
                  height: previewRegion.rowSpan * BASE_CELL_PX,
                  zIndex: 20,
                }}
              />
            )}

            {/* Ghosted old position, shown for the whole move so the user
                always has a reference point for where the pile came from. */}
            {moving && (
              <div
                className="pointer-events-none absolute rounded-md border-2 border-dashed border-neutral-600 bg-neutral-700/30"
                style={{
                  left: (moving.oldColStart - 1) * BASE_CELL_PX,
                  top: (moving.oldRowStart - 1) * BASE_CELL_PX,
                  width: moving.colSpan * BASE_CELL_PX,
                  height: moving.rowSpan * BASE_CELL_PX,
                  zIndex: 19,
                }}
              />
            )}

            {/* Live green/red preview of where the pile would move to. */}
            {moveRegion && (
              <div
                className={`pointer-events-none absolute rounded-md border-2 ${
                  moveValid ? 'border-brand-neon bg-brand-neon/30' : 'border-brand-crimson bg-brand-crimson/30'
                }`}
                style={{
                  left: (moveRegion.colStart - 1) * BASE_CELL_PX,
                  top: (moveRegion.rowStart - 1) * BASE_CELL_PX,
                  width: moveRegion.colSpan * BASE_CELL_PX,
                  height: moveRegion.rowSpan * BASE_CELL_PX,
                  zIndex: 20,
                }}
              />
            )}

            {/* Tap/hover selection layer - every cell shows red (occupied,
                using each pile's EFFECTIVE grown footprint, not just its
                drawn size) or a subtle green tint (available), for both
                drawing a new pile and moving an existing one, so the user
                never has to guess where a pile can go. */}
            {(drawing || moving) && (
              <div
                className="absolute inset-0 grid"
                style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}
              >
                {Array.from({ length: GRID_ROWS * GRID_COLS }).map((_, i) => {
                  const row = Math.floor(i / GRID_COLS) + 1
                  const col = (i % GRID_COLS) + 1
                  const excludeId = moving ? moving.boxId : editingBoxId
                  const occupied = boxes.some((b) => {
                    if (b.id === excludeId) return false
                    const pile = b.pileId ? pileMap.get(b.pileId) : null
                    const variety = pile ? varietyMap.get(pile.varietyId) : null
                    const fieldCount = countPileFields(pile, variety)
                    const effRowSpan = effectiveRowSpan(b, fieldCount)
                    return row >= b.rowStart && row <= b.rowStart + effRowSpan - 1 &&
                           col >= b.colStart && col <= b.colStart + b.colSpan - 1
                  })
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => moving ? handleMoveClick(row, col) : handleCellClick(row, col)}
                      onMouseEnter={() => moving ? handleMoveHover(row, col) : handleCellHover(row, col)}
                      className={`border border-neutral-800/30 ${occupied ? 'bg-brand-crimson/20' : 'bg-brand-neon/10'}`}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
        </div>
        </FullScreenOverlay>

        {/* Hover/long-press detail popup - a sibling of the scaled grid
            (not a descendant), so it always renders at a real, readable
            pixel size regardless of how much the grid itself is shrunk
            to fit the screen. Sized to fit every field at once - never
            truncated - and clamped to stay within this container. */}
        {/* Suppressed entirely (not just for the same box) whenever a
            tap-opened detail popup is showing for ANY box - previously
            only checked hoveredBoxId !== editingBoxId, so hovering a
            DIFFERENT box while another box's tap popup was still open
            would show both at once, overlapping. */}
        {hoveredBoxId && !editingBoxId && (() => {
          const box = effectiveBoxes.find((b) => b.id === hoveredBoxId)
          if (!box) return null
          const pile = box.pileId ? pileMap.get(box.pileId) : null
          const variety = pile ? varietyMap.get(pile.varietyId) : null
          const isVacant = !pile

          const fields = isVacant ? [] : [
            variety?.name && ['Variety', variety.name],
            pile.currentBags != null && ['Bags', fmtBags(pile.currentBags)],
            pile.currentKilos != null && ['Net', fmtWeight(pile.currentKilos, weightUnit)],
            pile.initialAgeValue != null && ['Age', fmtAge(calculateCurrentAge(pile.initialAgeValue, pile.dateOfReceipt, autoAgeMonitoring, periodTo || undefined))],
            pile.condition && ['Condition', pile.condition],
            pile.moistureContent && ['MC', pile.moistureContent],
            pile.purity && ['Purity', pile.purity],
            pile.dateProcured && [pile.cerealType === 'Palay' ? 'Procured' : 'Received', pile.dateProcured],
          ].filter(Boolean)

          // 220 was cramped for the field text (especially at the
          // larger root font-size now used on wider screens) and for
          // the three-button Move/Delete/Edit row, which is what made
          // both the hover preview and the tap-opened detail look
          // squeezed and hard to read.
          const popupWidth = 264

          // The box's OWN real rendered position, read directly via
          // getBoundingClientRect() on its actual DOM element (matched
          // via data-box-id) rather than recomputed via a parallel
          // formula (the previous approach, using colStart/rowStart *
          // BASE_CELL_PX * scale plus the container's own origin). That
          // formula had to be kept in sync with every layout-affecting
          // change to the grid (padding, centering, zoom, pan...) and
          // had already drifted out of sync at least once - when
          // centering was made unconditional, it never accounted for
          // the box's now-centered offset within the container, which
          // is what put this popup far away from the pile it was
          // actually describing. Reading the real rect sidesteps that
          // whole class of bug entirely: correct regardless of scale,
          // zoom, pan, centering, or padding, since it is the browser's
          // own already-computed answer, not a re-derivation of it. It
          // is also automatically correct in full-screen portrait mode
          // without any compensating rotation on the popup itself,
          // since getBoundingClientRect() always returns real,
          // already-rotated screen coordinates regardless of any
          // transform on an ancestor.
          const boxEl = containerRef.current?.querySelector(`[data-box-id="${box.id}"]`)
          const boxRect = boxEl?.getBoundingClientRect()
          const viewportLeft = boxRect?.left ?? 0
          const viewportTop = boxRect?.top ?? 0
          const viewportRight = boxRect?.right ?? 0
          const viewportBottom = boxRect?.bottom ?? 0

          // Header (sticky, ~64px) and BottomNav (fixed, 64px) both
          // visually cover part of the true viewport regardless of
          // scroll position - accounted for here so the anchor-direction
          // decision reflects what's actually usable, not raw window size.
          const HEADER_HEIGHT = isFullScreen ? 0 : 64
          const BOTTOM_NAV_HEIGHT = isFullScreen ? 0 : 64
          const usableTop = HEADER_HEIGHT
          const usableBottom = window.innerHeight - BOTTOM_NAV_HEIGHT

          const isRightHalf = viewportLeft > window.innerWidth / 2
          const isBottomHalf = viewportTop > (usableTop + usableBottom) / 2
          // Same center-point anchor as the tap-detail popup below for
          // full-screen portrait - see its comment for why edge-
          // anchoring a box that becomes wide/short once rotated (this
          // one is tall: title + up to 7 field rows) overflows past a
          // fixed-width edge box sized for its pre-rotation shape.
          const useCenterAnchor = isFullScreen && isPortrait
          // The anchor point itself needs clamping away from the
          // screen edges, not just the box's own position - centering
          // is only overflow-proof against the popup's OWN edges, not
          // the viewport's. A box near a screen edge (e.g. the top-left
          // of the grid) still pushed the rotated popup half off-screen.
          // ROTATED_HALF_HEIGHT_ESTIMATE is a conservative half-height
          // for the popup's pre-rotation height (title + up to 7 fields
          // + a button row can run to ~360-400px) - exact content
          // height varies, so this errs generous rather than risk still
          // clipping a taller card.
          const ROTATED_HALF_WIDTH = popupWidth / 2
          const ROTATED_HALF_HEIGHT_ESTIMATE = 200
          const positionStyle = useCenterAnchor
            ? {
                position: 'fixed',
                left: Math.min(Math.max((viewportLeft + viewportRight) / 2, ROTATED_HALF_HEIGHT_ESTIMATE + 8), window.innerWidth - ROTATED_HALF_HEIGHT_ESTIMATE - 8),
                top: Math.min(Math.max((viewportTop + viewportBottom) / 2, ROTATED_HALF_WIDTH + 8), window.innerHeight - ROTATED_HALF_WIDTH - 8),
              }
            : {
                position: 'fixed',
                ...(isRightHalf
                  ? { right: Math.max(8, window.innerWidth - viewportRight) }
                  : { left: viewportLeft }),
                ...(isBottomHalf
                  ? { bottom: Math.max(8, window.innerHeight - viewportBottom) }
                  : { top: Math.max(usableTop + 8, viewportTop) }),
              }

          return createPortal(
            <div
              className="pointer-events-none fixed z-[60]"
              style={{ ...positionStyle, width: popupWidth }}
            >
              <div
                className="rounded-xl border-2 border-brand-neon bg-neutral-900 p-3 shadow-2xl"
                style={useCenterAnchor ? { transform: 'translate(-50%, -50%) rotate(90deg)' } : undefined}
              >
                <p className="text-base font-bold text-app-text">{pile?.pileName ?? box.label ?? 'Box'}</p>
                {isVacant ? (
                  <p className="mt-1 text-sm text-neutral-500">VACANT</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {fields.map(([lbl, val]) => (
                      <div key={lbl} className="flex justify-between gap-3 text-sm">
                        <span className="text-neutral-400">{lbl}</span>
                        <span className="font-medium text-app-text">{val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )
        })()}

        {/* !pendingDelete - previously this stayed visible while the
            delete ConfirmDialog was also open (both are portals to
            document.body at the same z-[60]), so the two overlapped
            instead of the confirmation cleanly replacing the detail
            view. */}
        {editingBoxId && !assignForm && !moving && !pendingDelete && (() => {
          const box = effectiveBoxes.find((b) => b.id === editingBoxId)
          if (!box) return null
          const pile = box.pileId ? pileMap.get(box.pileId) : null
          const variety = pile ? varietyMap.get(pile.varietyId) : null
          const isVacant = !pile

          const fields = isVacant ? [] : [
            variety?.name && ['Variety', variety.name],
            pile.currentBags != null && ['Bags', fmtBags(pile.currentBags)],
            pile.currentKilos != null && ['Net', fmtWeight(pile.currentKilos, weightUnit)],
            pile.initialAgeValue != null && ['Age', fmtAge(calculateCurrentAge(pile.initialAgeValue, pile.dateOfReceipt, autoAgeMonitoring, periodTo || undefined))],
            pile.condition && ['Condition', pile.condition],
            pile.moistureContent && ['MC', pile.moistureContent],
            pile.purity && ['Purity', pile.purity],
            pile.dateProcured && [pile.cerealType === 'Palay' ? 'Procured' : 'Received', pile.dateProcured],
          ].filter(Boolean)

          // 220 was cramped for the field text (especially at the
          // larger root font-size now used on wider screens) and for
          // the three-button Move/Delete/Edit row, which is what made
          // both the hover preview and the tap-opened detail look
          // squeezed and hard to read.
          const popupWidth = 264

          // Same real-rect lookup as the hover popup above - see its
          // comment for the full reasoning.
          const boxEl = containerRef.current?.querySelector(`[data-box-id="${box.id}"]`)
          const boxRect = boxEl?.getBoundingClientRect()
          const viewportLeft = boxRect?.left ?? 0
          const viewportTop = boxRect?.top ?? 0
          const viewportRight = boxRect?.right ?? 0
          const viewportBottom = boxRect?.bottom ?? 0

          const HEADER_HEIGHT = isFullScreen ? 0 : 64
          const BOTTOM_NAV_HEIGHT = isFullScreen ? 0 : 64
          const usableTop = HEADER_HEIGHT
          const usableBottom = window.innerHeight - BOTTOM_NAV_HEIGHT

          const isRightHalf = viewportLeft > window.innerWidth / 2
          const isBottomHalf = viewportTop > (usableTop + usableBottom) / 2
          // Full-screen portrait uses a plain center-point anchor
          // instead of the normal edge-anchored positioning - edge-
          // anchoring assumes the popup's rotated footprint stays
          // within the same width/height it had before rotating, which
          // is only true for a roughly-square box. This popup is tall
          // (title + fields + a 3-button row + an export button), so
          // once rotated 90deg its visual footprint becomes wide/short
          // instead - anchored by a fixed-width edge box sized for the
          // PRE-rotation shape, it visibly overflowed past where that
          // box's own bounds said it should stop. Centering the
          // (post-rotation) box on a single point instead has no edge
          // to overflow past in the first place, regardless of how the
          // rotated footprint's dimensions come out.
          const useCenterAnchor = isFullScreen && isPortrait
          // The anchor point itself needs clamping away from the
          // screen edges, not just the box's own position - centering
          // is only overflow-proof against the popup's OWN edges, not
          // the viewport's. A box near a screen edge (e.g. the top-left
          // of the grid) still pushed the rotated popup half off-screen.
          // ROTATED_HALF_HEIGHT_ESTIMATE is a conservative half-height
          // for the popup's pre-rotation height (title + up to 7 fields
          // + a button row can run to ~360-400px) - exact content
          // height varies, so this errs generous rather than risk still
          // clipping a taller card.
          const ROTATED_HALF_WIDTH = popupWidth / 2
          const ROTATED_HALF_HEIGHT_ESTIMATE = 200
          const positionStyle = useCenterAnchor
            ? {
                position: 'fixed',
                left: Math.min(Math.max((viewportLeft + viewportRight) / 2, ROTATED_HALF_HEIGHT_ESTIMATE + 8), window.innerWidth - ROTATED_HALF_HEIGHT_ESTIMATE - 8),
                top: Math.min(Math.max((viewportTop + viewportBottom) / 2, ROTATED_HALF_WIDTH + 8), window.innerHeight - ROTATED_HALF_WIDTH - 8),
              }
            : {
                position: 'fixed',
                ...(isRightHalf
                  ? { right: Math.max(8, window.innerWidth - viewportRight) }
                  : { left: viewportLeft }),
                ...(isBottomHalf
                  ? { bottom: Math.max(8, window.innerHeight - viewportBottom) }
                  : { top: Math.max(usableTop + 8, viewportTop) }),
              }

          return createPortal(
            <div
              ref={tapPopupRef}
              className="fixed z-[60]"
              style={{ ...positionStyle, width: popupWidth }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="rounded-xl border-2 border-brand-neon bg-neutral-900 p-3 shadow-2xl"
                // translate(-50%,-50%) first re-centers the box's own
                // center exactly on the anchor point (translate % is
                // relative to the element's own, pre-rotation size),
                // then rotate spins it around that now-centered point
                // (the default transform-origin, 50% 50%, is unchanged
                // by the translate) - the box's center stays pinned at
                // the anchor regardless of its rotated footprint size.
                style={useCenterAnchor ? { transform: 'translate(-50%, -50%) rotate(90deg)' } : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-bold text-app-text">{pile?.pileName ?? box.label ?? 'Box'}</p>
                  <button
                    type="button"
                    onClick={() => setEditingBoxId(null)}
                    aria-label="Close"
                    className="shrink-0 rounded-lg p-2 text-neutral-500 transition-colors hover:text-app-text"
                  >
                    <X size={18} />
                  </button>
                </div>
                {isVacant ? (
                  <p className="mt-1 text-sm text-neutral-500">VACANT</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {fields.map(([lbl, val]) => (
                      <div key={lbl} className="flex justify-between gap-3 text-sm">
                        <span className="text-neutral-400">{lbl}</span>
                        <span className="font-medium text-app-text">{val}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex gap-2 border-t border-neutral-800 pt-3">
                  <button
                    type="button"
                    onClick={handleStartMove}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-brand-amber/40 py-2 text-xs font-medium text-brand-amber transition-all active:scale-95"
                  >
                    <Move size={16} /> Move
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete({ id: editingBoxId })}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-brand-crimson/40 py-2 text-xs font-medium text-brand-crimson transition-all active:scale-95"
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                  {(!isTouchDevice || isVacant) && (
                    <button
                      type="button"
                      onClick={() => handleEditBox(box)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-700 py-2 text-xs font-medium text-neutral-300 transition-all active:scale-95"
                    >
                      <Pencil size={16} /> {isVacant ? 'Assign' : 'Edit'}
                    </button>
                  )}
                </div>
                {!isVacant && (
                  <button
                    type="button"
                    onClick={() => handleExportPileBinCard(pile)}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-700 py-2 text-xs font-medium text-neutral-300 transition-all active:scale-95"
                  >
                    Export BIN Card
                  </button>
                )}
              </div>
            </div>,
            document.body
          )
        })()}

      <p className="mt-1 text-xs text-neutral-500">
        {isTouchDevice ? 'Tap a pile to see its details, move, or delete it.' : 'Hover a pile to preview it, or click for details, move, delete, or edit.'}
      </p>

      {/* While full-screen, portals directly into FullScreenOverlay's
          own already-rotated DOM node (overlayNode) instead of
          document.body - this form is tall, variable-height, and
          bottom-anchored on mobile (not a small centered dialog like
          ConfirmDialog), so a manually-applied compensating rotate()
          came out badly mispositioned/clipped (rotating a tall,
          edge-anchored box around its own center swaps its effective
          width/height without correctly accounting for where its edges
          then land). Being a genuine descendant of the rotated
          container instead means it inherits the correct orientation
          for free, the same way the pile grid's own boxes already do -
          no rotation math needed on this end at all. Previously this
          was also a plain (non-portaled) div sharing FullScreenOverlay's
          own z-50, so document order alone decided which one visually
          buried the other - portaling explicitly avoids that tie too. */}
      {assignForm && createPortal(
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={cancelDrawing}>
          <div
            className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-app-text">{editingBoxId ? 'Edit Pile' : 'Assign Pile'}</h3>
              <button type="button" onClick={cancelDrawing} aria-label="Close" className="text-neutral-400 hover:text-app-text">
                <X size={18} />
              </button>
            </div>

            <div className="mt-3">
              <label className={labelClass}>Pile (leave blank for Vacant)</label>
              <select value={pileId} onChange={(e) => setPileId(e.target.value)} className={inputClass}>
                <option value="">Vacant</option>
                {availablePiles.map((p) => <option key={p.pileId} value={p.pileId}>{p.pileName}</option>)}
              </select>
              <p className="mt-1 text-xs text-neutral-500">
                Piles already placed elsewhere are hidden — each pile can only occupy one box.
              </p>
            </div>

            {!pileId && (
              <div className="mt-3">
                <label className={labelClass}>Label (e.g. "PILE 8")</label>
                <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                  className={inputClass} placeholder="PILE 8" />
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleConfirmAssign} className={`flex-1 ${primaryButtonClass}`}>
                {editingBoxId ? 'Update' : 'Confirm'}
              </button>
              {editingBoxId && (
                <>
                  <button type="button" onClick={handleStartMove}
                    className="flex items-center justify-center rounded-xl border border-brand-amber/40 px-4 text-brand-amber">
                    <Move size={20} />
                  </button>
                  <button type="button" onClick={() => setPendingDelete({ id: editingBoxId })}
                    className="flex items-center justify-center rounded-xl border border-brand-crimson/40 px-4 text-brand-crimson">
                    <Trash2 size={20} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        (isFullScreen && overlayNode) ? overlayNode : document.body
      )}

      <button type="button" onClick={handleExport} disabled={isExporting}
        className={`mt-2 w-full ${primaryButtonClass}`}>
        {isExporting ? 'Exporting…' : 'Export Pile Layout PDF'}
      </button>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this box?"
        description="This cannot be undone."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(null)}
        rotate={isFullScreen && isPortrait}
      />
      </div>
      )}
    </div>
  )
}

export default Piles
