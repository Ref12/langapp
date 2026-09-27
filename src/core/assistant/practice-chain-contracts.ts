import { z } from 'zod'

export const MAX_PRACTICE_CHUNKS = 80
export const MAX_PRACTICE_TEXT_LENGTH = 3000

export type PracticeDirection = 'forward' | 'backward'
export type PracticePlaylistItem = { kind: 'chain'; step: number } | { kind: 'selection'; start: number; end: number }

export interface PracticeUnit {
  text: string
  pinyin: string
}

export interface PracticePlan {
  units: PracticeUnit[]
  ends: number[]
  warnings: string[]
  items?: PracticePlaylistItem[]
}

export interface PracticePart {
  text: string
  pinyin: string
  start: number
  end: number
}

export interface PracticeTrack {
  item: PracticePlaylistItem
  text: string
  pinyin: string
  parts: (PracticePart & { added: boolean })[]
}

export function hasPracticeSpeech(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

// Offsets count code points, but must not detach combining marks or emoji joins.
export function isPracticeBoundary(units: readonly string[], offset: number): boolean {
  if (!Number.isInteger(offset) || offset <= 0 || offset > units.length) return false
  if (offset === units.length) return true
  const before = units[offset - 1]
  const after = units[offset]
  if (/^[\p{M}\p{Emoji_Modifier}\u200d\u{e0020}-\u{e007f}]$/u.test(after) || before === '\u200d') return false
  if (before === '\r' && after === '\n') return false
  if (/\p{Regional_Indicator}/u.test(before) && /\p{Regional_Indicator}/u.test(after)) {
    let preceding = 0
    for (let i = offset - 1; i >= 0 && /\p{Regional_Indicator}/u.test(units[i]); i--) preceding++
    if (preceding % 2 === 1) return false
  }
  return true
}

export function isPracticeSelection(units: readonly string[], start: number, end: number): boolean {
  return Number.isInteger(start) && start >= 0 && start < end
    && (start === 0 || isPracticeBoundary(units, start))
    && isPracticeBoundary(units, end) && hasPracticeSpeech(units.slice(start, end).join(''))
}

// Step identities describe chain lengths, not source chunk offsets.
export function reconcilePracticeItems(
  items: readonly PracticePlaylistItem[] | undefined, stepCount: number,
): PracticePlaylistItem[] | undefined {
  if (items === undefined) return undefined
  const retained = items.filter(item => item.kind === 'selection' || item.step < stepCount).map(item => ({ ...item }))
  const present = new Set(retained.flatMap(item => item.kind === 'chain' ? [item.step] : []))
  const missing: PracticePlaylistItem[] = Array.from({ length: stepCount }, (_, step) => ({ kind: 'chain' as const, step }))
    .filter(item => !present.has(item.step))
  let insertion = 0
  retained.forEach((item, index) => { if (item.kind === 'chain') insertion = index + 1 })
  retained.splice(insertion, 0, ...missing)
  if (retained.length > MAX_PRACTICE_CHUNKS) throw new Error(`At most ${MAX_PRACTICE_CHUNKS} practice playlist items are allowed.`)
  return retained
}

const practicePlaylistItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chain'), step: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('selection'), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict(),
])

export const practiceChainSchema = z.object({
  text: z.string().min(1).max(MAX_PRACTICE_TEXT_LENGTH),
  ends: z.array(z.number().int().positive()).min(1).max(MAX_PRACTICE_CHUNKS),
  items: z.array(practicePlaylistItemSchema).min(1).max(MAX_PRACTICE_CHUNKS).optional(),
}).strict().superRefine(({ text, ends, items }, ctx) => {
  if (text.length > MAX_PRACTICE_TEXT_LENGTH) return
  const units = Array.from(text)
  if (units.some(unit => /^[\ud800-\udfff]$/u.test(unit))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Practice text contains an unpaired Unicode surrogate.' })
  }
  let start = 0
  ends.forEach((end, index) => {
    if (end <= start || end > units.length || !isPracticeBoundary(units, end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends', index],
        message: 'Chunk ends must increase and fall on safe Unicode code-point boundaries.',
      })
    } else if (!hasPracticeSpeech(units.slice(start, end).join(''))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends', index],
        message: 'Each chunk must contain speech text, not only punctuation, symbols or spaces.',
      })
    }
    start = end
  })
  if (ends[ends.length - 1] !== units.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ends'],
      message: 'The final chunk end must equal the exact Unicode code-point count.',
    })
  }
  if (items !== undefined) {
    const steps = new Set<number>()
    const selections = new Set<string>()
    items.forEach((item, index) => {
      let message: string | undefined
      if (item.kind === 'chain') {
        if (item.step >= ends.length || steps.has(item.step)) message = 'Each generated chain step must appear exactly once.'
        steps.add(item.step)
      } else {
        const key = `${item.start}:${item.end}`
        if (!isPracticeSelection(units, item.start, item.end)) message = 'Selections must contain speech text on safe Unicode code-point boundaries.'
        else if (selections.has(key)) message = 'Duplicate practice selections are not allowed.'
        selections.add(key)
      }
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index], message })
    })
    if (steps.size !== ends.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Each generated chain step must appear exactly once.' })
    }
  }
})
