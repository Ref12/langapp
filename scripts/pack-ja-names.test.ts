import { describe, expect, it } from 'vitest'
import { shortTextRule } from './pack-ja-names.mjs'

describe('shortTextRule', () => {
  it('keeps the fixed written part of a pattern name and drops the placeholders', () => {
    const table: [string, string | null][] = [
      ['<noun> + です', 'です'], ['<noun> + は', 'は'], ['<verb> + てください', 'てください'], ['<noun> + の + <noun>', 'の'],
      ['<verb> + (ました / ませんでした)', 'ました / ませんでした'], ['<noun> + が欲しい', 'が欲しい'], ['<noun> + は？', 'は？'],
      ['ありがとう + ございます', 'ありがとうございます'], ['<sentence> + (ね / よ)', 'ね / よ'], ['(これ / それ / あれ)', 'これ / それ / あれ'],
      ['<noun> + と + <noun>', 'と'], ['<い-adjective stem> + すぎます', 'すぎます'], ['(午前 / 午後) + <number> + 時 + (<number> + 分)', null],
      ['<noun> + は + <noun> + より + <adjective>', null], ['<noun> + の + (後ろ / 前 / 隣) + に', null], ['<verb potential form>', null], ['<number> + <counter>', null],
    ]
    for (const [name, short] of table) expect(shortTextRule(name), name).toBe(short)
  })
})
