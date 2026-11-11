// What the Writing page says for a character, by the way it was reached: a word known (route, sheet, Learn to write), no word, a kana.
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBuildLanguageForTests } from '../core/storage-names'
import { resetJapaneseReadings } from '../core/language/speech-text'
import { Writing, WritingPlayer, WritingStage } from './Writing'
import { buildWritingRoute, parseWritingQuery } from '../core/characters/writing-route'
import type { Workspace } from '../core/model'
import type { Catalog } from '../core/study/catalog'
import type { CharacterAsset } from '../core/characters/assets'

const word = (lb: string, ch: string, pr: string) => ({ kind: 'vocabulary' as const, ref: lb, band: '1' as const, record: { lb, ch, pr, ds: lb } })
const units = [word('a', '今日', 'きょう'), word('b', '学校', 'がっこう')]
const catalog = {
  bands: [], groups: new Map(), units: new Map(units.map(unit => [unit.ref, unit])),
  orderedGroups: [{ band: '1', group: { id: 'g', units: units.map(unit => ({ kind: 'vocabulary', ref: unit.ref })) } }],
} as unknown as Catalog
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({ catalog }) }))
vi.mock('../core/characters/assets', async importOriginal => ({
  ...await importOriginal<typeof import('../core/characters/assets')>(),
  loadCharacterAsset: vi.fn(async (character: string) => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] })),
}))

const props = { workspace: { preferences: {}, characterStates: [] } as unknown as Workspace, busy: false, now: 0, run: async (operation: () => Promise<void>) => { await operation() } }
let spoken: string[] = []
const hex = (character: string) => character.codePointAt(0)!.toString(16).padStart(4, '0')
const lastSpoken = async () => { await waitFor(() => expect(spoken.length).toBeGreaterThan(0)); return spoken[spoken.length - 1] }

beforeEach(() => {
  spoken = []
  resetJapaneseReadings()
  setBuildLanguageForTests('ja')
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; lang = ''; constructor(text: string) { this.text = text } })
  vi.stubGlobal('speechSynthesis', { cancel: () => undefined, speak: (utterance: { text: string }) => { spoken.push(utterance.text) } })
  Object.defineProperty(window, 'speechSynthesis', { value: (globalThis as { speechSynthesis: unknown }).speechSynthesis, configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined) })

describe('the Writing page speaks a kanji with its reading', () => {
  it('a word on the route with its reading: the character within it', async () => {
    render(<Writing {...props} codepoint={hex('学')} scope="all" query="word=%E5%AD%A6%E7%94%9F&r=%E3%81%8C%E3%81%8F%E3%81%9B%E3%81%84&lang=ja" />)
    expect(await lastSpoken()).toBe('がく')
  })
  it('an irregular word on the route: the whole word in kana', async () => {
    render(<Writing {...props} codepoint={hex('今')} scope="all" query="word=%E4%BB%8A%E6%97%A5&r=%E3%81%8D%E3%82%87%E3%81%86&lang=ja" />)
    expect(await lastSpoken()).toBe('きょう')
  })
  it('an old link (a word, no reading) still opens, and finds no reading, so it goes to the lesson words', async () => {
    render(<Writing {...props} codepoint={hex('学')} scope="all" query="word=%E5%AD%A6%E7%94%9F&lang=ja" />)
    expect(await lastSpoken()).toBe('がっ')
  })
  it('a sheet opened on one character of a word (a look-up card): the character within that word', async () => {
    render(<WritingStage {...props} language="ja" character="校" word={['校']} index={0} remember={false} within={{ text: '学校', reading: 'がっこう' }} onGo={() => undefined} onFinish={() => undefined} />)
    expect(await lastSpoken()).toBe('こう')
  })
  it('a sheet opened on a word the catalog knows (a Write link on a word)', async () => {
    const { noteJapaneseReadings } = await import('../core/language/speech-text')
    noteJapaneseReadings('catalog', [['学校', 'がっこう']])
    render(<WritingStage {...props} language="ja" character="学" word={['学', '校']} index={0} remember={false} onGo={() => undefined} onFinish={() => undefined} />)
    expect(await lastSpoken()).toBe('がっ')
  })
  it('Learn to write: the practised word', async () => {
    render(<WritingPlayer {...props} language="ja" asset={{ character: '今', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] } as CharacterAsset} teach inWord practised={{ ch: '今日', pr: 'きょう', ds: 'today' }} />)
    expect(await lastSpoken()).toBe('きょう')
  })
  it('no word (the Writing list, a direct link): the first lesson word that reads it', async () => {
    render(<Writing {...props} codepoint={hex('学')} scope="all" />)
    expect(await lastSpoken()).toBe('がっ')
  })
  it('no word and no lesson word: as written', async () => {
    render(<Writing {...props} codepoint={hex('山')} scope="all" />)
    expect(await lastSpoken()).toBe('山')
  })
  it('a kana is spoken as itself', async () => {
    render(<Writing {...props} codepoint={hex('は')} scope="all" />)
    expect(await lastSpoken()).toBe('は')
  })
  it('Korean speech is unchanged', async () => {
    setBuildLanguageForTests('ko')
    render(<Writing {...props} codepoint={hex('가')} scope="all" />)
    expect(await lastSpoken()).toBe('가')
  })
})

describe('the writing route carries the word\'s reading', () => {
  it('builds and parses r with the word, and old routes parse as before', () => {
    const route = buildWritingRoute('学', 'all', { word: '学生', index: 0, language: 'ja', reading: 'がくせい' })
    const query = route.split('?')[1]
    expect(parseWritingQuery(query, '学')).toMatchObject({ word: ['学', '生'], reading: 'がくせい', language: 'ja' })
    expect(parseWritingQuery('word=%E5%AD%A6%E7%94%9F&lang=ja', '学').reading).toBeUndefined()
    expect(buildWritingRoute('学', 'all', { language: 'ja', reading: 'がくせい' })).not.toContain('r=')
  })
})
