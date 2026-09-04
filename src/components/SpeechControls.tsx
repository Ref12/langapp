import { useEffect, useState } from 'react'
import { LoaderCircle, Volume2 } from 'lucide-react'
import {
  canReadAloud,
  loadSpeechVoice,
  readAloud,
} from '../core/speech'

export function SpeechControls({
  text,
  language,
}: {
  text: string
  language: string
}) {
  const [rate, setRate] = useState(0.75)
  const [voiceName, setVoiceName] = useState('')
  const [status, setStatus] = useState('')
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let active = true
    if (!canReadAloud()) {
      setStatus('Read aloud is not supported by this browser.')
      return
    }
    loadSpeechVoice(language)
      .then((voice) => {
        if (active) {
          setVoiceName(voice.name)
          setStatus('')
        }
      })
      .catch((error) => {
        if (active) {
          setStatus(
            error instanceof Error ? error.message : 'No speech voice found.',
          )
        }
      })
    return () => {
      active = false
    }
  }, [language])

  const play = async () => {
    setPlaying(true)
    setStatus('Speaking…')
    try {
      const usedVoice = await readAloud(text, language, rate)
      setVoiceName(usedVoice)
      setStatus(`Played with ${usedVoice}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Speech playback failed.')
    } finally {
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
        disabled={!canReadAloud() || playing || !voiceName}
      >
        {playing ? <LoaderCircle className="spin" size={16} /> : <Volume2 size={16} />}
        Read aloud
      </button>
      {voiceName && <small>Voice: {voiceName}</small>}
      {status && <small className="speech-status">{status}</small>}
    </div>
  )
}
