import { getLesson, getStory, getWord } from '../data/mandarin'
import { db } from './database'
import { LANGUAGE, type Attempt, type Lesson, type PracticeSession, type Preferences, type WordState } from './model'
import { applyAnswer } from './progress'
import { makeQuestions } from './questions'
import { speechVoicePreferencesSchema } from './assistant/contracts'

export async function savePreferences(changes: Partial<Omit<Preferences, 'id' | 'language'>>): Promise<void> {
  await db.transaction('rw', db.preferences, async () => {
    const current = await db.preferences.get('workspace')
    if (!current) throw new Error('Workspace not found. Reload before saving preferences.')
    const next = { ...current, ...changes, name: (changes.name ?? current.name).trim() }
    if (!next.name || next.name.length > 80) throw new Error('Use a workspace name between 1 and 80 characters.')
    if (changes.speechVoices !== undefined) next.speechVoices = { ...current.speechVoices, ...changes.speechVoices }
    if (next.speechVoices !== undefined) next.speechVoices = speechVoicePreferencesSchema.parse(next.speechVoices)
    if (next.sudokuAutoSpeak !== undefined && typeof next.sudokuAutoSpeak !== 'boolean') throw new Error('Choose whether automatic Sudoku speech is on or off.')
    if (next.sudokuShowPinyin !== undefined && typeof next.sudokuShowPinyin !== 'boolean') throw new Error('Choose whether selected-character pinyin is shown.')
    await db.preferences.put(next)
  })
}

async function introduce(wordIds: string[], source: string, now: number): Promise<void> {
  for (const wordId of wordIds) {
    getWord(wordId)
    if (!await db.words.get(wordId)) {
      await db.words.add({
        wordId, language: LANGUAGE, introducedAt: now, introducedFrom: source,
        attempts: 0, independentCorrect: 0, successfulDays: [], successfulActivities: [], dueAt: now,
      })
    }
  }
}

export async function trackWord(wordId: string, source: string): Promise<void> {
  await db.transaction('rw', db.words, () => introduce([wordId], source, Date.now()))
}

export async function openStory(storyId: string): Promise<void> {
  getStory(storyId)
  await db.transaction('rw', db.readings, async () => {
    const current = await db.readings.get(storyId)
    await db.readings.put(current
      ? { ...current, updatedAt: Date.now() }
      : { storyId, passage: 0, completed: [], updatedAt: Date.now() })
  })
}

export async function moveReading(storyId: string, from: number, to: number, complete: boolean): Promise<void> {
  const story = getStory(storyId)
  if (!Number.isInteger(to) || to < 0 || to >= story.passages.length) throw new Error('That passage is not available.')
  await db.transaction('rw', db.readings, async () => {
    const current = await db.readings.get(storyId)
    if (!current) throw new Error('Open this story before saving your place.')
    if (current.passage !== from) throw new Error('Your reading place changed in another tab. Please try again.')
    await db.readings.put({
      ...current, passage: to, updatedAt: Date.now(),
      completed: complete ? [...new Set([...current.completed, from])] : current.completed,
    })
  })
}

export function lessonReviewWords(lesson: Lesson, tracked: WordState[]): string[] {
  const eligible = new Set(lesson.curriculum?.reviewWordIds ?? [])
  return tracked.filter(word => eligible.has(word.wordId) && !lesson.wordIds.includes(word.wordId))
    .sort((a, b) => a.dueAt - b.dueAt || a.wordId.localeCompare(b.wordId))
    .slice(0, 3).map(word => word.wordId)
}

export async function startPractice(kind: PracticeSession['kind'], lessonId?: string): Promise<string> {
  if (kind === 'lesson' && !lessonId) throw new Error('Choose a lesson before starting practice.')
  if (kind !== 'lesson' && lessonId) throw new Error('Vocabulary review cannot be attached to a lesson.')
  const lesson = lessonId ? getLesson(lessonId) : undefined
  return db.transaction('rw', db.sessions, db.words, db.lessons, async () => {
    const existing = await db.sessions.where('status').equals('active')
      .filter(session => session.kind === kind && session.lessonId === lessonId).first()
    if (existing) return existing.id
    const now = Date.now()
    const tracked = await db.words.toArray()
    const wordIds = lesson?.wordIds ?? tracked
      .filter(word => kind === 'all' || word.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, 10).map(word => word.wordId)
    if (!wordIds.length) throw new Error(kind === 'due' ? 'No words are due right now.' : 'Add a word from reading or a lesson first.')
    await introduce(wordIds, lesson ? `lesson:${lesson.id}` : 'practice', now)
    if (lesson && !await db.lessons.get(lesson.id)) {
      await db.lessons.add({ lessonId: lesson.id, startedAt: now })
    }
    const reviewIds = lesson ? lessonReviewWords(lesson, tracked) : []
    const familiarIds = [...wordIds, ...tracked.map(word => word.wordId)]
    const id = crypto.randomUUID()
    await db.sessions.add({
      id, kind, lessonId, questions: [...makeQuestions(reviewIds, familiarIds), ...makeQuestions(wordIds, familiarIds)],
      cursor: 0, status: 'active', createdAt: now,
    })
    return id
  })
}

export async function revealAnswer(sessionId: string, index: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.attempts, async () => {
    const session = await db.sessions.get(sessionId)
    if (!session || session.status !== 'active' || session.cursor !== index) throw new Error('This question is no longer active.')
    if (await db.attempts.get(`${sessionId}:${index}`)) throw new Error('This answer has already been recorded.')
    session.questions[index].revealed = true
    await db.sessions.put(session)
  })
}

export async function submitAnswer(sessionId: string, index: number, answerId: string): Promise<Attempt> {
  return db.transaction('rw', db.sessions, db.attempts, db.words, async () => {
    const id = `${sessionId}:${index}`
    const existing = await db.attempts.get(id)
    if (existing) {
      if (existing.answerId !== answerId) throw new Error('This question already has a saved answer.')
      return existing
    }
    const session = await db.sessions.get(sessionId)
    if (!session || session.status !== 'active' || session.cursor !== index) throw new Error('This question is no longer active.')
    const question = session.questions[index]
    if (!question.options.includes(answerId)) throw new Error('Choose one of the available answers.')
    const word = await db.words.get(question.wordId)
    if (!word) throw new Error('The learning item for this question could not be found.')
    const attempt: Attempt = {
      id, sessionId, question: index, wordId: question.wordId, activity: question.activity,
      answerId, correct: answerId === question.wordId, assisted: question.revealed, createdAt: Date.now(),
    }
    await db.attempts.add(attempt)
    await db.words.put(applyAnswer(word, attempt.activity, attempt.correct, attempt.assisted, attempt.createdAt))
    return attempt
  })
}

export async function advancePractice(sessionId: string, index: number): Promise<void> {
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid practice question.')
  await db.transaction('rw', db.sessions, db.attempts, db.lessons, async () => {
    const session = await db.sessions.get(sessionId)
    if (!session) throw new Error('Practice session not found.')
    if (session.status === 'completed' || session.cursor > index) return // Idempotent Next after a double click.
    if (session.cursor !== index || !await db.attempts.get(`${sessionId}:${index}`)) throw new Error('Check your answer before continuing.')
    if (index < session.questions.length - 1) {
      await db.sessions.put({ ...session, cursor: index + 1 })
    } else {
      const completedAt = Date.now()
      await db.sessions.put({ ...session, status: 'completed', completedAt })
      if (session.lessonId) await db.lessons.update(session.lessonId, { completedAt })
    }
  })
}
