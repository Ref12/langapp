import { addEvent, characterEvent, iso, practiceEvent, reviewEvent, type JournalEvent } from '../../backup/journal'
import type { CharacterState } from '../../characters/contracts'
import { phraseRef } from '../../collections/contracts'
import type { DrillSet } from '../../drills/contracts'
import type { SavedSudokuBoard } from '../../games/sudoku-contracts'
import type { LibraryBook } from '../../library/contracts'
import type { MediaItem, SourceEntry } from '../../media/contracts'
import type { PhraseHeard, UserPhrase } from '../../phrases/contracts'
import type { SkillPractice } from '../../study/skill-map'
import type { Exercise, ExerciseAttempt, ExerciseSession, KnowledgeEntry, StudyCard } from '../../study/contracts'
import { createEmptyProfile } from '../codec'
import type { ProfileSnapshot } from '../contracts'
import { populatedProfile } from '../test-fixtures'
import { LEARNER_CHARACTERS, LEARNER_GRAMMAR, LEARNER_VOCABULARY } from './learner-labels'

// The seeded Chinese learner: one deterministic profile that looks like a real learner's, used by the golden-file and
// screen-text checks. Fixed clock (T0), fixed ids, no randomness: building it twice gives the same objects.
// It extends test-fixtures.ts (the legacy words, readings and lessons come from populatedProfile) and adds the volume.
// Chinese only: no ja/ko references, no tracks. Its cards are set by hand (not scheduled by the scheduler), so a
// scheduler change shows up in the scheduler's own tests, not here.

export const T0 = 1_790_000_000_000
const DAY = 86_400_000
const round = (value: number) => Math.round(value * 10_000) / 10_000
const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')

export interface LearnerFixture {
  snapshot: ProfileSnapshot
  /** The journal rows the first backup puts in its segment. */
  journal: JournalEvent[]
  /** Tables the profile file does not carry but the JSON backup does. */
  extras: { drillSets: DrillSet[]; sudokuBoards: SavedSudokuBoard[]; skillPractice: SkillPractice[]; phraseHeard: PhraseHeard[]; userPhrases: UserPhrase[] }
}

const SENTENCES = [
  { zh: ['我', '爱', '妈妈'], en: 'I love Mom.', extra: ['爸爸'] },
  { zh: ['他', '喜欢', '喝', '茶'], en: 'He likes to drink tea.', extra: ['水'] },
  { zh: ['今天', '天气', '很', '好'], en: 'The weather is very good today.', extra: [] },
  { zh: ['我们', '明天', '去', '学校'], en: 'We are going to school tomorrow.', extra: ['昨天'] },
  { zh: ['她', '是', '我', '的', '老师'], en: 'She is my teacher.', extra: ['朋友'] },
  { zh: ['你', '想', '吃', '什么'], en: 'What do you want to eat?', extra: [] },
  { zh: ['这', '个', '多少', '钱'], en: 'How much is this?', extra: ['那'] },
  { zh: ['我', '在', '家', '看', '书'], en: 'I am reading at home.', extra: ['电影'] },
]
const GLOSS = ['love', 'half', 'not', 'car', 'big', 'brother', 'cinema', 'correct', 'February', 'minute', 'company', 'child']
const HAN = ['爱', '半', '不', '车', '大', '弟', '电影院', '对', '二月', '分', '公司', '孩子']

