import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react'
import { db } from '../core/database'
import { navigate } from '../core/routing'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { PracticeSnippet } from '../components/assistant/SnippetActions'
import { cardStatus } from '../core/study/labels'
import { cardId, isPhraseRef } from '../core/study/contracts'
import { DOMAIN } from '../core/study/knowledge'
import { useCatalog } from '../components/study/useCatalog'
import { unitMeaning, unitTitle } from '../core/study/catalog'
import { renameMediaNamedSets } from '../core/collections/naming'
import { createCollection, deleteCollection, dueItems, promoteItems, removeItems, renameCollection, startCollectionSession } from '../core/collections/store'
import type { CollectionItem } from '../core/collections/contracts'
import { TERM, itemCount } from '../core/collections/terms'
import { ResumeList } from '../components/study/ResumeList'
import { describeSession } from '../core/study/origin'
import './collections.css'

const confirmDelete = () => window.confirm(`Delete this ${TERM.singular}? Your knowledge set is not changed.`)

/** A ⋯ button with a small menu of Rename and Delete. */
function RowMenu({ name, onRename, onDelete, disabled }: { name: string; onRename: () => void; onDelete: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: Event) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return <div className="col-menu" ref={box}>
    <button type="button" className="col-more" aria-label={`More actions for ${name}` + ''} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}><MoreHorizontal size={18} /></button>
    {open && <div role="menu" className="col-popup">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename() }}>Rename</button>
      <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onDelete() }}>Delete</button>
    </div>}
  </div>
}

function RenameForm({ initial, busy, save, cancel, label }: { initial: string; busy: boolean; save: (name: string) => void; cancel: () => void; label: string }) {
  const [value, setValue] = useState(initial)
  return <form className="col-rename" onSubmit={event => { event.preventDefault(); save(value) }} onKeyDown={event => { if (event.key === 'Escape') cancel() }}>
    <input aria-label={label} autoFocus value={value} maxLength={120} onChange={event => setValue(event.target.value)} />
    <button className="button primary" type="submit" disabled={busy || !value.trim()}>Save</button>
    <button className="button secondary" type="button" onClick={cancel}>Cancel</button>
  </form>
}

function List({ busy, run, now }: Pick<PageProps, 'busy' | 'run' | 'now'>) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string>()
  useEffect(() => { void renameMediaNamedSets().catch(() => undefined) }, [])
  const rows = useLiveQuery(async () => {
    const collections = await db.collections.orderBy('updatedAt').reverse().toArray()
    return Promise.all(collections.map(async collection => ({ collection, count: await db.collectionItems.where('collectionId').equals(collection.id).count(), due: (await dueItems(collection.id, now)).length })))
  }, [now])
  return <>
    <PageHeading eyebrow={TERM.Plural.toUpperCase()} title={TERM.Plural}>Words and phrases you gather from shows and books. Practicing them does not add them to your knowledge set.</PageHeading>
    <form className="col-create" onSubmit={event => { event.preventDefault(); const value = name; void run(async () => { const made = await createCollection(value); setName(''); navigate(`collections/${made.id}`) }) }}>
      <input aria-label={`New ${TERM.singular} name`} placeholder={`New ${TERM.singular}`} value={name} maxLength={120} onChange={event => setName(event.target.value)} />
      <button className="button primary" type="submit" disabled={busy || !name.trim()}><Plus size={16} />Create</button>
    </form>
    {rows?.length === 0 && <EmptyState title={`No ${TERM.plural} yet`}><p>Save a line from a Media page, or create one above.</p></EmptyState>}
    <ul className="col-list">{rows?.map(({ collection, count, due }) => <li className="col-row" key={collection.id}>
      {editing === collection.id
        ? <RenameForm initial={collection.name} busy={busy} label={`${TERM.Singular} name`} cancel={() => setEditing(undefined)} save={value => void run(async () => { await renameCollection(collection.id, value); setEditing(undefined) })} />
        : <a className="col-link" href={`#collections/${collection.id}`}>
          <span className="col-name">{collection.name}</span>
          {collection.subtitle && <span className="small muted col-subtitle" lang="zh-Hans">{collection.subtitle}</span>}
          <span className="small muted">{collection.kind === 'show' ? 'Show' : 'Mine'} · {itemCount(count)} · {due} due</span>
        </a>}
      {editing !== collection.id && <RowMenu name={collection.name} disabled={busy} onRename={() => setEditing(collection.id)}
        onDelete={() => { if (confirmDelete()) void run(async () => { await deleteCollection(collection.id) }) }} />}
    </li>)}</ul>
  </>
}

function Item({ item, selected, toggle, now, catalog }: { item: CollectionItem; selected: boolean; toggle: () => void; now: number; catalog?: ReturnType<typeof useCatalog>['catalog'] }) {
  const card = useLiveQuery(() => db.studyCards.get(cardId(item.ref, DOMAIN)), [item.ref])
  const known = useLiveQuery(async () => Boolean(await db.knowledge.get(item.ref)), [item.ref])
  const unit = catalog?.units.get(item.ref)
  const text = isPhraseRef(item.ref) ? item.text ?? '' : unit ? unitTitle(unit) : item.ref
  const meaning = isPhraseRef(item.ref) ? item.translation : unit ? unitMeaning(unit) : undefined
  return <li className="col-item" data-selected={selected}>
    <input type="checkbox" checked={selected} onChange={toggle} aria-label={`Select ${text}`} />
    <div className="col-item-text">
      <p lang="zh-Hans" className="col-item-zh">{text}{meaning && <span className="col-item-meaning"> {meaning}</span>}</p>
      <p className="small muted col-item-meta">{isPhraseRef(item.ref) ? 'Phrase' : 'Word'} · {known ? 'In knowledge set' : cardStatus(card, now)}{item.source && <> · <a className="text-link" href={`#media/${item.source.mediaId}`}>{item.source.title} {Math.floor(item.source.start / 60)}:{String(Math.floor(item.source.start % 60)).padStart(2, '0')}</a></>}</p>
    </div>
    <div className="col-item-practice">{isPhraseRef(item.ref) && item.text && <PracticeSnippet source={{ text: item.text, locale: 'zh-Hans', title: `${TERM.Singular} phrase`, route: `collections/${item.collectionId}`}} knowledge={false} />}</div>
  </li>
}

