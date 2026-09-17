import type { Word, WordState } from '../core/model'
import { readingStage } from '../core/progress'

export function MandarinWord({ word, state, pinyin = true, text }: {
  word: Word; state?: WordState; pinyin?: boolean; text?: string
}) {
  return <ruby className="mandarin-word" lang="zh-Hans">{text ?? word.native}
    {pinyin && readingStage(state) !== 'Learned' && <rt aria-hidden="true" data-assistant-exclude>{word.pinyin}</rt>}
  </ruby>
}
