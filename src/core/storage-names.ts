// The one place that names everything this build writes to the browser: IndexedDB databases, localStorage and
// sessionStorage keys, Cache Storage caches, the service worker file, the Web Lock and the BroadcastChannel,
// and where a backup lives in the learner's repository. Every other module asks here (a test scans src/ for strays).
//
// Stable and Lab run on one browser origin. Stable keeps today's names, because the learner's data is already there.
// Lab puts `lab.` in front of every browser-side name, so no Stable name is ever a Lab name and no prefix scan Stable
// does (`linguaweave-shell-*`, `linguaweave-backup-config:*`) can match a Lab name. In the repository Lab backs up under
// `lab/profiles/<id>/`, never Stable's `profiles/<id>/`.

declare const __BUILD_CHANNEL__: 'stable' | 'lab'
declare const __BUILD_COMMIT__: string
declare const __BUILD_LANGUAGE__: LanguageId

import { DEFAULT_BUILD_LANGUAGE, type LanguageId } from './language/ids'

export type BuildChannel = 'stable' | 'lab'
export const BUILD_CHANNELS: readonly BuildChannel[] = ['stable', 'lab']

const OVERRIDE = '__linguaweaveChannelOverride'
/** Tests only: pretend this bundle was built for a channel (undefined restores the build's own). Kept on globalThis so it survives vi.resetModules(). */
export function setBuildChannelForTests(channel: BuildChannel | undefined): void { (globalThis as Record<string, unknown>)[OVERRIDE] = channel }

/** The channel this bundle was built for (`__BUILD_CHANNEL__`, defined in vite.config.ts and vitest.config.ts). */
export function buildChannel(): BuildChannel {
  const override = (globalThis as Record<string, unknown>)[OVERRIDE] as BuildChannel | undefined
  if (override) return override
  return typeof __BUILD_CHANNEL__ === 'undefined' ? 'lab' : __BUILD_CHANNEL__
}
const LANGUAGE_OVERRIDE = '__linguaweaveLanguageOverride'
/** Tests only: pretend this bundle was built for a language (undefined restores the build's own). */
export function setBuildLanguageForTests(language: LanguageId | undefined): void { (globalThis as Record<string, unknown>)[LANGUAGE_OVERRIDE] = language }

/** The language this bundle was built for (`__BUILD_LANGUAGE__`, from LANGAPP_LANGUAGE; Chinese when nothing says otherwise). */
export function buildLanguage(): LanguageId {
  const override = (globalThis as Record<string, unknown>)[LANGUAGE_OVERRIDE] as LanguageId | undefined
  if (override) return override
  return typeof __BUILD_LANGUAGE__ === 'undefined' ? DEFAULT_BUILD_LANGUAGE : __BUILD_LANGUAGE__
}
/** The short commit this bundle was built from. */
export function buildCommit(): string { return typeof __BUILD_COMMIT__ === 'undefined' ? 'dev' : __BUILD_COMMIT__ }

export interface StorageNames {
  channel: BuildChannel
  language: LanguageId
  /** "Copy profile from Stable" is offered: Lab Chinese only (Stable is Chinese). */
  copyFromStable: boolean
  db: {
    /** A profile's learning database ('default' is the first profile). */
    learning(profileId: string): string
    registry: string
    backupState: string
  }
  local: {
    selectedProfile: string
    /** Followed by the profile id. */
    backupConfigPrefix: string
    newItems: string
    legacyNewItems: string
    reviewCount: string
    unwrittenSize: string
    writeDrill: string
    handsfree: string
    autoListen: string
    customPresets: string
    handwritingEngine: string
    mediaChunk: string
    mediaConcurrency: string
    mediaPause: string
    mediaGlosses: string
  }
  session: {
    /** Followed by the job id. */
    mediaJobUrlPrefix: string
  }
  cache: {
    /** Every shell cache of this channel starts with this. */
    shellPrefix: string
    shell(version: string): string
    runtime: string
  }
  /** The service worker file, next to index.html (its scope is that folder). */
  serviceWorkerFile: string
  lock: string
  broadcast: string
  /** Where a profile's backup lives in the learner's repository, with a trailing slash. */
  backupFolder(profileId: string): string
  /** The part of the repository path in front of `profiles/`. */
  backupRoot: string
  /** Names only Lab uses (always lab-prefixed, whatever the channel asked: Stable never has them). */
  labOnly: {
    /** Set once the learner declines the first-visit offer to copy from Stable. */
    copyOfferDeclined: string
    /** The scratch database a copy from Stable is migrated in, deleted afterwards. */
    importScratch(token: string): string
  }
}

