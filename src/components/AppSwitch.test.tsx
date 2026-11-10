import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppSwitch } from './AppSwitch'
import { appHref, labApps } from '../core/language/apps'
import { setBuildChannelForTests, setBuildLanguageForTests } from '../core/storage-names'

afterEach(() => { cleanup(); setBuildChannelForTests(undefined); setBuildLanguageForTests(undefined) })

describe('the Lab app switch', () => {
  it('lists the published apps from the pack registry: Chinese, Japanese and Korean', () => {
    expect(labApps().map(app => app.id)).toEqual(['zh', 'ja', 'ko'])
    expect(labApps().map(app => app.glyph)).toEqual(['\u4E2D', '\u65E5', '\uD55C'])
  })
  it('in the Chinese Lab build marks Chinese and links Japanese at ./ja/ and Korean at ./ko/', () => {
    setBuildChannelForTests('lab'); setBuildLanguageForTests('zh')
    render(<AppSwitch />)
    expect(screen.getByRole('navigation', { name: 'Language apps' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Chinese' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Japanese' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Japanese' })).toHaveAttribute('href', './ja/')
    expect(screen.getByRole('link', { name: 'Korean' })).toHaveAttribute('href', './ko/')
  })
  it('in the Japanese Lab build marks Japanese and links Chinese at ../', () => {
    setBuildChannelForTests('lab'); setBuildLanguageForTests('ja')
    render(<AppSwitch />)
    expect(screen.getByRole('link', { name: 'Japanese' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Chinese' })).toHaveAttribute('href', '../')
    expect(screen.getByRole('link', { name: 'Chinese' })).not.toHaveAttribute('aria-current')
  })
  it('is absent in a Stable build', () => {
    setBuildChannelForTests('stable'); setBuildLanguageForTests('zh')
    const view = render(<AppSwitch />)
    expect(view.container).toBeEmptyDOMElement()
  })
  it('builds relative links from the build language', () => {
    expect(appHref('ja', 'zh')).toBe('./ja/')
    expect(appHref('zh', 'ja')).toBe('../')
    expect(appHref('ko', 'ja')).toBe('../ko/')
    expect(appHref('zh', 'zh')).toBe('./')
  })
})
