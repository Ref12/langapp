import { parse, stringify } from 'yaml'
import { emptySchedulingState, schedule, type Rating } from '../study/fsrs'
import { cardId, type ExerciseAttempt, type KnowledgeEntry, type StudyCard } from '../study/contracts'
import type { CharacterState } from '../characters/contracts'
import { omit } from '../omit'

// The journal is a top-level YAML sequence with one flow-style event per line,
// so appending lines keeps a segment valid YAML. Segments are monthly files.

export type JournalOp = 'add' | 'remove' | 'review' | 'attempt' | 'char' | 'practice'
export interface JournalEvent {
  /** ISO-8601 UTC time with milliseconds. */
  t: string
  op: JournalOp
  [key: string]: unknown
}

/** Scheduler tags: replaying a review through the tagged scheduler reproduces the card. */
export const SCHEDULERS = { 'fsrs-v1': schedule } as const
export const CURRENT_SCHEDULER = 'fsrs-v1'
const OPS = new Set<string>(['add', 'remove', 'review', 'attempt', 'char', 'practice'])

export function eventLine(event: JournalEvent): string {
  return '- ' + stringify(event, { collectionStyle: 'flow', lineWidth: 0, aliasDuplicateObjects: false }).trim().replace(/\s*\n\s*/g, ' ') + '\n'
}

export function serializeJournal(events: JournalEvent[]): string {
  return events.map(eventLine).join('')
}

/** Appends events to an existing segment text. Plain concatenation: the result is still valid YAML. */
export function appendToSegment(text: string, events: JournalEvent[]): string {
  const head = text === '' || text.endsWith('\n') ? text : text + '\n'
  return head + serializeJournal(events)
}

export function parseJournal(text: string): JournalEvent[] {
  const value: unknown = text.trim() === '' ? [] : parse(text, { schema: 'core' })
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error('A journal segment must be a YAML sequence.')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`Journal entry ${index + 1} is not a mapping.`)
    const event = item as Record<string, unknown>
    const t = event.t instanceof Date ? event.t.toISOString() : event.t
    if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) throw new Error(`Journal entry ${index + 1} has no valid time.`)
    if (typeof event.op !== 'string' || !OPS.has(event.op)) throw new Error(`Journal entry ${index + 1} has an unknown operation.`)
    return { ...event, t, op: event.op as JournalOp }
  })
}

export function segmentName(t: string): string {
  return `journal/${t.slice(0, 7)}.yaml`
}

/** Groups events (already in order) into monthly segments. */
export function toSegments(events: JournalEvent[]): Map<string, JournalEvent[]> {
  const segments = new Map<string, JournalEvent[]>()
  for (const event of events) {
    const name = segmentName(event.t)
    const list = segments.get(name)
    if (list) list.push(event); else segments.set(name, [event])
  }
  return new Map([...segments].sort(([a], [b]) => a.localeCompare(b)))
}

export const iso = (ms: number) => new Date(ms).toISOString()
const ms = (t: string) => Date.parse(t)

// ---- Event construction (used at the write sites) ----

export const addEvent = (entry: KnowledgeEntry): JournalEvent =>
  ({ t: iso(entry.addedAt), op: 'add', ref: entry.ref, band: Number(entry.band), source: entry.source })
export const removeEvent = (ref: string, at: number): JournalEvent => ({ t: iso(at), op: 'remove', ref })
export const reviewEvent = (ref: string, grade: Rating, at: number, attempt?: string): JournalEvent => ({
  t: iso(at), op: 'review', ref, grade: grade === 1 ? 'again' : grade === 2 ? 'hard' : grade === 3 ? 'good' : 'easy',
  domain: 'reading', sched: CURRENT_SCHEDULER, ...(attempt ? { attempt } : {}),
})
export const exerciseAttemptEvent = (attempt: ExerciseAttempt): JournalEvent => ({
  t: iso(attempt.createdAt), op: 'attempt', kind: 'exercise', id: attempt.id, session: attempt.sessionId,
  index: attempt.index, refs: attempt.refs, correct: attempt.correct, response: attempt.response,
})
export const wordAttemptEvent = (attempt: { id: string; sessionId: string; question: number; wordId: string; activity: string; answerId: string; correct: boolean; assisted: boolean; createdAt: number }): JournalEvent => ({
  t: iso(attempt.createdAt), op: 'attempt', kind: 'word', id: attempt.id, session: attempt.sessionId, question: attempt.question,
  word: attempt.wordId, activity: attempt.activity, answer: attempt.answerId, correct: attempt.correct, assisted: attempt.assisted,
})
export const characterEvent = (character: string, action: 'add' | 'remove' | 'practice', at: number): JournalEvent =>
  ({ t: iso(at), op: 'char', character, action })
