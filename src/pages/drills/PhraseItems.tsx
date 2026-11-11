import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { getPack } from '../../core/language'
import { HearButton } from '../../components/assistant/SnippetActions'
import type { ItemInfo } from '../../core/drills/items'
import { practiceByRef, type PhrasePractice } from '../../core/session/phrase-pick'
import { shortDate } from '../../core/drills/store'

/** How often a phrase was practised, in words: "Never practised" or "Practised 3 times · 2 right the first time · last 4 Nov". */
export function practisedLine(practice: PhrasePractice | undefined): string {
  if (!practice?.count) return 'Never practised'
  return `Practised ${practice.count} ${practice.count === 1 ? 'time' : 'times'} · ${practice.wins} right the first time · last ${shortDate(practice.lastAt)}`
}

/** "5 phrases · 3 never practised" for a set's refs. */
export function PhraseCounts({ refs }: { refs: readonly string[] }) {
  const rows = useLiveQuery(() => db.skillPractice.toArray(), [])
  const practice = practiceByRef(rows ?? [])
  const never = refs.filter(ref => !practice.get(ref)?.count).length
  return <>{refs.length} {refs.length === 1 ? 'phrase' : 'phrases'}{rows ? ` · ${never} never practised` : ''}</>
}

/** The phrases of a set with their practice counts, and how many were never practised. */
export function PhraseItems({ items }: { items: readonly ItemInfo[] }) {
  const rows = useLiveQuery(() => db.skillPractice.toArray(), [])
  const practice = practiceByRef(rows ?? [])
  const never = items.filter(item => !practice.get(item.ref)?.count).length
  return <>
    <h2 className="dr-h2">{items.length} {items.length === 1 ? 'phrase' : 'phrases'}{rows ? ` · ${never} never practised` : ''}</h2>
    <div className="word-grid">{items.map(item => <article key={item.ref} className="word-card" data-phrase-ref={item.ref}>
      <div className="card-topline"><span className="eyebrow">phrase</span></div>
      <h3 lang={getPack().learningTag} className="word-native">{item.zh}</h3>
      {item.py && <p className="study-pinyin small muted">{item.py}</p>}
      <p className="word-meaning">{item.en}</p>
      <p className="small muted phrase-practised">{rows ? practisedLine(practice.get(item.ref)) : ''}</p>
      <p><HearButton text={item.zh} locale={getPack().speechLocale} kind="sentence" label="Hear it" /></p>
    </article>)}</div>
  </>
}
