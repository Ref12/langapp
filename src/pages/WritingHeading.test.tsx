import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeWorkspace, loadWorkspace, db } from '../core/database'
import { WritingPlayer } from './Writing'
import { resetCharacterMeanings } from '../core/characters/meanings'
import { headingWord } from '../core/writing-heading'
import type { CharacterAsset } from '../core/characters/assets'
import type { PageProps } from '../components/shared'
import type { Catalog } from '../core/study/catalog'

const word = (lb: string, ch: string, pr: string, ds: string) => ({ kind: 'vocabulary' as const, ref: `vocabulary:${lb}`, band: '1' as const, record: { lb, ch, pr, ds } })
// 不要 sorts before 要 in the catalog; 想要 and 重要 contain 要 too, but 要 has its own entry. 爱好 and 好爱 contain 爱, which has none.
const units = [
  word('bu4-yao4--dont', '不要', 'bù yào', "don't (do something)"),
  word('yao4--want', '要', 'yào', 'to want; to need'),
  word('hao3-ai4--lover', '好爱', 'hǎo ài', 'love well'),
  word('ai4-hao4--hobby', '爱好', 'ài hào', 'hobby'),
]
const catalog = {
  bands: [], groups: new Map(),
  units: new Map(units.map(unit => [unit.ref, unit])),
  // 爱好 is taught before 好爱, though it is longer-listed after it in the map
  orderedGroups: [{ band: '1', group: { id: 'g1', units: [{ kind: 'vocabulary', ref: 'ai4-hao4--hobby' }] } }, { band: '1', group: { id: 'g2', units: [{ kind: 'vocabulary', ref: 'yao4--want' }, { kind: 'vocabulary', ref: 'hao3-ai4--lover' }] } }],
} as unknown as Catalog
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({ catalog }) }))
vi.mock('../core/characters/assets', () => ({ characterAssetIndex: [], characterAttributionUrl: '', loadCharacterAsset: vi.fn() }))

let props: PageProps
const asset = (character: string): CharacterAsset => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] })
beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  props = { workspace: await loadWorkspace(), now: 1, busy: false, run: async operation => { await operation() } }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ meanings: { '\u8981': ['yào', 'to want; to need'] } }))))
  resetCharacterMeanings()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const title = () => document.querySelector('.writing-title-word') as HTMLElement

describe('Writing heading word', () => {
  it('names the character itself when it is a word of its own, not the first word that contains it', async () => {
    render(<WritingPlayer {...props} asset={asset('\u8981')} backHref="#d" />)
    await waitFor(() => expect(title()).not.toBeNull())
    expect(title()).toHaveTextContent('\u8981')
    expect(title()).toHaveTextContent('to want; to need')
    expect(title().textContent).not.toContain('\u4e0d\u8981')
    expect(screen.queryByTestId('character-meaning')).toBeNull() // the heading already says it
  })

  it('names the word being practised, with the character’s own meaning on its own line', async () => {
    const practised = { ch: '\u4e0d\u8981', pr: 'bù yào', ds: "don't (do something)" }
    render(<WritingPlayer {...props} asset={asset('\u8981')} inWord practised={practised} backHref="#d" />)
    await waitFor(() => expect(title()).toHaveTextContent('\u4e0d\u8981'))
    expect(title()).toHaveTextContent("don't (do something)")
    expect(await screen.findByTestId('character-meaning')).toHaveTextContent('\u8981 yào · to want; to need')
  })

  it('shows the practised word when it is the character alone', async () => {
    render(<WritingPlayer {...props} asset={asset('\u8981')} practised={{ ch: '\u8981', pr: 'yào', ds: 'to want; to need' }} backHref="#d" />)
    await waitFor(() => expect(title()).toHaveTextContent('to want; to need'))
    expect(title().textContent).not.toContain('\u4e0d')
  })

  it('without an entry of its own, falls back to the containing word taught earliest, then the shortest', () => {
    expect(headingWord(catalog, '\u7231')?.ch).toBe('\u7231\u597d') // g1 before g2, though 好爱 comes earlier in the map
    expect(headingWord(catalog, '\u597d')?.ch).toBe('\u7231\u597d')
    expect(headingWord(catalog, '\u9a6c')).toBeUndefined()
    // practising a word that does not contain the character does not hijack the heading
    expect(headingWord(catalog, '\u8981', { ch: '\u7231\u597d', pr: 'ài hào', ds: 'hobby' })?.ch).toBe('\u8981')
  })

  it('shows that earlier-taught containing word in the heading for such a character', async () => {
    render(<WritingPlayer {...props} asset={asset('\u7231')} backHref="#d" />)
    await waitFor(() => expect(title()).toHaveTextContent('\u7231\u597d'))
    expect(title()).toHaveTextContent('hobby')
  })
})

