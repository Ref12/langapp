import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Plus } from 'lucide-react'
import { db } from '../core/database'
import { navigate } from '../core/routing'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { PracticeSnippet } from '../components/assistant/SnippetActions'
import { cardStatus } from '../core/study/labels'
import { cardId, isPhraseRef } from '../core/study/contracts'
import { DOMAIN } from '../core/study/knowledge'
import { useCatalog } from '../components/study/useCatalog'
import { unitMeaning, unitTitle } from '../core/study/catalog'
import { createCollection, deleteCollection, dueItems, promoteItems, removeItems, renameCollection, startCollectionSession } from '../core/collections/store'
import type { CollectionItem } from '../core/collections/contracts'

function List({ busy, run }: Pick<PageProps, 'busy' | 'run'>) {
  const [name, setName] = useState('')
  const rows = useLiveQuery(async () => {
    const collections = await db.collections.orderBy('updatedAt').reverse().toArray()
    return Promise.all(collections.map(async collection => ({ collection, count: await db.collectionItems.where('collectionId').equals(collection.id).count() })))
  }, [])
  return <>
    <PageHeading eyebrow="COLLECTIONS" title="Collections">Sets of words and phrases you gather from shows and books. Practising them does not add them to your knowledge set.</PageHeading>
    <form className="media-add" onSubmit={event => { event.preventDefault(); const value = name; void run(async () => { const made = await createCollection(value); setName(''); navigate(`collections/${made.id}`) }) }}>
      <input aria-label="New collection name" placeholder="New collection" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
      <button className="button primary" type="submit" disabled={busy || !name.trim()}><Plus size={16} />Create</button>
    </form>
    {rows?.length === 0 && <EmptyState title="No collections yet"><p>Save a line from a Media page, or create one above.</p></EmptyState>}
    <ul className="media-list">{rows?.map(({ collection, count }) => <li className="media-item" key={collection.id}>
      <div><h3>{collection.name}</h3><p className="small muted">{collection.kind === 'show' ? 'Show' : 'Mine'} / {count} {count === 1 ? 'item' : 'items'}</p></div>
      <div className="media-item-actions"><a className="button primary" href={`#collections/${collection.id}`} aria-label={`Open ${collection.name}`}>Open</a></div>
    </li>)}</ul>
  </>
}

function Item({ item, selected, toggle, pinyin, now, catalog }: { item: CollectionItem; selected: boolean; toggle: () => void; pinyin: boolean; now: number; catalog?: ReturnType<typeof useCatalog>['catalog'] }) {
  void pinyin
  const card = useLiveQuery(() => db.studyCards.get(cardId(item.ref, DOMAIN)), [item.ref])
  const known = useLiveQuery(async () => Boolean(await db.knowledge.get(item.ref)), [item.ref])
  const unit = catalog?.units.get(item.ref)
  const text = isPhraseRef(item.ref) ? item.text ?? '' : unit ? unitTitle(unit) : item.ref
  const meaning = isPhraseRef(item.ref) ? item.translation : unit ? unitMeaning(unit) : undefined
  return <li className="media-line collection-item">
    <label className="collection-pick"><input type="checkbox" checked={selected} onChange={toggle} aria-label={`Select ${text}`} /></label>
    <div className="phrase-row-text"><p lang="zh-Hans" className="example">{text}</p>{meaning && <p className="small muted">{meaning}</p>}
      <p className="small muted">{isPhraseRef(item.ref) ? 'Phrase' : 'Word'} / {known ? 'In knowledge set' : cardStatus(card, now)}{item.source && <> / <a className="text-link" href={`#media/${item.source.mediaId}`}>{item.source.title} {Math.floor(item.source.start / 60)}:{String(Math.floor(item.source.start % 60)).padStart(2, '0')}</a></>}</p></div>
    {isPhraseRef(item.ref) && item.text && <PracticeSnippet source={{ text: item.text, locale: 'zh-Hans', title: 'Collection phrase', route: `collections/${item.collectionId}` }} knowledge={false} />}
  </li>
}

