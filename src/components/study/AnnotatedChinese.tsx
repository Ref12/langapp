import { annotate } from '../../core/study/annotate'
import { Pinyin } from '../Pinyin'

/** Chinese or Latin punctuation on its own: it sits tight against its neighbours, never spaced like a word. */
export const isPunctuation = (text: string) => /^[\p{P}\p{S}\s]+$/u.test(text)

export function AnnotatedChinese({ text, readings, pinyin }: { text: string; readings: Map<string, Set<string>>; pinyin: boolean }) {
  if (!pinyin) return <span lang="zh-Hans">{text}</span>
  return <span lang="zh-Hans">{annotate(text, readings).map((segment, index) => segment.pinyin
    ? <ruby key={index} className="mandarin-word">{segment.text}<rt aria-hidden="true" data-assistant-exclude><Pinyin text={segment.pinyin} /></rt></ruby>
    : <span key={index} className={isPunctuation(segment.text) ? 'zh-punct' : undefined}>{segment.text}</span>)}</span>
}
