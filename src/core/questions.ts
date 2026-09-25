import { getWord, words } from '../data/mandarin'
import type { Activity, Question } from './model'

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

export function glosses(meaning: string): string[] {
  return meaning.toLowerCase().replace(/\([^)]*\)/g, '').split(/[,;/]|\bor\b/)
    .map(part => part.trim().replace(/^(?:(?:to|a|an|the)\s+)+/, '').replace(/[.!?]/g, '').trim())
    .filter(Boolean)
}

export function makeQuestions(wordIds: string[], familiarIds: string[] = wordIds): Question[] {
  const familiar = new Set(familiarIds)
  const activities: Activity[] = ['meaning', 'form']
  return activities.flatMap(activity => wordIds.map(wordId => {
    const target = getWord(wordId)
    const options = [wordId]
    const forms = new Set([target.native])
    const meanings = new Set(glosses(target.meaning))
    // Prefer taught material. Never offer two senses of the same form or a shared gloss.
    const candidates = [...shuffled(words.filter(word => familiar.has(word.id))), ...shuffled(words.filter(word => !familiar.has(word.id)))]
    for (const candidate of candidates) {
      const candidateGlosses = glosses(candidate.meaning)
      if (forms.has(candidate.native) || candidateGlosses.some(gloss => meanings.has(gloss))) continue
      options.push(candidate.id)
      forms.add(candidate.native)
      candidateGlosses.forEach(gloss => meanings.add(gloss))
      if (options.length === 4) break
    }
    if (options.length < 2) throw new Error(`No distinct practice choices are available for ${wordId}.`)
    return { wordId, activity, revealed: false, options: shuffled(options) }
  }))
}
