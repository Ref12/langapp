import type { Word, WordState } from '../core/model'
import { readingStage } from '../core/progress'
import { getPack } from '../core/language'
import { showsReading } from '../core/study/reading-line'
import { Pinyin } from './Pinyin'

export function MandarinWord({ word, state, pinyin = true, text }: {
  word: Word; state?: WordState; pinyin?: boolean; text?: string
}) {
  return <ruby className="mandarin-word" lang={getPack().learningTag}>{text ?? word.native}
    {pinyin && readingStage(state) !== 'Learned' && showsReading(word.pinyin, text ?? word.native) && <rt aria-hidden="true" data-assistant-exclude><Pinyin text={word.pinyin} /></rt>}
  </ruby>
}