export const practiceEvent = (text: string, at: number): JournalEvent => ({ t: iso(at), op: 'practice', text })

const GRADES: Record<string, Rating> = { again: 1, hard: 2, good: 3, easy: 4 }

// ---- Replay ----

export interface ReplayState {
  knowledge: Map<string, KnowledgeEntry>
  cards: Map<string, StudyCard>
  exerciseAttempts: Map<string, ExerciseAttempt>
  characters: Map<string, CharacterState>
}

export function emptyReplayState(): ReplayState {
  return { knowledge: new Map(), cards: new Map(), exerciseAttempts: new Map(), characters: new Map() }
}

export function replayFrom(base: { knowledge: KnowledgeEntry[]; cards: StudyCard[]; attempts: ExerciseAttempt[]; characters: CharacterState[] }): ReplayState {
  return {
    knowledge: new Map(base.knowledge.map(entry => [entry.ref, entry])),
    cards: new Map(base.cards.map(card => [card.id, card])),
    exerciseAttempts: new Map(base.attempts.map(attempt => [attempt.id, attempt])),
    characters: new Map(base.characters.map(state => [state.character, state])),
  }
}

/** Applies events to state in order. Mutates and returns it. Word attempts and phrase history are records only. */
export function replay(events: JournalEvent[], state: ReplayState = emptyReplayState()): ReplayState {
  for (const event of events) {
    const at = ms(event.t)
    switch (event.op) {
      case 'add': {
        const ref = String(event.ref)
        if (state.knowledge.has(ref)) break
        const [kind, lb] = ref.split(':') as ['vocabulary' | 'grammar', string]
        state.knowledge.set(ref, { ref, kind, lb, band: String(event.band) as KnowledgeEntry['band'], addedAt: at, source: event.source === 'dictionary' ? 'dictionary' : 'new' })
        const id = cardId(ref, 'reading')
        if (!state.cards.has(id)) state.cards.set(id, { id, ref, domain: 'reading', ...emptySchedulingState(at), updatedAt: at })
        break
      }
      case 'remove':
        state.knowledge.delete(String(event.ref))
        break
      case 'review': {
        const run = SCHEDULERS[String(event.sched) as keyof typeof SCHEDULERS]
        if (!run) throw new Error(`Unknown scheduler "${String(event.sched)}" in the journal.`)
        const rating = GRADES[String(event.grade)]
        if (!rating) throw new Error(`Unknown grade "${String(event.grade)}" in the journal.`)
        const id = cardId(String(event.ref), 'reading')
        const card = state.cards.get(id)
        if (!card) break // Removed items are not rescheduled.
        const next = run({ due: card.due, stability: card.stability, difficulty: card.difficulty, reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.lastReview }, rating, at)
        state.cards.set(id, { ...omit(card, 'lastReview'), ...next, updatedAt: at })
        break
      }
      case 'attempt':
        if (event.kind === 'exercise') {
          const id = String(event.id)
          if (!state.exerciseAttempts.has(id)) state.exerciseAttempts.set(id, {
            id, sessionId: String(event.session), index: Number(event.index), refs: event.refs as string[],
            response: String(event.response ?? ''), correct: event.correct === true, createdAt: at,
          })
        }
        break
      case 'char': {
        const character = String(event.character)
        const current = state.characters.get(character)
        if (event.action === 'add') {
          if (current?.manualAddedAt === undefined) state.characters.set(character, { practiceCompletions: 0, ...current, character, manualAddedAt: at })
        } else if (event.action === 'remove') {
          if (current?.manualAddedAt !== undefined) {
            if (current.practiceCompletions === 0) state.characters.delete(character)
            else state.characters.set(character, omit(current, 'manualAddedAt'))
          }
        } else if (event.action === 'practice') {
          state.characters.set(character, { ...current, character, practiceCompletions: (current?.practiceCompletions ?? 0) + 1, lastPracticedAt: at })
        }
        break
      }
      default: break
    }
  }
  return state
}
