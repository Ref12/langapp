import { formatPinyin } from '../../core/pinyin'
import { rotate, type ConversationLog } from '../../core/session/conversation-rotation'
import { getPack } from '../../core/language'
import type { Catalog } from '../../core/study/catalog'
import type { ChoiceExercise, MatchExercise } from '../../core/study/contracts'
import { isChoiceCorrect, missedRefs } from '../../core/study/exercises'
import { buildChoice, buildMatch, createRng, isVocabulary, matchGroups, seedFrom, type VocabularyUnit } from '../../core/study/local-exercises'
import type { Conversation, DrillContent, DrillTypeId, Mark, Sentence } from '../../core/drills/contracts'
import { drillType } from '../../core/drills/contracts'
import type { ItemInfo } from '../../core/drills/items'
import { introducedChars } from '../../core/drills/write-queue'

// Builds the questions of each drill type from a set's items and content, and grades answers. Pure code: the pages only show it.

export type Style = 'choice' | 'free'
export type Direction = 'zh-to-en' | 'en-to-zh'
/** 'paper' is shown as Write elsewhere: the learner writes anywhere, then checks and self-marks. */
export type WriteMode = 'pad' | 'paper'
export interface Options { style: Style; direction: Direction; writeMode: WriteMode }
export const DEFAULT_OPTIONS: Options = { style: 'choice', direction: 'zh-to-en', writeMode: 'pad' }

export type QData =
  | { t: 'choice'; exercise: ChoiceExercise }
  | { t: 'match'; exercise: MatchExercise }
  | { t: 'free'; item: ItemInfo; direction: Direction }
  | { t: 'pinyin'; item: ItemInfo }
  /** Learn to write: the word's intro card, then the full writing loop for each of its characters. */
  | { t: 'learn'; item: ItemInfo; /** The characters to teach, when only some are (an Unwritten characters set skips the ones already written). */ chars?: string[] }
  /** Write it: one word from memory. */
  | { t: 'write'; item: ItemInfo; sentence?: Sentence; mode: WriteMode }
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

/** A sentence the learner can be asked to produce: not a fallback (one with unknown words). Repeat after me only listens, so it keeps fallbacks. */
export const produced = (sentence: Sentence | undefined): sentence is Sentence => !!sentence && !sentence.unknown?.length

export const appearsIn = (item: ItemInfo, text: string) => item.kind !== 'grammar' && text.includes(item.zh)

