import { characterAssetIndex } from '../../core/characters/assets'
import { formatPinyin } from '../../core/pinyin'
import type { Catalog } from '../../core/study/catalog'
import type { ChoiceExercise, MatchExercise } from '../../core/study/contracts'
import { missedRefs } from '../../core/study/exercises'
import { buildChoice, buildMatch, createRng, isVocabulary, matchGroups, seedFrom, type VocabularyUnit } from '../../core/study/local-exercises'
import type { Conversation, DrillContent, DrillTypeId, Mark, Sentence } from '../../core/drills/contracts'
import { drillType } from '../../core/drills/contracts'
import type { ItemInfo } from '../../core/drills/items'

// Builds the questions of each drill type from a set's items and content, and grades answers. Pure code: the pages only show it.

export type Style = 'choice' | 'match' | 'free'
export type Direction = 'zh-to-en' | 'en-to-zh'
export type WriteMode = 'pad' | 'paper'
export interface Options { style: Style; direction: Direction; writeMode: WriteMode }
export const DEFAULT_OPTIONS: Options = { style: 'choice', direction: 'zh-to-en', writeMode: 'pad' }

export type QData =
  | { t: 'choice'; exercise: ChoiceExercise }
  | { t: 'match'; exercise: MatchExercise }
  | { t: 'free'; item: ItemInfo; direction: Direction }
  | { t: 'pinyin'; item: ItemInfo }
  | { t: 'write'; item: ItemInfo; sentence: Sentence; mode: WriteMode }
  | { t: 'translate'; item: ItemInfo; sentence: Sentence }
  | { t: 'repeat'; item: ItemInfo; sentence: Sentence }
  | { t: 'convo'; conversation: Conversation; mode: 'listen' | 'read' }

/** One question. `refs` are the items its result applies to. */
export interface Q { key: string; type: DrillTypeId; refs: string[]; data: QData }
export interface Outcome { marks: Record<string, Mark>; correct: boolean }

export interface WriteAnswer { misses: number; hinted: boolean; skipped?: boolean; paper?: boolean }
export interface ConvoAnswer { picked: number[]; hinted: boolean }
export interface TextAnswer { text: string; hinted?: boolean }

