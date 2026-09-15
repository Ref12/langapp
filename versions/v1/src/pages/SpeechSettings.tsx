import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { canReadAloud, type PlaybackPreferences } from '../core/speech'
import { clearSpeechConnection, loadPlaybackPreferences, savePlaybackPreferences, saveSpeechConnection, speechConnectionStatus } from '../core/voice/connection'
import { getVoiceStorageUsage, requestVoiceStoragePersistence } from '../core/voice/storage'
import type { SpeechLocale } from '../core/voice/contracts'

export function SpeechSettings() {
  const connection = useLiveQuery(speechConnectionStatus, [])
  const storageBytes = useLiveQuery(getVoiceStorageUsage, [])
  const [region, setRegion] = useState('')
  const [key, setKey] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [status, setStatus] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [preferences, setPreferences] = useState<PlaybackPreferences>(loadPlaybackPreferences)
  useEffect(() => { if (connection) setRegion(connection.region) }, [connection])
  useEffect(() => {
    if (!canReadAloud()) return
    const refresh = () => setVoices(window.speechSynthesis.getVoices())
    refresh()
    window.speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh)
  }, [])
  const changePreference = (locale: SpeechLocale, value: { rate?: number; voiceURI?: string }) => {
    const next = { ...preferences, [locale]: { rate: 0.9, ...preferences[locale], ...value } }
    setPreferences(next)
    try { savePlaybackPreferences(next) }
    catch { setStatus('Playback preferences could not be saved in this browser.') }
  }
  return <section className="settings-section">
    <h2>Voice and pronunciation</h2>
    <p>Azure Speech transcribes English plus your active Mandarin, Japanese or Korean profile. The conversation model still uses the independent AI connection above.</p>
    <div className="warning-box"><p>Your speech key is stored in plaintext in this browser, separately from normal settings. Use a restricted key and spending limits, never a shared device. Speech keys are excluded from every backup and must be re-entered on another device.</p></div>
    <form className="form-stack" onSubmit={async event => {
      event.preventDefault()
      try {
        await saveSpeechConnection(region, key, acknowledged)
        setKey('')
        setStatus('Azure Speech settings saved. Live service access is checked when you record or assess, not by this save.')
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save speech settings.') }
    }}>
      <label>Azure Speech region<input value={region} onChange={event => setRegion(event.target.value)} placeholder="eastus" required autoComplete="off" /></label>
      <label>Azure Speech key<input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder={connection?.configured ? 'Stored key — enter to replace' : 'Speech resource key'} autoComplete="off" /></label>
      <label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I understand this speech key is stored in plaintext in my browser.</label>
      <div className="button-row"><button type="submit" className="primary-button">Save speech connection</button>
        {connection && <button type="button" onClick={async () => {
          try { await clearSpeechConnection(); setKey(''); setStatus('Speech credentials cleared.') }
          catch { setStatus('Could not clear speech credentials.') }
        }}>Clear speech key</button>}
      </div>
    </form>
    <p>Microphone permission and audio-transfer consent are requested separately in Conversation. Recording needs HTTPS/localhost and AudioWorklet support. Silence never sends a turn.</p>
    <h3>Reply voices</h3>
    <p>Voices come from your browser/system and may use online services. Missing voices leave replies readable; use Play reply when automatic playback is blocked.</p>
    {!canReadAloud() && <p>Speech synthesis is not supported in this browser.</p>}
    <div className="voice-preferences">
      {(['en-US', 'zh-CN', 'ja-JP', 'ko-KR'] as const).map(locale => {
        const matching = voices.filter(voice => voice.lang.toLowerCase().split('-')[0] === locale.split('-')[0])
        return <div className="voice-preference" key={locale}>
          <label>{locale} voice<select value={preferences[locale]?.voiceURI ?? ''} onChange={event => changePreference(locale, { voiceURI: event.target.value })}>
            <option value="">{matching.length ? 'Automatic matching voice' : 'No matching voice available'}</option>
            {matching.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
          </select></label>
          <label>{locale} rate ({preferences[locale]?.rate ?? 0.9}×)<input type="range" min="0.25" max="1.25" step="0.05" value={preferences[locale]?.rate ?? 0.9} onChange={event => changePreference(locale, { rate: Number(event.target.value) })} /></label>
        </div>
      })}
    </div>
    <h3>Recording storage</h3>
    <p>{((storageBytes ?? 0) / 1024 / 1024).toFixed(2)} MiB of local audio. Delete individual takes or a thread’s voice data in Conversation. Browsers can clear local data; keep your own backup.</p>
    <button onClick={async () => {
      const persisted = await requestVoiceStoragePersistence()
      setStatus(persisted ? 'Persistent storage was granted for this site.' : 'Persistent storage was not granted or is unsupported. Export a backup to protect recordings.')
    }}>Request persistent device storage</button>
    {status && <p role="status">{status}</p>}
  </section>
}
