import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookPlus, BookX } from 'lucide-react'
import { db } from '../../core/database'
import { loadCatalog } from '../../core/study/catalog'
import { addUserPhrase, buildUserPhrase, removeUserPhrase } from '../../core/phrases/user'

/** The "Add to phrase bank" menu item of an Assistant phrase block: stores the phrase in the learner's bank (words by the Learn split, grammar by the matcher), no AI. Offers removal once it is there. */
export function AddToPhraseBank({ text, romanization, meaning }: { text: string; romanization?: string; meaning?: string }) {
  const zh = text.trim()
  const stored = useLiveQuery(async () => (await db.userPhrases.get(zh)) ?? null, [zh])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  if (!zh || zh.length > 300) return null
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setStatus('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The phrase bank could not be changed.') } finally { setBusy(false) }
  }
  return <div className="phrase-bank-action">
    {stored === undefined ? null : stored
      ? <button type="button" className="button secondary snippet-button" title="This phrase is in your phrase bank; remove it" disabled={busy} onClick={() => void run(async () => { await removeUserPhrase(zh); setStatus('Removed from your phrase bank') })}>
        <BookX size={15} />Remove from phrase bank</button>
      : <button type="button" className="button secondary snippet-button" title="Add this phrase to your phrase bank" disabled={busy} onClick={() => void run(async () => {
        const phrase = await buildUserPhrase(await loadCatalog(), { text: zh, romanization, meaning })
        await addUserPhrase(phrase)
        setStatus('Added to your phrase bank')
      })}><BookPlus size={15} />Add to phrase bank</button>}
    {status && <p className="small" role="status">{status}</p>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>
}
