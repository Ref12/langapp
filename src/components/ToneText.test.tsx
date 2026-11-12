import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MandarinWord } from './MandarinWord'
import { Pinyin } from './Pinyin'
import { ToneColourProvider, ToneHold, ToneText } from './ToneText'
import { ExerciseQuestion, type Outcome, type QuestionContext } from '../pages/drills/EngineQuestion'
import type { SessionExercise } from '../core/session/types'
import type { Word } from '../core/model'
import { pinyinParts, formatPinyin, readingTones } from '../core/pinyin'

afterEach(cleanup)
const word = (native: string, pinyin: string) => ({ native, pinyin } as unknown as Word)
const FIVE = [['妈', 'mā', 1], ['麻', 'má', 2], ['马', 'mǎ', 3], ['骂', 'mà', 4], ['吗', 'ma', 5]] as const
const toneOf = (el: Element | null) => el?.className.match(/tone-(\d)/)?.[1]

describe('tone colours', () => {
  it('colours the five tones of ma, on the character and on the pinyin syllable', () => {
    for (const [character, pinyin, tone] of FIVE) {
      const { container } = render(<ToneColourProvider on><MandarinWord word={word(character, pinyin)} /></ToneColourProvider>)
      const classes = [...container.querySelectorAll('.tone')].map(toneOf)
      expect(classes, character).toEqual([String(tone), String(tone)])
      expect(container.querySelector('ruby > .tone')?.textContent).toBe(character)
      expect(container.querySelector('rt .tone')?.textContent).toBe(pinyin)
      cleanup()
    }
  })

  it('colours each syllable of a pinyin text and keeps the text the same', () => {
    const { container } = render(<ToneColourProvider on><Pinyin text="yín háng" /></ToneColourProvider>)
    expect(container.textContent).toBe('yín háng')
    expect([...container.querySelectorAll('.tone')].map(toneOf)).toEqual(['2', '2'])
    expect(pinyinParts('Nǐ hǎo, shū.', 'marks').map(part => part.text).join('')).toBe(formatPinyin('Nǐ hǎo, shū.', 'marks'))
    expect(pinyinParts('ni3hao3', 'numbers').map(part => part.text).join('')).toBe(formatPinyin('ni3hao3', 'numbers'))
  })

  it('takes the colour of a character from the reading it has in that word', () => {
    const view = (text: string, reading: string) => { const { container } = render(<ToneColourProvider on><ToneText text={text} reading={reading} /></ToneColourProvider>); return container }
    // 行 is hang in 银行 and xing in 行人 (both tone 2); 长 is cháng (2) in 长城 and zhǎng (3) in 长大.
    expect(toneOf(view('银行', 'yín háng').querySelectorAll('.tone')[1])).toBe('2')
    cleanup()
    const xing = view('行人', 'xíng rén').querySelectorAll('.tone')
    expect(xing[0].textContent).toBe('行'); expect(toneOf(xing[0])).toBe('2'); expect(toneOf(xing[1])).toBe('2')
    cleanup()
    expect(toneOf(view('长城', 'cháng chéng').querySelectorAll('.tone')[0])).toBe('2')
    cleanup()
    expect(toneOf(view('长大', 'zhǎng dà').querySelectorAll('.tone')[0])).toBe('3')
  })

  it('uses the dictionary tone, not sandhi, and leaves a character without a known reading plain', () => {
    const { container } = render(<ToneColourProvider on><ToneText text={'你好'} reading="nǐ hǎo" /><ToneText text={'你好'} /><ToneText text={'你好'} reading="nǐ" /></ToneColourProvider>)
    expect([...container.querySelectorAll('.tone')].map(toneOf)).toEqual(['3', '3'])
    expect(readingTones('mā / má')).toBeUndefined()
  })

  it('colours nothing when the setting is off', () => {
    const { container } = render(<ToneColourProvider on={false}><MandarinWord word={word('妈', 'mā')} /><Pinyin text="mā" /></ToneColourProvider>)
    expect(container.querySelectorAll('.tone')).toHaveLength(0)
    expect(container.textContent).toBe('妈māmā')
  })

  it('holds colours back inside a ToneHold', () => {
    const { container } = render(<ToneColourProvider on><ToneHold when><Pinyin text="mā" /></ToneHold><ToneHold when={false}><Pinyin text="má" /></ToneHold></ToneColourProvider>)
    expect([...container.querySelectorAll('.tone')].map(toneOf)).toEqual(['2'])
  })

  it('shows no colour in a pinyin-typing question until it is checked', () => {
    const ctx: QuestionContext = { readings: new Map([['学习', new Set(['xué xí'])]]), pinyin: true, speak: false, busy: false, forms: new Set(['学习']), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
    const exercise = { id: 'p', refs: ['a'], stage: 'recall', round: 0, form: 'pinyin', prompt: '学习', promptLang: 'zh', answerLang: 'py', accepted: ['xué xí'], model: 'xué xí', modelPinyin: 'xué xí', explanation: '' } as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>
    const { container } = render(<ToneColourProvider on><ExerciseQuestion exercise={exercise} ctx={ctx} onDone={vi.fn<(outcome: Outcome) => void>()} /></ToneColourProvider>)
    expect(container.querySelectorAll('.tone')).toHaveLength(0)
    fireEvent.change(container.querySelector('input[type=text]')!, { target: { value: 'xue2 xi2' } })
    expect(container.querySelectorAll('.tone')).toHaveLength(0)
    fireEvent.click(container.querySelector('.check-answer-button')!)
    expect(screen.getByRole('status')).toHaveTextContent('Correct')
    expect(container.querySelectorAll('.tone').length).toBeGreaterThan(0)
  })
})
