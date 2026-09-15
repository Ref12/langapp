import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, RotateCcw, X } from 'lucide-react'
import { useActiveProfile } from '../core/activeProfile'
import { db } from '../core/database'
import type {
  LearningItem,
  ReviewActivity,
  UserItemState,
} from '../core/domain'
import { createId, nowIso } from '../core/ids'
import { applyReviewEvidence } from '../core/mastery'

interface ReviewEntry {
  item: LearningItem
  state: UserItemState
}

const activities: Array<{ id: ReviewActivity; label: string }> = [
  { id: 'matching', label: 'Match' },
  { id: 'fill-blank', label: 'Fill in' },
  { id: 'sentence', label: 'Construct' },
]

export function ReviewPage() {
  const profile = useActiveProfile()
  const entries = useLiveQuery(async (): Promise<ReviewEntry[]> => {
    if (!profile) return []
    const states = await db.userItemStates
      .where('profileId')
      .equals(profile.id)
      .toArray()
    const items = await db.learningItems.bulkGet(
      states.map((state) => state.itemId),
    )
    return states.flatMap((state, index) =>
      items[index] ? [{ state, item: items[index] }] : [],
    ) as ReviewEntry[]
  }, [profile?.id])
  const [activity, setActivity] = useState<ReviewActivity>('matching')
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<'correct' | 'incorrect' | null>(null)

  const orderedEntries = useMemo(
    () =>
      [...(entries ?? [])].sort(
        (left, right) =>
          left.state.confidence - right.state.confidence ||
          left.state.updatedAt.localeCompare(right.state.updatedAt),
      ),
    [entries],
  )
  const entry = orderedEntries[index % Math.max(orderedEntries.length, 1)]

  const alternatives = useMemo(() => {
    if (!entry) return []
    const otherGlosses = orderedEntries
      .filter((candidate) => candidate.item.id !== entry.item.id)
      .map((candidate) => candidate.item.gloss)
      .slice(0, 3)
    return [...otherGlosses, entry.item.gloss].sort((left, right) =>
      `${entry.item.id}:${left}`.localeCompare(`${entry.item.id}:${right}`),
    )
  }, [entry, orderedEntries])

  const submit = async (submittedAnswer: string) => {
    if (!entry || !profile || result) return
    const normalized = submittedAnswer.trim().toLocaleLowerCase()
    const expected =
      activity === 'matching'
        ? entry.item.gloss.trim().toLocaleLowerCase()
        : entry.item.targetText.trim().toLocaleLowerCase()
    const correct = normalized === expected
    const timestamp = nowIso()
    const projection = applyReviewEvidence(
      entry.state.confidence,
      activity,
      correct,
    )

    await db.transaction(
      'rw',
      [db.reviewAttempts, db.evidenceEvents, db.userItemStates],
      async () => {
        await db.reviewAttempts.add({
          id: createId('review'),
          profileId: profile.id,
          itemId: entry.item.id,
          activity,
          answer: submittedAnswer,
          correct,
          createdAt: timestamp,
        })
        await db.evidenceEvents.add({
          id: createId('event'),
          profileId: profile.id,
          itemId: entry.item.id,
          sourceModuleId: 'review',
          type: correct ? 'review-correct' : 'review-incorrect',
          createdAt: timestamp,
        })
        await db.userItemStates.update(entry.state.id, {
          ...projection,
          updatedAt: timestamp,
        })
      },
    )
    setResult(correct ? 'correct' : 'incorrect')
  }

  const next = () => {
    setIndex((current) => current + 1)
    setAnswer('')
    setResult(null)
  }

  if (!entry) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Review</p>
            <h1>Nothing to review yet</h1>
            <p>Analyze a reading or conversation to add learning items.</p>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="page review-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{profile?.name}</p>
          <h1>Review</h1>
          <p>Recognition first, then active production.</p>
        </div>
        <span className="review-count">
          {index + 1} / {orderedEntries.length}
        </span>
      </header>

      <div className="review-tabs">
        {activities.map((candidate) => (
          <button
            className={activity === candidate.id ? 'active' : ''}
            onClick={() => {
              setActivity(candidate.id)
              setAnswer('')
              setResult(null)
            }}
            key={candidate.id}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <section className="review-card">
        {activity === 'matching' ? (
          <>
            <p className="review-instruction">Choose the English meaning</p>
            <div className="review-prompt">{entry.item.targetText}</div>
            <div className="review-romanization">{entry.item.romanization}</div>
            <div className="match-grid">
              {alternatives.map((alternative) => (
                <button
                  onClick={() => submit(alternative)}
                  disabled={result !== null}
                  key={alternative}
                >
                  {alternative}
                </button>
              ))}
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit(answer)
            }}
          >
            <p className="review-instruction">
              {activity === 'fill-blank'
                ? 'Enter the target-language form'
                : 'Construct the target expression for this meaning'}
            </p>
            <div className="review-prompt english">{entry.item.gloss}</div>
            <input
              className="review-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              autoFocus
            />
            <button className="primary-button">Check answer</button>
          </form>
        )}

        {result && (
          <div className={`review-result ${result}`}>
            {result === 'correct' ? <Check /> : <X />}
            <div>
              <strong>{result === 'correct' ? 'Correct' : 'Keep learning'}</strong>
              <p>
                {entry.item.targetText} · {entry.item.romanization} ·{' '}
                {entry.item.gloss}
              </p>
            </div>
            <button onClick={next}>
              <RotateCcw size={16} /> Next
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
