import type { SpeechRate, SpeechVoicePreferences } from './assistant/contracts'
import type { ExerciseAttempt, ExerciseSession, KnowledgeEntry, StudyCard } from './study/contracts'
import type { CharacterState } from './characters/contracts'
import type { PinyinFormat } from './pinyin'
import type { WritingSpeech } from './writing-speech'

export const LANGUAGE = 'zh-Hans' as const
export type ReadingMode = 'source' | 'weave' | 'target'
export type Activity = 'meaning' | 'form'
export type ReadingStage = 'Introduced' | 'Practicing' | 'Learned'

export interface Word {
  id: string
  label?: string
  native: string
  pinyin: string
  meaning: string
  kind: string
  example?: string
  translation?: string
  curriculum?: { levelId: string; moduleId: string }
}

export type Segment = string | { wordId: string; text?: string }
export interface Story {
  id: string
  title: string
  description: string
  topic: string
  glyph: string
  attribution: string
  passages: { source: Segment[]; target: Segment[] }[]
}

export interface Lesson {
  id: string
  title: string
  objective: string
  wordIds: string[]
  curriculum: {
    levelId: string
    moduleId: string
    number: number
    grammarIds: string[]
    reviewGrammarIds: string[]
    reviewWordIds: string[]
  }
}

export interface Preferences {
  id: 'workspace'
  language: typeof LANGUAGE
  name: string
  theme: 'dark' | 'light'
  pinyin: boolean
  pinyinFormat?: PinyinFormat
  /** Language the learner is working in (a track's language code). Absent means 'zh'; only written once a second track exists. */
  currentLanguage?: string
  /** Parallel tracks the learner has opened ('ja', 'ko'). Absent means none. */
  startedTracks?: ('ja' | 'ko')[]
  /** Show a muted Japanese and/or Korean line on Chinese vocabulary cards. Absent means off. */
  otherLanguageCards?: 'off' | 'ja' | 'ko' | 'both'
  /** Reading aids per language on Japanese and Korean practice: furigana (ja, on unless false) and romanization (ko, off unless true). */
  /** How Japanese readings show in the pinyin slot: romaji (default) or kana. */
  japaneseReading?: 'romaji' | 'kana'
  /** The form verbs are shown in (a form id of the language pack's forms table). Absent until the learner chooses; it changes what is displayed, never what is stored. */
  displayForm?: string
  /** Kana or romaji for the reading line. Absent until the learner chooses; romaji is made from the kana for display and never stored. */
  readingStyle?: 'kana' | 'romaji' | 'hangul' | 'romanized'
  /** Colour Chinese characters and their pinyin by tone (a language with tones only). Absent means off. */
  toneColours?: boolean
  /** The tone colours: Pleco-style (default), Hanping-style or the learner's own. */
  toneColourScheme?: 'pleco' | 'hanping' | 'custom'
  /** The learner's own tone colours (tones 1 to 4 and neutral) for each theme. */
  toneColoursCustom?: { dark: string[]; light: string[] }
  readingMode: ReadingMode
  sidebarCollapsed: boolean
  speechVoices?: SpeechVoicePreferences
  defaultSpeechRate?: SpeechRate
  speechDebugMessages?: boolean
  sudokuAutoSpeak?: boolean
  /** Older on/off form of `writingSpeech`; false reads as Off. */
  writingAutoSpeak?: boolean
  /** Say the character: at transitions (default), every stroke, or off. */
  writingSpeech?: WritingSpeech
  /** The last non-Off `writingSpeech`, what the quick mute restores. */
  writingSpeechResume?: 'transitions' | 'stroke'
  haptics?: boolean
  /** How forgiving the writing practice is when it checks a stroke: strict, normal (default) or relaxed. */
  strokeMatching?: 'strict' | 'normal' | 'relaxed'
  /** Writing player: colour each stroke by its character part (the Palette button). Off by default. */
  writingColourParts?: boolean
  /** Exercises written for each lesson (new, review, collection, span): 8 to 40, default 20. */
  exercisesPerLesson?: number
  sudokuShowPinyin?: boolean
  tileAutoSpeak?: boolean
/** Play the Chinese prompt on entering an exercise that has a Hear button for it. Default off. */
promptAutoPlay?: boolean
  /** How the practice engine's typed-answer exercises are answered: typing (default), speaking or handwriting. */
  answerMode?: 'type' | 'speak' | 'write'
  /** Practice engine: include exercises that ask for characters to be written. Default yes. */
  practiseWriting?: boolean
  practiceMode?: 'speak' | 'write'
  historyFilter?: 'all' | 'speak' | 'write' | 'lessons' | 'drills'
  dictionaryScope?: 'all' | 'knowledge'
  /** Dictionary → Characters inside "My knowledge set": All, Can write (practised or flagged) or Not yet. */
  characterWriteFilter?: 'all' | 'can' | 'not'
}

export interface WordState {
  wordId: string
  language: typeof LANGUAGE
  introducedAt: number
  introducedFrom: string
  attempts: number
  independentCorrect: number
  successfulDays: string[]
  successfulActivities: Activity[]
  dueAt: number
}

export interface ReadingProgress {
  storyId: string
  passage: number
  completed: number[]
  updatedAt: number
}

export interface LessonProgress {
  lessonId: string
  startedAt: number
  completedAt?: number
}

export interface Question {
  wordId: string
  activity: Activity
  options: string[]
  revealed: boolean
}

export interface PracticeSession {
  id: string
  kind: 'lesson' | 'due' | 'all'
  lessonId?: string
  questions: Question[]
  cursor: number
  status: 'active' | 'completed'
  createdAt: number
  completedAt?: number
}

export interface Attempt {
  id: string
  sessionId: string
  question: number
  wordId: string
  activity: Activity
  answerId: string
  correct: boolean
  assisted: boolean
  createdAt: number
}

export interface Workspace {
  preferences: Preferences
  words: WordState[]
  readings: ReadingProgress[]
  lessons: LessonProgress[]
  sessions: PracticeSession[]
  attempts: Attempt[]
  knowledge: KnowledgeEntry[]
  studyCards: StudyCard[]
  exerciseSessions: ExerciseSession[]
  exerciseAttempts: ExerciseAttempt[]
  characterStates: CharacterState[]
}
