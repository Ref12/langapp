import { ArrowLeft, ArrowRight, BookOpen, Check } from 'lucide-react'
import { getWord, starterLessons } from '../data/mandarin'
import { curriculum, curriculumLevels } from '../data/curriculum'
import type { Lesson } from '../core/model'
import { lessonReviewWords, startPractice } from '../core/learning'
import { navigate } from '../core/routing'
import { PageHeading, WordCard, type PageProps } from '../components/shared'
import { CurriculumMap, GrammarReference } from './Curriculum'

export function Lessons(props: PageProps) {
  const { workspace } = props
  return <>
    <CurriculumMap {...props} />
    <details className="panel starter-lessons"><summary>Original starter lessons</summary>
      <p className="muted">Your earlier lessons and saved progress remain here. Their local example IDs do not award curriculum evidence.</p>
    <div className="lesson-list">{starterLessons.map((lesson, index) => {
      const progress = workspace.lessons.find(item => item.lessonId === lesson.id)
      return <a className="lesson-card" href={`#lesson/${lesson.id}`} key={lesson.id}>
        <span className="lesson-number">{progress?.completedAt ? <Check size={24} /> : String(index + 1).padStart(2, '0')}</span>
        <div><span className="eyebrow">{progress?.completedAt ? 'PRACTICED' : progress ? 'IN PROGRESS' : 'STARTER LESSON'}</span><h2>{lesson.title}</h2><p>{lesson.objective}</p>
          <span className="small muted">{lesson.wordIds.length} words / {lesson.wordIds.length * 2} reading questions</span></div><ArrowRight size={20} />
      </a>
    })}</div></details>
  </>
}

export function LessonDetail({ lesson, workspace, busy, run }: PageProps & { lesson: Lesson }) {
  if (lesson.curriculum) return <CurriculumLessonDetail lesson={lesson} workspace={workspace} busy={busy} run={run} />
  const active = workspace.sessions.find(session => session.status === 'active' && session.lessonId === lesson.id)
  const completed = workspace.lessons.find(item => item.lessonId === lesson.id)?.completedAt
  return <>
    <a className="back-link" href="#lessons"><ArrowLeft size={16} /> All lessons</a>
    <PageHeading eyebrow="YOUR NEXT USEFUL IDEA" title={lesson.title}>{lesson.objective}</PageHeading>
    <section className="lesson-example panel feature-panel"><p className="eyebrow accent">WORDS WORKING TOGETHER</p>
      <p lang="zh-Hans" className="lesson-native">{lesson.native}</p>
      {workspace.preferences.pinyin && <p className="pinyin">{lesson.pinyin}</p>}<p>{lesson.translation}</p>
    </section>
    <section className="panel"><h2>A pattern to keep</h2><p>{lesson.pattern}</p><p className="muted">{lesson.note}</p>
      {lesson.storyId && <a href={`#reader/${lesson.storyId}`} className="text-link"><BookOpen size={16} /> Read the companion story</a>}
    </section>
    <div className="section-heading"><h2>Words for your world</h2><span className="small muted">One learning set, everywhere</span></div>
    <div className="word-grid">{lesson.wordIds.map(id => <WordCard key={id} word={getWord(id)} state={workspace.words.find(item => item.wordId === id)} pinyin={workspace.preferences.pinyin} source={`lesson:${lesson.id}`} busy={busy} run={run} />)}</div>
    <section className="panel practice-invitation"><div><h2>{completed ? 'Give it another try.' : 'Make it your own.'}</h2><p>Practice adds these words to your learning set. Reading a lesson alone does not count as an unaided answer.</p></div>
      <button className="button primary" disabled={busy} onClick={() => void run(async () => navigate(`practice/${await startPractice('lesson', lesson.id)}`))}>
        {active ? 'Resume lesson practice' : completed ? 'Practice this lesson again' : 'Start lesson practice'} <ArrowRight size={16} /></button>
    </section>
  </>
}

function CurriculumLessonDetail({ lesson, workspace, busy, run }: Pick<PageProps, 'workspace' | 'busy' | 'run'> & { lesson: Lesson }) {
  const plan = lesson.curriculum
  if (!plan) throw new Error('Curriculum lesson plan is missing.')
  const level = curriculumLevels.find(item => item.id === plan.levelId)
  const active = workspace.sessions.find(session => session.status === 'active' && session.lessonId === lesson.id)
  const completed = workspace.lessons.find(item => item.lessonId === lesson.id)?.completedAt
  const reviewIds = active
    ? [...new Set(active.questions.map(question => question.wordId))].filter(id => !lesson.wordIds.includes(id))
    : lessonReviewWords(lesson, workspace.words)
  return <>
    <a className="back-link" href={`#level/${plan.levelId}`}><ArrowLeft size={16} /> Level {level?.number}: {level?.title}</a>
    <PageHeading eyebrow={`LEVEL ${level?.number} / PART ${plan.number}`} title={lesson.title}>{lesson.objective}</PageHeading>
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
    <p className="page-footnote">Source meanings, pinyin, and IDs are preserved from the Chinese curriculum. <a href="#curriculum-sources">Attribution and licenses</a>.</p>
  </>
}
