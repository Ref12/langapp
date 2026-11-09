import type { BankPhrase } from '../phrases/contracts'
import type { Skill } from '../study/skill-map'

// The session engine (Ideas #202, "One practice engine"). Step 1 drives practice sets; reviews, lessons and the Hands-free activity follow later, so
// nothing in here knows about drill sets: an intent, the items and a length go in, a staged plan comes out.

export const STAGES = ['introduce', 'recognise', 'recall', 'produce', 'use'] as const
export type Stage = typeof STAGES[number]
export const STAGE_LABEL: Record<Stage, string> = { introduce: 'Introduce', recognise: 'Recognise', recall: 'Recall', produce: 'Produce', use: 'Use' }

/** What started the session. Only practice sets are wired up yet; the others plan the same way (lesson: with Introduce; review: due items, no Introduce). */
export type Intent = 'practice-set' | 'lesson' | 'review' | 'skill'

export const LENGTHS = ['short', 'standard', 'long'] as const
export type Length = typeof LENGTHS[number]
export const LENGTH_LABEL: Record<Length, string> = { short: 'Short', standard: 'Standard', long: 'Long' }

/**
 * The exercise forms. The first three are built from vocabulary records (src/core/study/local-exercises.ts); the next five from bank phrases;
 * 'intro' and 'repeat' do not grade. Pre-generated dataset exercises plug in through DatasetSource (sources.ts) and use these same forms.
 */
export const FORMS = ['intro', 'choice', 'match', 'pinyin', 'recall', 'translate-zh-en', 'translate-en-zh', 'tiles', 'gap', 'listen-pick', 'dictation', 'repeat', 'exchange-pick', 'exchange-reply', 'which-correct', 'conversation'] as const
export type Form = typeof FORMS[number]
export const FORM_LABEL: Record<Form, string> = {
  intro: 'Intro cards', choice: 'Choose the meaning', match: 'Match pairs', pinyin: 'Type the pinyin', recall: 'Type the meaning', 'translate-zh-en': 'Translate to English',
  'translate-en-zh': 'Translate to Chinese', tiles: 'Word order', gap: 'Fill the gap', 'listen-pick': 'Listen and pick', dictation: 'Dictation', repeat: 'Repeat after me',
  'exchange-pick': 'Pick the reply', 'exchange-reply': 'Reply to the question', 'which-correct': 'Which is correct?', conversation: 'Listen and answer',
}
/** The skills an exercise form practises, for the skill counts. */
export const FORM_SKILLS: Record<Form, readonly Skill[]> = {
  intro: [], choice: ['reading'], match: ['reading'], pinyin: ['reading'], recall: ['reading'], 'translate-zh-en': ['reading'], 'translate-en-zh': ['writing'], tiles: ['writing'],
  gap: ['reading'], 'listen-pick': ['listening'], dictation: ['listening', 'writing'], repeat: ['speaking'],
  'exchange-pick': ['reading'], 'exchange-reply': ['writing'], 'which-correct': ['reading'], conversation: ['listening'],
}
/** Forms that need a phrase from the bank. */
export const PHRASE_FORMS: readonly Form[] = ['translate-zh-en', 'translate-en-zh', 'tiles', 'gap', 'listen-pick', 'dictation', 'repeat']
/** Forms that the learner answers by typing, speaking or handwriting. */
export const TYPED_FORMS: readonly Form[] = ['pinyin', 'recall', 'translate-zh-en', 'translate-en-zh', 'dictation', 'exchange-reply']
/** Forms that only the pre-generated dataset supplies (DatasetSource); the planner never builds them from phrases. */
export const DATASET_FORMS: readonly Form[] = ['exchange-pick', 'exchange-reply', 'which-correct', 'conversation']

export type AnswerMode = 'type' | 'speak' | 'write'

/** A preset: which forms each stage may use (in rotation) and how many rounds of every item each stage gets at Standard length. */
export interface Preset {
  id: string
  name: string
  blurb: string
  forms: Partial<Record<Stage, readonly Form[]>>
  /** Rounds of the whole item list per stage at Standard length. A stage with 0 rounds is left out. */
  rounds: Partial<Record<Stage, number>>
}

/** A word of a phrase the learner does not know yet (allowed in recognise, reading and listening only), shown flagged. */
export interface Flagged { form: string; ref: string }

/** A phrase picked for an exercise, with the unknown word it carries (at most one, never in a produce stage). */
export interface PickedPhrase { phrase: BankPhrase; unknown?: Flagged }

/** The language of a session or exercise. Absent means Chinese: every Chinese plan and exercise is exactly as before. */
export type SessionLanguage = 'zh' | 'ja' | 'ko'

