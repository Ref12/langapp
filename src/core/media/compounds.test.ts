import { describe, expect, it } from 'vitest'
import type { WovenToken } from './contracts'
import { mergeKnownWords, splitTranslation } from './compounds'

const tok = (text: string, trailing = ''): WovenToken => ({ text, pinyin: 'x', meaning: '', trailing })
const known = (text: string) => ['怎么', '喜欢', '导致', '知道', '父亲', '妻子', '应该', '竟然', '知道了'].includes(text)

describe('mergeKnownWords', () => {
  it.each([['怎', '么'], ['喜', '欢'], ['致', '导'], ['知', '道'], ['父', '亲'], ['妻', '子'], ['应', '该'], ['竟', '然']])('joins %s with its neighbour into a curriculum word', (a, b) => {
    const pair = a === '致' ? [tok('导'), tok('致')] : [tok(a), tok(b)]
    const result = mergeKnownWords([tok('他'), ...pair, tok('呢', '。')], known)
    expect(result.merged).toBe(1)
    expect(result.items.map(item => item.text)).toEqual(['他', pair[0].text + pair[1].text, '呢'])
  })
  it('keeps the trailing punctuation of the last piece and never merges across punctuation or non-word pairs', () => {
    expect(mergeKnownWords([tok('怎'), tok('么', '？')], known).items).toMatchObject([{ text: '怎么', trailing: '？' }])
    expect(mergeKnownWords([tok('怎', '，'), tok('么')], known).merged).toBe(0)
    expect(mergeKnownWords([tok('我'), tok('你')], known).merged).toBe(0)
  })
  it('does not touch words the model already kept whole', () => {
    expect(mergeKnownWords([tok('喜欢'), tok('他')], known).merged).toBe(0)
  })
})

describe('splitTranslation', () => {
  const lines = ['我本不愿，', '是你苦苦相求，', '我才勉强同意', '让你入府']
  const english = 'I never wanted to, but you begged and begged me, so I only reluctantly agreed to let you into the mansion.'
  it('spreads a four-line sentence over its lines, every line non-empty and nothing lost', () => {
    const parts = splitTranslation(english, lines)
    expect(parts).toHaveLength(4)
    expect(parts.every(Boolean)).toBe(true)
    expect(parts.join(' ')).toBe(english)
  })
  it('prefers clause boundaries near the proportional cut', () => {
    const parts = splitTranslation('I never wanted to, but you begged me, so I agreed', ['我本不愿，', '是你苦苦相求，', '我才同意'])
    expect(parts[0]).toBe('I never wanted to,')
    expect(parts[1]).toBe('but you begged me,')
  })
  it('gives each line a word while words last', () => {
    expect(splitTranslation('Yes', ['好', '的']).join('|')).toBe('Yes|')
    expect(splitTranslation('Go now', ['好', '的', '吧']).filter(Boolean)).toHaveLength(2)
  })
})
