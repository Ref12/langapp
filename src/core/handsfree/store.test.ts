import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { resetProfileStorage } from '../../test/profile-storage'
import { addedLine } from './summary'
import { buildRunScript, exampleFor, loadHandsfreeSettings } from './store'
import { createDrillSet, discardDrillSet, ensureHandsfree, finishHandsfree, handsfreeStopped, newHandsfreeActivity, recordDrillResult, restartHandsfree, resumeRoute, unfinishedSets, updateHandsfree } from '../drills/store'
import { introduceLessonItems, startNewSession } from '../study/knowledge'
import { DEFAULT_HANDSFREE_SETTINGS, handsfreeSettingsSchema, normalizeHandsfreeSettings } from './contracts'
import { generateScript } from './script'
import type { Catalog } from '../study/catalog'
import { storageNames } from '../storage-names'

beforeEach(async () => {
  localStorage.clear()
  await resetProfileStorage()
  await initializeWorkspace()
})

const shortcut = (count = 3) => createDrillSet({ kind: 'new', count }, Date.now(), { handsfree: newHandsfreeActivity() })

describe('Hands-free as a practice-set activity: knowledge set', () => {
  it('adds a New items set to the knowledge set only when its Hands-free activity ends, and only once', async () => {
    const before = await db.knowledge.count()
    const id = await shortcut()
    const set = (await db.drillSets.get(id))!
    expect(set).toMatchObject({ shortcut: 'handsfree', status: 'active', handsfree: { started: false, done: false } })
    expect(set.addOnFinish?.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(before)
    await updateHandsfree(id, { started: true, position: 4 })
    expect(await db.knowledge.count()).toBe(before)
    const added = await finishHandsfree(id, 10)
    expect(added.length).toBe(set.addOnFinish!.length)
    expect(await db.knowledge.count()).toBe(before + added.length)
    expect(await db.drillSets.get(id)).toMatchObject({ status: 'completed', addedRefs: added, handsfree: { done: true, position: 10 } })
    // finishing it again, or playing it again, adds nothing more
    expect(await finishHandsfree(id, 10)).toEqual([])
    await restartHandsfree(id)
    expect((await db.drillSets.get(id))!.handsfree).toMatchObject({ started: false, position: 0, done: false })
    expect(await finishHandsfree(id, 10)).toEqual([])
    expect(await db.knowledge.count()).toBe(before + added.length)
  })

  it('introduces the items when ANY activity first finishes: a drill type finishing does it, a later Hands-free finish adds nothing', async () => {
    const before = await db.knowledge.count()
    const id = await createDrillSet({ kind: 'new', count: 3 })
    const set = (await db.drillSets.get(id))!
    expect(await db.knowledge.count()).toBe(before)
    // a partly done type adds nothing; completing every item of the type does
    await recordDrillResult(id, 'pinyin', set.refs[0], 'got', set.refs)
    if (set.refs.length > 1) expect(await db.knowledge.count()).toBe(before)
    for (const ref of set.refs.slice(1)) await recordDrillResult(id, 'pinyin', ref, 'got', set.refs)
    const added = (await db.drillSets.get(id))!.addedRefs!
    expect(added.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(before + added.length)
    await ensureHandsfree(id, loadHandsfreeSettings())
    expect(await finishHandsfree(id, 5)).toEqual([])
    // a regular set is not finished by its Hands-free activity
    expect((await db.drillSets.get(id))!.status).toBe('active')
    expect(await db.knowledge.count()).toBe(before + added.length)
  })

  it('a partly played Hands-free set stays unfinished and keeps its prompt; one never started is not listed; a discarded one adds nothing', async () => {
    const before = await db.knowledge.count()
    const id = await shortcut()
    expect(unfinishedSets(await db.drillSets.toArray())).toHaveLength(0)
    await updateHandsfree(id, { started: true, position: 2 })
    expect(unfinishedSets(await db.drillSets.toArray()).map(set => set.id)).toEqual([id])
    expect(handsfreeStopped((await db.drillSets.get(id))!)).toBe(true)
    expect(resumeRoute((await db.drillSets.get(id))!)).toBe(`practice/set/${id}/handsfree`)
    expect((await db.drillSets.get(id))!.handsfree!.position).toBe(2)
    await discardDrillSet(id)
    expect(unfinishedSets(await db.drillSets.toArray())).toHaveLength(0)
    expect(await db.knowledge.count()).toBe(before)
  })

  it('a lesson adds its items when finished, not when started', async () => {
    const connection = { id: 'assistant', model: 'm' } as never
    await db.aiConnections.put({ id: 'assistant', endpointId: 'default', name: 'x', baseUrl: 'http://x', apiKey: 'k', model: 'm' } as never)
    void connection
    const before = await db.knowledge.count()
    const id = await startNewSession()
    const session = (await db.exerciseSessions.get(id))!
    expect(session.addOnFinish?.length).toBeGreaterThan(0)
    expect(session.addedRefs).toBeUndefined()
    expect(await db.knowledge.count()).toBe(before)
    const added = await introduceLessonItems(id)
    expect(added.length).toBe(session.addOnFinish!.length)
    expect(await db.knowledge.count()).toBe(before + added.length)
    expect(await introduceLessonItems(id)).toEqual([])
  })
})

describe('Hands-free finish line', () => {
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
    localStorage.setItem(storageNames().local.handsfree, JSON.stringify({ pause: 'long', repeats: 4, grammar: false, introductions: false, explain: true, emphasisRate: 0.7 }))
    expect(loadHandsfreeSettings()).toMatchObject({ pause: 'long', repeats: 4, itemWording: 'full', sectionIntros: 'off', emphasisRate: 0.7 })
    const id = await shortcut()
    const set = (await db.drillSets.get(id))!
    expect(set.handsfree!.settings).not.toHaveProperty('grammar')
    // an old activity in the database still resumes: its booleans are read as the new choices
    await db.drillSets.update(id, { handsfree: { ...set.handsfree!, settings: { pause: 'short', repeats: 1, grammar: false, explain: false, introductions: true } as never } })
    const old = (await db.drillSets.get(id))!.handsfree!.settings
    const words = [{ ref: 'vocabulary:w1', kind: 'vocabulary' as const, zh: '休息', en: 'rest' }]
    const said = (settings: typeof old) => generateScript(words, {}, settings, 1).segments.flatMap(segment => segment.kind === 'say' ? [segment.text] : [])
    expect(said(old)).toContain('rest')
    expect(said(old).some(text => text.startsWith('This is how you say'))).toBe(false)
    expect(said(old)[0]).toMatch(/^Learn the words\./)
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

describe('Hands-free sentences come from the learner\'s own words', () => {
  it('a grammar item gets a fully known example, not one with a word outside the knowledge set', async () => {
    const run = { refs: ['grammar:zhe4-or-na4-shi4-np--identify'], settings: DEFAULT_HANDSFREE_SETTINGS, seed: 1 }
    const known = new Set(['vocabulary:na4--that', 'vocabulary:shi4--identity', 'vocabulary:ma5--question', 'vocabulary:niu2-nai3--milk', 'vocabulary:shu1--book'])
    const { script } = await buildRunScript(run, 'introduction', known)
    const spoken = script.segments.flatMap(segment => segment.kind === 'say' && segment.locale === 'zh-Hans' ? [segment.text] : [])
    expect(spoken.length).toBeGreaterThan(0)
    expect(spoken.some(text => text.includes('牛'))).toBe(false)
    expect(spoken[0]).toBe('这是书。')
  })
})
