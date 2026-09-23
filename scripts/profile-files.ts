import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, lstat, mkdir, open, opendir, realpath, rename, unlink, type FileHandle } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'
import { type z } from 'zod'
import { localSettingsSchema, LOCAL_SETTINGS_DIRECTORY } from '../src/core/local-settings-contracts'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from '../src/core/profiles/codec'
import { MAX_PROFILE_BYTES } from '../src/core/profiles/contracts'
import { DEFAULT_PROFILE_ID, profileIdSchema } from '../src/core/profiles/identity'
import { MAX_LOCAL_PROFILES, type LocalProfileSaveInput } from '../src/core/profiles/local-contracts'
import { createProfileTemplate, PROFILE_TEMPLATE_FILE } from '../src/core/profiles/template'

const LEGACY_DIRECTORY = 'settings'
const LEGACY_FILE = 'app.settings.jsonc'
const MAX_LEGACY_BYTES = 32 * 1024
const locks = new Map<string, Promise<unknown>>()

export class ProfileFileError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function code(error: unknown, value: string): boolean {
  return error instanceof Error && 'code' in error && error.code === value
}

function revision(buffer: Buffer): string { return createHash('sha256').update(buffer).digest('hex') }
function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new ProfileFileError(408, 'Local profile operation was interrupted.')
}

function filename(id: string): string {
  const parsed = profileIdSchema.safeParse(id)
  if (!parsed.success || parsed.data !== id) throw new ProfileFileError(400, 'Invalid profile ID. Use default or a lowercase UUID.')
  return `${id}.yaml`
}

async function regularFile(path: string) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new ProfileFileError(400, 'Local profile path is not a regular file.')
  return stat
}

async function directoryPath(root: string, create = false) {
  const canonicalRoot = await realpath(root)
  const directory = join(canonicalRoot, LOCAL_SETTINGS_DIRECTORY)
  if (create) {
    try { await mkdir(directory, { mode: 0o700 }) } catch (error) { if (!code(error, 'EEXIST')) throw error }
  }
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(await realpath(directory)) !== resolve(directory)) {
    throw new ProfileFileError(400, 'The local data directory must not be a symbolic link or junction.')
  }
  return directory
}

async function readBounded(path: string, maxBytes: number, signal?: AbortSignal) {
  check(signal)
  const before = await regularFile(path)
  if (before.size > maxBytes) throw new ProfileFileError(413, 'Local profile file exceeds the size limit.')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) {
      throw new ProfileFileError(409, 'Local profile file changed. Refresh before retrying.')
    }
    const chunks: Buffer[] = []
    let size = 0
    while (true) {
      check(signal)
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - size))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      chunks.push(buffer.subarray(0, bytesRead))
      size += bytesRead
      if (size > maxBytes) throw new ProfileFileError(413, 'Local profile file exceeds the size limit.')
    }
    const after = await regularFile(path)
    const final = await file.stat()
    if (after.ino !== stat.ino || after.dev !== stat.dev || final.size !== stat.size || final.mtimeMs !== stat.mtimeMs) {
      throw new ProfileFileError(409, 'Local profile file changed. Refresh before retrying.')
    }
    check(signal)
    return { bytes: Buffer.concat(chunks), mode: stat.mode & 0o777 }
  } finally {
    await file.close()
  }
}

function decode(bytes: Buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {
    throw new ProfileFileError(400, 'Invalid profile YAML. UTF-8 is required.')
  }
}

function validate(yaml: string, id: string) {
  if (Buffer.byteLength(yaml, 'utf8') > MAX_PROFILE_BYTES) throw new ProfileFileError(413, 'Local profile file exceeds the size limit.')
  try {
    const snapshot = parseProfileYaml(yaml)
    if (snapshot.profile.id !== id) throw new Error()
    return snapshot
  } catch {
    throw new ProfileFileError(400, 'Invalid profile YAML or mismatched profile ID.')
  }
}

export async function readProfileFile(root: string, id: string, signal?: AbortSignal) {
  const name = filename(id)
  try {
    const directory = await directoryPath(root)
    const { bytes } = await readBounded(join(directory, name), MAX_PROFILE_BYTES, signal)
    if (await directoryPath(root) !== directory) throw new ProfileFileError(409, 'Local data directory changed.')
    const yaml = decode(bytes)
    const snapshot = validate(yaml, id)
    check(signal)
    return { yaml, revision: revision(bytes), snapshot }
  } catch (error) {
    if (code(error, 'ENOENT')) throw new ProfileFileError(404, 'No local profile file is present.')
    throw error
  }
}

