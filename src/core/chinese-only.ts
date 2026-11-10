import { workspaceSchema } from './backup-codec'
import { exerciseSessionSchema } from './study/contracts'
import { isLanguageRef } from './language-ref'

// Stable is a Chinese-only build. Records of another language (ja:/ko: refs, ja:lesson:n ids) are carried through every backup, export, restore and
// replay untouched, and never shown, counted or scheduled: the row filters below are for what a screen reads (the view), never for what a file carries.
// Only fields no schema of this build knows (a setting from a newer build, say) are dropped from a file, because the strict schemas refuse them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>

export const isForeignRef = (ref: unknown): boolean => typeof ref === 'string' && isLanguageRef(ref)
export const isForeignLesson = (id: string): boolean => /^(?!zh:)[a-z]{2,3}:/.test(id)
// In the YAML wire form a ref is split into kind and lb, so a ja:w:x ref arrives as kind 'ja'.
const foreignRow = (row: Obj): boolean => isForeignRef(row.ref) || (Array.isArray(row.refs) && row.refs.some(isForeignRef)) || (typeof row.kind === 'string' && /^[a-z]{2,3}$/.test(row.kind))
const strip = <T extends object>(value: T, shape: object): T => {
  const keep = new Set(Object.keys(shape))
  return Object.fromEntries(Object.entries(value).filter(([key]) => keep.has(key))) as T
}

export const chineseRows = <T>(rows: T[]): T[] => rows.filter(row => !foreignRow(row as Obj))
export const chineseLessons = <T>(rows: T[]): T[] => rows.filter(row => !isForeignLesson((row as Obj).lessonId))
// What a screen reads: the settings of the other tracks stay in storage but are not part of this build's workspace.
const TRACK_SETTINGS = ['currentLanguage', 'startedTracks', 'otherLanguageCards', 'japaneseReading']
export const chinesePreferences = <T extends object>(preferences: T): T => Object.fromEntries(Object.entries(strip(preferences, workspaceSchema.shape.preferences.shape)).filter(([key]) => !TRACK_SETTINGS.includes(key))) as T
/** What a file carries: every setting a schema of this build knows, the track settings included. */
export const carriedPreferences = <T extends object>(preferences: T): T => strip(preferences, workspaceSchema.shape.preferences.shape)
export const chineseSettings = <T extends { preferences: object }>(settings: T): T => ({ ...settings, preferences: carriedPreferences(settings.preferences) })
export const chineseSessions = <T>(rows: T[]): T[] =>
  (rows as Obj[]).filter(row => ![...(row.targetRefs ?? []), ...(row.reviewRefs ?? [])].some(isForeignRef)).map(row => strip(row, exerciseSessionSchema.shape)) as T[]
export const isForeignSession = (row: object): boolean => [...((row as Obj).targetRefs ?? []), ...((row as Obj).reviewRefs ?? [])].some(isForeignRef)
export const isForeignEvent = (event: object): boolean => foreignRow(event as Obj)

/** Drops fields this build has no schema for from the settings of a file (the strict schema would refuse the whole file); everything else is carried. */
export function chineseSnapshot<T>(value: T): T {
  const s = value as Obj
  if (typeof s !== 'object' || s === null || typeof s.knowledge !== 'object' || s.knowledge === null) return value
  const study = s.knowledge.study
  return {
    ...s,
    ...(s.settings?.preferences ? { settings: chineseSettings(s.settings) } : {}),
    knowledge: { ...s.knowledge, ...(study && Array.isArray(study.sessions) ? { study: { ...study, sessions: study.sessions.map((row: Obj) => strip(row, exerciseSessionSchema.shape)) } } : {}) },
  } as T
}

/** A main-made JSON backup (version 1-5): the same on its own layout (workspace + study). */
export function chineseBackup(value: unknown): unknown {
  const b = value as Obj
  if (typeof b !== 'object' || b === null || typeof b.workspace !== 'object' || b.workspace === null) return value
  const w = b.workspace
  return { ...b,
    workspace: { ...w, ...(w.preferences ? { preferences: carriedPreferences(w.preferences) } : {}) },
    ...(b.study && Array.isArray(b.study.sessions) ? { study: { ...b.study, sessions: b.study.sessions.map((row: Obj) => strip(row, exerciseSessionSchema.shape)) } } : {}),
  }
}
