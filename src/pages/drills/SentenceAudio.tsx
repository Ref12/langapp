import { useEffect, useId, useRef } from 'react'
import { Volume2 } from 'lucide-react'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../../core/assistant/speech'
import { getPack, spokenText } from '../../core/language'

/** Shown in the feedback once an answer is revealed: speaks the whole sentence in the learning language (the pack decides the spoken text), plays it by itself once when auto-play is on, and stops when the question goes away (Next). */
export function SentenceAudio({ text, autoPlay }: { text: string; autoPlay?: boolean }) {
  const id = useId()
  const auto = useRef(autoPlay)
  auto.current = autoPlay
  const textRef = useRef(text)
  textRef.current = text
  const played = useRef(false)
  const say = () => {
    played.current = true
    stopBrowserSpeech()
    playBrowserSpeech(id, spokenText(getPack().speechLocale, textRef.current, { kind: 'sentence' }), getPack().speechLocale)
  }
  useEffect(() => {
    if (auto.current) { try { say() } catch (reason) { console.error('Sentence speech failed.', reason) } }
    return () => { if (played.current || getPlaybackState().activeId === id) stopBrowserSpeech() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <p className="engine-sentence-audio"><button type="button" className="button secondary snippet-button" onClick={say}><Volume2 size={15} /> Play sentence</button></p>
}
