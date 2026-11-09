import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { studiedLessons } from '../../core/parallel/progress'
import { wordFormsTable } from '../../core/parallel/conjugate'
import { loadParallel, type ParallelData, type ParallelLanguage, type ParallelPhrase } from '../../core/parallel/data'
import { languageGlyph, languageLabel, type DictGrammar, type DictWord } from '../../core/dictionary/other'
import { lessonsTeaching, phrasesUsing, sameWordIn, type SameWord } from '../../core/dictionary/links'
import type { Catalog } from '../../core/study/catalog'
import { ParallelHear } from '../ParallelHear'
import { ParallelStrokes } from '../ParallelStrokes'
import { Form } from '../ParallelForm'
import { loadDictionary } from '../../core/dictionary/other'
import { languageName } from '../../core/characters/language'

/** The small 中 / 日 / 한 tag on a result. */
export const LanguageTag = ({ language }: { language: 'zh' | ParallelLanguage }) =>
  <span className="tag lang-tag" lang={language === 'zh' ? 'zh-Hans' : language} title={languageLabel[language]} aria-label={languageLabel[language]}>{languageGlyph[language]}</span>

const meaningList = (meaning: string) => meaning.split(' | ').filter(Boolean)

/** The detail layer of a Japanese or Korean word: writing, lessons, phrases, the same word in other languages, and the place for word forms. */
function WordDetails({ word, language, catalog }: { word: DictWord; language: ParallelLanguage; catalog?: Catalog }) {
  const [data, setData] = useState<Partial<Record<ParallelLanguage, ParallelData>>>({})
  const [same, setSame] = useState<SameWord[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    Promise.all([loadParallel('ja'), loadParallel('ko'), loadDictionary('ja'), loadDictionary('ko')]).then(([ja, ko, dictJa, dictKo]) => {
      if (!live) return
      const all = { ja, ko }
      setData(all)
      setSame(sameWordIn(language, word, all, catalog, (lang, id) => (lang === 'ja' ? dictJa : dictKo).byId.get(id)))
    }, reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [language, word, catalog])
  const own = data[language]
  const lessons = own ? lessonsTeaching(own, word.id) : []
  const phrases = own ? phrasesUsing(own, word.id) : []
  return <div className="dictionary-details" data-testid="word-details">
    {error && <p className="small error" role="alert">Lesson data could not be loaded. {error}</p>}
    <ParallelStrokes text={word.form} language={language} reportMissing />
    <p className="small" data-testid="word-lesson">{!own ? 'Loading lessons...' : lessons.length ? <>Taught in {lessons.map((lesson, index) => <span key={lesson.number}>{index > 0 && ', '}<a href={'#lessons/' + language + '/' + lesson.number}>lesson {lesson.number}</a></span>)}</> : 'Not taught in a lesson yet.'}</p>
    {phrases.length > 0 && <><h4 className="small muted">Lesson phrases</h4><ul className="plain-list">{phrases.slice(0, 3).map(({ lesson, phrase }) => <DictPhrase key={language + lesson + phrase.id} phrase={phrase} language={language} lesson={lesson} />)}</ul></>}
    <div className="same-word" data-testid="same-word"><h4 className="small muted">Same word in</h4>
      {same.length ? <ul className="plain-list">{same.map(item => <li key={item.language + item.form} className="small"><a href={item.href}><LanguageTag language={item.language} /> <span lang={item.language === 'zh' ? 'zh-Hans' : item.language}>{item.form}</span>{item.reading && item.reading !== item.form ? <span lang={item.language === 'zh' ? 'zh-Hans' : item.language}> {item.reading}</span> : null}</a> <span className="muted">{item.gloss}</span></li>)}</ul>
        : <p className="small muted">{own ? 'No matching entry found in the other languages.' : 'Loading...'}</p>}
    </div>
    <WordForms word={word} language={language} data={own} />
  </div>
}

/** The Word forms table of a verb or adjective: every form of its class with the form, its reading in the pinyin slot and a short label; taught forms first, irregular ones marked. */
export function WordForms({ word, language, data }: { word: DictWord; language: ParallelLanguage; data?: ParallelData }) {
  const lessons = useLiveQuery(() => db.lessons.toArray(), [])
  const taught = useMemo(() => {
    const grammar = new Set<string>()
    if (data && lessons) for (const number of studiedLessons(lessons, language).keys()) for (const id of data.lessons.find(item => item.number === number)?.grammar ?? []) grammar.add(id)
    return grammar
  }, [data, lessons, language])
  const rows = useMemo(() => word.class ? wordFormsTable(language, word.form, word.class, word.reading || undefined, taught) : [], [word, language, taught])
  return <div className="word-forms-slot" data-testid="conjugation-slot" aria-label="Word forms"><h4 className="small muted">Word forms</h4>
    {!rows.length ? <p className="small muted">{word.class ? 'No forms for this word.' : 'This word has no verb or adjective forms.'}</p>
      : <table className="word-forms-table small" data-testid="word-forms"><thead><tr><th scope="col">Form</th><th scope="col">Meaning</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.formId} data-form={row.formId} data-taught={row.taught} data-irregular={row.irregular}>
          <td><Form text={row.surface} reading={row.reading} language={language} />{row.irregular && <> <span className="tag">irregular</span></>}</td>
          <td lang="en">{row.label}{row.taught && <span className="muted"> {'\u00B7'} taught</span>}</td></tr>)}</tbody></table>}
  </div>
}

