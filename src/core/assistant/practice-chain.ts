import { pinyin, segment } from 'pinyin-pro'
import {
  hasPracticeSpeech,
  isPracticeBoundary,
  isPracticeSelection,
  MAX_PRACTICE_CHUNKS,
  MAX_PRACTICE_TEXT_LENGTH,
  practiceChainSchema,
  reconcilePracticeItems,
  type PracticeDirection,
  type PracticePart,
  type PracticePlan,
  type PracticePlaylistItem,
  type PracticeTrack,
  type PracticeUnit,
} from './practice-chain-contracts'

export { MAX_PRACTICE_CHUNKS } from './practice-chain-contracts'
export type { PracticeDirection, PracticePart, PracticePlan, PracticePlaylistItem, PracticeTrack, PracticeUnit } from './practice-chain-contracts'

const han = /\p{Script=Han}/u
const letterOrNumber = /[\p{L}\p{N}]/u
const openingPunctuation = /^[“‘「『（《〈【〔［｛([{]$/u
const romanizationSeparator = /^[\p{P}\p{Z}\p{S}\s]$/u

type Reading = { origin: string; pinyin: string; isZh: boolean; polyphonic: string[] }
type WordSegmenter = new (locale: string, options: { granularity: 'word' }) => {
  segment(text: string): Iterable<{ segment: string }>
}

function assertPlan(plan: PracticePlan): string {
  if (!Array.isArray(plan.units) || !plan.units.every(unit =>
    typeof unit.text === 'string' && Array.from(unit.text).length === 1 && typeof unit.pinyin === 'string',
  ) || !Array.isArray(plan.warnings) || !plan.warnings.every(warning => typeof warning === 'string')) {
    throw new Error('Invalid practice plan: every unit must contain exactly one Unicode code point and its reading.')
  }
  const text = plan.units.map(unit => unit.text).join('')
  practiceChainSchema.parse({ text, ends: plan.ends, items: plan.items })
  return text
}

function readingBase(reading: string): string | undefined {
  const normalized = reading.toLowerCase().replace(/u:|v/g, 'ü').normalize('NFD')
  const tones = normalized.match(/[\u0300\u0301\u0304\u030c0-5]/g) ?? []
  if (tones.length > 1) return undefined
  const base = normalized.replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC')
  if (!/^[a-züê]+[0-5]?$/.test(base)) return undefined
  return base.replace(/[0-5]$/, '')
}

type Alignment = { previous?: Alignment; reading: string; ways: number }

// Match dictionary syllables against the whole supplied transcription. Word-joined
// pinyin is supported only when there is exactly one complete alignment.
function alignProvided(units: string[], readings: Reading[], romanization: string): string[] | undefined {
  if (!romanization.trim() || romanization.length > 24000) return undefined
  const source = romanization.normalize('NFC')
  function skipSeparators(position: number): number {
    while (position < source.length) {
      const character = String.fromCodePoint(source.codePointAt(position)!)
      // A colon may be part of the conventional u: spelling, handled in a syllable.
      if (!romanizationSeparator.test(character)) break
      position += character.length
    }
    return position
  }
  let states = new Map<number, Alignment>([[0, { reading: '', ways: 1 }]])
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]
    const next = new Map<number, Alignment>()
    function add(position: number, previous: Alignment, reading: string) {
      const existing = next.get(position)
      if (existing) existing.ways = Math.min(2, existing.ways + previous.ways)
      else next.set(position, { previous, reading, ways: previous.ways })
    }
    for (const [position, state] of states) {
      if (han.test(unit)) {
        if (!readings[index]?.isZh) return undefined
        const bases = new Set([readings[index].pinyin, ...readings[index].polyphonic].map(readingBase))
        const start = skipSeparators(position)
        for (let length = 1; length <= 12 && start + length <= source.length; length++) {
          const syllable = source.slice(start, start + length)
          const base = readingBase(syllable)
          if (base && bases.has(base)) add(start + length, state, syllable)
        }
      } else if (letterOrNumber.test(unit) || /^\p{M}$/u.test(unit)) {
        const start = skipSeparators(position)
        if (source.slice(start, start + unit.length).toLowerCase() === unit.toLowerCase()) {
          add(start + unit.length, state, unit)
        }
      } else {
        add(position, state, unit)
      }
    }
    if (next.size === 0 || next.size > 64) return undefined
    states = next
  }
  const complete = [...states].filter(([position]) => skipSeparators(position) === source.length)
  if (complete.reduce((count, [, state]) => count + state.ways, 0) !== 1) return undefined
  const result: string[] = []
  let state: Alignment | undefined = complete[0][1]
  while (state.previous) {
    result.push(state.reading)
    state = state.previous
  }
  return result.reverse()
}

function suggestEnds(text: string, units: string[], warnings: string[]): number[] {
  let words: string[]
  try {
    const Segmenter = (Intl as typeof Intl & { Segmenter?: WordSegmenter }).Segmenter
    words = Segmenter
      ? Array.from(new Segmenter('zh-CN', { granularity: 'word' }).segment(text), item => item.segment)
      : segment(text).map(item => item.origin)
    if (words.join('') !== text) throw new Error('Segment text mismatch')
  } catch {
    words = [...units]
    warnings.push('Word segmentation was unavailable; chunks use simple adjacent-character groups. Review the boundaries.')
  }

  // Pair adjacent single Han suggestions, without absorbing an existing word or
  // crossing whitespace/punctuation. This also makes the dictionary fallback usable.
  const grouped: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (Array.from(word).length === 1 && han.test(word)
      && words[i + 1] && Array.from(words[i + 1]).length === 1 && han.test(words[i + 1])) {
      grouped.push(word + words[++i])
    } else if (/^[\p{Script=Latin}\p{N}\p{M}]+$/u.test(word)
      && grouped.length > 0 && /^[\p{Script=Latin}\p{N}\p{M}]+$/u.test(grouped[grouped.length - 1])) {
      grouped[grouped.length - 1] += word
    } else {
      grouped.push(word)
    }
  }

  const ends: number[] = []
  let position = 0
  let previousWordEnd: number | undefined
  for (const word of grouped) {
    const end = position + Array.from(word).length
    if (hasPracticeSpeech(word)) {
      if (previousWordEnd !== undefined) {
        let boundary = position
        for (let i = previousWordEnd; i < position; i++) {
          if (openingPunctuation.test(units[i])) {
            boundary = i
            break
          }
        }
        if (isPracticeBoundary(units, boundary)) ends.push(boundary)
      }
      previousWordEnd = end
    }
    position = end
  }
  ends.push(units.length)
  if (ends.length <= MAX_PRACTICE_CHUNKS) return ends
  // Keep evenly spaced existing boundaries: only merge suggestions, never cut words.
  const capped = Array.from({ length: MAX_PRACTICE_CHUNKS }, (_, index) =>
    ends[Math.ceil((index + 1) * ends.length / MAX_PRACTICE_CHUNKS) - 1],
  )
  warnings.push(`Suggestions were merged to the ${MAX_PRACTICE_CHUNKS}-chunk limit; no text was removed.`)
  return capped
}

