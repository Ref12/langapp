import { afterEach, describe, expect, it } from 'vitest'
import { selectedSnippet, snippetLocale } from './selection'

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges() })

function select(root: HTMLElement, node: Node = root) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selectedSnippet(selection, root)
}

describe('context selection', () => {
  it('retains the selected whitespace rather than silently rewriting source text', () => {
    const root = document.createElement('main')
    root.textContent = '  \u4f60\u597d\u3002\n'
    document.body.append(root)
    expect(select(root)).toBe(root.textContent)
  })

  it('keeps exact visible text without romanization or action controls', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p><ruby>\u8336<rt>cha</rt></ruby>\u3002<span data-assistant-exclude>Ask Assistant</span></p>'
    document.body.append(root)
    expect(select(root)).toBe('\u8336\u3002')
  })

  it('never offers selected-text help for a protected unaided question', () => {
    const root = document.createElement('main')
    root.innerHTML = '<div data-assistant-protected="true"><p>\u8336</p></div><p>Afterward</p>'
    document.body.append(root)
    expect(select(root)).toBeUndefined()
    expect(select(root, root.querySelector('p')!)).toBeUndefined()
  })

  it('refuses drafts, annotated pinyin and oversized selections', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p contenteditable="true">Draft</p><ruby>\u8336<rt>cha</rt></ruby>'
    document.body.append(root)
    expect(select(root, root.querySelector('p')!)).toBeUndefined()
    expect(select(root, root.querySelector('rt')!)).toBeUndefined()
    root.textContent = 'x'.repeat(8001)
    expect(select(root)).toBeUndefined()
  })

  it('does not assign a speech locale to mixed or unsupported text', () => {
    expect(snippetLocale('\u6211\u60f3\u559d\u8336\u3002')).toBe('zh-Hans')
    expect(snippetLocale('I would like tea.')).toBe('en-US')
    expect(snippetLocale('\u8336 means tea')).toBeUndefined()
    expect(snippetLocale('\u304a\u8336')).toBeUndefined()
  })
})
