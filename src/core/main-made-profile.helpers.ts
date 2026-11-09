import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, loadWorkspace } from './database'
import { dueCards } from './study/knowledge'

// Fixtures written by main (see fixtures/main-made/README.md). Paths are built with node:path and file URLs, so they read the same on Windows.
export const fixtureDir = join(process.cwd(), 'src', 'core', 'fixtures', 'main-made')
export const fixtureText = (name: string): string => readFileSync(join(fixtureDir, name), 'utf8')
export const fixtureJson = <T = any>(name: string): T => JSON.parse(fixtureText(name)) as T // eslint-disable-line @typescript-eslint/no-explicit-any

/** The cloud backup layout main wrote: every file under cloud/, keyed by its slash-separated path inside the profile folder. */
export function cloudFiles(): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (relative: string[]) => {
    for (const entry of readdirSync(join(fixtureDir, 'cloud', ...relative), { withFileTypes: true })) {
      if (entry.isDirectory()) walk([...relative, entry.name])
      else files.set([...relative, entry.name].join('/'), readFileSync(join(fixtureDir, 'cloud', ...relative, entry.name), 'utf8'))
    }
  }
  walk([])
  return files
}

/** A ref or lesson id of another language, written independently of src/core/chinese-only.ts so the tests do not trust the code under test. */
export const isOtherLanguage = (value: unknown): boolean => typeof value === 'string' && /^[a-z]{2,3}:/.test(value)
/** Settings that only main knows (it added them after the commit Stable is built from). */
export const MAIN_ONLY_PREFERENCES = ['currentLanguage', 'startedTracks', 'otherLanguageCards', 'japaneseReading'] as const

export interface MainView {
  preferences: Record<string, unknown>
  lessons: { lessonId: string }[]
  knowledge: { ref: string }[]
  studyCards: { ref: string }[]
  exerciseSessions: { id: string; targetRefs: string[]; reviewRefs: string[] }[]
  exerciseAttempts: { id: string; refs: string[] }[]
  due: string[]
}

const byKey = (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) => String(a[key]).localeCompare(String(b[key]))
const sorted = <T extends object>(rows: T[], key: string): T[] => [...rows].sort(byKey(key) as never)

/** What main showed for the Chinese part of the profile, from the fixture it made. */
export function expectedChinese() {
  const main = fixtureJson<MainView>('main-view.json')
  const preferences = Object.fromEntries(Object.entries(main.preferences).filter(([key]) => !(MAIN_ONLY_PREFERENCES as readonly string[]).includes(key)))
  return {
    preferences,
    lessons: sorted(main.lessons.filter(row => !isOtherLanguage(row.lessonId)), 'lessonId'),
    knowledge: sorted(main.knowledge.filter(row => !isOtherLanguage(row.ref)), 'ref'),
    studyCards: sorted(main.studyCards.filter(row => !isOtherLanguage(row.ref)), 'ref'),
    exerciseSessions: sorted(main.exerciseSessions.filter(row => ![...row.targetRefs, ...row.reviewRefs].some(isOtherLanguage)), 'id'),
    exerciseAttempts: sorted(main.exerciseAttempts.filter(row => !row.refs.some(isOtherLanguage)), 'id'),
    due: main.due.filter(ref => !isOtherLanguage(ref)),
  }
}

/** The same view of the database Stable has open now. */
export async function stableView() {
  const workspace = await loadWorkspace()
  return {
    preferences: workspace.preferences,
    lessons: sorted(workspace.lessons, 'lessonId'),
    knowledge: sorted(workspace.knowledge, 'ref'),
    studyCards: sorted(workspace.studyCards, 'ref'),
    exerciseSessions: sorted(workspace.exerciseSessions, 'id'),
    exerciseAttempts: sorted(workspace.exerciseAttempts, 'id'),
    due: (await dueCards(Date.now() + 1000)).map(card => card.ref).sort(),
  }
}

/** Every row of every table, for comparing the database before and after. */
export async function allRows(): Promise<Record<string, unknown[]>> {
  const tables: Record<string, unknown[]> = {}
  for (const table of db.tables) tables[table.name] = await table.toArray()
  return tables
}
