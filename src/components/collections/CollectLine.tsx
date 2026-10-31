import { useState } from 'react'
import { BookmarkPlus, GraduationCap } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { navigate } from '../../core/routing'
import { addLines, createCollection, studyLines } from '../../core/collections/store'
import type { LineInput } from '../../core/collections/store'
import { suggestName } from '../../core/collections/naming'
import { TERM } from '../../core/collections/terms'

/** Menu items for a subtitle line: add it (and its words) to a study set you pick or make, or practise it now. Nothing is saved unless you choose. */
export function CollectLine({ line }: { line: LineInput }) {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [link, setLink] = useState<{ id: string; name: string }>()
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState<string>()
  const sets = useLiveQuery(() => picking ? db.collections.orderBy('updatedAt').reverse().toArray() : [], [picking]) ?? []
  const source = line.source
  if (!source) return null
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setStatus(''); setLink(undefined)
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The phrase could not be saved.') } finally { setBusy(false) }
  }
  const addTo = (id: string, name: string) => act(async () => {
    const result = await addLines(id, [line])
    setStatus(result.total ? 'Added to' : 'Already in'); setLink({ id, name }); setPicking(false); setNaming(undefined)
  })
  const startNew = () => void act(async () => { setNaming(''); setNaming(await suggestName(source.title)) })
  return <div className="phrase-knowledge">
    <button type="button" className="button secondary snippet-button" disabled={busy} aria-expanded={picking} title={`Add this line and its words to a ${TERM.singular}`}
      onClick={() => { setPicking(value => !value); setNaming(undefined) }}><BookmarkPlus size={15} />Add to {TERM.singular}…</button>
    <button type="button" className="button secondary snippet-button" disabled={busy} title="Learn this line now: its words, grammar, then the line. Saves no study set."
      onClick={() => void act(async () => navigate(`lessons/session/${await studyLines([line])}`))}>{' '}<GraduationCap size={15} />Study now</button>
    {picking && naming === undefined && <div role="group" aria-label={`Choose a ${TERM.singular}`} className="col-picker">
      <ul>{sets.map(set => <li key={set.id}><button type="button" className="button secondary" disabled={busy} onClick={() => void addTo(set.id, set.name)}>{set.name}</button></li>)}</ul>
      <button type="button" className="button secondary" disabled={busy} onClick={startNew}>New {TERM.singular}…</button>
    </div>}
    {naming !== undefined && <form className="col-rename" onSubmit={event => { event.preventDefault(); const value = naming; void act(async () => { const made = await createCollection(value, { subtitle: source.title, mediaId: source.mediaId }); await addTo(made.id, made.name) }) }}>
      <input aria-label={`New ${TERM.singular} name`} value={naming} maxLength={120} autoFocus onChange={event => setNaming(event.target.value)} />
      <button className="button primary" type="submit" disabled={busy || !naming.trim()}>Save</button>
      <button className="button secondary" type="button" onClick={() => setNaming(undefined)}>Cancel</button>
    </form>}
    <p className="small muted">{TERM.Plural} keep a show's words apart from your knowledge set.</p>
    {status && link && <p className="small" role="status">{status} <a className="text-link" href={`#collections/${link.id}`}>{link.name}</a></p>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>
}
