import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { resetProfileStorage } from '../test/profile-storage'
import { openPhraseActions } from '../test/phrase-actions'
import { launcher, timing } from '../core/media/helper'
import { saveMedia } from '../core/media/store'
import { currentLine, nudge } from '../core/media/contracts'

const player = vi.hoisted(() => ({ time: 0, play: vi.fn(), pause: vi.fn() }))

const lines = [{ start: 1, end: 3, text: '你好' }, { start: 4, end: 6, text: '我是学生' }, { start: 8, end: 9, text: '再见' }]
const result = { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'A drama', durationSec: 60, extractor: 'youtube', videoId: 'abcdefghijk', source: 'captions', language: 'zh-Hans', lines, mediaId: 'm1', hasVideo: true, videoPath: '/v1/media/m1/video', sync: [] }
const wire = { mediaId: 'm1', url: result.url, title: 'A drama', durationSec: 60, extractor: 'youtube', videoId: 'abcdefghijk', video: { path: '/v1/media/m1/video', contentType: 'video/mp4' }, subtitles: { source: 'captions', language: 'zh-Hans', lines }, sync: [] }

function json(body: unknown, ok = true) { return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response) }

beforeEach(async () => {
  await resetProfileStorage()
  window.location.hash = '#media'
  localStorage.clear()
  player.time = 0
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: () => player.time, set: (value: number) => { player.time = value } })
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => false })
  HTMLMediaElement.prototype.play = player.play as never
  HTMLMediaElement.prototype.pause = player.pause
  Object.assign(timing, { pollMs: 5, probeMs: 50, tickMs: 10, syncDebounceMs: 20 })
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), getVoices: () => [], speak: vi.fn() })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); player.play.mockClear(); player.pause.mockClear() })

