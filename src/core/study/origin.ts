import type { Catalog } from './catalog'
import type { ExerciseSession } from './contracts'
import type { Collection } from '../collections/contracts'
import { TERM } from '../collections/terms'

// Where an unfinished lesson came from: the curriculum path, a collection (including a "learn from this span" show collection) or a redo.

export type SessionOrigin =
  | { kind: 'new' | 'review' }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'lines' }
  | { kind: 'redo' }

export const originOf = (session: ExerciseSession): SessionOrigin =>
  session.redoOf ? { kind: 'redo' } : session.collectionId ? { kind: 'collection', collectionId: session.collectionId } : session.lines ? { kind: 'lines' } : { kind: session.mode }

/** One key per origin; a collection has one per mode. */
export const originKey = (session: ExerciseSession): string =>
  session.redoOf ? 'redo' : session.collectionId ? `collection:${session.collectionId}:${session.mode}` : session.lines ? 'lines' : session.mode

const day = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export interface ResumeRow { session: ExerciseSession; origin: SessionOrigin; title: string; items: string; started: string }

const SHOWN_ITEMS = 6

/** The items' Chinese forms on one line: the first few, then +N. */
export function itemsLine(catalog: Catalog | undefined, refs: string[], phraseText: (ref: string) => string | undefined = () => undefined): string {
  const forms = refs.map(ref => { const unit = catalog?.units.get(ref); return unit ? (unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt) : phraseText(ref) ?? '' }).filter(Boolean)
  return forms.slice(0, SHOWN_ITEMS).join(' ') + (forms.length > SHOWN_ITEMS ? ` +${forms.length - SHOWN_ITEMS}` : '')
}

export function describeSession(session: ExerciseSession, all: ExerciseSession[], collections: Collection[], catalog?: Catalog): ResumeRow {
  const origin = originOf(session)
  let title: string
  if (origin.kind === 'redo') {
    const original = all.find(item => item.id === session.redoOf)
    title = `Redo: lesson of ${day((original ?? session).createdAt)}`
  } else if (origin.kind === 'collection') {
    const collection = collections.find(item => item.id === origin.collectionId)
    title = `${collection?.name ?? TERM.Singular} · ${session.mode === 'new' ? 'New' : 'Review'}`
  } else if (origin.kind === 'lines') title = 'Lines from media'
  else title = session.mode === 'new' ? 'New items' : 'Review'
  return { session, origin, title, items: itemsLine(catalog, session.targetRefs), started: day(session.createdAt) }
}

const rank = (origin: SessionOrigin) => origin.kind === 'new' ? 0 : origin.kind === 'review' ? 1 : origin.kind === 'collection' || origin.kind === 'lines' ? 2 : 3

/** Unfinished sessions, curriculum first, then collections, then the redo; newest first within each. Every session is kept. */
export function resumeRows(sessions: ExerciseSession[], collections: Collection[], catalog?: Catalog): ResumeRow[] {
  return sessions.filter(session => session.status === 'active').map(session => describeSession(session, sessions, collections, catalog))
    .sort((a, b) => rank(a.origin) - rank(b.origin) || b.session.createdAt - a.session.createdAt)
}
