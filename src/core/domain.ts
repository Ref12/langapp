export type TargetLanguage = 'zh' | 'ja' | 'ko'
export type KnowledgeTier = 'learning' | 'familiar' | 'mastered'
export type LearningItemType =
  | 'word'
  | 'phrase'
  | 'idiom'
  | 'construction'
  | 'sentence-pattern'

export interface LanguageProfile {
  id: string
  name: string
  sourceLanguage: 'en'
  targetLanguage: TargetLanguage
  romanization: string
  dailyNewItemLimit: number
  createdAt: string
  updatedAt: string
}

export interface LibraryItem {
  id: string
  profileId: string
  title: string
  content: string
  sourceType: 'paste' | 'text' | 'markdown'
  annotations: WeaveAnnotation[]
  analysisStatus: 'not-analyzed' | 'analyzing' | 'ready' | 'failed'
  analysisError?: string
  createdAt: string
  updatedAt: string
}

export interface LearningItem {
  id: string
  targetLanguage: TargetLanguage
  sourceText: string
  targetText: string
  romanization: string
  gloss: string
  itemType: LearningItemType
  createdAt: string
}

export interface UserItemState {
  id: string
  profileId: string
  itemId: string
  tier: KnowledgeTier
  confidence: number
  introducedAt: string
  updatedAt: string
}

export interface WeaveAnnotation {
  id: string
  itemId: string
  start: number
  end: number
  sourceText: string
  targetText: string
  romanization: string
  gloss: string
  tier: KnowledgeTier
}

export interface EvidenceEvent {
  id: string
  profileId: string
  itemId: string
  sourceModuleId: string
  type:
    | 'introduced'
    | 'viewed'
    | 'romanization-revealed'
    | 'gloss-revealed'
    | 'review-correct'
    | 'review-incorrect'
  createdAt: string
}

export type ReviewActivity = 'matching' | 'fill-blank' | 'sentence'

export interface ReviewAttempt {
  id: string
  profileId: string
  itemId: string
  activity: ReviewActivity
  answer: string
  correct: boolean
  createdAt: string
}

export interface ConversationThread {
  id: string
  profileId: string
  title: string
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'pending' | 'completed' | 'failed'

export interface ConversationMessage {
  id: string
  threadId: string
  role: MessageRole
  canonicalContent: string
  annotations: WeaveAnnotation[]
  status: MessageStatus
  error?: string
  createdAt: string
}

export interface AIConnection {
  id: 'default'
  baseUrl: string
  apiKey: string
  model: string
  warningAcknowledged: boolean
  configurationVersion: number
  lastTestStatus?: 'success' | 'failure'
  lastTestMessage?: string
  lastTestedAt?: string
  updatedAt: string
}

export interface AppSetting {
  key: string
  value: string
}

export const languageNames: Record<TargetLanguage, string> = {
  zh: 'Mandarin',
  ja: 'Japanese',
  ko: 'Korean',
}

export const defaultRomanization: Record<TargetLanguage, string> = {
  zh: 'Pinyin',
  ja: 'Hepburn',
  ko: 'Revised Romanization',
}
