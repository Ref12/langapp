import { useEffect, useId } from 'react'
import { Square, Volume2 } from 'lucide-react'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../core/assistant/speech'
import { getPack, spokenText } from '../core/language'
import { SpeechError, useSpeechButton } from './useSpeechButton'

/** The text a word or a sentence is spoken as (the pack decides; a word may carry its reading). */
export function spokenFor(text: string, kind: 'word' | 'sentence', reading?: string) {
  return spokenText(getPack().speechLocale, text, { kind, ...(kind === 'word' && reading ? { reading } : {}) })
}

/** A small speaker button that sits right beside a word or a sentence and plays it with the app's normal speech. Labelled "Play the word" or "Play the sentence"; while it plays (or the same text plays automatically) it is a Stop button. */
export function PlayButton({ text, kind, reading }: { text: string; kind: 'word' | 'sentence'; reading?: string }) {
  const id = useId()
  const spoken = spokenFor(text, kind, reading)
  const { active, error, stopLabel } = useSpeechButton(id, spoken)
  useEffect(() => () => { if (getPlaybackState().activeId === id) stopBrowserSpeech() }, [id])
  const label = `Play the ${kind}`
  return <><button type="button" className="button secondary snippet-button icon-only play-button" aria-label={active ? stopLabel : label} title={active ? stopLabel : label}
    onClick={() => { if (active) stopBrowserSpeech(); else { stopBrowserSpeech(); playBrowserSpeech(id, spoken, getPack().speechLocale) } }}>{active ? <Square size={15} /> : <Volume2 size={15} />}</button><SpeechError error={error} /></>
}
