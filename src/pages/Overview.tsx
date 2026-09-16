import { ArrowRight, BookOpen, Sprout, Sparkles } from 'lucide-react'
import { lessons } from '../data/mandarin'
import { curriculumLevels, curriculumWords, nextCurriculumLesson } from '../data/curriculum'
import { startPractice } from '../core/learning'
import { navigate } from '../core/routing'
import { PageHeading, type PageProps } from '../components/shared'

export function Overview({ workspace, now, run, busy }: PageProps) {
  const due = workspace.words.filter(word => word.dueAt <= now).length
  const completedLessons = workspace.lessons.filter(state => state.completedAt !== undefined && lessons.some(lesson => lesson.id === state.lessonId)).length
  const nextLesson = nextCurriculumLesson(workspace)
  const level = curriculumLevels.find(item => item.id === nextLesson?.curriculum.levelId)
  const activeSessions = workspace.sessions.filter(session => session.status === 'active').sort((a, b) => b.createdAt - a.createdAt)
  const active = activeSessions[0]
  const lessonSession = nextLesson && activeSessions.find(session => session.lessonId === nextLesson.id)
  return <>
    <PageHeading eyebrow="A LITTLE EVERY DAY" title="Make the language yours." action={<a className="button secondary" href="#lessons">Explore curriculum <ArrowRight size={16} /></a>}>
      Build useful Mandarin through short lessons and regular practice.
    </PageHeading>
    <section className="overview-feature">
      <article className="course-card panel feature-panel" aria-label="Curriculum focus">
        <p className="eyebrow accent">{lessonSession ? 'PICK UP YOUR NEXT LESSON' : nextLesson ? 'YOUR NEXT STEP IN MANDARIN' : 'KEEP YOUR MOMENTUM'}</p>
        <h2>{nextLesson?.title ?? 'Keep your Mandarin growing.'}</h2>
        <p>{nextLesson?.objective ?? 'You have practiced every available beginner lesson. Revisit your vocabulary and keep building toward the course goals.'}</p>
        {nextLesson && <div className="inline-meta">
          {level && <span>Level {level.number}: {level.title}</span>}
          <span>{nextLesson.wordIds.length} vocabulary senses</span>
          {nextLesson.curriculum.grammarIds.length > 0 && <span>A construction to explore</span>}
        </div>}
        <a className="button primary" href={lessonSession ? `#practice/${lessonSession.id}` : nextLesson ? `#lesson/${nextLesson.id}` : '#practice'}>
          {lessonSession ? 'Resume lesson' : nextLesson ? 'Start next lesson' : 'Revisit your vocabulary'} <ArrowRight size={16} /></a>
        <div className="course-progress"><div className="card-topline"><span>Beginner lessons practiced</span><strong>{completedLessons} / {lessons.length}</strong></div>
          <progress aria-label="Beginner lesson practice" value={completedLessons} max={lessons.length} />
          <p className="small muted">Practice is a step toward the course goals, not a fluency assessment.</p>
        </div>
      </article>
      <article className="daily-card"><div className="card-topline"><span className="eyebrow">KEEP IT FRESH</span><Sparkles size={20} /></div>
        <div className="review-count">{due}<span>{due === 1 ? 'word to revisit' : 'words to revisit'}</span></div>
        <p className="muted">{workspace.words.length ? 'A little recall goes a long way. Practice the words in your learning set.' : 'Start a lesson or add vocabulary from your Dictionary. Your review queue will grow with you.'}</p>
        {active ? <a className="button primary full-width" href={`#practice/${active.id}`}>Resume saved practice <ArrowRight size={16} /></a>
          : due ? <button className="button primary full-width" disabled={busy} onClick={() => void run(async () => navigate(`practice/${await startPractice('due')}`))}>Start a quick review <ArrowRight size={16} /></button>
            : <a className="button secondary full-width" href="#lessons">Explore the Mandarin path <ArrowRight size={16} /></a>}
        <p className="small muted">Saved on this device. No account needed.</p>
      </article>
    </section>
    <section className="stats-strip" aria-label="Your actual learning progress">
      <div><Sprout /><strong>{workspace.words.length}<small>vocabulary items introduced</small></strong></div>
      <div><BookOpen /><strong>{completedLessons}<small>lessons practiced</small></strong></div>
      <div><Sparkles /><strong>{activeSessions.length}<small>practice sessions in progress</small></strong></div>
    </section>
    <div className="section-heading"><div><h2>Your next useful idea</h2><p className="muted">One connected learning journey. Start wherever you are curious.</p></div><span className="tag">Practical Mandarin</span></div>
    <div className="experience-grid">
      <a className="experience-card" href="#lessons"><span className="eyebrow accent">YOUR MANDARIN PATH</span><h3>See where you are headed.</h3><p>Explore the course goals across six phases and thirty levels. The beginner path is ready to work through at your own pace.</p><span className="text-link">Explore course map <ArrowRight size={16} /></span></a>
      <a className="experience-card" href="#dictionary"><span className="eyebrow accent">YOUR WORDS, TOGETHER</span><h3>See what is taking root.</h3><p>{curriculumWords.length} real curriculum senses and your preserved starter examples. Only items you add count as introduced.</p><span className="text-link">Open Dictionary <ArrowRight size={16} /></span></a>
      <a className="experience-card" href="#practice"><span className="eyebrow accent">MEANING BEFORE MEMORIZATION</span><h3>Give a word another moment.</h3><p>Recognize characters and meanings. Hints are recorded separately from unaided answers.</p><span className="text-link">Explore practice <ArrowRight size={16} /></span></a>
    </div>
  </>
}
