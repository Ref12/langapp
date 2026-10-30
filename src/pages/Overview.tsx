import { ArrowRight, BookOpen, RotateCcw, Sprout, Sparkles } from 'lucide-react'
import { curriculumWords } from '../data/curriculum'
import { RestoreOffer } from '../components/BackupPanel'
import { PageHeading, type PageProps } from '../components/shared'
import { useStudyActions } from './useStudyActions'

const WEEK = 7 * 24 * 60 * 60 * 1000

export function Overview({ workspace, now, run, busy }: PageProps) {
  const { catalog, connection, due, active, next, progress, start } = useStudyActions({ workspace, now, run })
  const resumable = active.find(session => session.mode === 'new' && !session.redoOf)
  const finished = workspace.exerciseSessions.filter(session => session.status === 'completed')
  const lessonsDone = finished.filter(session => session.mode === 'new' && !session.redoOf).length
  const reviewsThisWeek = finished.filter(session => session.mode === 'review' && (session.completedAt ?? session.createdAt) > now - WEEK).length
  return <>
    <PageHeading eyebrow="A LITTLE EVERY DAY" title="Make the language yours." action={<a className="button secondary" href="#lessons">New or review <ArrowRight size={16} /></a>}>
      Build useful Mandarin through short lessons and regular practice.
    </PageHeading>
    <RestoreOffer />
    <section className="overview-feature">
      <article className="course-card panel feature-panel" aria-label="Next step">
        <p className="eyebrow accent">{resumable ? 'PICK UP YOUR LESSON' : next ? 'YOUR NEXT STEP IN MANDARIN' : catalog ? 'KEEP YOUR MOMENTUM' : 'LOADING'}</p>
        <h2>{next ? `HSK ${next.band}, group ${Math.min((progress?.completed ?? 0) + 1, progress?.total ?? 1)} of ${progress?.total ?? 1}` : catalog ? 'You have added every group.' : 'Loading the curriculum...'}</h2>
        <p>{next ? `${next.newUnits.length} new ${next.newUnits.length === 1 ? 'item' : 'items'} to add to your knowledge set.` : catalog ? 'Review what is due and keep building toward the HSK goals.' : ''}</p>
        {resumable ? <a className="button primary" href={`#lessons/session/${resumable.id}`}>Resume lesson <ArrowRight size={16} /></a>
          : <button className="button primary" disabled={busy || !next || !connection} onClick={() => start('new')}>Start new items <ArrowRight size={16} /></button>}
        {!connection && next && <p className="small muted"><a className="text-link" href="#settings">Connect a model in Settings</a> to start a session.</p>}
        {progress && <div className="course-progress"><div className="card-topline"><span>Groups added to your knowledge set</span><strong>{progress.completed} / {progress.total}</strong></div>
          <progress aria-label="Curriculum groups completed" value={progress.completed} max={progress.total} />
          <p className="small muted">Practice is a step toward the course goals, not a fluency assessment.</p></div>}
      </article>
      <article className="daily-card"><div className="card-topline"><span className="eyebrow">KEEP IT FRESH</span><Sparkles size={20} /></div>
        <div className="review-count">{due}<span>{due === 1 ? 'item to review' : 'items to review'}</span></div>
        <p className="muted">{workspace.knowledge.length ? 'A little recall goes a long way. Review what is due.' : 'Start a lesson or add items from your Dictionary. Your review queue will grow with you.'}</p>
        {due ? <button className="button primary full-width" disabled={busy || !connection} onClick={() => start('review')}>Review due items <ArrowRight size={16} /></button>
          : <a className="button secondary full-width" href="#lessons">Nothing due. Go to Lessons <ArrowRight size={16} /></a>}
        <p className="small muted">Saved on this device. No account needed.</p>
      </article>
    </section>
    <section className="stats-strip" aria-label="Your actual learning progress">
      <div><Sprout /><strong>{workspace.knowledge.length}<small>items in your knowledge set</small></strong></div>
      <div><BookOpen /><strong>{lessonsDone}<small>new-item lessons finished</small></strong></div>
      <div><RotateCcw /><strong>{reviewsThisWeek}<small>reviews finished in the last 7 days</small></strong></div>
    </section>
    <div className="section-heading"><div><h2>Your next useful idea</h2><p className="muted">One connected learning journey. Start wherever you are curious.</p></div><span className="tag">Practical Mandarin</span></div>
    <div className="experience-grid">
      <a className="experience-card" href="#curriculum"><span className="eyebrow accent">YOUR MANDARIN PATH</span><h3>See where you are headed.</h3><p>Explore HSK 1-6 readiness sections across six phases and thirty levels. The lessons are ready now; later skills and mock work are mapped transparently.</p><span className="text-link">Explore course map <ArrowRight size={16} /></span></a>
      <a className="experience-card" href="#dictionary"><span className="eyebrow accent">YOUR WORDS, TOGETHER</span><h3>See what is taking root.</h3><p>{curriculumWords.length} real curriculum senses and your preserved starter examples. Only items you add count as introduced.</p><span className="text-link">Open Dictionary <ArrowRight size={16} /></span></a>
      <a className="experience-card" href="#practice"><span className="eyebrow accent">MEANING BEFORE MEMORIZATION</span><h3>Give a word another moment.</h3><p>Recognize characters and meanings. Hints are recorded separately from unaided answers.</p><span className="text-link">Explore practice <ArrowRight size={16} /></span></a>
    </div>
  </>
}
