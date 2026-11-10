import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ListPlus, Plus } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { isPhraseRef, isSourceRef } from '../../core/study/contracts'
import { addSourceEntriesToKnowledge, addToKnowledge } from '../../core/study/knowledge'
import { addUnitsToCollection, createCollection, removeItems } from '../../core/collections/store'
import { collectionsOfCurrentLanguage, storedLanguagePreference } from '../../core/collections/language'
import { itemId } from '../../core/collections/contracts'
import { shortGist, withDate } from '../../core/collections/naming'
import { TERM, itemCount } from '../../core/collections/terms'
import './save-menu.css'

/** True on phone-width screens, where the menu is a bottom sheet and a card shows one Save button. */
// eslint-disable-next-line react-refresh/only-export-components
export function useIsPhone(): boolean {
  const query = '(max-width: 760px)'
  const [phone, setPhone] = useState(() => typeof window.matchMedia === 'function' && Boolean(window.matchMedia(query)?.matches))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    if (!list || typeof list.addEventListener !== 'function') return
    const change = () => setPhone(list.matches)
    change()
    list.addEventListener('change', change)
    return () => list.removeEventListener('change', change)
  }, [])
  return phone
}

/** Adds refs to the knowledge set by what they are: curriculum units or words saved from media. */
async function addRefsToKnowledge(refs: string[]): Promise<void> {
  const sources = refs.filter(isSourceRef)
  const units = refs.filter(ref => !isSourceRef(ref))
  if (units.length) await addToKnowledge(units)
  if (sources.length) await addSourceEntriesToKnowledge(sources)
}

export interface SaveKnowledge {
  known: boolean
  add: () => Promise<void>
}

/** The default name of a new study set: a short English gist of the item (its meaning) with the date, as naming.ts makes them. */
// eslint-disable-next-line react-refresh/only-export-components
export const defaultSetName = (title: string | undefined, now = Date.now()) => withDate(shortGist((title ?? '').split(/[;,/]/)[0]) || 'Saved words', now)

/**
 * The Save menu, like YouTube's: the knowledge set first, then every study set with a checkbox, then "+ New study set".
 * A popover on desktop and a bottom sheet on phones; it stays open for more toggles until dismissed.
 * `refs` are the words, grammar patterns or free items to save. A character has no ref of its own, so a caller may pass the refs of its words and a `knowledge` override.
 */
