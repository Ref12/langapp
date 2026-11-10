import { useContext, useState } from 'react'
import { getPack, isAreaOn, readingTitle } from '../core/language'
import { savePreferences } from '../core/learning'
import { formOptionLabel } from '../core/forms/display'
import { tokensToRomaji } from '../core/reading/romaji'
import { resolveDisplaySettings, usePackFormsTable } from '../components/display-context'
import { PageHeading, type PageProps } from '../components/shared'
import { AIConnectionSettings } from '../components/assistant/AIConnectionSettings'
import { SpeechConnectionSettings } from '../components/assistant/SpeechConnectionSettings'
import { VoiceSettings } from '../components/assistant/VoiceSettings'
import { HandsfreeDefaults } from '../components/handsfree/HandsfreeSettingsForm'
import { ProfileSettings } from '../components/ProfileSettings'
import { BackupPanel } from '../components/BackupPanel'
import { Diagnostics } from '../components/Diagnostics'
import { hapticsSupported } from '../core/haptics'
import { WritingSpeechSelect } from '../components/WritingSpeechSelect'
import { DEFAULT_PINYIN_FORMAT, pinyinFormatSchema } from '../core/pinyin'
import { LocalPinyinSetupContext } from '../components/assistant/local-ai-setup-context'

export function Settings({ workspace, busy: workspaceBusy, run }: PageProps) {
  const pinyinSetup = useContext(LocalPinyinSetupContext)
  const pack = getPack()
  const [name, setName] = useState(workspace.preferences.name)
  const [notice, setNotice] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [aiBusy, setAIBusy] = useState(false)
  const [speechBusy, setSpeechBusy] = useState(false)
  const busy = workspaceBusy || profileBusy || aiBusy || speechBusy
  const formsTable = usePackFormsTable()
  const { form: displayForm, readingStyle } = resolveDisplaySettings(workspace.preferences)
  return <>
    <PageHeading eyebrow="YOUR OWN PACE. YOUR OWN SPACE." title="Your workspace.">{`A local ${pack.wording.language} learning space, separate from the original app.`}</PageHeading>
    <ProfileSettings busy={workspaceBusy || aiBusy || speechBusy} onBusyChange={setProfileBusy} />
    <BackupPanel busy={busy} />
    <form className="panel settings-form" onSubmit={event => {
      event.preventDefault()
      void run(async () => { await savePreferences({ name }); setNotice('Workspace name saved.') })
    }}><h2>Make it yours</h2><label>Workspace name<input maxLength={80} required disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>
      <p className="small muted">{pack.id === 'zh' ? 'English / Mandarin (Simplified Chinese). Other languages will be added separately.' : `English / ${pack.wording.language}.`}</p>
      <button className="button primary" disabled={busy}>Save name</button>
    </form>
    <section className="panel settings-form" aria-labelledby="answer-mode"><h2 id="answer-mode">How you answer in practice</h2>
      <p className="small muted">Practice sets pick the exercises and their direction for you. This is the one choice you make: how you give typed answers. Each question also has an "answer another way" control.</p>
      <div className="segmented" role="group" aria-label="I answer by">
        {(['type', 'speak', 'write'] as const).map(mode => <button key={mode} type="button" disabled={busy} aria-pressed={(workspace.preferences.answerMode ?? 'type') === mode} onClick={() => void run(() => savePreferences({ answerMode: mode }))}>{mode === 'type' ? 'I answer by typing' : mode === 'speak' ? 'I answer by speaking' : 'I answer by handwriting'}</button>)}</div>
      {isAreaOn(pack, 'writing') && <label className="toggle"><input type="checkbox" disabled={busy} checked={workspace.preferences.practiseWriting !== false} onChange={event => void run(() => savePreferences({ practiseWriting: event.target.checked }))} /> Practise writing characters (yes or no)</label>}
    </section>
    <section className="panel settings-form"><h2>Reading and appearance</h2>
      <label>Theme<select disabled={busy} value={workspace.preferences.theme} onChange={event => {
        const theme = event.target.value === 'light' ? 'light' : 'dark'
        void run(() => savePreferences({ theme }))
      }}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label className="toggle"><input type="checkbox" disabled={busy} checked={workspace.preferences.pinyin} onChange={event => void run(() => savePreferences({ pinyin: event.target.checked }))} /> {`${readingTitle(pack)} for unfamiliar words`}</label>
      <label className="toggle"><input type="checkbox" disabled={busy || !hapticsSupported()} checked={workspace.preferences.haptics !== false} onChange={event => void run(() => savePreferences({ haptics: event.target.checked }))} /> Vibration feedback{!hapticsSupported() && ' (not available on this device)'}</label>
      {isAreaOn(pack, 'writing') && <WritingSpeechSelect workspace={workspace} busy={busy} run={run} />}
      <label>About this many exercises per lesson<input type="number" min={8} max={40} step={1} disabled={busy} defaultValue={workspace.preferences.exercisesPerLesson ?? 20} key={workspace.preferences.exercisesPerLesson ?? 20}
        onBlur={event => { const value = Number(event.target.value); if (value !== (workspace.preferences.exercisesPerLesson ?? 20)) void run(() => savePreferences({ exercisesPerLesson: Math.min(40, Math.max(8, Math.round(value) || 20)) })) }} />
        <span className="small muted">A guide for what the AI is asked to write, 8 to 40, default 20; a lesson keeps the exercises that pass checking. More than 20 are written in parallel requests of up to 20.</span></label>
      {pack.displayForms && formsTable && <label>Show verbs as<select disabled={busy} value={displayForm} onChange={event => void run(() => savePreferences({ displayForm: event.target.value }))}>
        {pack.displayForms.choices.map(choice => <option key={choice.id} value={choice.id}>{formOptionLabel(pack.displayForms!, formsTable, choice.id)}</option>)}
      </select></label>}
      {pack.readingStyles && pack.readingStyles.choices.length > 1 && <label>Readings<select disabled={busy} value={readingStyle} onChange={event => void run(() => savePreferences({ readingStyle: event.target.value === 'romaji' ? 'romaji' : 'kana' }))}>
        {pack.readingStyles.choices.map(choice => <option key={choice} value={choice}>{choice === 'kana' ? 'Kana' : 'Romaji'} ({choice === 'kana' ? pack.readingStyles!.sample.join('') : tokensToRomaji(pack.readingStyles!.sample.map(reading => ({ reading })), pack.romaji)})</option>)}
      </select></label>}
      {pack.readings === 'pinyin' && <>
      <label>Pinyin format<select disabled={busy || pinyinSetup === 'loading'} value={workspace.preferences.pinyinFormat ?? DEFAULT_PINYIN_FORMAT} onChange={event => {
        const value = event.target.value
        void run(() => savePreferences({ pinyinFormat: pinyinFormatSchema.parse(value) }))
      }}>
        <option value="marks">Tone marks — wǒ</option>
        <option value="marks-and-numbers">Tone marks and numbers — wǒ3</option>
        <option value="numbers">Tone numbers — wo3</option>
      </select></label>
      <label>Japanese reading format<select disabled={busy} value={workspace.preferences.japaneseReading ?? 'romaji'} onChange={event => {
        const japaneseReading = event.target.value === 'kana' ? 'kana' : 'romaji'
        void run(() => savePreferences({ japaneseReading }))
      }}>
        <option value="romaji">Romaji — gakusei</option>
        <option value="kana">Kana — がくせい</option>
      </select></label>
      <p className="small muted">Japanese readings sit where pinyin does, and Korean shows Revised Romanization there (haksaeng). Both follow the pinyin switch above.</p>
      <p className="small muted">Applies immediately to displayed pinyin throughout this profile, including saved Assistant replies and practice. Numbered formats use 5 for the neutral tone. This does not change saved pronunciation, speech, or when pinyin is hidden.</p>
      {pinyinSetup === 'error' && <p className="connection-error" role="alert">Local pinyin settings could not be loaded. Check default.yaml and browser storage, or choose a format here.</p>}
      <p className="small muted">Vocabulary in lessons, meaning practice, reading, and the dictionary shows pinyin until it reaches Learned: unaided correct answers on three separate days across both recognition activities. Character-selection questions hide pinyin until the answer is revealed or checked. A miss or revealed answer brings pronunciation support back. Revealing an answer is still recorded as assistance.</p>
      </>}
      {pack.readings !== 'pinyin' && <p className="small muted">{`Vocabulary in lessons shows its ${pack.wording.reading} until it reaches Learned: unaided correct answers on three separate days. A miss or revealed answer brings the ${pack.wording.reading} back.`}</p>}
    </section>
    <VoiceSettings workspace={workspace} busy={busy} run={run} />
    {isAreaOn(pack, 'handsFree') && <HandsfreeDefaults />}
    <AIConnectionSettings busy={workspaceBusy || profileBusy || speechBusy} onBusyChange={setAIBusy} />
    <SpeechConnectionSettings busy={workspaceBusy || profileBusy || aiBusy} onBusyChange={setSpeechBusy} />
    <Diagnostics />
    <section className="panel"><h2>Keep your learning safe</h2><p>Your profiles are saved in this browser and are not synced to an account. Clearing site data or using private browsing can remove them. Set up the GitHub cloud backup in the Cloud backup panel above to keep an off-device copy (press Back up now to update it), and still export a profile now and then using the controls above.</p>
      <p className="small muted">Profile YAML files contain settings and credentials, knowledge and learning progress, Assistant conversations, and saved practice results including recognized transcripts. Keep exported files private. Raw recordings are never stored. Previous root-app JSON backups can still be imported without changing credentials; archived v1 backups are not compatible. Restored requests never send automatically, and practice results remain excluded from AI tutor context.</p>
    </section>
    {notice && <p className="notice success" role="status">{notice}</p>}
    {isAreaOn(pack, 'wordLists') && <section className="panel"><h2>About this checkpoint</h2><p>The 30-level Mandarin course includes an HSK 1-6 preparation map with skill and mock-test lesson outlines. Beginner levels 1-4 offer vocabulary-recognition lessons and grammar references, with whole-lesson visual and guided-audio views in the level-1 pilot. Later course levels and readiness lessons are plans, not playable assessments. Assistant supports Conversation and Shadow with typed input or opt-in voice input and replies. Playback uses your saved voice selections; Automatic prefers local voices and uses online browser voices when needed, sharing the spoken text with that voice service.</p>
      <p>Enable Voice input and replies in conversation settings, choose English or Mandarin, and tap the mic to dictate after the cue. Stop to review or Submit to send. Browser recognition may use an online speech service; conversation transcripts go to your AI provider only when sent. Replies are spoken without restarting the microphone. Reloading never starts recording or replays old replies.</p>
      <p>Practice plays the phrase first. Recording is opt-in: Listen and record sounds a short cue when the microphone is ready. Conversation's Submit shows feedback inline; Shadow automatically adds feedback when recording finishes. Azure Speech receives the audio and expected phrase only when Speech feedback is enabled and a connection is configured. Otherwise, the app compares a browser-recognized transcript locally; the browser may use an online recognition service. Results never go to the AI tutor, including in later turns. Raw recordings are never stored.</p>
      <p>Speech assessments are practice feedback, not evidence of mastery or official HSK certification. Hands-free turn-taking, generated activities, and handwriting assessment are not connected.</p>
      <div className="button-row"><a href="./preview.html" className="button secondary">Open design mockups</a></div>
    </section>}
  </>
}
