import type { SpeechLocale } from './contracts'

export function snippetLocale(text: string): SpeechLocale | undefined {
  if (/[\p{Script=Han}]/u.test(text) && !/[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return 'zh-Hans'
  if (/[A-Za-z]/.test(text) && /^[\p{Script=Latin}\p{P}\p{N}\p{Z}\s]+$/u.test(text)) return 'en-US'
  return undefined
}

export function selectedSnippet(selection: Selection | null, root: HTMLElement): string | undefined {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return undefined
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  if (start?.closest('rt, rp, input, textarea, select, [contenteditable], [data-assistant-exclude]')) return undefined
  for (const node of root.querySelectorAll('[data-assistant-protected="true"]')) {
    if (range.intersectsNode(node)) return undefined
  }
  const fragment = range.cloneContents()
  fragment.querySelectorAll('rt, rp, input, textarea, select, [data-assistant-exclude], button:not(.reading-token)').forEach(node => node.remove())
  const text = fragment.textContent
  return text?.trim() && text.length <= 8000 ? text : undefined
}
