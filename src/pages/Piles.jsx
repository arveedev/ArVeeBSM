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

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Plus, Trash2, X, Move, Pencil, Maximize2, Minimize2, ArrowLeft } from 'lucide-react'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import { db } from '../db/dexie.js'
import { fmtBags, fmtWeight, fmtDateForFilename, sanitizeForFilename, calculateCurrentAge, fmtAge } from '../utils/calculations.js'
import { generatePileLayoutReport } from '../utils/pileLayoutPdfGenerator.js'
import { generatePileBinCard } from '../utils/pileBinCardGenerator.js'

import { computeHistoricalPileState } from '../utils/pileLedger.js'
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
function FullScreenOverlay({ isFullScreen, children }) {
  if (!isFullScreen) return children
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 p-3">{children}</div>,
    document.body
  )
}

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
  useEffect(() => {
    document.body.style.overflow = isFullScreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
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
  const containerRef = useRef(null)
  const [scale, setScale] = useState(1)

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const piles = useLiveQuery(
    () => currentWarehouseId ? db.piles.where('warehouseId').equals(currentWarehouseId).toArray() : [],
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
      // not an independent, fixed space to measure against.
      const containerTop = containerRef.current.getBoundingClientRect().top
      const availableH = window.innerHeight - containerTop - BOTTOM_NAV_HEIGHT - BOTTOM_SAFETY_MARGIN - CONTAINER_PADDING * 2

      const widthScale = availableW / naturalW
      const heightScale = availableH / naturalH
      // Whichever dimension is more restrictive wins - the grid must
      // fit within BOTH width and height at once, not just whichever
      // was checked.
      setScale(Math.min(1, widthScale, heightScale))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [visibleCols, visibleRows, isFullScreen])

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
    await db.pileLayoutBoxes.update(moving.boxId, { rowStart: row, colStart: col })
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
    longPressTimer.current = setTimeout(() => setHoveredBoxId(boxId), LONG_PRESS_MS)
  }
  const handleLongPressEnd = () => {
    clearTimeout(longPressTimer.current)
  }

  const handleExportPileBinCard = async (pile) => {
    const province = currentWarehouse?.provinceId ? await db.provinces.get(currentWarehouse.provinceId) : null
    const branch = province?.branchId ? await db.branches.get(province.branchId) : null
    const variety = varietyMap.get(pile.varietyId)

    const allPileTransactions = await db.transactions.where('pileId').equals(pile.pileId).toArray()
    const wtsTransfers = await db.transactions
      .where('type').equals('WTS')
      .and((t) => t.issuedPileId === pile.pileId || t.receivedPileId === pile.pileId)
      .toArray()

    const doc = generatePileBinCard({
      warehouse: currentWarehouse, branch, pile, variety,
      transactions: [...allPileTransactions, ...wtsTransfers],
    })
    doc.save(`${pile.pileName.replace(/[^a-z0-9]+/gi, '-')}-BIN-Card.pdf`)
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

      const enrichedBoxes = boxes.map((box) => {
        const pile = box.pileId ? pileMap.get(box.pileId) : null
        const variety = pile ? varietyMap.get(pile.varietyId) : null
        const formattedAge = pile?.initialAgeValue != null
          ? fmtAge(calculateCurrentAge(pile.initialAgeValue, pile.dateOfReceipt, autoAgeMonitoring))
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

  const previewRegion = drawing?.start && drawing?.current
    ? regionFromCorners(drawing.start, drawing.current)
    : null
  const previewValid = previewRegion ? regionValid(previewRegion, editingBoxId) : false

  const moveRegion = moving?.current
    ? { rowStart: moving.current.row, rowSpan: moving.rowSpan, colStart: moving.current.col, colSpan: moving.colSpan }
    : null
  const moveValid = moveRegion ? regionValid(moveRegion, moving.boxId) : false

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
            onChange={(iso) => {
              setPeriodFrom(iso)
              periodToPickerRef.current?.open()
            }}
          />
        </div>
        <div>
          <label className={labelClass}>Period To</label>
          <CalendarDatePicker ref={periodToPickerRef} value={periodTo} onChange={setPeriodTo} />
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
        {drawing ? (
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
        )}
      </div>

      {/* overflow-hidden so nothing ever renders outside this bordered
          display area - including the hover-detail popup below, which is
          explicitly clamped to these same bounds. */}
      <FullScreenOverlay isFullScreen={isFullScreen}>
        {isFullScreen && (
          <button
            type="button"
            onClick={() => setIsFullScreen(false)}
            className="mb-2 flex w-fit items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-app-text active:scale-95"
          >
            <ArrowLeft size={16} /> Back
          </button>
        )}
        <div ref={containerRef} className={`relative mt-2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 p-2 ${isFullScreen ? 'flex-1' : ''}`}>
        <div style={{ width: naturalWidth * scale, height: naturalHeight * scale, overflow: 'hidden' }}>
          <div
            className="relative"
            style={{
              width: naturalWidth, height: naturalHeight,
              transform: `scale(${scale})`, transformOrigin: 'top left',
            }}
          >
            {boxes.map((box) => {
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
        {hoveredBoxId && hoveredBoxId !== editingBoxId && (() => {
          const box = boxes.find((b) => b.id === hoveredBoxId)
          if (!box) return null
          const pile = box.pileId ? pileMap.get(box.pileId) : null
          const variety = pile ? varietyMap.get(pile.varietyId) : null
          const isVacant = !pile

          const fields = isVacant ? [] : [
            variety?.name && ['Variety', variety.name],
            pile.currentBags != null && ['Bags', fmtBags(pile.currentBags)],
            pile.currentKilos != null && ['Net', fmtWeight(pile.currentKilos, weightUnit)],
            pile.initialAgeValue != null && ['Age', fmtAge(calculateCurrentAge(pile.initialAgeValue, pile.dateOfReceipt, autoAgeMonitoring))],
            pile.condition && ['Condition', pile.condition],
            pile.moistureContent && ['MC', pile.moistureContent],
            pile.purity && ['Purity', pile.purity],
            pile.dateProcured && [pile.cerealType === 'Palay' ? 'Procured' : 'Received', pile.dateProcured],
          ].filter(Boolean)

          const popupWidth = 220

          const screenLeft = (box.colStart - 1) * BASE_CELL_PX * scale
          const screenTop = (box.rowStart - 1) * BASE_CELL_PX * scale
          const screenRight = screenLeft + box.colSpan * BASE_CELL_PX * scale
          const screenBottom = screenTop + box.rowSpan * BASE_CELL_PX * scale

          // True viewport coordinates - the popup renders via a portal
          // straight to document.body (below), not as a child of the
          // grid's own overflow:hidden container, so it can never be
          // clipped or need internal scrolling regardless of how short
          // that container is. containerOrigin converts the box's
          // grid-relative position into real screen coordinates.
          const containerRect = containerRef.current?.getBoundingClientRect()
          const containerOrigin = { x: containerRect?.left ?? 0, y: containerRect?.top ?? 0 }
          const viewportLeft = containerOrigin.x + screenLeft
          const viewportTop = containerOrigin.y + screenTop
          const viewportRight = containerOrigin.x + screenRight
          const viewportBottom = containerOrigin.y + screenBottom

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
          const positionStyle = {
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
              className="pointer-events-none fixed z-[60] rounded-xl border-2 border-brand-neon bg-neutral-900 p-3 shadow-2xl"
              style={{ ...positionStyle, width: popupWidth }}
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
            </div>,
            document.body
          )
        })()}

        {editingBoxId && !assignForm && !moving && (() => {
          const box = boxes.find((b) => b.id === editingBoxId)
          if (!box) return null
          const pile = box.pileId ? pileMap.get(box.pileId) : null
          const variety = pile ? varietyMap.get(pile.varietyId) : null
          const isVacant = !pile

          const fields = isVacant ? [] : [
            variety?.name && ['Variety', variety.name],
            pile.currentBags != null && ['Bags', fmtBags(pile.currentBags)],
            pile.currentKilos != null && ['Net', fmtWeight(pile.currentKilos, weightUnit)],
            pile.initialAgeValue != null && ['Age', fmtAge(calculateCurrentAge(pile.initialAgeValue, pile.dateOfReceipt, autoAgeMonitoring))],
            pile.condition && ['Condition', pile.condition],
            pile.moistureContent && ['MC', pile.moistureContent],
            pile.purity && ['Purity', pile.purity],
            pile.dateProcured && [pile.cerealType === 'Palay' ? 'Procured' : 'Received', pile.dateProcured],
          ].filter(Boolean)

          const popupWidth = 220

          const screenLeft = (box.colStart - 1) * BASE_CELL_PX * scale
          const screenTop = (box.rowStart - 1) * BASE_CELL_PX * scale
          const screenRight = screenLeft + box.colSpan * BASE_CELL_PX * scale
          const screenBottom = screenTop + box.rowSpan * BASE_CELL_PX * scale

          const containerRect = containerRef.current?.getBoundingClientRect()
          const containerOrigin = { x: containerRect?.left ?? 0, y: containerRect?.top ?? 0 }
          const viewportLeft = containerOrigin.x + screenLeft
          const viewportTop = containerOrigin.y + screenTop
          const viewportRight = containerOrigin.x + screenRight
          const viewportBottom = containerOrigin.y + screenBottom

          const HEADER_HEIGHT = isFullScreen ? 0 : 64
          const BOTTOM_NAV_HEIGHT = isFullScreen ? 0 : 64
          const usableTop = HEADER_HEIGHT
          const usableBottom = window.innerHeight - BOTTOM_NAV_HEIGHT

          const isRightHalf = viewportLeft > window.innerWidth / 2
          const isBottomHalf = viewportTop > (usableTop + usableBottom) / 2
          const positionStyle = {
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
              className="fixed z-[60] rounded-xl border-2 border-brand-neon bg-neutral-900 p-3 shadow-2xl"
              style={{ ...positionStyle, width: popupWidth }}
              onClick={(e) => e.stopPropagation()}
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
            </div>,
            document.body
          )
        })()}

      <p className="mt-1 text-xs text-neutral-500">
        {isTouchDevice ? 'Tap a pile to see its details, move, or delete it.' : 'Hover a pile to preview it, or click for details, move, delete, or edit.'}
      </p>

      {assignForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={cancelDrawing}>
          <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4" onClick={(e) => e.stopPropagation()}>
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
        </div>
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
      />
      </div>
      )}
    </div>
  )
}

export default Piles
