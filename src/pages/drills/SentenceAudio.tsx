import { useEffect, useId, useRef } from 'react'
import { PlayButton } from '../../components/PlayButton'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../../core/assistant/speech'
import { getPack, spokenText } from '../../core/language'

/** Shown in the feedback once an answer is revealed: plays the whole sentence in the learning language (the pack decides the spoken text), plays it by itself once when auto-play is on, and stops when the question goes away (Next). */
export function SentenceAudio({ text, autoPlay, button = true, kind = 'sentence', reading }: { text: string; autoPlay?: boolean; kind?: 'word' | 'sentence'; reading?: string; /** The small play button; off when the question already shows one beside its sentence. */ button?: boolean }) {
  const id = useId()
  const auto = useRef(autoPlay)
  auto.current = autoPlay
  const textRef = useRef(text)
  textRef.current = text
  const played = useRef(false)
  const say = () => {
    played.current = true
    stopBrowserSpeech()
    playBrowserSpeech(id, spokenText(getPack().speechLocale, textRef.current, { kind, ...(kind === 'word' && reading ? { reading } : {}) }), getPack().speechLocale)
  }
  useEffect(() => {
    if (auto.current) { try { say() } catch (reason) { console.error('Sentence speech failed.', reason) } }
    return () => { if (played.current || getPlaybackState().activeId === id) stopBrowserSpeech() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return button ? <p className="engine-sentence-audio"><PlayButton text={text} kind={kind} reading={reading} /></p> : null
}