export function createPracticePlan(text: string, romanization?: string): PracticePlan {
  // Match the existing 3000 UTF-16-code-unit phrase contract before dictionary work.
  const length = typeof text === 'string' && text.length <= MAX_PRACTICE_TEXT_LENGTH ? Array.from(text).length : 0
  practiceChainSchema.parse({ text, ends: [length] })
  const characters = Array.from(text)
  const warnings = ['Chunk boundaries are local word/short-group suggestions, not a linguistic analysis. Split or merge them as needed.']
  let readings: Reading[] = []
  try {
    readings = pinyin(text, { type: 'all', toneType: 'symbol', nonZh: 'spaced' })
    if (readings.length !== characters.length || readings.some((reading, index) => reading.origin !== characters[index])) {
      throw new Error('Reading alignment mismatch')
    }
  } catch {
    readings = []
    warnings.push('The local pinyin library could not safely align this phrase. Missing readings are shown as □.')
  }
  const provided = typeof romanization === 'string' ? alignProvided(characters, readings, romanization) : undefined
  if (romanization !== undefined && !provided) {
    warnings.push('The provided romanization could not be safely aligned; full-phrase local readings are used where available.')
  }
  if (!provided && characters.some(character => han.test(character))) {
    warnings.push('Pinyin was derived locally using the full phrase. Polyphones, names and tone changes may need review.')
  }
  const missing = new Set<string>()
  const units = characters.map((character, index): PracticeUnit => {
    if (!han.test(character)) return { text: character, pinyin: character }
    const reading = readings[index]
    const value = provided?.[index] ?? (reading?.isZh && readingBase(reading.pinyin) ? reading.pinyin : '')
    if (!value) missing.add(character)
    return { text: character, pinyin: value }
  })
  if (missing.size) {
    const examples = [...missing].slice(0, 12).join(' ')
    warnings.push(`No local pinyin reading is available for: ${examples}${missing.size > 12 ? ' …' : ''}. Missing readings are shown as □, not guessed.`)
  }
  if (/[\p{Script=Latin}\p{N}]/u.test(text)) {
    warnings.push('Latin text and numerals are kept as written, not converted to Mandarin readings.')
  }
  if (characters.some(character => letterOrNumber.test(character) && !/[\p{Script=Han}\p{Script=Latin}\p{N}]/u.test(character))) {
    warnings.push('Other scripts are kept as written; local Mandarin pinyin does not transliterate them.')
  }
  const plan = { units, ends: suggestEnds(text, characters, warnings), warnings }
  assertPlan(plan)
  return plan
}

