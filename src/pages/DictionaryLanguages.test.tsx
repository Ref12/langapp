import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { savePreferences } from '../core/learning'
import { buildCatalog, type BandData } from '../core/study/catalog'
import { loadedDictionary, loadDictionary, makeOtherMatcher, resetDictionaries } from '../core/dictionary/other'
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
  return <Dictionary {...props} section={section} initialScope={scope} initialQuery={params.get('q') ?? undefined} />
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

/** Opens the Dictionary as a learner in the given language (the Chinese build's switch): the route carries only the search text. */
const start = (query: string, current = 'zh') => {
  window.location.hash = 'dictionary/vocabulary/all' + (query ? '?q=' + encodeURIComponent(query) : '')
  return savePreferences({ startedTracks: ['ja', 'ko'], currentLanguage: current })
}
const languagesOf = () => [...document.querySelectorAll('article')].map(card => card.getAttribute('data-language') ?? (card.hasAttribute('data-unit') ? 'zh' : '?'))

describe('dictionary languages', () => {
  it('covers exactly the language the learner is in, with no Language filter and no language tag', async () => {
    for (const current of ['zh', 'ja', 'ko'] as const) {
      cleanup()
      await start('student', current)
      render(<Harness />)
      await waitFor(() => expect(languagesOf().length).toBeGreaterThan(0))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
      expect(new Set(languagesOf())).toEqual(new Set([current]))
      expect(screen.queryByRole('combobox', { name: 'Language filter' })).toBeNull()
      expect(document.querySelector('.lang-tag')).toBeNull()
    }
  })

  it('a word spelled the same in two languages lists only the language the learner is in', async () => {
    await start('学生', 'ja')
    render(<Harness />)
    await screen.findByRole('article', { name: 'Word 学生' })
    expect(new Set(languagesOf())).toEqual(new Set(['ja']))
    cleanup(); await start('学生', 'zh')
    render(<Harness />)
    await waitFor(() => expect(languagesOf()).toEqual(['zh']))
    expect(document.querySelector('[data-language]')).toBeNull()
  })

  it('ignores ?lang= in the route', async () => {
    await savePreferences({ startedTracks: ['ja', 'ko'], currentLanguage: 'zh' })
    window.location.hash = 'dictionary/vocabulary/all?lang=ja&q=' + encodeURIComponent('学生')
    render(<Harness />)
    await waitFor(() => expect(languagesOf()).toEqual(['zh']))
    cleanup()
    await savePreferences({ currentLanguage: 'ko' })
    window.location.hash = 'dictionary/vocabulary/all?lang=zh&q=' + encodeURIComponent('student')
    render(<Harness />)
    await waitFor(() => expect(languagesOf().length).toBeGreaterThan(0))
    expect(new Set(languagesOf())).toEqual(new Set(['ko']))
  })

  it('searches kana and Hangul by reading and form', async () => {
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
  })

  it('shows a Japanese entry with reading, level, lesson link and phrases, and no Same word in block', async () => {
    await start('学生', 'ja')
    render(<Harness />)
    const card = await screen.findByRole('article', { name: 'Word 学生' })
    // the reading sits in the pinyin slot (romaji by default), not as a separate kana line
    expect(card.querySelector('ruby.mandarin-word rt')).toHaveTextContent('gakusei')
    expect(card).toHaveTextContent('N5')
    expect(card.querySelector('ruby')).not.toBeNull()
    expect(within(card).getByRole('button', { name: 'Hear 学生' })).toBeInTheDocument()
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Show details' }))
    const lesson = await within(await within(card).findByTestId('word-lesson')).findByRole('link', { name: 'lesson 1' }, { timeout: 5000 })
    expect(lesson).toHaveAttribute('href', '#lessons/ja/1')
    const details = within(card).getByTestId('word-details')
    await waitFor(() => expect(details).toHaveTextContent('私は学生です。'))
    expect(details).not.toHaveTextContent('我是学生。')
    expect(within(card).queryByTestId('same-word')).toBeNull()
    expect(card).not.toHaveTextContent('Same word in')
    expect(within(card).getByTestId('conjugation-slot')).toHaveTextContent('no verb or adjective forms')
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

  it('does not fetch Japanese or Korean data until the learner is in that language', async () => {
    await savePreferences({ startedTracks: ['ja', 'ko'] })
    window.location.hash = 'dictionary/vocabulary/all?q=tea'
    render(<Harness />)
    await screen.findByRole('group', { name: 'Dictionary section' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(loadedDictionary('ja')).toBe(false)
    expect(loadedDictionary('ko')).toBe(false)
    expect(screen.queryByRole('combobox', { name: 'Language filter' })).toBeNull()
    await act(async () => { await savePreferences({ currentLanguage: 'ja' }) })
    await waitFor(() => expect(loadedDictionary('ja')).toBe(true))
    expect(loadedDictionary('ko')).toBe(false)
  })

  it('applies the knowledge filter with ja:w:<id> records, and shows nothing when there are none', async () => {
    await savePreferences({ startedTracks: ['ja', 'ko'], currentLanguage: 'ja' })
    window.location.hash = 'dictionary/vocabulary/knowledge'
    render(<Harness />)
    expect(await screen.findByText('Your knowledge set is empty')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { await db.knowledge.add({ ref: 'ja:w:ja-n5-00149', kind: 'vocabulary', lb: '学生', band: '1', addedAt: 1, source: 'new' }) })
    await waitFor(() => expect(languagesOf()).toEqual(['ja']))
    expect(screen.getByRole('article', { name: 'Word 学生' })).toBeInTheDocument()
  })

  it('shows Japanese and Korean lesson phrases without the Chinese original, and a Korean Characters list', async () => {
    await start('', 'ja')
    window.location.hash = 'dictionary/phrases/all?q=' + encodeURIComponent('学生')
    render(<Harness />)
    const list = await screen.findByTestId('other-phrases', undefined, { timeout: 5000 })
    expect(list).toHaveTextContent('私は学生です。')
    expect(list).not.toHaveTextContent('我是学生。')
    cleanup()
    await savePreferences({ currentLanguage: 'ko' })
    window.location.hash = 'dictionary/characters/all'
    render(<Harness />)
    expect(await screen.findByTestId('other-characters-ko')).toBeInTheDocument()
    expect(screen.queryByTestId('characters-note')).toBeNull()
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
  /** A tiny curriculum: one word and one grammar point per language. The full JLPT/TOPIK data is checked by npm run curriculum:check. */
  function fixture(dir: string) {
    const put = (path: string, text: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text) }
    const langs: Record<string, { levels: string[]; licenses: string[]; prefix: string }> = {
      japanese: { levels: ['jlpt-n5', 'jlpt-n4', 'jlpt-n3', 'jlpt-n2', 'jlpt-n1'], licenses: ['CC-BY-SA-4.0.txt', 'EDRDG-license.html', 'Waller-sharing.html'], prefix: 'ja' },
      korean: { levels: ['topik-1', 'topik-2', 'topik-3', 'topik-4', 'topik-5', 'topik-6'], licenses: ['NOTICE.md'], prefix: 'ko' },
    }
    for (const [name, { levels, licenses, prefix }] of Object.entries(langs)) {
      levels.forEach((level, index) => {
        put(`curriculum/${name}/${level}/vocabulary.yaml`, index === 0 ? `- id: ${prefix}-w1\n  target: 学生\n  reading: がくせい\n  english: 1. student\n  part_of_speech: noun\n` : '[]\n')
        put(`curriculum/${name}/${level}/grammar.yaml`, index === 0 ? `- id: ${prefix}-g1\n  pattern: です\n  english: is\n  note: polite\n  examples:\n    - target: 私は学生です\n      english: I am a student\n` : '[]\n')
      })
      put(`curriculum/${name}/parallel/entries.yaml`, 'vocabulary: []\ngrammar: []\n')
      put(`curriculum/${name}/parallel/zh-lessons.yaml`, `lessons:\n  - grammar_intro: [${prefix}-g1]\n    grammar_taught: []\n`)
      for (const license of licenses) put(`curriculum/${name}/licenses/${license}`, 'licence text ' + license + '\n')
    }
  }

  it('--check passes for fresh output and fails when one file is stale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dict-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      fixture(dir)
      mkdirSync(join(dir, 'src/data/dictionary'), { recursive: true })
      writeFileSync(join(dir, 'src/data/dictionary/ja.json'), '{}')
      expect(() => generate(['--check', '--root', dir])).toThrow(/dictionary:generate/)
      generate(['--root', dir])
      expect(() => generate(['--check', '--root', dir])).not.toThrow()
      expect(JSON.parse(readFileSync(join(dir, 'src/data/dictionary/ja.json'), 'utf8')).words).toEqual([['ja-w1', '学生', 'がくせい', 'student', 0, 0]])
      expect(readFileSync(join(dir, 'public/dictionary/korean/ATTRIBUTION.txt'), 'utf8')).toContain('Korean')
      expect(readFileSync(join(dir, 'public/dictionary/japanese/ATTRIBUTION.txt'), 'utf8')).toContain('JMdict')
      writeFileSync(join(dir, 'public/dictionary/korean/ATTRIBUTION.txt'), 'edited')
      expect(() => generate(['--check', '--root', dir])).toThrow(/dictionary:generate/)
    } finally { log.mockRestore(); rmSync(dir, { recursive: true, force: true }) }
  })
})
