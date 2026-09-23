import { useState } from 'react'
import { savePreferences } from '../core/learning'
import { PageHeading, type PageProps } from '../components/shared'
import { AIConnectionSettings } from '../components/assistant/AIConnectionSettings'
import { SpeechConnectionSettings } from '../components/assistant/SpeechConnectionSettings'
import { VoiceSettings } from '../components/assistant/VoiceSettings'
import { ProfileSettings } from '../components/ProfileSettings'

export function Settings({ workspace, busy: workspaceBusy, run }: PageProps) {
  const [name, setName] = useState(workspace.preferences.name)
  const [notice, setNotice] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [aiBusy, setAIBusy] = useState(false)
  const [speechBusy, setSpeechBusy] = useState(false)
  const busy = workspaceBusy || profileBusy || aiBusy || speechBusy
  return <>
    <PageHeading eyebrow="YOUR OWN PACE. YOUR OWN SPACE." title="Your workspace.">A local Mandarin learning space, separate from the original app.</PageHeading>
    <ProfileSettings busy={workspaceBusy || aiBusy || speechBusy} onBusyChange={setProfileBusy} />
    <form className="panel settings-form" onSubmit={event => {
      event.preventDefault()
      void run(async () => { await savePreferences({ name }); setNotice('Workspace name saved.') })
    }}><h2>Make it yours</h2><label>Workspace name<input maxLength={80} required disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>
      <p className="small muted">English / Mandarin (Simplified Chinese). Other languages will be added separately.</p>
      <button className="button primary" disabled={busy}>Save name</button>
    </form>
    <section className="panel settings-form"><h2>Reading and appearance</h2>
      <label>Theme<select disabled={busy} value={workspace.preferences.theme} onChange={event => {
        const theme = event.target.value === 'light' ? 'light' : 'dark'
        void run(() => savePreferences({ theme }))
      }}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label className="toggle"><input type="checkbox" disabled={busy} checked={workspace.preferences.pinyin} onChange={event => void run(() => savePreferences({ pinyin: event.target.checked }))} /> Pinyin for unfamiliar words</label>
      <p className="small muted">Vocabulary in lessons, meaning practice, reading, and the dictionary shows pinyin until it reaches Learned: unaided correct answers on three separate days across both recognition activities. Character-selection questions hide pinyin until the answer is revealed or checked. A miss or revealed answer brings pronunciation support back. Revealing an answer is still recorded as assistance.</p>
    </section>
    <VoiceSettings workspace={workspace} busy={busy} run={run} />
    <AIConnectionSettings busy={workspaceBusy || profileBusy || speechBusy} onBusyChange={setAIBusy} />
    <SpeechConnectionSettings busy={workspaceBusy || profileBusy || aiBusy} onBusyChange={setSpeechBusy} />
    <section className="panel"><h2>Keep your learning safe</h2><p>Your profiles are saved in this browser, not synced to an account. Clearing site data or using private browsing can remove them. Export a profile regularly using the controls above.</p>
      <p className="small muted">Profile YAML files contain settings and credentials, knowledge and learning progress, Assistant conversations, and saved practice results including recognized transcripts. Keep exported files private. Raw recordings are never stored. Previous root-app JSON backups can still be imported without changing credentials; archived v1 backups are not compatible. Restored requests never send automatically, and practice results remain excluded from AI tutor context.</p>
    </section>
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="panel"><h2>About this checkpoint</h2><p>The 30-level Mandarin course includes an HSK 1-6 preparation map with skill and mock-test lesson outlines. Beginner levels 1-4 offer vocabulary-recognition lessons and grammar references, with whole-lesson visual and guided-audio views in the level-1 pilot. Later course levels and readiness lessons are plans, not playable assessments. Assistant supports Conversation and Shadow with typed input or opt-in voice input and replies. Playback uses your saved voice selections; Automatic prefers local voices and uses online browser voices when needed, sharing the spoken text with that voice service.</p>
      <p>Enable Voice input and replies in conversation settings, choose English or Mandarin, and tap the mic to dictate after the cue. Stop to review or Submit to send. Browser recognition may use an online speech service; conversation transcripts go to your AI provider only when sent. Replies are spoken without restarting the microphone. Reloading never starts recording or replays old replies.</p>
      <p>Practice plays the phrase first. Recording is opt-in: Listen and record sounds a short cue when the microphone is ready. Conversation's Submit shows feedback inline; Shadow automatically adds feedback when recording finishes. Azure Speech receives the audio and expected phrase only when Speech feedback is enabled and a connection is configured. Otherwise, the app compares a browser-recognized transcript locally; the browser may use an online recognition service. Results never go to the AI tutor, including in later turns. Raw recordings are never stored.</p>
      <p>Speech assessments are practice feedback, not evidence of mastery or official HSK certification. Hands-free turn-taking, generated activities, and handwriting assessment are not connected.</p>
      <div className="button-row"><a href="./v1/" className="button secondary">Open original app (v1)</a><a href="./preview.html" className="button secondary">Open design mockups</a></div>
    </section>
  </>
}
