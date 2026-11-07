import { phraseKey } from '../phrases/key'
import {
  PRACTICE_BANDS, practiceFileSchemas, practiceIndexSchema,
  type AcceptedItem, type Conversation, type Exchange, type GrammarPoint, type NearMiss, type PracticeFiles, type PracticeIndex, type PracticeKind,
} from './contracts'

export * from './contracts'

/** Band files load on first use, the way the phrase bank's do (a band file is only fetched when needed). */
const loaders: Record<PracticeKind, Record<string, () => Promise<{ default: unknown }>>> = {
  accepted: { '1': () => import('../../data/practice/accepted-hsk-1.json'), '2': () => import('../../data/practice/accepted-hsk-2.json'), '3': () => import('../../data/practice/accepted-hsk-3.json'), '4': () => import('../../data/practice/accepted-hsk-4.json'), '5': () => import('../../data/practice/accepted-hsk-5.json'), '6': () => import('../../data/practice/accepted-hsk-6.json') },
  exchanges: { '1': () => import('../../data/practice/exchanges-hsk-1.json'), '2': () => import('../../data/practice/exchanges-hsk-2.json'), '3': () => import('../../data/practice/exchanges-hsk-3.json'), '4': () => import('../../data/practice/exchanges-hsk-4.json'), '5': () => import('../../data/practice/exchanges-hsk-5.json'), '6': () => import('../../data/practice/exchanges-hsk-6.json') },
  grammar: { '1': () => import('../../data/practice/grammar-hsk-1.json'), '2': () => import('../../data/practice/grammar-hsk-2.json'), '3': () => import('../../data/practice/grammar-hsk-3.json'), '4': () => import('../../data/practice/grammar-hsk-4.json'), '5': () => import('../../data/practice/grammar-hsk-5.json'), '6': () => import('../../data/practice/grammar-hsk-6.json') },
  conversations: { '1': () => import('../../data/practice/conversations-hsk-1.json'), '2': () => import('../../data/practice/conversations-hsk-2.json'), '3': () => import('../../data/practice/conversations-hsk-3.json'), '4': () => import('../../data/practice/conversations-hsk-4.json'), '5': () => import('../../data/practice/conversations-hsk-5.json'), '6': () => import('../../data/practice/conversations-hsk-6.json') },
}

type ItemOf<K extends PracticeKind> = PracticeFiles[K][number]

/** The items of one band file, validated: throws (a ZodError naming the item) when the file is not valid. */
export function parsePracticeFile<K extends PracticeKind>(kind: K, json: unknown): ItemOf<K>[] {
  return practiceFileSchemas[kind].parse(json).items as ItemOf<K>[]
}

/** Loads and validates one band file. An unknown band is an empty list. */
export async function loadPracticeFile<K extends PracticeKind>(kind: K, band: string): Promise<ItemOf<K>[]> {
  const load = loaders[kind][band]
  return load ? parsePracticeFile(kind, (await load()).default) : []
}

export const loadAccepted = (band: string) => loadPracticeFile('accepted', band)
export const loadExchanges = (band: string) => loadPracticeFile('exchanges', band)
export const loadGrammar = (band: string) => loadPracticeFile('grammar', band)
export const loadConversations = (band: string) => loadPracticeFile('conversations', band)

/** The index (counts per band), validated. */
export async function loadPracticeIndex(): Promise<PracticeIndex> {
  return practiceIndexSchema.parse((await import('../../data/practice/index.json')).default)
}

const bare = (ref: string) => ref.replace(/^(vocabulary|grammar):/, '')

