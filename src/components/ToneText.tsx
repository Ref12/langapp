import type { ReactNode } from 'react'
import { readingTones } from '../core/pinyin'
import { ToneColourContext, ToneHoldContext, toneClass, useToneColours } from './tone-colour-context'

export function ToneColourProvider({ on, children }: { on: boolean; children: ReactNode }) {
  return <ToneColourContext.Provider value={on}>{children}</ToneColourContext.Provider>
}

/** Holds the colours back for what is inside while `when` is true (until a tone or pinyin question is checked). */
export function ToneHold({ when, children }: { when: boolean; children: ReactNode }) {
  return <ToneHoldContext.Provider value={when}>{children}</ToneHoldContext.Provider>
}

/** Chinese text with each Han character in the colour of its tone in this word's reading (its pinyin, one syllable per Han character). Plain when colours are off, held, or the reading does not line up with the characters. */
export function ToneText({ text, reading }: { text: string; reading?: string }) {
  const on = useToneColours()
  const tones = on ? readingTones(reading) : undefined
  const chars = Array.from(text)
  const han = chars.filter(char => /\p{Script=Han}/u.test(char)).length
  if (!tones || tones.length !== han) return <>{text}</>
  let next = 0
  return <>{chars.map((char, index) => /\p{Script=Han}/u.test(char) ? <span key={index} className={toneClass(tones[next++])}>{char}</span> : char)}</>
}
