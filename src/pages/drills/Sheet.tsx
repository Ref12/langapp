import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** A dialog that is a sheet from the bottom on phones and a centred popover on desktop. Escape and the backdrop close it. */
export function Sheet({ title, label, onClose, children, footer, wide = false }: { title: string; label: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return <div className="hf-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className={'hf-sheet' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={label}>
      <div className="hf-sheet-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18} /></button></div>
      <div className="hf-sheet-body">{children}</div>
      {footer}
    </div>
  </div>
}
