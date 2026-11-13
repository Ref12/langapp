// Shared by the tone trainer's tests: a small manifest, and pitch curves in place of the browser's decoder, and a way to open a stage with the first item and voice.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import type { Curve } from '../../core/tone-trainer/curve'
import { resetToneManifestForTests, type ToneManifest } from '../../core/tone-trainer/manifest'
import * as play from '../../core/tone-trainer/play'

/** A 20-point curve running from one level to another (levels 1-5), in the manifest's tenths. */
export const ramp = (from: number, to: number): Curve => Array.from({ length: 20 }, (_, i) => Math.round((from + (to - from) * i / 19) * 10))
const SHAPES: Record<number, Curve> = { 1: ramp(5, 5), 2: ramp(2, 5), 3: ramp(2, 1), 4: ramp(5, 1) }

/** Singles ba1 and ba2 in two voices , and a pair "ba1 ba4" in two voices (a curve for each syllable, with a gap in the second). */
export const curveManifest = (): ToneManifest => ({ version: 1, voices: [], items: [
  ...[1, 2].map(tone => ({ id: 's-ba' + tone, kind: 'single' as const, chars: tone === 1 ? '巴' : '拔', pinyin: 'ba' + tone, tones: [tone],
    clips: Object.fromEntries(['xiaoxiao', 'yunxi'].map(voice => [voice, { file: voice + '/s-ba' + tone + '.mp3', chars: tone === 1 ? '巴' : '拔'}])) })),
  { id: 'w-ba1-ba4', kind: 'pair' as const, chars: '爸爸', pinyin: 'ba1 ba4', tones: [1, 4],
    clips: Object.fromEntries(['xiaoxiao', 'yunxi'].map(voice => [voice, { file: voice + '/w-ba1-ba4.mp3', chars: '爸爸', t0: 0.1, t1: 0.7}])) },
] })

export async function setUpTrainer(manifest: ToneManifest, preferences: Record<string, unknown> = {}) {
  localStorage.clear(); resetToneManifestForTests()
  window.location.hash = '#practice/tones'
  await db.delete(); await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false, ...preferences })
  vi.spyOn(play, 'playClip').mockResolvedValue()
  // The tracker is tested on its own (pitch.test.ts); here the curves are given per clip.
  vi.spyOn(play, 'clipPitchCurves').mockImplementation(async file => /s-ba(\d)/.test(file) ? [SHAPES[Number(/s-ba(\d)/.exec(file)![1])]] : [SHAPES[1], [...SHAPES[4].slice(0, 8), null, null, ...SHAPES[4].slice(10)]])
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('manifest.json') ? new Response(JSON.stringify(manifest)) : new Response('', { status: 404 })))
}

/** Opens a stage whose earlier stages are unlocked, with the first item in its first voice (Math.random is 0). */
export async function openStage(stage: 1 | 2 | 3) {
  const answers = (from: 1 | 2) => Array.from({ length: 40 }, (_, i) => ({ stage: from, item: 's-ba1', voice: 'xiaoxiao', heard: [1], chosen: [1], correct: true, at: i }))
  await db.toneTrainer.put({ id: 'progress', stage: 1, confusion: {}, voices: {}, answers: stage === 1 ? [] : stage === 2 ? answers(1) : [...answers(1), ...answers(2)] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const user = userEvent.setup()
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start stage ' + stage })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Start stage ' + stage }))
  await screen.findByText(/Question 1 of 20/)
  await waitFor(() => expect(play.playClip).toHaveBeenCalledTimes(1))
  vi.mocked(play.playClip).mockClear()
  return user
}

/** Picks a tone for the syllable at slot (0 first) and checks. */
export async function answerWith(user: ReturnType<typeof userEvent.setup>, tones: number[]) {
  const groups = screen.getAllByRole('group', { name: 'Which tone?' })
  for (const [slot, tone] of tones.entries()) await user.click(Array.from(groups[slot].querySelectorAll('button')).find(b => b.textContent!.startsWith(tone === 5 ? 'Neutral' : 'Tone ' + tone))!)
  await user.click(screen.getByRole('button', { name: 'Check answer' }))
}
