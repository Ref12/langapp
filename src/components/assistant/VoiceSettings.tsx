import { useContext, useEffect, useId, useState } from 'react'
import { isEdgeVoice, type SpeechLocale, type SpeechVoicePreference } from '../../core/assistant/contracts'
import { browserVoiceKey, browserVoiceMatches, clearVoiceCache, languageMatches, speechVoiceKey, watchBrowserVoices, type BrowserVoiceState } from '../../core/assistant/speech'
import { edgeTtsAvailable, loadEdgeVoices } from '../../core/assistant/edge-speech'
import type { EdgeVoice } from '../../core/local-tts-contracts'
import { savePreferences } from '../../core/learning'
import type { PageProps } from '../shared'
import { LocalSpeechRateSetupContext, LocalSpeechVoicesSetupContext } from './local-ai-setup-context'
import { HearButton } from './SnippetActions'

const languages: { locale: SpeechLocale; label: string }[] = [
  { locale: 'zh-Hans', label: 'Mandarin' },
  { locale: 'en-US', label: 'English' },
]

function voiceLabel(voice: SpeechVoicePreference) {
  return isEdgeVoice(voice) ? `${voice.voice} — Edge TTS (Online)`
    : `${voice.name} — ${voice.lang} — ${voice.localService ? 'Local' : 'Online'}`
}

