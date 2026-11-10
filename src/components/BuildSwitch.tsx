import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Settings } from 'lucide-react'
import './BuildSwitch.css'

// Self-contained on purpose: this file and BuildSwitch.css are copied unchanged onto the Stable branch, an older commit.
// They depend on React, the icon library and the build constant only: import nothing else from the app.
declare const __BUILD_CHANNEL__: 'stable' | 'lab'
declare const __BUILD_LANGUAGE__: string

const channel = (): 'stable' | 'lab' => (typeof __BUILD_CHANNEL__ === 'undefined' ? 'lab' : __BUILD_CHANNEL__)

/** The two builds. The other one is a plain link to its start page (the route is not kept): ./lab/ from Stable, ../ from Lab. */
export const builds = (current: 'stable' | 'lab' = channel(), language: string = typeof __BUILD_LANGUAGE__ === 'undefined' ? 'zh' : __BUILD_LANGUAGE__) => [
  { id: 'stable' as const, label: 'Stable', href: '../', current: current === 'stable' },
  { id: 'lab' as const, label: 'Lab', href: './lab/', current: current === 'lab' },
].map(build => ({ ...build, href: build.current ? undefined : current === 'lab' ? (language === 'zh' ? '../' : '../../') : './lab/' }))

/** A language app offered in the menu (the app builds the list; this file imports none of the app's code). */
export interface BuildSwitchApp { label: string; glyph: string; lang: string; href: string; current: boolean }

export interface BuildSwitchItem { label: string; onSelect: () => void }

/** A small always-visible "Lab" mark. Renders nothing in Stable. */
export function LabMark({ className = '' }: { className?: string }) {
  if (channel() !== 'lab') return null
  return <span className={`build-mark ${className}`.trim()} role="img" aria-label="Lab build: experimental, not Stable" title="Lab build: experimental, not Stable">Lab</span>
}

/**
 * The profile item of the navigation as a menu button: it opens Stable / Lab (the current one ticked) and, in Lab, the extra items the app
 * passes in. With settingsHref it adds its own gear link to Settings beside it; leave it out where the page already shows a gear.
 */
export function BuildSwitch({ children, className = '', settingsHref, settingsLabel = 'Settings', extraItems = [], apps = [] }: {
  children: ReactNode
  className?: string
  settingsHref?: string
  settingsLabel?: string
  extraItems?: BuildSwitchItem[]
  apps?: BuildSwitchApp[]
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const current = channel()
  const items = current === 'lab' ? extraItems : []
  const languageApps = current === 'lab' ? apps : []
  const language = typeof __BUILD_LANGUAGE__ === 'undefined' ? 'zh' : __BUILD_LANGUAGE__

  useEffect(() => {
    if (!open) return undefined
    const away = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  useEffect(() => { if (open) root.current?.querySelector<HTMLElement>('[role^="menuitem"][aria-checked="true"], [role="menuitem"]')?.focus() }, [open])

  const move = (event: React.KeyboardEvent) => {
    const entries = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    const index = entries.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); entries[(index + 1) % entries.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); entries[(index - 1 + entries.length) % entries.length]?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); entries[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); entries[entries.length - 1]?.focus() }
    else if (event.key === 'Tab') setOpen(false)
  }

  return <span className={`build-switch build-switch-nav`} ref={root} onKeyDown={open ? move : undefined}>
    <button type="button" ref={button} className={`build-switch-button ${className}`.trim()} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)}>
      {children}<ChevronDown size={14} aria-hidden="true" className="build-switch-chevron" />
    </button>
    {settingsHref && <a className="build-switch-gear" href={settingsHref} aria-label={settingsLabel} title={settingsLabel}><Settings size={18} aria-hidden="true" /></a>}
    {open && <div className="build-switch-menu" id={menuId} role="menu" aria-label="Build">
      {builds(current).map(build => build.href
        ? <a key={build.id} role="menuitemradio" aria-checked={false} href={build.href} tabIndex={-1} onClick={() => setOpen(false)}><span className="build-switch-tick" />{build.label}</a>
        : build.id === 'lab' && language !== 'zh'
          ? <a key={build.id} role="menuitemradio" aria-checked href="../" tabIndex={-1} onClick={() => setOpen(false)}><span className="build-switch-tick"><Check size={14} aria-hidden="true" /></span>{build.label}<small>this build</small></a>
          : <button key={build.id} type="button" role="menuitemradio" aria-checked tabIndex={-1} onClick={() => { setOpen(false); button.current?.focus() }}>
          <span className="build-switch-tick"><Check size={14} aria-hidden="true" /></span>{build.label}<small>this build</small>
        </button>)}
      {languageApps.length > 0 && <>
        <div className="build-switch-rule" role="separator" />
        <div className="build-switch-heading" role="presentation" aria-hidden="true">Language</div>
        {languageApps.map(app => app.current
          ? <button key={app.lang} type="button" role="menuitemradio" aria-checked tabIndex={-1} onClick={() => { setOpen(false); button.current?.focus() }}>
            <span className="build-switch-tick"><Check size={14} aria-hidden="true" /></span><span className="build-switch-glyph" lang={app.lang} aria-hidden="true">{app.glyph}</span>{app.label}<small>this app</small>
          </button>
          : <a key={app.lang} role="menuitemradio" aria-checked={false} href={app.href} tabIndex={-1} onClick={() => setOpen(false)}>
            <span className="build-switch-tick" /><span className="build-switch-glyph" lang={app.lang} aria-hidden="true">{app.glyph}</span>{app.label}
          </a>)}
      </>}
      {items.length > 0 && <div className="build-switch-rule" role="separator" />}
      {items.map(item => <button key={item.label} type="button" role="menuitem" tabIndex={-1} onClick={() => { setOpen(false); item.onSelect() }}>
        <span className="build-switch-tick" />{item.label}
      </button>)}
    </div>}
  </span>
}
