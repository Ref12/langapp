import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as speech from '../../core/assistant/speech'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { ExerciseQuestion, type QuestionContext } from './EngineQuestion'
import type { SessionExercise } from '../../core/session/types'

const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const make = (shape: object) => ({ id: 'x', refs: ['a'], stage: 'use', round: 0, ...shape }) as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>
const gap = make({ form: 'gap', sentence: '下午上课前喝茶。', gapped: '下午上课____喝茶。', options: ['好', '前', '和', '天'], answer: 1, translation: 'Drink tea before class in the afternoon.', explanation: 'before' })
const ja = make({ form: 'gap', sentence: '私は学生です。', gapped: '私は____です。', options: ['学生', '先生'], answer: 0, translation: 'I am a student.', explanation: '' })

let play: ReturnType<typeof vi.spyOn>
let stop: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  play = vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
  stop = vi.spyOn(speech, 'stopBrowserSpeech').mockImplementation(() => undefined)
  vi.spyOn(speech, 'getPlaybackState').mockReturnValue({ activeId: undefined } as ReturnType<typeof speech.getPlaybackState>)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined) })

const answer = async (user: ReturnType<typeof userEvent.setup>, option: string) => {
  await user.click(screen.getByRole('radio', { name: option }).closest('label') ?? screen.getByRole('radio', { name: option }))
  await user.click(screen.getByRole('button', { name: /Check answer/ }))
}

describe('Play the sentence after an answer', () => {
  it('has no Play the sentence button before the answer, and the button speaks the whole sentence after it, again on each press', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={gap} ctx={ctx} onDone={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Play the sentence' })).toBeNull()
    await answer(user, '前')
    expect(play).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Play the sentence' }))
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenLastCalledWith(expect.any(String), '下午上课前喝茶。', 'zh-Hans')
    await user.click(screen.getByRole('button', { name: 'Play the sentence' }))
    expect(play).toHaveBeenCalledTimes(2)
  })
  it('with auto-play on, speaks the sentence once when the answer is revealed', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={gap} ctx={{ ...ctx, autoPlay: true }} onDone={vi.fn()} />)
    await answer(user, '和')
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith(expect.any(String), '下午上课前喝茶。', 'zh-Hans')
  })
  it('with auto-play off, nothing is spoken by itself', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={gap} ctx={{ ...ctx, autoPlay: false }} onDone={vi.fn()} />)
    await answer(user, '前')
    expect(play).not.toHaveBeenCalled()
  })
  it('Next stops the speech', async () => {
    const user = userEvent.setup()
    const done = vi.fn()
    const view = render(<ExerciseQuestion exercise={gap} ctx={{ ...ctx, autoPlay: true }} onDone={done} />)
    await answer(user, '前')
    stop.mockClear()
    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(done).toHaveBeenCalled()
    view.unmount()
    expect(stop).toHaveBeenCalled()
  })
  it('a Japanese build speaks the sentence as the pack says, in ja-JP', async () => {
    setBuildLanguageForTests('ja')
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={ja} ctx={ctx} onDone={vi.fn()} />)
    await answer(user, '学生')
    await user.click(screen.getByRole('button', { name: 'Play the sentence' }))
    expect(play).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('学生'), 'ja-JP')
  })
})
