// Fullscreen landscape pile layout view - the pile grid is inherently
// landscape-shaped, but a phone is normally held portrait, which
// forces the whole layout to shrink down to fit a much narrower space
// than it needs, making it hard to read. Rather than solving that by
// making everything smaller, this rotates the grid 90 degrees to fill
// the entire screen at its natural landscape proportions, the same
// way a video player goes fullscreen-landscape on a portrait phone -
// no physical device rotation required.
//
// Read-only: tap a box to see its details (same info as the normal
// view's popup), with a back button to return to the regular page.
// Editing (move/assign/delete) stays in the normal view - this mode
// is specifically for viewing the full layout clearly.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import { fmtBags, fmtWeight } from '../utils/calculations.js'

const BASE_CELL_PX = 38

function FullScreenPileLayout({ boxes, pileMap, varietyMap, gridCols, gridRows, weightUnit, onClose }) {
  const [selectedBox, setSelectedBox] = useState(null)

  const naturalWidth = gridCols * BASE_CELL_PX
  const naturalHeight = gridRows * BASE_CELL_PX

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-neutral-950">
      <div
        className="fixed left-0 top-0 origin-top-left overflow-hidden"
        style={{
          width: '100vh',
          height: '100vw',
          transform: 'rotate(90deg) translateY(-100%)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="absolute left-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/90 text-app-text active:scale-90"
        >
          <ArrowLeft size={22} />
        </button>

        <div className="flex h-full w-full items-center justify-center overflow-auto p-4 pl-16">
          <div
            className="relative shrink-0"
            style={{
              width: naturalWidth,
              height: naturalHeight,
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: `${BASE_CELL_PX}px ${BASE_CELL_PX}px`,
            }}
          >
            {boxes.map((box) => {
              const pile = box.pileId ? pileMap.get(box.pileId) : null
              const variety = pile ? varietyMap.get(pile.varietyId) : null
              const isVacant = !pile
              const fillClass = isVacant
                ? 'border-neutral-800 bg-neutral-900/40'
                : pile.cerealType === 'Palay'
                  ? 'border-brand-neon/50 bg-brand-neon/10'
                  : pile.cerealType === 'By Products'
                    ? 'border-brand-byproduct/50 bg-brand-byproduct/10'
                    : 'border-blue-400/50 bg-blue-400/10'

              return (
                <button
                  key={box.id}
                  type="button"
                  onClick={() => setSelectedBox(box)}
                  className={`absolute overflow-hidden rounded border text-left transition-all active:scale-[0.97] ${fillClass}`}
                  style={{
                    left: (box.colStart - 1) * BASE_CELL_PX + 1,
                    top: (box.rowStart - 1) * BASE_CELL_PX + 1,
                    width: box.colSpan * BASE_CELL_PX - 2,
                    height: box.rowSpan * BASE_CELL_PX - 2,
                  }}
                >
                  <p className="truncate px-1 py-0.5 text-[10px] font-bold text-app-text">
                    {pile?.pileName ?? box.label ?? 'Vacant'}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {selectedBox && (() => {
          const pile = selectedBox.pileId ? pileMap.get(selectedBox.pileId) : null
          const variety = pile ? varietyMap.get(pile.varietyId) : null
          return (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setSelectedBox(null)}
            >
              <div
                className="w-full max-w-xs rounded-xl border border-neutral-800 bg-neutral-900 p-3"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-base font-bold text-app-text">{pile?.pileName ?? selectedBox.label ?? 'Vacant'}</p>
                {pile ? (
                  <>
                    <p className="mt-1 text-sm text-neutral-400">{variety?.name} ({pile.cerealType})</p>
                    <p className="mt-1 text-sm font-semibold text-brand-neon">
                      {fmtBags(pile.currentBags)} bags · {fmtWeight(pile.currentKilos ?? 0, weightUnit, 'Net')}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-neutral-500">Vacant</p>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedBox(null)}
                  className="mt-3 w-full rounded-lg border border-neutral-700 py-2 text-sm text-neutral-300"
                >
                  Close
                </button>
              </div>
            </div>
          )
        })()}
      </div>
    </div>,
    document.body
  )
}

export default FullScreenPileLayout
