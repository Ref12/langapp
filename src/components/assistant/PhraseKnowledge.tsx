import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { db } from '../../core/database'
import { addToKnowledge } from '../../core/study/knowledge'
import type { Catalog } from '../../core/study/catalog'
import { useCatalog } from '../study/useCatalog'
import { useWriteWords } from './useWriteWords'

interface Row { text: string; pinyin: string; ref?: string; meaning?: string }

function vocabularyIndex(catalog: Catalog): Map<string, { ref: string; meaning: string }> {
  const index = new Map<string, { ref: string; meaning: string }>()
  for (const unit of catalog.units.values()) if (unit.kind === 'vocabulary' && !index.has(unit.record.ch)) index.set(unit.record.ch, { ref: unit.ref, meaning: unit.record.ds })
  return index
}

/** The "Learn" menu item: adds to the knowledge set the words of a phrase, split like Write mode. Words already known are not offered. */
export function PhraseKnowledge({ text, romanization }: { text: string; romanization?: string }) {
  const usable = text.length > 0 && text.length <= 3000
  const { words } = useWriteWords(usable ? text : '', romanization)
  const { catalog } = useCatalog()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const rows = useMemo<Row[]>(() => {
    if (!words || !catalog) return []
    const index = vocabularyIndex(catalog)
    const seen = new Set<string>()
    return words.filter(word => !seen.has(word.text) && seen.add(word.text)).map(word => ({ ...word, ...index.get(word.text) }))
  }, [words, catalog])
  const refs = rows.flatMap(row => row.ref ? [row.ref] : [])
  const [knownState, setKnown] = useState<{ key: string; set: Set<string> }>()
  const [version, setVersion] = useState(0)
  const refKey = refs.join('|')
  // Only trust the set computed for the current words; a stale one would offer known words.
  const known = knownState?.key === refKey ? knownState.set : undefined
  useEffect(() => {
    let disposed = false
    if (!refKey) { setKnown({ key: refKey, set: new Set() }); return }
    void db.knowledge.bulkGet(refKey.split('|')).then(entries => { if (!disposed) setKnown({ key: refKey, set: new Set(entries.flatMap(entry => entry ? [entry.ref] : [])) }) }, () => undefined)
    return () => { disposed = true }
  }, [refKey, version])
  const remaining = known ? rows.filter(row => !row.ref || !known.has(row.ref)) : []
  const addable = remaining.filter(row => row.ref)
  const add = async (list: Row[]) => {
    setBusy(true); setError('')
    try {
      await addToKnowledge(list.map(row => row.ref!))
      setVersion(value => value + 1)
      setStatus(list.length === 1 ? `Added ${list[0].text} to your knowledge set` : `Added ${list.length} words to your knowledge set`)
      if (list.length === addable.length) setOpen(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The words could not be added.') } finally { setBusy(false) }
  }
  const direct = remaining.length === 1 && addable.length === 1
  return <div className="phrase-knowledge">
    {addable.length > 0 && <button type="button" className="button secondary snippet-button" title="Add this phrase's words to your knowledge set" disabled={busy} aria-expanded={direct ? undefined : open}
      onClick={() => direct ? void add(addable) : setOpen(value => !value)}>
      <Plus size={15} />Learn</button>}
    {open && !direct && addable.length > 0 && <ul className="phrase-knowledge-list" aria-label="Words to add">
      <li><button type="button" className="button secondary snippet-button" disabled={busy} onClick={() => void add(addable)}>Add all</button></li>
      {remaining.map(row => <li key={row.text}>
        <span lang="zh-Hans">{row.text}</span> <span className="small muted">{row.pinyin}</span>
        {row.ref ? <><span className="small"> {row.meaning}</span> <button type="button" className="button secondary snippet-button" disabled={busy} aria-label={`Add ${row.text}`} onClick={() => void add([row])}>Add</button></>
          : <span className="small muted"> not in the dictionary</span>}
      </li>)}
    </ul>}
    {status && <p className="small" role="status">{status}</p>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>
}
