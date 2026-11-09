import { useEffect, useState } from 'react'
import { Square, Volume2 } from 'lucide-react'
import type { ParallelLanguage } from '../core/parallel/data'

const LANG: Record<ParallelLanguage, string> = { ja: 'ja-JP', ko: 'ko-KR' }

/** Says Japanese or Korean text with the browser's ja-JP / ko-KR voice. (The Chinese Hear button's voice settings stay Mandarin-only.) */
export function ParallelHear({ text, language, label = 'Hear' }: { text: string; language: ParallelLanguage; label?: string }) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => { if (playing) window.speechSynthesis?.cancel() }, [playing])
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return null
  const toggle = () => {
    if (playing) { synth.cancel(); setPlaying(false); return }
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = LANG[language]
    const voice = synth.getVoices().find(item => item.lang.replace('_', '-').toLowerCase().startsWith(language))
    if (voice) utterance.voice = voice
    utterance.onend = utterance.onerror = () => setPlaying(false)
    setPlaying(true)
    synth.speak(utterance)
  }
  return <button type="button" className="button secondary snippet-button icon-only" aria-label={playing ? 'Stop playback' : label} title={playing ? 'Stop' : 'Hear'} onClick={toggle}>
    {playing ? <Square size={15} /> : <Volume2 size={15} />}</button>
}
