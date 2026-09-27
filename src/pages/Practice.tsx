import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, RotateCcw } from 'lucide-react'
import { getWord, lessons } from '../data/mandarin'
import { curriculumLevels, nextCurriculumLesson } from '../data/curriculum'
import { advancePractice, revealAnswer, startPractice, submitAnswer } from '../core/learning'
import type { Attempt, PracticeSession } from '../core/model'
import { navigate } from '../core/routing'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { SnippetActions } from '../components/assistant/SnippetActions'
import { MandarinWord } from '../components/MandarinWord'
import { AnswerButton } from '../components/AnswerButton'

export function Practice({ workspace, now, run, busy }: PageProps) {
  const due = workspace.words.filter(word => word.dueAt <= now).length
  const active = workspace.sessions.filter(session => session.status === 'active').sort((a, b) => b.createdAt - a.createdAt)
  return <>
    <PageHeading eyebrow="TURN ENCOUNTERS INTO KNOWLEDGE" title="A little practice. A little closer.">Recognize Mandarin words and their meanings. Your answers and any help you use are saved as you go.</PageHeading>
    {active.length > 0 && <section className="panel"><h2>Pick up where you left off</h2><div className="resume-list">{active.map(session => <a className="resume-row" key={session.id} href={`#practice/${session.id}`}>
      <div><strong>{lessons.find(lesson => lesson.id === session.lessonId)?.title ?? 'Vocabulary review'}</strong><span className="small muted">Question {session.cursor + 1} of {session.questions.length}</span></div><ArrowRight size={18} />
    </a>)}</div></section>}
    <div className="experience-grid two-columns">
      <section className="experience-card"><p className="eyebrow accent">DUE NOW</p><h2>{due} {due === 1 ? 'word' : 'words'} to revisit</h2><p>Review up to 10 due words. Misses and revealed answers come back after five minutes; unaided success gets more space.</p>
        <button className="button primary" disabled={busy || !due} onClick={() => void run(async () => navigate(`practice/${await startPractice('due')}`))}>Review due words <ArrowRight size={16} /></button></section>
      <section className="experience-card"><p className="eyebrow accent">AT YOUR OWN PACE</p><h2>Practice your learning set</h2><p>Choose another round even when nothing is due. Repeating today does not count as practice on a new day.</p>
        <button className="button secondary" disabled={busy || !workspace.words.length} onClick={() => void run(async () => navigate(`practice/${await startPractice('all')}`))}>Practice now <RotateCcw size={16} /></button></section>
    </div>
    {!workspace.words.length && <EmptyState title="Your first words are waiting"><p>Start a lesson, or add an underlined word while reading.</p><a href="#lessons" className="button primary">Explore lessons</a></EmptyState>}
  </>
}

