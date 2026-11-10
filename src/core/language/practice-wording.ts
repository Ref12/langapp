// The wording of the Practice page and the exercise engine that names the learned language or its reading. Chinese's values are the literal strings
// the screens had before packs (the form labels are FORM_LABEL of session/types.ts, which stays the Chinese table). A separate module, not PackWording:
// the block is long, keyed by exercise form, and meta.ts stays the short identity part. Form ids stay internal; only what the learner reads changes.

import { FORM_LABEL, type Form } from '../session/types'

export interface PracticeWording {
  /** The name of every exercise form, as the preset's form picker lists it. */
  formLabels: Record<Form, string>
  /** The action line above a question, for every form. */
  instructions: Record<Form, string>
  /** The typed-reading question: placeholder, help under the input, a sample in the placeholder of the older drill screen. */
  readingPlaceholder: string
  readingHelp: string
  readingExample: string
  /** "The pinyin is X." before the answer, without the dot. */
  readingIs: string
  /** The toggle above every question. */
  hideReadings: string
  showReadings: string
  /** Typing the learned language: the placeholders and labels. */
  typeNative: string
  replyNative: string
  typeNativeOrReading: string
  nativeNote: string
  /** The Hear button's label on a prompt in the learned language. */
  hearNative: string
  /** The phases of the timed audio loop. */
  thinkOf: string
  listenTo: string
  /** The language's name in the source picker's curriculum entry ("Chinese" curriculum). */
  languageName: string
  /** The older drill types whose name or blurb names the language or its reading. */
  drillTypes: Record<string, { name?: string; blurb?: string }>
  /** Titles of the older drill screen's question pages that name the language or its reading. */
  drillTitles: Record<string, string>
}

const zhInstructions: Record<Form, string> = {
  intro: 'Learn the new word', choice: 'Choose the meaning', match: 'Match the pairs', pinyin: 'Type the pinyin', recall: 'Type the meaning', 'translate-zh-en': 'Translate into English',
  'translate-en-zh': 'Translate into Chinese', tiles: 'Build the sentence', gap: 'Fill the gap', 'listen-pick': 'Listen and pick the meaning', dictation: 'Type what you hear', repeat: 'Say it after the audio',
  'exchange-pick': 'Pick the reply', 'exchange-reply': 'Answer the question in Chinese, as the cue says', 'which-correct': 'Which sentence is correct?', conversation: 'Listen, then answer the questions', conjugate: 'Conjugate', 'form-pick': 'Which form is this?',
}

export const zhPractice: PracticeWording = {
  formLabels: FORM_LABEL, instructions: zhInstructions,
  readingPlaceholder: 'Type the pinyin', readingHelp: 'Pinyin with tones: type numbers (xue2 xi2) or marks (xu\u00e9 x\u00ed). Use v for \u00fc (lv4).', readingExample: 'n\u01d0 h\u01ceo', readingIs: 'The pinyin is',
  hideReadings: 'Hide pinyin', showReadings: 'Show pinyin',
  typeNative: 'Type the Chinese', replyNative: 'Your reply in Chinese', typeNativeOrReading: 'Type the Chinese, or its pinyin', nativeNote: 'Type Chinese characters or pinyin.',
  hearNative: 'Hear the Chinese', thinkOf: 'Think of the Chinese', listenTo: 'Listen to the Chinese', languageName: 'Chinese',
  drillTypes: {}, drillTitles: {},
}

/** The same wording for a language that has readings instead of pinyin: its name for "Chinese", "reading" for "pinyin". */
function readingLanguage(name: string, example: string, readingHelp: string): PracticeWording {
  return {
    formLabels: { ...FORM_LABEL, pinyin: 'Type the reading', 'translate-en-zh': 'Translate to ' + name },
    instructions: { ...zhInstructions, pinyin: 'Type the reading', 'translate-en-zh': 'Translate into ' + name, 'exchange-reply': 'Answer the question in ' + name + ', as the cue says' },
    readingPlaceholder: 'Type the reading', readingHelp, readingExample: example, readingIs: 'The reading is',
    hideReadings: 'Hide readings', showReadings: 'Show readings',
    typeNative: 'Type the ' + name, replyNative: 'Your reply in ' + name, typeNativeOrReading: 'Type the ' + name + ', or its reading', nativeNote: 'Type ' + name + ' or its reading.',
    hearNative: 'Hear the ' + name, thinkOf: 'Think of the ' + name, listenTo: 'Listen to the ' + name, languageName: name,
    drillTypes: {
      meanings: { blurb: name + ' \u2194 English: choose or type' },
      write: { blurb: 'A reading sentence, write the highlighted word from memory' },
      pinyin: { name: 'Say the reading', blurb: 'See the word, type its reading' },
      translate: { blurb: 'English to ' + name + ': type, speak or write' },
      read: { blurb: 'The same conversation as text with readings' },
    },
    drillTitles: { pinyin: 'Type the reading', translate: 'Translate into ' + name },
  }
}

export const jaPractice: PracticeWording = readingLanguage('Japanese', '\u306b\u307b\u3093', 'Type the reading in kana or romaji.')
export const koPractice: PracticeWording = readingLanguage('Korean', '\ud55c\uad6d', 'Type the reading.')

/** The older drill type's name and blurb in this pack's words (an entry the pack does not override keeps its own). */
export const drillText = (entry: { id: string; name: string; blurb: string }, wording: PracticeWording): { name: string; blurb: string } => ({ ...entry, ...wording.drillTypes[entry.id] })
