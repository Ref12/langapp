import { workspaceSchema } from './backup-codec'
import { exerciseSessionSchema } from './study/contracts'

// Stable is a Chinese-only build. Records of another language (ja:/ko: refs, ja:lesson:n ids, settings and fields it has no schema for)
// are never interpreted, never fail a read or a restore, and are never deleted: these helpers only filter what is read, before the strict parse.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>

export const isForeignRef = (ref: unknown): boolean => typeof ref === 'string' && /^[a-z]{2,3}:/.test(ref)
export const isForeignLesson = (id: string): boolean => /^(?!zh:)[a-z]{2,3}:/.test(id)
// In the YAML wire form a ref is split into kind and lb, so a ja:w:x ref arrives as kind 'ja'.
const foreignRow = (row: Obj): boolean => isForeignRef(row.ref) || (Array.isArray(row.refs) && row.refs.some(isForeignRef)) || (typeof row.kind === 'string' && /^[a-z]{2,3}$/.test(row.kind))
const strip = <T extends object>(value: T, shape: object): T => {
  const keep = new Set(Object.keys(shape))
  return Object.fromEntries(Object.entries(value).filter(([key]) => keep.has(key))) as T
}

export const chineseRows = <T>(rows: T[]): T[] => rows.filter(row => !foreignRow(row as Obj))
export const chineseLessons = <T>(rows: T[]): T[] => rows.filter(row => !isForeignLesson((row as Obj).lessonId))
export const chinesePreferences = <T extends object>(preferences: T): T => strip(preferences, workspaceSchema.shape.preferences.shape)
export const chineseSettings = <T extends { preferences: object }>(settings: T): T => ({ ...settings, preferences: chinesePreferences(settings.preferences) })
export const chineseSessions = <T>(rows: T[]): T[] =>
  (rows as Obj[]).filter(row => ![...(row.targetRefs ?? []), ...(row.reviewRefs ?? [])].some(isForeignRef)).map(row => strip(row, exerciseSessionSchema.shape)) as T[]
/** A conversation or message about Japanese or Korean text carries source.language: a field Stable does not know. */
export const chineseSources = <T>(rows: T[]): T[] =>
  (rows as Obj[]).map(row => row.source && 'language' in row.source ? { ...row, source: strip(row.source, { text: 1, title: 1, route: 1, meaning: 1, locale: 1 }) } : row) as T[]
export const isForeignSession = (row: object): boolean => [...((row as Obj).targetRefs ?? []), ...((row as Obj).reviewRefs ?? [])].some(isForeignRef)
export const isForeignEvent = (event: object): boolean => foreignRow(event as Obj)

/** Works on a snapshot or on the parsed YAML of one (labels instead of refs); anything that is not a profile is returned as it is. */
export function chineseSnapshot<T>(value: T): T {
  const s = value as Obj
  if (typeof s !== 'object' || s === null || typeof s.knowledge !== 'object' || s.knowledge === null) return value
  const study = s.knowledge.study
  return {
    ...s,
    ...(s.settings?.preferences ? { settings: chineseSettings(s.settings) } : {}),
    knowledge: {
      ...s.knowledge,
      ...(Array.isArray(s.knowledge.lessons) ? { lessons: chineseLessons(s.knowledge.lessons) } : {}),
      ...(study ? { study: { ...study,
        ...(Array.isArray(study.knowledge) ? { knowledge: chineseRows(study.knowledge) } : {}),
        ...(Array.isArray(study.cards) ? { cards: chineseRows(study.cards) } : {}),
        ...(Array.isArray(study.sessions) ? { sessions: chineseSessions(study.sessions) } : {}) } } : {}),
    },
    ...(s.conversations ? { conversations: { ...s.conversations,
      ...(Array.isArray(s.conversations.threads) ? { threads: chineseSources(s.conversations.threads) } : {}),
      ...(Array.isArray(s.conversations.messages) ? { messages: chineseSources(s.conversations.messages) } : {}) } } : {}),
    ...(s.collections ? { collections: { ...s.collections,
      ...(Array.isArray(s.collections.items) ? { items: chineseRows(s.collections.items) } : {}),
      ...(Array.isArray(s.collections.cards) ? { cards: chineseRows(s.collections.cards) } : {}) } } : {}),
  } as T
}

/** A main-made JSON backup (version 1-5): same filtering on its own layout (workspace + study + assistant). */
export function chineseBackup(value: unknown): unknown {
  const b = value as Obj
  if (typeof b !== 'object' || b === null || typeof b.workspace !== 'object' || b.workspace === null) return value
  const w = b.workspace
  return { ...b,
    workspace: { ...w, ...(w.preferences ? { preferences: chinesePreferences(w.preferences) } : {}), ...(Array.isArray(w.lessons) ? { lessons: chineseLessons(w.lessons) } : {}) },
    ...(b.study ? { study: { ...b.study, ...(Array.isArray(b.study.knowledge) ? { knowledge: chineseRows(b.study.knowledge) } : {}), ...(Array.isArray(b.study.cards) ? { cards: chineseRows(b.study.cards) } : {}), ...(Array.isArray(b.study.sessions) ? { sessions: chineseSessions(b.study.sessions) } : {}) } } : {}),
    ...(b.assistant ? { assistant: { ...b.assistant, ...(Array.isArray(b.assistant.threads) ? { threads: chineseSources(b.assistant.threads) } : {}), ...(Array.isArray(b.assistant.messages) ? { messages: chineseSources(b.assistant.messages) } : {}) } } : {}),
  }
}
