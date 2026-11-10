import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { savePreferences } from '../core/learning'
import { buildCatalog } from '../core/study/catalog'
import { resetDictionaries } from '../core/dictionary/other'
import { resetParallel } from '../core/parallel/data'
import { resetOtherLanguages } from '../core/characters/otherLanguages'
import { useRoute } from '../core/routing'
import { characterScript, matchesCharacter } from '../core/characters/other-list'
import { Dictionary } from './Dictionary'

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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const match = /characters\/(japanese|korean)\/(index\.generated\.json)/.exec(String(url))
    if (!match) return new Response('', { status: 404 })
    return new Response(readFileSync(`public/characters/${match[1]}/${match[2]}`, 'utf8'))
  }))
  await db.delete(); await db.open(); await initializeWorkspace()
  resetDictionaries(); resetParallel(); resetOtherLanguages()
  source.catalog = buildCatalog([{ schemaVersion: 1, band: '1', alignment: 'Fixture', groups: [], grammar: [], vocabulary: [{ id: 'zh-x', ch: '茶', pr: 'chá', ds: 'tea', lb: 'tea' }] }])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const open = (lang: string, query = '') => {
  window.location.hash = 'dictionary/characters/all' + (query ? '?q=' + encodeURIComponent(query) : '')
  return savePreferences({ startedTracks: ['ja', 'ko'], currentLanguage: lang })
}
const glyphs = () => [...document.querySelectorAll('article.character-card')].map(card => card.getAttribute('aria-label')!.replace('Character ', ''))

// Skipped in Step 4: these cases put the Chinese build into Japanese or Korean with the old language switch and read the Dictionary's other-language branch, which the Chinese build no longer reaches. Dictionary stage 2 (which owns Dictionary.tsx) reworks or removes them.
describe.skip('Characters under Japanese and Korean', () => {
  it('lists kana and kanji for Japanese from its own stroke data, filtered by script', async () => {
    await open('ja')
    render(<Harness />)
    const user = userEvent.setup()
    await waitFor(() => expect(glyphs()).toContain('あ'))
    const scripts = within(screen.getByRole('group', { name: 'Script' }))
    await user.click(scripts.getByRole('button', { name: 'Katakana' }))
    expect(glyphs().length).toBeGreaterThan(0)
    expect(glyphs().every(item => characterScript(item) === 'katakana')).toBe(true)
    await user.click(scripts.getByRole('button', { name: 'Kanji' }))
    expect(glyphs().every(item => characterScript(item) === 'kanji')).toBe(true)
    cleanup()
    await open('ja', '学')
    render(<Harness />)
    await waitFor(() => expect(glyphs()).toContain('学'))
    expect(screen.queryByText(/covers Chinese only/)).toBeNull()
  })

  it('lists Hangul syllables and letters for Korean, and finds 학 by its reading', async () => {
    await open('ko')
    render(<Harness />)
    await waitFor(() => expect(glyphs().length).toBeGreaterThan(0))
    expect(glyphs().every(item => ['syllable', 'jamo'].includes(characterScript(item)))).toBe(true)
    cleanup()
    await open('ko', 'hak')
    render(<Harness />)
    await waitFor(() => expect(glyphs()).toEqual(['학']))
  })

  it('matches a character, its code point or its romanization, and nothing else', () => {
    expect(matchesCharacter('あ', 'ja', 'a')).toBe(true)
    expect(matchesCharacter('あ', 'ja', 'U+3042')).toBe(true)
    expect(matchesCharacter('あ', 'ja', 'ka')).toBe(false)
    expect(matchesCharacter('학', 'ko', 'hak')).toBe(true)
  })
})
