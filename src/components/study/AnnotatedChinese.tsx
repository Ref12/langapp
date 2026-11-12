import { annotate } from '../../core/study/annotate'
import { getPack } from '../../core/language'
import { Pinyin } from '../Pinyin'
import { ToneText } from '../ToneText'

/** Chinese or Latin punctuation on its own: it sits tight against its neighbours, never spaced like a word. */
export const isPunctuation = (text: string) => /^[\p{P}\p{S}\s]+$/u.test(text)

export function AnnotatedChinese({ text, readings, pinyin }: { text: string; readings: Map<string, Set<string>>; pinyin: boolean }) {
  const lang = getPack().learningTag
  // Readings written as one line under the text (not per Han character): the text is shown plain; the line is the card's.
  if (getPack().readings === 'line') return <span lang={lang}>{text}</span>
  // With pinyin off the words are still coloured by their known reading.
  if (!pinyin) return <span lang={lang}>{annotate(text, readings).map((segment, index) => <ToneText key={index} text={segment.text} reading={segment.pinyin} />)}</span>
  return <span lang={lang}>{annotate(text, readings).map((segment, index) => segment.pinyin
    ? <ruby key={index} className="mandarin-word"><ToneText text={segment.text} reading={segment.pinyin} /><rt aria-hidden="true" data-assistant-exclude><Pinyin text={segment.pinyin} /></rt></ruby>
    : <span key={index} className={isPunctuation(segment.text) ? 'zh-punct' : undefined}>{segment.text}</span>)}</span>
}
