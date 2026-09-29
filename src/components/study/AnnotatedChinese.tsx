import { annotate } from '../../core/study/annotate'
import { Pinyin } from '../Pinyin'

export function AnnotatedChinese({ text, readings, pinyin }: { text: string; readings: Map<string, Set<string>>; pinyin: boolean }) {
  if (!pinyin) return <span lang="zh-Hans">{text}</span>
  return <span lang="zh-Hans">{annotate(text, readings).map((segment, index) => segment.pinyin
    ? <ruby key={index} className="mandarin-word">{segment.text}<rt aria-hidden="true" data-assistant-exclude><Pinyin text={segment.pinyin} /></rt></ruby>
    : <span key={index}>{segment.text}</span>)}</span>
}
