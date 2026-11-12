import type { Word, WordState } from '../core/model'
import { readingStage } from '../core/progress'
import { getPack } from '../core/language'
import { showsReading } from '../core/study/reading-line'
import { Pinyin } from './Pinyin'
import { ToneText } from './ToneText'

export function MandarinWord({ word, state, pinyin = true, text }: {
  word: Word; state?: WordState; pinyin?: boolean; text?: string
}) {
  return <ruby className="mandarin-word" lang={getPack().learningTag}><ToneText text={text ?? word.native} reading={word.pinyin} />
    {pinyin && readingStage(state) !== 'Learned' && showsReading(word.pinyin, text ?? word.native) && <rt aria-hidden="true" data-assistant-exclude><Pinyin text={word.pinyin} /></rt>}
  </ruby>
}
