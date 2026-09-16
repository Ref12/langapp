import { ArrowLeft, ArrowRight } from 'lucide-react'
import { getWord } from '../data/mandarin'
import { curriculum, curriculumLevels } from '../data/curriculum'
import type { Lesson } from '../core/model'
import { lessonReviewWords, startPractice } from '../core/learning'
import { navigate } from '../core/routing'
import { PageHeading, WordCard, type PageProps } from '../components/shared'
import { CurriculumMap, GrammarReference } from './Curriculum'
import { SnippetActions } from '../components/assistant/SnippetActions'

export function Lessons(props: PageProps) {
  return <CurriculumMap {...props} />
}

export function LessonDetail({ lesson, workspace, busy, run }: PageProps & { lesson: Lesson }) {
  const plan = lesson.curriculum
  const level = curriculumLevels.find(item => item.id === plan.levelId)
  const active = workspace.sessions.find(session => session.status === 'active' && session.lessonId === lesson.id)
  const completed = workspace.lessons.find(item => item.lessonId === lesson.id)?.completedAt
  const reviewIds = active
    ? [...new Set(active.questions.map(question => question.wordId))].filter(id => !lesson.wordIds.includes(id))
    : lessonReviewWords(lesson, workspace.words)
  return <>
    <a className="back-link" href={`#level/${plan.levelId}`}><ArrowLeft size={16} /> Level {level?.number}: {level?.title}</a>
    <PageHeading eyebrow={`LEVEL ${level?.number} / PART ${plan.number}`} title={lesson.title}>{lesson.objective}</PageHeading>
    <SnippetActions source={{ title: lesson.title, route: `lesson/${lesson.id}`, text: `${lesson.title}\n${lesson.objective}\nVocabulary:\n${lesson.wordIds.map(id => { const word = getWord(id); return `${word.native} (${word.pinyin}): ${word.meaning} [${word.id}]` }).join('\n')}` }} />
    <section className="panel feature-panel"><h2>A small step toward the module goal</h2><p>{lesson.wordIds.length} selected vocabulary senses, {plan.grammarIds.length} new grammar references, and {reviewIds.length} earlier senses to revisit. The practice session checks reading recognition only.</p>
      <p className="small muted">Pinyin keeps each source sense's dictionary pronunciation. Tone changes in connected speech and spoken accuracy need separate instruction and assessment.</p>
    </section>
    <section className="panel"><h2>First, a little retrieval</h2><p>{reviewIds.length ? 'Practice begins with these already-introduced senses, prioritizing the earliest due dates.' : 'No earlier review senses are in your learning set yet. You can start here without being credited for earlier lessons.'}</p>
      {reviewIds.length > 0 && <ul className="curriculum-goals">{reviewIds.map(id => <li key={id}><span lang="zh-Hans">{getWord(id).native}</span> / {getWord(id).meaning}</li>)}</ul>}
    </section>
    <div className="section-heading"><h2>New senses for this part</h2><span className="small muted">Same form can have different meanings</span></div>
    <div className="word-grid">{lesson.wordIds.map(id => <WordCard key={id} word={getWord(id)} state={workspace.words.find(item => item.wordId === id)} pinyin={workspace.preferences.pinyin} source={`lesson:${lesson.id}`} busy={busy} run={run} />)}</div>
    {plan.grammarIds.length > 0 && <div className="section-heading"><h2>A construction to explore</h2></div>}
    {plan.grammarIds.map(id => {
      const grammar = curriculum.grammar.find(item => item.id === id)
      if (!grammar) throw new Error(`Missing curriculum construction: ${id}`)
      return <GrammarReference key={id} grammar={grammar} />
    })}
    {plan.reviewGrammarIds.length > 0 && <details className="panel"><summary>Earlier grammar references ({plan.reviewGrammarIds.length})</summary>
      {plan.reviewGrammarIds.map(id => {
        const grammar = curriculum.grammar.find(item => item.id === id)
        if (!grammar) throw new Error(`Missing review construction: ${id}`)
        return <GrammarReference key={id} grammar={grammar} />
      })}
    </details>}
    <section className="panel practice-invitation"><div><h2>{completed !== undefined ? 'Revisit this part.' : 'Try the reading practice.'}</h2><p>Starting adds only this part's new senses. Grammar references, sibling meanings, and level goals are not marked mastered.</p></div>
      <button className="button primary" disabled={busy} onClick={() => void run(async () => navigate(`practice/${await startPractice('lesson', lesson.id)}`))}>
        {active ? 'Resume lesson practice' : completed !== undefined ? 'Practice this lesson again' : 'Start lesson practice'} <ArrowRight size={16} /></button>
    </section>
  </>
}
