import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './pocket.css'

export const POCKET_HOLD_MS = 800
export const POCKET_SWIPE_PX = 160
export const POCKET_HINT_MS = 8000

/**
 * Full-screen black overlay that swallows every touch. Exit gesture: press and hold anywhere for
 * 0.8 s (the screen shows "Now swipe up"), then, without lifting, drag up 160 px. A pocket rarely
 * produces a steady hold followed by a long straight drag.
 */
export function PocketOverlay({ status, wakeLockHeld, onExit }: { status?: string; wakeLockHeld?: boolean; onExit: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState(false)
  const [hint, setHint] = useState(true)
  const [showStatus, setShowStatus] = useState(true)
  const gesture = useRef<{ id: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; armed: boolean }>()

  useEffect(() => {
    const timer = setTimeout(() => setHint(false), POCKET_HINT_MS)
    const element = root.current
    // Best effort: browsers need a user gesture, which opening pocket mode was.
    void element?.requestFullscreen?.().catch(() => {})
    return () => {
      clearTimeout(timer)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const clear = () => {
    if (gesture.current) clearTimeout(gesture.current.timer)
    gesture.current = undefined
    setArmed(false)
  }
  useEffect(() => clear, [])

  const swallow = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation() }

  return createPortal(
    <div ref={root} className="pocket-overlay" role="dialog" aria-modal="true" aria-label="Pocket mode" data-testid="pocket-overlay"
      onClick={swallow} onContextMenu={swallow} onTouchStart={swallow} onTouchMove={swallow} onTouchEnd={swallow} onWheel={swallow}
      onPointerDown={event => {
        swallow(event)
        if (gesture.current) return
        const current = { id: event.pointerId, x: event.clientX, y: event.clientY, armed: false,
          timer: setTimeout(() => { current.armed = true; setArmed(true) }, POCKET_HOLD_MS) }
        gesture.current = current
        try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* not capturable */ }
      }}
      onPointerMove={event => {
        swallow(event)
        const g = gesture.current
        if (!g || g.id !== event.pointerId) return
        if (g.armed && g.y - event.clientY >= POCKET_SWIPE_PX) { clear(); onExit() }
      }}
      onPointerUp={event => { swallow(event); if (gesture.current?.id === event.pointerId) clear() }}
      onPointerCancel={clear}>
      {hint && <p className="pocket-hint">Pocket mode on. To exit: press and hold, then swipe up.</p>}
      {armed && <p className="pocket-hint pocket-armed" role="status">Now swipe up</p>}
      {showStatus && status && !hint && !armed && <p className="pocket-status" role="status">{status}</p>}
      <button type="button" className="pocket-status-toggle" aria-pressed={showStatus}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); setShowStatus(value => !value) }}>
        {showStatus ? 'Hide status' : 'Show status'}
      </button>
      {!wakeLockHeld && <span className="pocket-warn" hidden>Screen may sleep</span>}
    </div>, document.body)
}
