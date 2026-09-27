import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import '@testing-library/jest-dom/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Outcome } from './player'

const audio = vi.hoisted(() => ({
  speak: vi.fn<(id: string, text: string, locale: string, rate: number) => Promise<Outcome>>(),
  stop: vi.fn<() => string | undefined>(),
}))
vi.mock('../../src/core/assistant/speech', () => ({
  playBrowserSpeechToEnd: audio.speak, stopBrowserSpeech: audio.stop,
}))
afterEach(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide'))
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('opens a quiet, functional UI with all four modes and shared controls without recording or network calls', async () => {
  audio.speak.mockReturnValue(new Promise(() => {}))
  audio.stop.mockReturnValue(undefined)
  vi.stubGlobal('fetch', vi.fn())
  const html = readFileSync(new NodeURL('./index.html', import.meta.url), 'utf8')
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
  await import('./main')
  const popup = screen.getByRole('dialog', { name: 'Phrase practice' })
  expect(popup).toHaveAttribute('open')
  expect(audio.speak).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByText('Make it yours')).not.toBeVisible()
  expect(within(popup).getByRole('button', { name: /Auto-ramp/ })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'Faster speech' }))
  expect(document.getElementById('speed')).toHaveTextContent('0.8×')
  const faster = screen.getByRole('button', { name: 'Faster speech' })
  faster.focus()
  fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))
  expect(audio.speak).toHaveBeenLastCalledWith('phrase-practice-prototype', '我', 'zh-Hans', 0.8)
  expect(faster).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Faster speech' }))
  expect(audio.speak).toHaveBeenCalledTimes(1)
  expect(document.getElementById('speed')).toHaveTextContent('0.85×')
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  for (const [label, first, pause] of [['Whole phrase', '我想明天早上去公园跑步。', '4s'],
    ['Build from start', '我', '2.5s'], ['Build from end', '跑步。', '2.5s'], ['Word by word', '我', '1.5s']]) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(document.getElementById('hanzi')).toHaveTextContent(first)
    expect(document.getElementById('pause')).toHaveTextContent(pause)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(audio.speak).toHaveBeenLastCalledWith('phrase-practice-prototype', first, 'zh-Hans', 0.85)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  }
  fireEvent.click(screen.getByRole('button', { name: 'Practice options' }))
  expect(screen.getByText('Make it yours')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Sample phrase'), { target: { value: '1' } })
  expect(screen.getAllByRole('button', { name: /^Select step/ })).toHaveLength(3)
  fireEvent.click(screen.getByLabelText('Pinyin'))
  expect(document.getElementById('reading')).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.getByRole('button', { name: 'Practice options' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: /Auto-ramp/ }))
  expect(screen.getByRole('button', { name: /Auto-ramp/ })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: /^Loop/ }))
  expect(screen.getByRole('button', { name: /Auto-ramp/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(screen.getByRole('button', { name: 'Resume' })).toBeVisible()
  const calls = audio.speak.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
  expect(popup).not.toHaveAttribute('open')
  fireEvent.click(screen.getByRole('button', { name: 'Open phrase practice' }))
  expect(popup).toHaveAttribute('open')
  expect(audio.speak).toHaveBeenCalledTimes(calls)
})
