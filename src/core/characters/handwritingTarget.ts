import type { WritingLanguage } from './summary'

/** What a recogniser needs to know about the build's language; the pack supplies it (PackWriting.handwriting). */
export interface HandwritingTarget {
  /** Whose stroke data the built-in matcher reads. */
  language: WritingLanguage
  /** Language tags Chrome's handwriting API is asked for, in order. */
  chrome: readonly string[]
  /** The language code of Google's handwriting service. */
  google: string
  /** Whether a candidate shows a pinyin reading under it. */
  pinyin?: boolean
  /** Whether the built-in matcher favours the learner's lesson characters between close candidates. */
  favourLessons?: boolean
}
export const CHINESE_HANDWRITING: HandwritingTarget = { language: 'zh', chrome: ['zh-Hans', 'zh-CN', 'zh'], google: 'zh_CN', pinyin: true }
