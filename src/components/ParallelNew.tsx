import { useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Workspace } from '../core/model'
import { LESSON_COUNT, lessonWords, loadParallel, glossOf, type ParallelData } from '../core/parallel/data'
import type { ParallelLanguage } from '../core/language/ids'
import { nextParallelLesson, studiedLessons } from '../core/parallel/progress'
import { languageName } from '../core/characters/language'
import { Form } from './ParallelForm'

/** The New panel of a Japanese or Korean track, laid out like the Chinese one: the next lesson's words (readings in the pinyin slot) and Start, which opens the lesson's intro cards. */
export function ParallelNew({ language, workspace }: { language: ParallelLanguage; workspace: Workspace }) {
  const [data, setData] = useState<ParallelData>()
  useEffect(() => {
    let live = true
    setData(undefined)
    loadParallel(language).then(value => { if (live) setData(value) }, () => undefined)
    return () => { live = false }
  }, [language])
  const studied = useMemo(() => studiedLessons(workspace.lessons, language), [workspace.lessons, language])
  const number = nextParallelLesson(studied, LESSON_COUNT)
  const lesson = data && number !== undefined ? data.lessons.find(item => item.number === number) : undefined
  const words = data && lesson ? lessonWords(data, lesson) : []
  return <section className="experience-card" aria-label="New items">
    <div className="card-header-row">
      <div><p className="eyebrow accent">NEW · <span lang={language}>{language === 'ja' ? '日' : '한'}</span></p>
        <h2>{lesson ? `${words.length} new ${words.length === 1 ? 'item' : 'items'}` : data ? 'Nothing left to introduce' : 'Loading the lessons...'}</h2></div>
      {lesson && <a className="button primary" aria-label={`Start new ${languageName[language]} items`} href={`#lessons/${language}/${number}`}>Start <ArrowRight size={16} /></a>}
    </div>
    {lesson && <ul className="study-preview" aria-label="Items in this lesson">{words.map(word => <li key={word.id}>
      <span className="study-preview-form"><Form text={word.target} reading={word.reading} language={language} /></span>
      <span className="study-preview-gloss">{glossOf(word)}</span>
    </li>)}</ul>}
    {lesson && <p className="small muted">{languageName[language]} lesson {number} of {LESSON_COUNT}, with the matching Chinese HSK 1 lesson.</p>}
  </section>
}
