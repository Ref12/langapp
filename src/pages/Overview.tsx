import { ArrowRight, BookOpen, CheckCircle2, Sprout, Sparkles } from 'lucide-react'
import { stories } from '../data/mandarin'
import { curriculumWords, nextCurriculumLesson } from '../data/curriculum'
import { readingStage } from '../core/progress'
import { startPractice } from '../core/learning'
import { navigate } from '../core/routing'
import { PageHeading, TeaArt, type PageProps } from '../components/shared'

export function Overview({ workspace, now, run, busy }: PageProps) {
  const latest = [...workspace.readings].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const story = stories.find(item => item.id === latest?.storyId) ?? stories[0]
  const reading = workspace.readings.find(item => item.storyId === story.id)
  const due = workspace.words.filter(word => word.dueAt <= now).length
  const learned = workspace.words.filter(word => readingStage(word) === 'Learned').length
  const completedLessons = workspace.lessons.filter(lesson => lesson.completedAt).length
  const nextLesson = nextCurriculumLesson(workspace)
  const active = [...workspace.sessions].filter(session => session.status === 'active').sort((a, b) => b.createdAt - a.createdAt)[0]
  return <>
    <PageHeading eyebrow="A LITTLE EVERY DAY" title="Make the language yours." action={<a className="button secondary" href="#library">Explore library <ArrowRight size={16} /></a>}>
      Read something you love. Learn something that stays.
    </PageHeading>
    <section className="overview-feature">
      <article className="continue-card">
        <div className="continue-copy"><p className="eyebrow accent">{reading ? 'PICK UP WHERE YOU LEFT OFF' : 'YOUR FIRST MOMENT IN MANDARIN'}</p>
          <h2>{story.title}</h2><p>{story.description}</p>
          <div className="inline-meta"><span>{story.topic}</span><span>Guided reading</span><span>{story.passages.length} passages</span></div>
          <a className="button primary" href={`#reader/${story.id}`}>{reading ? 'Continue reading' : 'Start reading'} <ArrowRight size={16} /></a>
          <div className="reading-progress"><span>{reading?.completed.length ?? 0} of {story.passages.length} passages read</span>
            <progress aria-label="Story progress" value={reading?.completed.length ?? 0} max={story.passages.length} /></div>
        </div><TeaArt />
      </article>
      <article className="daily-card"><div className="card-topline"><span className="eyebrow">KEEP IT FRESH</span><Sparkles size={20} /></div>
        <div className="review-count">{due}<span>{due === 1 ? 'word to revisit' : 'words to revisit'}</span></div>
        <p className="muted">{workspace.words.length ? 'A little recall goes a long way. Practice the words in your learning set.' : 'Add a word while reading, or start a lesson. Your review queue will grow with you.'}</p>
        {active ? <a className="button primary full-width" href={`#practice/${active.id}`}>Resume saved practice <ArrowRight size={16} /></a>
          : due ? <button className="button primary full-width" disabled={busy} onClick={() => void run(async () => navigate(`practice/${await startPractice('due')}`))}>Start a quick review <ArrowRight size={16} /></button>
            : <a className="button secondary full-width" href="#lessons">Explore the Mandarin path <ArrowRight size={16} /></a>}
        <p className="small muted">Saved on this device. No account needed.</p>
      </article>
    </section>
    <section className="stats-strip" aria-label="Your actual learning progress">
      <div><Sprout /><strong>{workspace.words.length}<small>words in your learning set</small></strong></div>
      <div><BookOpen /><strong>{completedLessons}<small>reading lessons practiced</small></strong></div>
      <div><CheckCircle2 /><strong>{learned}<small>words learned in reading</small></strong></div>
    </section>
    <div className="section-heading"><div><h2>Your next useful idea</h2><p className="muted">One connected learning journey. Start wherever you are curious.</p></div><span className="tag">Practical Mandarin</span></div>
    <div className="experience-grid">
      <a className="experience-card" href={nextLesson ? `#lesson/${nextLesson.id}` : '#lessons'}><span className="eyebrow accent">{nextLesson ? 'NEXT CURRICULUM LESSON' : 'YOUR MANDARIN PATH'}</span><h3>{nextLesson?.title ?? 'Revisit your beginner path.'}</h3><p>{nextLesson?.objective ?? 'Keep recognition fresh while contextual and productive assessments are still to come.'}</p><span className="text-link">{nextLesson ? 'Open lesson' : 'Explore course map'} <ArrowRight size={16} /></span></a>
      <a className="experience-card" href="#dictionary"><span className="eyebrow accent">YOUR WORDS, TOGETHER</span><h3>See what is taking root.</h3><p>{curriculumWords.length} real curriculum senses and your preserved starter examples. Only items you add count as introduced.</p><span className="text-link">Open Dictionary <ArrowRight size={16} /></span></a>
      <a className="experience-card" href="#practice"><span className="eyebrow accent">MEANING BEFORE MEMORIZATION</span><h3>Give a word another moment.</h3><p>Recognize characters and meanings. Hints are recorded separately from unaided answers.</p><span className="text-link">Explore practice <ArrowRight size={16} /></span></a>
    </div>
  </>
}
