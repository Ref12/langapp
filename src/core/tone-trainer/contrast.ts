// What to play after a wrong answer to a single syllable: the right tone, then the tone the learner picked, on the same base and in one voice.
import { singleId } from './items'
import type { ToneManifest, ToneManifestItem } from './manifest'
import { withTone } from '../pinyin'

export interface ContrastPlan {
  /** The voice both clips are in. */
  voice: string
  /** True when the voice is not the one the question was asked in (it has no clip of the chosen tone). */
  voiceChanged: boolean
  heard: { file: string; label: string }
  /** Missing when no voice has a clip of the chosen tone on this base: only the right tone can be played. */
  picked?: { file: string; label: string }
}

const baseOf = (item: ToneManifestItem): string => item.pinyin.replace(/[1-5]$/, '')
export const syllableLabel = (base: string, tone: number): string => withTone(base, String(tone))

/** The pair to play, or undefined for anything but a single syllable with a different chosen tone. */
export function contrastPlan(manifest: ToneManifest, item: ToneManifestItem, voice: string, chosenTone: number): ContrastPlan | undefined {
  if (item.kind !== 'single' || item.tones.length !== 1 || chosenTone === item.tones[0]) return undefined
  const base = baseOf(item)
  const other = manifest.items.find(entry => entry.id === singleId(base, chosenTone))
  const heard = { label: syllableLabel(base, item.tones[0]) }
  const picked = { label: syllableLabel(base, chosenTone) }
  const voices = [voice, ...Object.keys(item.clips).filter(v => v !== voice)]
  const both = voices.find(v => item.clips[v] && other?.clips[v])
  if (both && other) return { voice: both, voiceChanged: both !== voice, heard: { ...heard, file: item.clips[both].file }, picked: { ...picked, file: other.clips[both].file } }
  return { voice, voiceChanged: false, heard: { ...heard, file: item.clips[voice].file } }
}
