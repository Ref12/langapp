import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { resetProfileStorage } from '../../test/profile-storage'
import { addedLine } from './summary'
import { completeHandsfreeRun, createHandsfreeRun, discardHandsfreeRun, exampleFor, loadHandsfreeSettings, repeatHandsfreeRun, unfinishedHandsfreeRuns, updateHandsfreeRun } from './store'
import { handsfreeSettingsSchema, normalizeHandsfreeSettings } from './contracts'
import { generateScript } from './script'
import type { Catalog } from '../study/catalog'

beforeEach(async () => {
  localStorage.clear()
  await resetProfileStorage()
  await initializeWorkspace()
})

describe('Hands-free store: knowledge set', () => {
  it('adds a New items run to the knowledge set only when it is completed, and only once', async () => {
    const before = await db.knowledge.count()
    const id = await createHandsfreeRun({ kind: 'new', count: 3 })
    const run = (await db.handsfreeRuns.get(id))!
    expect(run.addOnComplete?.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(before)
    await updateHandsfreeRun(id, { status: 'active', started: true, position: 4 })
    expect(await db.knowledge.count()).toBe(before)
    const added = await completeHandsfreeRun(id, 10)
    expect(added.length).toBe(run.addOnComplete!.length)
    expect(await db.knowledge.count()).toBe(before + added.length)
    expect((await db.handsfreeRuns.get(id))).toMatchObject({ status: 'completed', addedRefs: added })
    // completing it again, or playing it again, adds nothing more
    expect(await completeHandsfreeRun(id, 10)).toEqual([])
    const again = await repeatHandsfreeRun(id)
    expect((await db.handsfreeRuns.get(again))!.addOnComplete).toBeUndefined()
    expect(await completeHandsfreeRun(again, 10)).toEqual([])
    expect(await db.knowledge.count()).toBe(before + added.length)
  })

  it('adds nothing for an abandoned or discarded run, nor for a review run', async () => {
    const before = await db.knowledge.count()
    const id = await createHandsfreeRun({ kind: 'new', count: 3 })
    await updateHandsfreeRun(id, { status: 'active', started: true, position: 2 })
    expect(unfinishedHandsfreeRuns(await db.handsfreeRuns.toArray()).map(run => run.id)).toEqual([id])
    await updateHandsfreeRun(id, { status: 'abandoned' })
    expect(unfinishedHandsfreeRuns(await db.handsfreeRuns.toArray())).toHaveLength(1)
    await discardHandsfreeRun(id)
    expect(unfinishedHandsfreeRuns(await db.handsfreeRuns.toArray())).toHaveLength(0)
    expect(await db.knowledge.count()).toBe(before)
  })

  it('words the finish line from what was added', () => {
    expect(addedLine([...Array.from({ length: 5 }, (_, at) => 'vocabulary:w' + at), 'grammar:g1'])).toBe('Added 5 words and 1 grammar pattern to your knowledge set')
    expect(addedLine(['vocabulary:w1'])).toBe('Added 1 word to your knowledge set')
    expect(addedLine(['grammar:a', 'grammar:b'])).toBe('Added 2 grammar patterns to your knowledge set')
    expect(addedLine([])).toBe('')
    expect(addedLine(undefined)).toBe('')
  })
})

describe('Hands-free settings migration', () => {
  it('maps the old Explain and introductions switches on to Full and off to Off, and ignores the grammar switch and the emphasis voice', () => {
    const voice = { voiceURI: 'x', name: 'X', lang: 'en-GB', localService: true }
    const on = handsfreeSettingsSchema.parse({ pause: 'short', repeats: 2, grammar: true, introductions: true, explain: true, emphasisVoice: voice })
    expect(on).toEqual({ pause: 'short', repeats: 2, itemWording: 'full', sectionIntros: 'full' })
    const off = handsfreeSettingsSchema.parse({ pause: 'normal', repeats: 3, grammar: false, introductions: false, explain: false })
    expect(off).toMatchObject({ itemWording: 'off', sectionIntros: 'off' })
    expect(off).not.toHaveProperty('grammar')
    // a run saved without them is played with Full, Full and Pauses only
    expect(normalizeHandsfreeSettings(handsfreeSettingsSchema.parse({ pause: 'normal', repeats: 3, grammar: true }))).toMatchObject({ itemWording: 'full', sectionIntros: 'full', emphasis: 'pauses' })
    // the new settings win over old ones
    expect(handsfreeSettingsSchema.parse({ pause: 'normal', repeats: 3, explain: false, itemWording: 'abridged' })).toMatchObject({ itemWording: 'abridged' })
  })

  it('reads stored old settings from the device, and a saved run with old booleans plays like the new Full or Off wording', async () => {
    localStorage.setItem('handsfree.settings', JSON.stringify({ pause: 'long', repeats: 4, grammar: false, introductions: false, explain: true, emphasisRate: 0.7 }))
    expect(loadHandsfreeSettings()).toMatchObject({ pause: 'long', repeats: 4, itemWording: 'full', sectionIntros: 'off', emphasisRate: 0.7 })
    const id = await createHandsfreeRun({ kind: 'new', count: 3 })
    const run = (await db.handsfreeRuns.get(id))!
    expect(run.settings).not.toHaveProperty('grammar')
    // an old run in the database still resumes: its booleans are read as the new choices
    await db.handsfreeRuns.update(id, { settings: { pause: 'short', repeats: 1, grammar: false, explain: false, introductions: true } as never })
    const old = (await db.handsfreeRuns.get(id))!.settings
    const words = [{ ref: 'vocabulary:w1', kind: 'vocabulary' as const, zh: '休息', en: 'rest' }]
    const said = (settings: typeof old) => generateScript(words, {}, settings, 1).segments.flatMap(segment => segment.kind === 'say' ? [segment.text] : [])
    expect(said(old)).toContain('rest')
    expect(said(old).some(text => text.startsWith('This is how you say'))).toBe(false)
    expect(said(old)[0]).toMatch(/^Introducing new words\./)
  })
})

describe('Hands-free usage example', () => {
  const unit = (ref: string) => ({ kind: 'vocabulary' as const, ref })
  const example = (id: string, word: string, translation: string) => ({ id, segments: [{ word }, { punctuation: '。' }], translation, grammar: [] })
  const catalog = { orderedGroups: [
    { band: '1', group: { id: 'g1', units: [unit('vocabulary:a')], examples: [example('e1', 'a', 'I like it very much indeed.'), example('e2', 'a', "It's a rest."), example('e3', 'b', 'Hi.')] } },
    { band: '1', group: { id: 'g2', units: [unit('vocabulary:b')], examples: [example('e4', 'a', 'Go.'), example('e5', 'b', 'Wow, hello there friend.'), example('e6', 'b', 'Hello friend.')] } },
  ] } as unknown as Catalog

  it('picks the shortest example that uses the word, preferring the word\'s own group, then any group; none when there is no example', () => {
    // a: its own group g1 has two, and the shorter wins even though g2 has a one-word one
    expect(exampleFor(catalog, 'vocabulary:a')).toEqual({ example: "It's a rest." })
    // b: its own group g2 first; the shortest of its examples
    expect(exampleFor(catalog, 'vocabulary:b')).toEqual({ example: 'Hello friend.' })
    // c is in no group's units but used in another group's example: any group
    const elsewhere = { orderedGroups: [{ band: '1', group: { id: 'g', units: [unit('vocabulary:z')], examples: [example('e', 'c', 'See you.'), example('f', 'c', 'See you later, then.')] } }] } as unknown as Catalog
    expect(exampleFor(elsewhere, 'vocabulary:c')).toEqual({ example: 'See you.' })
    expect(exampleFor(catalog, 'vocabulary:nothing')).toEqual({})
    // a blank translation is no example
    expect(exampleFor({ orderedGroups: [{ band: '1', group: { id: 'g', units: [], examples: [example('e', 'a', '  ')] } }] } as unknown as Catalog, 'vocabulary:a')).toEqual({})
  })
})