export async function listProfileFiles(root: string, signal?: AbortSignal) {
  const directory = await directoryPath(root)
  const ids: string[] = []
  let entries = 0
  const files = await opendir(directory)
  for await (const entry of files) {
    check(signal)
    if (++entries > 2_000) throw new ProfileFileError(413, 'The local data directory contains too many entries.')
    if (entry.name === PROFILE_TEMPLATE_FILE || !/\.ya?ml$/i.test(entry.name)) continue
    const id = entry.name.slice(0, -5)
    const parsedId = profileIdSchema.safeParse(id)
    if (!entry.name.endsWith('.yaml') || !parsedId.success || parsedId.data !== id) {
      throw new ProfileFileError(400, 'The local data directory contains an invalid profile filename. Use default.yaml or a UUID.yaml filename.')
    }
    if (ids.length >= MAX_LOCAL_PROFILES) throw new ProfileFileError(413, 'The local data directory contains too many profiles.')
    ids.push(id)
  }
  const profiles = []
  for (const id of ids) {
    const result = await readProfileFile(root, id, signal)
    profiles.push({ ...result.snapshot.profile, revision: result.revision })
  }
  return { profiles: profiles.sort((a, b) => a.id.localeCompare(b.id)) }
}

async function exclusive<T>(key: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const previous = locks.get(key)
  const current = (async () => {
    if (previous) await previous.catch(() => { /* A failed writer must still release the queue. */ })
    check(signal)
    return operation()
  })()
  locks.set(key, current)
  try { return await current } finally { if (locks.get(key) === current) locks.delete(key) }
}

async function removeOwnedFile(path: string) {
  try { await unlink(path) } catch (error) {
    if (!code(error, 'ENOENT')) throw new ProfileFileError(500, 'Local profile cleanup failed. Check the data directory before retrying.')
  }
}

async function writeAtomic(
  root: string, name: string, bytes: Buffer, expectedRevision: string | null, signal?: AbortSignal,
) {
  const directory = await directoryPath(root)
  const target = join(directory, name)
  return exclusive(target, async () => {
    check(signal)
    const lockPath = join(directory, `.${name}.lock`)
    let lock: FileHandle
    try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
      if (code(error, 'EEXIST')) throw new ProfileFileError(409, 'The local profile is locked by another writer. Refresh before retrying.')
      throw error
    }
    const staging = join(directory, `.${name}.${randomUUID()}.pending`)
    let staged = false
    try {
      if (expectedRevision === null) {
        try {
          await lstat(target)
          throw new ProfileFileError(409, 'The local profile already exists. Refresh before retrying.')
        } catch (error) { if (!code(error, 'ENOENT')) throw error }
      }
      const current = async () => {
        try { return await readBounded(target, MAX_PROFILE_BYTES, signal) } catch (error) {
          if (code(error, 'ENOENT')) return null
          throw error
        }
      }
      const before = await current()
      if ((before ? revision(before.bytes) : null) !== expectedRevision) {
        throw new ProfileFileError(409, 'The local profile already exists or changed. Refresh before retrying.')
      }
      const file = await open(staging, 'wx', before?.mode ?? 0o600)
      staged = true
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
      if (before) await chmod(staging, before.mode)
      check(signal)
      if (await directoryPath(root) !== directory) throw new ProfileFileError(409, 'Local data directory changed.')
      const latest = await current()
      if ((latest ? revision(latest.bytes) : null) !== expectedRevision) {
        throw new ProfileFileError(409, 'The local profile changed. Refresh before retrying.')
      }
      check(signal)
      if (expectedRevision === null) {
        try { await link(staging, target) } catch (error) {
          if (code(error, 'EEXIST')) throw new ProfileFileError(409, 'The local profile already exists. Refresh before retrying.')
          throw error
        }
      } else {
        await rename(staging, target)
        staged = false
      }
      return revision(bytes)
    } finally {
      try { if (staged) await removeOwnedFile(staging) } finally {
        try { await lock.close() } finally { await removeOwnedFile(lockPath) }
      }
    }
  }, signal)
}

