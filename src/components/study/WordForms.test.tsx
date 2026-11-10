// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { loadCatalog, resetCatalogCache, type Catalog, type Unit } from '../../core/study/catalog'
import { DisplaySettingsProvider } from '../display-context'
import { UnitCard } from './UnitCard'

let catalog: Catalog
const vocabulary = (ch: string): Unit => [...catalog.units.values()].find(unit => unit.kind === 'vocabulary' && unit.record.ch === ch)!

function card(unit: Unit, options: { compact?: boolean; form?: string; romaji?: boolean } = {}) {
  render(<DisplaySettingsProvider settings={{ form: options.form ?? 'masu', readingStyle: options.romaji ? 'romaji' : 'kana' }}>
    <UnitCard catalog={catalog} unit={unit} pinyin now={0} run={async operation => operation()} busy={false} route="lessons/group/x" compact={options.compact} hideStatus />
  </DisplaySettingsProvider>)
}

beforeEach(async () => { setBuildLanguageForTests('ja'); resetCatalogCache(); catalog = await loadCatalog() })
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the word card in a Japanese build', () => {
  it('shows a verb as chosen and lists its forms in a collapsed section', async () => {
    card(vocabulary('勉強する'))
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('勉強します')
    expect(screen.getByText('べんきょうします')).toBeInTheDocument()
    const summary = await screen.findByText('Forms')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    const rows = within(details).getAllByRole('row').slice(1)
    expect(rows[0].textContent).toContain('dictionary form')
    expect(rows[0].textContent).toContain('勉強する')
    const polite = rows.find(row => row.textContent?.includes('polite form'))!
    expect(polite.textContent).toContain('勉強します')
    const link = within(polite).getByRole('link')
    expect(link.textContent).toMatch(/^Lesson \d+$/)
    expect(link.getAttribute('href')).toMatch(/^#lessons\/group\/ja-lesson-/)
  })
  it('shows the dictionary form when chosen, and 行く in 行って', async () => {
    card(vocabulary('行く'), { form: 'dict' })
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('行く')
    const details = (await screen.findByText('Forms')).closest('details')!
    expect(details.textContent).toContain('行って')
    expect(details.textContent).not.toContain('行いて')
  })
  it('has no Forms section on a noun or in a compact row, and shows romaji when chosen', async () => {
    card(vocabulary('学生'))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByText('Forms')).toBeNull()
    cleanup()
    card(vocabulary('勉強する'), { compact: true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByText('Forms')).toBeNull()
    cleanup()
    card(vocabulary('勉強する'), { romaji: true })
    expect(screen.getByText('benkyoushimasu')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Forms')).toBeInTheDocument())
    expect(screen.getByText('benkyousuru')).toBeInTheDocument()
  })
})
