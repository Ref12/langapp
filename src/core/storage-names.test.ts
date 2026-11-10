// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildLanguage, listStorageNames, setBuildLanguageForTests, storageNames } from './storage-names'
import { MANIFEST_FORMAT, SETTINGS_FORMAT } from './backup/layout'
import { CHECKPOINT_FORMAT } from './backup/files'
import { PROFILE_FORMAT } from './profiles/contracts'

/** Today's names, written out by hand. If this list changes, a learner's data moves: that must never happen by accident. */
const STABLE_TODAY = {
  databases: ['linguaweave-next', 'linguaweave-next-profile-<id>', 'linguaweave-profile-registry', 'linguaweave-backup-state'],
  localStorage: [
    'linguaweave-selected-profile', 'linguaweave-backup-config:<id>', 'practice.newItems', 'practice.newWords', 'practice.reviewCount', 'practice.unwrittenSize',
    'drills.write', 'handsfree.settings', 'linguaweave.autoListen', 'linguaweave.engine.customPresets', 'handwriting-engine',
    'media-translation-chunk-size', 'media-translation-concurrency', 'linguaweave-media-pause-after-line', 'linguaweave-media-glosses',
  ],
  sessionStorage: ['linguaweave-media-job-url:<id>'],
  caches: ['linguaweave-shell-<version>', 'linguaweave-runtime'],
  serviceWorker: 'sw.js',
  lock: 'linguaweave-backup',
  broadcast: 'linguaweave-backup',
  backupFolder: 'profiles/<id>/',
}

/** Lab's names today (what main's tests see): every browser-side name of Stable with 'lab.' in front, a repository folder of its own, its own worker file. */
const LAB_TODAY = {
  databases: ['lab.linguaweave-next', 'lab.linguaweave-next-profile-<id>', 'lab.linguaweave-profile-registry', 'lab.linguaweave-backup-state'],
  localStorage: STABLE_TODAY.localStorage.map(key => 'lab.' + key),
  sessionStorage: ['lab.linguaweave-media-job-url:<id>'],
  caches: ['lab.linguaweave-shell-<version>', 'lab.linguaweave-runtime'],
  serviceWorker: 'sw-lab.js',
  lock: 'lab.linguaweave-backup',
  broadcast: 'lab.linguaweave-backup',
  backupFolder: 'lab/profiles/<id>/',
  labOnly: ['lab.linguaweave-copy-offer-declined', 'lab.linguaweave-next-import-<token>'],
}

