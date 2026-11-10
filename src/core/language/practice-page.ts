// What the Practice page, the exercise planner and the page's own <head> ask of the language pack beyond its wording: the words that are free in a sentence,
// whether the learner's own AI model may write exercises, and the page's description. Its own small module so the three pack objects (meta.ts) gain one spread each.

import { PARTICLES } from './particles'

export interface PracticePage {
  /** The words (or characters) a sentence may use beside the learner's own words: the planner's and the answer pad's list of forms that are free. Chinese: the function characters, in their old order. */
  functionWords: readonly string[]
  /**
   * Whether sentence and conversation exercises may be written by the learner's own AI model (the prompts are written for one language: chinese-prompts.ts).
   * False: nothing in Practice sends a prompt, the notice about connecting a model is not shown, and the drill types that only a model supplies are not offered.
   */
  modelExercises: boolean
  /** The text of <meta name="description"> in the published page (scripts/pwa.ts); Chinese is the text index.html has. */
  pageDescription: string
}

export const zhPage: PracticePage = {
  functionWords: Array.from('\u7684\u4E86\u5417\u5462\u5427\u662F\u4E0D\u5F88\u4E5F\u90FD\u548C\u5728\u6709\u8FD9\u90A3\u6211\u4F60\u4ED6\u5979\u4EEC\u4E2A'),
  modelExercises: true,
  pageDescription: 'A local Mandarin learning workspace. Read original stories, learn useful phrases, and practice your words.',
}

/** Japanese: the particles (the table in particles.ts) and the copula and polite endings, which a sentence uses freely. */
const JA_ENDINGS = ['\u3067\u3059', '\u3067\u3057\u305F', '\u307E\u3059', '\u307E\u3057\u305F', '\u307E\u305B\u3093']
export const jaPage: PracticePage = {
  functionWords: [...Object.keys(PARTICLES.ja), ...JA_ENDINGS],
  modelExercises: false,
  pageDescription: 'A local Japanese learning workspace. Learn useful phrases and practice your words.',
}

export const koPage: PracticePage = {
  functionWords: Object.keys(PARTICLES.ko),
  modelExercises: false,
  pageDescription: 'A local Korean learning workspace. Learn useful phrases and practice your words.',
}
