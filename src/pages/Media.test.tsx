import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { resetProfileStorage } from '../test/profile-storage'
import { openPhraseActions } from '../test/phrase-actions'
import { launcher, normalizeMediaUrl, timing } from '../core/media/helper'
import { saveMedia } from '../core/media/store'
const studied = vi.hoisted(() => vi.fn(() => Promise.resolve('sess1')))
vi.mock('../core/collections/store', async importOriginal => ({ ...(await importOriginal<typeof import('../core/collections/store')>()), studyLines: studied }))
const translating = vi.hoisted(() => vi.fn())
vi.mock('../core/media/translation', async importOriginal => ({ ...(await importOriginal<typeof import('../core/media/translation')>()), translateMedia: translating }))
import { nextInterval, nextLines } from '../core/media/study'
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
    expect(JSON.parse(String(fetchMock.mock.calls.find(call => String(call[0]).endsWith('/v1/jobs'))![1]!.body))).toMatchObject({ languages: ['zh-Hans', 'zh-CN', 'zh', 'zh-Hant', 'zh-TW'], want: ['subtitles', 'video'] })
    expect(window.location.hash).toBe(`#media/${saved[0].id}`)
    expect(await db.knowledge.count()).toBe(0)
  })

  it('re-submits a job Medusa does not know, once, and keeps polling', async () => {
    let known = false
    const posts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/status')) return json({ app: 'medusa' })
      if (url.endsWith('/v1/jobs') && init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); if (posts.length > 1) known = true; return json({ id: 'x' }) }
      if (url.endsWith('/result')) return json(wire)
      return known ? json({ id: 'x', state: 'done' }) : json({ code: 'unknown_job' }, false)
    }))
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Link to a video' }), 'https://youtu.be/zzzzzzzzzzz')
    // first POST is the initial create (Medusa then forgets it); the second is the page's re-submit
    await user.click(screen.getByRole('button', { name: 'Get transcript' }))
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    expect(posts).toHaveLength(2)
    expect(posts[1]).toMatchObject({ id: (posts[0] as { id: string }).id, url: 'https://youtu.be/zzzzzzzzzzz', want: ['subtitles', 'video'] })
  })

  it('says what to do when the re-submit also fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/status')) return json({ app: 'medusa' })
      if (url.endsWith('/v1/jobs') && init?.method === 'POST') return json({ id: 'x' }, true).then(r => (posts++ > 0 ? ({ ok: false, json: () => Promise.resolve({ message: 'no' }) } as Response) : r))
      return json({}, false)
    }))
    let posts = 0
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Link to a video' }), 'https://example.com/v')
    await user.click(screen.getByRole('button', { name: 'Get transcript' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Medusa does not know this job\. Open Medusa, then try again\./)
  })

  it('normalises YouTube links and offers Open saved before a new download', async () => {
    for (const link of ['https://m.youtube.com/watch?v=abcdefghijk&t=5s', 'https://youtu.be/abcdefghijk?si=x', 'https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&list=L'])
      expect(normalizeMediaUrl(link)).toBe(normalizeMediaUrl(result.url))
    expect(normalizeMediaUrl('https://youtu.be/other')).not.toBe(normalizeMediaUrl(result.url))
    await saveMedia(result as never, '11111111-1111-4111-8111-111111111111')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('blocked'))))
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Link to a video' }), 'https://youtu.be/abcdefghijk?si=x')
    expect(await screen.findByRole('link', { name: 'Open saved' })).toHaveAttribute('href', '#media/11111111-1111-4111-8111-111111111111')
    expect(screen.queryByRole('button', { name: 'Get transcript' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download again' }))
    expect(screen.getByRole('button', { name: 'Get transcript' })).toBeEnabled()
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
    expect(intent).toContain('&languages=zh-Hans%2Czh-CN%2Czh%2Czh-Hant%2Czh-TW&want=subtitles%2Cvideo')
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
    expect(names).toMatch(/Overview.*Lessons.*Practice.*Library.*Media.*Collections.*Games.*Assistant.*History.*Dictionary/)
  })

  it('tracks the current line from the video, seeks on tap, and adds to knowledge only through Learn', async () => {
    const id = await saveMedia(result as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Lines' }))
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
    await user.click(await menu.findByRole('button', { name: 'Add to my knowledge set' }))
    await waitFor(async () => expect(await db.knowledge.count()).toBeGreaterThan(before))
  })

  it('follows the current line inside the list only, and stops following when the user scrolls it', async () => {
    const id = await saveMedia(result as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return (this as HTMLElement).tagName === 'LI' ? 100 * ([...(this as HTMLElement).parentElement!.children].indexOf(this as HTMLElement)) : 0 } })
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const top = window.scrollY
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Lines' }))
    const box = screen.getByTestId('media-lines-scroll')
    const settled = pageScroll.mock.calls.length
    expect(box.contains(document.querySelector('video'))).toBe(false)
    player.time = 4.5
    await waitFor(() => expect(box.scrollTop).toBe(100))
    player.time = 8.5
    await waitFor(() => expect(box.scrollTop).toBe(200))
    expect(intoView).not.toHaveBeenCalled()
    expect(pageScroll).toHaveBeenCalledTimes(settled)
    expect(window.scrollY).toBe(top)
    fireEvent.wheel(box)
    player.time = 1.5
    await waitFor(() => expect(document.querySelector('[aria-current="true"]')).toHaveTextContent('你好'))
    expect(box.scrollTop).toBe(200)
    await user.click(screen.getByRole('button', { name: 'Back to current line' }))
    expect(box.scrollTop).toBe(0)
  })

  it('teaches a Chinese title with the phrase actions', async () => {
    const id = await saveMedia({ ...result, title: '你好' } as never)
    window.location.hash = `#media/${id}`
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: '你好', level: 1 })
    expect(document.querySelector('.media-title-teach')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Study the title' }))
    const teach = document.querySelector('.media-title-teach') as HTMLElement
    expect(teach).not.toBeNull()
    expect(teach.querySelector('[lang="zh-Hans"]')).toHaveTextContent('你好')
    expect(teach.querySelector('button[aria-label^="Hear"], button[title^="Hear"]')).not.toBeNull()
  })

  it('puts the video first, then the compact title, the segmented switcher and the toolbar', async () => {
    const id = await saveMedia({ ...result, title: '一部很长很长的电视剧标题'.repeat(6) } as never)
    window.location.hash = `#media/${id}`
    render(<App />)
    await screen.findByRole('heading', { level: 1 })
    const order = ['.media-stage', '.media-title', '.media-views', '.media-toolbar', '.media-footer'].map(selector => document.querySelector(selector) as HTMLElement)
    expect(order.every(Boolean)).toBe(true)
    order.slice(1).forEach((node, index) => expect(order[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy())
    expect(document.querySelector('.media-title-teach')).toBeNull()
  })

  it('gives every Chinese character a reading and a tap target, even outside the catalog', async () => {
    const id = await saveMedia({ ...result, lines: [{ start: 0, end: 2, text: '白眼狼，守寡了。' }, ...result.lines.slice(1)] } as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { level: 1 })
    player.time = 0.5
    const footer = () => document.querySelector('.media-footer') as HTMLElement
    await waitFor(() => expect(footer().querySelectorAll('.word').length).toBeGreaterThanOrEqual(6))
    const words = [...footer().querySelectorAll('.word')].map(node => node.textContent)
    expect(words).toEqual(expect.arrayContaining(['白', '眼', '狼', '守', '寡', '了']))
    expect([...footer().querySelectorAll('.media-now rt')].every(node => !!node.textContent)).toBe(true)
    await user.click([...footer().querySelectorAll('.word')].find(node => node.textContent === '狼')!)
    expect(within(footer()).getByRole('link', { name: 'Look up in Dictionary' })).toHaveAttribute('href', '#dictionary/characters/all?q=%E7%8B%BC')
  })

  it('switches between the learning, lines and watch views, toggling the fullscreen API', async () => {
    const id = await saveMedia(result as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    const request = vi.fn(() => Promise.resolve())
    const exit = vi.fn(() => Promise.resolve())
    Element.prototype.requestFullscreen = request
    document.exitFullscreen = exit
    let fullscreen: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    const view = () => document.querySelector('.media-watch')!.getAttribute('data-view')
    expect(view()).toBe('learn')
    expect(screen.getByTestId('media-lines-scroll').closest('.media-list-panel')).toHaveAttribute('hidden')
    await user.click(screen.getByRole('button', { name: 'Lines' }))
    expect(view()).toBe('lines')
    expect(screen.getByTestId('media-lines-scroll').closest('.media-list-panel')).not.toHaveAttribute('hidden')
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }))
    expect(view()).toBe('watch')
    expect(request).toHaveBeenCalledTimes(1)
    expect((request.mock.contexts as unknown[])[0]).toBe(document.querySelector('.media-watch'))
    fullscreen = document.querySelector('.media-watch')
    await user.click(screen.getByRole('button', { name: 'Exit fullscreen' }))
    expect(exit).toHaveBeenCalled()
    expect(view()).toBe('learn')
    fullscreen = null
  })

  // Flaky under CI load (timed out at 5 s, 2026-10-29; passed in the previous deploy and locally). Skipped until fixed properly.
  it.skip('draws subtitles over the video in the watch view, plain or annotated, and picks lines to study', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ start: 1 + i * 3, end: 3 + i * 3, text: `第${i + 1}句` }))
    const id = await saveMedia({ ...result, lines: many } as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    Element.prototype.requestFullscreen = vi.fn(() => Promise.resolve())
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }))
    player.time = 4.5
    await waitFor(() => expect(document.querySelector('.media-overlay-text')).toHaveTextContent('第2句'))
    await user.click(screen.getByRole('checkbox', { name: 'Annotated subtitles' }))
    expect(document.querySelector('.media-overlay-text')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Learn' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose lines to study' })
    const boxes = () => within(dialog).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes().filter(box => box.checked)).toHaveLength(5)
    await user.click(within(dialog).getByRole('button', { name: 'Next 2 minutes' }))
    expect(boxes().filter(box => box.checked).length).toBe(many.filter(entry => entry.start >= 4.5 && entry.start < 124.5).length)
    const number = within(dialog).getByRole('spinbutton', { name: 'Number of lines' })
    fireEvent.change(number, { target: { value: '2' } })
    await user.click(within(dialog).getByRole('button', { name: 'Pick 2' }))
    expect(boxes().filter(box => box.checked)).toHaveLength(2)
    await user.click(boxes().find(box => box.checked)!)
    await user.click(within(dialog).getByRole('button', { name: 'Study 1 line' }))
    await waitFor(() => expect(studied).toHaveBeenCalledTimes(1))
    const sent = (studied.mock.calls as unknown as { text: string; source: { mediaId: string; title: string; line: number; start: number; text: string } }[][][])[0][0]
    expect(sent).toHaveLength(1)
    expect(sent[0].source).toMatchObject({ mediaId: id, title: 'A drama', text: sent[0].text })
    expect(window.location.hash).toBe('#lessons/session/sess1')
  })

  const aligned = {
    sentences: [{ lines: [0, 1], translation: 'Hello, I am a student.', fragments: [{ line: 0, text: 'Hello,' }, { line: 1, text: 'I am a student.' }] }, { lines: [2, 2], translation: 'Goodbye.', fragments: [{ line: 2, text: 'Goodbye.' }] }],
    tokens: [
      { line: 0, items: [{ text: '你好', pinyin: 'nǐ hǎo', meaning: 'hello', trailing: '' }] },
      { line: 1, items: [{ text: '我', pinyin: 'wǒ', meaning: 'I', trailing: '' }, { text: '是', pinyin: 'shì', meaning: 'am', trailing: '' }, { text: '学生', pinyin: 'xuéshēng', meaning: 'student', trailing: '' }] },
      { line: 2, items: [{ text: '再见', pinyin: 'zàijiàn', meaning: 'goodbye', trailing: '' }] },
    ], upTo: 3, updatedAt: 1,
  }

  it('weaves the current line with a toggle for word meanings and shows its aligned fragment', async () => {
    const id = await saveMedia({ ...result, aligned } as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    player.time = 4.5
    const footer = () => document.querySelector('.media-footer') as HTMLElement
    await waitFor(() => expect(within(footer()).getByText('I am a student.')).toBeInTheDocument())
    expect(footer().querySelectorAll('.woven-token')).toHaveLength(3)
    expect(footer().querySelector('.woven-gloss')).toBeNull()
    expect(within(footer()).queryByText('Hello, I am a student.')).toBeNull()
    await user.click(within(footer()).getByText('I am a student.'))
    expect(within(footer()).getByText('Hello, I am a student.')).toBeInTheDocument()
    await user.click(within(footer()).getByRole('checkbox', { name: 'Word meanings' }))
    expect(footer().querySelectorAll('.woven-gloss')).toHaveLength(3)
    await user.click(footer().querySelector('.woven-token .word')!)
    expect(within(footer()).getByText(/\/ I$/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lines' }))
    expect(within(screen.getByTestId('media-lines-scroll')).getAllByText(/Hello,|I am a student\.|Goodbye\./)).toHaveLength(3)
  })

  it('shows the linked entry when a woven word is tapped once pass 2 has run', async () => {
    await db.sourceEntries.add({ id: 'sabc1', word: '\u5b66\u751f', pinyin: 'xué sheng', meanings: ['pupil', 'learner'], pos: 'noun', sources: [{ mediaId: 'x', title: 'A drama', line: 1, text: '\u6211\u662f\u5b66\u751f' }], createdAt: 1, updatedAt: 1 })
    const id = await saveMedia({ ...result, aligned, entries: { links: { '\u5b66\u751f': 'source:sabc1' }, skipped: [], counts: { 'source:sabc1': 1 }, total: 4, complete: false, updatedAt: 2 } } as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    player.time = 4.5
    const footer = () => document.querySelector('.media-footer') as HTMLElement
    await waitFor(() => expect(footer().querySelectorAll('.woven-token')).toHaveLength(3))
    // A word without a link still shows the line's own gloss; a linked one shows its entry and where it comes from.
    await user.click(footer().querySelectorAll('.woven-token .word')[0])
    expect(within(footer()).getByText(/\/ I$/)).toBeInTheDocument()
    await user.click(footer().querySelectorAll('.woven-token .word')[2])
    await waitFor(() => expect(within(footer()).getByText(/pupil; learner/)).toBeInTheDocument())
    expect(within(footer()).getByText('From your media')).toBeInTheDocument()
    expect(within(footer()).getByText(/here: student/)).toBeInTheDocument()
  })

  it('offers the fragment as a second subtitle line and in the Learn picker, and woven tokens when annotated', async () => {
    const id = await saveMedia({ ...result, aligned } as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    Element.prototype.requestFullscreen = vi.fn(() => Promise.resolve())
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }))
    player.time = 1.5
    await waitFor(() => expect(document.querySelector('.media-overlay-text')).toHaveTextContent('你好'))
    expect(document.querySelector('.media-overlay-second')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Translation' }))
    expect(document.querySelector('.media-overlay-second')).toHaveTextContent('Hello,')
    await user.click(screen.getByRole('checkbox', { name: 'Annotated subtitles' }))
    expect(document.querySelectorAll('.media-overlay-line .woven-token').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Learn' }))
    expect(within(screen.getByRole('dialog', { name: 'Choose lines to study' })).getByText(/I am a student\./)).toBeInTheDocument()
  })

  it('translates on demand only, with progress, cancel and resume', async () => {
    const id = await saveMedia(result as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    let release: () => void = () => undefined
    translating.mockImplementation((_id: string, signal: AbortSignal, onProgress: (done: number, total: number) => void) => new Promise<void>((resolve, reject) => {
      onProgress(1, 3)
      release = resolve
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')))
    }))
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    expect(translating).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Translate with AI' }))
    expect(await screen.findByText(/Translating 1 of 3 lines/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translate with AI' })).toBeInTheDocument())
    expect(screen.queryByRole('alert')).toBeNull()
    await db.mediaItems.update(id, { aligned: { ...aligned, sentences: aligned.sentences.slice(0, 1), tokens: aligned.tokens.slice(0, 2), upTo: 2 } })
    expect(await screen.findByRole('button', { name: 'Continue translating (2 of 3 done)' })).toBeInTheDocument()
    release()
  })

  it('sends the translation to Medusa and falls back to a subtitle file on 404', async () => {
    const id = await saveMedia({ ...result, mediaId: 'm1', aligned } as never)
    window.location.hash = `#media/${id}`
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    const real = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/tracks') ? fetchMock(input, init) : real(input, init))
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<App />)
    await screen.findByRole('heading', { name: 'A drama', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Add translation to Medusa' }))
    expect(await screen.findByText(/too old to add tracks/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/media/m1/tracks')
    await user.click(screen.getByRole('button', { name: 'Save as subtitle file' }))
    expect(click).toHaveBeenCalledTimes(2)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await user.click(screen.getByRole('button', { name: 'Add pinyin to Medusa' }))
    expect(await screen.findByText('Sent the pinyin track to Medusa.')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('selects intervals and counts', () => {
    expect(nextInterval(lines, 4.5, 6)).toEqual(lines.map((e, i) => e.start >= 4.5 && e.start < 10.5 ? i : -1).filter(i => i >= 0))
    expect(nextLines(lines, 1, 2)).toEqual([1, 2])
    expect(nextLines(lines, -3, 1)).toEqual([0])
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
    await userEvent.click(screen.getByRole('button', { name: 'Lines' }))
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
