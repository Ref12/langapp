// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PAGE_BACKGROUND, TONE_PALETTES, activeTonePalette, applyToneColours, contrastRatio, schemeColours } from './tone-colour'
import { zhMeta, jaMeta, koMeta } from './language/meta'

const token = (css: string, selector: string, name: string) => {
  const start = css.indexOf('\n' + selector + ' {')
  const block = css.slice(start, css.indexOf('}', start))
  return new RegExp(name + ': (#[0-9a-f]{6})', 'i').exec(block)?.[1]
}

const theme = readFileSync(resolve(process.cwd(), 'docs/mockups/theme.css'), 'utf8').replace(/\r\n/g, '\n')

describe('tone colour palettes', () => {
  it('meets WCAG AA (4.5:1) against the page background in both themes, for every scheme', () => {
    for (const scheme of Object.values(TONE_PALETTES)) for (const theme of ['dark', 'light'] as const) for (const colour of scheme[theme]) expect(contrastRatio(colour, PAGE_BACKGROUND[theme]), colour + ' on ' + theme).toBeGreaterThanOrEqual(4.5)
  })
  it('is what the CSS tokens say, and the background is --bg', () => {
    expect(token(theme, ':root', '--bg')).toBe(PAGE_BACKGROUND.dark)
    expect(token(theme, ':root[data-theme="light"]', '--bg')).toBe(PAGE_BACKGROUND.light)
    TONE_PALETTES.pleco.dark.forEach((colour, index) => expect(token(theme, ':root', '--tone-' + (index + 1))).toBe(colour))
    TONE_PALETTES.pleco.light.forEach((colour, index) => expect(token(theme, ':root[data-theme="light"]', '--tone-' + (index + 1))).toBe(colour))
    expect(token(theme, ':root[data-tone-scheme="hanping"]', '--tone-2')).toBe(TONE_PALETTES.hanping.dark[1])
    expect(token(theme, ':root[data-theme="light"][data-tone-scheme="hanping"]', '--tone-2')).toBe(TONE_PALETTES.hanping.light[1])
  })
  it('puts a custom scheme on the page per theme and takes it off again', () => {
    const custom = { dark: ['#111111', '#222222', '#333333', '#444444', '#555555'], light: ['#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#eeeeee'] }
    const root = document.createElement('div')
    applyToneColours(root, { toneColourScheme: 'custom', toneColoursCustom: custom }, 'dark')
    expect(root.dataset.toneScheme).toBe('custom'); expect(root.style.getPropertyValue('--tone-3')).toBe('#333333')
    applyToneColours(root, { toneColourScheme: 'custom', toneColoursCustom: custom }, 'light')
    expect(root.style.getPropertyValue('--tone-3')).toBe('#cccccc')
    applyToneColours(root, { toneColourScheme: 'hanping' }, 'dark')
    expect(root.dataset.toneScheme).toBe('hanping'); expect(root.style.getPropertyValue('--tone-3')).toBe('')
    expect(activeTonePalette({}, 'dark')).toEqual(TONE_PALETTES.pleco.dark)
    expect(schemeColours('hanping').light).toEqual([...TONE_PALETTES.hanping.light])
  })
  it('flags tones in Chinese only', () => {
    expect([zhMeta.tones, jaMeta.tones, koMeta.tones]).toEqual([true, undefined, undefined])
  })
})
