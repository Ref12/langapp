import { keysWithoutSubject, impliedSubject, tokenKeys, type SubjectLanguage, type Token } from './implied-subject.mjs'
import { sameApartFromSubject } from './english-subject'

// Japanese and Korean leave the subject out when context makes it plain. A sentence that states none is flagged impliedSubject (scripts/mark-implied-subject.mjs writes the flag from its tokens),
// its English subject is arbitrary, so the English is shown with the subject in brackets and no wrong answer may differ from the right one only in who does it.

/** A sentence as the subject rules see it. */
export interface SubjectPhrase { zh: string; en: string; tokens?: readonly Token[]; impliedSubject?: boolean }

/** Does the sentence state no subject? The flag in the data decides; a sentence without it (a catalog example) is decided from its tokens. */
export const isImpliedSubject = (language: SubjectLanguage, phrase: Pick<SubjectPhrase, 'tokens' | 'impliedSubject'>): boolean =>
  phrase.impliedSubject ?? (phrase.tokens?.length ? impliedSubject(language, phrase.tokens) : false)

const LEADING_PRONOUN = /^(I|You|We|They|He|She|It)(?=\s)/i
/** "You study." → "(You) study."; English that does not open with a pronoun and a space ("Students study.", "I'm sorry!") stays as it is. */
export const bracketSubject = (en: string): string => en.replace(LEADING_PRONOUN, '($1)')

/** Is the candidate the question's sentence with a different person doing it? Its target sentence, with its subject taken out, is the question's; or its English is the answer's apart from the subject pronoun and the verb agreement. */
export function differsOnlyInWho(language: SubjectLanguage, question: SubjectPhrase, candidate: SubjectPhrase): boolean {
  if (sameApartFromSubject(question.en, candidate.en)) return true
  if (!question.tokens?.length || !candidate.tokens?.length) return false
  const stripped = keysWithoutSubject(language, candidate.tokens)
  return !!stripped && stripped.join('\n') === tokenKeys(question.tokens).join('\n')
}
