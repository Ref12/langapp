// Tone colours: one palette per scheme and theme, the contrast arithmetic the Settings warning and the tests use, and how a scheme reaches the page (CSS tokens in docs/mockups/theme.css; a custom scheme sets them inline).

export type Theme = 'dark' | 'light'
export type ToneColourScheme = 'pleco' | 'hanping' | 'custom'
/** The colours of tones 1, 2, 3, 4 and the neutral tone, as #rrggbb. */
export type TonePalette = readonly [string, string, string, string, string]
export interface ToneColoursCustom { dark: string[]; light: string[] }

export const TONE_NAMES = ['Tone 1', 'Tone 2', 'Tone 3', 'Tone 4', 'Neutral'] as const
export const TONE_SCHEMES: { id: ToneColourScheme; label: string }[] = [
  { id: 'pleco', label: 'Pleco-style' }, { id: 'hanping', label: 'Hanping-style' }, { id: 'custom', label: 'Custom' },
]
export const DEFAULT_TONE_SCHEME: ToneColourScheme = 'pleco'

/** Pleco-style: 1 red, 2 green, 3 blue, 4 purple, neutral grey. Hanping-style: 1 red, 2 orange, 3 green, 4 blue, neutral grey. The same values are the CSS tokens --tone-1 to --tone-5. */
export const TONE_PALETTES: Record<Exclude<ToneColourScheme, 'custom'>, Record<Theme, TonePalette>> = {
  pleco: {
    dark: ['#ff7b72', '#56d364', '#79b8ff', '#d2a8ff', '#9198a1'],
    light: ['#cf222e', '#1a7f37', '#0550ae', '#8250df', '#59636e'],
  },
  hanping: {
    dark: ['#ff7b72', '#ffa657', '#56d364', '#79b8ff', '#9198a1'],
    light: ['#cf222e', '#953800', '#1a7f37', '#0550ae', '#59636e'],
  },
}
/** The page background of each theme (--bg in theme.css), what the colours are held against. */
export const PAGE_BACKGROUND: Record<Theme, string> = { dark: '#0d1117', light: '#f6f8fa' }

const HEX = /^#[0-9a-f]{6}$/i
export const isHexColour = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)
export const isToneScheme = (value: unknown): value is ToneColourScheme => value === 'pleco' || value === 'hanping' || value === 'custom'
export const isToneColoursCustom = (value: unknown): value is ToneColoursCustom => {
  if (typeof value !== 'object' || value === null) return false
  const { dark, light } = value as Record<string, unknown>
  return [dark, light].every(list => Array.isArray(list) && list.length === 5 && list.every(isHexColour))
}

const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(index => channel(parseInt(hex.slice(index, index + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

type ToneChoice = { toneColourScheme?: ToneColourScheme; toneColoursCustom?: ToneColoursCustom }
/** The colours in force for a theme: a scheme's palette, or the learner's own (a scheme that is not Custom, or a custom set that is missing, falls back to Pleco-style). */
export function activeTonePalette(choice: ToneChoice, theme: Theme): TonePalette {
  const scheme = choice.toneColourScheme ?? DEFAULT_TONE_SCHEME
  if (scheme === 'custom' && isToneColoursCustom(choice.toneColoursCustom)) return choice.toneColoursCustom[theme] as unknown as TonePalette
  return TONE_PALETTES[scheme === 'custom' ? 'pleco' : scheme][theme]
}
/** What a scheme's colours are in both themes: the starting point of the custom pickers. */
export function schemeColours(scheme: ToneColourScheme, custom?: ToneColoursCustom): ToneColoursCustom {
  if (scheme === 'custom' && isToneColoursCustom(custom)) return { dark: [...custom.dark], light: [...custom.light] }
  const palettes = TONE_PALETTES[scheme === 'custom' ? 'pleco' : scheme]
  return { dark: [...palettes.dark], light: [...palettes.light] }
}

/** Puts the scheme on the page: data-tone-scheme for the CSS presets, and for Custom the five tokens inline (which win over the CSS). */
export function applyToneColours(root: HTMLElement, choice: ToneChoice, theme: Theme): void {
  const scheme = choice.toneColourScheme ?? DEFAULT_TONE_SCHEME
  const custom = scheme === 'custom' && isToneColoursCustom(choice.toneColoursCustom)
  root.dataset.toneScheme = custom ? 'custom' : scheme === 'custom' ? DEFAULT_TONE_SCHEME : scheme
  const palette = custom ? activeTonePalette(choice, theme) : undefined
  for (let tone = 1; tone <= 5; tone++) {
    if (palette) root.style.setProperty('--tone-' + tone, palette[tone - 1])
    else root.style.removeProperty('--tone-' + tone)
  }
}
