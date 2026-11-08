import type { Catalog } from '../study/catalog'
import type { BankPhrase } from '../phrases/contracts'
import { usableFor } from '../phrases/bank'
import { readyLesson } from '../phrases/dictionary'
import { phraseKey } from '../phrases/key'
import { createRng } from '../study/local-exercises'
import type { PracticeData, Exchange, Conversation, NearMiss } from '../practice-data'
import type { DatasetSource } from './sources'
import type { ConversationItem, ExchangePickItem, Form, SessionExercise, TextItem, WhichCorrectItem } from './types'

// The pre-generated practice dataset as a DatasetSource (Ideas #202 sections 5a, 6, 6a). Nothing is generated at run time and nothing is forced: an exchange, near miss or conversation
// is offered only when every word and grammar pattern it uses is in the knowledge set, its readyAt has been reached, and it touches an item of the session.

const bare = (ref: string) => ref.replace(/^(vocabulary|grammar):/, '')

export interface DatasetSourceOptions {
  data: PracticeData
  catalog: Catalog
  seed: number
  /** The bank phrases the session may draw on: a near miss needs its real phrase to be usable. */
  bank: readonly BankPhrase[]
  /** The lesson index the learner has reached. Default: worked out from the knowledge set. */
  readyAt?: number
}

/** The lesson index reached by a knowledge set: the lesson by which all its words and grammar patterns are introduced. */
export const reachedLesson = (catalog: Catalog, allowed: ReadonlySet<string>): number =>
  readyLesson(catalog, { words: [...allowed].filter(ref => ref.startsWith('vocabulary:')), grammar: [...allowed].filter(ref => ref.startsWith('grammar:')) })

/** Hooks for the planner's grading context: the dataset's zhAlt, the synonym swaps (each applied to the phrase and to every alternative), enAlt and optional words. */
export function datasetAcceptance(data: PracticeData) {
  return {
    extraAccepted: (phrase: { zh: string }): string[] => {
      const found = data.accepted(phrase.zh)
      if (!found) return []
      const base = [phrase.zh, ...found.zhAlt]
      const swapped = base.flatMap(text => (found.synonyms ?? []).filter(swap => text.includes(swap.from)).map(swap => text.replace(swap.from, swap.to)))
      return [...found.zhAlt, ...swapped]
    },
    extraAcceptedEnglish: (phrase: { zh: string }): string[] => data.accepted(phrase.zh)?.enAlt ?? [],
    extraOptional: (phrase: { zh: string }): string[] => data.accepted(phrase.zh)?.optional ?? [],
  }
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index--) { const other = Math.floor(rng() * (index + 1)); [out[index], out[other]] = [out[other], out[index]] }
  return out
}