/** The items a type covers, given what the set has: vocabulary for built-in types, items with a sentence for the sentence types, items met in the conversations. */
export function applicable(type: DrillTypeId, items: readonly ItemInfo[], content: Pick<DrillContent, 'sentences' | 'conversations'>): ItemInfo[] {
  switch (type) {
    case 'meanings': case 'match': return items.filter(item => item.kind === 'vocabulary')
    case 'pinyin': return items.filter(item => (item.kind === 'vocabulary' || item.kind === 'source') && item.py)
    case 'learn': return items.filter(item => (item.kind === 'vocabulary' || item.kind === 'source') && han.test(item.zh))
    case 'write': return items.filter(item => (item.kind === 'vocabulary' || item.kind === 'source') && han.test(item.zh))
    case 'translate': return items.filter(item => produced(content.sentences[item.ref]))
    case 'repeat': return items.filter(item => content.sentences[item.ref])
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

/** A drill conversation has no id of its own: its first two lines name it in the heard log. */
export const drillConversationId = (conversation: Conversation): string => 'drill:' + conversation.lines.slice(0, 2).map(line => line.zh).join('|')

const ITEM_SEED = (key: string) => seedFrom(key)

/** The questions of a type for the given items. */
export function buildQuestions(type: DrillTypeId, input: { setId: string; items: readonly ItemInfo[]; catalog: Catalog; known: Set<string>; content: DrillContent; options: Options; refs?: readonly string[]; /** The conversations heard so far (listen and read put the new ones first). */ heardLog?: ConversationLog; /** Characters already written: Learn to write leaves them out. Given only for an Unwritten characters set. */ written?: ReadonlySet<string> }): Q[] {
  const { setId, catalog, known, content, options, heardLog } = input
  const only = input.refs ? new Set(input.refs) : undefined
  const items = applicable(type, input.items, content).filter(item => !only || only.has(item.ref))
  const rng = createRng(ITEM_SEED(`${setId}:${type}`))
  const order = [...items].sort(() => rng() - 0.5)
  const q = (key: string, refs: string[], data: QData): Q => ({ key, type, refs, data })
  if (type === 'meanings' || type === 'match') {
    const units = order.flatMap(item => { const unit = catalog.units.get(item.ref); return unit && isVocabulary(unit) ? [unit] : [] })
    const pool = [...catalog.units.values()].filter(isVocabulary)
    if (type === 'meanings' && options.style === 'free') return units.map(unit => q(`free-${unit.ref}`, [unit.ref], { t: 'free', item: order.find(item => item.ref === unit.ref)!, direction: options.direction }))
    if (type === 'match') {
      const out: Q[] = []
      matchGroups<VocabularyUnit>(units).forEach((group, index) => {
        const match = buildMatch({ focus: group, pool, known, mode: 'zh-en', seed: ITEM_SEED(`${setId}:m${index}`), id: `${setId}-match-${index}` })
        if (match) out.push(q(`match-${index}`, group.map(unit => unit.ref), { t: 'match', exercise: match }))
        else for (const unit of group) out.push(q(`free-${unit.ref}`, [unit.ref], { t: 'free', item: order.find(item => item.ref === unit.ref)!, direction: 'zh-to-en' }))
      })
      return out
    }
    return units.flatMap((unit, index) => {
      const exercise = buildChoice(unit, options.direction, { pool, known, seed: ITEM_SEED(`${setId}:c${index}:${unit.ref}`), id: `${setId}-c-${index}` })
      return [exercise ? q(`choice-${unit.ref}`, [unit.ref], { t: 'choice', exercise }) : q(`free-${unit.ref}`, [unit.ref], { t: 'free', item: order.find(item => item.ref === unit.ref)!, direction: options.direction })]
    })
  }
  if (type === 'pinyin') return order.map(item => q(`pinyin-${item.ref}`, [item.ref], { t: 'pinyin', item }))
  if (type === 'learn') {
      // An Unwritten characters set teaches each character once, in the first word (in set order) that has it.
      const taught = new Set<string>()
      return items.map(item => {
        if (!input.written) return q(`learn-${item.ref}`, [item.ref], { t: 'learn', item })
        const chars = [...new Set(introducedChars(item.zh))].filter(character => !input.written!.has(character) && !taught.has(character))
        chars.forEach(character => taught.add(character))
        return q(`learn-${item.ref}`, [item.ref], { t: 'learn', item, chars })
      })
    }
  if (type === 'write') return order.map(item => q(`write-${item.ref}`, [item.ref], { t: 'write', item, sentence: produced(content.sentences[item.ref]) ? content.sentences[item.ref] : undefined, mode: options.writeMode }))
  if (type === 'translate') return order.map(item => q(`translate-${item.ref}`, [item.ref], { t: 'translate', item, sentence: content.sentences[item.ref] }))
  if (type === 'repeat') return order.map(item => q(`repeat-${item.ref}`, [item.ref], { t: 'repeat', item, sentence: content.sentences[item.ref] }))
  // Conversations the learner has not had come first, then the one heard longest ago; the one from the previous session comes last.
  const turns = heardLog ? rotate(content.conversations.map((conversation, index) => ({ conversation, index })), turn => drillConversationId(turn.conversation), heardLog, rng) : content.conversations.map((conversation, index) => ({ conversation, index }))
  return turns.flatMap(({ conversation, index }) => {
    const refs = items.filter(item => conversation.lines.some(line => appearsIn(item, line.zh))).map(item => item.ref)
    return refs.length ? [q(`${type}-${index}`, refs, { t: 'convo', conversation, mode: type as 'listen' | 'read' })] : []
  })
}

/** The result of an answer, or 'self' when the learner has to mark it. */
export function grade(question: Q, answer: unknown): Outcome | 'self' {
  const all = (mark: Mark): Outcome => ({ marks: Object.fromEntries(question.refs.map(ref => [ref, mark])), correct: mark !== 'missed' })
  const data = question.data
  switch (data.t) {
    case 'choice': return all(typeof answer === 'number' && isChoiceCorrect(data.exercise, answer) ? 'got' : 'missed')
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
      const read = getPack().readingInput.grade(text, [data.item.py], getPack().romaji)
      return all(read.verdict === 'correct' ? hinted ? 'hint' : 'got' : read.verdict === 'tones' ? 'hint' : 'missed')
    }
    case 'write': {
      const result = answer as WriteAnswer
      if (data.mode === 'paper' || result.paper) return 'self'
      return all(result.skipped ? 'missed' : result.hinted || result.misses > 3 ? 'hint' : 'got')
    }
    case 'learn': return all('got')
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

export const catalogCharacters = () => new Set(getPack().writing.guideCharacters())

/** A Write it pad result the learner may overrule: the stroke check said Needed a hint or Missed. */
export const markable = (q: Q, answer: unknown, result: Outcome | 'self' | undefined): boolean =>
  q.data.t === 'write' && q.data.mode === 'pad' && !(answer as WriteAnswer | undefined)?.paper && !!result && result !== 'self' && Object.values(result.marks).some(mark => mark !== 'got')

/** Questions whose answer is complete the moment it is given: no Check button in one-at-a-time format. */
export const isAuto = (q: Q) => q.data.t === 'match' || q.data.t === 'repeat' || q.data.t === 'write' || q.data.t === 'learn' || q.data.t === 'convo'

/** Typed answers that are checked automatically, then confirmed or overridden by the learner's own mark. */
export const needsConfirm = (q: Q) => q.data.t === 'free' || q.data.t === 'pinyin' || q.data.t === 'translate'
/** A typed pinyin answer with the right syllables and missing or wrong tones: Needed a hint at once, never left for the learner to mark. */
export const toneOnly = (q: Q, answer: unknown) => q.data.t === 'pinyin' && getPack().readingInput.grade((answer as TextAnswer).text, [q.data.item.py], getPack().romaji).verdict === 'tones'
/** The mark the automatic check suggests, or undefined when it cannot tell. */
export const suggestedMark = (result: Outcome | 'self'): Mark | undefined => {
  if (result === 'self') return undefined
  const marks = Object.values(result.marks)
  return marks.includes('missed') ? 'missed' : marks.includes('hint') ? 'hint' : 'got'
}
