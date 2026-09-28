import type { Workspace } from '../model'
import { renderExample, requireUnit, type AuthoredExample, type Catalog } from '../study/catalog'
import { unitRef } from '../study/contracts'
import { potionPhraseSchema, type PotionPhrase } from './potions'

/** Punctuation rides along with the word it follows, so every tile is a real word. */
function exampleWords(catalog: Catalog, example: Pick<AuthoredExample, 'segments'>): string[] | undefined {
  const words: string[] = []
  let leading = ''
  for (const segment of example.segments) {
    if (segment.punctuation !== undefined) {
      if (words.length) words[words.length - 1] += segment.punctuation
      else leading += segment.punctuation
      continue
    }
    if (segment.word === undefined) return undefined
    const unit = requireUnit(catalog, unitRef('vocabulary', segment.word))
    if (unit.kind !== 'vocabulary') return undefined
    words.push(leading + unit.record.ch)
    leading = ''
  }
  return leading ? undefined : words
}

/** Lesson and grammar examples whose every word is already in your learning set. */
export function knownPotionPhrases(catalog: Catalog, workspace: Workspace): PotionPhrase[] {
  const known = new Set(workspace.knowledge.filter(entry => entry.kind === 'vocabulary').map(entry => entry.ref))
  const examples = catalog.orderedGroups.flatMap(({ group }) => group.examples.map(example => ({ id: `${group.id}:${example.id}`, example })))
  for (const unit of catalog.units.values()) if (unit.kind === 'grammar') examples.push({ id: unit.ref, example: { id: unit.ref, ...unit.record.ex } })
  const phrases = new Map<string, PotionPhrase>()
  for (const { id, example } of examples) {
    if (example.segments.some(segment => segment.word && !known.has(unitRef('vocabulary', segment.word)))) continue
    const words = exampleWords(catalog, example)
    if (!words || words.length < 2 || words.length > 7 || new Set(words).size < 2) continue
    const rendered = renderExample(catalog, example)
    const phrase = potionPhraseSchema.safeParse({ id, words, pinyin: rendered.pinyin, translation: example.translation })
    if (phrase.success && !phrases.has(rendered.text)) phrases.set(rendered.text, phrase.data)
  }
  return [...phrases.values()]
}
