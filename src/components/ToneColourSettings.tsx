import { useRef } from 'react'
import { savePreferences } from '../core/learning'
import type { Workspace } from '../core/model'
import {
  DEFAULT_TONE_SCHEME, PAGE_BACKGROUND, TONE_NAMES, TONE_SCHEMES, contrastRatio, isToneScheme, schemeColours,
  type Theme, type ToneColourScheme,
} from '../core/tone-colour'
import { ToneColourProvider } from './ToneText'
import { toneClass } from './tone-colour-context'

const SAMPLE = [['妈', 'mā', 1], ['麻', 'má', 2], ['马', 'mǎ', 3], ['骂', 'mà', 4], ['吗', 'ma', 5]] as const
/** Below this a custom colour is hard to read on the page; the learner may still keep it. */
const MIN_CONTRAST = 3

/** The Tone colours section of Settings: the scheme, five colours per theme for Custom, a live sample and Reset. */
export function ToneColourSettings({ workspace, busy, run }: { workspace: Workspace; busy: boolean; run: (operation: () => Promise<void>) => Promise<void> }) {
  const { preferences } = workspace
  const scheme = preferences.toneColourScheme ?? DEFAULT_TONE_SCHEME
  const custom = scheme === 'custom' ? schemeColours('custom', preferences.toneColoursCustom) : undefined
  // Fast changes (a picker fires many) build on the last colours chosen, not on the stored ones, which arrive a moment later.
  const latest = useRef<{ from: unknown; colours: ReturnType<typeof schemeColours> }>()
  const colours = custom && (latest.current && latest.current.from === preferences.toneColoursCustom ? latest.current.colours : custom)
  const choose = (next: ToneColourScheme) => {
    if (next !== 'custom') return void run(() => savePreferences({ toneColourScheme: next }))
    // Custom starts from the scheme it was switched from.
    return void run(() => savePreferences({ toneColourScheme: 'custom', toneColoursCustom: schemeColours(scheme, preferences.toneColoursCustom) }))
  }
  const setColour = (theme: Theme, index: number, value: string) => {
    if (!colours) return
    const next = { dark: [...colours.dark], light: [...colours.light] }
    next[theme][index] = value.toLowerCase()
    latest.current = { from: preferences.toneColoursCustom, colours: next }
    void run(() => savePreferences({ toneColoursCustom: next }))
  }
  return <section className="panel settings-form" aria-labelledby="tone-colours-heading"><h2 id="tone-colours-heading">Tone colours</h2>
    <p className="small muted">Colours characters and their pinyin by tone, in the Chinese of words, sentences and the pinyin itself. It is switched on above, or from the quick settings. Questions about the tone or the pinyin show no colour until you check.</p>
    <label>Colour scheme<select disabled={busy} value={scheme} onChange={event => { if (isToneScheme(event.target.value)) choose(event.target.value) }}>
      {TONE_SCHEMES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {custom && (['dark', 'light'] as const).map(theme => <fieldset key={theme} className="tone-theme" disabled={busy}><legend>{theme === 'dark' ? 'Dark theme colours' : 'Light theme colours'}</legend>
      <div className="tone-pickers">{TONE_NAMES.map((name, index) => <label key={name} className="small">{name}
        <input type="color" aria-label={`${theme === 'dark' ? 'Dark' : 'Light'} theme ${name.toLowerCase()} colour`} value={custom[theme][index]} onChange={event => setColour(theme, index, event.target.value)} /></label>)}</div>
      {custom[theme].map((colour, index) => { const ratio = contrastRatio(colour, PAGE_BACKGROUND[theme]); return ratio < MIN_CONTRAST
        ? <p key={index} className="small notice" role="note">{`${TONE_NAMES[index]} on the ${theme} theme is hard to read (${ratio.toFixed(1)}:1 against the page; 3:1 is the least to aim for).`}</p> : null })}
    </fieldset>)}
    <ToneColourProvider on>
      <p className="tone-sample" aria-label="Sample" data-testid="tone-sample">{SAMPLE.map(([character, pinyin, tone]) => <span key={character}><span className={toneClass(tone)} lang="zh-Hans">{character}</span><small className={toneClass(tone)}>{pinyin}</small></span>)}</p>
    </ToneColourProvider>
    <div className="button-row"><button type="button" className="button secondary" disabled={busy || scheme === DEFAULT_TONE_SCHEME && !preferences.toneColoursCustom}
      onClick={() => void run(() => savePreferences({ toneColourScheme: DEFAULT_TONE_SCHEME, toneColoursCustom: undefined }))}>Reset</button></div>
  </section>
}
