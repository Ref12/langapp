import { stringify } from 'yaml'
import { omit } from '../omit'
import { z } from 'zod'
import { CONTENT_VERSION } from '../../data/mandarin'
import { interruptImportedRuns, readBackup, splitStudy } from '../backup-codec'
import { localSettingsSchema } from '../local-settings-contracts'
import { parsePlainYaml } from '../yaml'
import { MAX_PROFILE_BYTES, PROFILE_FORMAT, PROFILE_VERSION, profileDataSchema, profileSnapshotSchema, profileYamlSchema, type ProfileSnapshot } from './contracts'
import { AI_ENDPOINTS_VERSION, type AIEndpointsExport } from '../assistant/contracts'
import { type ProfileMetadata } from './identity'
import { fromProfileYaml, toProfileYaml } from './vocabulary'

const INVALID_PROFILE = 'Invalid profile YAML. Check the file format, settings, and saved data.'
const legacyProfileSchema = profileDataSchema.extend({ version: z.literal(1) })
const labelProfileSchema = profileYamlSchema.extend({ version: z.literal(2) })
const characterProfileSchema = profileYamlSchema.extend({ version: z.literal(3) })
const singleConnectionProfileSchema = profileYamlSchema.extend({ version: z.literal(4) })

function checkSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) {
    throw new Error('The profile exceeds the 10 MiB limit.')
  }
}

// Older profiles carry one aiConnection; the current shape is a versioned endpoint list.
export function endpointsFromSettings(settings: ProfileSnapshot['settings']): AIEndpointsExport | undefined {
  if (settings.aiEndpoints) return settings.aiEndpoints
  if (!settings.aiConnection) return undefined
  return { version: AI_ENDPOINTS_VERSION, active: 'default', endpoints: [{ ...settings.aiConnection, id: 'default', name: 'Default' }] }
}

function normalizeEndpoints(snapshot: ProfileSnapshot): ProfileSnapshot {
  const aiEndpoints = endpointsFromSettings(snapshot.settings)
  return { ...snapshot, settings: { ...omit(snapshot.settings, 'aiConnection', 'aiEndpoints'), ...(aiEndpoints ? { aiEndpoints } : {}) } }
}

export function createEmptyProfile(profile: ProfileMetadata, localSettings?: z.infer<typeof localSettingsSchema>): ProfileSnapshot {
  try {
    const settings = localSettingsSchema.parse(localSettings ?? {})
    return normalizeEndpoints(profileSnapshotSchema.parse({
      format: PROFILE_FORMAT, version: PROFILE_VERSION, contentVersion: CONTENT_VERSION, exportedAt: Date.now(), profile,
      settings: {
        preferences: {
          id: 'workspace', language: 'zh-Hans', name: 'Your workspace', theme: 'dark',
          pinyin: true, readingMode: 'weave', sidebarCollapsed: false,
          ...(settings.defaultSpeechRate === undefined ? {} : { defaultSpeechRate: settings.defaultSpeechRate }),
          ...(settings.speechVoices === undefined ? {} : { speechVoices: settings.speechVoices }),
          ...(settings.pinyinFormat === undefined ? {} : { pinyinFormat: settings.pinyinFormat }),
        },
        ...(settings.aiConnection ? { aiConnection: settings.aiConnection } : {}),
        ...(settings.speechConnection ? { speechConnection: settings.speechConnection } : {}),
      },
      knowledge: { words: [], readings: [], lessons: [], sessions: [], attempts: [], characterStates: [],
        study: { knowledge: [], cards: [], sessions: [], attempts: [] } },
      conversations: { threads: [], messages: [], runs: [] },
    }))
  } catch {
    throw new Error(INVALID_PROFILE)
  }
}

export function parseProfileYaml(text: string): ProfileSnapshot {
  checkSize(text)
  try {
    const value = parsePlainYaml(text)
    const version = typeof value === 'object' && value !== null && 'version' in value ? value.version : undefined
    const snapshot = normalizeEndpoints(profileSnapshotSchema.parse(version === 1
      ? { ...legacyProfileSchema.parse(value), version: PROFILE_VERSION }
      : fromProfileYaml(version === 2
        ? { ...labelProfileSchema.parse(value), version: PROFILE_VERSION }
        : version === 3 ? { ...characterProfileSchema.parse(value), version: PROFILE_VERSION }
          : version === 4 ? { ...singleConnectionProfileSchema.parse(value), version: PROFILE_VERSION }
            : profileYamlSchema.parse(value))))
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
