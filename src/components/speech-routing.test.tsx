// Every speech call goes through the pack's speechText: two components with the speech output mocked, and a scan of the sources for a speak call that skips it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spoken: { text: string; locale: string }[] = []
vi.mock('../core/assistant/speech', async importOriginal => ({
  ...(await importOriginal<typeof import('../core/assistant/speech')>()),
  playBrowserSpeech: (_id: string, text: string, locale: string) => { spoken.push({ text, locale }) },
  playBrowserSpeechToEnd: async (_id: string, text: string, locale: string) => { spoken.push({ text, locale }); return 'ended' },
}))
import { PlayButton } from './PlayButton'
import { SentenceAudio } from '../pages/drills/SentenceAudio'
import { setBuildLanguageForTests } from '../core/storage-names'
import { noteChineseReadings, resetChineseReadings } from '../core/language/speech-chinese'

beforeEach(() => { spoken.length = 0; resetChineseReadings(); setBuildLanguageForTests('zh') })

describe('speech call sites go through speechText', () => {
  it('the play button speaks 银行 as 银杭 and a noted sentence with its reading', async () => {
    noteChineseReadings([['她们做饭，还喝茶。', 'tā men zuò fàn hái hē chá']])
    const { unmount } = render(<><PlayButton text="银行" kind="word" reading="yín háng" /><PlayButton text="她们做饭，还喝茶。" kind="sentence" /></>)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1])
    await waitFor(() => expect(spoken.map(item => item.text)).toEqual(['银杭', '她们做饭，孩喝茶。']))
    unmount()
  })
  it('the practice sentence audio speaks the text with a lone 还 decided by nothing as it is, and 还书 as 环书', async () => {
    const { unmount } = render(<SentenceAudio text="还书" kind="sentence" autoPlay />)
    await waitFor(() => expect(spoken.map(item => item.text)).toEqual(['环书']))
    unmount()
  })
})

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
})
describe('no speech path skips the pack step', () => {
  it('every playBrowserSpeech call in the app passes its text through spokenText', () => {
    const skipping: string[] = []
    for (const file of walk('src')) {
      if (file.endsWith('assistant/speech.ts')) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/playBrowserSpeech(ToEnd)?\(/.test(line) && !/^\s*(export )?(async )?function|import /.test(line) && !/spokenText\(|spoken\(|\bspoken\b/.test(line)) skipping.push(file.replace(/\\/g, '/') + ':' + (index + 1) + ' ' + line.trim().slice(0, 110))
      })
    }
    expect(skipping).toEqual([])
  })
})
