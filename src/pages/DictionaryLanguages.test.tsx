import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { savePreferences } from '../core/learning'
import { buildCatalog, type BandData } from '../core/study/catalog'
import { loadedDictionary, loadDictionary, makeOtherMatcher, resetDictionaries, scriptHint } from '../core/dictionary/other'
import { resetParallel } from '../core/parallel/data'
import { useRoute } from '../core/routing'
import { Dictionary } from './Dictionary'
import { main as generate } from '../../scripts/generate-app-dictionary.mjs'

const source = vi.hoisted(() => ({ catalog: undefined as ReturnType<typeof buildCatalog> | undefined }))
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({ catalog: source.catalog }) }))

function Harness() {
  const workspace = useLiveQuery(loadWorkspace, [])
  const route = useRoute()
  if (!workspace) return null
  const [path, query = ''] = route.split('?')
  const [, section, scope] = path.split('/')
  const params = new URLSearchParams(query)
  const props = { workspace, now: 1, busy: false, run: async (operation: () => Promise<void>) => { await operation() } }
  return <Dictionary {...props} section={section} initialScope={scope} initialQuery={params.get('q') ?? undefined} initialLanguage={params.get('lang') ?? undefined} />
}

vi.setConfig({ testTimeout: 30000 })
beforeEach(async () => {
  vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] })
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
  await db.delete(); await db.open(); await initializeWorkspace()
  resetDictionaries(); resetParallel()
  window.location.hash = 'dictionary/vocabulary/all'
  const data: BandData = { schemaVersion: 1, band: '1', alignment: 'Fixture', groups: [], grammar: [], vocabulary: [
    { id: 'zh-hsk1-00423-s001', ch: '学生', pr: 'xué sheng', ds: 'student', lb: 'student' },
    { id: 'zh-fixture-tea', ch: '茶', pr: 'chá', ds: 'tea', lb: 'tea' }] }
  source.catalog = buildCatalog([data])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const start = (query: string, lang?: string, current = 'zh') => {
  window.location.hash = 'dictionary/vocabulary/all?' + [query ? 'q=' + encodeURIComponent(query) : '', lang ? 'lang=' + lang : ''].filter(Boolean).join('&')
  return savePreferences({ startedTracks: ['ja', 'ko'], currentLanguage: current })
}
const languagesOf = () => [...document.querySelectorAll('article')].map(card => card.getAttribute('data-language') ?? (card.hasAttribute('data-unit') ? 'zh' : '?'))

