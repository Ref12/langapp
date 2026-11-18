import { describe, expect, it } from 'vitest'
import { grammarAnchor } from './pattern'

const table: [string, string][] = [
  ['<clause one>，<optional subject> + 还 + <predicate>', '…，还…'],
  ['<plural topic> + 都 + <predicate>', '…都…'],
  ['半 + <noun>', '半…'],
  ['不要 + <verb>', '不要…'],
  ['<digit> + <next digit>', ''],
  ['<clause one>，<clause two>', ''],
  ['<person> + <age> + 岁', '…岁'],
  ['(让 / 叫) + 你 + <action>，你 + 就 + <same action>', '(让 / 叫)你…，你就…'],
  ['<noun> + です', '…です'],
  ['<verb> + てもいい', '…てもいい'],
  ['<verb> + ー + <noun>', '…ー…'],
  ['<verb or adjective> + 아요 / 어요 / 해요', '…아요 / 어요 / 해요'],
  ['<noun> + 이에요 / <noun> + 예요', '…이에요 / …예요'],
  ['<noun> + 을/를', '…을/를'],
  ['ありがとう + ございます', 'ありがとうございます'],
  ['とても + <adjective>', 'とても…'],
  ['<number> + <counter>', ''],
  ['열 + <number>', '열…'],
  ['<adjective> + 다고 생각하다', '…다고 생각하다'],
  ['<verb> + 게 되다', '…게 되다'],
]
describe('grammarAnchor', () => {
  it.each(table)('%s', (pattern, anchor) => { expect(grammarAnchor(pattern)).toBe(anchor) })
})
