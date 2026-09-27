import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { sampleWords } from './deck'

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
})
