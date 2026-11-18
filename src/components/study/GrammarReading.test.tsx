// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../../core/study/catalog'
import { DisplaySettingsProvider } from '../display-context'
import { UnitCard } from './UnitCard'

let catalog: Catalog
beforeEach(async () => { setBuildLanguageForTests('zh'); resetCatalogCache(); catalog = await loadCatalog() })
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the grammar card reading line', () => {
  it('shows slots as chips and keeps the pinyin of the fixed parts, with no brackets or plus', async () => {
    const unit = catalog.units.get('grammar:s-shi4-n--identity')!
    expect(unit.kind === 'grammar' && unit.record.pr).toContain('<')
    const { container } = render(<DisplaySettingsProvider settings={{ form: 'masu', readingStyle: 'kana' }}>
      <UnitCard catalog={catalog} unit={unit} pinyin now={0} run={async operation => operation()} busy={false} route="lessons/group/x" hideStatus />
    </DisplaySettingsProvider>)
    await waitFor(() => expect(container.querySelector('.study-pinyin')).not.toBeNull())
    const line = container.querySelector('.study-pinyin')!
    expect(line.textContent).not.toMatch(/[<>+]/)
    expect([...line.querySelectorAll('.pattern-slot')].map(chip => chip.textContent)).toEqual(['subject', 'noun'])
    expect(line.textContent).toContain('shì')
  })
})
