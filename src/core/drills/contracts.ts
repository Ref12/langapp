import { z } from 'zod'
import { unitRefSchema } from '../study/contracts'
import { handsfreeSettingsSchema } from '../handsfree/contracts'

// Drill sets: a fixed list of study items drilled by type. Stored in the local database (drillSets) and carried in backups.

export const DRILLS_LABEL = 'Practice'

export const DRILL_TYPE_IDS = ['meanings', 'match', 'learn', 'write', 'pinyin', 'translate', 'repeat', 'listen', 'read'] as const
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
  /** An AI sentence that passed the in-app check (absent: not checked, e.g. written before the check existed or the check call failed). */
  checked: z.boolean().optional(),
  /** A catalog sentence that uses words the learner hasn't learned (the forms): chosen only when nothing fully known was available. */
  unknown: z.array(z.string()).optional(),
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

/** The Hands-free activity of a set: the same player as before, with its own seed, settings and resume position. Present once Hands-free has been opened. */
export const handsfreeActivitySchema = z.object({
  /** Fixes the scrambled order, so a resumed or replayed run is the same run. */
  seed: z.number().int().min(0).max(2 ** 31),
  settings: handsfreeSettingsSchema,
  /** True once Play was pressed. */
  started: z.boolean(),
  /** Index of the prompt to resume at. */
  position: z.number().int().min(0),
  /** Set when a run reached its end. */
  done: z.boolean(),
  finishedAt: timestamp.optional(),
  /** 3 once the run is the mixed flow (Introduction / Recall); an older run (none or 2) has a different script, so it is reset to the top when opened. */
  layout: z.union([z.literal(2), z.literal(3)]).optional(),
  /** Practice-count pairs ("ref|skill") already counted, so a replay adds nothing. */
  practiced: z.array(z.string().max(220)).max(500).optional(),
}).strict()
export type HandsfreeActivity = z.infer<typeof handsfreeActivitySchema>

/** The practice engine's state on a set (src/core/session). Only sets created from now on carry it; a set without it, or with old-style progress, keeps the old view. */
export const engineStateSchema = z.object({
  preset: z.string().min(1).max(60),
  length: z.enum(['short', 'standard', 'long']),
  seed: z.number().int().min(0).max(2 ** 31),
  /** "ref|skill" pairs whose first graded attempt is recorded, so a replay or a resume never records twice. */
  recorded: z.array(z.string().max(220)).max(2000),
  /** Per item: whether every graded first attempt of it was right (for the summary). */
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  startedAt: timestamp.optional(),
  finishedAt: timestamp.optional(),
}).strict()
export type EngineState = z.infer<typeof engineStateSchema>

export const drillSetSchema = z.object({
  id,
  source: z.enum(['new', 'review', 'study-set', 'lesson', 'drill']),
  collectionId: id.optional(),
  /** lesson: the lesson session drilled; drill: the earlier drill set drilled again. */
  originId: id.optional(),
  /** The origin and date shown in lists: "New items · 30 Oct", "Reviews · 28 Oct" or the study set's name. */
  title: z.string().trim().min(1).max(200),
  refs: z.array(unitRefSchema).min(1).max(200),
  status: z.enum(['active', 'completed', 'abandoned']),
  format: z.enum(['single', 'quiz']),
  progress: z.record(drillTypeSchema, typeProgressSchema),
  content: contentSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp.optional(),
  /** Set on a set created for the practice engine: its Start screen replaces the drill-type list. */
  engine: engineStateSchema.optional(),
  /** The Hands-free activity: its settings and where it stopped. */
  handsfree: handsfreeActivitySchema.optional(),
  /** The Hands-free recall activity (the Hands-free activity above is the Introduction). */
  handsfreeRecall: handsfreeActivitySchema.optional(),
  /** Made by the Hands-free shortcut: it is finished when its Hands-free activity reaches the end. */
  shortcut: z.literal('handsfree').optional(),
  /** Set once the set's intro cards have counted as reading practice. */
  introSeen: z.boolean().optional(),
  /** Skills the set opens emphasised (a Practice by skill set): its drill types for them are listed first. */
  emphasis: z.enum(['reading', 'listening', 'speaking', 'writing']).optional(),
  /** An Unwritten characters set: Learn to write teaches only the characters not yet written. */
  unwritten: z.literal(true).optional(),
  /** Thrown away by the user (History hides it); a set only set aside to make room stays listed. */
  discarded: z.boolean().optional(),
  /** Set when the user removed the set from History; it also leaves Unfinished sets. Results already recorded stay. */
  removedAt: z.number().optional(),
  /** A New items set's own items: they join the knowledge set when the set is finished, never at creation. */
  addOnFinish: z.array(unitRefSchema).max(200).optional(),
  /** Study-set item ids promoted into the knowledge set when the set is finished. */
  promote: z.array(z.string().min(1).max(200)).max(200).optional(),
  /** Set once, when finishing added items (empty when it added none); a set finished again never adds them twice. Sets from before this field are worked out from the knowledge entries. */
  addedRefs: z.array(unitRefSchema).max(200).optional(),
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
  { id: 'meanings', name: 'Word meanings', blurb: 'Chinese ↔ English: choose or type', icon: 'Languages', needs: 'none' },
  { id: 'match', name: 'Match pairs', blurb: 'Join each word to its meaning, a board at a time', icon: 'Shuffle', needs: 'none' },
  { id: 'learn', name: 'Learn to write', blurb: 'Each word, then its characters: watch, trace, write from memory', icon: 'GraduationCap', needs: 'none' },
  { id: 'write', name: 'Write it', blurb: 'A pinyin sentence, write the highlighted word from memory', icon: 'PenLine', needs: 'sentences' },
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