export function SaveToMenu({ refs, name, title, knowledge, label, className = '' }: {
  refs: string[]
  /** What is being saved, for the button's accessible name ("Save 我"). */
  name?: string
  /** English meaning used for the default name of a new set. */
  title?: string
  knowledge?: SaveKnowledge
  /** Show this text beside the icon (the collapsed Save button on a narrow card). */
  label?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const phone = useIsPhone()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [naming, setNaming] = useState<string>()
  const [position, setPosition] = useState<CSSProperties>()
  const unique = [...new Set(refs)]
  const key = unique.join('|')
  const canKnow = knowledge !== undefined || !unique.some(isPhraseRef)

  const rows = useLiveQuery(async () => {
    if (!open) return undefined
    const sets = await collectionsOfCurrentLanguage(await storedLanguagePreference())
    return Promise.all(sets.map(async set => ({
      set,
      count: await db.collectionItems.where('collectionId').equals(set.id).count(),
      has: (await db.collectionItems.bulkGet(unique.map(ref => itemId(set.id, ref)))).filter(Boolean).length,
    })))
  }, [open, key])
  const rowCount = rows?.length
  const liveKnown = useLiveQuery(async () => (await db.knowledge.bulkGet(unique)).every(Boolean), [key])
  const known = knowledge ? knowledge.known : unique.length > 0 && liveKnown === true

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer) }, [toast])

  const close = (restoreFocus = true) => { setOpen(false); setNaming(undefined); setError(''); setToast(''); if (restoreFocus) trigger.current?.focus() }

  useLayoutEffect(() => {
    if (!open || phone || !trigger.current) return
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect()
      const width = window.innerWidth, height = window.innerHeight
      const popup = panel.current?.getBoundingClientRect()
      const w = popup?.width ?? 300, h = popup?.height ?? 280
      if (!anchor.width && !anchor.height) { setPosition({ left: Math.max(8, (width - w) / 2), top: Math.max(8, (height - h) / 3) }); return }
      const left = Math.max(8, Math.min(anchor.right - w, width - w - 8))
      const top = anchor.bottom + 6 + h <= height - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - h - 6)
      setPosition({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, phone, rowCount, naming])

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus()
    if (phone) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, phone])

  const act = async (work: () => Promise<string>) => {
    setBusy(true); setError('')
    try { setToast(await work()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'That could not be saved.') } finally { setBusy(false) }
  }
  const toggle = (set: { id: string; name: string }, checked: boolean) => void act(async () => {
    if (checked) { await removeItems(unique.map(ref => itemId(set.id, ref))); return `Removed from ${set.name}` }
    await addUnitsToCollection(set.id, unique)
    return `Saved to ${set.name}`
  })
  const addKnowledge = () => void act(async () => { await (knowledge ? knowledge.add() : addRefsToKnowledge(unique)); return 'Added to your knowledge set' })
  const create = () => {
    const value = naming ?? ''
    void act(async () => {
      const made = await createCollection(value)
      await addUnitsToCollection(made.id, unique)
      setNaming(undefined)
      return `Saved to ${made.name}`
    })
  }

  const body = <>
    <div className="save-head"><strong id={`${id}-title`}>Save to…</strong><button type="button" className="button secondary save-done" onClick={() => close()}>Done</button></div>
    <ul className="save-list">
      {canKnow && <li><label className="save-row">
        <input type="checkbox" checked={known} disabled={busy || known} onChange={addKnowledge} />
        <span className="save-row-name">{known ? 'In your knowledge set' : 'Knowledge set'}</span>
      </label></li>}
      {rows?.map(({ set, count, has }) => {
        const checked = unique.length > 0 && has === unique.length
        return <li key={set.id}><label className="save-row">
          <input type="checkbox" checked={checked} disabled={busy} onChange={() => toggle(set, checked)} />
          <span className="save-row-name">{set.name}</span><span className="small muted">{itemCount(count)}</span>
        </label></li>
      })}
    </ul>
    {naming === undefined
      ? <button type="button" className="button secondary save-new" disabled={busy} onClick={() => setNaming(defaultSetName(title))}><Plus size={15} />New {TERM.singular}</button>
      : <form className="save-create" onSubmit={event => { event.preventDefault(); create() }}>
        <input aria-label={`New ${TERM.singular} name`} value={naming} maxLength={120} autoFocus onChange={event => setNaming(event.target.value)} onFocus={event => event.currentTarget.select()} />
        <button className="button primary" type="submit" disabled={busy || !naming.trim()}>Create</button>
      </form>}
    {error && <p className="small save-error" role="alert">{error}</p>}
    <p className="save-toast" role="status">{toast}</p>
  </>
  const accessible = name ? `Save ${name}` : 'Save'
  return <>
    <button ref={trigger} type="button" className={`button secondary save-trigger${label ? '' : ' icon-only'} ${className}`} aria-label={accessible} title="Save to a study set"
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined} disabled={unique.length === 0}
      onClick={() => open ? close(false) : setOpen(true)}><ListPlus size={16} />{label}</button>
    {open && createPortal(phone
      ? <div className="save-backdrop" data-assistant-exclude onPointerDown={event => { if (event.target === event.currentTarget) close() }}>
        <div ref={panel} id={id} className="save-panel save-sheet" role="dialog" aria-modal="true" aria-label="Save to" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>{body}</div>
      </div>
      : <div ref={panel} id={id} className="save-panel save-popover" role="dialog" aria-label="Save to" data-assistant-exclude style={position} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>{body}</div>, document.body)}
  </>
}

/**
 * The pattern for a card: the one-tap primary action plus a Save icon button beside it; on a phone they collapse into one Save button whose menu has the knowledge set.
 */
export function SaveActions({ refs, name, title, knowledge, primary }: {
  refs: string[]; name?: string; title?: string; knowledge?: SaveKnowledge
  /** The primary one-tap button (usually "Add to knowledge set"). */
  primary: ReactNode
}) {
  const phone = useIsPhone()
  if (phone) return <SaveToMenu refs={refs} name={name} title={title} knowledge={knowledge} label="Save" className="full-width save-collapsed" />
  return <div className="save-actions">{primary}<SaveToMenu refs={refs} name={name} title={title} knowledge={knowledge} /></div>
}
