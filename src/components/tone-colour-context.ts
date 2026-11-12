import { createContext, useContext } from 'react'

/** Whether the learner switched tone colours on, for a language that has tones (decided once in App). */
export const ToneColourContext = createContext(false)
/** Set where a colour would give the answer away (a question about the tone or the pinyin) until it is checked. */
export const ToneHoldContext = createContext(false)

/** Whether Chinese and pinyin are coloured by tone right here. */
export function useToneColours(): boolean {
  const on = useContext(ToneColourContext)
  const held = useContext(ToneHoldContext)
  return on && !held
}

/** The CSS class of a tone: tone-1 to tone-4, tone-5 for the neutral tone (colours are the --tone-n tokens). */
export const toneClass = (tone: number): string => `tone tone-${tone >= 1 && tone <= 4 ? tone : 5}`
