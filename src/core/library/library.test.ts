import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'
import { db, initializeWorkspace, LearningDatabase, profileDatabaseName } from '../database'
import { saveAIConnection } from '../assistant/store'
import { requestStructuredJSON } from '../ai/structured'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { createProfile, exportActiveProfile, restoreActiveProfile } from '../profiles/store'
import { parseProfileYaml } from '../profiles/codec'
import { resetProfileStorage } from '../../test/profile-storage'
import { bookSchema, MAX_PASSAGE_LENGTH, translationText } from './contracts'
import { importBookText, moveBookReading, removeBook, saveImportedBook, splitBookPassages } from './store'
import { translateBook, validateBookTranslation } from './translation'

vi.mock('../ai/structured', () => ({ requestStructuredJSON: vi.fn() }))
const completion = vi.mocked(requestStructuredJSON)
const translated = { blocks: [[{ text: '\u4f60\u597d', pinyin: 'ni hao', meaning: 'hello', trailing: '\u3002' }]] }

beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  completion.mockReset()
  completion.mockResolvedValue(translated)
})
afterEach(() => vi.restoreAllMocks())

async function connect() {
  await saveAIConnection({
    baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test-model',
    nativeTools: false, structuredOutput: true, storageAcknowledged: true,
  })
}

async function twoPassages() {
  return saveImportedBook({
    title: 'A book', author: 'An author', sourceType: 'epub',
    chapters: [{ title: 'One', content: 'Hello. '.repeat(300) }],
  })
}

describe('profile-local library books', () => {
  it('splits large chapters without losing prose and stays within the request bound', () => {
    const source = `${'A sentence. '.repeat(400)}\n\n${'Long'.repeat(900)}\n\nThe end.`
    const passages = splitBookPassages(source)
    expect(passages.length).toBeGreaterThan(2)
    expect(passages.every(text => text.length > 0 && text.length <= MAX_PASSAGE_LENGTH)).toBe(true)
    expect(passages.join('').replace(/\s/g, '')).toBe(source.replace(/\s/g, ''))
    const unicode = `${'a'.repeat(MAX_PASSAGE_LENGTH - 1)}\u{1f600}b`
    expect(splitBookPassages(unicode).join('')).toBe(unicode)
    expect(splitBookPassages(unicode)[0]).toHaveLength(MAX_PASSAGE_LENGTH - 1)
  })

  it('stores all chapters, resumes reading after reopening, and awards no vocabulary evidence', async () => {
    const id = await importBookText('My book', '# First\nHello.\n# Second\nGoodbye.')
    expect(await db.libraryBooks.get(id)).toMatchObject({ title: 'My book', chapters: ['First', 'Second'], passage: 0, completed: [] })
    await moveBookReading(id, 0, 1, true)
    db.close()
    await db.open()
    expect(await db.libraryBooks.get(id)).toMatchObject({ passage: 1, completed: [0] })
    expect(await db.words.count()).toBe(0)
    expect(await db.knowledge.count()).toBe(0)
    await expect(moveBookReading(id, 0, 1)).rejects.toThrow('another tab')
    await expect(moveBookReading(id, 1, 2)).rejects.toThrow('not available')
    await removeBook(id)
    expect(await db.libraryBooks.count()).toBe(0)
  })

  it('rejects blank imports and invalid chapter/reading relationships', async () => {
    await expect(importBookText('Blank', '  ')).rejects.toThrow('title and some text')
    const id = await twoPassages()
    const book = (await db.libraryBooks.get(id))!
    expect(bookSchema.safeParse({ ...book, passage: book.passages.length }).success).toBe(false)
    expect(bookSchema.safeParse({ ...book, completed: [0, 0] }).success).toBe(false)
    expect(bookSchema.safeParse({ ...book, chapters: [...book.chapters, 'Missing'] }).success).toBe(false)
  })

  it('preserves books, bookmarks and cached translations through JSON, YAML and profile cloning', async () => {
    await connect()
    const id = await twoPassages()
    await translateBook(id, [0], new AbortController().signal)
    await moveBookReading(id, 0, 1, true)
    const original = (await db.libraryBooks.get(id))!
    const json = await exportWorkspaceBackup()
    const yaml = await exportActiveProfile()
    expect(parseProfileYaml(yaml).library).toEqual([original])
    await removeBook(id)
    await restoreBackup(json)
    const restored = (await db.libraryBooks.get(id))!
    expect(restored).toEqual({ ...original, revision: restored.revision })
    expect(restored.revision).not.toBe(original.revision)
    await removeBook(id)
    await restoreActiveProfile(yaml)
    const profile = await createProfile('With books', true)
    const clone = new LearningDatabase(profileDatabaseName(profile.id))
    try {
      const cloned = (await clone.libraryBooks.get(id))!
      expect(cloned).toEqual({ ...original, revision: cloned.revision })
      await clone.libraryBooks.delete(id)
      expect(await db.libraryBooks.get(id)).toBeDefined()
    } finally { await clone.delete() }
  })

  it('restores pre-library snapshots without retaining unrelated current books', async () => {
    const json = JSON.parse(await exportWorkspaceBackup())
    json.version = 4
    delete json.library
    await twoPassages()
    await restoreBackup(JSON.stringify(json))
    expect(await db.libraryBooks.count()).toBe(0)
    const yaml = parse(await exportActiveProfile())
    yaml.version = 3
    delete yaml.library
    await twoPassages()
    await restoreActiveProfile(stringify(yaml))
    expect(await db.libraryBooks.count()).toBe(0)
  })

  it('rejects corrupt library snapshots atomically', async () => {
    const id = await twoPassages()
    const original = await db.libraryBooks.get(id)
    const json = JSON.parse(await exportWorkspaceBackup())
    json.library[0].passage = 50000
    await expect(restoreBackup(JSON.stringify(json))).rejects.toThrow()
    expect(await db.libraryBooks.get(id)).toEqual(original)
  })
})

