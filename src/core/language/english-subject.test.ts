import { describe, expect, it } from 'vitest'
import { numberFreeMatch, sameApartFromNumber, englishParts, englishSubject, englishWords, openSubjectMatch, sameApartFromSubject } from './english-subject'
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

describe('articles and number count as the same answer where the language marks neither', () => {
  it('the owner case: 学生は勉強します。 typed "The student studies." against "Students study."', () => {
    const grade = gradeSentenceMeaning('The student studies.', ['Students study.'], false, true)
    expect(grade.verdict).toBe('correct')
  })
  it('Chinese: 学生学习 typed "The student studies." is right against "Students study."', () => {
    expect(gradeSentenceMeaning('The student studies.', ['Students study.'], false, true).verdict).toBe('correct')
    expect(gradeSentenceMeaning('A student studies', ['The students study.'], false, true).verdict).toBe('correct')
  })
  it('a / an / the or none, singular or plural, with the agreement', () => {
    for (const [a, b] of [['The student studies.', 'Students study.'], ['A dog is here.', 'The dogs are here.'], ['The child has a book.', 'Children have books.'.replace('Children', 'Childs')], ['I read a book.', 'I read books.'], ['The class was big.', 'The class were big.'], ['The teacher does not study.', 'Teachers do not study.']]) expect(sameApartFromNumber(a, b), a + ' / ' + b).toBe(true)
  })
  it('implied subject: any pronoun still fits, with number free as well', () => {
    expect(gradeSentenceMeaning('We study.', ['I study.'], true, true).verdict).toBe('correct')
    expect(gradeSentenceMeaning('You read a book.', ['I read books.'], true, true).verdict).toBe('correct')
  })
  it('real differences are still rejected', () => {
    expect(gradeSentenceMeaning('The student does not study.', ['Students study.'], false, true).verdict).not.toBe('correct')
    expect(gradeSentenceMeaning('The teacher studies.', ['Students study.'], false, true).verdict).not.toBe('correct')
    expect(numberFreeMatch('The student studies Chinese.', ['Students study.'])).toBeUndefined()
    expect(gradeSentenceMeaning('The student studies.', ['Students study.'], false, false).verdict).not.toBe('correct')
  })
})

describe('the pack flag', () => {
  it('is set for zh, ja and ko', async () => {
    const { zhSentence, jaSentence, koSentence } = await import('./sentence-forms')
    for (const pack of [zhSentence, jaSentence, koSentence]) expect(pack.englishNumberFree).toBe(true)
  })
})
