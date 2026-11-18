import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AnnotatedChinese } from './AnnotatedChinese'
import { ToneColourProvider } from './../ToneText'

afterEach(cleanup)
const css = readFileSync(join(process.cwd(), 'src', 'App.css'), 'utf8')

describe('Chinese text layout', () => {
  it('the stylesheet no longer makes the text a flex row of per-character items', () => {
    expect(css).not.toMatch(/answer-option > span:not\(\.answer-option-mark\) > \[lang="zh-Hans"\] \{[^}]*display: flex/)
    expect(css).toMatch(/\.zh-unit \{ white-space: nowrap; \}/)
  })

  it('with pinyin off the sentence is inline text and the mark shares a nowrap unit with the last word', () => {
    const { container } = render(<AnnotatedChinese text="她们都是同学。" readings={new Map()} pinyin={false} />)
    const root = container.querySelector('[lang]') as HTMLElement
    expect(root.style.display).toBe('')
    expect(root.textContent).toBe('她们都是同学。')
    expect(root.querySelector('ruby')).toBeNull()
    const unit = root.querySelector('.zh-unit') as HTMLElement
    expect(unit.textContent).toMatch(/学。$/)
    expect(unit.textContent!.length).toBeLessThanOrEqual(2)
  })

  it('a mark alone, and a mark after a mark, stay in one unit', () => {
    const { container } = render(<AnnotatedChinese text="你好吗？！" readings={new Map()} pinyin={false} />)
    const units = [...container.querySelectorAll('.zh-unit')]
    expect(units).toHaveLength(1)
    expect(units[0].textContent).toMatch(/吗？！$/)
  })

  it('with tone colours on and pinyin off, the whole word before the mark keeps its tone colours and shares one unit with the mark', () => {
    const readings = new Map([['她们', new Set(['tā men'])], ['都', new Set(['dōu'])], ['是', new Set(['shì'])], ['同学', new Set(['tóng xué'])]])
    const { container } = render(<ToneColourProvider on><AnnotatedChinese text="她们都是同学。" readings={readings} pinyin={false} /></ToneColourProvider>)
    const unit = container.querySelector('.zh-unit') as HTMLElement
    expect(unit.textContent).toBe('同学。')
    const toned = [...unit.querySelectorAll('.tone')].map(el => el.textContent)
    expect(toned).toEqual(['同', '学'])
    expect(container.querySelectorAll('.tone')).toHaveLength(7 - 1)
  })
})
