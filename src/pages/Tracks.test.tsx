import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db, loadWorkspace } from '../core/database'
import { curriculumLessons } from '../data/curriculum'
import profileLabels from '../data/v2/profile-word-labels.generated.json'
import { unitRef } from '../core/study/contracts'
import { loadCatalog } from '../core/study/catalog'
import { reachableRefs, refOf, unreachableLessonItems } from '../components/useLessonRows'
import { zhTrack, lessonRows, type Track } from '../data/tracks'
import { TrackHeader } from '../components/TrackHeader'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { initializeWorkspace } from '../core/database'
import { lessonDefinitions } from '../data/learning-content'
import { buildLessonPages } from '../core/learning-content'
import { workspaceSchema } from '../core/backup-codec'

const labelOf = new Map(profileLabels.map(entry => [entry.id, entry.lb]))
const fake: Track = { id: 'xx', language: 'xx', name: 'Fakish', glyph: 'X', levels: [], lessons: [] }

beforeEach(async () => { window.location.hash = '#lessons'; await db.delete(); await db.open() })
afterEach(cleanup)

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

describe('tracks', () => {
  it('renders the track header and lessons list on the Lessons page (#lessons)', async () => {
    window.location.hash = '#lessons'
    render(<App />)
    expect(await screen.findByTestId('track-header')).toHaveTextContent('Chinese')
    const list = await screen.findByRole('region', { name: 'Chinese lessons' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveClass('current')
    window.location.hash = '#curriculum'
    await go('curriculum')
    expect(screen.queryByRole('region', { name: 'Chinese lessons' })).toBeNull()
  })

  it('takes status from the items New items sets introduced, not from lesson pages', async () => {
    const first = curriculumLessons[0]
    const refs = first.wordIds.map(id => labelOf.get(id)).map(lb => unitRef('vocabulary', lb!))
    await initializeWorkspace()
    await db.knowledge.bulkAdd(refs.map(ref => ({ ref, kind: 'vocabulary' as const, lb: ref.slice(11), band: '1' as const, addedAt: Date.UTC(2026, 0, 5), source: 'new' as const })))
    expect(await db.lessons.count()).toBe(0)
    window.location.hash = '#lessons'
    render(<App />)
    const list = await screen.findByRole('region', { name: 'Chinese lessons' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveClass('done'))
    const rows = within(list).getAllByRole('listitem')
    expect(rows.filter(row => row.classList.contains('current'))).toHaveLength(1)
    // The next New items set is the first study group with unknown items; the lesson holding one of them is "Next".
    const studyLesson = curriculumLessons.findIndex(lesson => lesson.wordIds.some(id => labelOf.get(id) === 'xue2-xi2--study'))
    expect(rows[studyLesson]).toHaveClass('current')
    expect(rows[0]).toHaveTextContent('26')
  })

  it('shows n/m for a partly introduced lesson, not muted, and keeps later lessons independent', async () => {
    const lesson = curriculumLessons[1]
    const refs = lesson.wordIds.slice(0, 2).map(id => unitRef('vocabulary', labelOf.get(id)!))
    await initializeWorkspace()
    await db.knowledge.bulkAdd(refs.map(ref => ({ ref, kind: 'vocabulary' as const, lb: ref.slice(11), band: '1' as const, addedAt: Date.UTC(2026, 0, 5), source: 'new' as const })))
    window.location.hash = '#lessons'
    render(<App />)
    const list = await screen.findByRole('region', { name: 'Chinese lessons' })
    const row = (await within(list).findAllByRole('listitem'))[1]
    await waitFor(() => expect(row).toHaveClass('partial'))
    expect(row).toHaveTextContent(`2/${lesson.wordIds.length}`)
    expect(row).not.toHaveClass('upcoming')
  })

  it('is Done once every reachable item is known; a lesson with none reachable shows a dash and is never Next', async () => {
    const reachable = new Set(['a', 'b'])
    const lessons = [
      { ...curriculumLessons[0], id: 'l1', wordIds: ['w1', 'w2', 'wx'] },
      { ...curriculumLessons[0], id: 'l2', wordIds: ['wx'] },
      { ...curriculumLessons[0], id: 'l3', wordIds: ['w3'] },
    ]
    const track: Track = { ...fake, lessons }
    const refs: Record<string, string> = { w1: 'a', w2: 'b', wx: 'zzz', w3: 'c' }
    const run = (known: string[]) => lessonRows(track, { known: new Map(known.map(ref => [ref, 1])), nextNew: new Set(), refOf: id => refs[id], reachable: new Set([...reachable, 'c']), records: [] })
    let rows = run(['a'])
    expect(rows.map(row => row.status)).toEqual(['current', 'none', 'upcoming'])
    expect([rows[0].introduced, rows[0].total]).toEqual([1, 2])
    rows = run(['a', 'b'])
    expect(rows.map(row => row.status)).toEqual(['done', 'none', 'current'])
  })

  it('pins the 26 lesson items in levels 1-4 that no New items set can introduce', async () => {
    const found = unreachableLessonItems(zhTrack, await loadCatalog())
    expect(found.reduce((total, lesson) => total + lesson.wordIds.length, 0)).toBe(26)
    expect(found.map(lesson => lesson.number)).toEqual([1, 11, 12, 14, 15, 17, 18, 22, 26, 28, 29, 32, 34, 37, 38, 39, 40, 41, 47].sort((a, b) => a - b).concat([]).filter((n, i, all) => all.indexOf(n) === i))
    expect(refOf(zhTrack.lessons[0].wordIds[0])).toBeDefined()
    expect(reachableRefs(await loadCatalog()).size).toBeGreaterThan(1000)
  })

  it('has no lock: an upcoming lesson opens and starts practice like any other', async () => {
    render(<App />)
    const id = curriculumLessons[3].id
    const def = lessonDefinitions.get(id)
    await go(def ? `lesson/${id}/${buildLessonPages(def).findIndex(page => page.kind === 'practice') + 1}` : `lesson/${id}`)
    const button = await screen.findByRole('button', { name: /Start lesson practice/ })
    expect(button).toBeEnabled()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('tells repeated titles apart', () => {
    const rows = lessonRows(zhTrack, { known: new Map(), nextNew: new Set(), refOf: () => undefined, records: [] })
    const labels = rows.map(row => `${row.label}|${row.part ?? ''}`)
    expect(new Set(labels).size).toBe(labels.length)
    expect(rows.filter(row => row.label === 'Colors and describing objects').map(row => row.part)).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5'])
  })

  it('becomes a picker with a second track, started tracks first', async () => {
    const user = userEvent.setup()
    const picked: string[] = []
    render(<TrackHeader tracks={[zhTrack, fake]} current={zhTrack} onSelect={track => picked.push(track.id)} />)
    const select = screen.getByRole('combobox', { name: 'Course track' })
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Chinese', 'More tracks…'])
    await user.selectOptions(select, 'More tracks…')
    expect(picked).toEqual([])
  })

  it('hides the language switch with one language and shows it with two', () => {
    const view = render(<LanguageSwitch tracks={[zhTrack]} current="zh" onChange={() => undefined} />)
    expect(view.container).toBeEmptyDOMElement()
    view.rerender(<LanguageSwitch tracks={[zhTrack, fake]} current="zh" onChange={() => undefined} />)
    expect(screen.getByRole('group', { name: 'Current language' })).toBeInTheDocument()
  })

  it('labels the Practice source from the track language', async () => {
    window.location.hash = '#practice'
    render(<App />)
    const select = await screen.findByRole('combobox', { name: 'Learning from' })
    expect(within(select).getByRole('option', { name: 'Chinese curriculum' })).toBeInTheDocument()
  })

  it('loads a profile that carries the new key, and a default profile never writes it', async () => {
    await initializeWorkspace()
    expect((await loadWorkspace()).preferences).not.toHaveProperty('currentLanguage')
    await db.preferences.update('workspace', { currentLanguage: 'zh' })
    const workspace = await loadWorkspace()
    expect(workspace.preferences.currentLanguage).toBe('zh')
    expect(workspaceSchema.shape.preferences.safeParse(workspace.preferences).success).toBe(true)
    const { currentLanguage, ...old } = workspace.preferences
    void currentLanguage
    expect(workspaceSchema.shape.preferences.safeParse(old).success).toBe(true)
  })
})
