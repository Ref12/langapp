import { afterEach, describe, expect, it } from 'vitest'
import { FORMS } from '../session/types'
import { formLabel } from '../session/form-label'
import { setBuildLanguageForTests } from '../storage-names'
import { LANGUAGE_IDS } from './ids'
import { metaFor } from './meta'
import { drillText } from './practice-wording'

afterEach(() => setBuildLanguageForTests(undefined))

const ZH_LABELS = {
  intro: 'Intro cards', choice: 'Choose the meaning', match: 'Match pairs', pinyin: 'Type the pinyin', recall: 'Type the meaning', 'translate-zh-en': 'Translate to English',
  'translate-en-zh': 'Translate to Chinese', tiles: 'Word order', gap: 'Fill the gap', 'listen-pick': 'Listen and pick', dictation: 'Dictation', repeat: 'Repeat after me',
  'exchange-pick': 'Pick the reply', 'exchange-reply': 'Reply to the question', 'which-correct': 'Which is correct?', conversation: 'Listen and answer', conjugate: 'Conjugate', 'form-pick': 'Which form is this?', 'which-tones': 'Which tones?',
}

describe('the practice wording of the packs', () => {
  it('every pack has a label and an instruction for every form id', () => {
    for (const id of LANGUAGE_IDS) for (const form of FORMS) {
      expect(metaFor(id).practiceWording.formLabels[form], id + ' ' + form).toBeTruthy()
      expect(metaFor(id).practiceWording.instructions[form], id + ' ' + form).toBeTruthy()
    }
  })
  it('the Chinese labels are the ones the engine had before packs', () => {
    expect(metaFor('zh').practiceWording.formLabels).toEqual(ZH_LABELS)
  })
  it('Japanese and Korean name their language and say reading for pinyin', () => {
    expect(metaFor('ja').practiceWording.formLabels).toEqual({ ...ZH_LABELS, pinyin: 'Type the reading', 'translate-en-zh': 'Translate to Japanese' })
    expect(metaFor('ko').practiceWording.formLabels).toEqual({ ...ZH_LABELS, pinyin: 'Type the romanization', 'translate-en-zh': 'Translate to Korean' })
    const ja = metaFor('ja').practiceWording
    expect([ja.readingHelp, ja.hideReadings, ja.showReadings, ja.typeNativeOrReading, ja.languageName]).toEqual(['Type the reading in kana or romaji.', 'Hide readings', 'Show readings', 'Type the Japanese, or its reading', 'Japanese'])
    expect(drillText({ id: 'meanings', name: 'Word meanings', blurb: 'x' }, ja).blurb).toBe('Japanese \u2194 English: choose or type')
    expect(metaFor('ko').practiceWording.languageName).toBe('Korean')
  })
  it('Korean says romanization, never the reading of another language and never Chinese', () => {
    const ko = metaFor('ko').practiceWording
    expect([ko.readingPlaceholder, ko.readingIs, ko.typeNativeOrReading, ko.nativeNote]).toEqual(['Type the romanization', 'The romanization is', 'Type the Korean, or its romanization', 'Type Korean or its romanization.'])
    expect(ko.readingHelp).toBe('Type the romanization, with or without spaces and hyphens (gongbuhaeyo).')
    expect(ko.instructions.pinyin).toBe('Type the romanization')
    expect(ko.drillTitles.pinyin).toBe('Type the romanization')
    // nothing a Korean learner reads names pinyin, Chinese, HSK or Mandarin
    const words: string[] = []
    const walk = (value: unknown): void => { if (typeof value === 'string') words.push(value); else if (value && typeof value === 'object' && !(value instanceof RegExp)) Object.values(value).forEach(walk) }
    walk(ko)
    expect(words.filter(text => /pinyin|Chinese|HSK|Mandarin/i.test(text))).toEqual([])
    expect(ko.notEnglish.note).toBe('The answer should be in English, not Korean.')
  })
  it('formLabel follows the build language', () => {
    expect(formLabel('pinyin')).toBe('Type the pinyin')
    setBuildLanguageForTests('ja')
    expect(formLabel('pinyin')).toBe('Type the reading'); expect(formLabel('translate-en-zh')).toBe('Translate to Japanese')
  })
})