function Detail({ id, workspace, busy, run, now }: PageProps & { id: string }) {
  const collection = useLiveQuery(async () => (await db.collections.get(id)) ?? null, [id])
  const items = useLiveQuery(() => db.collectionItems.where('collectionId').equals(id).sortBy('addedAt'), [id])
  const due = useLiveQuery(() => dueItems(id, now), [id, now, items?.length])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rename, setRename] = useState<string>()
  const [note, setNote] = useState('')
  const { catalog } = useCatalog()
  if (collection === undefined || items === undefined) return <p role="status">Opening...</p>
  if (!collection) return <EmptyState title="This collection is gone"><a className="button primary" href="#collections">Back to Collections</a></EmptyState>
  const chosen = [...selected].filter(itemId => items.some(item => item.id === itemId))
  const practice = (options: { itemIds?: string[]; dueOnly?: boolean }) => void run(async () => { navigate(`lessons/session/${await startCollectionSession(id, { ...options, now })}`) })
  const toggle = (itemId: string) => setSelected(current => { const next = new Set(current); if (!next.delete(itemId)) next.add(itemId); return next })
  return <>
    <a href="#collections" className="back-link"><ArrowLeft size={16} /> Collections</a>
    <PageHeading eyebrow={collection.kind === 'show' ? 'SHOW COLLECTION' : 'COLLECTION'} title={collection.name}>{items.length} {items.length === 1 ? 'item' : 'items'} / {due?.length ?? 0} due{collection.mediaId && <> / <a href={`#media/${collection.mediaId}`}>Open the media</a></>}</PageHeading>
    <div className="button-row">
      <button className="button primary" disabled={busy || !items.length} onClick={() => practice({})}>Practise all</button>
      <button className="button secondary" disabled={busy || !due?.length} onClick={() => practice({ dueOnly: true })}>Review due ({due?.length ?? 0})</button>
      <button className="button secondary" disabled={busy || !chosen.length} onClick={() => practice({ itemIds: chosen })}>Practise selected</button>
      <button className="button secondary" disabled={busy || !chosen.length} onClick={() => void run(async () => { const added = await promoteItems(chosen); setNote(added ? `Added ${added} ${added === 1 ? 'item' : 'items'} to your knowledge set.` : 'Those items are already in your knowledge set.') })}>Add selected to knowledge set</button>
      <button className="button secondary" disabled={busy || !chosen.length} onClick={() => void run(async () => { await removeItems(chosen); setSelected(new Set()) })}>Remove selected</button>
    </div>
    {note && <p className="small" role="status">{note}</p>}
    <ol className="media-lines">{items.map(item => <Item key={item.id} item={item} selected={selected.has(item.id)} toggle={() => toggle(item.id)} pinyin={workspace.preferences.pinyin} now={now} catalog={catalog} />)}</ol>
    <details><summary>Rename or delete</summary>
      <form className="media-add" onSubmit={event => { event.preventDefault(); const value = rename ?? collection.name; void run(async () => { await renameCollection(id, value); setRename(undefined) }) }}>
        <input aria-label="Collection name" value={rename ?? collection.name} maxLength={120} onChange={event => setRename(event.target.value)} />
        <button className="button secondary" type="submit" disabled={busy}>Rename</button>
      </form>
      <button className="button secondary" disabled={busy} onClick={() => { if (window.confirm('Delete this collection? Your knowledge set is not changed.')) void run(async () => { await deleteCollection(id); navigate('collections') }) }}>Delete collection</button>
    </details>
  </>
}

export function Collections(props: PageProps & { route: string }) {
  const id = props.route.split('?')[0].split('/')[1]
  return id ? <Detail {...props} id={id} /> : <List busy={props.busy} run={props.run} />
}
