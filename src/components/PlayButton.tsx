import { useEffect, useId } from 'react'
import { Volume2 } from 'lucide-react'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../core/assistant/speech'
import { getPack, spokenText } from '../core/language'

/** Speaks a word or a whole sentence in the learning language (the pack decides the spoken text; a word may carry its reading). */
function speak(id: string, text: string, kind: 'word' | 'sentence', reading?: string) {
  stopBrowserSpeech()
  playBrowserSpeech(id, spokenText(getPack().speechLocale, text, { kind, ...(kind === 'word' && reading ? { reading } : {}) }), getPack().speechLocale)
}

/** A small speaker button that sits right beside a word or a sentence and plays it with the app's normal speech. Labelled "Play the word" or "Play the sentence". */
export function PlayButton({ text, kind, reading }: { text: string; kind: 'word' | 'sentence'; reading?: string }) {
  const id = useId()
  useEffect(() => () => { if (getPlaybackState().activeId === id) stopBrowserSpeech() }, [id])
  const label = `Play the ${kind}`
  return <button type="button" className="button secondary snippet-button icon-only play-button" aria-label={label} title={label} onClick={() => speak(id, text, kind, reading)}><Volume2 size={15} /></button>
}


