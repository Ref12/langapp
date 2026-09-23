import type { SpeechRate, SpeechVoicePreferences } from './assistant/contracts'
import type { ExerciseAttempt, ExerciseSession, KnowledgeEntry, StudyCard } from './study/contracts'

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
  readingMode: ReadingMode
  sidebarCollapsed: boolean
  speechVoices?: SpeechVoicePreferences
  defaultSpeechRate?: SpeechRate
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
}
