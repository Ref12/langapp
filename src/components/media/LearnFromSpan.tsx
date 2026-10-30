import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { navigate } from '../../core/routing'
import { loadCatalog } from '../../core/study/catalog'
import type { MediaItem } from '../../core/media/contracts'
import { learnFromSpan } from '../../core/media/learn'
import { PROPOSAL, clampCount, proposeSpan, spanRange, type Proposal, type SpanChoice } from '../../core/media/span'

const CHOICES: [string, string][] = [['whole', 'Whole item'], ['first-half', 'First half'], ['second-half', 'Second half'], ['quarter-1', 'Quarter 1'], ['quarter-2', 'Quarter 2'], ['quarter-3', 'Quarter 3'], ['quarter-4', 'Quarter 4'], ['time', 'Time range']]

/** True when both passes are done, so there is something to learn from. */
export const readyToLearn = (item: Pick<MediaItem, 'entries'>): boolean => !!item.entries?.complete

/** Pick a span, review about ten proposed words (5-20), trim them, and start a lesson. Local ranking: no AI request until the lesson itself. */
export function LearnFromSpan({ item, open = false }: { item: MediaItem; open?: boolean }) {
  const [shown, setShown] = useState(open)
  const [choice, setChoice] = useState('whole')
  const [from, setFrom] = useState('0')
  const [to, setTo] = useState(String(Math.round(item.lines[item.lines.length - 1]?.start ?? 0)))
  const [count, setCount] = useState(PROPOSAL.default)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const known = useLiveQuery(async () => new Set((await db.knowledge.toArray()).map(entry => entry.ref)), [])
  const catalog = useLiveQuery(() => loadCatalog(), [])
  const proposals: Proposal[] = useMemo(() => {
    if (!shown || !known || !catalog) return []
    const span: SpanChoice = choice === 'time' ? { fromSec: Number(from) || 0, toSec: Number(to) || 0 } : choice as SpanChoice
    const range = spanRange(span, item.lines)
    return range ? proposeSpan(item, known, catalog, range, count) : []
  }, [shown, known, catalog, choice, from, to, count, item])
  const picks = proposals.filter(proposal => !off.has(proposal.ref))
  const start = async () => {
    setError(''); setWorking(true)
    try { navigate(`lessons/session/${await learnFromSpan(item, picks)}`) } catch (reason) { setError(reason instanceof Error ? reason.message : 'The lesson could not start.') } finally { setWorking(false) }
  }
  if (!readyToLearn(item)) return null
  if (!shown) return <button type="button" className="button primary" onClick={() => setShown(true)}>Learn from this</button>
  return <section className="panel" aria-label="Learn from this span">
    <h2>Learn from this</h2>
    <label className="field">Span<select value={choice} onChange={event => { setChoice(event.target.value); setOff(new Set()) }}>{CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {choice === 'time' && <p><label className="small">From (seconds)<input type="number" min={0} value={from} onChange={event => setFrom(event.target.value)} /></label> <label className="small">To (seconds)<input type="number" min={0} value={to} onChange={event => setTo(event.target.value)} /></label></p>}
    <label className="small">Words to learn: {count}<input type="range" aria-label="Number of words" min={PROPOSAL.min} max={PROPOSAL.max} value={count} onChange={event => setCount(clampCount(Number(event.target.value)))} /></label>
    {!proposals.length ? <p className="small muted">Nothing new to learn in this span.</p> : <ul className="plain-list">
      {proposals.map(proposal => <li key={proposal.ref}>
        <label><input type="checkbox" checked={!off.has(proposal.ref)} onChange={() => setOff(previous => { const next = new Set(previous); if (next.has(proposal.ref)) next.delete(proposal.ref); else next.add(proposal.ref); return next })} />
          {' '}<strong lang="zh-Hans">{proposal.text}</strong> <span className="muted">{proposal.pinyin} {proposal.meaning}</span></label>
        <div className="small muted" lang="zh-Hans">{item.lines[proposal.example]?.text} ({proposal.inSpan}x here, {proposal.inItem}x in all)</div>
      </li>)}
    </ul>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <button type="button" className="button primary" disabled={!picks.length || working} onClick={() => void start()}>Learn {picks.length} {picks.length === 1 ? 'word' : 'words'}</button>
    <button type="button" className="button secondary" onClick={() => setShown(false)}>Close</button>
  </section>
}
