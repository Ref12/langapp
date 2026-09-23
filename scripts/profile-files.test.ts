// @vitest-environment node
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from '../src/core/profiles/codec'
import { MAX_PROFILE_BYTES } from '../src/core/profiles/contracts'
import { createProfileTemplate } from '../src/core/profiles/template'
import { populatedProfile } from '../src/core/profiles/test-fixtures'
import { initializeProfileDirectory, listProfileFiles, profileLocalSettings, readProfileFile, saveProfileFile } from './profile-files'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename), link: vi.fn(actual.link), unlink: vi.fn(actual.unlink), chmod: vi.fn(actual.chmod) }
})
vi.mock('../src/core/profiles/codec', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/profiles/codec')>()
  return { ...actual, serializeProfileYaml: vi.fn(actual.serializeProfileYaml) }
})
let root: string
const settings = {
  aiConnection: {
    apiType: 'responses' as const, baseUrl: 'https://example.test/v1', apiKey: 'synthetic-ai-secret', model: 'model',
    nativeTools: true, structuredOutput: true, storageAcknowledged: true as const,
  },
  speechConnection: { provider: 'azure' as const, region: 'eastus', apiKey: 'synthetic-azure-secret', storageAcknowledged: true as const },
  defaultSpeechRate: 0.75 as const,
  speechVoices: { 'zh-Hans': { provider: 'edge' as const, voice: 'zh-CN-YunjianNeural' } },
}
function yaml(id = 'default', name = 'Default') { return serializeProfileYaml(createEmptyProfile({ id, name }, settings)) }
function file(name = 'default.yaml') { return join(root, 'data', name) }
beforeEach(async () => {
  root = join(process.cwd(), `.profile-files-test-${randomUUID()}`)
  await fs.mkdir(root)
})
afterEach(async () => {
  vi.clearAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})
