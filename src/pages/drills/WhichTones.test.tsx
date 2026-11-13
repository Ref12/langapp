import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as play from '../../core/tone-trainer/play'
import { ExerciseQuestion, type QuestionContext } from './EngineQuestion'
import { isFormOffered } from '../../core/session/offered'
import { planSession } from '../../core/session/plan'
import { loadCatalog } from '../../core/study/catalog'
import { isVocabulary } from '../../core/study/local-exercises'
import { zhPack, jaPack } from '../../core/language'
import type { SessionExercise } from '../../core/session/types'

const ctx: QuestionContext = { readings: new Map(), pinyin: true, speak: false, busy: false, forms: new Set(), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const exercise = { id: 'w', stage: 'recall', round: 0, refs: ['a'], form: 'which-tones', word: '朋友', pinyin: 'peng2 you5', tones: [2, 5], file: 'x/w-peng2-you5.mp3', voice: 'x', explanation: '' } as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Which tones?', () => {
  it('shows no characters, pinyin or colour until checked, then shows them coloured', async () => {
    vi.spyOn(play, 'playClip').mockResolvedValue()
    const user = userEvent.setup()
    const { container } = render(<ExerciseQuestion exercise={exercise} ctx={ctx} onDone={vi.fn()} />)
    await waitFor(() => expect(play.playClip).toHaveBeenCalledWith('x/w-peng2-you5.mp3'))
    expect(container).not.toHaveTextContent('朋友'); expect(container).not.toHaveTextContent('péng')
    expect(container.querySelector('.tone')).toBeNull()
    const groups = screen.getAllByRole('group', { name: 'Which tone?' })
    await user.click(groups[0].querySelectorAll('button')[1]); await user.click(groups[1].querySelectorAll('button')[4])
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByText(/Right\./)).toBeInTheDocument()
    expect(container).toHaveTextContent('朋友'); expect(container.querySelector('.tone-2')).not.toBeNull()
  })
  it('is offered only for a pack with tones', () => {
    expect(isFormOffered('which-tones', zhPack)).toBe(true)
    expect(isFormOffered('which-tones', jaPack)).toBe(false)
  })
  it('is planned for known two-syllable words that have a recording, and not without the recordings', async () => {
    const catalog = await loadCatalog()
    const words = [...catalog.units.values()].filter(isVocabulary).filter(unit => unit.band === '1' && [...unit.record.ch].length === 2).slice(0, 6)
    const items = words.map(unit => ({ ref: unit.ref, kind: 'vocabulary' as const, zh: unit.record.ch, py: unit.record.pr, en: unit.record.ds }))
    const known = new Set(words.map(unit => unit.ref))
    const preset = { id: 't', name: 't', blurb: '', forms: { recall: ['which-tones' as const], recognise: ['choice' as const] }, rounds: { recall: 1, recognise: 1 } }
    const input = { intent: 'practice-set' as const, items, length: 'standard' as const, preset, seed: 1, catalog, known, bank: new Map(), allBank: [] }
    const recorded = words.slice(0, 2).map(unit => ({ id: 'w-' + unit.ref, kind: 'pair' as const, chars: unit.record.ch, pinyin: 'a1 b2', tones: [1, 2], clips: { x: { file: 'x/a.mp3', chars: unit.record.ch }, y: { file: 'y/a.mp3', chars: unit.record.ch } } }))
    const tones = { version: 1 as const, voices: [], items: recorded }
    const forms = (list: ReturnType<typeof planSession>) => list.stages.flatMap(stage => stage.exercises).filter(exercise => exercise.form === 'which-tones')
    expect(forms(planSession({ ...input, tones }))).toHaveLength(2)
    expect(forms(planSession(input))).toHaveLength(0)
  }, 60000)
})