const han = /\p{Script=Han}/u
/** Pinyin as comparable letters: tone numbers become marks, spaces and punctuation go. */
export const pinyinKey = (text: string) => formatPinyin(text.trim(), 'marks').toLowerCase().replace(/[^\p{L}\p{M}]/gu, '').normalize('NFC')
export const hanKey = (text: string) => text.replace(/[^\p{Script=Han}]/gu, '')
const wordsOf = (text: string) => text.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[;,/]/).map(part => part.replace(/[^a-z' -]/g, ' ').replace(/^\s*(to|a|an|the)\s+/, '').trim()).filter(Boolean)

/** Whether a typed English answer is one of the item's glosses (or a whole word of one). */
export function meaningMatches(typed: string, gloss: string): boolean {
  const answer = typed.toLowerCase().replace(/[^a-z' -]/g, ' ').replace(/^\s*(to|a|an|the)\s+/, '').replace(/\s+/g, ' ').trim()
  if (!answer) return false
  return wordsOf(gloss).some(part => part === answer || (answer.length >= 3 && part.split(/\s+/).includes(answer)))
}
export function chineseMatches(typed: string, item: Pick<ItemInfo, 'zh' | 'py'>): boolean {
  const text = typed.trim()
  if (!text) return false
  return han.test(text) ? hanKey(text) === hanKey(item.zh) : pinyinKey(text) === pinyinKey(item.py)
}
/** An exact match of a typed sentence (characters or pinyin) against the model answer. */
export function sentenceMatches(typed: string, sentence: Pick<Sentence, 'zh' | 'py'>): boolean {
  const text = typed.trim()
  if (!text) return false
  return han.test(text) ? hanKey(text) === hanKey(sentence.zh) : pinyinKey(text) === pinyinKey(sentence.py)
}

export const appearsIn = (item: ItemInfo, text: string) => item.kind !== 'grammar' && text.includes(item.zh)

/** The items a type covers, given what the set has: vocabulary for built-in types, items with a sentence for the sentence types, items met in the conversations. */
export function applicable(type: DrillTypeId, items: readonly ItemInfo[], content: Pick<DrillContent, 'sentences' | 'conversations'>): ItemInfo[] {
  switch (type) {
    case 'meanings': return items.filter(item => item.kind === 'vocabulary')
    case 'pinyin': return items.filter(item => (item.kind === 'vocabulary' || item.kind === 'source') && item.py)
    case 'write': return items.filter(item => (item.kind === 'vocabulary' || item.kind === 'source') && content.sentences[item.ref] && han.test(item.zh))
    case 'translate': case 'repeat': return items.filter(item => content.sentences[item.ref])
    default: return items.filter(item => content.conversations.some(conversation => conversation.lines.some(line => appearsIn(item, line.zh))))
  }
}

export type Availability = { state: 'ready' | 'running' | 'failed' | 'no-ai' | 'empty'; message: string; count: number }
/** Whether a type can start, and if not, why (progress, an error, no AI connected, nothing to drill). */
export function availability(type: DrillTypeId, items: readonly ItemInfo[], content: DrillContent): Availability {
  const count = applicable(type, items, content).length
  const needs = drillType(type).needs
  if (needs === 'none') return count ? { state: 'ready', message: '', count } : { state: 'empty', message: 'This set has no words for this type.', count }
  const have = needs === 'sentences' ? count > 0 : content.conversations.length > 0 && count > 0
  const progress = content.total ? ` ${content.done ?? 0} of ${content.total} requests done.` : ''
  if (content.state === 'running' || content.state === 'pending') return { state: 'running', message: `Your AI model is still writing the ${needs === 'sentences' ? 'sentences' : 'conversations'}.${progress}`, count }
  if (have) return { state: 'ready', message: '', count }
  if (content.state === 'no-ai') return { state: 'no-ai', message: 'Needs an AI model to write its content. None is connected: see Settings.', count }
  if (content.state === 'failed') return { state: 'failed', message: content.error || 'The sentences could not be written.', count }
  return { state: 'empty', message: 'There is nothing for this type in this set.', count }
}

const ITEM_SEED = (key: string) => seedFrom(key)

/** The questions of a type for the given items. */
export function buildQuestions(type: DrillTypeId, input: { setId: string; items: readonly ItemInfo[]; catalog: Catalog; known: Set<string>; content: DrillContent; options: Options; refs?: readonly string[] }): Q[] {
  const { setId, catalog, known, content, options } = input
  const only = input.refs ? new Set(input.refs) : undefined
  const items = applicable(type, input.items, content).filter(item => !only || only.has(item.ref))
  const rng = createRng(ITEM_SEED(`${setId}:${type}`))
  const order = [...items].sort(() => rng() - 0.5)
  const q = (key: string, refs: string[], data: QData): Q => ({ key, type, refs, data })
  if (type === 'meanings') {
    const units = order.flatMap(item => { const unit = catalog.units.get(item.ref); return unit && isVocabulary(unit) ? [unit] : [] })
    const pool = [...catalog.units.values()].filter(isVocabulary)
    if (options.style === 'free') return units.map(unit => q(`free-${unit.ref}`, [unit.ref], { t: 'free', item: order.find(item => item.ref === unit.ref)!, direction: options.direction }))
    if (options.style === 'match') {
      const out: Q[] = []
      matchGroups<VocabularyUnit>(units).forEach((group, index) => {
        const match = buildMatch({ focus: group, pool, known, mode: 'zh-en', seed: ITEM_SEED(`${setId}:m${index}`), id: `${setId}-match-${index}` })
        if (match) out.push(q(`match-${index}`, group.map(unit => unit.ref), { t: 'match', exercise: match }))
        else for (const unit of group) out.push(q(`free-${unit.ref}`, [unit.ref], { t: 'free', item: order.find(item => item.ref === unit.ref)!, direction: options.direction }))
      })
      return out
    }
    return units.flatMap((unit, index) => {
      const exercise = buildChoice(unit, options.direction, { pool, known, seed: ITEM_SEED(`${setId}:c${index}:${unit.ref}`), id: `${setId}-c-${index}` })
      return [exercise ? q(`choice-${unit.ref}`, [unit.ref], { t: 'choice', exercise }) : q(`free-${unit.ref}`, [unit.ref], { t: 'free', item: order.find(item => item.ref === unit.ref)!, direction: options.direction })]
    })
  }
  if (type === 'pinyin') return order.map(item => q(`pinyin-${item.ref}`, [item.ref], { t: 'pinyin', item }))
  if (type === 'write') return order.map(item => q(`write-${item.ref}`, [item.ref], { t: 'write', item, sentence: content.sentences[item.ref], mode: options.writeMode }))
  if (type === 'translate') return order.map(item => q(`translate-${item.ref}`, [item.ref], { t: 'translate', item, sentence: content.sentences[item.ref] }))
  if (type === 'repeat') return order.map(item => q(`repeat-${item.ref}`, [item.ref], { t: 'repeat', item, sentence: content.sentences[item.ref] }))
  return content.conversations.flatMap((conversation, index) => {
    const refs = items.filter(item => conversation.lines.some(line => appearsIn(item, line.zh))).map(item => item.ref)
    return refs.length ? [q(`${type}-${index}`, refs, { t: 'convo', conversation, mode: type as 'listen' | 'read' })] : []
  })
}

/** The result of an answer, or 'self' when the learner has to mark it. */
export function grade(question: Q, answer: unknown): Outcome | 'self' {
  const all = (mark: Mark): Outcome => ({ marks: Object.fromEntries(question.refs.map(ref => [ref, mark])), correct: mark !== 'missed' })
  const data = question.data
  switch (data.t) {
    case 'choice': return all(answer === data.exercise.answer ? 'got' : 'missed')
    case 'match': {
      const missed = new Set(missedRefs(data.exercise, answer))
      return { marks: Object.fromEntries(question.refs.map(ref => [ref, missed.has(ref) ? 'missed' : 'got'])), correct: missed.size === 0 }
    }
    case 'free': {
      const { text, hinted } = answer as TextAnswer
      const right = data.direction === 'zh-to-en' ? meaningMatches(text, data.item.en) : chineseMatches(text, data.item)
      return all(right ? hinted ? 'hint' : 'got' : 'missed')
    }
    case 'pinyin': {
      const { text, hinted } = answer as TextAnswer
      return all(pinyinKey(text) === pinyinKey(data.item.py) ? hinted ? 'hint' : 'got' : 'missed')
    }
    case 'write': {
      const result = answer as WriteAnswer
      if (data.mode === 'paper' || result.paper) return 'self'
      return all(result.skipped ? 'missed' : result.hinted || result.misses > 3 ? 'hint' : 'got')
    }
    case 'translate': return sentenceMatches((answer as TextAnswer).text, data.sentence) ? all('got') : 'self'
    case 'repeat': return all('got')
    case 'convo': {
      const { picked, hinted } = answer as ConvoAnswer
      const right = data.conversation.questions.filter((item, index) => picked[index] === item.answer).length
      const share = right / data.conversation.questions.length
      return all(share === 1 ? hinted ? 'hint' : 'got' : share >= 0.5 ? 'hint' : 'missed')
    }
  }
}

/** A self-marked answer: using a hint turns Got it into Needed a hint. */
export function selfGrade(question: Q, answer: unknown, mark: Mark): Outcome {
  const hinted = Boolean((answer as { hinted?: boolean } | undefined)?.hinted)
  const final: Mark = mark === 'got' && hinted ? 'hint' : mark
  return { marks: Object.fromEntries(question.refs.map(ref => [ref, final])), correct: final !== 'missed' }
}

export const catalogCharacters = () => new Set(characterAssetIndex.map(asset => asset.character))

/** Questions whose answer is complete the moment it is given: no Check button in one-at-a-time format. */
export const isAuto = (q: Q) => q.data.t === 'match' || q.data.t === 'repeat' || q.data.t === 'write' || q.data.t === 'convo'
