// Shared by the three screen-snapshot tests (chinese-, japanese-, korean-screens.test.tsx).
// A page is "settled" when its visible text holds no "Loading…" and has stopped changing: the same text on every poll for SETTLE_MS
// (several polls in a row), so counts, lists and look-up data that arrive asynchronously are in before the snapshot is taken.
// No fixed sleeps: the wait ends as soon as the page has held still, and it fails (with the last text) if it never does.
import { waitFor } from '@testing-library/react'

const POLL_MS = 50
const SETTLE_MS = 400
const SETTLE_POLLS = 5
const LOADING = /^Loading\b.*(…|\.\.\.)$/m // a status line such as "Loading the curriculum…", not prose that mentions loading

export function visibleText(root: Element): string {
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

/** Resolves with the page's visible text once it has no "Loading" text and has not changed for several polls over SETTLE_MS. */
export async function settledText(root: () => Element = () => document.querySelector('main') ?? document.body, timeout = 15_000): Promise<string> {
  let last = ''
  let since = performance.now()
  let polls = 0
  return waitFor(() => {
    const now = visibleText(root())
    if (LOADING.test(now) || now !== last) { last = now; since = performance.now(); polls = 0; throw new Error('page not settled yet:\n' + now.slice(0, 400)) }
    polls++
    if (polls < SETTLE_POLLS || performance.now() - since < SETTLE_MS) throw new Error('page still settling')
    return now
  }, { timeout, interval: POLL_MS })
}