function renderPinyin(units: PracticeUnit[]): string {
  let result = ''
  let previous: PracticeUnit | undefined
  for (const unit of units) {
    const value = han.test(unit.text) ? unit.pinyin || '□' : unit.pinyin
    if (previous && ((han.test(previous.text) && letterOrNumber.test(unit.text))
      || (letterOrNumber.test(previous.text) && han.test(unit.text)))) result += ' '
    result += value
    previous = unit
  }
  return result
}

function part(plan: PracticePlan, start: number, end: number): PracticePart {
  const units = plan.units.slice(start, end)
  return { text: units.map(unit => unit.text).join(''), pinyin: renderPinyin(units), start, end }
}

export function getPracticeChunks(plan: PracticePlan): PracticePart[] {
  assertPlan(plan)
  return plan.ends.map((end, index) => part(plan, index === 0 ? 0 : plan.ends[index - 1], end))
}

export function getPracticePart(plan: PracticePlan, start: number, end: number): PracticePart {
  assertPlan(plan)
  if (!isPracticeSelection(plan.units.map(unit => unit.text), start, end)) {
    throw new Error('Select speech text on safe Unicode code-point boundaries.')
  }
  return part(plan, start, end)
}

export function getPracticePlaylistItems(plan: PracticePlan): PracticePlaylistItem[] {
  assertPlan(plan)
  return plan.items?.map(item => ({ ...item })) ?? plan.ends.map((_, step) => ({ kind: 'chain', step }))
}

function withItems(plan: PracticePlan, items: PracticePlaylistItem[]): PracticePlan {
  const result = {
    units: plan.units.map(unit => ({ ...unit })), ends: [...plan.ends], warnings: [...plan.warnings],
    items: items.map(item => ({ ...item })),
  }
  assertPlan(result)
  return result
}

function assertItemIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error('Select an existing playlist item index.')
}

