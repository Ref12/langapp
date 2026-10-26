import { useEffect, useState } from 'react'
import { isHan } from '../../core/characters/writing-route'

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
