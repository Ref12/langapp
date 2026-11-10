import { describe, expect, it } from 'vitest'
import { kanaInput, pinyinInput, selfMarkedInput } from './reading-input'

describe('the Hint of the older reading drill, by pack', () => {
  it('Chinese: the letters without tones, labelled as before', () => {
    expect(pinyinInput.hint?.label).toBe('Letters only:')
    expect(pinyinInput.hint?.of('nǐ hǎo')).toBe('ni hao')
    expect(pinyinInput.hint?.of('lǜ')).toBe('lu')
  })
  it('Japanese: the first kana and an ellipsis, dakuten kept', () => {
    expect(kanaInput.hint?.label).toBe('Starts with:')
    expect(kanaInput.hint?.of('べんきょう')).toBe('べ…')
    expect(kanaInput.hint?.of('がっこう')).toBe('が…')
  })
  it('Korean: no hint, so no button', () => {
    expect(selfMarkedInput.hint).toBeUndefined()
  })
})
