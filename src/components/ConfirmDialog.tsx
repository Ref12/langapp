import { useEffect, useRef, type ReactNode } from 'react'
import './confirm-dialog.css'

/**
 * A small modal that asks before something destructive: a title, one line of detail, the destructive button and Cancel.
 * Escape and the backdrop cancel, and focus starts on Cancel so Enter never destroys anything by accident.
 */
export function ConfirmDialog({ title, detail, confirmLabel, busy = false, onConfirm, onCancel }: { title: string; detail: ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef(onCancel)
  cancel.current = onCancel
  const cancelButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelButton.current?.focus()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); cancel.current() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return <div className="confirm-backdrop" onClick={event => { if (event.target === event.currentTarget) onCancel() }}>
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="confirm-actions">
        <button type="button" ref={cancelButton} className="button secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="button danger" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
}