describe('bounded cached book translation', () => {
  it('requires explicit AI configuration and leaves imports local', async () => {
    const id = await twoPassages()
    expect(completion).not.toHaveBeenCalled()
    await expect(translateBook(id, [0], new AbortController().signal)).rejects.toThrow('Settings')
    expect(completion).not.toHaveBeenCalled()
  })

  it('uses the configured provider, persists translation, and never retranslates cached passages', async () => {
    await connect()
    const id = await twoPassages()
    const before = (await db.libraryBooks.get(id))!
    await translateBook(id, [0], new AbortController().signal)
    expect(completion).toHaveBeenCalledTimes(1)
    expect(completion.mock.calls[0][0]).toMatchObject({ model: 'test-model', structuredOutput: true })
    expect(JSON.parse(completion.mock.calls[0][1].user)).toEqual({ paragraphs: [before.passages[0].source] })
    await translateBook(id, [0], new AbortController().signal)
    expect(completion).toHaveBeenCalledTimes(1)
    const after = (await db.libraryBooks.get(id))!
    expect(translationText(after.passages[0].translation!)).toBe('\u4f60\u597d\u3002')
    expect(after.completed).toEqual([])
    expect(after.passages[1].translation).toBeUndefined()
  })

  it('keeps completed chunks when cancelled and resumes only missing ones', async () => {
    await connect()
    const id = await twoPassages()
    const positions = (await db.libraryBooks.get(id))!.passages.map((_, index) => index)
    const abort = new AbortController()
    await expect(translateBook(id, positions, abort.signal, completed => { if (completed === 1) abort.abort() })).rejects.toThrow()
    expect(completion).toHaveBeenCalledTimes(1)
    expect((await db.libraryBooks.get(id))!.passages[0].translation).toBeDefined()
    await translateBook(id, positions, new AbortController().signal)
    expect(completion).toHaveBeenCalledTimes(positions.length)
    expect((await db.libraryBooks.get(id))!.passages.every(passage => passage.translation)).toBe(true)
  })

  it('does not save invalid responses and preserves already translated passages on failure', async () => {
    await connect()
    const id = await twoPassages()
    completion.mockResolvedValueOnce(translated).mockResolvedValueOnce({ blocks: [] })
    await expect(translateBook(id, [0, 1], new AbortController().signal)).rejects.toThrow('invalid or incomplete')
    const book = (await db.libraryBooks.get(id))!
    expect(book.passages[0].translation).toBeDefined()
    expect(book.passages[1].translation).toBeUndefined()
    expect(() => validateBookTranslation(translated, 'One.\n\nTwo.')).toThrow()
    expect(() => validateBookTranslation({ blocks: [[{ ...translated.blocks[0][0], trailing: '<script>' }]] }, 'One.')).toThrow()
  })

  it('keeps a newer reading place when a translation finishes', async () => {
    await connect()
    const id = await twoPassages()
    completion.mockImplementationOnce(async () => { await moveBookReading(id, 0, 1, true); return translated })
    await translateBook(id, [0], new AbortController().signal)
    expect(await db.libraryBooks.get(id)).toMatchObject({ passage: 1, completed: [0] })
  })

  it.each(['delete', 'restore', 'connection', 'cancel'])('rejects a stale %s result without recreating or corrupting data', async action => {
    await connect()
    const id = await twoPassages()
    const yaml = await exportActiveProfile()
    const abort = new AbortController()
    completion.mockImplementationOnce(async () => {
      if (action === 'delete') await removeBook(id)
      if (action === 'restore') await restoreActiveProfile(yaml)
      if (action === 'connection') await connect()
      if (action === 'cancel') abort.abort()
      return translated
    })
    await expect(translateBook(id, [0], abort.signal)).rejects.toThrow()
    expect((await db.libraryBooks.get(id))?.passages[0].translation).toBeUndefined()
  })
})
