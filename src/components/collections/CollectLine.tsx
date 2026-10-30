import { useState } from 'react'
import { BookmarkPlus, GraduationCap } from 'lucide-react'
import { navigate } from '../../core/routing'
import { addLines, studyLines } from '../../core/collections/store'
import { showCollection } from '../../core/collections/store'
import type { LineInput } from '../../core/collections/store'
import { TERM } from '../../core/collections/terms'

/** Menu items for a subtitle line: save it (and its words) to the show's collection, or save and practise it now. */
export function CollectLine({ line }: { line: LineInput }) {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [link, setLink] = useState<{ id: string; name: string }>()
  const [busy, setBusy] = useState(false)
  const source = line.source
  if (!source) return null
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setStatus(''); setLink(undefined)
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The phrase could not be saved.') } finally { setBusy(false) }
  }
  return <div className="phrase-knowledge">
    <button type="button" className="button secondary snippet-button" disabled={busy} title={`Save this line and its words to this show's ${TERM.singular}`}
      onClick={() => void act(async () => {
        const collection = await showCollection(source.mediaId, source.title)
        const result = await addLines(collection.id, [line])
        setStatus(result.total ? 'Saved to' : 'Already in'); setLink({ id: collection.id, name: collection.name })
      })}><BookmarkPlus size={15} />Save to {TERM.singular}</button>
    <button type="button" className="button secondary snippet-button" disabled={busy} title="Learn this line now: its words, grammar, then the line"
      onClick={() => void act(async () => navigate(`lessons/session/${await studyLines([line])}`))}>{' '}<GraduationCap size={15} />Study now</button>
    <p className="small muted">{TERM.Plural} keep a show's words apart from your knowledge set.</p>
    {status && link && <p className="small" role="status">{status} <a className="text-link" href={`#collections/${link.id}`}>{link.name}</a></p>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>
}
