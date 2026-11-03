import { stringify } from 'yaml'
import { omit } from '../omit'
import { z } from 'zod'
import { CONTENT_VERSION } from '../../data/content-version'
import { exercisePositionValid, interruptImportedRuns, readBackup, splitStudy } from '../backup-codec'
import { exerciseSessionSchema } from '../study/contracts'
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

/** What a failed parse may say: our own check messages, and for schema issues only the path and kind, never a value. */
function describeFailure(error: unknown): string {
  if (!(error instanceof z.ZodError)) return INVALID_PROFILE
  const issue = error.issues[0]
  if (!issue) return INVALID_PROFILE
  if (issue.code === 'custom') return `Invalid profile YAML: ${issue.message}`
  const path = issue.path.map(part => typeof part === 'number' ? `[${part}]` : String(part).slice(0, 40)).join('.').replace(/\.\[/g, '[')
  return `Invalid profile YAML: unexpected data (${issue.code}) at ${path || 'the top level'}.`
}

/**
 * Practice sessions are progress, not knowledge: one that cannot be read (bad shape or position) is left out, with its answers,
 * so it never blocks a restore. Returns the ids skipped.
 */
function dropUnreadableSessions(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return []
  const study = (value as { knowledge?: { study?: { sessions?: unknown; attempts?: unknown } } }).knowledge?.study
  if (!study || !Array.isArray(study.sessions)) return []
  const kept: unknown[] = []
  const seen = new Set<string>()
  const skipped: string[] = []
  for (const raw of study.sessions) {
    const parsed = exerciseSessionSchema.safeParse(raw)
    if (parsed.success && exercisePositionValid(parsed.data) && !seen.has(parsed.data.id)) { seen.add(parsed.data.id); kept.push(raw) }
    else skipped.push(typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : '?')
  }
  if (!skipped.length) return []
  study.sessions = kept
  if (Array.isArray(study.attempts)) {
    const gone = new Set(skipped.filter(id => !seen.has(id)))
    study.attempts = study.attempts.filter(attempt => !(typeof attempt === 'object' && attempt !== null && gone.has((attempt as { sessionId?: string }).sessionId ?? '')))
  }
  return skipped
}

export function parseProfileYaml(text: string): ProfileSnapshot {
  return parseProfileYamlReport(text).snapshot
}

/** As parseProfileYaml, also reporting how many unreadable practice sessions were left out. */
export function parseProfileYamlReport(text: string): { snapshot: ProfileSnapshot; skippedSessions: number } {
  checkSize(text)
  try {
    const value = parsePlainYaml(text)
    const skippedSessions = dropUnreadableSessions(value).length
    const version = typeof value === 'object' && value !== null && 'version' in value ? value.version : undefined
    const snapshot = normalizeEndpoints(profileSnapshotSchema.parse(version === 1
      ? { ...legacyProfileSchema.parse(value), version: PROFILE_VERSION }
      : fromProfileYaml(version === 2
        ? { ...labelProfileSchema.parse(value), version: PROFILE_VERSION }
        : version === 3 ? { ...characterProfileSchema.parse(value), version: PROFILE_VERSION }
          : version === 4 ? { ...singleConnectionProfileSchema.parse(value), version: PROFILE_VERSION }
            : profileYamlSchema.parse(value))))
    interruptImportedRuns(snapshot.conversations)
    return { snapshot, skippedSessions }
  } catch (error) {
    // Parser/schema diagnostics may contain source text, including credentials: only describeFailure's output is shown.
    throw new Error(describeFailure(error))
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
