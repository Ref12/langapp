import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Repeat2 } from 'lucide-react'
import { db } from '../core/database'
import { practiceHistoryEntrySchema, type PracticeHistoryEntry } from '../core/assistant/contracts'
import { interruptAudio } from '../core/assistant/audio-owner'
import { stopBrowserSpeech } from '../core/assistant/speech'
import { PracticePlaylist } from '../components/assistant/PracticePlaylist'
import { Pinyin } from '../components/Pinyin'

export function History() {
  const entries = useLiveQuery(async () => (await db.practiceHistory.orderBy('lastOpenedAt').reverse().toArray())
    .map(entry => practiceHistoryEntrySchema.parse(entry)), [])
  const [practice, setPractice] = useState<PracticeHistoryEntry>()
  const [error, setError] = useState('')
  return <section className="phrase-history">
    <div className="page-heading"><div><p className="eyebrow">HISTORY</p><h1>Recently practiced phrases</h1>
      <p>Reopen a phrase to practice again. Each phrase appears once, most recent first.</p></div></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!entries ? <p role="status">Loading phrase history...</p>
      : !entries.length ? <div className="empty-state"><h2>No phrases yet</h2>
        <p>Open Phrase Practice from the Assistant or a text selection to add a phrase here.</p>
        <a className="button secondary" href="#conversation">Open Assistant</a></div>
        : <ol className="phrase-history-list">{entries.map(entry => <li key={entry.text}>
          <button type="button" className="phrase-history-entry" aria-label={`Practice ${entry.text}`} onClick={() => {
            setError('')
            try {
              interruptAudio()
              const failure = stopBrowserSpeech()
              if (failure) throw new Error(failure)
              setPractice(entry)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Other audio could not be stopped. Try Practice again.')
            }
          }}>
            <span><span className="speech-native" lang="zh-Hans">{entry.text}</span>
              {entry.phrase.romanization && <span className="pinyin" lang="zh-Latn"><Pinyin text={entry.phrase.romanization} /></span>}
              {entry.phrase.meaning && <span className="small muted">{entry.phrase.meaning}</span>}
              <time className="small muted" dateTime={new Date(entry.lastOpenedAt).toISOString()}>{new Date(entry.lastOpenedAt).toLocaleString()}</time>
            </span><Repeat2 size={20} aria-hidden="true" />
          </button>
        </li>)}</ol>}
    {practice && <PracticePlaylist key={practice.text} phrase={practice.phrase} rate={practice.rate}
      savedEnds={practice.chain?.ends} savedItems={practice.chain?.items} busy={false} recordingActive={false}
      saveNotice="This playlist is saved in History. Editing it here does not change the source conversation."
      onClose={async () => setPractice(undefined)} />}
  </section>
}
