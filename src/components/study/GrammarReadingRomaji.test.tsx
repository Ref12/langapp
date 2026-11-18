// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../../core/study/catalog'
import { DisplaySettingsProvider, ReadingText } from '../display-context'
import { UnitCard } from './UnitCard'

let catalog: Catalog
beforeEach(async () => { setBuildLanguageForTests('ja'); resetCatalogCache(); catalog = await loadCatalog() })
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })

const romaji = (node: React.ReactNode) => render(<DisplaySettingsProvider settings={{ form: 'masu', readingStyle: 'romaji' }}>{node}</DisplaySettingsProvider>).container

describe('a Japanese grammar reading in romaji', () => {
  it('reads the particles は, へ and を as wa, e and o beside the slot chips', () => {
    const line = romaji(<p><ReadingText kana="<place> + へ + <noun> + は + <noun> + を" pattern /></p>)
    expect([...line.querySelectorAll('.pattern-slot')].map(chip => chip.textContent)).toEqual(['place', 'noun', 'noun'])
    expect(line.textContent).toBe('placeenounwanouno')
    expect(line.textContent).not.toMatch(/[<>+]/)
  })
  it('shows <noun> + は on the grammar card as the noun chip and wa', () => {
    const unit = [...catalog.units.values()].find(item => item.kind === 'grammar' && item.record.pr === '<noun> + は')!
    const line = romaji(<UnitCard catalog={catalog} unit={unit} pinyin now={0} run={async operation => operation()} busy={false} route="lessons/group/x" hideStatus />).querySelector('.study-pinyin')!
    expect(line.textContent).toBe('nounwa')
  })
})