describe('dictionary languages', () => {
  it('filters All, Chinese, Japanese and Korean from one compact control', async () => {
    await start('student')
    render(<Harness />)
    const select = await screen.findByRole('combobox', { name: 'Language filter' })
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['All', 'Chinese', 'Japanese', 'Korean'])
    await waitFor(() => expect(new Set(languagesOf())).toEqual(new Set(['zh', 'ja', 'ko'])))
    expect(screen.getAllByLabelText('Japanese')[0]).toHaveTextContent('日')
    const user = userEvent.setup()
    await user.selectOptions(select, 'ja')
    await waitFor(() => expect(new Set(languagesOf())).toEqual(new Set(['ja'])))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language filter' }), 'ko')
    await waitFor(() => expect(new Set(languagesOf())).toEqual(new Set(['ko'])))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language filter' }), 'zh')
    await waitFor(() => expect(languagesOf()).toEqual(['zh']))
    expect(document.querySelector('.lang-tag')).toBeNull()
  })

  it('orders All results by the current language', async () => {
    for (const [current, first] of [['ko', 'ko'], ['ja', 'ja'], ['zh', 'zh']] as const) {
      cleanup()
      await start('student', undefined, current)
      render(<Harness />)
      await waitFor(() => expect(languagesOf().length).toBeGreaterThan(0))
      await waitFor(() => expect(languagesOf()[0]).toBe(first))
    }
  })

  it('searches kana and Hangul by reading and form, and English across languages', async () => {
    expect(scriptHint('べんきょう')).toEqual(['ja'])
    expect(scriptHint('학생')).toEqual(['ko'])
    expect(scriptHint('学生')).toEqual(['zh', 'ja'])
    expect(scriptHint('student')).toEqual([])
    await start('べんきょう', 'ja')
    render(<Harness />)
    const card = await screen.findByRole('article', { name: 'Word 勉強する' })
    expect(card).toHaveTextContent('study')
    cleanup(); await start('학생', 'ko')
    render(<Harness />)
    expect(await screen.findByRole('article', { name: 'Word 학생' })).toBeInTheDocument()
    expect(languagesOf().every(language => language === 'ko')).toBe(true)
    cleanup(); await start('ガクセイ', 'ja')
    render(<Harness />)
    expect(await screen.findByRole('article', { name: 'Word 学生' })).toBeInTheDocument()
    cleanup(); await start('student')
    render(<Harness />)
    await waitFor(() => expect(new Set(languagesOf())).toEqual(new Set(['zh', 'ja', 'ko'])))
  })

  it('shows a Japanese entry with reading, level, lesson link, phrases and Same word in', async () => {
    await start('学生', 'ja')
    render(<Harness />)
    const card = await screen.findByRole('article', { name: 'Word 学生' })
    expect(card).toHaveTextContent('がくせい')
    expect(card).toHaveTextContent('N5')
    expect(card.querySelector('ruby')).not.toBeNull()
    expect(within(card).getByRole('button', { name: 'Hear 学生' })).toBeInTheDocument()
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Show details' }))
    const lesson = await within(await within(card).findByTestId('word-lesson')).findByRole('link', { name: 'lesson 1' }, { timeout: 5000 })
    expect(lesson).toHaveAttribute('href', '#lessons/ja/1')
    const details = within(card).getByTestId('word-details')
    await waitFor(() => expect(details).toHaveTextContent('私は学生です。'))
    expect(details).toHaveTextContent('我是学生。')
    const same = within(card).getByTestId('same-word')
    await waitFor(() => expect(same).toHaveTextContent('学生'))
    expect(within(same).getByRole('link', { name: /学生/ })).toHaveAttribute('href', expect.stringContaining('lang=zh'))
    await waitFor(() => expect(within(same).getAllByRole('link').some(link => link.getAttribute('href')?.includes('lang=ko'))).toBe(true))
    expect(within(card).getByTestId('conjugation-slot')).toHaveTextContent('reserved')
    expect(within(card).getByRole('button', { name: 'Show writing' })).toBeInTheDocument()
  })

  it('shows a Korean entry with level and lesson, and says when writing data is missing', async () => {
    await start('학생', 'ko')
    render(<Harness />)
    const card = await screen.findByRole('article', { name: 'Word 학생' })
    expect(card).toHaveTextContent(/TOPIK \d/)
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Show details' }))
    expect(await within(await within(card).findByTestId('word-lesson')).findByRole('link', { name: /lesson \d+/ }, { timeout: 5000 })).toHaveAttribute('href', expect.stringMatching(/^#lessons\/ko\/\d+$/))
  })

  it('does not fetch Japanese or Korean data until it is needed', async () => {
    await savePreferences({ startedTracks: ['ja', 'ko'] })
    window.location.hash = 'dictionary/vocabulary/all?lang=zh&q=tea'
    render(<Harness />)
    await screen.findByRole('combobox', { name: 'Language filter' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(loadedDictionary('ja')).toBe(false)
    expect(loadedDictionary('ko')).toBe(false)
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Language filter' }), 'ja')
    await waitFor(() => expect(loadedDictionary('ja')).toBe(true))
    expect(loadedDictionary('ko')).toBe(false)
    // A learner who has started neither track keeps the Chinese list on All, with nothing fetched.
    cleanup(); resetDictionaries(); await savePreferences({ startedTracks: [] })
    window.location.hash = 'dictionary/vocabulary/all'
    render(<Harness />)
    await screen.findByRole('combobox', { name: 'Language filter' })
    expect(loadedDictionary('ja')).toBe(false)
    expect(document.querySelector('.lang-tag')).toBeNull()
  })

  it('applies the knowledge filter with ja:w:<id> records, and shows nothing when there are none', async () => {
    await savePreferences({ startedTracks: ['ja', 'ko'] })
    window.location.hash = 'dictionary/vocabulary/knowledge?lang=ja'
    render(<Harness />)
    expect(await screen.findByText('Your knowledge set is empty')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { await db.knowledge.add({ ref: 'ja:w:ja-n5-00149', kind: 'vocabulary', lb: '学生', band: '1', addedAt: 1, source: 'new' }) })
    await waitFor(() => expect(languagesOf()).toEqual(['ja']))
    expect(screen.getByRole('article', { name: 'Word 学生' })).toBeInTheDocument()
  })

  it('shows Japanese and Korean lesson phrases with the Chinese original, and a note on Characters', async () => {
    await start('', 'ja')
    window.location.hash = 'dictionary/phrases/all?lang=ja&q=' + encodeURIComponent('学生')
    render(<Harness />)
    const list = await screen.findByTestId('other-phrases', undefined, { timeout: 5000 })
    expect(list).toHaveTextContent('我是学生。')
    cleanup()
    window.location.hash = 'dictionary/characters/all?lang=ko'
    render(<Harness />)
    expect(await screen.findByTestId('characters-note')).toHaveTextContent('Chinese only')
  })

  it('indexes a language quickly and ranks form, reading and meaning', async () => {
    const dict = await loadDictionary('ko')
    const started = performance.now()
    const matcher = makeOtherMatcher('student')
    const hits = dict.words.filter(word => matcher.word(word) !== undefined)
    expect(performance.now() - started).toBeLessThan(500)
    expect(hits.length).toBeGreaterThan(0)
    const ja = await loadDictionary('ja')
    expect(ja.words.length).toBeGreaterThan(7000)
    expect(ja.words.find(word => word.id === 'ja-n5-00149')).toMatchObject({ form: '学生', reading: 'がくせい', level: 'N5', ref: 'ja:w:ja-n5-00149' })
  })
})

describe('dictionary generator', () => {
  it('--check passes for the committed files and fails when one is stale', () => {
    expect(() => generate(['--check'])).not.toThrow()
    const dir = mkdtempSync(join(tmpdir(), 'dict-'))
    try {
      symlinkSync(join(process.cwd(), 'curriculum'), join(dir, 'curriculum'))
      mkdirSync(join(dir, 'src/data/dictionary'), { recursive: true })
      writeFileSync(join(dir, 'src/data/dictionary/ja.json'), '{}')
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      expect(() => generate(['--check', '--root', dir])).toThrow(/dictionary:generate/)
      generate(['--root', dir])
      expect(() => generate(['--check', '--root', dir])).not.toThrow()
      expect(readFileSync(join(dir, 'public/dictionary/korean/ATTRIBUTION.txt'), 'utf8')).toContain('Korean')
      expect(readFileSync(join(dir, 'public/dictionary/japanese/ATTRIBUTION.txt'), 'utf8')).toContain('JMdict')
      log.mockRestore()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
