import { useContext, useEffect, useId, useState } from 'react'
import type { BrowserVoicePreference, SpeechLocale } from '../../core/assistant/contracts'
import { browserVoiceKey, browserVoiceMatches, clearVoiceCache, watchBrowserVoices, type BrowserVoiceState } from '../../core/assistant/speech'
import { savePreferences } from '../../core/learning'
import type { PageProps } from '../shared'
import { LocalSpeechRateSetupContext } from './local-ai-setup-context'

const languages: { locale: SpeechLocale; label: string }[] = [
  { locale: 'zh-Hans', label: 'Mandarin' },
  { locale: 'en-US', label: 'English' },
]

function voiceLabel(voice: BrowserVoicePreference) {
  return `${voice.name} — ${voice.lang} — ${voice.localService ? 'Local' : 'Online'}`
}

export function VoiceSettings({ workspace, busy, run }: Pick<PageProps, 'workspace' | 'busy' | 'run'>) {
  const id = useId()
  const speedSetup = useContext(LocalSpeechRateSetupContext)
  const [state, setState] = useState<BrowserVoiceState>({ voices: [], loading: true })
  const [refresh, setRefresh] = useState(0)
  useEffect(() => watchBrowserVoices(setState), [refresh])

  return <section className="panel settings-form" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Hear voices</h2>
    {speedSetup === 'loading' && <p className="small muted" role="status">Loading default speech speed...</p>}
    {speedSetup === 'error' && <p className="notice error" role="alert">Default speech speed could not be loaded. Check app.settings.jsonc and reload. The previous speed setting was kept.</p>}
    <p className="small muted" id={`${id}-help`}>Selections save automatically in this workspace, survive reload, and apply to every Hear button. Automatic prefers a local voice, then an online voice after a brief discovery window. The discovered voice is cached for this page session.</p>
    <p className="small muted" id={`${id}-privacy`}>Online voices send the spoken text to the browser's speech service. Viewing or changing these settings does not play audio or send an AI request.</p>
    {languages.map(({ locale, label }) => {
      const voices = [...new Map(state.voices.filter(voice => browserVoiceMatches(voice, locale)).map(voice => [browserVoiceKey(voice), voice])).values()]
        .sort((left, right) => Number(right.localService) - Number(left.localService) || left.name.localeCompare(right.name) || left.lang.localeCompare(right.lang))
      const selected = workspace.preferences.speechVoices?.[locale]
      const value = selected ? browserVoiceKey(selected) : ''
      const unavailable = Boolean(selected && !voices.some(voice => browserVoiceKey(voice) === value))
      return <div key={locale}>
        <label htmlFor={`${id}-${locale}`}>{label} voice
        <select id={`${id}-${locale}`} disabled={busy} value={value}
          aria-describedby={`${id}-help ${id}-privacy${unavailable ? ` ${id}-${locale}-unavailable` : ''}`}
          onChange={event => {
            const key = event.target.value
            const voice = voices.find(item => browserVoiceKey(item) === key)
            void run(async () => {
              if (key && !voice) throw new Error('That voice is no longer available. Refresh the voice list and choose again.')
              const metadata: BrowserVoicePreference | undefined = voice
                ? { voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang, localService: voice.localService }
                : undefined
              await savePreferences({ speechVoices: { [locale]: metadata } })
            })
          }}>
          <option value="">Automatic (local first)</option>
          {unavailable && selected && <option value={value} disabled>{voiceLabel(selected)} — Unavailable</option>}
          {voices.map(voice => <option key={browserVoiceKey(voice)} value={browserVoiceKey(voice)}>{voiceLabel(voice)}</option>)}
        </select></label>
        {unavailable && <p className="notice" id={`${id}-${locale}-unavailable`} role="status">Your saved {label} voice is not currently available. Hear will not use a different voice. Choose another voice or Automatic, or refresh after enabling the saved voice.</p>}
        {!state.loading && !state.error && voices.length === 0 && !selected && <p className="small muted">No matching {label} voices are available. Enable a browser or system voice, then refresh.</p>}
      </div>
    })}
    {state.loading && <p className="small muted" role="status">Looking for browser voices...</p>}
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    <button type="button" className="button secondary" disabled={busy} onClick={() => {
      clearVoiceCache()
      setRefresh(value => value + 1)
    }}>Refresh voice list</button>
    <p className="small muted">Refresh clears the page-session voice cache and checks again briefly; it does not change your saved selections. A missing selected voice never silently switches to another voice.</p>
  </section>
}