export async function saveProfileFile(root: string, id: string, input: LocalProfileSaveInput, signal?: AbortSignal) {
  const name = filename(id)
  const snapshot = validate(input.yaml, id)
  const nextRevision = await writeAtomic(root, name, Buffer.from(input.yaml, 'utf8'), input.expectedRevision, signal)
  return { profile: snapshot.profile, revision: nextRevision }
}

export function profileLocalSettings(snapshot: Awaited<ReturnType<typeof readProfileFile>>['snapshot']): z.infer<typeof localSettingsSchema> {
  const { aiConnection, speechConnection, preferences } = snapshot.settings
  return localSettingsSchema.parse({
    ...(aiConnection ? { aiConnection } : {}),
    ...(speechConnection ? { speechConnection } : {}),
    ...(preferences.defaultSpeechRate === undefined ? {} : { defaultSpeechRate: preferences.defaultSpeechRate }),
    ...(preferences.speechVoices === undefined ? {} : { speechVoices: preferences.speechVoices }),
  })
}

export async function initializeProfileDirectory(root: string, signal?: AbortSignal): Promise<void> {
  try {
    const directory = await directoryPath(root, true)
    const legacyDirectory = join(await realpath(root), LEGACY_DIRECTORY)
    const source = join(legacyDirectory, LEGACY_FILE)
    let legacyExists = false
    try {
      await lstat(source)
      legacyExists = true
    } catch (error) { if (!code(error, 'ENOENT')) throw error }
    if (legacyExists) {
      const legacyStat = await lstat(legacyDirectory)
      if (!legacyStat.isDirectory() || legacyStat.isSymbolicLink() || resolve(await realpath(legacyDirectory)) !== resolve(legacyDirectory)) {
        throw new ProfileFileError(400, 'Legacy settings directory must not be a symbolic link or junction.')
      }
      try {
        await lstat(join(directory, filename(DEFAULT_PROFILE_ID)))
        throw new ProfileFileError(409, 'Profile migration conflict: default.yaml and legacy settings both exist. Neither file was changed.')
      } catch (error) { if (!code(error, 'ENOENT')) throw error }
      const legacy = await readBounded(source, MAX_LEGACY_BYTES, signal)
      const errors: ParseError[] = []
      const value: unknown = parse(decode(legacy.bytes).replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true })
      const parsed = localSettingsSchema.safeParse(value)
      if (errors.length || !parsed.success) throw new ProfileFileError(400, 'Profile migration failed: legacy settings are invalid. The original file was preserved.')
      const snapshot = createEmptyProfile({ id: DEFAULT_PROFILE_ID, name: 'default' }, parsed.data)
      const yaml = serializeProfileYaml(snapshot)
      if (JSON.stringify(profileLocalSettings(parseProfileYaml(yaml))) !== JSON.stringify(parsed.data)) {
        throw new ProfileFileError(400, 'Profile migration failed: settings did not round-trip. The original file was preserved.')
      }
      await saveProfileFile(root, DEFAULT_PROFILE_ID, { yaml, expectedRevision: null }, signal)
      const saved = await readProfileFile(root, DEFAULT_PROFILE_ID, signal)
      const unchanged = await readBounded(source, MAX_LEGACY_BYTES, signal)
      if (saved.yaml !== yaml || revision(unchanged.bytes) !== revision(legacy.bytes)
        || JSON.stringify(profileLocalSettings(saved.snapshot)) !== JSON.stringify(parsed.data)) {
        throw new ProfileFileError(409, 'Profile migration verification failed. The original file was preserved.')
      }
      check(signal)
      await unlink(source)
    }
    const templatePath = join(directory, PROFILE_TEMPLATE_FILE)
    try { await regularFile(templatePath) } catch (error) {
      if (!code(error, 'ENOENT')) throw error
      await writeAtomic(root, PROFILE_TEMPLATE_FILE, Buffer.from(createProfileTemplate(), 'utf8'), null, signal)
    }
  } catch (error) {
    if (error instanceof ProfileFileError) throw error
    throw new ProfileFileError(500, 'Could not initialize local profiles. Check data directory permissions; original settings were not intentionally removed.')
  }
}
