import { annotate } from '../../core/study/annotate'
import { getPack } from '../../core/language'
import { Pinyin } from '../Pinyin'
import { ToneText } from '../ToneText'

/** Chinese or Latin punctuation on its own: it sits tight against its neighbours, never spaced like a word. */
export const isPunctuation = (text: string) => /^[\p{P}\p{S}\s]+$/u.test(text)

type Segment = { text: string; pinyin?: string }

/**
 * Groups the segments into units: a word (or, in plain text, the last character before the mark) and the punctuation after it share one
 * nowrap span, so a mark never starts a line. Everything else stays inline, so plain text wraps and reads like ordinary text.
 */
function units(segments: Segment[], pinyin: boolean) {
  const out: { key: number; lead?: string; word?: Segment; punct: string }[] = []
  segments.forEach((segment, key) => {
    const mark = isPunctuation(segment.text)
    const last = out[out.length - 1]
    if (mark && last && last.word && !last.punct) { last.punct = segment.text; return }
    if (mark && last && last.punct) { last.punct += segment.text; return }
    if (mark) { out.push({ key, punct: segment.text }); return }
    out.push({ key, word: segment, punct: '' })
  })
  return out.map(entry => {
    // Plain text before a mark: only its last character is bound to the mark, the rest wraps freely.
    if (entry.word && entry.punct && !(pinyin && entry.word.pinyin)) {
      const chars = Array.from(entry.word.text)
      return { ...entry, lead: chars.slice(0, -1).join(''), word: { ...entry.word, text: chars.slice(-1).join(''), pinyin: undefined } }
    }
    return entry
  })
}

export function AnnotatedChinese({ text, readings, pinyin }: { text: string; readings: Map<string, Set<string>>; pinyin: boolean }) {
  const lang = getPack().learningTag
  // Readings written as one line under the text (not per Han character): the text is shown plain; the line is the card's.
  if (getPack().readings === 'line') return <span lang={lang}>{text}</span>
  const segments = annotate(text, readings) as Segment[]
  // With pinyin off the words are still coloured by their known reading, and the text is plain inline text: no gaps.
  const body = (segment: Segment) => pinyin && segment.pinyin
    ? <ruby className="mandarin-word"><ToneText text={segment.text} reading={segment.pinyin} /><rt aria-hidden="true" data-assistant-exclude><Pinyin text={segment.pinyin} /></rt></ruby>
    : <ToneText text={segment.text} reading={segment.pinyin} />
  return <span lang={lang}>{units(segments, pinyin).map(entry => {
    if (!entry.word) return <span key={entry.key} className="zh-unit zh-punct">{entry.punct}</span>
    if (!entry.punct) return pinyin && entry.word.pinyin ? <span key={entry.key} className="zh-word">{body(entry.word)}</span> : <span key={entry.key}>{body(entry.word)}</span>
    const unit = <span className={`zh-unit${pinyin && entry.word.pinyin ? ' zh-word' : ''}`}>{body(entry.word)}{entry.punct}</span>
    return <span key={entry.key}>{entry.lead}{unit}</span>
  })}</span>
}
