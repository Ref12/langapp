import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function ActionMenu({ label, trigger, children, className = '', align = 'end' }: {
  label: string
  trigger: ReactNode
  children: (close: (restoreFocus?: boolean) => void) => ReactNode
  className?: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = (restoreFocus = true) => { setOpen(false); if (restoreFocus) button.current?.focus() }
  useLayoutEffect(() => {
    if (!open || !panel.current || !button.current) return
    const element = panel.current
    const position = () => {
      const anchor = button.current!.getBoundingClientRect()
      const width = window.visualViewport?.width ?? window.innerWidth
      const height = window.visualViewport?.height ?? window.innerHeight
      element.style.maxHeight = `${Math.max(44, height - 16)}px`
      const bounds = element.getBoundingClientRect()
      const left = align === 'start' ? anchor.left : anchor.right - bounds.width
      const top = anchor.bottom + 4 + bounds.height <= height - 8 ? anchor.bottom + 4 : anchor.top - bounds.height - 4
      element.style.left = `${Math.max(8, Math.min(left, width - bounds.width - 8))}px`
      element.style.top = `${Math.max(8, Math.min(top, height - bounds.height - 8))}px`
    }
    position()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position)
    observer?.observe(element)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
    }
  }, [open, align])
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('button:not(:disabled), input, a[href]')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div ref={root} className={`action-menu ${className}`} data-assistant-exclude
    onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}
    onKeyDown={event => {
      if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }}>
    <button ref={button} type="button" className="icon-button action-menu-trigger" aria-label={label} title={label}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={id} onClick={() => setOpen(value => !value)}>{trigger}</button>
    <div ref={panel} id={id} className="action-menu-popup" role="dialog" aria-label={label} hidden={!open}>
      {children(close)}
    </div>
  </div>
}
