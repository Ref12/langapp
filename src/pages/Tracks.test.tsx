import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db, loadWorkspace } from '../core/database'
import { curriculumLessons } from '../data/curriculum'
import { zhTrack, lessonRows, type Track } from '../data/tracks'
import { TrackHeader } from '../components/TrackHeader'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { initializeWorkspace } from '../core/database'
import { lessonDefinitions } from '../data/learning-content'
import { buildLessonPages } from '../core/learning-content'
import { workspaceSchema } from '../core/backup-codec'

const fake: Track = { id: 'xx', language: 'xx', name: 'Fakish', glyph: 'X', levels: [], lessons: [] }

beforeEach(async () => { window.location.hash = '#curriculum'; await db.delete(); await db.open() })
afterEach(cleanup)

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

describe('tracks', () => {
  it('shows the Chinese track as plain text and lists lessons by status', async () => {
    await db.lessons.add({ lessonId: curriculumLessons[0].id, startedAt: 1, completedAt: Date.UTC(2026, 0, 5) })
    render(<App />)
    const header = await screen.findByTestId('track-header')
    expect(header).toHaveTextContent('Chinese')
    expect(within(header).queryByRole('combobox')).toBeNull()
    const list = screen.getByRole('region', { name: 'Chinese lessons' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveClass('done')
    expect(rows[1]).toHaveClass('current')
    expect(rows[2]).toHaveClass('upcoming')
    expect(rows[0]).toHaveTextContent('2026'.slice(2))
  })

  it('opens an upcoming lesson but cannot start practice from it', async () => {
    render(<App />)
    await screen.findByTestId('track-header')
    const id = curriculumLessons[3].id
    const def = lessonDefinitions.get(id)
    await go(def ? `lesson/${id}/${buildLessonPages(def).findIndex(page => page.kind === 'practice') + 1}` : `lesson/${id}`)
    const button = await screen.findByRole('button', { name: /Practice unlocks/ })
    expect(button).toBeDisabled()
    expect(await db.sessions.count()).toBe(0)
  })

  it('marks lock-free lessons startable when the lock is off', () => {
    const rows = lessonRows(zhTrack, [], curriculumLessons[0].id, false)
    expect(rows.every(row => !row.locked)).toBe(true)
    expect(lessonRows(zhTrack, [], curriculumLessons[0].id, true)[1].locked).toBe(true)
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
