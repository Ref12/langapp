import { useEffect, useRef, useState, type ReactNode } from 'react'
import './row-menu.css'

/** The ⋯ overflow of a row: a small menu of the actions that need a decision, closed with Escape or a click elsewhere. */
export function RowMenu({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => { if (event.type === 'keydown' ? (event as KeyboardEvent).key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', close); document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close) }
  }, [open])
  return <div className="row-menu" ref={box}>
    <button type="button" className="icon-button" aria-label={`More for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
    {open && <div className="row-menu-list" role="menu" aria-label={`Actions for ${name}`}>{children}</div>}
  </div>
}