describe('storage names', () => {
  it("gives exactly today's names on the lab channel, which is what these tests run as by default", () => {
    const n = storageNames('lab')
    expect(n.channel).toBe('lab')
    expect(storageNames().channel).toBe(process.env.LINGUAWEAVE_TEST_CHANNEL === 'stable' ? 'stable' : 'lab')
    expect([n.db.learning('default'), n.db.learning('<id>'), n.db.registry, n.db.backupState]).toEqual(LAB_TODAY.databases)
    expect([...Object.values(n.local).map(key => key.endsWith(':') ? key + '<id>' : key)].sort()).toEqual([...LAB_TODAY.localStorage].sort())
    expect(n.session.mediaJobUrlPrefix + '<id>').toBe(LAB_TODAY.sessionStorage[0])
    expect([n.cache.shell('<version>'), n.cache.runtime]).toEqual(LAB_TODAY.caches)
    expect(n.cache.shellPrefix).toBe('lab.linguaweave-shell-')
    expect([n.serviceWorkerFile, n.lock, n.broadcast, n.backupFolder('<id>'), n.backupRoot]).toEqual([LAB_TODAY.serviceWorker, LAB_TODAY.lock, LAB_TODAY.broadcast, LAB_TODAY.backupFolder, 'lab/'])
    expect([n.labOnly.copyOfferDeclined, n.labOnly.importScratch('<token>')]).toEqual(LAB_TODAY.labOnly)
  })

  it('lists every fixed name of each channel exactly (the flattened list the isolation checks use)', () => {
    const placeholders = (name: string) => name.replace('-profile-<id>', '-profile-<profile-id>').replace(/:<id>$/, ':').replace('profiles/<id>/', 'profiles/<profile-id>/')
    expect([...listStorageNames('stable')].sort()).toEqual([
      ...STABLE_TODAY.databases, ...STABLE_TODAY.localStorage, ...STABLE_TODAY.sessionStorage, ...STABLE_TODAY.caches,
      STABLE_TODAY.serviceWorker, STABLE_TODAY.lock, STABLE_TODAY.broadcast, STABLE_TODAY.backupFolder,
    ].map(placeholders).sort())
    expect(listStorageNames('lab')).toHaveLength(listStorageNames('stable').length + LAB_TODAY.labOnly.length)
  })

  it('keeps the format strings written into backups (inventory section 3.3, "Backup repo")', () => {
    expect([MANIFEST_FORMAT, SETTINGS_FORMAT, CHECKPOINT_FORMAT, PROFILE_FORMAT]).toEqual(['linguaweave-backup', 'linguaweave-settings', 'linguaweave-checkpoint', 'linguaweave-profile'])
    const golden = (name: string) => readFileSync(join(fileURLToPath(new URL('./profiles/fixtures/golden/', import.meta.url)), name), 'utf8')
    expect(JSON.parse(golden('backup.json')).format).toBe('linguaweave-next-backup')
    expect(golden('cloud/state/snapshot.yaml')).toContain('format: linguaweave-snapshot')
  })

  it("gives exactly today's names on the stable channel", () => {
    const n = storageNames('stable')
    expect([n.db.learning('default'), n.db.learning('<id>'), n.db.registry, n.db.backupState]).toEqual(STABLE_TODAY.databases)
    expect([...Object.values(n.local).map(key => key.endsWith(':') ? key + '<id>' : key)].sort()).toEqual([...STABLE_TODAY.localStorage].sort())
    expect(n.session.mediaJobUrlPrefix + '<id>').toBe(STABLE_TODAY.sessionStorage[0])
    expect([n.cache.shell('<version>'), n.cache.runtime]).toEqual(STABLE_TODAY.caches)
    expect(n.cache.shellPrefix).toBe('linguaweave-shell-')
    expect([n.serviceWorkerFile, n.lock, n.broadcast, n.backupFolder('<id>')]).toEqual([STABLE_TODAY.serviceWorker, STABLE_TODAY.lock, STABLE_TODAY.broadcast, STABLE_TODAY.backupFolder])
  })

  it('gives lab nothing in common with stable, and no stable prefix matches a lab name', () => {
    const stable = listStorageNames('stable')
    const lab = listStorageNames('lab')
    expect(lab).toHaveLength(stable.length + 2) // plus the two names only Lab has
    expect(lab.filter(name => stable.includes(name))).toEqual([])
    const stablePrefixes = ['linguaweave-shell-', 'linguaweave-backup-config:', 'linguaweave-media-job-url:', 'linguaweave-next-profile-', 'profiles/']
    for (const name of lab) for (const prefix of stablePrefixes) expect(name.startsWith(prefix), name + ' / ' + prefix).toBe(false)
    expect(storageNames('lab').db.learning('default')).not.toBe(storageNames('stable').db.learning('default'))
  })

  it('writes backups under a folder of its own', () => {
    expect(storageNames('lab').backupFolder('abc')).toBe('lab/profiles/abc/')
    expect(storageNames('stable').backupFolder('abc')).toBe('profiles/abc/')
  })
})

const LAB_JA_TODAY = {
  databases: ['lab.ja.linguaweave-next', 'lab.ja.linguaweave-next-profile-<id>', 'lab.ja.linguaweave-profile-registry', 'lab.ja.linguaweave-backup-state'],
  localStorage: STABLE_TODAY.localStorage.map(key => 'lab.ja.' + key),
  sessionStorage: ['lab.ja.linguaweave-media-job-url:<id>'],
  caches: ['lab.ja.linguaweave-shell-<version>', 'lab.ja.linguaweave-runtime'],
  serviceWorker: 'sw-lab-ja.js',
  lock: 'lab.ja.linguaweave-backup',
  broadcast: 'lab.ja.linguaweave-backup',
  backupFolder: 'lab/ja/profiles/<id>/',
}

