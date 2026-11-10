// @vitest-environment jsdom
// The visible text of the Overview and the Lessons page in a Korean build, which has no lessons yet. Next to japanese-screens.test.tsx; the same walk
// of the page text, pinned in __screens__/ko-<name>.txt. None of the screens may speak of Mandarin, Chinese, pinyin or HSK. To accept a deliberate
// change, review the diff and run with -u.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { setBuildLanguageForTests } from '../core/storage-names'
import { resetCatalogCache } from '../core/study/catalog'
import { resetBackupStateForTests } from '../core/backup/state'
import { initializeProfiles } from '../core/profiles/store'
import { T0 } from '../core/profiles/fixtures/learner'

const FORBIDDEN = /Mandarin|Chinese|pinyin|HSK/i

function visibleText(root: Element): string {
  const lines: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement
    if (!element || ['SCRIPT', 'STYLE'].includes(element.tagName)) continue
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) lines.push(text)
  }
  return lines.join('\n') + '\n'
}
const maskBuild = (text: string) => text.replace(/(· commit\n)[0-9a-f]{7,40}/, '$1<commit>')

async function screenText(route: string, ready: () => unknown): Promise<string> {
  window.location.hash = '#' + route
  render(<App />)
  await waitFor(ready, { timeout: 8000 })
  const main = () => visibleText(document.querySelector('main') ?? document.body)
  let last = main()
  for (let n = 0; n < 60; n++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    const now = main()
    if (now === last && n > 4) return maskBuild(now)
    last = now
  }
  return maskBuild(last)
}

beforeEach(async () => {
  setBuildLanguageForTests('ko')
  resetCatalogCache()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('screen text of the Korean build while its catalog is empty', () => {
  const pin = async (name: string, text: string) => {
    expect(text.split('\n').filter(line => FORBIDDEN.test(line)).map(line => line.slice(0, 160))).toEqual([])
    await expect(text).toMatchFileSnapshot(`./__screens__/ko-${name}.txt`)
  }
  it('Overview says lessons are on their way, not that every group is added', async () => {
    const text = await screenText('overview', () => expect(screen.getByLabelText('Your actual learning progress')).toBeInTheDocument())
    expect(text).toContain('Lessons are on their way for Korean.')
    expect(text).not.toMatch(/every group|0 \/ 0/)
    await pin('overview', text)
  })
  it('Lessons says lessons are on their way', async () => {
    const text = await screenText('lessons', () => expect(screen.getByText('Lessons are on their way for Korean.')).toBeInTheDocument())
    await pin('lessons', text)
  })
})
