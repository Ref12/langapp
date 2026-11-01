import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { countItems } from '../../core/study/daily'
import type { KnowledgeEntry } from '../../core/study/contracts'
import { useCatalog } from './useCatalog'

const HAN = /\p{Script=Han}/u

/** The knowledge set as "312 words · 48 grammar · 220 characters", with words as the headline number. */
export function KnowledgeCounts({ knowledge, className = 'dr-known', rest }: { knowledge: readonly KnowledgeEntry[]; className?: string; /** Only the grammar and character counts, under a words headline shown elsewhere. */ rest?: boolean }) {
  const { catalog } = useCatalog()
  const sourceRows = useLiveQuery(() => db.sourceEntries.toArray(), [])
  const counts = countItems(knowledge)
  const characters = useMemo(() => {
    const seen = new Set<string>()
    const byId = new Map((sourceRows ?? []).map(entry => [`source:${entry.id}`, entry.word]))
    for (const entry of knowledge) {
      if (entry.kind === 'grammar') continue
      const text = entry.kind === 'vocabulary' ? (catalog?.units.get(entry.ref) as { record: { ch?: string } } | undefined)?.record.ch : byId.get(entry.ref)
      for (const char of text ?? '') if (HAN.test(char)) seen.add(char)
    }
    return seen.size
  }, [knowledge, catalog, sourceRows])
  if (rest) return <small className={className} aria-label="Your knowledge set">{counts.grammar} grammar · {characters} {characters === 1 ? 'character' : 'characters'}</small>
  return <p className={className} aria-label="Your knowledge set"><strong className="dr-known-words">{counts.words}</strong> {counts.words === 1 ? 'word' : 'words'} · {counts.grammar} grammar · {characters} {characters === 1 ? 'character' : 'characters'}</p>
}
