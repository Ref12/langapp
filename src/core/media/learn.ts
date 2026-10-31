import { loadCatalog } from '../study/catalog'
import { addSourceEntriesToKnowledge, addToKnowledge } from '../study/knowledge'
import { isSourceRef } from '../study/contracts'
import { startLinesSession } from '../collections/store'
import { phraseRef } from '../collections/contracts'
import type { MediaItem } from './contracts'
import type { Proposal } from './span'

/**
 * Confirms a span proposal: the chosen words join the main knowledge set, and one lesson (introduction, then exercises) starts on them and their example lines.
 * No study set is created; one exercise request for the lot.
 */
export async function learnFromSpan(item: Pick<MediaItem, 'lines' | 'title'> & { id: string }, picks: readonly Proposal[], signal?: AbortSignal): Promise<string> {
  if (!picks.length) throw new Error('Choose at least one word to learn.')
  const catalog = await loadCatalog()
  const curriculum = picks.filter(pick => catalog.units.has(pick.ref)).map(pick => pick.ref)
  const sources = picks.filter(pick => isSourceRef(pick.ref)).map(pick => pick.ref)
  if (curriculum.length) await addToKnowledge(curriculum)
  if (sources.length) await addSourceEntriesToKnowledge(sources)
  const examples = [...new Set(picks.map(pick => pick.example))].flatMap(line => item.lines[line] ? [item.lines[line].text.replace(/\s+/g, ' ').trim()] : [])
  return startLinesSession([...picks.map(pick => ({ ref: pick.ref })), ...examples.map(text => ({ ref: phraseRef(text), text }))], signal)
}