export function createDatasetSource(options: DatasetSourceOptions): DatasetSource {
  const { data, catalog, seed } = options
  return {
    exercises({ stage, items, allowed, taken, take, forms }) {
      const readyAt = options.readyAt ?? reachedLesson(catalog, allowed)
      const itemRefs = new Set(items.map(item => bare(item.ref)))
      const wordKnown = (ref: string) => allowed.has('vocabulary:' + bare(ref)) || allowed.has(ref)
      const grammarKnown = (ref: string) => allowed.has('grammar:' + bare(ref)) || allowed.has(ref)
      const fits = (entry: { words: string[]; grammar: string[]; readyAt: number }) =>
        entry.readyAt <= readyAt && entry.words.every(wordKnown) && entry.grammar.every(grammarKnown)
      const touched = (entry: { words: string[]; grammar: string[] }) => [...entry.words, ...entry.grammar].map(bare).filter(ref => itemRefs.has(ref))
      const refsOf = (entry: { words: string[]; grammar: string[] }) => items.filter(item => touched(entry).includes(bare(item.ref))).map(item => item.ref)
      const rng = createRng(seed ^ (stage.length * 2654435761))
      const out: SessionExercise[] = []
      const want = (form: Form) => forms.includes(form)
      const used = new Set<string>()
      const fresh = (exchanges: Exchange[]) => exchanges.filter(entry => fits(entry) && touched(entry).length && !taken(entry.a.zh) && !taken(entry.q.zh))
      const cap = Math.max(1, Math.ceil(items.length / 2))
      // Exchanges: one per touched item, at most half as many as items, never the same one twice.
      const exchanges = (): Exchange[] => {
        const chosen: Exchange[] = []
        for (const item of shuffle(items, rng)) {
          if (chosen.length >= cap) break
          const pool = [...data.exchangesForWord(item.ref, readyAt), ...data.exchangesForGrammar(item.ref, readyAt)]
          const entry = shuffle(fresh(pool), rng).find(candidate => !used.has(candidate.id) && !chosen.some(other => other.a.zh === candidate.a.zh))
          if (entry) { chosen.push(entry); used.add(entry.id) }
        }
        return chosen
      }
      if (stage === 'recognise' && want('exchange-pick')) {
        for (const entry of exchanges()) {
          if (!take(entry.a.zh)) continue
          const options_ = shuffle([entry.a, ...entry.wrong], rng)
          out.push({
            id: `recognise-ds-${entry.id}`, stage, form: 'exchange-pick', refs: refsOf(entry), round: 0, question: entry.q, options: options_.map(({ zh, py, en }) => ({ zh, py, en })),
            answer: options_.indexOf(entry.a), explanation: `${entry.a.zh} (${entry.a.py}): ${entry.a.en}`,
          } satisfies ExchangePickItem)
        }
      }
      if (stage === 'use' && want('exchange-reply')) {
        for (const entry of exchanges()) {
          if (!take(entry.a.zh)) continue
          const alt = data.accepted(entry.a.zh)?.zhAlt ?? []
          out.push({
            id: `use-ds-${entry.id}`, stage, form: 'exchange-reply', refs: refsOf(entry), round: 0, prompt: entry.q.zh, promptLang: 'zh', hearText: entry.q.zh, answerLang: 'zh',
            accepted: [entry.a.zh, ...alt], questionEn: entry.q.en, replyEn: entry.a.en, model: entry.a.zh, modelPinyin: entry.a.py, explanation: `${entry.q.en} \u2192 ${entry.a.en}`,
            phrase: { zh: entry.a.zh, py: entry.a.py, en: entry.a.en },
          } satisfies TextItem)
        }
      }
      if (stage === 'recognise' && want('which-correct')) {
        const usable = new Set(options.bank.filter(phrase => usableFor(phrase, allowed)).map(phrase => phraseKey(phrase.zh)))
        for (const item of items.filter(entry => entry.kind === 'grammar')) {
          const point = data.grammarPoint(item.ref)
          const byPhrase = new Map<string, NearMiss[]>()
          for (const miss of data.nearMisses(item.ref, readyAt)) if (usable.has(phraseKey(miss.zh)) || usable.has(miss.phrase)) (byPhrase.get(miss.phrase) ?? byPhrase.set(miss.phrase, []).get(miss.phrase)!).push(miss)
          const group = shuffle([...byPhrase.values()].filter(list => !taken(list[0].zh)), rng)[0]
          if (!group || !take(group[0].zh)) continue
          const wrongs = group.slice(0, 2)
          const shuffled = shuffle([{ zh: group[0].zh, why: undefined as string | undefined }, ...wrongs.map(miss => ({ zh: miss.wrong, why: miss.why }))], rng)
          out.push({
            id: `recognise-ds-${group[0].id}`, stage, form: 'which-correct', refs: [item.ref], round: 0, en: group[0].en, options: shuffled.map(entry => ({ zh: entry.zh })),
            answer: shuffled.findIndex(entry => entry.why === undefined), whys: shuffled.map(entry => entry.why), ...(point?.note ? { note: point.note } : {}), explanation: group[0].zh,
          } satisfies WhichCorrectItem)
        }
      }
      if (stage === 'use' && want('conversation')) {
        const candidates = data.readyBy(readyAt).conversations.filter((entry: Conversation) => fits(entry) && touched(entry).length)
        const entry = shuffle(candidates, rng)[0]
        if (entry) {
          // A conversation is its own context, so its lines may repeat a drill sentence; they are still reserved so later drills do not repeat them.
          for (const line of entry.lines) take(line.zh)
          out.push({
            id: `use-ds-${entry.id}`, stage, form: 'conversation', refs: refsOf(entry), round: 0, title: entry.speakers.map(speaker => speaker.name).join(' and '), speakers: entry.speakers,
            lines: entry.lines, questions: entry.questions, explanation: entry.lines.map(line => `${line.name}: ${line.zh}`).join(' '),
          } satisfies ConversationItem)
        }
      }
      return out
    },
  }
}
