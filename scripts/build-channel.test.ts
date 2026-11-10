// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildDefines, languageFromEnv } from './build-channel'

describe('build language', () => {
  it('defaults to zh and takes LANGAPP_LANGUAGE', () => {
    expect(languageFromEnv('lab', {})).toBe('zh')
    expect(languageFromEnv('lab', { LANGAPP_LANGUAGE: '' })).toBe('zh')
    expect(languageFromEnv('lab', { LANGAPP_LANGUAGE: 'ja' })).toBe('ja')
    expect(languageFromEnv('lab', { LANGAPP_LANGUAGE: 'ko' })).toBe('ko')
    expect(languageFromEnv('stable', { LANGAPP_LANGUAGE: 'zh' })).toBe('zh')
  })

  it('fails with a clear message for an unknown id, or a language but zh on Stable', () => {
    expect(() => languageFromEnv('lab', { LANGAPP_LANGUAGE: 'fr' })).toThrow(/"fr" is not a known language. Known ids: zh, ja, ko/)
    expect(() => languageFromEnv('stable', { LANGAPP_LANGUAGE: 'ja' })).toThrow(/Stable channel is Chinese only/)
    expect(() => buildDefines('stable', 'ko')).toThrow(/Chinese only/)
    expect(() => buildDefines('lab', 'xx' as never)).toThrow(/not a known language/)
  })

  it('defines the constant next to the channel', () => {
    expect(buildDefines('lab').__BUILD_LANGUAGE__).toBe('"zh"')
    expect(buildDefines('lab', 'ja')).toMatchObject({ __BUILD_CHANNEL__: '"lab"', __BUILD_LANGUAGE__: '"ja"' })
  })
})