describe('Media page', () => {
  it('finds the current line from a time', () => {
    expect([0, 1, 2.9, 3.5, 4, 7, 100].map(time => currentLine(lines, time))).toEqual([-1, 0, 0, 0, 1, 1, 2])
  })

  it('runs a job through the local helper to a saved item', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/status')) return json({ app: 'medusa' })
      if (url.endsWith('/v1/jobs') && init?.method === 'POST') return json({ id: JSON.parse(String(init.body)).id })
      if (url.endsWith('/result')) return json(wire)
      return json({ id: 'x', state: 'done' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Link to a video' }), result.url)
    await user.click(screen.getByRole('button', { name: 'Get transcript' }))
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    const saved = await db.mediaItems.toArray()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ mediaId: 'm1', hasVideo: true, videoPath: '/v1/media/m1/video' })
    expect(JSON.parse(String(fetchMock.mock.calls.find(call => String(call[0]).endsWith('/v1/jobs'))![1]!.body)).want).toEqual(['subtitles', 'video'])
    expect(window.location.hash).toBe(`#media/${saved[0].id}`)
    expect(await db.knowledge.count()).toBe(0)
  })

  it('opens the helper by intent URL when it does not answer, then offers the file import', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('blocked'))))
    const open = vi.spyOn(launcher, 'open').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Link to a video' }), 'https://www.youtube.com/watch?v=abc&t=1')
    await user.click(screen.getByRole('button', { name: 'Get transcript' }))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    const intent = open.mock.calls[0][0]
    const id = /job=([^&]+)/.exec(intent)![1]
    expect(intent.startsWith('intent://open?job=')).toBe(true)
    expect(intent).toContain(`&url=${encodeURIComponent('https://www.youtube.com/watch?v=abc&t=1')}`)
    expect(intent).toContain(`&return=${encodeURIComponent(new URL(`#media/job/${id}`, document.baseURI).href)}`)
    expect(intent).toContain(`S.browser_fallback_url=${encodeURIComponent(new URL('#media/install', document.baseURI).href)};end`)
    expect(intent).toContain('&want=subtitles%2Cvideo')
    expect(intent).toContain('#Intent;scheme=medusa;package=io.ref12.medusa;')
    await screen.findByText(/could not reach Medusa/)
    const file = new File([JSON.stringify({ ...wire, video: null })], 'A drama.medusa.json', { type: 'application/json' })
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } })
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    expect(await db.mediaItems.count()).toBe(1)
  })

  it('rejects a file that is not a transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('blocked'))))
    render(<App />)
    await screen.findByRole('heading', { name: 'Media', level: 1 })
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['nope'], 'x.json')] } })
    await screen.findByText('This file is not a transcript file from Medusa.')
    expect(await db.mediaItems.count()).toBe(0)
  })

  it('shows the install page and the Media nav entry between Library and Games', async () => {
    window.location.hash = '#media/install'
    render(<App />)
    await screen.findByRole('heading', { name: 'Install Medusa' })
    expect(screen.getByRole('link', { name: 'the Medusa releases page' })).toHaveAttribute('href', 'https://github.com/lancec-codebox/appbox/releases')
    const names = screen.getAllByRole('navigation', { name: 'Main navigation' })[0].textContent
    expect(names).toMatch(/Overview.*Lessons.*Practice.*Library.*Media.*Games.*Assistant.*History.*Dictionary/)
  })

  it('tracks the current line from the video, seeks on tap, and adds to knowledge only through Learn', async () => {
    const id = await saveMedia(result as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    player.time = 4.5
    await waitFor(() => expect(screen.getAllByRole('listitem').find(item => item.getAttribute('aria-current') === 'true')).toHaveTextContent('我是学生'))
    await user.click(screen.getByRole('button', { name: 'Play from 0:08' }))
    expect(player.time).toBe(8)
    expect(await db.knowledge.count()).toBe(0)
    await user.click(screen.getByRole('checkbox', { name: 'Pause after each line' }))
    expect(localStorage.getItem('linguaweave-media-pause-after-line')).toBe('true')
    player.time = 10
    await waitFor(() => expect(player.pause).toHaveBeenCalled())
    expect(document.querySelector('video')).toHaveAttribute('src', 'http://127.0.0.1:38917/v1/media/m1/video')
    expect(document.querySelector('video')).toHaveAttribute('crossorigin')
    const before = await db.knowledge.count()
    const menu = openPhraseActions(document.body, 0)
    await user.click(await menu.findByRole('button', { name: 'Learn' }))
    await waitFor(async () => expect(await db.knowledge.count()).toBeGreaterThan(before))
  })

  it('applies and saves sync anchors, and prefers a newer Medusa copy on open', async () => {
    const puts: unknown[] = []
    let stored: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); stored = JSON.parse(String(init.body)).sync; return json({}) }
      return json({ sync: stored })
    }))
    const id = await saveMedia(result as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    player.time = 4.5
    await user.click(screen.getByRole('button', { name: 'Later' }))
    await waitFor(() => expect(puts).toEqual([{ sync: [{ at: 4, offset: 0.25 }] }]))
    expect((await db.mediaItems.get(id))?.sync).toEqual([{ at: 4, offset: 0.25 }])
    await user.click(screen.getAllByRole('button', { name: 'Sync to this line' })[2])
    await waitFor(async () => expect((await db.mediaItems.get(id))?.sync).toEqual([{ at: 4, offset: 0.25 }, { at: 8, offset: -3.5 }]))
    await user.click(screen.getByRole('button', { name: 'Reset all' }))
    await waitFor(async () => expect((await db.mediaItems.get(id))?.sync).toEqual([]))
  })

  it('adopts Medusa\'s sync when ours is not waiting to be sent', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ sync: [{ at: 0, offset: 1 }] })))
    const id = await saveMedia(result as never)
    window.location.hash = `#media/${id}`
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    await waitFor(async () => expect((await db.mediaItems.get(id))?.sync).toEqual([{ at: 0, offset: 1 }]))
  })

  it('applies anchors to the current line and nudges the right anchor', () => {
    const sync = [{ at: 0, offset: 0 }, { at: 100, offset: -1 }]
    expect(currentLine(lines, 4.5, [{ at: 0, offset: 1 }])).toBe(0)
    expect(nudge(sync, 120, 118, 0.25)).toEqual([{ at: 0, offset: 0 }, { at: 100, offset: -0.75 }])
    expect(nudge(sync, 200, 195, 0.25)).toEqual([{ at: 0, offset: 0 }, { at: 100, offset: -1 }, { at: 195, offset: -0.75 }])
  })

  it('shows a transcript with a link to the original for other sites, and deletes items', async () => {
    const id = await saveMedia({ ...result, url: 'https://example.com/v/1', extractor: 'bilibili', videoId: undefined, hasVideo: false, videoPath: undefined } as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Open the original' })).toHaveAttribute('href', 'https://example.com/v/1')
    expect(screen.getAllByText('再见').length).toBeGreaterThan(0)
    window.location.hash = '#media'
    await user.click(await screen.findByRole('button', { name: 'Delete A drama' }))
    await waitFor(async () => expect(await db.mediaItems.count()).toBe(0))
  })
})