function Detail({ id, busy, run, now }: PageProps & { id: string }) {
  const collection = useLiveQuery(async () => (await db.collections.get(id)) ?? null, [id])
  const items = useLiveQuery(() => db.collectionItems.where('collectionId').equals(id).sortBy('addedAt'), [id])
  const due = useLiveQuery(() => dueItems(id, now), [id, now, items?.length])
  const unfinished = useLiveQuery(() => db.exerciseSessions.where('status').equals('active').filter(session => session.collectionId === id).sortBy('createdAt'), [id]) ?? []
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState(false)
  const [note, setNote] = useState('')
  const { catalog } = useCatalog()
  if (collection === undefined || items === undefined) return <p role="status">Opening...</p>
  if (!collection) return <EmptyState title={`This ${TERM.singular} is gone`}><a className="button primary" href="#collections">Back to {TERM.Plural}</a></EmptyState>
  const chosen = [...selected].filter(itemId => items.some(item => item.id === itemId))
  const allChosen = items.length > 0 && chosen.length === items.length
  const practice = (options: { itemIds?: string[]; dueOnly?: boolean }) => void run(async () => { navigate(`lessons/session/${await startCollectionSession(id, { ...options, now })}`) })
  const toggle = (itemId: string) => setSelected(current => { const next = new Set(current); if (!next.delete(itemId)) next.add(itemId); return next })
  const dueCount = due?.length ?? 0
  return <>
    <a href="#collections" className="back-link"><ArrowLeft size={16} /> {TERM.Plural}</a>
    <header className="col-head">
      {renaming
        ? <RenameForm initial={collection.name} busy={busy} label={`${TERM.Singular} name`} cancel={() => setRenaming(false)} save={value => void run(async () => { await renameCollection(id, value); setRenaming(false) })} />
        : <div className="col-head-text">
          <h1>{collection.name}</h1>
        {collection.subtitle && <p className="small muted col-subtitle" lang="zh-Hans">{collection.subtitle}</p>}
          <p className="small muted">{itemCount(items.length)} · {dueCount} due{collection.mediaId && <> · <a className="text-link" href={`#media/${collection.mediaId}`}>Open the media</a></>}</p>
        </div>}
      {!renaming && <RowMenu name={collection.name} disabled={busy} onRename={() => setRenaming(true)} onDelete={() => { if (confirmDelete()) void run(async () => { await deleteCollection(id); navigate('collections') }) }} />}
    </header>
    <div className="col-primary">
      <button className="button primary" disabled={busy || !items.length} onClick={() => practice({})}>Practice</button>
      <button className="button secondary" disabled={busy || !dueCount} onClick={() => practice({ dueOnly: true })}>Review due ({dueCount})</button>
    </div>
    {unfinished.length > 0 && <div role="group" aria-label="Unfinished lesson" className="col-unfinished"><ResumeList rows={unfinished.map(session => describeSession(session, unfinished, [collection], catalog))} run={run} busy={busy} hideOrigin /></div>}
    {note && <p className="small" role="status">{note}</p>}
    {items.length > 0 && <label className="col-all"><input type="checkbox" checked={allChosen} ref={node => { if (node) node.indeterminate = chosen.length > 0 && !allChosen }} onChange={() => setSelected(allChosen ? new Set() : new Set(items.map(item => item.id)))} aria-label="Select all" /><span className="small muted">{chosen.length ? `${chosen.length} selected` : 'Select all'}</span></label>}
    <ol className="col-items">{items.map(item => <Item key={item.id} item={item} selected={selected.has(item.id)} toggle={() => toggle(item.id)} now={now} catalog={catalog} />)}</ol>
    {chosen.length > 0 && <div className="col-toolbar" role="toolbar" aria-label="Selection actions">
      <span className="col-toolbar-count">{chosen.length} selected</span>
      <button className="button secondary" disabled={busy} onClick={() => practice({ itemIds: chosen })}>Practice</button>
      <button className="button secondary" disabled={busy} onClick={() => void run(async () => { const added = await promoteItems(chosen); setNote(added ? `Added ${itemCount(added)} to your knowledge set.` : 'Those items are already in your knowledge set.') })}>Add to knowledge set</button>
      <button className="button secondary" disabled={busy} onClick={() => void run(async () => { await removeItems(chosen); setSelected(new Set()) })}>Remove</button>
      <button className="button secondary" onClick={() => setSelected(new Set())}>Clear</button>
    </div>}
  </>
}

export function Collections(props: PageProps & { route: string }) {
  const id = props.route.split('?')[0].split('/')[1]
  return id ? <Detail {...props} id={id} /> : <List busy={props.busy} run={props.run} now={props.now} />
}
