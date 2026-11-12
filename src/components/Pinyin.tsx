import { pinyinParts } from '../core/pinyin'
import { usePinyinFormat, usePinyinFormatter } from './pinyin-context'
import { toneClass, useToneColours } from './tone-colour-context'

/** Pinyin in the learner's format; with tone colours on, each syllable in its tone's colour. */
export function Pinyin({ text }: { text: string }) {
  const format = usePinyinFormat()
  const plain = usePinyinFormatter()(text)
  if (!useToneColours()) return <>{plain}</>
  return <>{pinyinParts(text, format).map((part, index) => part.tone === undefined ? part.text : <span key={index} className={toneClass(part.tone)}>{part.text}</span>)}</>
}
