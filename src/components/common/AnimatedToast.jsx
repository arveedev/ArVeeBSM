// Custom renderer for every react-hot-toast notification in the app -
// replaces the default plain box with a colored/iconed card matching
// the toast's own type (success/error/loading/blank), each icon playing
// its own distinct entrance motion instead of one shared generic pop.
// No call site (toast.success(...), toast.error(...), etc.) needs to
// change - this hooks in once, globally, via <Toaster>'s children
// render-prop in App.jsx.
//
// Swipe-to-dismiss: drag the card left or right past a threshold to
// dismiss it early. Stacking multiple toasts at once is already
// react-hot-toast's own default behavior, nothing extra needed for that.

import { useRef, useState } from 'react'
import { toast as hotToast, resolveValue } from 'react-hot-toast'
import { CheckCircle2, AlertTriangle, Loader2, Info } from 'lucide-react'

const TYPE_STYLES = {
  success: { Icon: CheckCircle2, color: '#00FFA3', motion: 'animate-toast-icon-check' },
  error: { Icon: AlertTriangle, color: '#EF4444', motion: 'animate-toast-icon-shake' },
  loading: { Icon: Loader2, color: '#378ADD', motion: 'animate-toast-icon-spin' },
  blank: { Icon: Info, color: '#378ADD', motion: 'animate-toast-icon-nod' },
}

const SWIPE_DISMISS_PX = 80

function AnimatedToast({ t }) {
  const cfg = TYPE_STYLES[t.type] ?? TYPE_STYLES.blank
  const { Icon, color, motion } = cfg
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(null)

  const handlePointerDown = (e) => {
    startXRef.current = e.clientX
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e) => {
    if (startXRef.current == null) return
    setDragX(e.clientX - startXRef.current)
  }
  const handlePointerUp = () => {
    if (startXRef.current == null) return
    if (Math.abs(dragX) > SWIPE_DISMISS_PX) {
      hotToast.dismiss(t.id)
    } else {
      setDragX(0)
    }
    setDragging(false)
    startXRef.current = null
  }

  const entranceStyle = t.visible
    ? 'animate-toast-pop-in'
    : 'animate-toast-pop-out'

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`flex items-center gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-2.5 shadow-lg ${t.visible ? entranceStyle : entranceStyle}`}
      style={{
        borderLeft: `3px solid ${color}`,
        transform: `translateX(${dragX}px)`,
        opacity: dragging ? Math.max(0.2, 1 - Math.abs(dragX) / 200) : 1,
        transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
        touchAction: 'pan-y',
        cursor: 'grab',
      }}
    >
      <span className="relative flex shrink-0" style={{ color }}>
        {t.type !== 'loading' && (
          <span
            className="absolute inset-0 rounded-full animate-toast-icon-ring"
            style={{ boxShadow: `0 0 0 0 ${color}` }}
          />
        )}
        <Icon size={20} className={t.type === 'loading' ? 'animate-toast-icon-spin' : motion} />
      </span>
      <span className="text-sm font-medium text-app-text">{resolveValue(t.message, t)}</span>
    </div>
  )
}

export default AnimatedToast
