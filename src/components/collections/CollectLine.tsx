import { useState } from 'react'
import { Plus } from 'lucide-react'
import { navigate } from '../../core/routing'
import { addLines, studyLines } from '../../core/collections/store'
import { showCollection } from '../../core/collections/store'
import type { LineInput } from '../../core/collections/store'

/** Menu items for a subtitle line: save it (and its words) to the show's collection, or save and practise it now. */
export function CollectLine({ line }: { line: LineInput }) {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const source = line.source
  if (!source) return null
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setStatus('')
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The phrase could not be saved.') } finally { setBusy(false) }
  }
  return <div className="phrase-knowledge">
    <button type="button" className="button secondary snippet-button" disabled={busy} title="Save this line and its words to this show's collection"
      onClick={() => void act(async () => {
        const collection = await showCollection(source.mediaId, source.title)
        const result = await addLines(collection.id, [line])
        setStatus(result.total ? `Saved to ${collection.name}` : `Already in ${collection.name}`)
      })}><Plus size={15} />Save</button>
    <button type="button" className="button secondary snippet-button" disabled={busy} title="Save it and practise it now"
      onClick={() => void act(async () => navigate(`lessons/session/${await studyLines([line])}`))}>Study</button>
    {status && <p className="small" role="status">{status} · <a className="text-link" href="#collections">Collections</a></p>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>
}