describe('storage names per language', () => {
  it('tests run as Lab + zh by default, and the language can be overridden for a test', () => {
    expect(buildLanguage()).toBe('zh')
    setBuildLanguageForTests('ja')
    try { expect(storageNames().language).toBe('ja') } finally { setBuildLanguageForTests(undefined) }
    expect(storageNames().language).toBe('zh')
  })

  it("gives exactly the pinned names on Lab + ja", () => {
    const n = storageNames('lab', 'ja')
    expect([n.db.learning('default'), n.db.learning('<id>'), n.db.registry, n.db.backupState]).toEqual(LAB_JA_TODAY.databases)
    expect([...Object.values(n.local).map(key => key.endsWith(':') ? key + '<id>' : key)].sort()).toEqual([...LAB_JA_TODAY.localStorage].sort())
    expect(n.session.mediaJobUrlPrefix + '<id>').toBe(LAB_JA_TODAY.sessionStorage[0])
    expect([n.cache.shell('<version>'), n.cache.runtime]).toEqual(LAB_JA_TODAY.caches)
    expect(n.cache.shellPrefix).toBe('lab.ja.linguaweave-shell-')
    expect([n.serviceWorkerFile, n.lock, n.broadcast, n.backupFolder('<id>'), n.backupRoot]).toEqual([LAB_JA_TODAY.serviceWorker, LAB_JA_TODAY.lock, LAB_JA_TODAY.broadcast, LAB_JA_TODAY.backupFolder, 'lab/ja/'])
    expect(n.copyFromStable).toBe(false)
    expect(storageNames('lab', 'zh').copyFromStable).toBe(true)
    expect(storageNames('stable').copyFromStable).toBe(false)
  })

  it('keeps every Lab + zh and Stable name unchanged whatever the language argument of Stable says', () => {
    expect(listStorageNames('lab', 'zh')).toEqual(listStorageNames('lab'))
    expect(listStorageNames('stable', 'ja')).toEqual(listStorageNames('stable', 'zh'))
    expect(storageNames('stable', 'ja').language).toBe('zh')
  })

  it('gives every fixed name of Lab + ja (and ko) nothing in common with Lab + zh, Stable or each other', () => {
    const builds = [listStorageNames('stable'), listStorageNames('lab', 'zh'), listStorageNames('lab', 'ja'), listStorageNames('lab', 'ko')]
    expect(builds.map(names => names.length)).toEqual([builds[0].length, builds[0].length + 2, builds[0].length + 2, builds[0].length + 2])
    builds.forEach((names, index) => builds.forEach((others, other) => { if (index !== other) expect(names.filter(name => others.includes(name))).toEqual([]) }))
    expect(storageNames('lab', 'ja').labOnly.copyOfferDeclined).toBe('lab.ja.linguaweave-copy-offer-declined')
  })

  it('has no prefix scan of one build that can match a name of another', () => {
    const builds = (['stable-zh', 'lab-zh', 'lab-ja', 'lab-ko'] as const).map(key => {
      const [channel, language] = key.split('-') as ['stable' | 'lab', 'zh' | 'ja' | 'ko']
      const n = storageNames(channel, language)
      return { key, n, names: listStorageNames(channel, language) }
    })
    for (const mine of builds) {
      // Every place a build enumerates by prefix: shell caches, backup config keys, media job keys, profile databases, the repository folder.
      const prefixes = [mine.n.cache.shellPrefix, mine.n.local.backupConfigPrefix, mine.n.session.mediaJobUrlPrefix, mine.n.db.learning('x').replace(/x$/, ''), mine.n.backupRoot + 'profiles/']
      for (const other of builds) {
        if (other === mine) continue
        const theirs = [...other.names, other.n.cache.shell('1'), other.n.local.backupConfigPrefix + 'p', other.n.session.mediaJobUrlPrefix + 'j', other.n.db.learning('p'), other.n.backupFolder('p') + 'profile.yaml']
        for (const prefix of prefixes) expect(theirs.filter(name => name.startsWith(prefix)), mine.key + ' scanning ' + prefix + ' sees ' + other.key).toEqual([])
      }
    }
  })

})

