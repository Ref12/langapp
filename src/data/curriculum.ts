import generated from './curriculum.generated.json'
import type { Lesson, Word, Workspace } from '../core/model'

export const curriculum = generated
export const curriculumLevels = curriculum.phases.flatMap(phase => phase.levels)
export type CurriculumLevel = typeof curriculumLevels[number]
export type CurriculumGrammar = typeof curriculum.grammar[number]

export const curriculumWords: Word[] = curriculum.words.map(word => ({
  id: word.id, native: word.ch, pinyin: word.pr, meaning: word.ds, kind: 'Curriculum sense',
  curriculum: { levelId: word.levelId, moduleId: word.moduleId },
}))

export const curriculumLessons: Lesson[] = curriculum.lessons.map(lesson => ({
  id: lesson.id, title: lesson.title, objective: lesson.objective, wordIds: lesson.wordIds,
  curriculum: {
    levelId: lesson.levelId, moduleId: lesson.moduleId, number: lesson.number,
    grammarIds: lesson.grammarIds, reviewGrammarIds: lesson.reviewGrammarIds, reviewWordIds: lesson.reviewWordIds,
  },
}))

export function nextCurriculumLesson(workspace: Workspace): Lesson | undefined {
  const active = [...workspace.sessions].filter(session => session.status === 'active' && session.lessonId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(session => curriculumLessons.find(lesson => lesson.id === session.lessonId)).find(lesson => lesson !== undefined)
  return active ?? curriculumLessons.find(lesson => !workspace.lessons.some(state => state.lessonId === lesson.id && state.completedAt !== undefined))
}

export function curriculumProgress(level: CurriculumLevel, workspace: Workspace) {
  const wordIds = new Set(level.modules.flatMap(module => module.wordIds))
  const lessonIds = new Set(level.modules.flatMap(module => module.lessonIds))
  return {
    introduced: workspace.words.filter(word => wordIds.has(word.wordId)).length,
    practiced: workspace.lessons.filter(lesson => lessonIds.has(lesson.lessonId) && lesson.completedAt !== undefined).length,
    totalLessons: lessonIds.size,
    totalWords: wordIds.size,
  }
}
