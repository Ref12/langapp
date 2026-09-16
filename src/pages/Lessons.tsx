import { ArrowLeft, ArrowRight, BookOpen, Check } from 'lucide-react'
import { getWord, lessons } from '../data/mandarin'
import type { Lesson } from '../core/model'
import { startPractice } from '../core/learning'
import { navigate } from '../core/routing'
import { PageHeading, WordCard, type PageProps } from '../components/shared'

export function Lessons({ workspace }: PageProps) {
  return <>
    <PageHeading eyebrow="YOUR PATH. YOUR REASONS TO LEARN." title="Make it useful. Make it yours.">Start with a greeting, a request, or a plan. These authored lessons are not official HSK level assessments.</PageHeading>
    <div className="lesson-list">{lessons.map((lesson, index) => {
      const progress = workspace.lessons.find(item => item.lessonId === lesson.id)
      return <a className="lesson-card" href={`#lesson/${lesson.id}`} key={lesson.id}>
        <span className="lesson-number">{progress?.completedAt ? <Check size={24} /> : String(index + 1).padStart(2, '0')}</span>
        <div><span className="eyebrow">{progress?.completedAt ? 'PRACTICED' : progress ? 'IN PROGRESS' : 'STARTER LESSON'}</span><h2>{lesson.title}</h2><p>{lesson.objective}</p>
          <span className="small muted">{lesson.wordIds.length} words / {lesson.wordIds.length * 2} reading questions</span></div><ArrowRight size={20} />
      </a>
    })}</div>
  </>
}

export function LessonDetail({ lesson, workspace, busy, run }: PageProps & { lesson: Lesson }) {
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