function PracticeQuestion({ session, attempt: persistedAttempt, workspace, run, busy }: PageProps & { session: PracticeSession; attempt?: Attempt }) {
  const [savedAttempt, setSavedAttempt] = useState<Attempt>()
  const attempt = persistedAttempt ?? savedAttempt
  const [selected, setSelected] = useState(attempt?.answerId ?? '')
  const title = useRef<HTMLHeadingElement>(null)
  const pending = useRef(false)
  // Grading can change familiarity; keep the current prompt's pinyin geometry stable.
  const questionWords = useRef(workspace.words)
  const question = session.questions[session.cursor]
  const word = getWord(question.wordId)
  const meaning = question.activity === 'meaning'
  const pronunciationHints = meaning && workspace.preferences.pinyin
  const lesson = lessons.find(item => item.id === session.lessonId)
  const reviewing = lesson?.curriculum && !lesson.wordIds.includes(word.id)
  const module = word.curriculum && curriculumLevels.find(level => level.id === word.curriculum?.levelId)?.modules.find(item => item.id === word.curriculum?.moduleId)
  useEffect(() => { title.current?.focus() }, [])
  const next = () => {
    if (busy || pending.current) return
    pending.current = true
    void run(async () => {
      try {
        if (attempt) {
          await advancePractice(session.id, session.cursor)
        } else {
          const saved = await submitAnswer(session.id, session.cursor, selected)
          // Retain the result while the live workspace query catches up.
          setSavedAttempt(saved)
        }
      } finally {
        pending.current = false
      }
    })
  }
  return <div className="practice-player answer-player panel" data-assistant-protected={!question.revealed && !attempt ? 'true' : undefined}>
    <div className="card-topline"><span className="eyebrow">READING / {meaning ? 'RECOGNIZE A MEANING' : 'RECOGNIZE A WORD'}</span><span className="small muted">Question {session.cursor + 1} of {session.questions.length}</span></div>
    <progress aria-label="Practice progress" value={session.cursor} max={session.questions.length} />
    <div className="practice-question-content">
      <h2 ref={title} tabIndex={-1}>{meaning ? 'What does this word mean?' : 'Which Mandarin word matches?'}</h2>
      {module && <p className="small muted practice-context">{reviewing ? 'EARLIER REVIEW' : 'CURRICULUM SENSE'} / {module.title}</p>}
      <p className={meaning ? 'practice-prompt native' : 'practice-prompt'} lang={meaning ? 'zh-Hans' : 'en'}>{meaning
        ? <MandarinWord word={word} state={questionWords.current.find(item => item.wordId === word.id)} pinyin={pronunciationHints} />
        : word.meaning}</p>
    </div>
    <fieldset className="answer-options" disabled={busy || Boolean(attempt)}><legend className="visually-hidden">Choose an answer</legend>
      {question.options.map(id => {
        const option = getWord(id)
        return <label key={id} className={`answer-option ${selected === id ? 'selected' : ''} ${attempt && id === word.id ? 'correct-option' : ''}`}>
          <input type="radio" name="answer" value={id} checked={selected === id} onChange={() => setSelected(id)} />
          <span lang={meaning ? 'en' : 'zh-Hans'}>{meaning ? option.meaning
            : <MandarinWord word={option} state={questionWords.current.find(item => item.wordId === option.id)} pinyin={pronunciationHints} />}</span>
          <span className="answer-option-mark">{attempt && id === word.id && <CheckCircle2 size={18} aria-label="Correct answer" />}</span>
        </label>
      })}
    </fieldset>
    <AnswerButton result={attempt?.correct} busy={busy} ready={Boolean(selected)} onCheck={next} onNext={next}
      secondary={<button className="button secondary" disabled={busy || question.revealed || Boolean(attempt)}
        onClick={() => void run(() => revealAnswer(session.id, session.cursor))}><Eye size={16} /> Show answer</button>} />
    {(attempt || question.revealed) && <div className={`notice answer-feedback${attempt?.correct ? ' success' : ''}`} role="status">
      <strong>{attempt ? attempt.correct ? attempt.assisted ? 'Correct, with help.' : 'Correct, without help.' : 'Not quite. Keep this one close.' : 'Answer revealed. This question will be recorded as assisted.'}</strong>
      <p><MandarinWord word={word} state={workspace.words.find(item => item.wordId === word.id)} pinyin={workspace.preferences.pinyin} /> / {word.meaning}</p>
      <p className="small practice-feedback-detail">{attempt ? attempt.correct && !attempt.assisted ? 'Saved to your reading progress.' : 'This word will be due again in about five minutes.' : 'Choose the answer, then Check answer to save your attempt.'}</p>
      <SnippetActions source={{ text: word.native, meaning: word.meaning, locale: 'zh-Hans', title: 'Practice answer explanation', route: `practice/${session.id}` }} />
    </div>}
    <p className="small muted practice-save-note">Check answer saves your response immediately in {workspace.preferences.name}. Review the result, then use Next. You can leave and resume this question.</p>
  </div>
}

export function PracticeSessionPage(props: PageProps & { session: PracticeSession }) {
  const { workspace, session } = props
  const title = lessons.find(lesson => lesson.id === session.lessonId)?.title ?? 'Your vocabulary review'
  const attempts = workspace.attempts.filter(attempt => attempt.sessionId === session.id)
  const independent = attempts.filter(attempt => attempt.correct && !attempt.assisted).length
  const lesson = lessons.find(item => item.id === session.lessonId)
  const next = lesson?.curriculum ? nextCurriculumLesson(workspace) : undefined
  if (session.status !== 'completed') return <PracticeQuestion key={`${session.id}:${session.cursor}`} {...props} attempt={attempts.find(attempt => attempt.question === session.cursor)} />
  return <>
    <a href="#practice" className="back-link"><ArrowLeft size={16} /> Practice</a>
    <PageHeading eyebrow="SMALL MOMENTS, REAL MOMENTUM" title={title}>Read, recall, and give yourself room to learn.</PageHeading>
    <section className="panel completion">
      <CheckCircle2 size={44} className="accent" /><h2>One more step forward.</h2>
      <p className="completion-count">{independent} / {session.questions.length}</p><p>correct answers without help</p>
      <p className="muted">{attempts.filter(attempt => attempt.assisted).length} assisted answers / {attempts.filter(attempt => !attempt.correct).length} incorrect answers</p>
      <p>You practiced {new Set(session.questions.map(question => question.wordId)).size} words. Completing a lesson records practice, not mastery.</p>
      {lesson?.curriculum && <p className="small muted">Grammar, contextual understanding, production, and the level's communicative checkpoint remain unassessed.</p>}
      <div className="button-row"><a className="button primary" href="#dictionary">See your learning set <ArrowRight size={16} /></a><a className="button secondary" href={lesson ? `#lesson/${lesson.id}` : '#overview'}>{lesson ? 'Back to lesson' : 'Back to overview'}</a></div>
      {next && <div className="button-row"><a className="button secondary" href={`#lesson/${next.id}`}>Continue your path <ArrowRight size={16} /></a></div>}
    </section>
  </>
}
