import { useMemo } from 'react'
import { formRows } from '../../core/forms/display'
import { getPack } from '../../core/language'
import type { Catalog } from '../../core/study/catalog'
import type { VocabularyRecord } from '../../core/study/catalog'
import { unitRef } from '../../core/study/contracts'
import { ReadingText } from '../display-context'
import { usePackFormsTable } from '../display-settings'

/** The lesson that teaches a grammar unit: the first group that lists it, numbered within its band. */
function lessonOf(catalog: Catalog, label: string): { id: string; number: number } | undefined {
  const ref = unitRef('grammar', label)
  const counts = new Map<string, number>()
  for (const { band, group } of catalog.orderedGroups) {
    const number = (counts.get(band) ?? 0) + 1
    counts.set(band, number)
    if (group.units.some(unit => unit.kind === 'grammar' && unitRef('grammar', unit.ref) === ref)) return { id: group.id, number }
  }
  return undefined
}

/** The forms of a word, collapsed under "Forms" on its card: one dense row per form the forms table has for the word, with the lesson that teaches it. Nothing when the pack has no forms table or the word no forms. */
export function WordForms({ catalog, record, reading }: { catalog: Catalog; record: VocabularyRecord; reading: boolean }) {
  const offer = getPack().displayForms
  const table = usePackFormsTable()
  const rows = useMemo(() => formRows(offer, table, record), [offer, table, record])
  const lessons = useMemo(() => new Map(rows.flatMap(row => row.pattern ? [[row.pattern, lessonOf(catalog, row.pattern)] as const] : [])), [rows, catalog])
  if (!rows.length) return null
  return <details className="word-forms" data-assistant-exclude>
    <summary>Forms</summary>
    <table className="forms-table">
      <thead><tr><th scope="col">Form</th><th scope="col">Word</th>{reading && <th scope="col">Reading</th>}<th scope="col">Lesson</th></tr></thead>
      <tbody>{rows.map(row => {
        const lesson = row.pattern ? lessons.get(row.pattern) : undefined
        return <tr key={row.id}>
          <th scope="row">{row.name}</th>
          <td lang={getPack().learningTag}>{row.text}</td>
          {reading && <td className="muted"><ReadingText kana={row.reading} /></td>}
          <td>{lesson ? <a href={`#lessons/group/${lesson.id}`}>Lesson {lesson.number}</a> : null}</td>
        </tr>
      })}</tbody>
    </table>
  </details>
}