export interface BaseExercise { /** Japanese or Korean exercises only (src/core/parallel). */ language?: 'ja' | 'ko'; id: string; stage: Stage; form: Form; /** The items this exercise practises (the ones whose results it records). */ refs: string[]; /** Retry round: 0 for the first pass; later rounds are not graded. */ round: number }

export interface IntroExercise extends BaseExercise { form: 'intro' }
export interface ChoiceItem extends BaseExercise { form: 'choice'; direction: 'zh-to-en' | 'en-to-zh'; question: string; options: string[]; answer: number; explanation: string; unknown?: Flagged }
export interface MatchItem extends BaseExercise { form: 'match'; mode: 'zh-en' | 'zh-py' | 'py-en'; pairs: { ref: string; left: string; right: string }[]; order: number[]; explanation: string }
/** A typed/spoken/handwritten answer. 'accepted' are the Chinese (or English, or pinyin) answers that count as right, the model answer first. */
export interface TextItem extends BaseExercise { form: 'pinyin' | 'recall' | 'translate-zh-en' | 'translate-en-zh' | 'dictation' | 'exchange-reply'; prompt: string; promptLang: 'zh' | 'en'; hearText?: string; answerLang: 'zh' | 'en' | 'py'; /** An exchange reply: the English of the question (shown on request) and of the reply to give (the cue). */ questionEn?: string; replyEn?: string; accepted: string[]; /** Words the dataset says may be left out or added without changing the meaning. */ optional?: string[]; model: string; modelPinyin?: string; explanation: string; unknown?: Flagged; /** Only wordings from the same phrase set were listed; everything else is self-marked. */ phrase?: { zh: string; py: string; en: string } }
/** What the Japanese/Korean sentence builder needs beyond the Chinese one: the phrase, its reading and Chinese original, and which tiles are particles (with what they do). */
export interface ParallelTilesExtra { text: string; reading?: string; zh?: string; tiles: { text: string; reading?: string; particle?: string }[] }
export interface TilesItem extends BaseExercise { parallel?: ParallelTilesExtra; form: 'tiles'; translation: string; tiles: string[]; distractors: string[]; shuffled: number[]; accepted: string[]; optional?: string[]; model: string; modelPinyin?: string; explanation: string }
export interface GapItem extends BaseExercise { form: 'gap'; sentence: string; gapped: string; options: string[]; answer: number; translation: string; explanation: string }
export interface ListenItem extends BaseExercise { form: 'listen-pick'; hearText: string; options: string[]; answer: number; model: string; unknown?: Flagged; explanation: string }
export interface RepeatItem extends BaseExercise { form: 'repeat'; zh: string; py: string; en: string }
/** A line of a dataset exchange or conversation. */
export interface DialogueLine { zh: string; py: string; en: string; speaker?: 'female' | 'male'; name?: string }
/** Hear or read the question, pick the fitting reply (the reply and its wrong replies, shuffled). */
export interface ExchangePickItem extends BaseExercise { form: 'exchange-pick'; question: DialogueLine; options: DialogueLine[]; answer: number; explanation: string }
/** The correct phrase against one or two near-miss versions; 'whys' gives each wrong option's reason and 'note' the pattern's explanation, both shown after Check. */
export interface WhichCorrectItem extends BaseExercise { form: 'which-correct'; en: string; options: { zh: string; py?: string }[]; answer: number; whys: (string | undefined)[]; note?: string; explanation: string }
/** A pre-generated conversation with named speakers and exactly two questions (Listen and answer). */
export interface ConversationItem extends BaseExercise {
  form: 'conversation'; title: string; speakers: { name: string; speaker: 'female' | 'male' }[]; lines: (DialogueLine & { name: string; speaker: 'female' | 'male' })[]
  questions: { q: string; options: string[]; answer: number }[]; explanation: string
}
export type SessionExercise = IntroExercise | ChoiceItem | MatchItem | TextItem | TilesItem | GapItem | ListenItem | RepeatItem | ExchangePickItem | WhichCorrectItem | ConversationItem

export interface StagePlan { stage: Stage; rounds: number; exercises: SessionExercise[] }
export interface SessionPlan {
  /** Absent means Chinese. */
  language?: SessionLanguage
  intent: Intent
  preset: string
  length: Length
  stages: StagePlan[]
  /** Items no engine exercise could be built for (a learner's own or media item without a usable phrase): the AI content path or Practise one skill covers them. */
  uncovered: string[]
  /** The graded exercises of the plan, not counting intro cards or retries. */
  total: number
}
