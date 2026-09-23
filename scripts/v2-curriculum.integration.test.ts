// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { exampleSchema } from './v2-example-schema.mjs'

const usageExamples = (band: string) => exampleSchema.array().parse(parse(readFileSync(
  new URL(`../curriculum/v2/chinese/hsk-${band}/examples.yaml`, import.meta.url), 'utf8')))
const wordLabels = (examples: ReturnType<typeof usageExamples>, id: string) =>
  examples.find(example => example.id === id)?.segments
    .flatMap(segment => 'word' in segment ? [segment.word] : [])

describe('reviewed Chinese v2 curriculum senses', () => {
  it('keeps resultative 成 separate from the fraction sense in reviewed examples', () => {
    const examples = usageExamples('6')
    for (const id of ['hsk6-b3-restore-room', 'hsk6-b3-rivers-converge', 'hsk6-b4-verbal-agreement']) {
      expect(wordLabels(examples, id), id).toContain('cheng2--become')
      expect(wordLabels(examples, id), id).not.toContain('cheng2--tenth')
    }
    expect(wordLabels(examples, 'hsk6-b1-tenths')).toContain('cheng2--tenth')
    expect(wordLabels(examples, 'hsk6-b1-tenths')).not.toContain('cheng2--become')
  }, 30000)

  it('preserves reviewed classifier, rice, night and literal contrasting senses', () => {
    const examples = new Map(['4', '6'].map(band => [band, usageExamples(band)]))
    const cases = [
      ['4', 'hsk4-use-zeng1-jia1-increase', 'men2--subjects', 'men2--door'],
      ['6', 'hsk6-b1-conflicting-times', 'men2--subjects', 'men2--door'],
      ['6', 'hsk6-b1-pass-down-craft', 'men2--subjects', 'men2--door'],
      ['6', 'hsk6-b3-drifting-life', 'men2--subjects', 'men2--door'],
      ['6', 'hsk6-b1-rush-into-room', 'men2--door', 'men2--subjects'],
      ['6', 'hsk6-b4-counting-rice', 'mi3--rice', 'mi3--meter'],
      ['6', 'hsk6-b7-three-kinds', 'mi3--rice', 'mi3--meter'],
      ['6', 'hsk6-b1-multiplication', 'mi3--meter', 'mi3--rice'],
      ['6', 'hsk6-b7-inconvenient-room', 'wan3--evening', 'wan3--late'],
      ['6', 'hsk6-b7-my-wife', 'wan3--late', 'wan3--evening'],
    ]
    for (const [band, id, intended, incorrect] of cases) {
      expect(wordLabels(examples.get(band)!, id), id).toContain(intended)
      expect(wordLabels(examples.get(band)!, id), id).not.toContain(incorrect)
    }
  }, 30000)

  it('does not treat exclusive focus or only-have as conditional only-if', () => {
    const examples = new Map(['3', '4', '5', '6'].map(band => [band, usageExamples(band)]))
    const cases = [
      ['4', 'hsk4-use-zhi1-zhong1-within', 'jiu4--exactly'],
      ['5', 'hsk5-v3-092', 'you3--reach-degree'],
      ['5', 'hsk5-v3-165', 'you3--reach-degree'],
      ['5', 'hsk5-v3-337', 'jiu4--exactly'],
      ['5', 'hsk5-v5-308', 'you3--have'],
      ['6', 'hsk6-b3-introduction-page', 'you3--have'],
    ]
    for (const [band, id, intended] of cases) {
      expect(wordLabels(examples.get(band)!, id), id).toContain(intended)
      expect(wordLabels(examples.get(band)!, id), id).not.toContain('zhi3-you3--only-if')
    }
    expect(wordLabels(examples.get('3')!, 'vocabd-only-if-early')).toContain('zhi3-you3--only-if')
    expect(wordLabels(examples.get('5')!, 'hsk5-v4-316')).toContain('zhi3-you3--only-if')
  }, 30000)
})
