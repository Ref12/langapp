import { isAlias, isCollection, isPair, isScalar, parseAllDocuments, stringify } from 'yaml'
import { z } from 'zod'
import { CONTENT_VERSION } from '../../data/mandarin'
import { interruptImportedRuns, readBackup, splitStudy } from '../backup-codec'
import { localSettingsSchema } from '../local-settings-contracts'
import { MAX_PROFILE_BYTES, PROFILE_FORMAT, PROFILE_VERSION, profileDataSchema, profileSnapshotSchema, profileYamlSchema, type ProfileSnapshot } from './contracts'
import { type ProfileMetadata } from './identity'
import { fromProfileYaml, toProfileYaml } from './vocabulary'

const INVALID_PROFILE = 'Invalid profile YAML. Check the file format, settings, and saved data.'
const MAX_DEPTH = 40
const legacyProfileSchema = profileDataSchema.extend({ version: z.literal(1) })
const labelProfileSchema = profileYamlSchema.extend({ version: z.literal(2) })
const characterProfileSchema = profileYamlSchema.extend({ version: z.literal(3) })

function checkSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) {
    throw new Error('The profile exceeds the 10 MiB limit.')
  }
}

function checkNode(node: unknown, depth = 0): void {
  if (depth > MAX_DEPTH || isAlias(node)) throw new Error(INVALID_PROFILE)
  if (isPair(node)) {
    if (!isScalar(node.key) || typeof node.key.value !== 'string') throw new Error(INVALID_PROFILE)
    checkNode(node.key, depth + 1)
    checkNode(node.value, depth + 1)
  } else if (isCollection(node) || isScalar(node)) {
    // Explicit tags and anchors are unnecessary for snapshots and can obscure their contents.
    if (node.tag || node.anchor) throw new Error(INVALID_PROFILE)
    if (isCollection(node)) for (const item of node.items) checkNode(item, depth + 1)
  }
}

export function createEmptyProfile(profile: ProfileMetadata, localSettings?: z.infer<typeof localSettingsSchema>): ProfileSnapshot {
  try {
    const settings = localSettingsSchema.parse(localSettings ?? {})
    return profileSnapshotSchema.parse({
      format: PROFILE_FORMAT, version: PROFILE_VERSION, contentVersion: CONTENT_VERSION, exportedAt: Date.now(), profile,
      settings: {
        preferences: {
          id: 'workspace', language: 'zh-Hans', name: 'Your workspace', theme: 'dark',
          pinyin: true, readingMode: 'weave', sidebarCollapsed: false,
          ...(settings.defaultSpeechRate === undefined ? {} : { defaultSpeechRate: settings.defaultSpeechRate }),
          ...(settings.speechVoices === undefined ? {} : { speechVoices: settings.speechVoices }),
        },
        ...(settings.aiConnection ? { aiConnection: settings.aiConnection } : {}),
        ...(settings.speechConnection ? { speechConnection: settings.speechConnection } : {}),
      },
      knowledge: { words: [], readings: [], lessons: [], sessions: [], attempts: [], characterStates: [],
        study: { knowledge: [], cards: [], sessions: [], attempts: [] } },
      conversations: { threads: [], messages: [], runs: [] },
    })
  } catch {
    throw new Error(INVALID_PROFILE)
  }
}

export function parseProfileYaml(text: string): ProfileSnapshot {
  checkSize(text)
  try {
    const documents = parseAllDocuments(text, {
      version: '1.2', schema: 'core', uniqueKeys: true, strict: true, prettyErrors: false,
    })
    if (documents.length !== 1) throw new Error(INVALID_PROFILE)
    const document = documents[0]
    if (document.errors.length || document.warnings.length) throw new Error(INVALID_PROFILE)
    checkNode(document.contents)
    const value: unknown = document.toJS({ maxAliasCount: 0 })
    const version = typeof value === 'object' && value !== null && 'version' in value ? value.version : undefined
    const snapshot = profileSnapshotSchema.parse(version === 1
      ? { ...legacyProfileSchema.parse(value), version: PROFILE_VERSION }
      : fromProfileYaml(version === 2
        ? { ...labelProfileSchema.parse(value), version: PROFILE_VERSION }
        : version === 3 ? { ...characterProfileSchema.parse(value), version: PROFILE_VERSION }
          : profileYamlSchema.parse(value)))
    interruptImportedRuns(snapshot.conversations)
    return snapshot
  } catch {
    // Parser/schema diagnostics may contain source text, including credentials.
    throw new Error(INVALID_PROFILE)
  }
}

export function serializeProfileYaml(snapshot: ProfileSnapshot): string {
  let text: string
  try {
    text = stringify(toProfileYaml(profileSnapshotSchema.parse(snapshot)), { aliasDuplicateObjects: false, lineWidth: 0 })
  } catch {
    throw new Error(INVALID_PROFILE)
  }
  checkSize(text)
  return text
}

export function fromLegacyBackup(text: string, profile: ProfileMetadata): ProfileSnapshot {
  try {
    const { learning, assistant, study, library } = splitStudy(readBackup(text))
    const { preferences, ...knowledge } = learning
    return profileSnapshotSchema.parse({
      ...createEmptyProfile(profile),
      settings: { preferences },
      knowledge: { ...knowledge, study },
      conversations: assistant ?? { threads: [], messages: [], runs: [] },
      library,
    })
  } catch {
    throw new Error('Invalid legacy backup. Check the file format and saved data.')
  }
}
