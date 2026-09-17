import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'

export function MobileNavigation({ route, children }: { route: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => { if (dialog.current?.open) dialog.current.close() }, [route])
  useEffect(() => {
    if (!open) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const desktop = window.matchMedia('(min-width: 761px)')
    const closeOnDesktop = () => { if (desktop.matches) dialog.current?.close() }
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      document.body.style.overflow = overflow
      desktop.removeEventListener('change', closeOnDesktop)
    }
  }, [open])

  return <>
    <button className="icon-button mobile-nav-trigger" aria-label="Open navigation" aria-haspopup="dialog"
      aria-controls="mobile-navigation" aria-expanded={open} onClick={() => { dialog.current?.showModal(); setOpen(true) }}>
      <Menu size={22} aria-hidden="true" />
    </button>
    <dialog ref={dialog} id="mobile-navigation" className="mobile-drawer" aria-label="Workspace navigation"
      onClose={() => { setOpen(false) }}
      onClick={event => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          event.currentTarget.close()
        }
      }}>
      <div className="mobile-drawer-header">
        <button className="icon-button mobile-drawer-close" aria-label="Close navigation" aria-controls="mobile-navigation" aria-expanded={open} autoFocus
          onClick={() => dialog.current?.close()}><Menu size={22} aria-hidden="true" /></button>
        <span className="brand">linguaweave</span>
      </div>
      <div className="mobile-drawer-content" onClick={event => {
        if (event.target instanceof Element && event.target.closest('a[href]')) dialog.current?.close()
      }}><div className="workspace-navigation">{children}</div></div>
    </dialog>
  </>
}
