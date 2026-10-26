import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil } from 'lucide-react'
import { db } from '../../core/database'
import { characterKnowledge, writingRoute } from '../../core/characters/dictionary'
import { hasGuide, isHan } from '../../core/characters/writing-route'
import { useCatalog } from '../study/useCatalog'
import { Pinyin } from '../Pinyin'

export interface WriteWord { text: string; pinyin: string }

/** Word rows (text + pinyin) for the Han words of a phrase, using the same local segmentation as the Speak playlist. */
export function useWriteWords(text: string, romanization?: string): { words?: WriteWord[]; error?: string } {
  const [state, setState] = useState<{ words?: WriteWord[]; error?: string }>({})
  useEffect(() => {
    let disposed = false
    setState({})
    if (!Array.from(text).some(isHan)) { setState({ words: [] }); return }
    void import('../../core/assistant/practice-chain').then(engine => {
      const plan = engine.createPracticePlan(text, romanization, true)
      const words: WriteWord[] = []
      for (const chunk of engine.getPracticeChunks(plan)) {
        let { start, end } = chunk
        while (start < end && !isHan(plan.units[start].text)) start++
        while (end > start && !isHan(plan.units[end - 1].text)) end--
        if (start < end) { const part = engine.getPracticePart(plan, start, end); words.push({ text: part.text, pinyin: part.pinyin }) }
      }
      if (!disposed) setState({ words })
    }, () => { if (!disposed) setState({ error: 'Words could not be prepared for writing.' }) })
    return () => { disposed = true }
  }, [text, romanization])
  return state
}

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
