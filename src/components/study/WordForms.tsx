import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { nextGroup } from '../../core/study/knowledge'
import { formRows } from '../../core/forms/display'
import { getPack } from '../../core/language'
import type { Catalog } from '../../core/study/catalog'
import type { VocabularyRecord } from '../../core/study/catalog'
import { unitRef } from '../../core/study/contracts'
import { ReadingText } from '../display-context'
import { usePackFormsTable } from '../display-settings'

/** The lesson that teaches a unit: the first group that lists it, numbered within its band, and its place (index) among all lessons. */
function lessonOf(catalog: Catalog, kind: 'grammar' | 'vocabulary', label: string): { id: string; number: number; index: number } | undefined {
  const ref = unitRef(kind, label)
  const counts = new Map<string, number>()
  let index = 0
  for (const { band, group } of catalog.orderedGroups) {
    const number = (counts.get(band) ?? 0) + 1
    counts.set(band, number)
    if (group.units.some(unit => unit.kind === kind && unitRef(kind, unit.ref) === ref)) return { id: group.id, number, index }
    index++
  }
  return undefined
}

/** The forms of a word, collapsed under "Forms" on its card: one dense row per form the forms table has for the word, with the lesson that teaches it. Nothing when the pack has no forms table or the word no forms. */
export function WordForms({ catalog, record, reading }: { catalog: Catalog; record: VocabularyRecord; reading: boolean }) {
  const offer = getPack().displayForms
  const table = usePackFormsTable()
  const rows = useMemo(() => formRows(offer, table, record), [offer, table, record])
  const lessons = useMemo(() => new Map(rows.flatMap(row => row.pattern ? [[row.pattern, lessonOf(catalog, 'grammar', row.pattern)] as const] : [])), [rows, catalog])
  // The dictionary form comes with the word itself: the lesson that introduces it.
  const wordLesson = useMemo(() => lessonOf(catalog, 'vocabulary', record.lb), [catalog, record.lb])
  const knownRefs = useLiveQuery(async () => new Set((await db.knowledge.toArray()).map(entry => entry.ref)), [])
  // The learner's current lesson: the next one with something new in it (the first, with nothing known yet); every lesson when all are done.
  const current = useMemo(() => {
    const next = nextGroup(catalog, knownRefs ?? new Set())
    return next ? catalog.orderedGroups.findIndex(item => item.group === next.group) : Infinity
  }, [catalog, knownRefs])
  if (!rows.length) return null
  return <details className="word-forms" data-assistant-exclude>
    <summary>Forms</summary>
    <div className="forms-scroll"><table className="forms-table">
      <thead><tr><th scope="col">Form</th><th scope="col">{reading ? 'Word and reading' : 'Word'}</th><th scope="col">Lesson</th></tr></thead>
      <tbody>{rows.map(row => {
        const lesson = row.pattern ? lessons.get(row.pattern) : row.id === 'dict' ? wordLesson : undefined
        const later = lesson ? lesson.index > current : false
        return <tr key={row.id} className={later ? 'forms-later' : undefined} data-reached={lesson ? String(!later) : undefined}>
          <th scope="row">{row.name}</th>
          <td><span lang={getPack().learningTag}>{row.text}</span>{reading && <span className="muted forms-reading"><ReadingText kana={row.reading} parts={row.parts} /></span>}</td>
          <td>{lesson ? <><a href={`#lessons/group/${lesson.id}`}>Lesson {lesson.number}</a>{later && <span className="forms-later-tag"> · later</span>}</> : <span title="No lesson teaches this form on its own">{'\u2014'}</span>}</td>
        </tr>
      })}</tbody>
    </table></div>
    <p className="small muted forms-note">Greyed rows are taught in a later lesson than the one you are on. {'\u2014'} means no lesson teaches that form on its own.</p>
  </details>
}
