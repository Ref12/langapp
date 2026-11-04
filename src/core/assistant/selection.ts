import type { SpeechLocale } from './contracts'
import { MAX_PRACTICE_TEXT_LENGTH } from './practice-chain-contracts'

export function snippetLocale(text: string): SpeechLocale | undefined {
  if (/[\p{Script=Han}]/u.test(text) && !/[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return 'zh-Hans'
  if (/[A-Za-z]/.test(text) && /^[\p{Script=Latin}\p{P}\p{N}\p{Z}\s]+$/u.test(text)) return 'en-US'
  return undefined
}

export function selectionPracticeUnavailable(text: string): string | undefined {
  if (snippetLocale(text) !== 'zh-Hans') return 'Select Mandarin text to use phrase practice.'
  if (text.trim().length > MAX_PRACTICE_TEXT_LENGTH) return `Select at most ${MAX_PRACTICE_TEXT_LENGTH.toLocaleString('en-US')} characters to practice.`
}

/**
 * What a selection may be used for. `data-assistant-protected="true"` blocks it entirely (game boards).
 * `"restricted"` keeps the selection bar but withholds Ask, which leaves the page and would explain an unanswered exercise;
 * `data-assistant-no-hear` on the same area also withholds Hear, where hearing the text would give the answer away.
 */
export type SelectionAccess = { text: string; ask: boolean; hear: boolean }

export function selectedSnippet(selection: Selection | null, root: HTMLElement): string | undefined {
  return selectionAccess(selection, root)?.text
}

export function selectionAccess(selection: Selection | null, root: HTMLElement): SelectionAccess | undefined {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return undefined
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const finish = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const excluded = 'rt, rp, input, textarea, select, [contenteditable], [data-assistant-exclude]'
  if (start?.closest(excluded) || finish?.closest(excluded)) return undefined
  let ask = true
  let hear = true
  for (const node of root.querySelectorAll('[data-assistant-protected]')) {
    if (!range.intersectsNode(node)) continue
    if (node.getAttribute('data-assistant-protected') !== 'restricted') return undefined
    ask = false
    if (node.hasAttribute('data-assistant-no-hear')) hear = false
  }
  const fragment = range.cloneContents()
  fragment.querySelectorAll('rt, rp, input, textarea, select, [data-assistant-exclude], button:not(.reading-token)').forEach(node => node.remove())
  const text = fragment.textContent
  return text?.trim() && text.length <= 8000 ? { text, ask, hear } : undefined
}
