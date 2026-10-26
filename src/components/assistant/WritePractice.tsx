import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil } from 'lucide-react'
import { db } from '../../core/database'
import { characterKnowledge, writingRoute } from '../../core/characters/dictionary'
import { hasGuide, isHan } from '../../core/characters/writing-route'
import { useCatalog } from '../study/useCatalog'
import { Pinyin } from '../Pinyin'

import { useWriteWords } from './useWriteWords'

/** Write mode of the Practice sheet: one row per word with pinyin and a button that opens the writing exercise. */
export function WritePractice({ text, romanization, route, onSpeak, onOpen }: {
  text: string; romanization?: string; route: string; onSpeak: () => void; onOpen?: () => void
}) {
  const { words, error } = useWriteWords(text, romanization)
  const { catalog } = useCatalog()
  const knowledge = useLiveQuery(() => db.knowledge.toArray(), [])
  const states = useLiveQuery(() => db.characterStates.toArray(), [])
  const known = useMemo(() => catalog && knowledge && states ? characterKnowledge(catalog, knowledge, states).all : undefined, [catalog, knowledge, states])
  if (error) return <p role="alert" className="practice-error">{error}</p>
  if (!words) return <p>Preparing words...</p>
  if (!words.length) return <div className="practice-write" role="status">
    <p>There is nothing to write here: writing practice needs Chinese characters.</p>
    <button type="button" className="button secondary" onClick={onSpeak}>Practice speaking instead</button>
  </div>
  return <ul className="practice-write" aria-label="Words to write">
    {words.map((word, wordIndex) => {
      const chars = Array.from(word.text)
      const first = chars.findIndex(character => isHan(character) && hasGuide(character))
      const missing = chars.filter(character => isHan(character) && !hasGuide(character))
      const scope = first >= 0 && known?.has(chars[first]) ? 'knowledge' : 'all'
      const href = first >= 0 ? writingRoute(chars[first], scope, { word: word.text, index: first, back: route }) : undefined
      return <li key={wordIndex} className="practice-write-row">
        <span lang="zh-Hans" className="word-native">{word.text}</span>
        <span lang="zh-Latn" className="small muted"><Pinyin text={word.pinyin} /></span>
        {href
          ? <a className="button primary" href={href} onClick={onOpen}><Pencil size={16} />Write {word.text}</a>
          : <button type="button" className="button primary" disabled><Pencil size={16} />Write {word.text}</button>}
        {missing.length > 0 && <span className="small muted" role="note">{missing.join(' ')}: no strokes yet{first < 0 ? '' : ' (skipped)'}</span>}
      </li>
    })}
  </ul>
}
