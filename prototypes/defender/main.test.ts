import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { sampleWords } from './deck'
import { allowsPinyinAnnotations, answerText, directionForms, pinyinAnswerForms, promptText } from './game'

afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('plays tap and typed modes, pauses, and does not submit Chinese IME composition', async () => {
  const html = readFileSync(new NodeURL('./index.html', import.meta.url), 'utf8')
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
  let time = 0, frameId = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  const step = (milliseconds: number) => {
    for (let remaining = milliseconds; remaining > 0; remaining -= 50) {
      time += Math.min(50, remaining)
      const frames = [...callbacks.values()]
      callbacks.clear()
      frames.forEach(callback => callback(time))
    }
  }
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement
  const score = () => Number(document.getElementById('score')!.textContent)
  await import('./main')
  const hints = document.getElementById('show-pinyin') as HTMLInputElement
  expect(hints.checked).toBe(false)
  expect(document.querySelectorAll('.answer-choice')).toHaveLength(6)
  expect([...document.querySelectorAll<HTMLButtonElement>('.answer-choice')].every(button => button.disabled)).toBe(true)
  button('primary').click()
  step(13_000)
  expect(document.querySelectorAll('.incoming-word').length).toBeGreaterThan(1)
  const incoming = document.querySelector('.incoming-word')!.textContent
  const word = sampleWords.find(word => word.character === incoming)!
  const answers = [...document.querySelectorAll<HTMLButtonElement>('.answer-choice')]
  answers.find(button => button.textContent === word.meaning)!.click()
  expect(score()).toBe(100)
  button('pause').click()
  const positions = [...document.querySelectorAll<HTMLElement>('.incoming-word')].map(node => node.style.cssText)
  step(5000)
  expect([...document.querySelectorAll<HTMLElement>('.incoming-word')].map(node => node.style.cssText)).toEqual(positions)
  expect(button('primary')).toHaveTextContent('Resume')
  button('primary').click()
  step(40_000)
  expect(document.getElementById('recap')).not.toHaveAttribute('hidden')
  button('secondary').click()
  const mode = document.getElementById('mode') as HTMLSelectElement
  const direction = document.getElementById('direction') as HTMLSelectElement
  mode.value = 'type'; direction.value = 'english'
  document.getElementById('settings')!.dispatchEvent(new Event('change', { bubbles: true }))
  button('primary').click()
  const input = document.getElementById('answer-input') as HTMLInputElement
  const expected = sampleWords.find(word => word.meaning === document.querySelector('.incoming-word')!.textContent)!
  input.value = expected.character
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  const enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
  input.dispatchEvent(enter)
  expect(enter.defaultPrevented).toBe(true)
  document.getElementById('type-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  expect(score()).toBe(0)
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  document.getElementById('type-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  expect(score()).toBe(100)
  expect(input.value).toBe('')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(button('primary')).toHaveTextContent('Resume')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(button('primary')).toHaveTextContent('Resume')
  const before = document.getElementById('wave')!.textContent
  step(40_000)
  expect(document.getElementById('wave')!.textContent).toBe(before)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  for (const controls of ['tap', 'type'] as const) for (const incomingDirection of ['chinese', 'english', 'character-pinyin', 'pinyin-character'] as const) {
    if (button('primary').textContent !== 'Resume') button('pause').click()
    button('secondary').click()
    button('secondary').click()
    mode.value = controls; direction.value = incomingDirection; hints.checked = true
    document.getElementById('settings')!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(hints.disabled).toBe(!allowsPinyinAnnotations(incomingDirection))
    button('primary').click()
    const prompt = document.querySelector<HTMLElement>('.incoming-word')!
    expect(prompt.lang).toBe(incomingDirection === 'english' ? 'en' : incomingDirection === 'pinyin-character' ? 'zh-Latn' : 'zh-Hans')
    const promptValue = prompt.querySelector('.word-face')!.firstChild!.textContent
    const incomingWord = sampleWords.find(word => promptText(word, incomingDirection) === promptValue)!
    expect(prompt.querySelector('rt')?.textContent).toBe(incomingDirection === 'chinese' ? incomingWord.pinyin : undefined)
    if (controls === 'tap') {
      const options = [...document.querySelectorAll<HTMLButtonElement>('.answer-choice')]
      const choice = options.find(button => button.querySelector('.word-face')!.firstChild!.textContent === answerText(incomingWord, incomingDirection))!
      expect(choice.querySelector('rt')?.textContent).toBe(incomingDirection === 'english' ? incomingWord.pinyin : undefined)
      choice.click()
    } else {
      input.value = directionForms[incomingDirection].answer === 'pinyin'
        ? pinyinAnswerForms(incomingWord.pinyin).at(-1)! : answerText(incomingWord, incomingDirection)
      document.getElementById('type-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }
    expect(score()).toBe(100)
    if (!allowsPinyinAnnotations(incomingDirection)) expect(document.querySelector('#field rt, #answer-bank rt')).toBeNull()
    // A saved preference must not leak annotations into later spawned words either.
    step(4500)
    if (!allowsPinyinAnnotations(incomingDirection)) expect(document.querySelector('#incoming rt')).toBeNull()
  }
})