function knowledgeAndCards() {
  const knowledge: KnowledgeEntry[] = []
  const cards: StudyCard[] = []
  const labels: (readonly ['vocabulary' | 'grammar' | 'source', string])[] = [
    ...LEARNER_VOCABULARY.slice(0, 125).map(lb => ['vocabulary', lb] as const),
    ...LEARNER_GRAMMAR.slice(0, 22).map(lb => ['grammar', lb] as const),
  ]
  for (let sourceIndex = 0; sourceIndex < 10; sourceIndex++) labels.push(['source', 's' + (sourceIndex + 1).toString(36) + 'x' + (sourceIndex * 7 + 3).toString(36)] as const)
  labels.forEach(([kind, lb], i) => {
    const addedAt = T0 - (labels.length - i) * (DAY / 3)
    const ref = kind + ':' + lb
    const band = kind === 'source' ? '6' : String(1 + Math.floor(i / 70) + (kind === 'grammar' ? 0 : 0))
    knowledge.push({ ref, kind, lb, band: band as KnowledgeEntry['band'], addedAt, source: i % 4 === 0 ? 'dictionary' : 'new' })
    const m = i % 10
    const id = ref + ':reading'
    if (m <= 2) cards.push({ id, ref, domain: 'reading', due: addedAt, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new', updatedAt: addedAt })
    else if (m <= 4) {
      const last = addedAt + DAY
      cards.push({ id, ref, domain: 'reading', due: last + DAY / 2, stability: round(0.4 + (i % 5) * 0.31), difficulty: round(5.1 + (i % 4) * 0.7), reps: 1 + (m - 3), lapses: 0, state: 'learning', lastReview: last, updatedAt: last })
    } else if (m <= 8) {
      const last = T0 - ((i % 9) + 1) * DAY
      cards.push({ id, ref, domain: 'reading', due: T0 + ((i % 31) - 12) * DAY, stability: round(2.3 + (i % 13) * 2.7), difficulty: round(3.2 + (i % 7) * 0.62), reps: 3 + (i % 7), lapses: i % 11 === 0 ? 1 : 0, state: 'review', lastReview: last, updatedAt: last })
    } else {
      const last = T0 - ((i % 4) + 1) * DAY
      cards.push({ id, ref, domain: 'reading', due: last + DAY / 4, stability: round(0.9 + (i % 6) * 0.2), difficulty: round(6.4 + (i % 5) * 0.55), reps: 5 + (i % 4), lapses: 1 + (i % 3), state: 'relearning', lastReview: last, updatedAt: last })
    }
  })
  return { knowledge, cards }
}

function exercisesFor(index: number): Exercise[] {
  const base = index * 4
  const ref = (n: number) => 'vocabulary:' + LEARNER_VOCABULARY[(base + n) % LEARNER_VOCABULARY.length]
  const sentence = SENTENCES[index % SENTENCES.length]
  const tiles = [...sentence.zh, ...sentence.extra]
  const shuffled = tiles.map((_, n) => (n * 3 + 1) % tiles.length)
  const unique = new Set(shuffled).size === tiles.length ? shuffled : tiles.map((_, n) => (n + 1) % tiles.length)
  const pairs = [0, 1, 2, 3].map(n => ({ ref: ref(n), left: HAN[(base + n) % HAN.length], right: GLOSS[(base + n) % GLOSS.length] }))
  return [
    { id: 'e' + index + '-0', type: 'choice', targets: [ref(0)], direction: 'zh-to-en', question: HAN[base % HAN.length], options: [GLOSS[base % GLOSS.length], 'rain', 'tea'], answer: 0, explanation: 'It means ' + GLOSS[base % GLOSS.length] + '.' },
    { id: 'e' + index + '-1', type: 'choice', targets: [ref(1)], direction: 'en-to-zh', question: GLOSS[(base + 1) % GLOSS.length], options: [HAN[(base + 1) % HAN.length], '茶', '雨', '山'], answer: 0, explanation: 'The word is ' + HAN[(base + 1) % HAN.length] + '.' },
    { id: 'e' + index + '-2', type: 'tiles', targets: [ref(2)], translation: sentence.en, tiles, distractors: [], shuffled: unique, explanation: 'Word order: ' + sentence.zh.join(' ') + '.' },
    { id: 'e' + index + '-3', type: 'match', targets: pairs.map(pair => pair.ref), mode: (['zh-en', 'zh-py', 'py-en'] as const)[index % 3], pairs, order: [2, 0, 3, 1], explanation: 'Match each word with its meaning.' },
  ] as Exercise[]
}

function sessionsAndAttempts() {
  const sessions: ExerciseSession[] = []
  const attempts: ExerciseAttempt[] = []
  for (let index = 0; index < 8; index++) {
    const id = 'study-' + String(index + 1).padStart(2, '0')
    const exercises = exercisesFor(index)
    const status = index === 6 ? 'active' : index === 7 ? 'abandoned' : 'completed'
    const createdAt = T0 - (9 - index) * DAY
    const cursor = status === 'active' ? 2 : status === 'abandoned' ? 1 : exercises.length - 1
    const answered = status === 'completed' ? exercises.length : cursor
    sessions.push({
      id, mode: index % 2 ? 'review' : 'new', domain: 'reading', targetRefs: exercises[0].targets.slice(0, 1).concat(exercises[2].targets),
      reviewRefs: index % 2 ? [exercises[1].targets[0]] : [], exercises, cursor, status, model: 'synthetic-model', rejected: index === 3 ? ['Synthetic rejected draft'] : [],
      createdAt, ...(status === 'completed' ? { completedAt: createdAt + 600_000 } : {}), exerciseCount: exercises.length,
    })
    for (let n = 0; n < answered; n++) {
      attempts.push({ id: id + ':' + n, sessionId: id, index: n, refs: exercises[n].targets.slice(0, 1), response: n === 1 ? '0' : String(n), correct: (index + n) % 5 !== 0, createdAt: createdAt + (n + 1) * 60_000 })
    }
  }
  return { sessions, attempts }
}

function characterStates(): CharacterState[] {
  return Array.from(LEARNER_CHARACTERS).map((character, i) => {
    const practiced = i % 3 !== 0
    return {
      character,
      ...(i % 2 === 0 ? { manualAddedAt: T0 - (80 - i) * DAY } : {}),
      practiceCompletions: practiced ? 1 + (i % 5) : 0,
      ...(practiced ? { lastPracticedAt: T0 - (i % 20) * DAY } : {}),
      ...(i % 7 === 0 ? { writeState: 'can' as const } : i % 11 === 0 ? { writeState: 'cannot' as const } : {}),
    }
  })
}

function conversation(): ProfileSnapshot['conversations'] {
  const speech = (text: string, romanization: string, meaning: string) => ({ type: 'speech' as const, text, locale: 'zh-Hans' as const, romanization, meaning })
  const base = T0 - 3 * DAY
  return {
    threads: [{
      id: 'thread-1', title: 'Ordering tea', draft: '', mode: 'conversation', shadowIntent: 'new-phrase', romanization: true, speechRate: 0.75,
      voiceEnabled: true, voiceInputLocale: 'zh-Hans', returnRoute: 'assistant', createdAt: base, updatedAt: base + 300_000,
    }],
    messages: [
      { id: 'm-1', threadId: 'thread-1', sequence: 0, role: 'user', text: 'How do I order a cup of tea?', blocks: [], mode: 'conversation', intent: 'message', status: 'completed', runId: 'run-1', createdAt: base },
      { id: 'm-2', threadId: 'thread-1', sequence: 1, role: 'assistant', text: '', mode: 'conversation', intent: 'message', status: 'completed', runId: 'run-1', createdAt: base + 5000, blocks: [
        { type: 'text', markdown: 'You can say it like this:' },
        speech('我想要一杯茶。', 'wǒ xiǎng yào yì bēi chá', 'I would like a cup of tea.'),
        speech('请给我一杯热茶。', 'qǐng gěi wǒ yì bēi rè chá', 'Please give me a cup of hot tea.'),
      ] },
      { id: 'm-3', threadId: 'thread-1', sequence: 2, role: 'user', text: 'And how do I say thank you?', blocks: [], mode: 'conversation', intent: 'message', status: 'completed', runId: 'run-2', createdAt: base + 200_000 },
      { id: 'm-4', threadId: 'thread-1', sequence: 3, role: 'assistant', text: '', mode: 'conversation', intent: 'message', status: 'completed', runId: 'run-2', createdAt: base + 205_000, blocks: [speech('谢谢你。', 'xiè xie nǐ', 'Thank you.')] },
    ],
    runs: [
      { id: 'run-1', threadId: 'thread-1', userMessageId: 'm-1', assistantMessageId: 'm-2', connectionRevision: 'synthetic-revision', status: 'awaiting-learner', steps: [], createdAt: base, updatedAt: base + 5000, expiresAt: base + DAY },
      { id: 'run-2', threadId: 'thread-1', userMessageId: 'm-3', assistantMessageId: 'm-4', connectionRevision: 'synthetic-revision', status: 'awaiting-learner', steps: [], createdAt: base + 200_000, updatedAt: base + 205_000, expiresAt: base + DAY },
    ],
  }
}

function book(): LibraryBook {
  return {
    id: uuid(101), revision: uuid(102), title: 'A Short Tea Story', author: 'Synthetic Author', sourceType: 'paste', chapters: ['One', 'Two'],
    passages: [
      { chapter: 0, source: '我喜欢茶。', translation: { translatedAt: T0 - DAY, blocks: [[
        { text: '我', pinyin: 'wǒ', meaning: 'I', trailing: '' }, { text: '喜欢', pinyin: 'xǐ huan', meaning: 'to like', trailing: '' }, { text: '茶', pinyin: 'chá', meaning: 'tea', trailing: '。' },
      ]] } },
      { chapter: 1, source: '他喝水。\n\n她喝茶。' },
      { chapter: 1, source: '我们都喜欢喝茶。' },
    ],
    passage: 1, completed: [0], importedAt: T0 - 5 * DAY, updatedAt: T0 - DAY,
  }
}

function mediaAndEntries(): { media: MediaItem; entries: SourceEntry[] } {
  const lines = [['你好，欢迎回来。', 0], ['今天我们做茶。', 3.5], ['先烧水。', 7], ['水开了以后放茶叶。', 9.5], ['等三分钟。', 13], ['然后倒进杯子里。', 16], ['小心，很烫。', 19], ['你可以加一点蜂蜜。', 22]] as const
  const media = {
    id: uuid(201), savedAt: T0 - 2 * DAY, url: 'https://media.invalid/watch?v=tea', title: 'Making tea', durationSec: 30, extractor: 'synthetic', videoId: 'tea', source: 'captions' as const,
    language: 'zh-Hans', lines: lines.map(([text, start], n) => ({ start, end: n + 1 < lines.length ? lines[n + 1][1] - 0.5 : 28, text })), sync: [{ at: 0, offset: 0.25 }],
    aligned: {
      sentences: [
        { lines: [0, 0] as [number, number], translation: 'Hello, welcome back.', fragments: [] },
        { lines: [1, 2] as [number, number], translation: 'Today we make tea. First boil water.', fragments: [{ line: 1, text: 'Today we make tea.' }, { line: 2, text: 'First boil water.' }] },
        { lines: [3, 3] as [number, number], translation: 'Once the water boils, add the tea leaves.', fragments: [] },
      ],
      tokens: [
        { line: 0, items: [{ text: '你好', pinyin: 'nǐ hǎo', meaning: 'hello', trailing: '，' }, { text: '欢迎', pinyin: 'huān yíng', meaning: 'welcome', trailing: '' }, { text: '回来', pinyin: 'huí lái', meaning: 'come back', trailing: '。' }] },
        { line: 2, items: [{ text: '先', pinyin: 'xiān', meaning: 'first', trailing: '' }, { text: '烧水', pinyin: 'shāo shuǐ', meaning: 'boil water', trailing: '。' }] },
      ],
      upTo: 4, updatedAt: T0 - DAY,
    },
    entries: { links: { 茶叶: 'source:s1x3', 烧水: 'source:s2xa' }, skipped: ['欢迎回来'], counts: { 'source:s1x3': 1, 'source:s2xa': 1 }, total: 3, complete: false, updatedAt: T0 - DAY },
  } as MediaItem
  const word = (index: number, word: string, pinyin: string, meanings: string[], pos: string, line: number) => ({
    id: 's' + (index + 1).toString(36) + 'x' + (index * 7 + 3).toString(36), word, pinyin, meanings, pos, sources: [{ mediaId: media.id, title: 'Making tea', line, text: lines[line][0] }], createdAt: T0 - 2 * DAY + index, updatedAt: T0 - 2 * DAY + index,
  })
  const entries: SourceEntry[] = [
    word(0, '茶叶', 'chá yè', ['tea leaves'], 'noun', 3), word(1, '烧水', 'shāo shuǐ', ['to boil water'], 'verb', 2), word(2, '蜂蜜', 'fēng mì', ['honey'], 'noun', 7),
    word(3, '烫', 'tàng', ['scalding', 'to burn'], 'adjective', 6), word(4, '倒进', 'dào jìn', ['to pour into'], 'verb', 5), word(5, '欢迎', 'huān yíng', ['to welcome'], 'verb', 0),
    word(6, '回来', 'huí lái', ['to come back'], 'verb', 0), word(7, '杯子', 'bēi zi', ['cup', 'glass'], 'noun', 5), word(8, '小心', 'xiǎo xīn', ['to be careful'], 'verb', 6),
    word(9, '然后', 'rán hòu', ['then'], 'adverb', 5), word(10, '等', 'děng', ['to wait'], 'verb', 4), word(11, '加', 'jiā', ['to add'], 'verb', 7),
    { ...word(12, '饮', 'yǐn', ['to drink (literary)'], 'verb', 7), register: 'literary' as const }, word(13, '分钟', 'fēn zhōng', ['minute'], 'noun', 4),
    word(14, '以后', 'yǐ hòu', ['after'], 'noun', 3), word(15, '一点', 'yì diǎn', ['a little'], 'noun', 7),
  ]
  return { media, entries }
}

function drillAndBoard(): { drillSets: DrillSet[]; sudokuBoards: SavedSudokuBoard[] } {
  const refs = LEARNER_VOCABULARY.slice(0, 6).map(lb => 'vocabulary:' + lb)
  const results = Object.fromEntries(refs.map((ref, n) => [ref, (['got', 'hint', 'missed'] as const)[n % 3]]))
  const drill = {
    id: 'drill-1', source: 'new', title: 'New items · 8 Nov', refs, status: 'active', format: 'single',
    progress: { meanings: { results, scope: refs, done: true, redos: 1, finishedAt: T0 - DAY }, match: { results: {}, scope: refs, done: false, redos: 0 } },
    content: { state: 'ready', sentences: { [refs[0]]: { zh: '我爱妈妈。', py: 'wǒ ài mā ma.', en: 'I love Mom.', source: 'catalog' }, [refs[1]]: { zh: '给我一半。', py: 'gěi wǒ yí bàn.', en: 'Give me half.', source: 'ai', checked: true } }, conversations: [] },
    createdAt: T0 - 2 * DAY, updatedAt: T0 - DAY,
  } as DrillSet
  const solution = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1]
  const givens = solution.map((value, n) => (n % 3 === 0 ? 0 : value))
  const bit = (value: number) => (value ? 1 << (value - 1) : 0)
  const board = {
    id: 'saved-0001', kind: 'saved-board', savedAt: T0 - 3600_000, label: 'Saved 4×4', size: 4, difficulty: 'easy', filled: givens.filter(Boolean).length, checked: false, thumbnail: '',
    sourceGameId: 'game-1', sourceRevision: 3,
    game: {
      version: 2, id: 'current', gameId: 'game-1', revision: 3, size: 4, difficulty: 'easy', seed: 42, givens, solution,
      symbols: ['茶', '水', '山', '人'].map(character => ({ character, contexts: [] })), entries: givens.map(bit), checked: null, history: [],
    },
  } as SavedSudokuBoard
  return { drillSets: [drill], sudokuBoards: [board] }
}

export function learnerFixture(): LearnerFixture {
  const template = populatedProfile()
  const { knowledge, cards } = knowledgeAndCards()
  const { sessions, attempts } = sessionsAndAttempts()
  const { media, entries } = mediaAndEntries()
  const snapshot = createEmptyProfile({ id: 'default', name: 'Seeded learner' }, {
    aiConnection: { apiType: 'responses', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-ai-key', model: 'synthetic-model', nativeTools: true, structuredOutput: false, storageAcknowledged: true },
    speechConnection: { provider: 'azure', region: 'eastus', apiKey: 'synthetic-speech-key', storageAcknowledged: true },
    defaultSpeechRate: 0.75,
    speechVoices: { 'zh-Hans': { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' }, 'en-US': { voiceURI: 'synthetic-en-voice', name: 'Synthetic English', lang: 'en-US', localService: true } },
    pinyinFormat: 'marks-and-numbers',
  })
  snapshot.exportedAt = T0
  Object.assign(snapshot.settings.preferences, {
    name: 'Seeded learner', theme: 'light', pinyin: true, readingMode: 'target', sidebarCollapsed: true, speechDebugMessages: false, sudokuAutoSpeak: true, writingSpeech: 'stroke', writingSpeechResume: 'transitions',
    writingColourParts: true, haptics: false, exercisesPerLesson: 12, sudokuShowPinyin: true, tileAutoSpeak: true, promptAutoPlay: true, answerMode: 'speak', practiseWriting: true,
    practiceMode: 'write', historyFilter: 'lessons', dictionaryScope: 'knowledge', characterWriteFilter: 'can',
  })
  const phrases = ['我想要一杯茶。', '请再说一遍。', '多少钱？']
  const phraseItems = phrases.map((text, n) => ({ ref: phraseRef(text), text, translation: ['I would like a cup of tea.', 'Please say it again.', 'How much is it?'][n] }))
  const known = new Set(knowledge.map(entry => entry.ref))
  const sharedRefs = LEARNER_VOCABULARY.slice(10, 16).map(lb => 'vocabulary:' + lb)
  const show = { id: 'collection-show', name: 'Making tea', kind: 'show' as const, mediaId: media.id, subtitle: '做茶', createdAt: T0 - 2 * DAY, updatedAt: T0 - DAY }
  const user = { id: 'collection-user', name: 'Cafe phrases', kind: 'user' as const, createdAt: T0 - 6 * DAY, updatedAt: T0 - 2 * DAY }
  snapshot.knowledge = {
    ...template.knowledge,
    characterStates: characterStates(),
    study: { knowledge, cards, sessions, attempts },
  }
  snapshot.conversations = conversation()
  snapshot.library = [book()]
  snapshot.media = [media]
  snapshot.sourceEntries = entries
  snapshot.collections = {
    collections: [show, user],
    items: [
      ...phraseItems.map((item, n) => ({ id: user.id + '|' + item.ref, collectionId: user.id, ref: item.ref, text: item.text, translation: item.translation, addedAt: T0 - 6 * DAY + n })),
      ...sharedRefs.map((ref, n) => ({ id: user.id + '|' + ref, collectionId: user.id, ref, addedAt: T0 - 5 * DAY + n })),
      { id: show.id + '|' + phraseItems[1].ref, collectionId: show.id, ref: phraseItems[1].ref, text: phraseItems[1].text, translation: phraseItems[1].translation, source: { mediaId: media.id, title: 'Making tea', line: 1, start: 3.5, text: '今天我们做茶。' }, addedAt: T0 - 2 * DAY },
    ],
    cards: phraseItems.map((item, n) => ({ id: item.ref + ':reading', ref: item.ref, domain: 'reading' as const, due: T0 + (n - 1) * DAY, stability: round(1.5 + n), difficulty: round(5 + n / 2), reps: n + 1, lapses: 0, state: n === 0 ? 'learning' as const : 'review' as const, lastReview: T0 - DAY, updatedAt: T0 - DAY })),
  }
  void known

  const journal: JournalEvent[] = []
  knowledge.forEach(entry => journal.push(addEvent(entry)))
  cards.filter(card => card.state === 'review' || card.state === 'relearning').forEach((card, n) => journal.push(reviewEvent(card.ref, ([3, 2, 4, 1] as const)[n % 4], card.lastReview ?? T0)))
  Array.from(LEARNER_CHARACTERS).slice(0, 20).forEach((character, n) => journal.push(characterEvent(character, n % 3 === 0 ? 'add' : 'practice', T0 - (20 - n) * 3600_000)))
  journal.push(practiceEvent('我想要一杯茶。', T0 - 1800_000))
  journal.sort((a, b) => a.t.localeCompare(b.t))

  const { drillSets, sudokuBoards } = drillAndBoard()
  const skillPractice: SkillPractice[] = LEARNER_VOCABULARY.slice(0, 8).map((lb, n) => ({ ref: 'vocabulary:' + lb, skill: (['reading', 'listening', 'speaking', 'writing'] as const)[n % 4], count: n + 1, lastAt: T0 - n * DAY, familiar: n % 2 === 0 }))
  const phraseHeard: PhraseHeard[] = phrases.map((zh, n) => ({ zh, heard: n + 2, lastHeardAt: T0 - n * DAY }))
  const userPhrases: UserPhrase[] = [{ zh: '我想要一杯茶。', py: 'wǒ xiǎng yào yì bēi chá.', en: 'I would like a cup of tea.', words: ['vocabulary:' + LEARNER_VOCABULARY[0]], grammar: [], source: 'user', addedAt: T0 - 3 * DAY }]
  void iso
  return { snapshot, journal, extras: { drillSets, sudokuBoards, skillPractice, phraseHeard, userPhrases } }
}
