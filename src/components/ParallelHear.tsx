import { useEffect, useState } from 'react'
import { MessageCircle, MoreHorizontal, PenLine, Repeat2, Square, Volume2 } from 'lucide-react'
import type { ParallelLanguage } from '../core/parallel/data'
import { prepareAssistantDraft } from '../core/assistant/draft-actions'
import { openWritingSheet } from '../core/characters/writing-sheet'
import { navigate } from '../core/routing'
import { ActionMenu } from './assistant/ActionMenu'

const LANG: Record<ParallelLanguage, string> = { ja: 'ja-JP', ko: 'ko-KR' }
const NAME: Record<ParallelLanguage, string> = { ja: 'Japanese', ko: 'Korean' }

function useSpeech(text: string, language: ParallelLanguage) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => { if (playing) window.speechSynthesis?.cancel() }, [playing])
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  const available = !!synth && typeof SpeechSynthesisUtterance !== 'undefined'
  const toggle = () => {
    if (!synth) return
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
  return { playing, available, toggle }
}

/** Says Japanese or Korean text with the browser's ja-JP / ko-KR voice. (The Chinese Hear button's voice settings stay Mandarin-only.) */
export function ParallelHear({ text, language, label = 'Hear', actions }: {
  text: string; language: ParallelLanguage; label?: string
  /** Adds the ⋯ menu the Chinese phrases have: Practise, Ask, Hear, Write. */
  actions?: { meaning?: string; title?: string; route?: string; practise?: string }
}) {
  const { playing, available, toggle } = useSpeech(text, language)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const hear = available ? <button type="button" className="button secondary snippet-button icon-only" aria-label={playing ? 'Stop playback' : label} title={playing ? 'Stop' : 'Hear'} onClick={toggle}>
    {playing ? <Square size={15} /> : <Volume2 size={15} />}</button> : null
  if (!actions) return hear
  const route = actions.route ?? 'lessons'
  const writable = Array.from(text).some(character => /[\p{Script=Han}\u3041-\u3096\u30a1-\u30fa\uac00-\ud7a3]/u.test(character))
  return <div className="snippet-actions" data-assistant-exclude><div className="snippet-actions-row">
    {hear}
    <ActionMenu label="Phrase actions" trigger={<MoreHorizontal size={20} />}>{close => <div className="phrase-menu">
      {actions.practise && <button type="button" className="button secondary snippet-button" onClick={() => { close(false); navigate(actions.practise!.replace(/^#/, '')) }}><Repeat2 size={15} />Practise</button>}
      <button type="button" className="button secondary snippet-button" disabled={pending} onClick={() => {
        setPending(true); setError('')
        void prepareAssistantDraft({ text, title: actions.title ?? text.slice(0, 60), route, ...(actions.meaning ? { meaning: actions.meaning } : {}), language }, undefined)
          .then(id => { close(false); navigate('conversation/' + id) }, reason => setError(reason instanceof Error ? reason.message : 'The Assistant draft could not be saved.'))
          .finally(() => setPending(false))
      }}><MessageCircle size={15} />{pending ? 'Preparing draft...' : 'Ask'}</button>
      {available && <button type="button" className="button secondary snippet-button" onClick={() => { close(false); toggle() }}><Volume2 size={15} />Hear</button>}
      {writable && <button type="button" className="button secondary snippet-button" title={'Practice writing in ' + NAME[language]} onClick={() => { close(); openWritingSheet(text, { language }) }}><PenLine size={15} />Write</button>}
      {error && <p className="small" role="alert">{error}</p>}
    </div>}</ActionMenu>
  </div></div>
}