async function legacy(value = JSON.stringify(settings)) {
  await fs.mkdir(join(root, 'settings'), { recursive: true })
  const path = join(root, 'settings', 'app.settings.jsonc')
  await fs.writeFile(path, value)
  return path
}
describe('safe named YAML profile files', () => {
  it('initializes only a secret-free template and preserves template edits', async () => {
    await initializeProfileDirectory(root)
    expect(await fs.readdir(join(root, 'data'))).toEqual(['profile.template.yaml'])
    expect(await fs.readFile(file('profile.template.yaml'), 'utf8')).toBe(createProfileTemplate())
    await fs.writeFile(file('profile.template.yaml'), '# my edited template\n')
    await initializeProfileDirectory(root)
    expect(await fs.readFile(file('profile.template.yaml'), 'utf8')).toBe('# my edited template\n')
    expect(await listProfileFiles(root)).toEqual({ profiles: [] })
  })
  it('migrates every setting/key from commented JSONC, verifies YAML, and removes only its legacy file', async () => {
    const source = await legacy('\uFEFF// migration fixture\n' + JSON.stringify(settings, null, 2).replace(/\n}$/, ',\n}'))
    await fs.writeFile(join(root, 'settings', 'keep.txt'), 'keep')
    await initializeProfileDirectory(root)
    const result = await readProfileFile(root, 'default')
    expect(result.snapshot.profile).toEqual({ id: 'default', name: 'default' })
    expect(profileLocalSettings(result.snapshot)).toEqual(settings)
    expect(result.yaml).toContain(settings.aiConnection.apiKey)
    expect(result.yaml).toContain(settings.speechConnection.apiKey)
    expect(result.snapshot.knowledge.words).toEqual([])
    expect(result.snapshot.conversations.threads).toEqual([])
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(join(root, 'settings', 'keep.txt'), 'utf8')).toBe('keep')
  })
  it.each(['{ invalid synthetic-secret', '{"aiConnection":{"apiKey":"synthetic-secret"}}', ' '.repeat(32 * 1024 + 1)])(
    'preserves invalid/oversized migration sources without leaking them (case %#)', async value => {
      const source = await legacy(value)
      await expect(initializeProfileDirectory(root)).rejects.not.toThrow('synthetic-secret')
      expect(await fs.readFile(source, 'utf8')).toBe(value)
      await expect(fs.lstat(file())).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )
  it('refuses a migration collision without reading, overwriting, or deleting either file', async () => {
    const source = await legacy()
    await fs.mkdir(join(root, 'data'))
    await fs.writeFile(file(), 'existing-invalid-synthetic-secret')
    await expect(initializeProfileDirectory(root)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('migration conflict') })
    expect(await fs.readFile(file(), 'utf8')).toBe('existing-invalid-synthetic-secret')
    expect(await fs.readFile(source, 'utf8')).toBe(JSON.stringify(settings))
  })
  it('preserves the migration source on atomic destination failure', async () => {
    const source = await legacy()
    vi.mocked(fs.link).mockRejectedValueOnce(new Error('synthetic-secret'))
    await expect(initializeProfileDirectory(root)).rejects.not.toThrow('synthetic-secret')
    expect(await fs.readFile(source, 'utf8')).toBe(JSON.stringify(settings))
    await expect(fs.lstat(file())).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readdir(join(root, 'data'))).toEqual([])
  })
  it('preserves the legacy source if a codec cannot finish preparing a validated snapshot', async () => {
    const source = await legacy()
    vi.mocked(serializeProfileYaml).mockImplementationOnce(() => { throw new Error('incomplete codec synthetic-secret') })
    await expect(initializeProfileDirectory(root)).rejects.toThrow('Could not initialize local profiles')
    expect(await fs.readFile(source, 'utf8')).toBe(JSON.stringify(settings))
    await expect(fs.lstat(file())).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readdir(join(root, 'data'))).toEqual([])
  })
  it('reports migration source cleanup failure rather than claiming successful migration', async () => {
    const source = await legacy()
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fs.unlink).mockImplementationOnce(path => original.unlink(path))
    vi.mocked(fs.unlink).mockImplementationOnce(path => original.unlink(path))
    vi.mocked(fs.unlink).mockRejectedValueOnce(new Error('synthetic-secret'))
    await expect(initializeProfileDirectory(root)).rejects.toThrow('Could not initialize')
    expect(await fs.readFile(source, 'utf8')).toBe(JSON.stringify(settings))
    expect(profileLocalSettings((await readProfileFile(root, 'default')).snapshot)).toEqual(settings)
  })
  it('stores exact UTF-8 YAML and returns opaque revisions, complete settings, progress and history', async () => {
    await initializeProfileDirectory(root)
    const id = randomUUID()
    const text = '# user comment\n' + yaml(id, '中文 workspace')
    const saved = await saveProfileFile(root, id, { yaml: text, expectedRevision: null })
    expect(saved).toEqual({ profile: { id, name: '中文 workspace' }, revision: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const read = await readProfileFile(root, id)
    expect(read.yaml).toBe(text)
    expect(read.revision).toBe(saved.revision)
    expect(profileLocalSettings(read.snapshot)).toEqual(settings)
    expect(await listProfileFiles(root)).toEqual({ profiles: [{ id, name: '中文 workspace', revision: saved.revision }] })
  })
  it('round-trips a complete synthetic learning workspace and conversation history without redacting credentials', async () => {
    await initializeProfileDirectory(root)
    const snapshot = populatedProfile()
    const text = serializeProfileYaml(snapshot)
    await saveProfileFile(root, snapshot.profile.id, { yaml: text, expectedRevision: null })
    const loaded = await readProfileFile(root, snapshot.profile.id)
    expect(loaded.snapshot).toEqual(snapshot)
    expect(await fs.readFile(file(), 'utf8')).toBe(text)
    expect(loaded.yaml).toContain('synthetic-ai-key')
    expect(loaded.yaml).toContain('synthetic-speech-key')
  })
  it('rejects mismatched metadata, invalid IDs, YAML aliases and malformed documents before writes', async () => {
    await initializeProfileDirectory(root)
    for (const id of ['../outside', 'DEFAULT', 'profile.template', 'a/b', randomUUID() + '.yaml', randomUUID().toUpperCase()]) {
      await expect(saveProfileFile(root, id, { yaml: yaml(), expectedRevision: null })).rejects.toMatchObject({ status: 400 })
    }
    for (const text of [yaml(randomUUID()), 'secret: [synthetic-secret', 'a: &a\n  b: *a', yaml() + '\n---\n{}']) {
      await expect(saveProfileFile(root, 'default', { yaml: text, expectedRevision: null })).rejects.toMatchObject({ status: 400 })
    }
    await expect(saveProfileFile(root, 'default', { yaml: ' '.repeat(MAX_PROFILE_BYTES + 1), expectedRevision: null })).rejects.toMatchObject({ status: 413 })
    expect(await fs.readdir(join(root, 'data'))).toEqual(['profile.template.yaml'])
  })
  it('preserves existing data on stale revisions and atomic rename failure', async () => {
    await initializeProfileDirectory(root)
    const text = yaml()
    const original = await saveProfileFile(root, 'default', { yaml: text, expectedRevision: null })
    for (const expectedRevision of [null, '0'.repeat(64)]) {
      await expect(saveProfileFile(root, 'default', { yaml: yaml('default', 'Changed'), expectedRevision })).rejects.toMatchObject({ status: 409 })
    }
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('simulated rename failure'))
    await expect(saveProfileFile(root, 'default', { yaml: yaml('default', 'Changed'), expectedRevision: original.revision })).rejects.toThrow()
    expect(await fs.readFile(file(), 'utf8')).toBe(text)
    expect((await fs.readdir(join(root, 'data'))).sort()).toEqual(['default.yaml', 'profile.template.yaml'])
    const saved = await saveProfileFile(root, 'default', { yaml: yaml('default', 'Changed'), expectedRevision: original.revision })
    expect(saved.revision).not.toBe(original.revision)
  })
  it('preserves existing private file permissions across atomic replacements', async () => {
    await initializeProfileDirectory(root)
    const original = await saveProfileFile(root, 'default', { yaml: yaml(), expectedRevision: null })
    await fs.chmod(file(), 0o600)
    const before = (await fs.stat(file())).mode & 0o777
    await saveProfileFile(root, 'default', { yaml: yaml('default', 'Changed'), expectedRevision: original.revision })
    expect((await fs.stat(file())).mode & 0o777).toBe(before)
  })
  it('serializes competing creates and overwrites: exactly one succeeds', async () => {
    await initializeProfileDirectory(root)
    const creates = await Promise.allSettled([1, 2, 3].map(n => saveProfileFile(root, 'default', { yaml: yaml('default', `Name ${n}`), expectedRevision: null })))
    expect(creates.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(creates.filter(result => result.status === 'rejected')).toHaveLength(2)
    const { revision } = await readProfileFile(root, 'default')
    const updates = await Promise.allSettled([4, 5, 6].map(n => saveProfileFile(root, 'default', { yaml: yaml('default', `Name ${n}`), expectedRevision: revision })))
    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(updates.filter(result => result.status === 'rejected')).toHaveLength(2)
    expect(parseProfileYaml(await fs.readFile(file(), 'utf8')).profile.name).toMatch(/^Name [456]$/)
  })
  it('uses a filesystem lock across independent server module instances', async () => {
    await initializeProfileDirectory(root)
    vi.resetModules()
    const secondServer = await import('./profile-files')
    const creates = await Promise.allSettled([
      saveProfileFile(root, 'default', { yaml: yaml('default', 'Server one'), expectedRevision: null }),
      secondServer.saveProfileFile(root, 'default', { yaml: yaml('default', 'Server two'), expectedRevision: null }),
    ])
    expect(creates.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(creates.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 409 } }])
    const { revision } = await readProfileFile(root, 'default')
    const updates = await Promise.allSettled([
      saveProfileFile(root, 'default', { yaml: yaml('default', 'Server one update'), expectedRevision: revision }),
      secondServer.saveProfileFile(root, 'default', { yaml: yaml('default', 'Server two update'), expectedRevision: revision }),
    ])
    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(updates.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 409 } }])
    const saved = await readProfileFile(root, 'default')
    expect(profileLocalSettings(saved.snapshot)).toEqual(settings)
    expect(saved.snapshot.profile.name).toMatch(/^Server (one|two) update$/)
  })
  it('rejects a cooperative cross-process lock and aborted writes without modifying good data', async () => {
    await initializeProfileDirectory(root)
    const saved = await saveProfileFile(root, 'default', { yaml: yaml(), expectedRevision: null })
    await fs.writeFile(file('.default.yaml.lock'), '')
    await expect(saveProfileFile(root, 'default', { yaml: yaml(), expectedRevision: saved.revision })).rejects.toMatchObject({ status: 409 })
    await fs.unlink(file('.default.yaml.lock'))
    const signal = AbortSignal.abort()
    await expect(saveProfileFile(root, 'default', { yaml: yaml(), expectedRevision: saved.revision }, signal)).rejects.toMatchObject({ status: 408 })
    expect((await readProfileFile(root, 'default')).revision).toBe(saved.revision)
  })
  it('reports malformed or nonregular entries explicitly instead of silently hiding or replacing them', async () => {
    await initializeProfileDirectory(root)
    await fs.writeFile(file(), 'invalid synthetic-secret')
    await expect(listProfileFiles(root)).rejects.toMatchObject({ status: 400 })
    expect(await fs.readFile(file(), 'utf8')).toBe('invalid synthetic-secret')
    await fs.unlink(file())
    await fs.mkdir(file())
    await expect(readProfileFile(root, 'default')).rejects.toMatchObject({ status: 400 })
    await fs.rm(file(), { recursive: true })
    await fs.writeFile(file('unsafe-name.yaml'), yaml())
    await expect(listProfileFiles(root)).rejects.toMatchObject({ status: 400 })
  })
  it('rejects invalid UTF-8 and oversized reads', async () => {
    await initializeProfileDirectory(root)
    await fs.writeFile(file(), Buffer.from([0xff, 0xfe]))
    await expect(readProfileFile(root, 'default')).rejects.toMatchObject({ status: 400 })
    await fs.writeFile(file(), ' '.repeat(MAX_PROFILE_BYTES + 1))
    await expect(readProfileFile(root, 'default')).rejects.toMatchObject({ status: 413 })
    await expect(saveProfileFile(root, 'default', { yaml: yaml(), expectedRevision: null })).rejects.toMatchObject({ status: 409 })
  })
  it('rejects oversized listings before reading any profile contents', async () => {
    await initializeProfileDirectory(root)
    const ids = Array.from({ length: 501 }, () => randomUUID())
    await Promise.all(ids.map(id => fs.writeFile(file(`${id}.yaml`), 'invalid profile contents')))
    await expect(listProfileFiles(root)).rejects.toMatchObject({ status: 413 })
  })
  it('does not commit when cancelled after staging but before the final revision check', async () => {
    await initializeProfileDirectory(root)
    const original = await saveProfileFile(root, 'default', { yaml: yaml(), expectedRevision: null })
    const controller = new AbortController()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fs.chmod).mockImplementationOnce(async (path, mode) => {
      await actual.chmod(path, mode)
      controller.abort()
    })
    await expect(saveProfileFile(root, 'default', { yaml: yaml('default', 'Changed'), expectedRevision: original.revision }, controller.signal)).rejects.toMatchObject({ status: 408 })
    expect((await readProfileFile(root, 'default')).revision).toBe(original.revision)
    expect((await fs.readdir(join(root, 'data'))).sort()).toEqual(['default.yaml', 'profile.template.yaml'])
  })
  it('detects edits made while preparing an atomic write', async () => {
    await initializeProfileDirectory(root)
    const original = await saveProfileFile(root, 'default', { yaml: yaml(), expectedRevision: null })
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const external = yaml('default', 'External edit')
    vi.mocked(fs.chmod).mockImplementationOnce(async (path, mode) => {
      await actual.chmod(path, mode)
      await fs.writeFile(file(), external)
    })
    await expect(saveProfileFile(root, 'default', { yaml: yaml('default', 'Changed'), expectedRevision: original.revision })).rejects.toMatchObject({ status: 409 })
    expect(await fs.readFile(file(), 'utf8')).toBe(external)
  })
  it('rejects data and legacy directory junctions without touching their targets', async () => {
    const outside = join(root, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(join(outside, 'default.yaml'), yaml())
    await fs.symlink(outside, join(root, 'data'), 'junction')
    await expect(initializeProfileDirectory(root)).rejects.toMatchObject({ status: 400 })
    await expect(readProfileFile(root, 'default')).rejects.toMatchObject({ status: 400 })
    expect(await fs.readFile(join(outside, 'default.yaml'), 'utf8')).toContain('synthetic-ai-secret')
    await fs.unlink(join(root, 'data'))
    await fs.writeFile(join(outside, 'app.settings.jsonc'), JSON.stringify(settings))
    await fs.symlink(outside, join(root, 'settings'), 'junction')
    await expect(initializeProfileDirectory(root)).rejects.toMatchObject({ status: 400 })
    expect(await fs.readFile(join(outside, 'app.settings.jsonc'), 'utf8')).toBe(JSON.stringify(settings))
  })
})