export function addPracticeSelection(plan: PracticePlan, start: number, end: number, index: number): PracticePlan {
  const items = getPracticePlaylistItems(plan)
  assertItemIndex(index, items.length + 1)
  getPracticePart(plan, start, end)
  items.splice(index, 0, { kind: 'selection', start, end })
  return withItems(plan, items)
}

export function removePracticeSelection(plan: PracticePlan, index: number): PracticePlan {
  const items = getPracticePlaylistItems(plan)
  assertItemIndex(index, items.length)
  if (items[index].kind !== 'selection') throw new Error('Generated chain steps cannot be removed.')
  items.splice(index, 1)
  return withItems(plan, items)
}

export function movePracticeItem(plan: PracticePlan, fromIndex: number, toIndex: number): PracticePlan {
  const items = getPracticePlaylistItems(plan)
  assertItemIndex(fromIndex, items.length)
  assertItemIndex(toIndex, items.length)
  items.splice(toIndex, 0, items.splice(fromIndex, 1)[0])
  return withItems(plan, items)
}

export function buildPracticeTracks(plan: PracticePlan, direction: PracticeDirection): PracticeTrack[] {
  if (direction !== 'forward' && direction !== 'backward') throw new Error('Unknown practice direction.')
  const chunks = getPracticeChunks(plan)
  return getPracticePlaylistItems(plan).map(item => {
    if (item.kind === 'selection') {
      const selected = part(plan, item.start, item.end)
      return { item, text: selected.text, pinyin: selected.pinyin, parts: [{ ...selected, added: true }] }
    }
    const index = item.step
    const selected = direction === 'forward' ? chunks.slice(0, index + 1) : chunks.slice(chunks.length - index - 1)
    const complete = part(plan, selected[0].start, selected[selected.length - 1].end)
    return {
      item,
      text: complete.text,
      pinyin: complete.pinyin,
      parts: selected.map((chunk, selectedIndex) => ({
        ...chunk,
        added: direction === 'forward' ? selectedIndex === selected.length - 1 : selectedIndex === 0,
      })),
    }
  })
}

export function applyPracticeEnds(plan: PracticePlan, ends: number[]): PracticePlan {
  const text = assertPlan(plan)
  const saved = practiceChainSchema.parse({ text, ends })
  const items = reconcilePracticeItems(plan.items, saved.ends.length)
  practiceChainSchema.parse({ ...saved, items })
  return {
    units: plan.units.map(unit => ({ ...unit })), ends: saved.ends, warnings: [...plan.warnings],
    ...(items === undefined ? {} : { items }),
  }
}

export function splitPracticeChunk(plan: PracticePlan, chunkIndex: number, unitOffset: number): PracticePlan {
  assertPlan(plan)
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= plan.ends.length) {
    throw new Error('Select an existing chunk to split.')
  }
  if (plan.ends.length >= MAX_PRACTICE_CHUNKS) throw new Error(`At most ${MAX_PRACTICE_CHUNKS} practice chunks are allowed.`)
  const start = chunkIndex === 0 ? 0 : plan.ends[chunkIndex - 1]
  if (!Number.isInteger(unitOffset) || unitOffset <= 0 || start + unitOffset >= plan.ends[chunkIndex]) {
    throw new Error('Choose an interior Unicode code-point offset relative to the selected chunk.')
  }
  const ends = [...plan.ends]
  ends.splice(chunkIndex, 0, start + unitOffset)
  return applyPracticeEnds(plan, ends)
}

export function mergePracticeChunks(plan: PracticePlan, boundaryIndex: number): PracticePlan {
  assertPlan(plan)
  if (!Number.isInteger(boundaryIndex) || boundaryIndex < 0 || boundaryIndex >= plan.ends.length - 1) {
    throw new Error('Select an existing boundary between two chunks to merge.')
  }
  const ends = [...plan.ends]
  ends.splice(boundaryIndex, 1)
  return applyPracticeEnds(plan, ends)
}
