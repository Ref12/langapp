import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Play } from 'lucide-react'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { ParallelHear } from '../components/ParallelHear'
import { ParallelStrokes } from '../components/ParallelStrokes'
import { LESSON_COUNT, lessonWords, loadParallel, parallelLessonId, shortGloss, type ParallelData, type ParallelLanguage, type ParallelPhrase } from '../core/parallel/data'
import { markParallelStudied, startTrack } from '../core/parallel/progress'
import { languageName } from '../core/characters/language'

const HAS_KANJI = /\p{Script=Han}/u

/** Furigana above the kanji of a Japanese form; other forms are plain. */
export function Form({ text, reading, language }: { text: string; reading?: string; language: ParallelLanguage }) {
  if (language === 'ja' && reading && reading !== text && HAS_KANJI.test(text)) return <ruby lang="ja">{text}<rt>{reading}</rt></ruby>
  return <span lang={language}>{text}</span>
}

function Phrase({ data, phrase, language }: { data: ParallelData; phrase: ParallelPhrase; language: ParallelLanguage }) {
  return <li className="study-example parallel-phrase">
    <div className="phrase-row"><div className="phrase-row-text">
      <p className="example" lang={language}>{language === 'ko' ? phrase.text : phrase.tokens.map((token, index) => <Form key={index} text={token.t} reading={token.w ? data.entries[token.w]?.reading : undefined} language={language} />)}</p>
      {phrase.reading && <p className="small muted" lang={language}>{phrase.reading}</p>}
      <p className="small">{phrase.en}</p>
      <p className="zh-original"><span lang="zh-Hans">{'\u4E2D'}</span> <span lang="zh-Hans">{phrase.zh}</span></p>
    </div><ParallelHear text={phrase.text} language={language} label={`Hear phrase ${phrase.id}`} /></div>
  </li>
}

/** A read-only Japanese or Korean lesson: new words, grammar and phrases, with Mark as studied. */
export function ParallelLessonView({ workspace, run, busy, language, number }: PageProps & { language: ParallelLanguage; number: number }) {
  const [data, setData] = useState<ParallelData>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    loadParallel(language).then(value => { if (live) setData(value) }, reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [language])
  // Opening a lesson starts the track and makes it the current language.
  useEffect(() => { void startTrack(language).catch(() => undefined) }, [language])
  const name = languageName[language]
  if (error) return <div className="notice error" role="alert"><p>The {name} lessons could not be loaded. {error}</p></div>
  if (!data) return <p className="muted" role="status">Loading the {name} lessons...</p>
  const lesson = data.lessons.find(item => item.number === number)
  if (!lesson) return <EmptyState title="This lesson is not available"><a className="button primary" href="#lessons">Back to lessons</a></EmptyState>
  const id = parallelLessonId(language, number)
  const studiedAt = workspace.lessons.find(item => item.lessonId === id)?.completedAt
  const words = lessonWords(data, lesson)
  // lesson.words are already the words this lesson introduces (earlier lessons' words are not repeated);
  // their `new` flag only marks entries authored for the parallel track, not "new in this lesson".
  const shown = words
  const grammar = lesson.grammar.map(gid => ({ id: gid, ...data.grammar[gid] })).filter(item => item.pattern)
  return <div className="parallel-lesson">
    <a className="back-link" href="#lessons"><ArrowLeft size={16} /> Lessons</a>
    <PageHeading eyebrow={`${name.toUpperCase()} / HSK 1 WITH CHINESE`} title={`${name}, lesson ${number}`}>{shown.length} new {shown.length === 1 ? 'word' : 'words'}, {grammar.length} grammar {grammar.length === 1 ? 'point' : 'points'} and {lesson.phrases.length} phrases.{studiedAt !== undefined ? ' Studied.' : ''}</PageHeading>
    <section aria-label="Words"><h2>Words</h2>
      {shown.map(word => <article key={word.id} className="word-card study-unit-card lesson-word-card parallel-word" data-entry={word.id}>
        <div className="phrase-row"><div className="phrase-row-text">
          <h3 className="parallel-form"><Form text={word.target} reading={word.reading} language={language} /></h3>
          {word.reading && language === 'ja' && word.reading !== word.target && !HAS_KANJI.test(word.target) && <p className="small muted" lang={language}>{word.reading}</p>}
          <p className="word-meaning">{shortGloss(word.english)}</p>
        </div><ParallelHear text={word.target} language={language} label={`Hear ${word.target}`} /></div>
        <ParallelStrokes text={word.target} language={language} />
      </article>)}</section>
    {grammar.length > 0 && <section aria-label="Grammar"><h2>Grammar</h2>
      {grammar.map(item => <article key={item.id} className="word-card study-unit-card lesson-word-card"><h3 className="study-pattern" lang={language}>{item.pattern}</h3><p className="word-meaning">{item.english}</p></article>)}</section>}
    <section aria-label="Phrases"><h2>Phrases</h2><ol className="plain-list">{lesson.phrases.map(phrase => <Phrase key={phrase.id} data={data} phrase={phrase} language={language} />)}</ol></section>
    <div className="button-row">
      <a className="button primary" href={`#lessons/${language}/${number}/practise`}><Play size={16} /> Practise</a>
      <button type="button" className="button secondary" disabled={busy || studiedAt !== undefined} onClick={() => void run(() => markParallelStudied(language, number))}>
        <Check size={16} /> {studiedAt !== undefined ? 'Studied' : 'Mark as studied'}</button>
      {number < LESSON_COUNT && <a className="button secondary" href={`#lessons/${language}/${number + 1}`}>Next lesson <ArrowRight size={16} /></a>}
    </div>
  </div>
}