export function VoiceSettings({ workspace, busy, run }: Pick<PageProps, 'workspace' | 'busy' | 'run'>) {
  const id = useId()
  const speedSetup = useContext(LocalSpeechRateSetupContext)
  const voiceSetup = useContext(LocalSpeechVoicesSetupContext)
  const [state, setState] = useState<BrowserVoiceState>({ voices: [], loading: true })
  const edgeAvailable = edgeTtsAvailable()
  const [edge, setEdge] = useState<{ voices: EdgeVoice[]; loading: boolean; error?: string }>({ voices: [], loading: edgeAvailable })
  const [refresh, setRefresh] = useState(0)
  useEffect(() => watchBrowserVoices(setState), [refresh])
  useEffect(() => {
    if (!edgeAvailable) return
    const controller = new AbortController()
    setEdge({ voices: [], loading: true })
    void loadEdgeVoices(controller.signal).then(voices => {
      if (!controller.signal.aborted) setEdge({ voices, loading: false })
    }, error => {
      if (!controller.signal.aborted) setEdge({ voices: [], loading: false, error: error instanceof Error ? error.message : 'The Edge voice catalog could not be loaded.' })
    })
    return () => controller.abort()
  }, [edgeAvailable, refresh])

  return <section className="panel settings-form" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Hear voices</h2>
    {speedSetup === 'loading' && <p className="small muted" role="status">Loading default speech speed...</p>}
    {speedSetup === 'error' && <p className="notice error" role="alert">Default speech speed could not be loaded. Check the profile YAML in data/ and reload. The previous speed setting was kept.</p>}
    {voiceSetup === 'loading' && <p className="small muted" role="status">Loading saved voice selections...</p>}
    {voiceSetup === 'error' && <p className="notice error" role="alert">Voice selections could not be loaded. Check the profile YAML in data/ and reload. Your previous selections were kept.</p>}
    <p className="small muted" id={`${id}-help`}>Selections save automatically and apply to Hear, Practice, lessons, and spoken replies. Automatic prefers listed local browser voices. If no matching voice is listed, it asks the system for the requested language; it never selects Edge TTS.</p>
    <p className="small muted" id={`${id}-privacy`}>Online voices send the spoken text to the browser's speech service. A system-selected voice may also be online; its identity and availability cannot be confirmed from an empty voice list. Edge TTS sends it to Microsoft through the local server. Only Test voice or playback sends text; loading the Edge catalog sends no text.</p>
    {languages.map(({ locale, label }) => {
      const voices = [...new Map(state.voices.filter(voice => browserVoiceMatches(voice, locale)).map(voice => [browserVoiceKey(voice), voice])).values()]
        .sort((left, right) => Number(right.localService) - Number(left.localService) || left.name.localeCompare(right.name) || left.lang.localeCompare(right.lang))
      const selected = workspace.preferences.speechVoices?.[locale]
      const edgeVoices = edgeAvailable ? edge.voices.filter(voice => languageMatches(voice.locale, locale))
        .sort((left, right) => left.locale.localeCompare(right.locale) || left.name.localeCompare(right.name)) : []
      const value = selected ? speechVoiceKey(selected) : ''
      const listed = selected && (isEdgeVoice(selected)
        ? edgeVoices.some(voice => voice.id === selected.voice)
        : voices.some(voice => browserVoiceKey(voice) === value))
      const unavailable = Boolean(selected && !listed && (!isEdgeVoice(selected) || !edgeAvailable || !edge.loading))
      return <div key={locale}>
        <label htmlFor={`${id}-${locale}`}>{label} voice
        <select id={`${id}-${locale}`} disabled={busy || voiceSetup === 'loading'} value={value}
          aria-describedby={`${id}-help ${id}-privacy${unavailable ? ` ${id}-${locale}-unavailable` : ''}`}
          onChange={event => {
            const key = event.target.value
            const voice = voices.find(item => browserVoiceKey(item) === key)
            const edgeVoice = edgeVoices.find(item => `edge:${item.id}` === key)
            void run(async () => {
              if (key && !voice && !edgeVoice) throw new Error('That voice is no longer available. Refresh the voice list and choose again.')
              const metadata: SpeechVoicePreference | undefined = edgeVoice ? { provider: 'edge', voice: edgeVoice.id }
                : voice ? { voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang, localService: voice.localService } : undefined
              await savePreferences({ speechVoices: { [locale]: metadata } })
            })
          }}>
          <option value="">Automatic (local first)</option>
          {selected && !listed && <option value={value} disabled>{voiceLabel(selected)} — {isEdgeVoice(selected) && edgeAvailable && edge.loading ? 'Loading' : 'Unavailable'}</option>}
          {voices.length > 0 && <optgroup label="Browser voices">
            {voices.map(voice => <option key={browserVoiceKey(voice)} value={browserVoiceKey(voice)}>{voiceLabel(voice)}</option>)}
          </optgroup>}
          {edgeVoices.length > 0 && <optgroup label="Edge TTS (online)">
            {edgeVoices.map(voice => <option key={voice.id} value={`edge:${voice.id}`}>{voice.name} — {voice.gender} — Edge TTS</option>)}
          </optgroup>}
        </select></label>
        <HearButton text={locale === 'en-US' ? 'Hello! This is your English voice.' : '你好！这是你选择的中文声音。'}
          locale={locale} label={`Test ${label} voice`} buttonText="Test voice"
          disabled={busy || voiceSetup === 'loading' || unavailable || (isEdgeVoice(selected) && edge.loading)} />
        {unavailable && <p className="notice" id={`${id}-${locale}-unavailable`} role="status">Your saved {label} voice is not currently available. Hear will not use a different voice. Choose another voice or Automatic, or refresh after enabling the saved voice.</p>}
        {!state.loading && !state.error && voices.length === 0 && !selected && <p className="small muted">No {label} voices are listed by this browser. Automatic can still request a system voice for {label}. Use Test voice to try it; Android may speak even with an empty list.</p>}
      </div>
    })}
    {state.loading && <p className="small muted" role="status">Looking for browser voices...</p>}
    {state.error && <p className="notice error" role="alert">Browser voices: {state.error}</p>}
    {edgeAvailable && edge.loading && <p className="small muted" role="status">Loading Edge voices...</p>}
    {edgeAvailable && edge.error && <p className="notice error" role="alert">{edge.error}</p>}
    {!edgeAvailable && <p className="small muted">Edge TTS is available only through the local development server.</p>}
    <button type="button" className="button secondary" disabled={busy} onClick={() => {
      clearVoiceCache()
      setRefresh(value => value + 1)
    }}>Refresh voice list</button>
    <p className="small muted">Refresh clears the page-session voice cache and checks again briefly; it does not change your saved selections. A missing selected voice never silently switches to another voice.</p>
  </section>
}