function DictPhrase({ phrase, language, lesson }: { phrase: ParallelPhrase; language: ParallelLanguage; lesson?: number }) {
  return <li className="study-example parallel-phrase"><div className="phrase-row"><div className="phrase-row-text">
    <p className="example" lang={language}>{phrase.text}</p>
    {phrase.reading && <p className="small muted" lang={language}>{phrase.reading}</p>}
    <p className="small">{phrase.en}</p>
    <p className="zh-original">{phrase.zh ? <><span lang="zh-Hans">{languageGlyph.zh}</span> <span lang="zh-Hans">{phrase.zh}</span></> : null}{lesson && phrase.zh ? ' · ' : null}{lesson ? <a href={'#lessons/' + language + '/' + lesson}>lesson {lesson}</a> : null}</p>
  </div><ParallelHear text={phrase.text} language={language} label={'Hear phrase ' + phrase.id} /></div></li>
}
export { DictPhrase }

export function OtherWordCard({ word, language, known, catalog, tag, open: initiallyOpen = false }: { word: DictWord; language: ParallelLanguage; known: boolean; catalog?: Catalog; tag: boolean; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const meanings = meaningList(word.meaning)
  return <article className="word-card study-unit-card lesson-word-card other-word-card" data-language={language} data-word={word.ref} aria-label={'Word ' + word.form}>
    {tag && <LanguageTag language={language} />}
    <div className="card-topline"><span className="eyebrow">Vocabulary / {word.level ?? 'Lesson word'}</span>{known && <span className="tag">In your knowledge set</span>}</div>
    <div className="phrase-row"><div className="phrase-row-text">
      <h3 className="word-native"><Form text={word.form} reading={word.reading} language={language} /></h3>
      {word.hanja && <p className="small muted" lang="ko">{word.hanja}</p>}
      <p className="word-meaning">{meanings.slice(0, open ? meanings.length : 2).join('; ')}{!open && meanings.length > 2 ? ' ...' : ''}</p>
      {word.pos && <p className="small muted" data-testid="word-pos">{word.pos}</p>}
    </div><ParallelHear text={word.form} language={language} label={'Hear ' + word.form} actions={{ meaning: word.meaning, title: languageName[language] + ' word', route: 'dictionary' }} /></div>
    <button type="button" className="text-link small" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide details' : 'Show details'}</button>
    {open && <WordDetails word={word} language={language} catalog={catalog} />}
  </article>
}

export function OtherGrammarCard({ item, language, known, tag }: { item: DictGrammar; language: ParallelLanguage; known: boolean; tag: boolean }) {
  const [lessons, setLessons] = useState<number[]>()
  useEffect(() => {
    let live = true
    loadParallel(language).then(data => { if (live) setLessons(data.lessons.filter(lesson => lesson.grammar.includes(item.id)).map(lesson => lesson.number)) }, () => undefined)
    return () => { live = false }
  }, [language, item.id])
  return <article className="word-card study-unit-card lesson-word-card other-word-card" data-language={language} data-grammar={item.ref} aria-label={'Grammar ' + item.pattern}>
    {tag && <LanguageTag language={language} />}
    <div className="card-topline"><span className="eyebrow">Grammar / {item.level ?? 'Lesson'}</span>{known && <span className="tag">In your knowledge set</span>}</div>
    <h3 className="study-pattern" lang={language}>{item.pattern}</h3>
    <p className="word-meaning">{item.english}</p>
    {item.note && <p className="small muted">{item.note}</p>}
    {item.examples.slice(0, 2).map(example => <div key={example.target} className="study-example"><div className="phrase-row"><div className="phrase-row-text"><p className="example" lang={language}>{example.target}</p><p className="small">{example.english}</p></div>
      <ParallelHear text={example.target} language={language} label={'Hear ' + example.target} /></div></div>)}
    {lessons && lessons.length > 0 && <p className="small">Taught in {lessons.slice(0, 4).map((number, index) => <span key={number}>{index > 0 && ', '}<a href={'#lessons/' + language + '/' + number}>lesson {number}</a></span>)}</p>}
  </article>
}
