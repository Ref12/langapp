import { savePreferences } from '../core/learning'
import type { Workspace } from '../core/model'
import { stopBrowserSpeech } from '../core/assistant/speech'
import { WRITING_SPEECH, WRITING_SPEECH_LABEL, writingSpeechMode, type WritingSpeech } from '../core/writing-speech'

/** "Say the character" in the writing practice: At transitions (default), Every stroke or Off. */
export function WritingSpeechSelect({ workspace, busy, run }: { workspace: Workspace; busy: boolean; run: (operation: () => Promise<void>) => Promise<void> }) {
  const mode = writingSpeechMode(workspace.preferences)
  return <label className="page-settings-field">Say the character
    <select value={mode} disabled={busy} onChange={event => {
      const next = event.target.value as WritingSpeech
      if (next === 'off') stopBrowserSpeech()
      void run(() => savePreferences(next === 'off' ? { writingSpeech: 'off', writingSpeechResume: mode === 'stroke' ? 'stroke' : 'transitions' } : { writingSpeech: next, writingSpeechResume: next }))
    }}>{WRITING_SPEECH.map(value => <option key={value} value={value}>{WRITING_SPEECH_LABEL[value]}</option>)}</select></label>
}
