/** Japanese and Korean word forms (option C of docs/languages.md): a lemma plus a class plus a form id builds the surface; irregular forms are lesson-scoped items. */
import jaRules from '../../data/forms/ja.json'
import koRules from '../../data/forms/ko.json'
import { createForms, formItemId as makeFormItemId } from './engine.mjs'

export type FormsLanguage = 'ja' | 'ko'

/** A built form: the surface, and for Japanese the kana reading (when the lemma's reading was given). */
export interface BuiltForm { surface: string; reading?: string }
/** Options: reading of the Japanese lemma; for the Korean copula 이다 either the 'vowel' / 'consonant' the noun before it ends in, or that noun (prev). */
export interface FormOptions { reading?: string; after?: 'vowel' | 'consonant'; prev?: string }

/** One form of the rules: its label, the grammar point that teaches it, and how it is built (Japanese: stem name + ending; Korean: join + ending, optional prefix). */
export interface FormSpec { label: string; grammar?: unknown; stem?: string; add?: string; join?: string; prefix?: string; multiword?: boolean }
export interface ClassMeta { description?: string; group?: string; irregular?: boolean; baseline?: string; itemised?: boolean; tails?: Record<string, Record<string, string>>; potential?: string; volitional?: string }
export interface FormsRules { forms: Record<string, FormSpec>; classes: Record<string, ClassMeta>; templates?: Record<string, Record<string, { stem?: string; add?: string | Record<string, string> }>> }

export interface FormsEngine {
  /** The rules file as data: form specs and class metadata. */
  rules: FormsRules
  language: FormsLanguage
  /** The surface of a lemma of a class in a form, or null when the form does not apply to the class. */
  forms(lemma: string, cls: string, formId: string, opts?: FormOptions): BuiltForm | null
  /** The form ids of the class that produce the surface (an empty list when none does). */
  analyse(surface: string, lemma: string, cls: string, opts?: FormOptions): string[]
  /** The form ids that apply to a class. */
  formIds(cls: string): string[]
  /** The grammar point (JLPT / TOPIK / parallel id) the form teaches for the class, or null. */
  grammarOf(formId: string, cls: string): string | null
  /** Is this form an irregular form of the lemma (it gets a lesson item)? */
  irregular(lemma: string, cls: string, formId: string, opts?: FormOptions): boolean
  /** The class of a verb or adjective from its dictionary form, part of speech (JMdict / TOPIK wording) and for Japanese the reading; null for other words. */
  classify(lemma: string, pos?: string, reading?: string): string | null
}

const engines: Record<FormsLanguage, FormsEngine> = {
  ja: createForms(jaRules) as unknown as FormsEngine,
  ko: createForms(koRules) as unknown as FormsEngine,
}

export const formsEngine = (language: FormsLanguage): FormsEngine => engines[language]
export const formItemId = (language: FormsLanguage, lemma: string, formId: string): string => makeFormItemId(language, lemma, formId)
/** forms(lemma, class, formId): the surface (and reading) a lemma takes in a form. */
export const forms = (language: FormsLanguage, lemma: string, cls: string, formId: string, opts?: FormOptions): BuiltForm | null => engines[language].forms(lemma, cls, formId, opts)
/** analyse(surface, lemma, class): the form ids that produce the surface. */
export const analyse = (language: FormsLanguage, surface: string, lemma: string, cls: string, opts?: FormOptions): string[] => engines[language].analyse(surface, lemma, cls, opts)