/** Lookups over the dataset. A word or grammar ref may carry the app's prefix (vocabulary:, grammar:) or not; readyAt, when given, keeps only items usable at that lesson index. */
export interface PracticeData {
  /** Accepted answers of a shipped phrase, by its key (or its Chinese: punctuation is ignored). */
  accepted(phrase: string): AcceptedItem | undefined
  exchangesForWord(ref: string, readyAt?: number): Exchange[]
  exchangesForGrammar(ref: string, readyAt?: number): Exchange[]
  conversationsForWord(ref: string, readyAt?: number): Conversation[]
  conversationsForGrammar(ref: string, readyAt?: number): Conversation[]
  grammarPoint(ref: string): GrammarPoint | undefined
  /** Near misses of a grammar point. */
  nearMisses(ref: string, readyAt?: number): NearMiss[]
  /** Near misses of one shipped phrase, by its key. */
  nearMissesForPhrase(phrase: string): NearMiss[]
  /** Everything usable by lesson index readyAt: what a session whose learner knows the lessons up to there may use. */
  readyBy(readyAt: number): { exchanges: Exchange[]; conversations: Conversation[]; nearMisses: NearMiss[] }
  counts: { accepted: number; exchanges: number; grammarPoints: number; nearMisses: number; conversations: number }
}

const group = <T>(items: T[], refsOf: (item: T) => string[]) => {
  const map = new Map<string, T[]>()
  for (const item of items) for (const ref of new Set(refsOf(item).map(bare))) { const found = map.get(ref); if (found) found.push(item); else map.set(ref, [item]) }
  return map
}
const ready = <T extends { readyAt: number }>(items: T[] | undefined, readyAt?: number): T[] => (items ?? []).filter(item => readyAt === undefined || item.readyAt <= readyAt)

/** Builds the lookups from band files' items (from loadPracticeFile, or any validated lists). */
export function createPracticeData(files: Partial<PracticeFiles> = {}): PracticeData {
  const accepted = new Map((files.accepted ?? []).map(item => [item.key, item]))
  const exchanges = files.exchanges ?? [], conversations = files.conversations ?? [], points = new Map((files.grammar ?? []).map(point => [bare(point.ref), point]))
  const nearMisses = [...points.values()].flatMap(point => point.items)
  const exchangesByWord = group(exchanges, item => item.words), exchangesByGrammar = group(exchanges, item => item.grammar)
  const conversationsByWord = group(conversations, item => item.words), conversationsByGrammar = group(conversations, item => item.grammar)
  const missesByPhrase = group(nearMisses, item => [item.phrase])
  return {
    accepted: phrase => accepted.get(accepted.has(phrase) ? phrase : phraseKey(phrase)),
    exchangesForWord: (ref, readyAt) => ready(exchangesByWord.get(bare(ref)), readyAt),
    exchangesForGrammar: (ref, readyAt) => ready(exchangesByGrammar.get(bare(ref)), readyAt),
    conversationsForWord: (ref, readyAt) => ready(conversationsByWord.get(bare(ref)), readyAt),
    conversationsForGrammar: (ref, readyAt) => ready(conversationsByGrammar.get(bare(ref)), readyAt),
    grammarPoint: ref => points.get(bare(ref)),
    nearMisses: (ref, readyAt) => ready(points.get(bare(ref))?.items, readyAt),
    nearMissesForPhrase: phrase => missesByPhrase.get(accepted.has(phrase) ? phrase : phraseKey(phrase)) ?? [],
    readyBy: readyAt => ({ exchanges: ready(exchanges, readyAt), conversations: ready(conversations, readyAt), nearMisses: ready(nearMisses, readyAt) }),
    counts: { accepted: accepted.size, exchanges: exchanges.length, grammarPoints: points.size, nearMisses: nearMisses.length, conversations: conversations.length },
  }
}

/** Loads the files of the given bands (default all) and builds the lookups. A band file that is not valid is skipped and named in 'problems' instead of failing the rest. */
export async function loadPracticeData(bands: readonly string[] = PRACTICE_BANDS): Promise<{ data: PracticeData; problems: string[] }> {
  const files: PracticeFiles = { accepted: [], exchanges: [], grammar: [], conversations: [] }
  const problems: string[] = []
  const kinds = ['accepted', 'exchanges', 'grammar', 'conversations'] as const
  await Promise.all(bands.flatMap(band => kinds.map(async kind => {
    try { (files[kind] as unknown[]).push(...(await loadPracticeFile(kind, band))) } catch (reason) { problems.push(kind + ' hsk-' + band + ': ' + (reason instanceof Error ? reason.message.slice(0, 300) : String(reason))) }
  })))
  return { data: createPracticeData(files), problems }
}
