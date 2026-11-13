import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPack } from '../language'
import { bracketSubject, differsOnlyInWho, isImpliedSubject } from '../language/subject-rules'
import { impliedSubject } from '../language/implied-subject.mjs'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { shippedPhrases } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { isVocabulary } from '../study/local-exercises'
import { buildListenPick, buildTranslate, type FormContext } from './bank-forms'
import type { ListenItem, TextItem } from './types'

export interface SubjectCases {
  language: 'ja' | 'ko'
  /** Sentences with no subject, ones with a person or pronoun subject, and a time topic (which is not a subject). */
  flagged: string[]
  stated: string[]
  timeTopic: { zh: string; en: string }
  /** The owner's question: this sentence is the answer, the twin (the same with a pronoun subject) must never be offered, the plural noun subject may be. */
  question: { zh: string; en: string; shown: string }
  twin: string
  /** The first stated sentence typed with its subject left out. */
  dropped: string
  allowed: string
  /** What the display seam shows for the question, and a flagged one with "I". */
  bracketed: { zh: string; en: string; shown: string }
}

/** The tests of the implied-subject rule for a language that drops its subject. */
export function describeImpliedSubject(cases: SubjectCases): void {
  const { language } = cases
  let catalog: Catalog
  let bank: BankPhrase[]
  const slot = { id: 's', stage: 'recognise' as const, refs: [], round: 0 }
  const find = (zh: string, en?: string) => bank.find(phrase => phrase.zh === zh && (en === undefined || phrase.en === en))!
  const context = (seed: number): FormContext => {
    const knownUnits = [...catalog.units.values()].filter(isVocabulary).filter(unit => bank.some(phrase => phrase.words.includes(unit.ref)))
    return { catalog, forms: new Set(), knownUnits, bank, seed }
  }
  const listen = (phrase: BankPhrase, seed: number) => buildListenPick({ ...slot, id: 'listen-' + seed }, phrase, context(seed)) as ListenItem | undefined
  beforeAll(async () => {
    setBuildLanguageForTests(language)
    resetCatalogCache()
    catalog = await loadCatalog()
    const all = new Map<string, BankPhrase>()
    for (const band of Object.keys(getPack().phrases.bands)) for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) all.set(String(phrase.id), phrase)
    bank = [...all.values()]
  }, 60000)
  afterAll(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

  describe(language + ': which sentences state no subject', () => {
    it('the pack drops its subject', () => { expect(getPack().dropsSubject).toBe(true) })
    it('a sentence without a person or pronoun subject is flagged', () => {
      for (const zh of cases.flagged) expect(isImpliedSubject(language, find(zh)), zh).toBe(true)
    })
    it('a sentence with a person or pronoun subject is not', () => {
      for (const zh of cases.stated) expect(isImpliedSubject(language, find(zh)), zh).toBe(false)
    })
    it('a time topic is not a subject', () => {
      const phrase = find(cases.timeTopic.zh, cases.timeTopic.en)
      expect(phrase).toBeDefined()
      expect(isImpliedSubject(language, phrase)).toBe(true)
    })
    it('the flags in the data are what the tokens say, for every sentence', () => {
      expect(bank.length).toBeGreaterThan(500)
      for (const phrase of bank) expect(!!phrase.impliedSubject, phrase.zh).toBe(impliedSubject(language, phrase.tokens))
    })
  })

  describe(language + ': the meaning shows the subject in brackets', () => {
    it('a flagged sentence has its leading pronoun in brackets, the verb as it is', () => {
      const phrase = find(cases.bracketed.zh, cases.bracketed.en)
      expect(getPack().meaningText(phrase)).toBe(cases.bracketed.shown)
    })
    it('a sentence with a stated subject, and English without a leading pronoun, stay as they are', () => {
      const stated = find(cases.stated[0])
      expect(getPack().meaningText(stated)).toBe(stated.en)
      expect(getPack().meaningText({ zh: 'x', en: 'Thank you.', impliedSubject: true })).toBe('Thank you.')
      expect(getPack().meaningText({ zh: 'x', en: 'Students study.', impliedSubject: true })).toBe('Students study.')
      expect(bracketSubject('I study at home.')).toBe('(I) study at home.')
      expect(bracketSubject("I'm sorry!")).toBe("I'm sorry!")
    })
    it('the exercises show the bracketed meaning, and the answer is still one of the options', () => {
      const phrase = find(cases.question.zh, cases.question.en)
      const item = listen(phrase, 1)!
      expect(item.options[item.answer]).toBe(cases.question.shown)
      const translate = buildTranslate({ ...slot, stage: 'produce' }, 'translate-en-zh', phrase, context(1)) as TextItem
      expect(translate.prompt).toBe(cases.question.shown)
      expect(translate.accepted.length).toBeGreaterThan(0)
    })
  })

  describe(language + ': English to the language is graded as before', () => {
    it('a left-out subject is still right', () => {
      const phrase = find(cases.stated[0])
      const item = buildTranslate({ ...slot, stage: 'produce' }, 'translate-en-zh', phrase, context(1)) as TextItem
      const grade = (text: string) => getPack().gradeSentence({ text, accepted: item.accepted, spelled: item.spelled, forms: new Set(), optional: item.optional, english: item.prompt })
      expect(grade(phrase.zh).verdict).toBe('correct')
      expect(grade(cases.dropped).verdict).toBe('correct')
    })
  })

  describe(language + ': no wrong answer that differs only in who does it', () => {
    it("the owner's question never offers the same sentence with a subject, and may offer the noun subject", () => {
      const phrase = find(cases.question.zh, cases.question.en)
      const twin = find(cases.twin)
      const allowed = find(cases.allowed)
      expect(differsOnlyInWho(language, phrase, twin)).toBe(true)
      expect(differsOnlyInWho(language, phrase, allowed)).toBe(false)
      let seen = 0, offered = 0
      for (let seed = 0; seed < 400; seed++) {
        const item = listen(phrase, seed)
        if (!item) continue
        seen++
        expect(item.options, 'seed ' + seed).not.toContain(getPack().meaningText(twin))
        expect(new Set(item.options).size).toBe(item.options.length)
        if (item.options.includes(getPack().meaningText(allowed))) offered++
      }
      expect(seen).toBeGreaterThan(300)
      expect(offered).toBeGreaterThan(0)
    })
    it('a different pronoun or verb agreement with the same meaning is rejected too', () => {
      const phrase = { zh: 'x', en: 'You study.', impliedSubject: true }
      expect(getPack().sameMeaningApartFromWho(phrase, { zh: 'y', en: 'She studies.' })).toBe(true)
      expect(getPack().sameMeaningApartFromWho(phrase, { zh: 'y', en: 'We study.' })).toBe(true)
      expect(getPack().sameMeaningApartFromWho(phrase, { zh: 'y', en: 'Students study.' })).toBe(false)
      expect(getPack().sameMeaningApartFromWho(phrase, { zh: 'y', en: 'I study at home.' })).toBe(false)
      expect(getPack().sameMeaningApartFromWho({ zh: 'x', en: 'You study.', impliedSubject: false }, { zh: 'y', en: 'She studies.' })).toBe(false)
    })
  })
}
