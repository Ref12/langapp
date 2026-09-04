import { useEffect, useState } from 'react'
import { LoaderCircle, Volume2 } from 'lucide-react'
import {
  availableSpeechVoice,
  canReadAloud,
  readAloud,
  watchSpeechVoices,
} from '../core/speech'

export function SpeechControls({
  text,
  language,
}: {
  text: string
  language: string
}) {
  const [rate, setRate] = useState(0.75)
  const [voiceName, setVoiceName] = useState(() =>
    availableSpeechVoice(language),
  )
  const [status, setStatus] = useState('')
  const [playing, setPlaying] = useState(false)

  useEffect(
    () =>
      watchSpeechVoices(language, (name) => {
        setVoiceName(name)
      }),
    [language],
  )

  const play = () => {
    setPlaying(true)
    setStatus('Starting speech…')
    try {
      const selectedVoice = readAloud(text, language, rate, {
        onStart(name) {
          setVoiceName(name)
          setStatus(`Speaking with ${name}.`)
        },
        onEnd(name) {
          setVoiceName(name)
          setStatus(`Played with ${name}.`)
          setPlaying(false)
        },
        onError(message) {
          setStatus(message)
          setPlaying(false)
        },
      })
      setVoiceName(selectedVoice)

      // Some Android engines do not fire end/error for very short utterances.
      window.setTimeout(() => setPlaying(false), 8_000)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Speech playback failed.')
      setPlaying(false)
    }
  }

  return (
    <div className="speech-controls">
      <label>
        Speed <output>{rate.toFixed(2)}×</output>
        <input
          type="range"
          min="0.25"
          max="1"
          step="0.05"
          value={rate}
          onChange={(event) => setRate(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        onClick={play}
        disabled={!canReadAloud() || playing}
      >
        {playing ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Volume2 size={16} />
        )}
        Read aloud
      </button>
      <small>
        Voice:{' '}
        {voiceName || `system default requested with language ${language}`}
      </small>
      {status && <small className="speech-status">{status}</small>}
    </div>
  )
}