// Every database, cache and storage key must come from storage-names.ts, so nothing can open one under a name Stable also uses.
describe('storage access goes through storage-names', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !relative(root, path).split(sep).includes('test')) files.push(path)
    }
  }
  walk(root)
  const rel = (path: string) => relative(root, path).split(sep).join('/')
  const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // The only modules that may name a stable database directly are the module itself and the read-only copy from Stable.
  const exempt = new Set(['core/storage-names.ts', 'core/profiles/stable-copy.ts'])

  it("never opens Stable's database with Lab's schema, or writes to it", () => {
    const copy = code(join(root, 'core/profiles/stable-copy.ts'))
    expect(copy).not.toMatch(/LearningDatabase|from '\.\.\/database'|from 'dexie'|new Dexie|\.version\(/)
    expect(copy).not.toMatch(/'readwrite'|'versionchange'|\.(?:put|add|delete|clear)\(|deleteDatabase\(\s*stable|createObjectStore/)
    // and nothing else imports the learning database for the Stable side: only the scratch copy in stable-import.ts opens a Lab-named database
    expect(code(join(root, 'core/profiles/stable-import.ts'))).not.toMatch(/storageNames\(\s*'stable'\s*\)/)
  })

  it('finds the sources', () => { expect(files.length).toBeGreaterThan(100) })

  it('has no literal name at a storage call', () => {
    const literal = [
      /\b(?:localStorage|sessionStorage|storage\(\)|storage\??)\s*\??\.\s*(?:getItem|setItem|removeItem)\(\s*['"`]/,
      /\bnew Dexie\(\s*['"`]/, /\bindexedDB\.(?:open|deleteDatabase)\(\s*['"`]/,
      /\bDexie\.(?:exists|delete)\(\s*['"`]/, /\bcaches\.(?:open|delete|match)\(\s*['"`]/,
      /new BroadcastChannel\(\s*['"`]/, /locks\.request\(\s*['"`]/, /serviceWorker\.register\(\s*['"`][^`'"$]*\.js/,
    ]
    const bad: string[] = []
    for (const file of files) {
      if (exempt.has(rel(file))) continue
      const text = code(file)
      if (/extends Dexie/.test(text) && /\bsuper\(\s*['"`]/.test(text)) bad.push(rel(file) + ': a Dexie class names its database itself')
      text.split('\n').forEach((line, index) => { if (literal.some(pattern => pattern.test(line))) bad.push(rel(file) + ':' + (index + 1) + ' ' + line.trim()) })
    }
    expect(bad).toEqual([])
  })

  it('imports storage-names in every file that uses a database, a cache or a storage key', () => {
    const uses = /\b(?:(?:localStorage|sessionStorage|indexedDB)\.|caches\.|new Dexie|extends Dexie|new BroadcastChannel|navigator\.locks|serviceWorker\.register)/
    const missing: string[] = []
    for (const file of files) {
      if (exempt.has(rel(file))) continue
      const text = code(file)
      // Dexie classes are reached through the modules that name them; the files that merely pass a Storage around are listed by their consumers.
      if (uses.test(text) && !/storage-names/.test(text) && !/\bStorage\b/.test(text)) missing.push(rel(file))
    }
    expect(missing).toEqual([])
  })


  // Section 3.3 names every storage name; a name written as a literal anywhere else is one a build-derived pass would miss.
  // The only 'linguaweave' literals outside storage-names.ts are listed here (formats, headers, file names, labels); a new one fails until it is looked at.
  it("has no other literal 'linguaweave' name in the sources or the build scripts", () => {
    const scripts = fileURLToPath(new URL('../../scripts', import.meta.url))
    const all: string[] = []
    const visit = (dir: string, skip: (name: string) => boolean) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) { if (!skip(entry)) visit(path, skip) } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) all.push(path)
      }
    }
    visit(root, name => name === 'fixtures' || name === 'test')
    visit(scripts, name => name === 'perf' || name === 'node_modules')
    const found: string[] = []
    for (const file of all) {
      const name = file.startsWith(root) ? rel(file) : 'scripts/' + relative(scripts, file).split(sep).join('/')
      if (name === 'core/storage-names.ts') continue
      for (const line of code(file).split('\n')) for (const literal of line.match(/(['"`])(?:(?!\1)[^\n])*linguaweave(?:(?!\1)[^\n])*\1/gi) ?? []) found.push(name + ' ' + literal)
    }
    const allowed = [
      'App.tsx "LinguaWeave home"', 'App.tsx ">linguaweave</span>', // a page label in JSX, not a name
      "pages/drills/HandsFree.tsx 'LinguaWeave'", 'components/BackupPanel.tsx `linguaweave-before-restore-', 'components/ProfileSettings.tsx',
      "core/assistant/speech-assessment.ts 'linguaweave-mono-capture'", "core/backup/files.ts 'linguaweave-checkpoint'", "core/backup/files.ts 'linguaweave-settings'",
      "core/backup/layout.ts 'linguaweave-backup'", "core/backup/layout.ts 'linguaweave-settings'", "core/backup/layout.ts 'linguaweave-snapshot'", "core/backup-codec.ts 'linguaweave-next-backup'",
      "core/local-settings-contracts.ts 'x-linguaweave-local-settings'", "core/local-tts-contracts.ts 'x-linguaweave-local-tts'", "core/profiles/local-contracts.ts 'x-linguaweave-local-profiles'",
      "core/profiles/contracts.ts 'linguaweave-profile'", "core/media/tracks.ts 'linguaweave'", "data/mandarin.ts 'Original LinguaWeave", "scripts/pwa.ts 'LinguaWeave", 'App.tsx `${label} / LinguaWeave`', // the page title
      "App.tsx `${label} / ${buildChannel() === 'lab' && getPack().id !== 'zh' ? buildDisplayName('lab', getPack()) : 'LinguaWeave'}`", // the page title, named after the language build
      "core/language/packs.ts 'LinguaWeave", // the build's display name (manifest and page title), not a storage name
    ]
    const strays = found.filter(entry => !allowed.some(prefix => entry.startsWith(prefix.replace(/^(?!scripts\/)/, '')) || entry.includes(prefix)))
    expect(strays).toEqual([])
  })
})
