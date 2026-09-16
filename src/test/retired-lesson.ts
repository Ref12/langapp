import { db, initializeWorkspace } from '../core/database'
import { trackWord } from '../core/learning'
import type { Activity } from '../core/model'

export async function seedRetiredLesson(): Promise<string> {
  await initializeWorkspace()
  const wordIds = ['zh:hello', 'zh:thanks']
  for (const id of wordIds) await trackWord(id, 'lesson:zh:greetings')
  const createdAt = Date.now()
  await db.lessons.add({ lessonId: 'zh:greetings', startedAt: createdAt })
  const id = 'retired-starter-session'
  const activities: Activity[] = ['meaning', 'form']
  await db.sessions.add({
    id, kind: 'lesson', lessonId: 'zh:greetings', cursor: 0, status: 'active', createdAt,
    questions: activities.flatMap(activity => wordIds.map(wordId => ({
      wordId, activity, revealed: false, options: ['zh:hello', 'zh:thanks', 'zh:tea', 'zh:rain'],
    }))),
  })
  return id
}
