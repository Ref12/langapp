import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { workspaceSchema } from '../core/backup-codec'
import { loadParallel, loadedParallel, resetParallel, cardLineFor, parallelLessonId } from '../core/parallel/data'
import { markParallelStudied, nextParallelLesson, studiedLessons } from '../core/parallel/progress'
import { startedTracks } from '../data/tracks'
import { OtherLanguageSetting } from '../components/study/other-language-setting'
import { UnitCard } from '../components/study/UnitCard'
import { loadCatalog } from '../core/study/catalog'
import { TrackHeader } from '../components/TrackHeader'
import { jaTrack, koTrack, zhTrack } from '../data/tracks'

beforeEach(async () => { window.location.hash = '#lessons'; resetParallel(); await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(cleanup)

const noop = async (operation: () => Promise<void>) => { await operation() }

describe('parallel tracks', () => {
  it('loads lazily: nothing is loaded until a track or a cards line asks', async () => {
    expect(loadedParallel('ja')).toBe(false)
    const data = await loadParallel('ja')
    expect(loadedParallel('ja')).toBe(true)
    expect(loadedParallel('ko')).toBe(false)
    expect(data.lessons).toHaveLength(87)
  })

  it('lists started tracks first in the picker', async () => {
    const user = userEvent.setup()
    render(<TrackHeader tracks={[zhTrack, jaTrack, koTrack]} current={zhTrack} started={track => track.id === 'ko'} onSelect={() => undefined} />)
    const select = screen.getByRole('combobox', { name: 'Course track' })
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Chinese', 'Korean', 'More tracks…'])
    await user.click(select)
    expect(startedTracks({ startedTracks: ['ko'] }).map(track => track.id)).toEqual(['zh', 'ko'])
    expect(startedTracks({}).map(track => track.id)).toEqual(['zh'])
  })

  it('selecting Japanese in the picker starts it, shows the switch and 87 rows with item titles', async () => {
    const user = userEvent.setup()
    window.location.hash = '#lessons/list'
    render(<App />)
    const select = await screen.findByRole('combobox', { name: 'Course track' })
    expect(screen.queryByRole('group', { name: 'Current language' })).toBeNull()
    await user.selectOptions(select, 'More tracks…')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Course track' }), 'Japanese')
    const list = await screen.findByRole('region', { name: 'Japanese lessons' }, { timeout: 5000 })
    expect(within(list).getAllByRole('listitem')).toHaveLength(87)
    expect(within(list).getByText('HSK 1 · with Chinese')).toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('学生')
    expect(within(list).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('group', { name: 'Current language' })).toBeInTheDocument()
    expect((await loadWorkspace()).preferences).toMatchObject({ currentLanguage: 'ja', startedTracks: ['ja'] })
  })

  it('renders the lesson view: words, readings, phrases and the Chinese line; Mark as studied moves Next', async () => {
    const user = userEvent.setup()
    window.location.hash = '#lessons/ja/1'
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Words' }, { timeout: 5000 })).toHaveTextContent('勉強する')
    // every word the lesson introduces, including those matched to JLPT entries (私, 学生), not only parallel-authored ones
    for (const word of ['私', '学生']) expect(screen.getByRole('region', { name: 'Words' })).toHaveTextContent(word)
    expect(screen.getByRole('region', { name: 'Words' }).querySelector('rt')).not.toBeNull()
    const phrases = screen.getByRole('region', { name: 'Phrases' })
    expect(phrases.querySelector('rt')).not.toBeNull()
    // readings sit in the pinyin slot (romaji by default), not as a separate kana line
    expect(phrases.querySelector('.example')).toHaveTextContent('watashi')
    expect(phrases.textContent).toContain('benkyoushi')
    expect(phrases.textContent).not.toContain('わたしはがくせいです。')
    expect(phrases).toHaveTextContent('I am a student.')
    expect(phrases).toHaveTextContent('中 我是学生。')
    expect(screen.getByRole('region', { name: 'Grammar' })).toHaveTextContent('Nはtopic; as for a noun')
    await waitFor(async () => expect((await loadWorkspace()).preferences.currentLanguage).toBe('ja'))
    await user.click(screen.getByRole('button', { name: 'Mark as studied' }))
    await waitFor(async () => expect((await db.lessons.get(parallelLessonId('ja', 1)))?.completedAt).toBeTypeOf('number'))
    const studied = studiedLessons((await loadWorkspace()).lessons, 'ja')
    expect(nextParallelLesson(studied, 87)).toBe(2)
    expect(await db.lessons.get('ko:lesson:1')).toBeUndefined()
    window.location.hash = '#lessons/list'
    const list = await screen.findByRole('region', { name: 'Japanese lessons' }, { timeout: 5000 })
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Done')
    expect(within(list).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step')
  })

  it('a Korean lesson view renders and studies under its own prefix', async () => {
    window.location.hash = '#lessons/ko/1'
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Phrases' }, { timeout: 5000 })).toHaveTextContent('haksaengieyo')
    await markParallelStudied('ko', 1)
    expect(await db.lessons.get('ko:lesson:1')).toBeDefined()
    expect(await db.lessons.get('ja:lesson:1')).toBeUndefined()
  })
})

describe('other languages on cards', () => {
  async function card(setting: string | undefined, kind: 'vocabulary' | 'grammar', otherLines = true) {
    const catalog = await loadCatalog()
    const unit = [...catalog.units.values()].find(item => item.kind === kind && (item.kind === 'grammar' || ('ch' in item.record && item.record.ch === '学生')))!
    render(<OtherLanguageSetting.Provider value={setting}><UnitCard catalog={catalog} unit={unit} pinyin={false} run={noop} busy={false} route="x" otherLines={otherLines} /></OtherLanguageSetting.Provider>)
    return unit
  }

  it('shows one muted line per language on a Chinese word card, linking to the lesson', async () => {
    await card('both', 'vocabulary')
    const line = await screen.findByTestId('other-languages', undefined, { timeout: 5000 })
    expect(line).toHaveTextContent('日 学生 がくせい')
    expect(line).toHaveTextContent('한 학생')
    expect(line.querySelector('a')).toHaveAttribute('href', '#lessons/ja/1')
  })

  it('shows only the chosen language', async () => {
    await card('ko', 'vocabulary')
    const line = await screen.findByTestId('other-languages', undefined, { timeout: 5000 })
    expect(line).toHaveTextContent('한 학생')
    expect(line).not.toHaveTextContent('日')
  })

  it('is hidden when Off, on grammar cards, and where a question is open (no otherLines)', async () => {
    await card(undefined, 'vocabulary'); await card('off', 'vocabulary'); await card('both', 'grammar'); await card('both', 'vocabulary', false)
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(screen.queryByTestId('other-languages')).toBeNull()
    expect(loadedParallel('ja')).toBe(false)
  })

  it('maps covered-by senses too', async () => {
    const data = await loadParallel('ko')
    const sense = data.lessons.flatMap(lesson => lesson.senses).find(item => item.status === 'covered-by')!
    expect(cardLineFor(data, sense.zh)?.target).toBeTruthy()
  })
})

describe('revert safety', () => {
  it('a profile with ja/ko progress and the new settings keeps Chinese data when the keys are ignored', async () => {
    await db.preferences.update('workspace', { currentLanguage: 'ja', startedTracks: ['ja', 'ko'], otherLanguageCards: 'both' })
    await markParallelStudied('ja', 3)
    const workspace = await loadWorkspace()
    expect(workspaceSchema.shape.preferences.safeParse(workspace.preferences).success).toBe(true)
    expect(workspaceSchema.shape.lessons.safeParse(workspace.lessons).success).toBe(true)
    // An older build knows none of these keys: it strips them and still reads everything else.
    const { currentLanguage, startedTracks: started, otherLanguageCards, ...old } = workspace.preferences
    void currentLanguage; void started; void otherLanguageCards
    expect(workspaceSchema.shape.preferences.safeParse(old).success).toBe(true)
    expect(old).toMatchObject({ name: workspace.preferences.name, theme: workspace.preferences.theme, pinyin: workspace.preferences.pinyin })
    const chinese = workspace.lessons.filter(lesson => !/^(ja|ko):/.test(lesson.lessonId))
    expect(chinese).toEqual([])
    expect(workspace.lessons.map(lesson => lesson.lessonId)).toEqual(['ja:lesson:3'])
    expect(workspace.knowledge).toEqual([])
  })

  it('Chinese screens are unchanged with the setting Off: no extra line, no parallel data loaded', async () => {
    window.location.hash = '#lessons/list'
    render(<App />)
    await screen.findByRole('region', { name: 'Chinese lessons' }, { timeout: 5000 })
    expect(screen.queryByTestId('other-languages')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Current language' })).toBeNull()
    expect(loadedParallel('ja')).toBe(false)
  })

  it('the Japanese New panel previews the next lesson with readings in the pinyin slot and Start opens it', async () => {
    const { savePreferences } = await import('../core/learning')
    await savePreferences({ currentLanguage: 'ja', startedTracks: ['ja'] })
    window.location.hash = '#lessons'
    render(<App />)
    const panel = await screen.findByRole('region', { name: 'New items' }, { timeout: 5000 })
    await waitFor(() => expect(panel.querySelector('.study-preview li')).not.toBeNull())
    expect(panel.querySelector('ruby.mandarin-word rt')).not.toBeNull()
    expect(within(panel).getByRole('link', { name: 'Start new Japanese items' })).toHaveAttribute('href', '#lessons/ja/1')
  })

  it('Practice offers the Japanese curriculum with New items, Reviews, View items and Start', async () => {
    const { savePreferences } = await import('../core/learning')
    await savePreferences({ currentLanguage: 'ja', startedTracks: ['ja'] })
    window.location.hash = '#practice'
    const user = userEvent.setup()
    render(<App />)
    const panel = await screen.findByRole('region', { name: /Practise/ }, { timeout: 5000 })
    expect(within(panel).getByRole('link', { name: 'Start Japanese practice' })).toHaveAttribute('href', '#lessons/ja/1/practise')
    await user.click(within(panel).getByRole('button', { name: 'View items' }))
    expect(await screen.findByLabelText('Items you will practise')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close items' }))
    await user.click(within(panel).getByRole('button', { name: 'Reviews' }))
    expect(within(panel).getByRole('status')).toHaveTextContent('Nothing is due')
  })

  it('a lesson word has the Chinese menu: Practise, Ask, Hear and Write, naming the language', async () => {
    window.location.hash = '#lessons/ko/1'
    const user = userEvent.setup()
    render(<App />)
    const words = await screen.findByRole('region', { name: 'Words' }, { timeout: 5000 })
    await user.click(within(words).getAllByRole('button', { name: 'Phrase actions' })[0])
    expect(await screen.findByRole('button', { name: 'Practise' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(async () => expect((await db.assistantThreads.toArray())[0]?.draft).toContain('Please explain this Korean passage'))
  })
})
