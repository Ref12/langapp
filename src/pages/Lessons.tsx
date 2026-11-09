import { ArrowLeft, ArrowRight } from 'lucide-react'
import { getWord } from '../data/mandarin'
import { curriculum, curriculumLevels } from '../data/curriculum'
import type { Lesson } from '../core/model'
import { lessonReviewWords, startPractice } from '../core/learning'
import { navigate } from '../core/routing'
import { EmptyState, WordCard, type PageProps } from '../components/shared'
import { CurriculumMap, GrammarReference } from './Curriculum'
import { SnippetActions } from '../components/assistant/SnippetActions'
import { lessonDefinitions } from '../data/learning-content'
import { LessonStudy } from '../components/learning/LessonStudy'
import { LessonPagination } from '../components/learning/LessonPagination'
import { MandarinWord } from '../components/MandarinWord'

export function Lessons(props: PageProps) {
  return <CurriculumMap {...props} />
}

export function LessonDetail({ lesson, workspace, busy, run, page }: PageProps & { lesson: Lesson; page?: string }) {
  const plan = lesson.curriculum
  const definition = lessonDefinitions.get(lesson.id)
  const level = curriculumLevels.find(item => item.id === plan.levelId)
  const active = workspace.sessions.find(session => session.status === 'active' && session.lessonId === lesson.id)
  const completed = workspace.lessons.find(item => item.lessonId === lesson.id)?.completedAt
  const reviewIds = active
    ? [...new Set(active.questions.map(question => question.wordId))].filter(id => !lesson.wordIds.includes(id))
    : lessonReviewWords(lesson, workspace.words)
  const practiceLabel = active ? 'Resume lesson practice' : completed !== undefined ? 'Practice this lesson again' : 'Start lesson practice'
  const beginPractice = () => void run(async () => navigate(`practice/${await startPractice('lesson', lesson.id)}`))
  if (definition) return <div className="lesson-player">
    <header className="lesson-heading">
      <a className="back-link" href={`#level/${plan.levelId}`}><ArrowLeft size={16} /> Level {level?.number}</a>
      <h1>{lesson.title}</h1>
    </header>
    <LessonStudy key={`${definition.label}:${page ?? '1'}`} definition={definition} lessonId={lesson.id} page={page}
      workspace={workspace} busy={busy} run={run} practice={<section className="panel lesson-practice-overview">
        <h2>{completed !== undefined ? 'Revisit this part.' : 'Try the reading practice.'}</h2>
        <p>{lesson.wordIds.length} new vocabulary senses{reviewIds.length ? ` and ${reviewIds.length} earlier senses to revisit` : ''}.</p>
        <p>Starting adds only this part's new senses. Grammar references, sibling meanings, and level goals are not marked mastered.</p>
        <button className="button primary full-width" disabled={busy} onClick={beginPractice}>{practiceLabel} <ArrowRight size={16} /></button>
      </section>} />
  </div>
  const grammarPages = plan.grammarIds.flatMap(id => {
    const grammar = curriculum.grammar.find(item => item.id === id)
    if (!grammar) throw new Error(`Missing curriculum construction: ${id}`)
    return [
      { grammar, page: 'rule' as const },
      ...grammar.examples.map((_, page) => ({ grammar, page })),
    ]
  })
  const total = lesson.wordIds.length + grammarPages.length + 1
  const current = page === undefined ? 1 : Number(page)
  if (!Number.isInteger(current) || current < 1 || current > total || (page !== undefined && !/^\d+$/.test(page))) {
    return <EmptyState title="This lesson page is not available"><a className="button primary" href={`#lesson/${lesson.id}`}>Back to the lesson</a></EmptyState>
  }
  const wordId = lesson.wordIds[current - 1]
  const grammarPage = grammarPages[current - lesson.wordIds.length - 1]
  const grammarLabel = grammarPage?.page === 'rule' ? 'GRAMMAR RULE'
    : grammarPage ? `EXAMPLE ${grammarPage.page + 1} OF ${grammarPage.grammar.examples.length}` : 'READY TO PRACTICE'
  const route = `lesson/${lesson.id}/${current}`
  const practiceButton = <button className={`button ${current === total ? 'primary' : 'secondary'} full-width`} disabled={busy} onClick={beginPractice}>
    {practiceLabel} <ArrowRight size={16} /></button>
  return <div className="lesson-player">
    <header className="lesson-heading">
      <a className="back-link" href={`#level/${plan.levelId}`}><ArrowLeft size={16} /> Level {level?.number}</a>
      <h1>{lesson.title}</h1>
      <div className="card-topline"><span className="eyebrow">PART {plan.number} / {wordId ? `WORD ${current} OF ${lesson.wordIds.length}` : grammarLabel}</span>
        <span className="small muted">Page {current} of {total}</span></div>
      <progress aria-label="Lesson pages" value={current} max={total} />
    </header>
    {wordId && <WordCard key={wordId} word={getWord(wordId)} state={workspace.words.find(item => item.wordId === wordId)}
      pinyin={workspace.preferences.pinyin} source={`lesson:${lesson.id}`} returnRoute={route} compact busy={busy} run={run} />}
    {grammarPage && <GrammarReference grammar={grammarPage.grammar} page={grammarPage.page} />}
    {current === total && <section className="panel lesson-practice-overview">
      <h2>{completed !== undefined ? 'Revisit this part.' : 'Try the reading practice.'}</h2>
      <p>{lesson.wordIds.length} new vocabulary senses{reviewIds.length ? ` and ${reviewIds.length} earlier senses to revisit` : ''}.</p>
      <p>Starting adds only this part's new senses. Grammar references, sibling meanings, and level goals are not marked mastered.</p>
    </section>}
    {current === total && practiceButton}
    {current === 1 && <details className="lesson-overview"><summary>Lesson overview and references</summary>
      {current !== total && practiceButton}
      <p>{lesson.objective}</p>
      <SnippetActions source={{ title: lesson.title, route, text: `${lesson.title}\n${lesson.objective}\nVocabulary:\n${lesson.wordIds.map(id => { const word = getWord(id); return `${word.native} (${word.pinyin}): ${word.meaning}` }).join('\n')}` }} />
      <p>{lesson.wordIds.length} selected vocabulary senses, {plan.grammarIds.length} new grammar references, and {reviewIds.length} earlier senses to revisit. The practice session checks reading recognition only.</p>
      <p className="small muted">Pinyin keeps each source sense's dictionary pronunciation. Tone changes in connected speech and spoken accuracy need separate instruction and assessment.</p>
      <p>{reviewIds.length ? 'Practice begins with these already-introduced senses, prioritizing the earliest due dates.' : 'No earlier review senses are in your learning set yet. You can start here without being credited for earlier lessons.'}</p>
      {reviewIds.length > 0 && <ul className="curriculum-goals">{reviewIds.map(id => <li key={id}>
        <MandarinWord word={getWord(id)} state={workspace.words.find(item => item.wordId === id)} pinyin={workspace.preferences.pinyin} /> / {getWord(id).meaning}
      </li>)}</ul>}
      {plan.reviewGrammarIds.length > 0 && <details className="panel"><summary>Earlier grammar references ({plan.reviewGrammarIds.length})</summary>
        {plan.reviewGrammarIds.map(id => {
          const grammar = curriculum.grammar.find(item => item.id === id)
          if (!grammar) throw new Error(`Missing review construction: ${id}`)
          return <GrammarReference key={id} grammar={grammar} />
        })}
      </details>}
    </details>}
    <LessonPagination lessonId={lesson.id} current={current} total={total} nextLabel={current < lesson.wordIds.length ? 'Next word' : 'Next'} />
  </div>
}
