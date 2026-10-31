import { z } from 'zod'
import { unitRefSchema } from '../study/contracts'

// Drill sets: a fixed list of study items drilled by type. Stored in the local database (drillSets) and carried in backups.

export const DRILLS_LABEL = 'Drills'

export const DRILL_TYPE_IDS = ['meanings', 'write', 'pinyin', 'translate', 'repeat', 'listen', 'read'] as const
export type DrillTypeId = typeof DRILL_TYPE_IDS[number]
export const drillTypeSchema = z.enum(DRILL_TYPE_IDS)

/** Got it = correct, Needed a hint = correct but hard, Missed = wrong. */
export const MARKS = ['got', 'hint', 'missed'] as const
export type Mark = typeof MARKS[number]
export const markSchema = z.enum(MARKS)
export const MARK_LABEL: Record<Mark, string> = { got: 'Got it', hint: 'Needed a hint', missed: 'Missed' }

const id = z.string().min(1).max(200)
const timestamp = z.number().int().nonnegative()

/** First-pass results of one drill type. Once `done`, redos are ungraded and never change these. */
export const typeProgressSchema = z.object({
  results: z.record(unitRefSchema, markSchema),
  /** Write it in Characters mode: each character's first-pass result. A word's result is the worst of its characters. */
  chars: z.record(z.string().min(1).max(2), z.object({ mark: markSchema, cue: unitRefSchema }).strict()).optional(),
  /** The refs this type covered when it was started; it is done when each has a result. */
  scope: z.array(unitRefSchema).max(80),
  done: z.boolean(),
  redos: z.number().int().nonnegative(),
  finishedAt: timestamp.optional(),
}).strict()

export const sentenceSchema = z.object({
  zh: z.string().trim().min(1).max(200),
  py: z.string().trim().min(1).max(400),
  en: z.string().trim().min(1).max(300),
  source: z.enum(['catalog', 'ai']),
}).strict()

export const conversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  lines: z.array(z.object({ who: z.string().trim().min(1).max(20), zh: z.string().trim().min(1).max(200), py: z.string().trim().min(1).max(400), en: z.string().trim().min(1).max(300) }).strict()).min(2).max(12),
  /** A question asked once line `after` (0-based) has played. */
  questions: z.array(z.object({
    after: z.number().int().min(0).max(11), question: z.string().trim().min(1).max(300),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(4), answer: z.number().int().min(0).max(3),
  }).strict()).min(1).max(4),
}).strict()

export const contentSchema = z.object({
  state: z.enum(['pending', 'running', 'ready', 'failed', 'no-ai']),
  error: z.string().max(600).optional(),
  /** Request batches finished / asked for, while running. */
  done: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
  sentences: z.record(unitRefSchema, sentenceSchema),
  conversations: z.array(conversationSchema).max(6),
}).strict()

export const drillSetSchema = z.object({
  id,
  source: z.enum(['new', 'review', 'study-set', 'lesson', 'drill']),
  collectionId: id.optional(),
  /** lesson: the lesson session drilled; drill: the earlier drill set drilled again. */
  originId: id.optional(),
  /** The origin and date shown in lists: "New items · 30 Oct", "Reviews · 28 Oct" or the study set's name. */
  title: z.string().trim().min(1).max(200),
  refs: z.array(unitRefSchema).min(1).max(60),
  status: z.enum(['active', 'completed', 'abandoned']),
  format: z.enum(['single', 'quiz']),
  progress: z.record(drillTypeSchema, typeProgressSchema),
  content: contentSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp.optional(),
  /** Thrown away by the user (History hides it); a set only set aside to make room stays listed. */
  discarded: z.boolean().optional(),
}).strict()

export const drillSetsBackupSchema = z.array(drillSetSchema).max(2000)

export type TypeProgress = z.infer<typeof typeProgressSchema>
export type Sentence = z.infer<typeof sentenceSchema>
export type Conversation = z.infer<typeof conversationSchema>
export type DrillContent = z.infer<typeof contentSchema>
export type DrillSet = z.infer<typeof drillSetSchema>
export type DrillFormat = DrillSet['format']

/** What each type needs before it can start: nothing (built in code), a sentence per item, or conversations. */
export const DRILL_TYPES: { id: DrillTypeId; name: string; blurb: string; icon: string; needs: 'none' | 'sentences' | 'conversations' }[] = [
  { id: 'meanings', name: 'Word meanings', blurb: 'Chinese ↔ English: choose, match or type', icon: 'Languages', needs: 'none' },
  { id: 'write', name: 'Write it', blurb: 'A pinyin sentence, write the highlighted word', icon: 'PenLine', needs: 'sentences' },
  { id: 'pinyin', name: 'Say the pinyin', blurb: 'See the word, type its pinyin', icon: 'Type', needs: 'none' },
  { id: 'translate', name: 'Translate sentences', blurb: 'English to Chinese: type, speak or write', icon: 'MessageSquareText', needs: 'sentences' },
  { id: 'repeat', name: 'Repeat after me', blurb: 'Timed audio loop, nothing to look at', icon: 'Repeat', needs: 'sentences' },
  { id: 'listen', name: 'Listen and answer', blurb: 'A short conversation with checkpoint questions', icon: 'Headphones', needs: 'conversations' },
  { id: 'read', name: 'Read and answer', blurb: 'The same conversation as text with pinyin', icon: 'BookOpen', needs: 'conversations' },
]
export const drillType = (type: DrillTypeId) => DRILL_TYPES.find(entry => entry.id === type)!

/** FSRS grade of a first-pass mark: Got it is Good, Needed a hint is Hard, Missed is Again. */
export const MARK_RATING = { got: 3, hint: 2, missed: 1 } as const

export const countMarks = (set: Pick<DrillSet, 'progress'>, types?: readonly DrillTypeId[]) => {
  const counts: Record<Mark, number> = { got: 0, hint: 0, missed: 0 }
  for (const [type, progress] of Object.entries(set.progress) as [DrillTypeId, TypeProgress][]) {
    if (types && !types.includes(type)) continue
    // Write it in Characters mode counts characters; otherwise its items.
    for (const mark of progress.chars ? Object.values(progress.chars).map(entry => entry.mark) : Object.values(progress.results)) counts[mark]++
  }
  return counts
}
/** Correct answers (Got it and Needed a hint) out of all first-pass answers. */
export const scoreOf = (counts: Record<Mark, number>) => ({ correct: counts.got + counts.hint, total: counts.got + counts.hint + counts.missed })
