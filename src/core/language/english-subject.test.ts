import { describe, expect, it } from 'vitest'
import { englishParts, englishSubject, englishWords, openSubjectMatch, sameApartFromSubject } from './english-subject'
import { gradeSentenceMeaning } from '../session/grade'

describe('the English subject, set aside', () => {
  it('opens contractions and drops punctuation', () => {
    expect(englishWords("I'm a student.")).toEqual(['i', 'am', 'a', 'student'])
    expect(englishWords("She doesn't study!")).toEqual(['she', 'does', 'not', 'study'])
    expect(englishWords("They're at home")).toEqual(['they', 'are', 'at', 'home'])
    expect(englishWords("I can't go")).toEqual(['i', 'can', 'not', 'go'])
  })
  it('finds the subject pronoun, in a statement and in a question', () => {
    expect(englishSubject('She studies.')).toBe('she')
    expect(englishSubject('Do you study?')).toBe('you')
    expect(englishSubject('The students study.')).toBeUndefined()
    expect(englishSubject('Study!')).toBeUndefined()
    expect(englishParts('He always studies English.')).toMatchObject({ pronoun: 'he', rest: ['always', 'english'] })
  })
  it('any pronoun fits, with the verb agreement that follows', () => {
    const pairs: [string, string][] = [
      ['You study.', 'I study.'], ['You study.', 'She studies.'], ['You study.', 'He studies'], ['You study.', 'we study'], ['You study.', 'They study.'], ['You study.', 'It studies.'],
      ['You are a student.', 'I am a student.'], ['You are a student.', 'She is a student.'], ['You are a student.', "They're a student."], ["I'm tired.", 'He is tired.'],
      ['They have friends.', 'She has friends.'], ['They have friends.', 'I have friends.'],
      ['You do not study.', "She doesn't study."], ['You go to school.', 'He goes to school.'], ['You watch TV.', 'She watches TV.'], ['You study.', 'He studied.'].slice(0, 0) as never,
      ['Do you study?', 'Does she study?'], ['Are you a student?', 'Is he a student?'], ['You were tired.', 'I was tired.'], ['You were tired.', 'She was tired.'],
      ['I always study.', 'She always studies.'], ['You ate.', 'She ate.'], ['You studied.', 'He studied.'],
    ].filter(pair => pair.length === 2) as [string, string][]
    for (const [a, b] of pairs) expect(sameApartFromSubject(a, b), `${a} / ${b}`).toBe(true)
  })
  it('a different sentence, wrong agreement or a different form is not the same', () => {
    const pairs: [string, string][] = [
      ['You study.', 'She study.'], ['You study.', 'I studies.'], ['You are a student.', 'She am a student.'], ['You are a student.', 'I is a student.'], ['They have friends.', 'She have friends.'],
      ['You study.', 'I work.'], ['You study.', 'Do you study?'], ['You study.', 'She studies hard.'], ['You study.', 'She does not study.'], ['You study.', 'The student studies.'], ['You study.', 'Study.'],
    ]
    for (const [a, b] of pairs) expect(sameApartFromSubject(a, b), `${a} / ${b}`).toBe(false)
  })
  it('picks the accepted wording that matches', () => {
    expect(openSubjectMatch('She studies', ['They work.', 'You study.'])).toBe('You study.')
    expect(openSubjectMatch('She studies', ['They work.'])).toBeUndefined()
  })
  it('grades a sentence meaning: open, it is right with a note; not open, as before', () => {
    const open = gradeSentenceMeaning('She studies.', ['You study.'], true)
    expect(open.verdict).toBe('correct')
    expect(open.note).toContain('No subject')
    expect(gradeSentenceMeaning('She studies.', ['You study.'], false).verdict).toBe('self')
    expect(gradeSentenceMeaning('You study.', ['You study.'], true)).toMatchObject({ verdict: 'correct' })
    expect(gradeSentenceMeaning('She works.', ['You study.'], true).verdict).toBe('wrong')
  })
})
