import { ArrowRight, BookOpen, RotateCcw, Sprout, Sparkles } from 'lucide-react'
import { getPack, bandName, isAreaOn } from '../core/language'
import { KnowledgeCounts } from '../components/study/KnowledgeCounts'
import { rowsOfCurrentLanguage } from '../core/language/scope'
import { DOMAIN } from '../core/study/knowledge'
import { countItems } from '../core/study/daily'
import { levelProgress, moduleOf, unitIndexOf } from '../core/study/modules'
import { curriculumWords } from '../data/curriculum'
import { RestoreOffer } from '../components/BackupPanel'
import { PageHeading, type PageProps } from '../components/shared'
import { navigate } from '../core/routing'
import { useStudyActions } from './useStudyActions'

const WEEK = 7 * 24 * 60 * 60 * 1000

export function Overview({ workspace, now, run, busy }: PageProps) {
  const { catalog, rows, next, known: knownRefsOfStudy } = useStudyActions({ workspace, now, run })
  // The counts are the learner's language only. The Lab Chinese build's tables can still hold old ja:/ko: rows (kept, never shown); rowsOfCurrentLanguage leaves them out.
  const preferences = workspace.preferences
  const knowledge = rowsOfCurrentLanguage(workspace.knowledge, entry => [entry.ref], preferences)
  const knownRefs = new Set(knowledge.map(entry => entry.ref))
  const due = rowsOfCurrentLanguage(workspace.studyCards, card => [card.ref], preferences).filter(card => card.domain === DOMAIN && card.due <= now && knownRefs.has(card.ref)).length
  const resumable = rows.find(row => row.origin.kind === 'new')?.session
  const finished = rowsOfCurrentLanguage(workspace.exerciseSessions, session => [...session.targetRefs, ...session.reviewRefs], preferences).filter(session => session.status === 'completed')
  const lessonsDone = finished.filter(session => session.mode === 'new' && !session.redoOf).length
  const reviewsThisWeek = finished.filter(session => session.mode === 'review' && (session.completedAt ?? session.createdAt) > now - WEEK).length
  const pack = getPack()
  // A pack whose catalog has no groups yet (Korean for now): say lessons are coming, not that every unit is added.
  const empty = Boolean(catalog) && catalog!.orderedGroups.length === 0
  // The level the learner is in (the next unit's, else the last one once everything is added), the module and the place of the unit in it.
  const level = catalog && !empty ? next?.band ?? catalog.orderedGroups.at(-1)?.band : undefined
  const levelDone = catalog && level ? levelProgress(catalog, knownRefsOfStudy, level) : undefined
  const unitAt = catalog && next ? unitIndexOf(catalog, next.band, next.group.id) : 0
  const place = catalog && level ? moduleOf(catalog, level, next ? unitAt : levelDone?.total ?? 0) : undefined
  const headline = next && catalog ? [bandName(pack, next.band), place?.module.title, place ? `Unit ${place.position} of ${place.size}` : `Unit ${unitAt} of ${levelDone?.total ?? unitAt}`].filter(Boolean).join(' · ') : ''
  return <>
    <PageHeading eyebrow="A LITTLE EVERY DAY" title="Make the language yours." action={<a className="button secondary" href="#lessons">New or review <ArrowRight size={16} /></a>}>
      {`Build useful ${pack.wording.language} through short lessons and regular practice.`}
    </PageHeading>
    <RestoreOffer />
    <section className="overview-feature">
      <article className="course-card panel feature-panel" aria-label="Next step">
        <p className="eyebrow accent">{resumable ? 'PICK UP YOUR LESSON' : empty ? 'COMING SOON' : next ? `YOUR NEXT STEP IN ${pack.wording.language.toUpperCase()}` : catalog ? 'KEEP YOUR MOMENTUM' : 'LOADING'}</p>
        <h2>{empty ? `Lessons are on their way for ${pack.wording.language}.` : next ? headline : catalog ? 'You have added every unit.' : 'Loading the curriculum...'}</h2>
        <p>{empty ? 'You can already practice writing. Reviews and practice will follow with the lessons.' : next ? `${next.newUnits.length} new ${next.newUnits.length === 1 ? 'item' : 'items'} to add to your knowledge set.`   : catalog ? `Review what is due and keep building toward ${pack.wording.goals}.` : ''}</p>
        {resumable ? <a className="button primary" href={`#lessons/session/${resumable.id}`}>Resume lesson <ArrowRight size={16} /></a>
          : <button className="button primary" disabled={busy || !next} onClick={() => navigate('practice?mode=new')}>Start new items <ArrowRight size={16} /></button>}
        {levelDone && level && !empty && <div className="course-progress"><div className="card-topline"><span>{`${bandName(pack, level)}: ${levelDone.completed} of ${levelDone.total} units`}</span></div>
          <progress aria-label={`${bandName(pack, level)} units added`} value={levelDone.completed} max={levelDone.total} />
          {place && <p className="small muted">{`Module ${place.moduleNumber} of ${place.moduleCount}`}</p>}
          <p className="small muted">Practice is a step toward the course goals, not a fluency assessment.</p></div>}
      </article>
      <article className="daily-card"><div className="card-topline"><span className="eyebrow">KEEP IT FRESH</span><Sparkles size={20} /></div>
        <div className="review-count">{due}<span>{due === 1 ? 'item to review' : 'items to review'}</span></div>
        <p className="muted">{knowledge.length ? 'A little recall goes a long way. Review what is due.' : 'Start a lesson or add items from your Dictionary. Your review queue will grow with you.'}</p>
        {due ? <button className="button primary full-width" disabled={busy} onClick={() => navigate('practice?mode=review')}>Review due items <ArrowRight size={16} /></button>
          : <a className="button secondary full-width" href="#lessons">Nothing due. Go to Lessons <ArrowRight size={16} /></a>}
        <p className="small muted">Saved on this device. No account needed.</p>
      </article>
    </section>
    <section className="stats-strip" aria-label="Your actual learning progress">
      <div><Sprout /><strong>{countItems(knowledge).words}<small>words in your knowledge set</small><KnowledgeCounts knowledge={knowledge} rest /></strong></div>
      <div><BookOpen /><strong>{lessonsDone}<small>new-item units finished</small></strong></div>
      <div><RotateCcw /><strong>{reviewsThisWeek}<small>reviews finished in the last 7 days</small></strong></div>
    </section>
    <div className="section-heading"><div><h2>Your next useful idea</h2><p className="muted">One connected learning journey. Start wherever you are curious.</p></div><span className="tag">{`Practical ${pack.wording.language}`}</span></div>
    <div className="experience-grid">
      {isAreaOn(pack, 'wordLists') && <a className="experience-card" href="#curriculum"><span className="eyebrow accent">{`YOUR ${pack.wording.language.toUpperCase()} PATH`}</span><h3>See where you are headed.</h3><p>Explore HSK 1-6 readiness sections across six phases and thirty levels. The lessons are ready now; later skills and mock work are mapped transparently.</p><span className="text-link">Explore course map <ArrowRight size={16} /></span></a>}
      {isAreaOn(pack, 'dictionary') && <a className="experience-card" href="#dictionary"><span className="eyebrow accent">YOUR WORDS, TOGETHER</span><h3>See what is taking root.</h3><p>{curriculumWords.length} real curriculum senses and your preserved starter examples. Only items you add count as introduced.</p><span className="text-link">Open Dictionary <ArrowRight size={16} /></span></a>}
      <a className="experience-card" href="#review"><span className="eyebrow accent">MEANING BEFORE MEMORIZATION</span><h3>Give a word another moment.</h3><p>{`Recognize ${pack.countsCharacters ? 'characters' : 'words'} and meanings. Hints are recorded separately from unaided answers.`}</p><span className="text-link">Explore practice <ArrowRight size={16} /></span></a>
    </div>
  </>
}