export function storageNames(channel: BuildChannel = buildChannel(), language: LanguageId = buildLanguage()): StorageNames {
  // Stable is Chinese, whatever the bundle asking is (Lab code reads Stable's names to copy from it).
  if (channel === 'stable') language = 'zh'
  // Lab Chinese keeps `lab.`; another language puts itself after it, so no prefix of one build matches a name of another.
  const p = channel === 'stable' ? '' : language === 'zh' ? 'lab.' : 'lab.' + language + '.'
  const root = channel === 'stable' ? '' : language === 'zh' ? 'lab/' : 'lab/' + language + '/'
  const worker = channel === 'stable' ? 'sw.js' : language === 'zh' ? 'sw-lab.js' : 'sw-lab-' + language + '.js'
  return {
    channel,
    language,
    copyFromStable: channel === 'lab' && language === 'zh',
    db: {
      learning: id => id === 'default' ? p + 'linguaweave-next' : p + 'linguaweave-next-profile-' + id,
      registry: p + 'linguaweave-profile-registry',
      backupState: p + 'linguaweave-backup-state',
    },
    local: {
      selectedProfile: p + 'linguaweave-selected-profile',
      backupConfigPrefix: p + 'linguaweave-backup-config:',
      newItems: p + 'practice.newItems',
      legacyNewItems: p + 'practice.newWords',
      reviewCount: p + 'practice.reviewCount',
      unwrittenSize: p + 'practice.unwrittenSize',
      writeDrill: p + 'drills.write',
      handsfree: p + 'handsfree.settings',
      autoListen: p + 'linguaweave.autoListen',
      customPresets: p + 'linguaweave.engine.customPresets',
      handwritingEngine: p + 'handwriting-engine',
      mediaChunk: p + 'media-translation-chunk-size',
      mediaConcurrency: p + 'media-translation-concurrency',
      mediaPause: p + 'linguaweave-media-pause-after-line',
      mediaGlosses: p + 'linguaweave-media-glosses',
    },
    session: { mediaJobUrlPrefix: p + 'linguaweave-media-job-url:' },
    cache: { shellPrefix: p + 'linguaweave-shell-', shell: version => p + 'linguaweave-shell-' + version, runtime: p + 'linguaweave-runtime' },
    serviceWorkerFile: worker,
    lock: p + 'linguaweave-backup',
    broadcast: p + 'linguaweave-backup',
    backupFolder: id => root + 'profiles/' + id + '/',
    backupRoot: root,
    labOnly: { copyOfferDeclined: p + 'linguaweave-copy-offer-declined', importScratch: token => p + 'linguaweave-next-import-' + token },
  }
}

/** Every fixed name (and prefix) of a channel, flattened: used by the tests and by anything that must not collide. */
export function listStorageNames(channel: BuildChannel, language: LanguageId = 'zh'): string[] {
  const n = storageNames(channel, language)
  return [
    n.db.learning('default'), n.db.learning('<profile-id>'), n.db.registry, n.db.backupState,
    ...Object.values(n.local), ...Object.values(n.session),
    n.cache.shell('<version>'), n.cache.runtime, n.serviceWorkerFile, n.lock, n.broadcast, n.backupFolder('<profile-id>'),
    ...(channel === 'lab' ? [n.labOnly.copyOfferDeclined, n.labOnly.importScratch('<token>')] : []),
  ]
}
